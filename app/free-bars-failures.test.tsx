// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { scoreTracks } from "./arrange";
import { FreeBars } from "./FreeBars";
import { setTransport, type SparkReply } from "./spark";
import * as timing from "./timing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bytes = new Uint8Array(readFileSync("test-fixtures/Sample_sketch.mid"));
const saved = JSON.parse(readFileSync("test-fixtures/sample-sketch-bars.json", "utf8"));
let root: Root | null = null;
let downloads: Blob[];

beforeEach(() => {
  // Only the expensive candidate search is replaced. Bar settlement, notation and MIDI export stay real.
  vi.spyOn(timing, "barsInput").mockResolvedValue(structuredClone(saved.input));
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("No HTTP request is allowed in this test"); }));
  downloads = [];
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { downloads.push(blob); return `blob:local-${downloads.length}`; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root?.unmount()); root = null;
  setTransport(null);
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function setup(replies: SparkReply[], savedFile: string | null = null) {
  const request = vi.fn(async (_shape: string, _input: unknown) => structuredClone(replies.shift() ?? { status: "fallback", reason: "failed" } as SparkReply));
  setTransport(request);
  const onUse = vi.fn(), onKeep = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(<FreeBars fileName="performance.mid" bytes={bytes} title="Local source" savedFile={savedFile} onUse={onUse} onKeep={onKeep}/>));
  const press = async (name: string) => {
    const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === name);
    expect(button, `Missing button ${name}`).toBeDefined();
    await act(async () => button!.click());
  };
  const words = (value: string) => act(() => {
    const box = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { host, request, press, words, onUse, onKeep };
}
const ok = (why = "The local accepted reading"): SparkReply => ({ status: "ok", cached: false, answer: { ...saved.answer, why } });
const refused = (reason: string): SparkReply => ({ status: "fallback", reason });
const blobBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject;
  reader.readAsArrayBuffer(blob);
});

it.each([
  ["quota", "This connection has reached today's allowance"],
  ["today", "Today's shared credit limit has been reached"],
  ["visitor", "This connection has reached today's allowance"],
  ["network", "The connection failed"],
  ["bad-key", "The Meta key was rejected"],
])("explains an initial %s refusal and keeps the original-file choice", async (reason, words) => {
  const screen = setup([refused(reason), refused(reason)]);
  await screen.press("Find the bars");
  expect(screen.host.textContent).toContain(words);
  expect(screen.host.querySelector(".free-found")).toBeNull();
  expect(screen.host.textContent).toContain("There is no accepted bar reading yet");
  await screen.press("Keep the file's own bars");
  expect(screen.onKeep).toHaveBeenCalledOnce();
  expect(screen.request).toHaveBeenCalledOnce();
  expect(screen.request.mock.calls[0]![0]).toBe("read_bars");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the last fresh bars, notation and mapped117-note MIDI after quota, ahead of an older saved answer", async () => {
  const screen = setup([ok("Last fresh answer"), refused("quota"), ok("New fresh answer")], "/saved.json");
  await screen.press("Find the bars");
  await screen.press("Use these bars");
  const acceptedXml = screen.onUse.mock.calls[0]![0];
  const accepted = parseScore(acceptedXml);
  expect(accepted.parts.map(part => part.measures.length)).toEqual([24, 24]);
  expect(scoreTracks(accepted).flatMap(track => track.notes)).toHaveLength(114);
  await screen.press("Download the MIDI on these bars");
  const before = await blobBytes(downloads[0]!);
  screen.words("Please check these bars again.");
  await screen.press("Read it again");
  expect(screen.host.textContent).toContain("couldn't read it again");
  expect(screen.host.textContent).toContain("This connection has reached today's allowance");
  expect(screen.host.textContent).toContain("Last fresh answer");
  expect(screen.host.querySelector(".free-found")?.textContent).toContain("3/4, 24 bars");
  await screen.press("Use these bars");
  expect(screen.onUse.mock.calls[1]![0]).toBe(acceptedXml);
  await screen.press("Download the MIDI on these bars");
  const after = await blobBytes(downloads[1]!);
  expect(after).toEqual(before);
  const original = timing.playedFromMidi(bytes).notes, mapped = timing.playedFromMidi(after).notes;
  expect(mapped).toHaveLength(117);
  expect(mapped.map(note => [note.height, note.velocity])).toEqual(original.map(note => [note.height, note.velocity]));
  expect(Math.max(...mapped.map((note, index) => Math.abs((note.at - mapped[0]!.at) - (original[index]!.at - original[0]!.at))))).toBeLessThan(.002);
  expect(Math.max(...mapped.map((note, index) => Math.abs((note.end - note.at) - (original[index]!.end - original[index]!.at))))).toBeLessThan(.002);
  expect(screen.host.textContent).toContain("score groups nearby attacks and interprets note releases");
  expect(screen.host.textContent).toContain("original file is unchanged");
  expect(fetch).not.toHaveBeenCalled();
  await screen.press("Read it again");
  expect(screen.host.textContent).toContain("New fresh answer");
  expect(screen.host.textContent).not.toContain("This connection has reached today's allowance");
  expect(screen.host.textContent).not.toContain("couldn't read it again");
});

it("labels a matching saved fallback and still discloses the fresh daily refusal", async () => {
  const readSaved = vi.fn(async () => Response.json(saved)); vi.stubGlobal("fetch", readSaved);
  const screen = setup([refused("today")], "/saved.json");
  await screen.press("Find the bars");
  expect(screen.host.textContent).toContain("Showing the saved answer for this playing");
  expect(screen.host.textContent).toContain("Today's shared credit limit has been reached");
  expect(screen.host.textContent).toContain("A saved answer from Muse Spark");
  expect(readSaved).toHaveBeenCalledExactlyOnceWith("/saved.json");
  await screen.press("Use these bars");
  expect(screen.onUse.mock.calls[0]![1].saved).toBe(true);
  expect(screen.host.querySelector(".free-found")?.textContent).toContain("24 bars");
});
