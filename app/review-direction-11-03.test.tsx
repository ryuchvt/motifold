// @vitest-environment jsdom
// Current frontend snapshot. Every answer is generated locally and no model is contacted.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { ArrangePanel } from "./ArrangePanel";
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
async function setup(workspace = false) {
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
      : shape === "arrange" ? { adds: [{ part: "Oboe", bar: input.window.from, events: "C5@0+1" }], doubles: [] }
      : shape === "distribute" ? { idea: "The same line", plan: [{ from: "1", to: "12", line: "Flute", voice: "all", part: "Flute", octave: 0, why: "Keep the source" }] } : null;
    return answer ? { status: "ok", cached: false, answer } : { status: "fallback", reason: "not-prepared" };
  });
  let now!: Arranged;
  function Host() {
    now = useArrange(loaded, score.parts[0]!, { from: 0, to: 11 }, null);
    return workspace ? <Workspace arranged={now} loaded={loaded} busy={false} demo={false} prepared={[]} sourceNote={null} onStage={() => {}}/> : <ArrangePanel arranged={now} busy={false}/>;
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
});

it("keeps Expand intent even when development stays within the existing bars", async () => {
  const screen = await setup();
  await act(() => screen.now.askOptions("", 0, "inside", "expand"));
  expect(screen.calls.find((call) => call.shape === "plan_options")!.input).toMatchObject({ intent: "expand", where: "inside", moreBars: 0 });
});

it("does not silently ignore the explicit melody-only replacement choice under the current-instruments default", async () => {
  const screen = await setup();
  await press(screen.host, "Next: Setup"); await press(screen.host, "Expand");
  expect(screen.host.querySelector('[aria-label="Mood"]')).not.toBeNull();
  const checkbox = [...screen.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.parentElement?.textContent?.includes("Use only my melody"))!;
  expect(checkbox.disabled).toBe(true);
  expect(screen.host.textContent).toContain('Choose a new ensemble');
  const ensemble = screen.host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement;
  act(() => { ensemble.value = 'String orchestra'; ensemble.dispatchEvent(new Event('change', { bubbles: true })); });
  const enabled = [...screen.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes('Use only my melody'))!;
  expect(enabled.disabled).toBe(false);
  act(() => enabled.click());
  await press(screen.host, "Create");
  await vi.waitFor(() => expect(screen.now.options.status).toBe("ready"));
  expect(screen.calls.find((call) => call.shape === "distribute")?.input).toMatchObject({ tuneOnly: true, intent: "expand" });
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
  setTransport(async (shape) => shape === "plan_recompose" ? { status: "ok", cached: false, answer: { options: [{ name: "Local recomposition", idea: "A new phrase", why: [{ from: "1", to: "8", what: "A new phrase", principle: "Develop source material" }], motif: { from: "1", to: "1", what: "Opening" }, fifths: 0, time: "4/4", qpm: 90 }] } } : { status: "fallback", reason: "empty" });
  await act(() => screen.now.askRecompose("", 8, ["Flute"]));
  await act(() => screen.now.writeRecomposed(0));
  expect(screen.now.standing!.parts.every((part) => part.notes.every((note) => note.rest))).toBe(true);
  const exportTab = [...screen.host.querySelectorAll<HTMLButtonElement>(".arrange-steps button")].find((button) => button.textContent?.trim() === "Export")!;
  await act(async () => exportTab.click());
  const download = [...screen.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Download MIDI')!;
  expect(download.disabled).toBe(true);
  expect(screen.host.textContent).toContain('no sounding notes');
});
