// @vitest-environment jsdom
// Real bundled Arioso and its reading/plans. Every response is local, with no paid requests.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { RecomposePlan } from "../server/shapes";
import { ArrangePanel } from "./ArrangePanel";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/arioso.musicxml", "utf8");
const score = parseScore(xmlText);
const loaded = { fileName: "arioso.musicxml", xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync("test-fixtures/arioso-arrangement.json", "utf8"));
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
    if (partial && shape === "arrange" && !failed && calls.filter(c => c.shape === "arrange").length === 2) {
      failed = true;
      return new Response(JSON.stringify({ status: "fallback", reason: "timeout" }));
    }
    const planAnswer = partial ? { options: plans.map((p: any) => ({ ...p, why: p.why.map((w: any) => ({ ...w, chords: "C | G" })) })) } : saved.plan.answer;
    const answer = shape === "read_piece" ? saved.read.answer : shape === "plan_options" ? planAnswer : shape === "plan_recompose" ? { options: [composed, { ...composed, name: "A second new piece" }] }
      : shape === "write_theme" ? { lines: [] } : shape === "arrange" ? { adds: [{ part: "Viola", bar: input.window?.from ?? "1", events: "C4@0+1", dyn: "mf" }], doubles: [] } : null;
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
  await press(host, "Looks right");
  for (let i = 0; i < 12 && [...host.querySelectorAll("button")].some(b => b.textContent?.trim() === "Skip this"); i++) await press(host, "Skip this");
  await press(host, "Next: Players");
  await press(host, "Keep my tracks as they are");
}
async function mode(host: Element, name: "Arrange" | "Recompose") {
  const button = [...host.querySelectorAll("button")].find(b => b.querySelector("strong")?.textContent === name)!;
  await act(async () => button.click());
}
async function choose(host: Element, name: string) {
  const item = [...host.querySelectorAll(".arrange-list > li")].find(li => li.querySelector("strong")?.textContent === name)!;
  if (!item) throw Error(`Missing plan ${name}`);
  const button = [...item.querySelectorAll("button")].find(b => b.textContent?.trim() === "Write this one")!;
  await act(async () => button.click());
}

it("generates plans without writing and writes the second selected arrangement", async () => {
  const screen = setup();
  await direction(screen.host);
  await press(screen.host, "Generate");
  expect(screen.calls.some(c => c.shape === "arrange" || c.shape === "write_theme")).toBe(false);
  await choose(screen.host, plans[1].name);
  expect(screen.calls.filter(c => c.shape === "arrange").every(c => c.input.chosen.name === plans[1].name)).toBe(true);
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

it("can keep an ordinary arrangement and generate another plan from Direction", async () => {
  const screen = setup();
  await direction(screen.host);
  await press(screen.host, "Generate");
  await choose(screen.host, plans[0].name);
  await press(screen.host, "Next: Export");
  await press(screen.host, "Make this my score and go again");
  expect(screen.arranged.kept).not.toBeNull();
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Direction");
  await press(screen.host, "Generate");
  expect([...screen.host.querySelectorAll("button")].some(b => b.textContent?.trim() === "Write this one")).toBe(true);
});

it("writes the selected arrangement after the composer first explored Recompose plans", async () => {
  const screen = setup();
  await direction(screen.host);
  await mode(screen.host, "Recompose");
  await press(screen.host, "Generate");
  await mode(screen.host, "Arrange");
  await press(screen.host, "Think of two more");
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
  await press(screen.host, "Generate");
  await choose(screen.host, composed.name);
  await press(screen.host, "Next: Export");
  await press(screen.host, "Make this my score and go again");
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Direction");
  // The kept recomposition is the composer's score now, so Direction starts fresh from it (Claude, review F2).
  await press(screen.host, "Generate");
  expect(screen.arranged.recompose.status).toBe("ready");
  expect([...screen.host.querySelectorAll("button")].some(b => b.textContent?.trim() === "Write this one")).toBe(true);
});

it("carryforward M4: Direction's rewrite-with-chords rewrites the changed completed stretch too", async () => {
  const screen = setup(true);
  await direction(screen.host);
  await press(screen.host, "Generate");
  await choose(screen.host, plans[0].name);
  const held = screen.arranged.options;
  if (held.status !== "ready" || held.notes[0]?.status !== "ready") throw Error("No partial result");
  expect(held.notes[0].missing?.length).toBeGreaterThan(0);
  await press(screen.host, "Direction");
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
