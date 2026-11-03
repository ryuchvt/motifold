// @vitest-environment jsdom
// Real hook and controls, synthetic score and local transport. No Worker or provider.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { RecomposePlan, WriteInput } from "../server/shapes";
import { ArrangePanel } from "./ArrangePanel";
import { setTransport, type SparkReply } from "./spark";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: 8 }, (_, k) => `<measure number="${k+1}">${k ? "" : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'}<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join("")}</part></score-partwise>`;
const score = parseScore(xmlText), loaded = { fileName: "synthetic.musicxml", score, xmlText };
const okay = (answer: unknown): SparkReply => ({ status: "ok", cached: false, answer });
const valid = { lines: [{ role: "tune", bar: "1", events: "G5@0+1 A5@1+1" }, { role: "bass", bar: "1", events: "C3@0+4" }] };
const plans: RecomposePlan[] = ["First plan", "Second plan"].map(name => ({ name, idea: `Original ${name}`, motif: { from: "1", to: "2", what: "Original opening" }, fifths: 0, time: "4/4", qpm: 80, why: [{ from: "1", to: "8", what: "Develop the opening", principle: "Recognisable tune", variation: "Develop the motif" }] }));
let unmount = () => {};
afterEach(() => { act(unmount); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup(panel = false) {
  const calls: { shape: string; input: any }[] = [];
  let theme = async (): Promise<SparkReply> => okay(valid);
  const fetch = vi.fn(() => { throw Error("HTTP is forbidden in this test"); });
  vi.stubGlobal("fetch", fetch);
  setTransport(async (shape, input: any) => {
    calls.push({ shape, input });
    if (shape === "write_theme") return theme();
    if (shape === "plan_recompose") return okay({ options: plans });
    if (shape === "read_piece") return okay({ summary: "Synthetic", sections: [], roles: [], questions: [], missing: [], thin: [], structures: [] });
    if (shape === "study_score") return okay({ sections: [], harmony: [], moments: [] });
    if (shape === "plan_options") return okay({ options: [{ name: "Earlier arrangement", idea: "Retain this", why: [{ from: "1", to: "8", what: "Support", principle: "Keep source" }] }] });
    if (shape === "arrange") return okay({ adds: [{ part: "Flute", bar: input.window.from, events: "G5@0+1", dyn: "mf" }], doubles: [] });
    throw Error(`Unexpected local shape ${shape}`);
  });
  let now!: Arranged;
  function Host() { now = useArrange(loaded, score.parts[0]!, { from: 0, to: 7 }, null); return panel ? <ArrangePanel arranged={now} busy={false} initialSetup={{ intent: "recompose" }} /> : null; }
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  act(() => root.render(<Host/>)); unmount = () => root.unmount();
  return { get now() { return now; }, calls, host, fetch, theme: (next: () => Promise<SparkReply>) => { theme = next; } };
}
async function previous(x: ReturnType<typeof setup>) {
  await act(() => x.now.askPiece());
  await act(() => x.now.askOptions("Earlier task", 0, "inside"));
  await act(() => x.now.askNotes(0));
  expect(x.now.options.status === "ready" && x.now.options.notes[0]?.status).toBe("ready");
}
async function prepare(x: ReturnType<typeof setup>) {
  await act(() => x.now.askRecompose("Original direction", 8, ["Flute", "Cello"], 2));
}
const press = async (host: Element, name: string) => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name);
  if (!button) throw Error(`Missing button ${name}`);
  await act(async () => button.click());
};

it.each(["timeout", "network", "busy", "rehearsal-stopped"])("%s theme stops before accompaniment and retains the valid score and original option", async reason => {
  const x = setup(); await previous(x); await prepare(x);
  const before = x.now.options, shown = x.now.shown?.xmlText, standing = x.now.standing, batch = x.now.recompose;
  const at = x.calls.length;
  x.theme(async () => ({ status: "fallback", reason }));
  await act(() => x.now.writeRecomposed(1));
  expect(x.calls.slice(at).map(c => c.shape)).toEqual(["write_theme"]);
  expect(x.calls.at(-1)!.input).toMatchObject({ ask: "Original direction", chosen: plans[1], freedom: 2, moreBars: 8 });
  expect(x.now.themeWrite).toMatchObject({ status: "unavailable", index: 1, plan: plans[1], reason });
  expect(x.now.themeReason).toBe(reason);
  expect(x.now.options).toBe(before); expect(x.now.recompose).toBe(batch);
  expect(x.now.standing).toBe(standing); expect(x.now.shown?.xmlText).toBe(shown); expect(x.now.recomposed).toBeNull();
  expect(x.fetch).not.toHaveBeenCalled();
});

