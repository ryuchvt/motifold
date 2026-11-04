// @vitest-environment jsdom
// Current frontend snapshot. Every answer is generated locally and no model is contacted.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { ArrangePanel, type InitialSetup } from "./ArrangePanel";
import { Workspace } from "./Workspace";
import { Studio } from "./Studio";
import { setTransport } from "./spark";
import { useArrange, type Arranged } from "./useArrange";
vi.mock("./audio/samples", () => ({ loadManifest: async () => null }));
vi.mock("./ScoreView", () => ({ ScoreView: () => <div>Local notation</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = `<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1">${Array.from({ length: 12 }, (_, index) => `<measure number="${index + 1}">${index ? "" : '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join("")}</part></score-partwise>`;
const score = parseScore(xmlText), loaded = { fileName: "local.musicxml", xmlText, score };
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(workspace = false, demo = false, initialSetup?: InitialSetup) {
  const calls: { shape: string; input: any }[] = [], frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  setTransport(async (shape, input: any) => {
    calls.push({ shape, input });
    const answer = shape === "read_piece" ? { summary: "A local sketch", sections: [], roles: [], questions: [], structures: [], missing: [], thin: [] }
      : shape === "plan_options" ? { options: ["A", "B"].map((letter) => ({ name: `${input.intent ?? (input.moreBars > 0 ? "expand" : "arrange")} ${letter}`, idea: "An answer", why: [{ from: "1", to: "12", what: "An answer", principle: "Use source material" }] })) }
      : shape === "plan_recompose" ? { options: [{ name: "A fresh recomposition", idea: "A new phrase from the source", why: [{ from: "1", to: "8", what: "A new phrase", principle: "Develop the source" }], motif: { from: "1", to: "1", what: "Opening" }, fifths: 0, time: "4/4", qpm: 90 }] }
      : shape === "write_theme" ? { lines: [{ bar: "1", role: "tune", events: "C5@0+1" }] }
      : shape === "arrange" ? { adds: [{ part: "Oboe", bar: input.window.from, events: "C5@0+1" }], doubles: [] }
      : shape === "distribute" ? { idea: "The same line", plan: [{ from: "1", to: "12", line: "Flute", voice: "all", part: input.instruments[0], octave: 0, why: "Keep the source on the selected player" }] } : null;
    return answer ? { status: "ok", cached: false, answer } : { status: "fallback", reason: "not-prepared" };
  });
  let now!: Arranged;
  function Host() {
    now = useArrange(loaded, score.parts[0]!, { from: 0, to: 11 }, null);
    return workspace ? <Workspace arranged={now} loaded={loaded} busy={false} demo={demo} prepared={[]} sourceNote={null} onStage={() => {}}/> : <ArrangePanel arranged={now} busy={false} demo={demo} initialSetup={initialSetup}/>;
  }
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(<Host/>));
  await act(() => now.askPiece());
  act(() => now.confirmTracks());
  return { host, calls, get now() { return now; }, flush: () => act(() => frames.splice(0).forEach((callback) => callback(0))) };
}
async function press(host: Element, name: string) {
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === name || button.querySelector("strong")?.textContent === name);
  if (!button) throw Error(`Missing ${name}`);
  await act(async () => button.click());
}

it("defaults to faithful current instruments, hides moods, and sends Arrange intent with inside-only writing", async () => {
  const screen = await setup();
  await press(screen.host, "Next: Setup");
  expect((screen.host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement).value).toBe("current");
  expect(screen.host.querySelector('[aria-label="Mood"]')).toBeNull();
  expect(screen.host.textContent).toContain("Neutral. Keep my music as it is.");
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  expect(screen.calls.some((call) => call.shape === "distribute")).toBe(false);
  expect(screen.calls.find((call) => call.shape === "plan_options")!.input).toMatchObject({ intent: "arrange", where: "inside", moreBars: 0 });
  const summary = [...screen.host.querySelectorAll("p")].find((paragraph) => paragraph.textContent?.trim().startsWith("Arrange, neutral"))!;
  expect(summary.textContent).toContain("current instruments");
  expect(summary.textContent).not.toContain("string orchestra");
});

it("names the selected ensemble in Pick when the notes were laid out on new players", async () => {
  const screen = await setup();
  await press(screen.host, "Next: Setup");
  const ensemble = screen.host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement;
  act(() => { ensemble.value = "String orchestra"; ensemble.dispatchEvent(new Event("change", { bubbles: true })); });
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  const summary = [...screen.host.querySelectorAll("p")].find((paragraph) => paragraph.textContent?.trim().startsWith("Arrange, neutral"))!;
  expect(summary.textContent).toContain("string orchestra");
  expect(summary.textContent).not.toContain("current instruments");
});

it("sends both first-section previews through the recorded transport when a demo creates plans", async () => {
  const fetch = vi.fn(() => { throw Error("Recorded previews must not reach a live transport"); });
  vi.stubGlobal("fetch", fetch);
  const screen = await setup(false, true);
  await press(screen.host, "Next: Setup"); await press(screen.host, "Create");
  await vi.waitFor(() => {
    const options = screen.now.options;
    expect(options.status === "ready" && options.plans.every((_, index) => options.notes[index]?.status === "ready")).toBe(true);
  });
  expect(screen.calls.filter(call => call.shape === "arrange").map(call => [call.input.chosen.name, call.input.window])).toEqual([
    ["arrange A", { from: "1", to: "8" }], ["arrange B", { from: "1", to: "8" }],
  ]);
  expect(screen.now.options.status === "ready" && Object.values(screen.now.options.notes).every(note => note.status === "ready" && note.preview)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps Expand intent even when development stays within the existing bars", async () => {
  const screen = await setup();
  await act(() => screen.now.askOptions("", 0, "inside", "expand"));
  expect(screen.calls.find((call) => call.shape === "plan_options")!.input).toMatchObject({ intent: "expand", where: "inside", moreBars: 0 });
});

it("keeps Expand neutral and preserves all source tracks when changing ensemble", async () => {
  const screen = await setup();
  await press(screen.host, "Next: Setup"); await press(screen.host, "Expand");
  expect(screen.host.querySelector('[aria-label="Mood"]')).toBeNull();
  expect(screen.host.textContent).toContain('All of your source notes stay');
  expect([...screen.host.querySelectorAll('input[type="checkbox"]')].some(input => input.parentElement?.textContent?.includes('Use only my melody'))).toBe(false);
  const ensemble = screen.host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement;
  act(() => { ensemble.value = 'String orchestra'; ensemble.dispatchEvent(new Event('change', { bubbles: true })); });
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  expect(screen.calls.find((call) => call.shape === "distribute")?.input).toMatchObject({ intent: "expand" });
  expect(screen.calls.find((call) => call.shape === "distribute")?.input.tuneOnly).not.toBe(true);
  expect(screen.calls.find((call) => call.shape === "plan_options")?.input).toMatchObject({ intent: "expand", moreBars: 16, where: "both", ask: null });
});

it("offers only longer Expand paths and restores a positive extension from legacy setup values", async () => {
  const screen = await setup(false, false, { intent: 'expand', where: 'inside', moreBars: 0 });
  await press(screen.host, 'Next: Setup');
  expect([...screen.host.querySelectorAll('[aria-label="What to write"] button')].map(button => button.textContent)).toEqual(['Continue after the ending', 'Develop the piece and continue']);
  expect(screen.host.textContent).not.toContain('Develop within existing bars');
  const added = [...screen.host.querySelectorAll('input')].find(input => input.parentElement?.textContent?.includes('Added bars'))!;
  expect(added.value).toBe('16');
  await press(screen.host, 'Continue after the ending');
  await press(screen.host, 'Create');
  expect(screen.calls.find(call => call.shape === 'plan_options')?.input).toMatchObject({ intent: 'expand', where: 'after', moreBars: 16 });
});

it.each([['Themes', 3], ['Motif', 4], ['Seed', 5]] as const)("keeps %s under Advanced and sends its selected freedom", async (name, freedom) => {
  const screen = await setup();
  await press(screen.host, 'Next: Setup'); await press(screen.host, 'Recompose');
  const group = screen.host.querySelector('[aria-label="How far from your tune"]')!;
  expect([...group.querySelectorAll(':scope > .freedom-stops button')].map(button => button.textContent)).toEqual(['Close', 'Reshaped']);
  const advanced = group.querySelector('details')!;
  expect(advanced.open).toBe(false);
  expect(advanced.querySelector('summary')?.textContent).toBe('Advanced melodic freedom');
  act(() => { advanced.open = true; });
  await press(screen.host, name);
  expect(group.textContent).toContain(`${name}.`);
  await press(screen.host, 'Create');
  expect(screen.calls.find(call => call.shape === 'plan_recompose')?.input).toMatchObject({ freedom });
});

it("defaults Recompose to a recognisable Reshaped tune and never carries its mood into Expand", async () => {
  const screen = await setup();
  await press(screen.host, "Next: Setup"); await press(screen.host, "Recompose");
  expect([...screen.host.querySelectorAll('button')].find(button => button.textContent === 'Reshaped')?.getAttribute('aria-pressed')).toBe('true');
  const ensembles = [...screen.host.querySelectorAll('[aria-label="Ensemble"] option')].map(option => option.textContent);
  expect(ensembles).toEqual(expect.arrayContaining(['String orchestra','String quartet','Chamber orchestra','Full orchestra','Woodwind quintet','Brass quintet']));
  await press(screen.host, "Sad"); await press(screen.host, "Create");
  expect(screen.calls.find(call => call.shape === 'plan_recompose')?.input).toMatchObject({ freedom: 2, ask: 'The mood I want: sad.' });
  await press(screen.host, "Setup"); await press(screen.host, "Expand");
  expect(screen.host.querySelector('[aria-label="Mood"]')).toBeNull();
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe('ready'));
  expect(screen.calls.find(call => call.shape === 'plan_options')?.input).toMatchObject({ intent:'expand', ask:null, moreBars:16 });
});

it("returns a new workflow step to the top of the inspector", async () => {
  const screen = await setup(true);
  const pane = screen.host.querySelector<HTMLElement>(".inspector-scroll")!; pane.scrollTop = 500;
  await press(screen.host, "Next: Setup"); screen.flush();
  expect(pane.scrollTop).toBe(0);
});

it("credits Ryu and does not render company branding", async () => {
  await setup();
  act(() => root!.render(<Studio initialScore={loaded} sample/>));
  expect(document.querySelector(".author-credit")?.textContent).toBe("by Ryu");
  expect(document.querySelector('img[alt="Phasecraft Audio"]')).toBeNull();
});

it("does not present previous Expand plans as the new neutral Arrange choice", async () => {
  const screen = await setup(true);
  await press(screen.host, "Next: Setup"); await press(screen.host, "Expand"); await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  expect(screen.host.textContent).toContain("expand A");
  await press(screen.host, "Setup"); await press(screen.host, "Arrange"); await press(screen.host, "Pick");
  expect(screen.host.textContent).not.toContain("expand A");
});

it("does not enable exporting an empty new score after recomposition failed to write any notes", async () => {
  const screen = await setup();
  setTransport(async (shape) => shape === "plan_recompose" ? { status: "ok", cached: false, answer: { options: [{ name: "Local recomposition", idea: "A new phrase", why: [{ from: "1", to: "8", what: "A new phrase", principle: "Develop source material" }], motif: { from: "1", to: "1", what: "Opening" }, fifths: 0, time: "4/4", qpm: 90 }] } } : shape === "write_theme" ? { status: "ok", cached: false, answer: { lines: [{ bar: "1", role: "tune", events: "C5@0+1" }] } } : { status: "fallback", reason: "empty" });
  await act(() => screen.now.askRecompose("", 8, ["Flute"]));
  await act(() => screen.now.writeRecomposed(0));
  expect(screen.now.standing!.parts.every((part) => part.notes.every((note) => note.rest))).toBe(true);
  const exportTab = [...screen.host.querySelectorAll<HTMLButtonElement>(".arrange-steps button")].find((button) => button.textContent?.trim() === "Export")!;
  await act(async () => exportTab.click());
  const download = [...screen.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Download MIDI')!;
  expect(download.disabled).toBe(true);
  expect(screen.host.textContent).toContain('no sounding notes');
});

it.each(["arrange", "expand"] as const)("keeps a completed %s out of Recompose Write until a new piece is chosen", async (intent) => {
  const screen = await setup(true);
  await press(screen.host, "Next: Setup");
  if (intent === "expand") await press(screen.host, "Expand");
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  await act(() => screen.now.askNotes(0));
  await press(screen.host, "Setup"); await press(screen.host, "Recompose");
  const before = screen.calls.length;
  await press(screen.host, "Write");
  expect(screen.host.textContent).not.toContain(`${intent} A`);
  expect(screen.host.textContent).toContain("Choose a recomposition first");
  expect(screen.calls).toHaveLength(before);

  await act(() => screen.now.askRecompose("", 8, ["Flute"]));
  expect(screen.host.textContent).not.toContain(`${intent} A`);
  expect(screen.host.textContent).toContain("Choose a recomposition first");
  await press(screen.host, "Back to plans");
  const choice = screen.host.querySelector<HTMLButtonElement>(".idea-choose")!;
  act(() => choice.click());
  await press(screen.host, "Write this one");
  await vi.waitFor(() => expect(screen.now.recomposed).not.toBeNull());
  expect(screen.host.querySelector('[aria-current="step"]')?.textContent).toBe("Write");
  expect(screen.host.querySelector(".arrange-title")?.textContent).toBe("A fresh recomposition");
});
