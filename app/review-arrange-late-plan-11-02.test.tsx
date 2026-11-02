// @vitest-environment jsdom
// Real shipped Arioso and its saved answers; only network timing is controlled.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { DistributeAnswer, PieceReading, PlanAnswer, WriteAnswer } from "../server/shapes";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/arioso.musicxml", "utf8");
const score = parseScore(xmlText);
const loaded = { fileName: "arioso.musicxml", xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync("test-fixtures/arioso-arrangement.json", "utf8")) as {
  read: { answer: PieceReading };
  distribute: { input: { instruments: string[] }; answer: DistributeAnswer };
  plan: { answer: PlanAnswer };
  notes: WriteAnswer[];
};
const reply = (answer: unknown) => new Response(JSON.stringify({ status: "ok", answer }));

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function setup(waitFor: "plan_options" | "arrange") {
  let release!: () => void;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("read_piece")) return reply(saved.read.answer);
    if (url.endsWith("distribute")) return reply(saved.distribute.answer);
    if (url.endsWith(waitFor)) await new Promise<void>((done) => { release = done; });
    if (url.endsWith("plan_options")) return reply(saved.plan.answer);
    if (url.endsWith("arrange")) return reply(saved.notes[1]);
    throw new Error("Unexpected local request");
  });
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return null; }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { get now() { return current; }, release: () => release() };
}

it("does not restore a deleted real Arioso part through a plan that was already in flight", async () => {
  const screen = setup("plan_options");
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askPlaced(saved.distribute.input.instruments, ""));
  const flute = screen.now.allParts.find((p) => p.name === "Flute")!;
  expect(flute).toBeTruthy();
  let waiting!: Promise<void>;
  act(() => { waiting = screen.now.askOptions("", 0, "inside"); });
  expect(screen.now.options.status).toBe("asking");
  // The panel lets the composer return to Who plays it? and delete a part
  // while the long plan request continues.
  act(() => screen.now.toggleGone(flute.id));
  expect(screen.now.standing!.parts.some((p) => p.name === "Flute")).toBe(false);
  await act(async () => { screen.release(); await waiting; });
  await act(() => screen.now.askNotes(1));
  // The old saved option contains Flute notes. It must not resurrect the part
  // the composer removed after that option's input was sent.
  expect((screen.now.shown?.score ?? screen.now.standing)!.parts.some((p) => p.name === "Flute"),
    "deleting a part must invalidate the earlier plan and its old instrument list").toBe(false);
});

it("does withhold notes already in flight when deleting the part clears their option", async () => {
  const screen = setup("arrange");
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askPlaced(saved.distribute.input.instruments, ""));
  await act(() => screen.now.askOptions("", 0, "inside"));
  const flute = screen.now.allParts.find((p) => p.name === "Flute")!;
  let waiting!: Promise<void>;
  act(() => { waiting = screen.now.askNotes(1); });
  act(() => screen.now.toggleGone(flute.id));
  await act(async () => { screen.release(); await waiting; });
  expect((screen.now.shown?.score ?? screen.now.standing)!.parts.some((p) => p.name === "Flute")).toBe(false);
});
