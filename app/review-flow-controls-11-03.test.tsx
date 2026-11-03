// @vitest-environment jsdom
// Original synthetic contract score and its reading/plans. Every response is local, with no paid requests.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { RecomposePlan } from "../server/shapes";
import { ArrangePanel } from "./ArrangePanel";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/contract-score.musicxml", "utf8");
const score = parseScore(xmlText);
const loaded = { fileName: "contract-score.musicxml", xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync("test-fixtures/contract-arrangement.json", "utf8"));
const plans = saved.plan.answer.options;
const composed: RecomposePlan = { ...plans[0], name: "A new piece from the opening", motif: { from: "1", to: "2", what: "The opening" }, fifths: 0, time: "4/4", qpm: 90,
  why: [{ from: "1", to: "8", what: "The opening grows", principle: "Develop the source", variation: "A sequence", chords: "C | G" }] };
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function setup(partial = false) {
  const calls: { shape: string; input: any }[] = [];
  let failed = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const shape = url.split("/").pop()!;
    const input = JSON.parse(init.body as string).input;
    calls.push({ shape, input });
    // The third arrange call: after both first-section previews, the first of the chosen plan's rest (Claude, Create previews both).
    if (partial && shape === "arrange" && !failed && calls.filter(c => c.shape === "arrange").length === 3) {
      failed = true;
      return new Response(JSON.stringify({ status: "fallback", reason: "timeout" }));
    }
    const planAnswer = partial ? { options: plans.map((p: any) => ({ ...p, why: p.why.map((w: any) => ({ ...w, chords: "C | G" })) })) } : saved.plan.answer;
    const answer = shape === "read_piece" ? saved.read.answer : shape === "plan_options" ? planAnswer : shape === "plan_recompose" ? { options: [composed, { ...composed, name: "A second new piece" }] }
      : shape === "write_theme" ? { lines: [{ bar: "1", role: "tune", events: "C5@0+1" }] } : shape === "arrange" ? { adds: [{ part: "Viola", bar: input.window?.from ?? "1", events: "C4@0+1", dyn: "mf" }], doubles: [] } : null;
    return new Response(JSON.stringify(answer ? { status: "ok", answer } : { status: "fallback", reason: "no-key" }));
  });
  let arranged!: Arranged;
  function Host() { arranged = useArrange(loaded, part, range, null); return <ArrangePanel arranged={arranged} busy={false} />; }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { host, calls, get arranged() { return arranged; } };
}
const press = async (host: Element, name: string) => {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name);
  if (!button) throw Error(`Missing button ${name}`);
  await act(async () => button.click());
};
async function direction(host: Element) {
  await press(host, "Read my score");
  await press(host, "Confirm tracks");
  for (let i = 0; i < 12 && [...host.querySelectorAll("button")].some(b => b.textContent?.trim() === "Skip this"); i++) await press(host, "Skip this");
  await press(host, "Next: Setup");
  // Setup holds the players too now. Keeping the tracks as they are is its checkbox (Claude, Create).
  const keep = [...host.querySelectorAll<HTMLInputElement>(".arrange-check input")].find(i => i.parentElement?.textContent?.includes("Keep my own tracks"))!;
  if (!keep.checked) await act(async () => keep.click());
}
/** Create, and wait for everything it runs by itself: plans, and the first section of each. */
async function create(screen: { host: Element; arranged: Arranged }) {
  await press(screen.host, "Create");
  await vi.waitFor(async () => {
    await act(async () => {});
    const o = screen.arranged.options;
    const r = screen.arranged.recompose;
    expect(o.status === "asking" || r.status === "asking" || (o.status === "ready" && Object.values(o.notes).some(n => n.status === "asking"))).toBe(false);
  });
}
async function mode(host: Element, name: "Arrange" | "Recompose") {
  const button = [...host.querySelectorAll("button")].find(b => b.querySelector("strong")?.textContent === name)!;
  await act(async () => button.click());
}
async function choose(host: Element, name: string) {
  const item = [...host.querySelectorAll(".arrange-list > li")].find(li => li.querySelector("strong")?.textContent === name)!;
  if (!item) throw Error(`Missing plan ${name}`);
  const button = [...item.querySelectorAll("button")].find(b => ["Write this one", "Write the rest of this one"].includes(b.textContent?.trim() ?? ""))!;
  await act(async () => button.click());
}

