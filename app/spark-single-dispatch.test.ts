import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { askSpark, onSpark, recording, resetSparkActivity, setOwnKey, setTransport, type SparkEvent, type SparkReply } from "./spark";

const input = { window: { from: "1", to: "8" } };
const success: SparkReply = { status: "ok", answer: { adds: [] }, cached: false };
const sse = (result: unknown) => new Response(new ReadableStream<Uint8Array>({ start(controller) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: "thinking", text: "A recorded thought." })}\n\ndata: ${JSON.stringify({ kind: "result", result })}\n\n`));
  controller.close();
} }), { headers: { "Content-Type": "text/event-stream" } });
let events: SparkEvent[], off: () => void;
beforeEach(() => {
  setTransport(null); setOwnKey(null); resetSparkActivity(); recording.length = 0;
  vi.stubGlobal("location", { search: "?record" });
  events = []; off = onSpark(event => events.push(event));
});
afterEach(() => { off(); recording.length = 0; setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function oneRequest(fetchNow: ReturnType<typeof vi.fn>) {
  expect(fetchNow).toHaveBeenCalledOnce();
  const [url, init] = fetchNow.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("/api/spark/arrange"); expect(init.method).toBe("POST");
  const body = JSON.parse(init.body as string);
  expect(Object.keys(body).sort()).toEqual(["attemptId", "input"]);
  expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/i); expect(body.input).toEqual(input);
  expect(events.filter(event => event.kind === "start")).toHaveLength(1);
  expect(events.filter(event => event.kind === "end")).toHaveLength(1);
  expect(events.every(event => event.callId === events[0]!.callId)).toBe(true);
  expect(recording).toHaveLength(1);
  expect(recording[0]).toMatchObject({ shape: "arrange", input });
}

it.each(["JSON", "SSE"])("never automatically redispatches an explicit %s network fallback", async format => {
  const reply: SparkReply = { status: "fallback", reason: "network" };
  const fetchNow = vi.fn(async () => format === "JSON" ? Response.json(reply) : sse(reply));
  vi.stubGlobal("fetch", fetchNow);
  expect(await askSpark("arrange", input)).toEqual(reply);
  oneRequest(fetchNow);
  expect(recording[0]!.reply).toEqual(reply);
  expect(events.at(-1)).toMatchObject({ kind: "end", ok: false });
});

it.each(["fetch rejected", "stream interrupted", "HTTP502"])("retains one unknown physical attempt when %s", async failure => {
  const fetchNow = vi.fn(async () => {
    if (failure === "fetch rejected") throw new TypeError("Local transport failure");
    if (failure === "HTTP502") return new Response("Local upstream failed", { status: 502 });
    return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("Local stream failure")); } }), { headers: { "Content-Type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fetchNow);
  const reply = await askSpark("arrange", input);
  expect(reply).toEqual({ status: "fallback", reason: failure === "HTTP502" ? "http-502" : "unreachable" });
  oneRequest(fetchNow);
  expect(recording[0]!.reply).toEqual(reply);
});

it("retains successful stream reasoning, usage and provenance with one dispatch", async () => {
  const usage = { input_tokens: 12, output_tokens: 6 };
  const fetchNow = vi.fn(async () => sse({ ...success, usage, model: "local-test-model", version: "local-test-version" }));
  vi.stubGlobal("fetch", fetchNow);
  expect(await askSpark("arrange", input)).toEqual(success);
  oneRequest(fetchNow);
  expect(events.map(event => event.kind)).toEqual(["start", "thinking", "end"]);
  expect(recording[0]).toMatchObject({ reply: success, usage, model: "local-test-model", version: "local-test-version", thinking: [{ text: "A recorded thought." }] });
});

it("passes through an abort and records its single cancelled attempt without a redispatch", async () => {
  const abort = new AbortController();
  const fetchNow = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Local cancelled request", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetchNow);
  const pending = askSpark("arrange", input, abort.signal); abort.abort();
  expect(await pending).toEqual({ status: "fallback", reason: "stale" });
  oneRequest(fetchNow);
  expect(fetchNow.mock.calls[0]![1].signal).toBe(abort.signal);
  expect(recording[0]!.reply).toEqual({ status: "fallback", reason: "stale" });
});
