import { afterEach, expect, it, vi } from "vitest";
import { askSpark, onSpark, recording, setTransport, type SparkEvent, type SparkReply } from "./spark";
import { startDemo, stopDemo } from "./demo";

afterEach(() => { stopDemo(); setTransport(null); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("keeps one activity identity and one request UUID per explicit call, including an explicit retry", async () => {
  const seen: SparkEvent[] = [];
  const sent: { attemptId: string; input: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return Response.json(sent.length === 1 ? { status: "fallback", reason: "network" } : { status: "ok", answer: {}, cached: false });
  }));
  const off = onSpark(event => seen.push(event));
  try {
    const input = { window: { from: "1", to: "8" } };
    expect(await askSpark("arrange", input)).toEqual({ status: "fallback", reason: "network" });
    expect(sent).toHaveLength(1);
    expect(seen.map(event => event.kind)).toEqual(["start", "end"]);
    expect(await askSpark("arrange", input)).toMatchObject({ status: "ok" });
    const starts = seen.filter(event => event.kind === "start");
    const ends = seen.filter(event => event.kind === "end");
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map(event => event.callId)).size).toBe(2);
    expect(starts.every(event => typeof event.callId === "string" && event.callId.length > 0)).toBe(true);
    expect(ends.map(event => event.callId)).toEqual(starts.map(event => event.callId));
    expect(sent).toHaveLength(2);
    expect(sent.every(body => /^[0-9a-f-]{36}$/i.test(body.attemptId))).toBe(true);
    expect(sent[0]!.attemptId).not.toBe(sent[1]!.attemptId);
    expect(sent.every(body => Object.keys(body).sort().join(",") === "attemptId,input")).toBe(true);
  } finally { off(); }
});

it("gives a recorded replay the same event identity contract with real recorded provenance", async () => {
  vi.useFakeTimers();
  const saved = { version: "read-piece-test", model: "local-test", shape: "read_piece", input: {}, reply: { status: "ok", answer: "recorded", cached: false } as SparkReply, ms: 1800, thinking: [{ at: 0, text: "Reading the recorded tune." }] };
  const fetchNow = vi.fn(async (_url: string) => Response.json([saved]));
  vi.stubGlobal("fetch", fetchNow);
  startDemo({ id: "local", name: "Local replay", words: "A replay", midi: "/demo/local.mid", xml: "/demo/local.xml", recipe: { intent: "arrange", ensemble: "String orchestra", moreBars: 0, where: "inside", useMelodyOnly: false }, guide: ["Use the recorded choices."], runs: [] }, "2026-11-03");
  const events: SparkEvent[] = [];
  const off = onSpark(event => events.push(event));
  try {
    const pending = askSpark("read_piece", {});
    await vi.advanceTimersByTimeAsync(1800);
    expect(await pending).toEqual(saved.reply);
    expect(events.map(event => event.kind)).toEqual(["start", "recorded", "thinking", "end"]);
    expect(events.find(event => event.kind === "recorded")).toMatchObject({ timing: { source: "recorded", realMs: 1800, recorded: "2026-11-03", model: "local-test", version: "read-piece-test" } });
    expect(events.every(event => event.callId === events[0]!.callId)).toBe(true);
    expect(typeof events[0]!.callId).toBe("string");
    expect(fetchNow).toHaveBeenCalledOnce();
    expect(fetchNow.mock.calls[0]![0]).toBe("/demo/local/shared.json");
    expect(recording).toEqual([]);
    expect(Object.keys(saved).sort()).toEqual(["input", "model", "ms", "reply", "shape", "thinking", "version"]);
  } finally { off(); }
});