it("creates plans with only a first-section preview of each, and writes the rest of the second selected arrangement", async () => {
  const screen = setup();
  await direction(screen.host);
  await create(screen);
  // One first section per plan, and nothing more until one is chosen (Claude: Create previews both, Ryu 11-03).
  const previews = screen.calls.filter(c => c.shape === "arrange");
  expect(previews.map(c => c.input.chosen.name).sort()).toEqual([plans[0].name, plans[1].name].sort());
  expect(new Set(previews.map(c => c.input.window?.from)).size).toBe(1);
  const before = screen.calls.length;
  await choose(screen.host, plans[1].name);
  expect(screen.calls.slice(before).filter(c => c.shape === "arrange").every(c => c.input.chosen.name === plans[1].name)).toBe(true);
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Write");
  expect(screen.host.textContent).not.toContain("Download MIDI");
  const disclosure = [...screen.host.querySelectorAll("summary")].find(s => s.textContent?.startsWith("Fix bars"))!;
  await act(async () => disclosure.click());
  const fix = screen.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="What to change in these bars"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(fix, "A thinner answer");
    fix.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press(screen.host, "Rewrite these bars");
  expect([...screen.calls].reverse().find(c => c.shape === "arrange" && c.input.fix)?.input.chosen.name).toBe(plans[1].name);
  await press(screen.host, "Next: Export");
  expect(screen.host.textContent).toContain("Download MIDI");
});

it("can keep an ordinary arrangement and generate another plan from Setup", async () => {
  const screen = setup();
  await direction(screen.host);
  await create(screen);
  await choose(screen.host, plans[0].name);
  await press(screen.host, "Next: Export");
  await press(screen.host, "Build on this arrangement");
  expect(screen.arranged.kept).not.toBeNull();
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Setup");
  await create(screen);
  expect([...screen.host.querySelectorAll("button")].some(b => ["Write this one", "Write the rest of this one", "See what's written"].includes(b.textContent?.trim() ?? ""))).toBe(true);
});

it("writes the selected arrangement after the composer first explored Recompose plans", async () => {
  const screen = setup();
  await direction(screen.host);
  await mode(screen.host, "Recompose");
  await create(screen);
  // The mode is chosen on Setup.
  await press(screen.host, "Setup");
  await mode(screen.host, "Arrange");
  await create(screen);
  const before = screen.calls.length;
  await choose(screen.host, plans[1].name);
  const writes = screen.calls.slice(before).filter(c => c.shape === "arrange" || c.shape === "write_theme");
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.every(c => c.shape === "arrange" && c.input.chosen.name === plans[1].name)).toBe(true);
});

it("offers newly generated plans after keeping a recomposition and choosing to go again", async () => {
  const screen = setup();
  await direction(screen.host);
  await mode(screen.host, "Recompose");
  await create(screen);
  await choose(screen.host, composed.name);
  await press(screen.host, "Next: Export");
  await press(screen.host, "Build on this arrangement");
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Setup");
  // The kept recomposition is the composer's score now, so Setup starts fresh from it (Claude, review F2).
  await create(screen);
  expect(screen.arranged.recompose.status).toBe("ready");
  expect([...screen.host.querySelectorAll("button")].some(b => b.textContent?.trim() === "Write this one")).toBe(true);
});

it("carryforward M4: Pick's rewrite-with-chords rewrites the changed completed stretch too", async () => {
  const screen = setup(true);
  await direction(screen.host);
  await create(screen);
  await choose(screen.host, plans[0].name);
  const held = screen.arranged.options;
  if (held.status !== "ready" || held.notes[0]?.status !== "ready") throw Error("No partial result");
  expect(held.notes[0].missing?.length).toBeGreaterThan(0);
  await press(screen.host, "Pick");
  const chord = screen.host.querySelector<HTMLInputElement>(".arrange-chord-edit input")!;
  const changedBar = plans[0].why[0].from;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(chord, "Am | F");
    chord.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const count = screen.calls.length;
  await press(screen.host, "Write again with these chords");
  const rewritten = screen.calls.slice(count).filter(c => c.shape === "arrange");
  expect(rewritten.some(c => c.input.window.from === changedBar)).toBe(true);
});
