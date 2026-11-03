// The one Muse Spark client. Responses API, because search grounding isn't available on Chat
// Completions (dev.meta.ai/docs/search-grounding). Strict JSON schema, no hidden retries, no stored
// responses, a hard deadline. It never decides about money: it reports usage, or that there was none.
import type { Usage } from "./prices";

export const SPARK_URL = "https://api.meta.ai/v1/responses";
export const MODEL = "muse-spark-1.3";

export type Effort = "minimal" | "low" | "medium" | "high";

/** What arrives while a streamed call runs. None of it is checked until the whole answer has come back. */
export type SparkEvent = { kind: "thinking" | "answer"; text: string } | { kind: "other"; type: string };

export interface SparkCall {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort: Effort;
  /** Reasoning and answer together. */
  maxOutputTokens: number;
  deadlineMs: number;
  cacheKey: string;
  /** Web search grounding, with at most this many searches. Absent: no search. */
  maxSearches?: number;
  /** A hashed, stable id for the visitor, for Meta's abuse checks. */
  safetyId?: string;
  /** Asks for the answer as it's written, with a summary of the reasoning, and hands each piece here. */
  onEvent?: (event: SparkEvent) => void;
}

export interface Source {
  url: string;
  title: string;
}

export type SparkOutcome =
  | { status: "ok"; answer: unknown; usage: Usage; searches: number; sources: Source[]; ms: number }
  /** Meta answered and reported usage, but the answer can't be used. It was charged. */
  | { status: "unusable"; reason: "incomplete" | "refused" | "not-json" | "failed"; usage: Usage; searches: number; ms: number; detail: string }
  /** No usage came back, so what it cost is unknown. */
  | { status: "unknown"; reason: "timeout" | "network" | "http" | "malformed"; httpStatus: number | null; ms: number; detail: string };

export function requestBody(call: SparkCall): Record<string, unknown> {
  if (MODEL.endsWith("-contributor")) throw new Error("contributor models train on what they're sent");
  return {
    model: MODEL,
    instructions: call.instructions,
    input: call.input,
    reasoning: call.onEvent ? { effort: call.effort, summary: "auto" } : { effort: call.effort },
    ...(call.onEvent ? { stream: true } : {}),
    max_output_tokens: call.maxOutputTokens,
    text: { format: { type: "json_schema", name: call.schemaName, schema: call.schema, strict: true } },
    store: false,
    parallel_tool_calls: false,
    prompt_cache_key: call.cacheKey,
    ...(call.safetyId ? { safety_identifier: call.safetyId } : {}),
    ...(call.maxSearches
      ? {
          tools: [{ type: "web_search", search_context_size: "medium" }],
          max_tool_calls: call.maxSearches,
          include: ["web_search_call.action.sources"],
        }
      : {}),
  };
}

export async function callSpark(call: SparkCall, key: string, fetchImpl: typeof fetch = fetch): Promise<SparkOutcome> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), call.deadlineMs);
  let res: Response;
  let text: string;
  try {
    // Sent once. A failure, however fast, can't prove Meta never got it, so its reservation stays held and a new try is a new attempt with its own (review M2).
    res = await fetchImpl(SPARK_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(requestBody(call)), signal: abort.signal });
    text = call.onEvent && res.ok ? await readEvents(res, call.onEvent) : await res.text();
  } catch (e) {
    const timedOut = abort.signal.aborted;
    return { status: "unknown", reason: timedOut ? "timeout" : "network", httpStatus: null, ms: ms(), detail: timedOut ? `no answer in ${call.deadlineMs} ms` : String(e) };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    return { status: "unknown", reason: "http", httpStatus: res.status, ms: ms(), detail: text.slice(0, 500) };
  }
  return readResponse(text, ms());
}

