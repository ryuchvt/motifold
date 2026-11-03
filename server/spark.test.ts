import { describe, expect, it } from "vitest";
import { callSpark, MODEL, readResponse, requestBody, type SparkCall } from "./spark";

const call: SparkCall = {
  instructions: "Reply with the word.",
  input: "cello",
  schemaName: "ping",
  schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"], additionalProperties: false },
  effort: "minimal",
  maxOutputTokens: 512,
  deadlineMs: 1000,
  cacheKey: "phrasepath-ping-1",
};

const usage = { input_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens: 40 };
const message = (text: string, annotations: unknown[] = []) => ({
  type: "message",
  content: [{ type: "output_text", text, annotations }],
});

describe("requestBody", () => {
  it("asks for strict JSON, sets every cap, stores nothing, and never a contributor model", () => {
    const body = requestBody(call);
    expect(body).toMatchObject({
      model: "muse-spark-1.3",
      reasoning: { effort: "minimal" },
      max_output_tokens: 512,
      text: { format: { type: "json_schema", name: "ping", strict: true } },
      store: false,
    });
    expect(body).not.toHaveProperty("tools");
    expect(MODEL.endsWith("-contributor")).toBe(false);
  });

  it("caps web searches when a call may search", () => {
    const body = requestBody({ ...call, maxSearches: 3 });
    expect(body).toMatchObject({ tools: [{ type: "web_search" }], max_tool_calls: 3, parallel_tool_calls: false });
  });
});

describe("readResponse", () => {
  it("reads the answer, the usage, the searches and their sources", () => {
    const out = readResponse(
      JSON.stringify({
        status: "completed",
        usage,
        output: [
          { type: "web_search_call", action: { type: "search", sources: [{ url: "https://a.example", title: "A" }] } },
          { type: "reasoning" },
          message('{"word":"cello"}', [{ type: "url_citation", url: "https://b.example", title: "B" }]),
        ],
      }),
      5,
    );
    expect(out).toEqual({
      status: "ok",
      answer: { word: "cello" },
      usage: { inputTokens: 120, cachedTokens: 0, outputTokens: 40 },
      searches: 1,
      sources: [
        { url: "https://b.example", title: "B" },
        { url: "https://a.example", title: "A" },
      ],
      ms: 5,
    });
  });

  it("keeps the usage of an answer that ran out of room, so it is charged but never shown", () => {
    const out = readResponse(
      JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage, output: [] }),
      5,
    );
    expect(out).toMatchObject({ status: "unusable", reason: "incomplete", detail: "max_output_tokens", usage: { outputTokens: 40 } });
  });

  it("treats a refusal and broken JSON as charged but unusable", () => {
    const refused = readResponse(
      JSON.stringify({ status: "completed", usage, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
      5,
    );
    expect(refused).toMatchObject({ status: "unusable", reason: "refused" });
    const broken = readResponse(JSON.stringify({ status: "completed", usage, output: [message('{"word":')] }), 5);
    expect(broken).toMatchObject({ status: "unusable", reason: "not-json" });
  });

  it("calls the cost unknown when no usage comes back", () => {
    expect(readResponse("<html>", 5)).toMatchObject({ status: "unknown", reason: "malformed" });
    expect(readResponse(JSON.stringify({ status: "completed", output: [message("{}")] }), 5)).toMatchObject({
      status: "unknown",
      reason: "malformed",
    });
  });
});

describe("a streamed call", () => {
  const sse = (...events: object[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const answered = (chunks: string[]) => (async () => new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }))) as unknown as typeof fetch;
  const done = { status: "completed", usage: { input_tokens: 5, output_tokens: 7 }, output: [{ type: "message", content: [{ type: "output_text", text: '{"a":1}' }] }] };

  it("asks for a summary of the reasoning, only when streaming", () => {
    expect(requestBody(call)).not.toHaveProperty("stream");
    expect(requestBody(call).reasoning).toEqual({ effort: call.effort });
    expect(requestBody({ ...call, onEvent: () => {} })).toMatchObject({ stream: true, reasoning: { effort: call.effort, summary: "auto" } });
  });

  it("hands on each piece, even split across chunks, and settles from the finished response", async () => {
    const seen: unknown[] = [];
    const text = sse({ type: "response.reasoning_summary_text.delta", delta: "Hmm" }, { type: "response.output_text.delta", delta: '{"a"' }, { type: "response.completed", response: done });
    const out = await callSpark({ ...call, onEvent: (e) => seen.push(e) }, "k", answered([text.slice(0, 30), text.slice(30)]));
    expect(seen.slice(0, 2)).toEqual([{ kind: "thinking", text: "Hmm" }, { kind: "answer", text: '{"a"' }]);
    expect(out).toMatchObject({ status: "ok", answer: { a: 1 }, usage: { inputTokens: 5, outputTokens: 7 } });
  });

  it("calls the cost unknown when the stream stops before the end", async () => {
    const out = await callSpark({ ...call, onEvent: () => {} }, "k", answered([sse({ type: "response.output_text.delta", delta: "x" })]));
    expect(out).toMatchObject({ status: "unknown", reason: "malformed" });
  });
});

describe("callSpark", () => {
  it("sends the key only in the header, to Meta's Responses endpoint", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ status: "completed", usage, output: [message('{"word":"cello"}')] }));
    }) as unknown as typeof fetch;
    const out = await callSpark(call, "LLM_test", fake);
    expect(out.status).toBe("ok");
    expect(seen!.url).toBe("https://api.meta.ai/v1/responses");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer LLM_test");
    expect(String(seen!.init.body)).not.toContain("LLM_test");
  });

  it("gives up at the deadline and calls the cost unknown", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const out = await callSpark({ ...call, deadlineMs: 20 }, "k", hang);
    expect(out).toMatchObject({ status: "unknown", reason: "timeout" });
  });

  it("calls an HTTP error's cost unknown and keeps Meta's message", async () => {
    const fail = (async () => new Response('{"error":{"message":"overloaded"}}', { status: 503 })) as unknown as typeof fetch;
    expect(await callSpark(call, "k", fail)).toMatchObject({ status: "unknown", reason: "http", httpStatus: 503 });
  });
});

describe("a connection that fails", () => {
  const call = { instructions: "x", input: "y", schemaName: "s", schema: {}, effort: "low", maxOutputTokens: 10, deadlineMs: 5000, cacheKey: "k" } as const;
  it("is not sent again, however fast it failed, because Meta may have got the first one (review M2)", async () => {
    const body = JSON.stringify({ status: "completed", usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] });
    let tries = 0;
    const outcome = await callSpark(call, "key", (async () => {
      if (++tries === 1) throw new Error("Network connection lost.");
      return new Response(body);
    }) as typeof fetch);
    expect(tries).toBe(1);
    expect(outcome).toMatchObject({ status: "unknown", reason: "network" });
  });
  it("still reports a connection that keeps failing", async () => {
    const outcome = await callSpark(call, "key", (async () => { throw new Error("gone"); }) as typeof fetch);
    expect(outcome).toMatchObject({ status: "unknown", reason: "network" });
  });
});
