// The browser's side of a Muse Spark call: typed facts to the Worker, the model's thinking as it comes, and ids back. Any failure is a fallback the caller
// already has. A prepared demo plugs in here and answers from a recorded run, through the same screens, and says it's a replay.
export type SparkReply = { status: "ok"; answer: unknown; cached: boolean } | { status: "fallback"; reason: string };

/** What's happening on a call, for whoever is showing it. */
export interface RecordedTiming { source: "recorded"; realMs: number; recorded: string; model: string; version: string }
export type SparkEvent = { callId: string } & ({ kind: "start"; shape: string; input: unknown } | { kind: "recorded"; shape: string; timing: RecordedTiming } | { kind: "thinking"; shape: string; text: string } | { kind: "end"; shape: string; ok: boolean });
type Listener = (event: SparkEvent) => void;
const listeners = new Set<Listener>();
// Activity belongs to this browser page. The server keeps its separate attempt UUID and accounting.
let nextCall = 0;
let activityRun = 0;
/** Only activity changes owner here. In-flight request, retry and accounting contracts stay unchanged. */
export const resetSparkActivity = () => { activityRun++; };
export function onSpark(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const emit = (event: SparkEvent) => listeners.forEach((l) => l(event));

/** Answers calls some other way than the Worker. */
export type Transport = (shape: string, input: unknown, think: (text: string) => void, timing?: (value: RecordedTiming) => void) => Promise<SparkReply>;
let transport: Transport | null = null;
export const setTransport = (t: Transport | null) => {
  transport = t;
};

const KEY_STORE = "motifold-key";
let ownKey: string | null = null;

/** Picks up a key given earlier in this tab. Called once, as the app starts. */
export function rememberOwnKey(): void {
  try {
    ownKey = sessionStorage.getItem(KEY_STORE);
  } catch {
    ownKey = null;
  }
}
export const hasOwnKey = () => !!ownKey;

/** A visitor's own Meta key, kept in this tab only and sent with each call, and never stored by the server. */
export function setOwnKey(key: string | null): void {
  ownKey = key;
  try {
    if (key) sessionStorage.setItem(KEY_STORE, key);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    // It still works for as long as the page is open.
  }
}

export interface RecordedCall {
  shape: string;
  input: unknown;
  reply: SparkReply;
  ms: number;
  thinking: { at: number; text: string }[];
  usage?: unknown;
  version?: string;
  model?: string;
}
/** Every call as it really happened, kept when the page is opened with ?record, to build a prepared demo from. */
export const recording: RecordedCall[] = [];
const recordingOn = () => typeof location !== "undefined" && location.search.includes("record");

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", "x-motifold-stream": "1", ...(ownKey ? { "x-motifold-key": ownKey } : {}) };
}

export async function askSpark(shape: string, input: unknown, signal?: AbortSignal): Promise<SparkReply> {
  const run = activityRun;
  const reply = await askOnce(shape, input, signal, run);
  // A connection dropped halfway is worth one more go, and anything else isn't.
  return reply.status === "fallback" && reply.reason === "network" && !signal?.aborted ? askOnce(shape, input, signal, run) : reply;
}

async function askOnce(shape: string, input: unknown, signal: AbortSignal | undefined, run: number): Promise<SparkReply> {
  const callId = `spark-${++nextCall}`;
  const publish = (event: SparkEvent) => { if (run === activityRun) emit(event); };
  publish({ kind: "start", callId, shape, input });
  const started = Date.now();
  const thinking: RecordedCall["thinking"] = [];
  const think = (text: string) => {
    thinking.push({ at: Date.now() - started, text });
    publish({ kind: "thinking", callId, shape, text });
  };
  let reply: SparkReply;
  let meta: Partial<RecordedCall> = {};
  try {
    if (transport) reply = await transport(shape, input, think, (timing) => publish({ kind: "recorded", callId, shape, timing }));
    else {
      const res = await fetch(`/api/spark/${shape}`, { method: "POST", headers: headers(), body: JSON.stringify({ attemptId: crypto.randomUUID(), input }), signal });
      if (!res.ok) reply = { status: "fallback", reason: `http-${res.status}` };
      else if (!res.body || !res.headers?.get("content-type")?.includes("event-stream")) {
        const body = (await res.json()) as SparkReply;
        reply = body?.status === "ok" || body?.status === "fallback" ? body : { status: "fallback", reason: "malformed" };
      } else {
        const read = await readStream(res.body as ReadableStream<Uint8Array>, think);
        reply = read.reply;
        meta = read.meta;
      }
    }
  } catch {
    reply = { status: "fallback", reason: signal?.aborted ? "stale" : "unreachable" };
  }
  if (recordingOn()) recording.push({ shape, input, reply, ms: Date.now() - started, thinking, ...meta });
  publish({ kind: "end", callId, shape, ok: reply.status === "ok" });
  return reply;
}

/** Reads the server's events: thinking as it arrives, then the checked result. */
async function readStream(body: ReadableStream<Uint8Array>, think: (text: string) => void): Promise<{ reply: SparkReply; meta: Partial<RecordedCall> }> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = "";
  let line = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { reply: { status: "fallback", reason: "malformed" }, meta: {} };
    buffer += value;
    for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
      const data = buffer.slice(0, cut).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      buffer = buffer.slice(cut + 2);
      if (!data) continue;
      const event = JSON.parse(data) as { kind?: string; text?: string; result?: SparkReply & { usage?: unknown; version?: string; model?: string } };
      if (event.kind === "thinking" && event.text) {
        // Summaries come a few words at a time, and a line reads better whole.
        line += event.text;
        for (let end = line.search(/[.!?\n](?=[\sA-Z])/); end >= 0; end = line.search(/[.!?\n](?=[\sA-Z])/)) {
          if (line.slice(0, end + 1).trim()) think(line.slice(0, end + 1).trim());
          line = line.slice(end + 1);
        }
      } else if (event.kind === "result" && event.result) {
        if (line.trim()) think(line.trim());
        const { usage, version, model, ...reply } = event.result;
        return { reply: reply.status === "ok" || reply.status === "fallback" ? reply : { status: "fallback", reason: "malformed" }, meta: { usage, version, model } };
      }
    }
  }
}
