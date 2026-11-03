// @vitest-environment jsdom
// What opening a file does on the import screen, in the whole site.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Studio } from "./Studio";

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
});

const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Newer cello</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
const button = (host: HTMLElement, words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent!.includes(words))!;

async function openStudio() {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Studio />));
  await act(async () => button(host, "try one piece live").click());
  return host;
}
async function choose(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

it("offers only the files it can read", async () => {
  const host = await openStudio();
  expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe(".musicxml,.xml,.mxl,.mid,.midi");
  expect(host.textContent).not.toMatch(/audio/i);
});

it("says plainly that it can't read a recording", async () => {
  const host = await openStudio();
  await choose(host, new File(["audio"], "take.wav", { type: "audio/wav" }));
  expect(host.textContent).toContain("can't read audio");
  expect(host.querySelector(".on-page")).toBeNull();
});

it("a file still being read when the composer leaves opens nothing", async () => {
  const host = await openStudio();
  let release!: () => void;
  const slow = new File([xml], "slow.musicxml");
  Object.defineProperty(slow, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((done) => (release = () => done(new TextEncoder().encode(xml).buffer as ArrayBuffer))) });
  await choose(host, slow);
  await act(async () => button(host, "MOTIFOLD").click());
  await act(async () => release());
  await act(async () => button(host, "try one piece live").click());
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