it.each([
  null, {}, { lines: [] }, { lines: [{ role: "bass", bar: "1", events: "C3@0+1" }] },
  { lines: [{ role: "tune", bar: "1", events: "" }] },
  { lines: [{ role: "tune", bar: "1", events: "not-a-note@0+1" }] },
  { lines: [{ role: "tune", bar: "9", events: "C5@0+1" }] },
  { lines: [{ role: "tune", bar: "1", events: "C5@3+2" }] },
  { lines: [{ role: "tune", bar: "1", events: "C5@3.9+0.15" }] },
  { lines: [{ role: "tune", bar: "1", events: "A9@0+1" }] },
  { lines: [{ role: "tune", bar: "1", events: "C5,E5@0+1" }] },
  { lines: [{ role: "tune", bar: "1", events: "C5@0+2 D5@1+1" }] },
  { lines: [{ role: "tune", bar: "1", events: "C5@0+1" }, { role: "unknown", bar: "1", events: "C3@0+1" }] },
])("an empty or invalid theme never authorises accompaniment: %j", async answer => {
  const x = setup(); await prepare(x); x.theme(async () => okay(answer));
  await act(() => x.now.writeRecomposed(0));
  expect(x.calls.map(c => c.shape)).toEqual(["plan_recompose", "write_theme"]);
  expect(x.now.themeReason).toBe("malformed"); expect(x.now.options.status).toBe("none");
  expect(x.now.standing).toBe(score); expect(x.now.recomposed).toBeNull();
});

it("a pending theme keeps the earlier result and cannot dispatch until a valid answer arrives", async () => {
  const x = setup(); await previous(x); await prepare(x);
  const before = x.now.options, shown = x.now.shown?.xmlText;
  let release!: (reply: SparkReply) => void;
  x.theme(() => new Promise(done => { release = done; }));
  let pending!: Promise<void>; act(() => { pending = x.now.writeRecomposed(1); });
  expect(x.now.themeWrite?.status).toBe("asking"); expect(x.now.options).toBe(before); expect(x.now.shown?.xmlText).toBe(shown);
  expect(x.calls.at(-1)!.shape).toBe("write_theme");
  await act(async () => { release(okay(valid)); await pending; });
  const writes = x.calls.filter(c => c.shape === "arrange").slice(1);
  expect(writes.length).toBeGreaterThan(0);
  for (const { input } of writes) {
    expect(input).toMatchObject({ chosen: plans[1], ask: "Original direction", freedom: 2, instruments: ["Flute", "Cello"] });
    expect((input as WriteInput).seed?.theme).toContain("G5@0+1 A5@1+1");
  }
  expect(x.now.themeWrite).toBeNull(); expect(x.now.themeReason).toBeNull();
  expect(x.now.recomposed?.plan).toEqual(plans[1]);
});

it("the visible recovery waits for a click and retries the same selected melody and original task", async () => {
  const x = setup(true); await previous(x); await prepare(x);
  await press(x.host, "Pick");
  x.theme(async () => ({ status: "fallback", reason: "timeout" }));
  const buttons = x.host.querySelectorAll<HTMLButtonElement>(".arrange-pick");
  await act(async () => buttons[1]!.click());
  expect(x.host.textContent).toContain("The new melody did not finish");
  expect(x.host.textContent).toContain("No accompaniment was requested");
  expect(x.host.textContent).toContain("didn't finish in time");
  expect(x.host.textContent).toContain("sends a separate request and may use credit");
  const at = x.calls.length;
  await act(async () => {}); expect(x.calls).toHaveLength(at);
  x.theme(async () => okay(valid)); await press(x.host, "Try melody again");
  expect(x.calls.slice(at).map(c => c.shape)).toEqual(["write_theme", "arrange"]);
  expect(x.calls[at]!.input).toMatchObject({ chosen: plans[1], ask: "Original direction" });
  expect(x.calls.at(-1)!.input.chosen).toEqual(plans[1]);
  expect(x.host.textContent).not.toContain("The new melody did not finish");
  expect(x.fetch).not.toHaveBeenCalled();
});

it.each(["new plan batch", "return to sketch", "different selected plan"])("a late old theme cannot write after %s", async action => {
  const x = setup(); await prepare(x);
  let release!: (reply: SparkReply) => void;
  x.theme(() => new Promise(done => { release = done; }));
  let pending!: Promise<void>; act(() => { pending = x.now.writeRecomposed(1); });
  if (action === "new plan batch") await act(() => x.now.askRecompose("New task", 8, ["Cello"]));
  else if (action === "return to sketch") act(() => x.now.startAgain());
  else { x.theme(async () => okay(valid)); await act(() => x.now.writeRecomposed(0)); }
  const at = x.calls.length, before = x.now.options;
  await act(async () => { release(okay(valid)); await pending; });
  expect(x.calls).toHaveLength(at); expect(x.now.options).toBe(before); expect(x.now.themeWrite).toBeNull();
  if (action === "different selected plan") expect(x.now.recomposed?.plan).toEqual(plans[0]);
});
