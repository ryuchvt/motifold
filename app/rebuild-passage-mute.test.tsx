// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { parseScore } from "../score";
import { newBarNumbers, type ArrangeInput, type WriteInput } from "../server/shapes";
import { scoreTracks } from "./arrange";
import { readMidi } from "./midi";
import { setTransport } from "./spark";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(labels = ["1", "7a", "7b", "2", "10", "Coda"], adds = ["7a", "7b", "10"], moreBars = 0) {
  const xmlText = `<score-partwise><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1">${labels.map((label, k) => `<measure number="${label}">${k ? "" : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><sound tempo="93"/>'}<note dynamics="${55 + k * 5}"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join("")}</part></score-partwise>`;
  const score = parseScore(xmlText);
  const part = score.parts[0]!;
  const loaded = { fileName: "my-sketch.musicxml", xmlText, score };
  const range = { from: 0, to: labels.length - 1 };
  const calls: string[] = [];
  setTransport(async (shape, input) => {
    calls.push(shape);
    if (shape === "read_piece") return { status: "ok", cached: false, answer: { summary: "A sketch", sections: [], roles: [], structures: [], missing: [], thin: [] } };
    if (shape === "study_score") return { status: "fallback", reason: "not-prepared" };
    if (shape === "plan_options") {
      const asked = input as ArrangeInput;
      const bars = [...asked.written.map((w) => w.bar), ...newBarNumbers(asked)];
      return { status: "ok", cached: false, answer: { options: [{ name: "An answer", idea: "Flute joins", why: new Set(bars).size === bars.length ? [{ from: bars[0], to: bars.at(-1), what: "Flute answers", principle: "Keep the source" }] : [] }] } };
    }
    if (shape !== "arrange") throw Error(`Unexpected local call ${shape}`);
    const asked = input as WriteInput;
    expect(asked.chosen.name).toBe("An answer");
    return { status: "ok", cached: false, answer: { adds: adds.map((bar) => ({ part: "Flute", bar, events: "C5@0+1", dyn: "mf" })), doubles: [] } };
  });
  let now!: Arranged;
  function Host() { now = useArrange(loaded, part, range, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  await act(() => now.askPiece());
  await act(() => now.askOptions("", moreBars, moreBars ? "both" : "inside"));
  await act(() => now.askNotes(0));
  return { score, calls, get now() { return now; } };
}

it("mutes only actual new bars in score order, independently of the notation viewport, and reverses mixed states", async () => {
  const screen = await setup();
  act(() => screen.now.selectRange("1", "2"));
  const calls = screen.calls.length;
  expect(screen.now.newInRange("7b", "10")).toEqual(["7b", "10"]);
  act(() => screen.now.toggleRange("7b", "10"));
  expect(screen.now.offBars).toEqual(["7b", "10"]);
  expect(screen.now.newInRange("7b", "10")).toEqual(["7b", "10"]);
  act(() => screen.now.toggleRange("7a", "7b"));
  expect(new Set(screen.now.offBars)).toEqual(new Set(["7a", "7b", "10"]));
  act(() => screen.now.toggleRange("7b", "10"));
  expect(screen.now.offBars).toEqual(["7a"]);
  expect(screen.now.view).toEqual({ from: "1", to: "2" });
  expect(screen.now.page!.score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "7a", "7b", "2"]);
  expect(screen.calls).toHaveLength(calls);
});

it("keeping and downloading a muted passage preserves every source note and exports the full score", async () => {
  const screen = await setup();
  act(() => screen.now.selectRange("1", "2"));
  act(() => screen.now.toggleRange("7b", "10"));
  const blobs: Blob[] = [];
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL(blob: Blob) { blobs.push(blob); return "blob:local-test"; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  act(() => screen.now.download());
  act(() => screen.now.keep());
  expect(screen.now.kept).toBe(true);
  expect(scoreTracks(screen.now.standing!).find((t) => t.name === "Sketch")).toEqual(scoreTracks(screen.score)[0]);
  expect(scoreTracks(screen.now.standing!).find((t) => t.name === "Flute")!.notes.map((n) => n.start)).toEqual([4]);
  act(() => screen.now.download());
  expect(blobs).toHaveLength(2);
  for (const blob of blobs) {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(file.result as ArrayBuffer); file.onerror = reject; file.readAsArrayBuffer(blob); });
    const files = unzipSync(new Uint8Array(bytes));
    const exported = parseScore(strFromU8(files["score.musicxml"]!));
    expect(exported.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "7a", "7b", "2", "10", "Coda"]);
    expect(scoreTracks(exported).find((t) => t.name === "Sketch")).toEqual(scoreTracks(screen.score)[0]);
    expect(scoreTracks(exported).find((t) => t.name === "Flute")!.notes.map((n) => n.start)).toEqual([4]);
    const midi = readMidi(files["all-parts.mid"]!);
    expect(Math.max(...midi.tracks.flatMap((track) => track.notes.map((n) => n.tick)))).toBe(20 * midi.ppq);
  }
});

it("rejects invalid or ambiguous ranges and excludes new parts already left out", async () => {
  const screen = await setup(["1", "7a", "7b", "2", "10", "7a"]);
  for (const [from, to] of [["missing", "10"], ["1", "missing"], ["10", "7b"], ["7a", "7a"], ["1", "10"], ["2", "2"]]) {
    expect(screen.now.newInRange(from!, to!)).toEqual([]);
    act(() => screen.now.toggleRange(from!, to!));
    expect(screen.now.offBars).toEqual([]);
  }
  expect(screen.now.newInRange("7b", "10")).toEqual(["7b", "10"]);
  act(() => screen.now.togglePart("Flute"));
  expect(screen.now.newInRange("7b", "10")).toEqual([]);
  act(() => screen.now.toggleRange("7b", "10"));
  expect(screen.now.offBars).toEqual([]);
});

it("can restore added tail bars after muting them removes their notes from the overview", async () => {
  const screen = await setup(["1", "2"], ["3", "4"], 2);
  expect(screen.now.overview!.bars.map((bar) => bar.number)).toEqual(["1", "2", "3", "4"]);
  act(() => screen.now.toggleRange("3", "4"));
  expect(screen.now.overview!.bars.map((bar) => bar.number)).toEqual(["1", "2"]);
  expect(screen.now.offBars).toEqual(["3", "4"]);
  expect(screen.now.newInRange("3", "4")).toEqual(["3", "4"]);
  act(() => screen.now.toggleRange("3", "4"));
  expect(screen.now.offBars).toEqual([]);
  expect(screen.now.overview!.bars.map((bar) => bar.number)).toEqual(["1", "2", "3", "4"]);
});
