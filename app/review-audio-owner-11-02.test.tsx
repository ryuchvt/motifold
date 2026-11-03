// @vitest-environment jsdom
// A recording being listened to belongs to the file that asked, not to whatever is open later.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { midiFile } from "./arrange";
import { Studio } from "./Studio";

const pending = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("./transcribe", async (original) => ({ ...(await original<typeof import("./transcribe")>()), transcribeFile: pending.transcribe }));
vi.mock("./ScoreView", () => ({ ScoreView: ({ xmlText }: { xmlText: string }) => <pre className="on-page">{xmlText}</pre> }));

let root: Root | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  pending.transcribe.mockReset();
});

const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Newer cello</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
const heardMidi = midiFile([{ name: "Recording", program: 0, notes: Array.from({ length: 8 }, (_, k) => ({ start: k, length: 1, height: 60 + k })) }], 120, { beats: 4, beatType: 4 });

async function openStudio() {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Studio />));
  await enterLive(host);
  return host;
}
const button = (host: HTMLElement, words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent!.includes(words))!;
async function enterLive(host: HTMLElement) {
  await act(async () => button(host, "try one piece live").click());
}
async function choose(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function leaveAndOpenNewer(host: HTMLElement) {
  await act(async () => button(host, "MOTIFOLD").click());
  await enterLive(host);
  await choose(host, new File([xml], "current.musicxml"));
  expect(host.querySelector(".on-page")?.textContent).toContain("Newer cello");
}

it("a finished older recording can't replace the newer score", async () => {
  let finish!: (value: { midi: Uint8Array; notes: number; seconds: number }) => void;
  pending.transcribe.mockReturnValue(new Promise((done) => (finish = done)));
  const host = await openStudio();
  await choose(host, new File(["audio"], "old.wav", { type: "audio/wav" }));
  expect(host.textContent).toContain("LISTENING");
  await leaveAndOpenNewer(host);
  await act(async () => finish({ midi: heardMidi, notes: 8, seconds: 4 }));
  expect(host.querySelector(".on-page")?.textContent).toContain("Newer cello");
  expect(host.textContent).not.toContain("LISTENING");
});

it("a failed older recording can't clear the newer score", async () => {
  let fail!: (error: Error) => void;
  pending.transcribe.mockReturnValue(new Promise((_done, reject) => (fail = reject)));
  const host = await openStudio();
  await choose(host, new File(["audio"], "old.wav", { type: "audio/wav" }));
  await leaveAndOpenNewer(host);
  await act(async () => fail(new Error("The old recording failed to decode")));
  expect(host.querySelector(".on-page")?.textContent).toContain("Newer cello");
  expect(host.textContent).not.toContain("failed to decode");
});

it("a recording finishing after the composer left opens nothing", async () => {
  let finish!: (value: { midi: Uint8Array; notes: number; seconds: number }) => void;
  pending.transcribe.mockReturnValue(new Promise((done) => (finish = done)));
  const host = await openStudio();
  await choose(host, new File(["audio"], "old.wav", { type: "audio/wav" }));
  await act(async () => button(host, "MOTIFOLD").click());
  await act(async () => finish({ midi: heardMidi, notes: 8, seconds: 4 }));
  await enterLive(host);
  expect(host.querySelector(".on-page")).toBeNull();
  expect(host.textContent).toContain("Open your sketch");
});

it("the older recording's progress stops it once something newer is open", async () => {
  let progress!: (done: number) => void;
  pending.transcribe.mockImplementation((_file: File, onProgress: (done: number) => void) => {
    progress = onProgress;
    return new Promise(() => {});
  });
  const host = await openStudio();
  await choose(host, new File(["audio"], "old.wav", { type: "audio/wav" }));
  await leaveAndOpenNewer(host);
  expect(() => progress(0.5)).toThrow();
});

it("opens a file dropped where it says to drop one", async () => {
  const host = await openStudio();
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [new File([xml], "dropped.musicxml")] } });
  await act(async () => host.querySelector(".drop")!.dispatchEvent(drop));
  expect(drop.defaultPrevented).toBe(true);
  expect(host.querySelector(".on-page")?.textContent).toContain("Newer cello");
});
