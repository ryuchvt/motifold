// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { parseScore } from "../score";
import type { ArrangeInput, WriteInput } from "../server/shapes";
import { scoreTracks } from "./arrange";
import { Workspace } from "./Workspace";
import { playhead } from "./playhead";
import { setTransport } from "./spark";
import { useArrange, type Arranged } from "./useArrange";

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock("./audio/preview", async (original) => ({ ...(await original<typeof import("./audio/preview")>()), createPreview: () => audio }));
vi.mock("./audio/samples", () => ({ loadManifest: async () => null }));
vi.mock("./ScoreView", () => ({ ScoreView: () => <div aria-label="Local notation"/> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/arioso.musicxml", "utf8");
const score = parseScore(xmlText);
const loaded = { fileName: "arioso.musicxml", xmlText, score };
const saved = JSON.parse(readFileSync("test-fixtures/arioso-arrangement.json", "utf8"));
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); setTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); audio.play.mockReset(); audio.stop.mockReset(); });

async function setup() {
  const writes: WriteInput[] = [];
  setTransport(async (shape, raw) => {
    if (shape === "read_piece") return { status: "ok", cached: false, answer: { ...saved.read.answer, questions: [] } };
    if (shape === "study_score") return { status: "fallback", reason: "not-prepared" };
    if (shape === "plan_options") {
      const input = raw as ArrangeInput;
      return { status: "ok", cached: false, answer: { options: ["A", "B"].map((name) => ({ name: `Local ${name}`, idea: "An added flute", why: [{ from: input.written[0]!.bar, to: input.written.at(-1)!.bar, what: "A flute answer", principle: "Keep the sketch", chords: "Am D" }] })) } };
    }
    if (shape !== "arrange") throw Error(`Unexpected local call ${shape}`);
    const input = raw as WriteInput;
    writes.push(input);
    const pitch = input.chosen.why[0]!.chords === "C G" ? "E5" : input.chosen.name === "Local A" ? "C5" : "D5";
    return { status: "ok", cached: false, answer: { adds: [{ part: "Flute", bar: input.window!.from, events: `${pitch}@0+1`, dyn: "mf" }], doubles: [] } };
  });
  let now!: Arranged;
  function Host() {
    now = useArrange(loaded, score.parts[0]!, { from: 0, to: score.parts[0]!.measures.length - 1 }, null);
    return <Workspace arranged={now} loaded={loaded} busy={false} demo={false} prepared={[]} sourceNote={null} onStage={() => {}}/>;
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Host/>));
  await act(() => now.askPiece());
  act(() => now.confirmTracks());
  await act(() => now.askOptions("", 0, "inside"));
  await act(async () => { await Promise.all([now.askPreview(0), now.askPreview(1)]); });
  return { host, writes, get now() { return now; } };
}
const press = async (host: Element, name: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name);
  if (!button) throw Error(`Missing ${name}`);
  await act(async () => button.click());
};
const chooseB = async (host: Element) => {
  const button = [...host.querySelectorAll<HTMLButtonElement>(".idea-choose")].find((b) => b.textContent?.includes("Local B"));
  if (!button) throw Error("No B plan");
  await act(async () => button.click());
};

it("hidden-inspector workflow portals preserve the chosen plan and do not ask for new notes", async () => {
  const screen = await setup();
  await press(screen.host, "Pick");
  await chooseB(screen.host);
  const count = screen.writes.length;
  expect(screen.now.trying).toEqual({ kind: "option", index: 1 });
  await press(screen.host, "Hide controls");
  expect(screen.host.querySelector(".workspace")?.classList.contains("inspector-hidden")).toBe(true);
  expect(screen.host.querySelectorAll(".workflow .arrange-steps")).toHaveLength(1);
  await press(screen.host, "Pick");
  expect(screen.host.querySelector(".workspace")?.classList.contains("inspector-hidden")).toBe(false);
  expect(screen.host.querySelectorAll(".composer-inspector .arrange-list>li")).toHaveLength(1);
  expect(screen.host.querySelector(".composer-inspector .arrange-list")?.textContent).toContain("An added flute");
  expect(screen.host.querySelectorAll(".inspector-action button")).toHaveLength(1);
  expect(screen.now.trying).toEqual({ kind: "option", index: 1 });
  expect(screen.writes).toHaveLength(count);
});

it("the chosen plan's edited chords rewrite that plan and its ZIP contains the full score", async () => {
  const screen = await setup();
  await press(screen.host, "Pick");
  await chooseB(screen.host);
  act(() => screen.now.setChords(1, 0, "C G"));
  const before = screen.writes.length;
  await press(screen.host, "Write again with these chords");
  await vi.waitFor(() => {
    const options = screen.now.options;
    expect(options.status === "ready" && options.notes[1]?.status === "ready" && !options.notes[1].writing).toBe(true);
  });
  expect(screen.writes.slice(before).map((w) => [w.chosen.name, w.chosen.why[0]!.chords])).toEqual([["Local B", "C G"], ["Local B", "C G"], ["Local B", "C G"]]);
  expect(screen.now.trying).toEqual({ kind: "option", index: 1 });
  act(() => screen.now.selectRange("9", "10"));
  const blobs: Blob[] = [];
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL(blob: Blob) { blobs.push(blob); return "blob:local-qa"; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await press(screen.host, "Hide controls");
  await press(screen.host, "Export");
  expect(screen.host.querySelector(".workspace")?.classList.contains("inspector-hidden")).toBe(false);
  await press(screen.host, "Download MIDI");
  expect(blobs).toHaveLength(1);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blobs[0]!); });
  const files = unzipSync(new Uint8Array(bytes));
  const exported = parseScore(strFromU8(files["score.musicxml"]!));
  expect(exported.parts[0]!.measures).toHaveLength(score.parts[0]!.measures.length);
  for (const track of scoreTracks(score)) expect(scoreTracks(exported).find((t) => t.name === track.name)).toEqual(track);
  expect(scoreTracks(exported).find((t) => t.name === "Flute")!.notes.map((n) => n.height)).toEqual([76, 76, 76]);
  expect(screen.now.page!.score.parts[0]!.measures).toHaveLength(2);
  expect(screen.now.view).toEqual({ from: "9", to: "10" });
  expect(playhead.get().playing).toBe(false);
});
