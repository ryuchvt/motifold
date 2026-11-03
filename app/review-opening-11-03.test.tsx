// @vitest-environment jsdom
// What opening a file does on the import screen, in the whole site.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { notesAsMidi } from "./listen";
import { Studio } from "./Studio";

const pending = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("./listen", async (original) => ({ ...(await original<typeof import("./listen")>()), listenTo: pending.listen }));
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
  pending.listen.mockReset();
});

const line = (count: number) => notesAsMidi(Array.from({ length: count }, (_, k) => ({ start: 0.5 + k * 0.617 + (k % 3) * 0.041, length: 0.5, pitch: 60 + (k % 12), level: 0.5 })));

const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Newer cello</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
const button = (host: HTMLElement, words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent!.includes(words))!;

async function openStudio() {
  vi.stubGlobal("fetch", async (url:string) => url==="/api/access"?Response.json({state:"available",resetAt:null}):new Response("{}", { status: 404 }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Studio />));
  await act(async () => button(host, "Open my piece").click());
  return host;
}
async function choose(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

it("takes a recording as well as a score", async () => {
  const host = await openStudio();
  expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toContain(".wav");
  expect(host.textContent).toContain("a recording of one line");
});

it("hears a recording and goes on to find its bars, as it does for free playing", async () => {
  pending.listen.mockResolvedValue({ midi: line(24), notes: 24, seconds: 15 });
  const host = await openStudio();
  await choose(host, new File(["audio"], "hummed.wav", { type: "audio/wav" }));
  expect(pending.listen).toHaveBeenCalledOnce();
  expect(host.querySelector(".hearing")).toBeNull();
  expect(host.textContent).toContain("played without a click");
  expect(host.textContent).toContain("24 notes");
});

it("says what it can hear when a recording gives too few notes", async () => {
  pending.listen.mockResolvedValue({ midi: line(3), notes: 3, seconds: 4 });
  const host = await openStudio();
  await choose(host, new File(["audio"], "chords.wav", { type: "audio/wav" }));
  expect(host.textContent).toContain("hears one line at a time");
});

it("stops listening when the composer leaves, and opens nothing afterwards", async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  pending.listen.mockImplementation((_file: File, s: AbortSignal) => {
    signal = s;
    return new Promise((done) => (finish = done));
  });
  const host = await openStudio();
  await choose(host, new File(["audio"], "old.wav", { type: "audio/wav" }));
  expect(host.textContent).toContain("LISTENING");
  await act(async () => button(host, "Motifold").click());
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ midi: line(24), notes: 24, seconds: 15 }));
  await act(async () => button(host, "Open my piece").click());
  expect(host.textContent).toContain("Open your sketch");
  expect(host.textContent).not.toContain("old.mid");
});

it("records from the microphone with its processing off, and hears what was recorded", async () => {
  pending.listen.mockResolvedValue({ midi: line(24), notes: 24, seconds: 15 });
  const stopped = vi.fn();
  const asked = vi.fn(async () => ({ getTracks: () => [{ stop: stopped }] }));
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: asked } });
  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["sound"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const host = await openStudio();
  await act(async () => button(host, "sing, hum or play it in").click());
  expect(asked).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  expect(host.textContent).toContain("RECORDING");
  await act(async () => button(host, "Stop").click());
  expect(stopped).toHaveBeenCalled();
  expect((pending.listen.mock.calls[0]![0] as File).name).toBe("recording.webm");
  expect(host.textContent).toContain("played without a click");
});

it("says so when the microphone isn't allowed", async () => {
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: async () => Promise.reject(new Error("NotAllowedError")) } });
  const host = await openStudio();
  await act(async () => button(host, "sing, hum or play it in").click());
  expect(host.textContent).toContain("The microphone isn't available here");
});

it("a file still being read when the composer leaves opens nothing", async () => {
  const host = await openStudio();
  let release!: () => void;
  const slow = new File([xml], "slow.musicxml");
  Object.defineProperty(slow, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((done) => (release = () => done(new TextEncoder().encode(xml).buffer as ArrayBuffer))) });
  await choose(host, slow);
  await act(async () => button(host, "Motifold").click());
  await act(async () => release());
  await act(async () => button(host, "Open my piece").click());
  expect(host.querySelector(".on-page")).toBeNull();
  expect(host.textContent).toContain("Open your sketch");
});

it("opens a file dropped where it says to drop one", async () => {
  const host = await openStudio();
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [new File([xml], "dropped.musicxml")] } });
  await act(async () => host.querySelector(".drop")!.dispatchEvent(drop));
  expect(drop.defaultPrevented).toBe(true);
  expect(host.querySelector(".on-page")?.textContent).toContain("Newer cello");
});
