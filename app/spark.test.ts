import { afterEach, describe, expect, it, vi } from "vitest";
import { askSpark, onSpark, setTransport, type SparkEvent } from "./spark";

const stream = (pieces: unknown[]) => new Response(new ReadableStream({ start(c) { pieces.forEach((p) => c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(p)}\n\n`))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
afterEach(() => {
  vi.unstubAllGlobals();
  setTransport(null);
});

describe("asking Muse Spark", () => {
  it("shows the thinking as whole lines as it comes, even when sentences run together, then the answer", async () => {
    vi.stubGlobal("fetch", async () => stream([{ kind: "thinking", text: "Reading the bass" }, { kind: "thinking", text: " first.Then the tune. And" }, { kind: "thinking", text: " the end" }, { kind: "result", result: { status: "ok", answer: { a: 1 }, cached: false } }]));
    const seen: SparkEvent[] = [];
    const off = onSpark((e) => seen.push(e));
    const reply = await askSpark("read_piece", {});
    off();
    expect(reply).toEqual({ status: "ok", answer: { a: 1 }, cached: false });
    expect(seen.filter((e) => e.kind === "thinking").map((e) => (e as { text: string }).text)).toEqual(["Reading the bass first.", "Then the tune.", "And the end"]);
    expect(seen.at(-1)).toEqual({ kind: "end", callId: seen[0]!.callId, shape: "read_piece", ok: true });
  });

  it("returns a dropped connection without automatically dispatching another attempt", async () => {
    const fetchNow = vi.fn(async () => Response.json({ status: "fallback", reason: "network" }));
    vi.stubGlobal("fetch", fetchNow);
    expect(await askSpark("arrange", {})).toEqual({ status: "fallback", reason: "network" });
    expect(fetchNow).toHaveBeenCalledOnce();
    const refused = vi.fn(async () => Response.json({ status: "fallback", reason: "cap" }));
    vi.stubGlobal("fetch", refused);
    await askSpark("arrange", {});
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("answers from a recording when one is plugged in, and never touches the network", async () => {
    const fetchNow = vi.fn();
    vi.stubGlobal("fetch", fetchNow);
    setTransport(async (_shape, _input, think) => {
      think("A line.");
      return { status: "ok", answer: "saved", cached: false };
    });
    expect(await askSpark("arrange", {})).toMatchObject({ status: "ok", answer: "saved" });
    expect(fetchNow).not.toHaveBeenCalled();
  });
});
