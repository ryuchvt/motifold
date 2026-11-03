// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { scoreTracks } from "./arrange";
import { setTransport, type SparkReply } from "./spark";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/contract-score.musicxml", "utf8"), score = parseScore(xmlText);
const okay = (answer: unknown): SparkReply => ({ status: "ok", cached: false, answer });
let unmount = () => {};
afterEach(() => { act(unmount); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup() {
  const calls: { shape: string; input: any }[] = [], failures = new Map<string, string>();
  let quotaAfterFirstWindow = false;
  setTransport(async (shape, raw) => {
    const input = raw as any; calls.push({ shape, input });
    const reason = failures.get(shape);
    if (reason) return { status: "fallback", reason };
    if (shape === "read_piece") return okay({ summary: "A local score", sections: [], roles: [], missing: [], thin: [], structures: [], questions: [] });
    if (shape === "study_score") return okay({ sections: [], harmony: [], moments: [] });
    if (shape === "plan_options") return okay({ options: [{ name: "One", idea: "A flute answer", why: [{ from: input.written[0].bar, to: input.written.at(-1).bar, what: "An answer", principle: "Support the source" }] }] });
    if (shape === "plan_recompose") return okay({ options: [{ name: "Reshaped", idea: "The whole melody", why: [{ from: "1", to: String(input.moreBars), what: "A new treatment", principle: "Retain the melody" }], motif: { from: "1", to: "1", what: "The opening" }, fifths: 0, time: "4/4", qpm: 90 }] });
    if (shape === "write_theme") return okay({ lines: [{ bar: "1", role: "tune", events: "C5@0+1" }] });
    if (shape === "arrange") {
      if (quotaAfterFirstWindow && calls.filter(c => c.shape === "arrange").length > 1) return { status: "fallback", reason: "quota" };
      return okay({ adds: [{ part: "Flute", bar: input.window?.from ?? "1", events: "C5@0+1", dyn: "mf" }], doubles: [] });
    }
    throw Error(`Unexpected local shape: ${shape}`);
  });
  const loaded = { fileName: "contract-score.musicxml", xmlText, score }, range = { from: 0, to: score.parts[0]!.measures.length - 1 };
  let now!: Arranged;
  function Host() { now = useArrange(loaded, score.parts[0]!, range, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host/>)); unmount = () => root.unmount();
  return { get now() { return now; }, calls, failures, stopAfterFirstWindow: () => { quotaAfterFirstWindow = true; } };
}

it("reports the actual read and Study refusal separately and clears it on a successful retry", async () => {
  const x = setup(); x.failures.set("read_piece", "today");
  await act(() => x.now.askPiece());
  expect(x.now.piece).toEqual({ status: "unavailable", reason: "today" });
  expect(x.calls.map(c => c.shape)).toEqual(["read_piece"]);
  expect(x.now.standing).toBe(score);
  x.failures.delete("read_piece"); x.failures.set("study_score", "quota");
  await act(() => x.now.askPiece());
  expect(x.now.piece.status).toBe("ready");
  expect(x.now.study).toEqual({ status: "unavailable", reason: "quota" });
  x.failures.delete("study_score"); await act(() => x.now.askStudy());
  expect(x.now.study.status).toBe("ready");
  expect("reason" in x.now.study).toBe(false);
});

it("retains partial notes, the full source and a working ZIP export when a later window reaches the visitor limit", async () => {
  const x = setup(); await act(() => x.now.askPiece()); await act(() => x.now.askOptions("", 0, "inside"));
  x.stopAfterFirstWindow(); await act(() => x.now.askNotes(0));
  const options = x.now.options;
  if (options.status !== "ready" || options.notes[0]?.status !== "ready") throw Error("Partial score was lost");
  expect(options.notes[0]).toMatchObject({ reason: "quota", adds: [{ part: "Flute", bar: "1" }] });
  expect(options.notes[0].missing).toEqual([{ from: "7b", to: "14" }, { from: "15", to: "21" }]);
  expect(x.calls.filter(c => c.shape === "arrange")).toHaveLength(2);
  const blobs: Blob[] = [], URLNow = URL;
  vi.stubGlobal("URL", class extends URLNow { static createObjectURL(blob: Blob) { blobs.push(blob); return "blob:local-export"; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  act(() => x.now.download());
  expect(blobs).toHaveLength(1);
  const bytes = await new Promise<ArrayBuffer>((done, reject) => { const reader = new FileReader(); reader.onload = () => done(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blobs[0]!); });
  const files = unzipSync(new Uint8Array(bytes));
  const full = Object.entries(files).find(([name]) => name.endsWith(".musicxml"))!;
  const exported = parseScore(new TextDecoder().decode(full[1]));
  expect(exported.parts.every(p => p.measures.length === 24)).toBe(true);
  const tracks = scoreTracks(exported);
  for (const original of scoreTracks(score)) expect(tracks.find(t => t.name === original.name)?.notes).toEqual(original.notes);
  expect(tracks.find(t => t.name === "Flute")?.notes).toHaveLength(1);
  const before = options.notes[0].adds;
  x.failures.set("arrange", "busy"); await act(() => x.now.askFix(0, "1", "1", "A clearer answer"));
  expect(x.now.fixingReason).toBe("busy");
  expect(x.now.options.status === "ready" && x.now.options.notes[0]?.status === "ready" && x.now.options.notes[0].adds).toEqual(before);
});

it("passes default Reshaped2 to Recompose planning, theme and every writing window", async () => {
  const x = setup();
  await act(() => x.now.askRecompose("The mood I want: hopeful.", 32, ["Flute"]));
  await act(() => x.now.writeRecomposed(0));
  const jobs = x.calls.filter(c => ["plan_recompose", "write_theme", "arrange"].includes(c.shape));
  expect(jobs.length).toBeGreaterThan(2);
  expect(jobs.every(c => c.input.freedom === 2)).toBe(true);
  expect(x.now.lastAsk).toBe("recompose-2-hopeful");
});