/** Reads a stream, passing on each piece, and returns the finished response for `readResponse`. A stream that never finishes returns nothing, which reads as cost unknown. */
async function readEvents(res: Response, onEvent: (event: SparkEvent) => void): Promise<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = "";
  for (;;) {
    // Once the last event has come, what it cost is known, whatever the connection does next.
    let chunk: { done: boolean; value?: string };
    try {
      chunk = await reader.read();
    } catch (e) {
      if (finished) return finished;
      throw e;
    }
    const { done, value } = chunk;
    if (done) return finished;
    buffer += value!.replace(/\r/g, "");
    for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
      const data = buffer.slice(0, cut).split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      buffer = buffer.slice(cut + 2);
      let event: { type?: string; delta?: string; response?: unknown };
      try {
        event = JSON.parse(data) as typeof event;
      } catch {
        continue;
      }
      if (event.type === "response.reasoning_summary_text.delta") onEvent({ kind: "thinking", text: event.delta ?? "" });
      else if (event.type === "response.output_text.delta") onEvent({ kind: "answer", text: event.delta ?? "" });
      else {
        onEvent({ kind: "other", type: event.type ?? "unknown" });
        if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") finished = JSON.stringify(event.response);
      }
    }
  }
}

/** Reads a Responses API body: usage first, because whatever else is wrong, a reported usage was charged. */
export function readResponse(text: string, ms: number): SparkOutcome {
  let body: ResponseBody;
  try {
    body = JSON.parse(text) as ResponseBody;
  } catch {
    return { status: "unknown", reason: "malformed", httpStatus: 200, ms, detail: "the body isn't JSON" };
  }
  const usage = readUsage(body.usage);
  if (!usage) return { status: "unknown", reason: "malformed", httpStatus: 200, ms, detail: "no usage in the answer" };

  const output = Array.isArray(body.output) ? body.output : [];
  const searchCalls = output.filter((o) => o.type === "web_search_call");
  // Billed per query, and one search action may batch several (review L1). Any other action counts
  // as one, to stay on the safe side.
  const searches = searchCalls.reduce((n, c) => n + (c.action?.type === "search" && Array.isArray(c.action.queries) ? Math.max(1, c.action.queries.length) : 1), 0);
  if (body.status !== "completed") {
    const why = body.incomplete_details?.reason ?? body.error?.message ?? String(body.status);
    return { status: "unusable", reason: body.status === "incomplete" ? "incomplete" : "failed", usage, searches, ms, detail: why };
  }
  const parts = output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  const refusal = parts.find((p) => p.type === "refusal");
  if (refusal) return { status: "unusable", reason: "refused", usage, searches, ms, detail: refusal.refusal ?? "refused" };
  const answerText = parts
    .filter((p) => p.type === "output_text")
    .map((p) => p.text ?? "")
    .join("");
  let answer: unknown;
  try {
    answer = JSON.parse(answerText);
  } catch {
    return { status: "unusable", reason: "not-json", usage, searches, ms, detail: answerText.slice(0, 200) };
  }

  const sources = new Map<string, Source>();
  for (const p of parts) {
    for (const a of p.annotations ?? []) {
      if (a.type === "url_citation" && a.url) sources.set(a.url, { url: a.url, title: a.title ?? a.url });
    }
  }
  for (const call of searchCalls) {
    for (const s of call.action?.sources ?? []) {
      if (s.url && !sources.has(s.url)) sources.set(s.url, { url: s.url, title: s.title ?? s.url });
    }
  }
  return { status: "ok", answer, usage, searches, sources: [...sources.values()], ms };
}

/** Counters must be whole, non-negative and consistent. Anything else is malformed: cost unknown (review L4). */
function readUsage(u: ResponseBody["usage"]): Usage | null {
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  if (!u || !count(u.input_tokens) || !count(u.output_tokens) || !count(cached) || cached > u.input_tokens) return null;
  return { inputTokens: u.input_tokens, cachedTokens: cached, outputTokens: u.output_tokens };
}

interface ResponseBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  };
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
    action?: { type?: string; queries?: unknown[]; sources?: { url?: string; title?: string }[] };
  }[];
}
