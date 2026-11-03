// @vitest-environment jsdom
// Real arrangement hook, synthetic source, and local replies only.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { arrange, type RecomposePlan, type WriteAnswer, type WriteInput } from "../server/shapes";
import { fixCurrent } from "./fixContext";
import { setTransport, type SparkReply } from "./spark";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = `<score-partwise><part-list><score-part id="P1"><part-name>Viola</part-name></score-part></part-list><part id="P1">${Array.from({ length: 8 }, (_, index) => `<measure number="${index+1}">${index ? "" : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'}<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join("")}</part></score-partwise>`;
const score = parseScore(xmlText), loaded = { xmlText, score, fileName: "synthetic.musicxml" };
const okay = (answer: unknown): SparkReply => ({ status: "ok", cached: false, answer });
const why = [{ from: "1", to: "8", what: "Opening", principle: "Develop", variation: "Opening grows" }, { from: "9", to: "16", what: "Answer", principle: "Return", variation: "Opening returns" }];
const plans: RecomposePlan[] = ["Plan A", "Plan B"].map(name => ({ name, idea: "The original idea", why, motif: { from: "1", to: "2", what: "The original rising gesture" }, fifths: 0, time: "4/4", qpm: 80 }));
const theme = [{ role: "tune", bar: "1", events: "G5@0+1" }, { role: "tune", bar: "9", events: "D5@0+1" }, { role: "bass", bar: "10", events: "C3@0+4" }, { role: "tune", bar: "16", events: "F5@0+1" }];
const addsAt = (bar: string, fixed = false): WriteAnswer["adds"] => [
  { part: "Flute", bar, events: fixed ? "G4@0.5+1 A4@2+1" : "G5@0.5+1 A5@2+1", dyn: "mp<f", role: "countermelody", art: "staccato" },
  { part: "Cello", bar, events: "C3@0+4", dyn: "pp", role: "bass", art: "pizz." },
];
let unmount = () => {};
afterEach(() => { act(unmount); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup() {
  const writes: WriteInput[] = [], calls: string[] = [];
  let fixReason: string | null = null;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No HTTP allowed"); }));
  setTransport(async (shape, raw: any) => {
    calls.push(shape);
    if (shape === "plan_recompose") return okay({ options: plans });
    if (shape === "write_theme") return okay({ lines: theme });
    if (shape === "plan_options") return okay({ options: [{ name: "Original arrangement", idea: "Keep source", why: raw.moreBars ? why : why.slice(0, 1) }] });
    if (shape !== "arrange") throw Error(`Unexpected shape ${shape}`);
    const parsed = arrange.parse(raw);
    expect(parsed).not.toBeNull();
    writes.push(raw);
    if (raw.fix && fixReason) return { status: "fallback", reason: fixReason };
    const from = Number(raw.window.from), to = Number(raw.window.to);
    return okay({ adds: Array.from({ length: to-from+1 }, (_, index) => addsAt(String(from+index), !!raw.fix)).flat(), doubles: [] });
  });
  let now!: Arranged;
  function Host() { now = useArrange(loaded, score.parts[0]!, { from: 0, to: 7 }, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host/>)); unmount = () => root.unmount();
  return { get now() { return now; }, writes, calls, refuseFix: (reason: string) => { fixReason = reason; } };
}
function held(x: ReturnType<typeof setup>) {
  const state = x.now.options;
  if (state.status !== "ready" || state.notes[0]?.status !== "ready") throw Error("No complete notes");
  return { state, notes: state.notes[0] };
}

it("keeps the original selected recomposition, task, motif and windowed theme in one explicit fix, retaining unrelated notes", async () => {
  const x = setup();
  await act(() => x.now.askRecompose("Original hopeful direction", 16, ["Flute", "Cello"], 2));
  await act(() => x.now.writeRecomposed(1));
  const before = held(x), at = x.writes.length, callCount = x.calls.length;
  const unrelated = before.notes.adds.filter(add => !["9", "10"].includes(add.bar));
  await act(async () => {});
  expect(x.calls).toHaveLength(callCount);
  await act(() => x.now.askFix(0, "9", "10", "Keep pitch classes and expression. Move only the flagged notes by an octave."));
  expect(x.writes).toHaveLength(at+1);
  const fix = x.writes.at(-1)!;
  expect(fix).toMatchObject({ ask: "Original hopeful direction", chosen: plans[1], freedom: 2, instruments: ["Flute", "Cello"], window: { from: "9", to: "10" } });
  expect(fix.chosen).toBe(before.state.plans[0]);
  expect(fix.seed?.tune).toBe(before.notes.again!.seed!.tune);
  expect(fix.seed?.tune).toContain("Bar 1:");
  expect(fix.seed?.motif).toBe(before.notes.again!.seed!.motif);
  expect(fix.seed?.motif).toContain("The original rising gesture");
  expect(fix.seed?.theme).toBe("Bar 9 tune: D5@0+1 / Bar 10 bass: C3@0+4");
  expect(fix.seed?.theme).not.toContain("Bar 1 "); expect(fix.seed?.theme).not.toContain("Bar 16 ");
  expect(fix.fix?.current).toBe(fixCurrent(before.notes.adds, ["9", "10"]));
  expect(fix.fix?.current).toContain('Flute, bar 9: G5@0.5+1 A5@2+1 {"dyn":"mp<f","role":"countermelody","art":"staccato"}');
  expect(fix.fix?.current).toContain('Cello, bar 10: C3@0+4 {"dyn":"pp","role":"bass","art":"pizz."}');
  expect(fix.fix?.current).not.toContain("bar 8:"); expect(fix.fix?.current).not.toContain("bar 11:");
  const after = held(x);
  expect(after.notes.adds.filter(add => !["9", "10"].includes(add.bar))).toEqual(unrelated);
  expect(after.notes.adds.filter(add => ["9", "10"].includes(add.bar))).toEqual([...addsAt("9", true), ...addsAt("10", true)]);
  expect(after.notes.again).toBe(before.notes.again);
  expect(after.state.plans).toBe(before.state.plans); expect(after.state.input).toBe(before.state.input);
  await act(async () => {}); expect(x.writes).toHaveLength(at+1);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["arrange", "expand"] as const)("keeps %s fixes seed-free with the original intent/input/choice/window, while including expression", async intent => {
  const x = setup(); await act(() => x.now.askOptions("Original source task", intent === "expand" ? 8 : 0, intent === "expand" ? "both" : "inside", intent));
  await act(() => x.now.askNotes(0));
  const before = held(x), at = x.writes.length;
  await act(() => x.now.askFix(0, "2", "2", "Only a technical octave correction"));
  const fix = x.writes.at(-1)!;
  expect(x.writes).toHaveLength(at+1);
  expect(fix).toMatchObject({ ...before.state.input, chosen: before.state.plans[0], window: { from: "2", to: "2" } });
  expect(fix.intent).toBe(intent); expect(fix.seed).toBeUndefined(); expect("seed" in fix).toBe(false);
  expect(fix.fix?.current).toContain('"dyn":"mp<f","role":"countermelody","art":"staccato"');
  expect(held(x).notes.adds.filter(add => add.bar !== "2")).toEqual(before.notes.adds.filter(add => add.bar !== "2"));
  expect(fetch).not.toHaveBeenCalled();
});

it("retains every existing note and seed after a refused fix and makes no automatic follow-up", async () => {
  const x = setup(); await act(() => x.now.askRecompose("Original task", 16, ["Flute", "Cello"])); await act(() => x.now.writeRecomposed(1));
  const before = held(x), at = x.calls.length; x.refuseFix("timeout");
  await act(() => x.now.askFix(0, "9", "9", "Only the range correction"));
  expect(x.calls.slice(at)).toEqual(["arrange"]); expect(x.now.fixingReason).toBe("timeout");
  expect(held(x).notes).toBe(before.notes); expect(held(x).state.input).toBe(before.state.input);
  await act(async () => {}); expect(x.calls).toHaveLength(at+1); expect(fetch).not.toHaveBeenCalled();
});

it("formats exact current expression deterministically, keeps absent metadata explicit, and bounds the context", () => {
  const raw: WriteAnswer["adds"] = [{ part: "Flute", bar: "1", events: "G5@0+1", dyn: "mf", role: "melody", art: "" }, { part: "Cello", bar: "2", events: "C3@0+4" }];
  const original = JSON.stringify(raw);
  expect(fixCurrent(raw, ["2"])).toBe('Cello, bar 2: C3@0+4 {"dyn":null,"role":null,"art":null}');
  expect(fixCurrent(raw, ["1"])).toContain('"art":""'); expect(fixCurrent(raw, ["9"])).toBe("nothing yet");
  const many = Array.from({ length: 500 }, () => raw[0]!);
  expect(fixCurrent(many, ["1"])).toHaveLength(8000); expect(fixCurrent(many, ["1"])).toBe(fixCurrent(many, ["1"]));
  expect(JSON.stringify(raw)).toBe(original);
});
