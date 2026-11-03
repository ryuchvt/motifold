// @vitest-environment jsdom
// Original synthetic contract score; every response is local and no model is contacted.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { arrange, type ArrangeInput, type RecomposePlan, type WriteInput } from "../server/shapes";
import { writingWindows } from "./arrange";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/contract-score.musicxml", "utf8");
const score = parseScore(xmlText);
const part = score.parts[0]!;
const loaded = { fileName: "contract-score.musicxml", xmlText, score };
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync("test-fixtures/contract-arrangement.json", "utf8"));
const reply = (status: string, extra: object = {}) => new Response(JSON.stringify({ status, ...extra }));
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function mount() {
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { get now() { return current; } };
}

function partialScore() {
  const calls: WriteInput[] = [];
  let windows: { from: string; to: string }[] = [];
  let failedMiddle = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const raw = JSON.parse(init.body as string).input;
    if (url.endsWith("read_piece")) return reply("ok", { answer: saved.read.answer });
    if (url.endsWith("plan_options")) {
      const bars = (raw as ArrangeInput).written.map(w => w.bar);
      const plan = { name: "A direct answer", idea: "Flute answers", why: [{ from: bars[0]!, to: bars.at(-1)!, what: "Flute answers", principle: "Use the tune", chords: "C | G" }] };
      windows = writingWindows(plan.why, bars);
      return reply("ok", { answer: { options: [plan] } });
    }
    if (!url.endsWith("arrange")) throw Error("Unexpected request");
    const input = arrange.parse(raw) as WriteInput;
    expect(input).not.toBeNull();
    calls.push(input);
    if (input.fix) return reply("ok", { answer: { adds: [], doubles: [] } });
    if (input.window!.from === windows[1]!.from && !failedMiddle) {
      failedMiddle = true;
      return reply("fallback", { reason: "timeout" });
    }
    const bars = input.written.map(w => w.bar);
    const inWindow = bars.slice(bars.indexOf(input.window!.from), bars.indexOf(input.window!.to) + 1);
    const note = input.chosen.why[0]!.chords?.startsWith("F") ? "F5" : "C5";
    return reply("ok", { answer: { adds: inWindow.map(bar => ({ part: "Flute", bar, events: `${note}@0+1`, dyn: "mf" })), doubles: [] } });
  });
  const mounted = mount();
  return { ...mounted, get now() { return mounted.now; }, calls, get windows() { return windows; } };
}

it("Write again with these chords also rewrites completed bars of a partial result", async () => {
  const screen = partialScore();
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions("", 0, "inside"));
  await act(() => screen.now.askNotes(0));
  let options = screen.now.options;
  if (options.status !== "ready" || options.notes[0]?.status !== "ready") throw Error("No partial score");
  expect(options.notes[0].missing).toEqual([screen.windows[1]]);
  expect(options.notes[0].adds.find(a => a.bar === screen.windows[0]!.from)!.events).toBe("C5@0+1");
  act(() => screen.now.setChords(0, 0, "F | C"));
  // This is the handler of the UI's explicit "Write again with these chords" button.
  await act(() => screen.now.askNotes(0));
  options = screen.now.options;
  if (options.status !== "ready" || options.notes[0]?.status !== "ready") throw Error("No rewritten score");
  expect(options.plans[0]!.why[0]).toMatchObject({ chords: "F | C", yours: true });
  expect(options.notes[0].adds.find(a => a.bar === screen.windows[0]!.from)!.events, `new chords were acknowledged and changed=${String(options.notes[0].changed)}, but a completed old-chord bar was retained`).toBe("F5@0+1");
});

it("resuming a missing section preserves a successful fix that makes one of its bars silent", async () => {
  const screen = partialScore();
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions("", 0, "inside"));
  await act(() => screen.now.askNotes(0));
  const bar = screen.windows[1]!.from;
  await act(() => screen.now.askFix(0, bar, bar, "Leave the new accompaniment silent in this bar"));
  expect(screen.calls.at(-1)!.fix?.ask).toBe("Leave the new accompaniment silent in this bar");
  await act(() => screen.now.askNotes(0));
  const options = screen.now.options;
  if (options.status !== "ready" || options.notes[0]?.status !== "ready") throw Error("No resumed score");
  expect(options.notes[0].adds.filter(a => a.bar === bar), "the paid accepted silent fix is overwritten by the retry").toEqual([]);
});

it("a silent fix inside a missing section leaves both unfinished sides to write", async () => {
  const screen = partialScore();
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions("", 0, "inside"));
  await act(() => screen.now.askNotes(0));
  const before = screen.now.options;
  if (before.status !== "ready") throw Error("No plans");
  const bars = before.input.written.map(w => w.bar);
  const first = bars.indexOf(screen.windows[1]!.from);
  const bar = bars[first + 2]!;
  await act(() => screen.now.askFix(0, bar, bar, "Leave the new accompaniment silent in this bar"));
  const fixed = screen.now.options;
  if (fixed.status !== "ready" || fixed.notes[0]?.status !== "ready") throw Error("No fixed score");
  expect(fixed.notes[0].missing).toEqual([
    {from:bars[first]!,to:bars[first + 1]!},
    {from:bars[first + 3]!,to:screen.windows[1]!.to},
  ]);
  await act(() => screen.now.askNotes(0));
  const done = screen.now.options;
  if (done.status !== "ready" || done.notes[0]?.status !== "ready") throw Error("No resumed score");
  expect(done.notes[0].missing).toBeUndefined();
  expect(done.notes[0].adds.filter(a => a.bar === bar)).toEqual([]);
});

it("recomposition retains the source motif and composed tune when its first section fails before any notes exist", async () => {
  const writes: WriteInput[] = [];
  let stopped = false;
  const plan: RecomposePlan = { name: "New piece", idea: "Grows from the opening", why: [{ from: "1", to: "8", what: "First", principle: "Grow", variation: "Keep" }, { from: "9", to: "16", what: "Second", principle: "Answer", variation: "Repeat" }], motif: { from: "1", to: "1", what: "The opening rises" }, fifths: 0, time: "4/4", qpm: 80 };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const raw = JSON.parse(init.body as string).input;
    if (url.endsWith("plan_recompose")) return reply("ok", { answer: { options: [plan] } });
    if (url.endsWith("write_theme")) return reply("ok", { answer: { lines: [{ bar: "1", role: "tune", events: "G5@0+1" }] } });
    if (!url.endsWith("arrange")) throw Error("Unexpected request");
    const input = arrange.parse(raw) as WriteInput;
    expect(input).not.toBeNull();
    writes.push(input);
    if (!stopped) { stopped = true; return reply("fallback", { reason: "empty" }); }
    return reply("ok", { answer: { adds: [{ part: "Flute", bar: input.window!.from, events: "G5@0+1", dyn: "mf" }], doubles: [] } });
  });
  const screen = mount();
  await act(() => screen.now.askRecompose("", 16, ["Flute", "Cello"]));
  await act(() => screen.now.writeRecomposed(0));
  expect(writes[0]!.seed?.tune).toContain("Bar 1:");
  expect(writes[0]!.seed?.theme).toContain("G5@0+1");
  await act(() => screen.now.askNotes(0));
  expect(writes[1]!.seed, "the empty-score retry must still carry a source seed").toBeDefined();
  expect(writes[1]!.seed, "the retry is writing on an empty new score and still needs the original material").toEqual(writes[0]!.seed);
});
