// @vitest-environment jsdom
// A plan's first section as a preview, then the rest when it's chosen. The original synthetic contract score and local plans.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { writingProgress } from "./attention";
import { ArrangePanel } from "./ArrangePanel";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync("test-fixtures/contract-score.musicxml", "utf8");
const score = parseScore(xmlText);
const loaded = { fileName: "contract-score.musicxml", xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync("test-fixtures/contract-arrangement.json", "utf8"));
let unmount = () => {};
afterEach(() => {
  act(unmount);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("writes only the first section as a preview, and the rest from there when the plan is chosen", async () => {
  const windows: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const shape = url.split("/").pop()!;
    const input = JSON.parse(init.body as string).input;
    if (shape === "arrange") windows.push(`${input.window?.from}-${input.window?.to}`);
    const answer = shape === "read_piece" ? saved.read.answer : shape === "plan_options" ? saved.plan.answer : shape === "arrange" ? { adds: [{ part: "Viola", bar: input.window?.from ?? "1", events: "C4@0+1" }] } : null;
    return new Response(JSON.stringify(answer ? { status: "ok", answer } : { status: "fallback", reason: "no-key" }));
  });
  let arranged!: Arranged;
  function Host() {
    arranged = useArrange(loaded, part, range, null);
    return <ArrangePanel arranged={arranged} busy={false} />;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  await act(() => arranged.askPiece());
  await act(() => arranged.askOptions("", 0, "inside"));
  await act(() => arranged.askPreview(1));
  expect(windows).toHaveLength(1);
  const first = arranged.options.status === "ready" ? arranged.options.notes[1] : undefined;
  expect(first).toMatchObject({ status: "ready", preview: true });
  // The sections after the preview wait for the composer, and aren't called unfinished.
  act(() => arranged.setTrying({ kind: "option", index: 1 }));
  const states = writingProgress(arranged).map((w) => w.state);
  expect(states[0]).toBe("written");
  expect(states.slice(1).every((s) => s === "queued")).toBe(true);
  await act(() => arranged.askNotes(1));
  expect(windows.length).toBe(states.length);
  expect(new Set(windows).size).toBe(windows.length);
  const all = arranged.options.status === "ready" ? arranged.options.notes[1] : undefined;
  expect(all).toMatchObject({ status: "ready" });
  expect(all && "preview" in all ? all.preview : undefined).toBeFalsy();
});
