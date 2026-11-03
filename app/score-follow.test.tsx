// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { DrawnScore } from "../render/drawScore";
import { ScoreView, type ScoreViewHandle } from "./ScoreView";

const paint = vi.hoisted(() => ({ playhead: vi.fn() }));
vi.mock("../render/drawScore", async (original) => ({ ...(await original<typeof import("../render/drawScore")>()), drawScore: async () => ({}) as DrawnScore }));
vi.mock("../render/barOverlay", async (original) => ({ ...(await original<typeof import("../render/barOverlay")>()), paintHighlights: () => {} }));
vi.mock("../render/noteMarks", async (original) => ({ ...(await original<typeof import("../render/noteMarks")>()), paintNoteMarks: () => {}, paintPlayhead: paint.playhead }));
vi.mock("../render/studyMarks", () => ({ paintStudyMarks: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); paint.playhead.mockReset(); });
const box = (top: number, height: number) => ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 100, width: 100, height, toJSON: () => ({}) });
const at = { key: "P1:0:0", nextKey: null, frac: 0, colour: "#123456" };
async function mount(contained: boolean) {
  const outer = document.body.appendChild(document.createElement("div"));
  const pane = outer.appendChild(document.createElement("div"));
  if (contained) pane.className = "notation-scroll";
  const host = pane.appendChild(document.createElement("div"));
  const view = createRef<ScoreViewHandle>();
  root = createRoot(host);
  await act(async () => root!.render(<ScoreView ref={view} xmlText="<score-partwise/>" score={parseScore("<score-partwise/>")} zoom={1} highlights={[]} noteMarks={[]} onTap={() => {}} onDrawn={() => {}}/>));
  const line = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const scrollIntoView = vi.fn();
  line.scrollIntoView = scrollIntoView;
  pane.getBoundingClientRect = () => box(100, 200);
  Object.defineProperty(pane, "clientHeight", { value: 200 });
  pane.scrollTop = 40;
  const scrollTo = vi.fn();
  pane.scrollTo = scrollTo;
  return { view, pane, line, scrollTo, scrollIntoView };
}

it("follows new systems only within the nearest notation pane, leaving visible systems and outer scroll alone", async () => {
  const screen = await mount(true);
  screen.line.getBoundingClientRect = () => box(140, 40);
  paint.playhead.mockReturnValue({ line: screen.line, y: 20 });
  screen.view.current!.showPlaying(at);
  expect(screen.scrollTo).not.toHaveBeenCalled();
  screen.line.getBoundingClientRect = () => box(330, 40);
  paint.playhead.mockReturnValue({ line: screen.line, y: 220 });
  screen.view.current!.showPlaying(at);
  expect(screen.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 254, behavior: "smooth" });
  screen.view.current!.showPlaying(at);
  expect(screen.scrollTo).toHaveBeenCalledOnce();
  expect(screen.scrollIntoView).not.toHaveBeenCalled();
  paint.playhead.mockReturnValue(null);
  screen.view.current!.showPlaying(null);
  expect(paint.playhead).toHaveBeenLastCalledWith(expect.anything(), null);
  expect(screen.scrollTo).toHaveBeenCalledOnce();
});

it("preserves document following for score views without a notation pane", async () => {
  const screen = await mount(false);
  paint.playhead.mockReturnValue({ line: screen.line, y: 20 });
  screen.view.current!.showPlaying(at);
  expect(screen.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "start" });
  expect(screen.line.style.scrollMarginTop).toBe("88px");
  expect(screen.scrollTo).not.toHaveBeenCalled();
});
it("pans within a narrow notation pane when the cursor advances across the same system", async () => {
  const screen = await mount(true);
  Object.defineProperty(screen.pane, "clientWidth", { value: 200 });
  screen.pane.scrollLeft = 40;
  screen.line.getBoundingClientRect = () => ({ ...box(140, 40), left: 350, right: 354 });
  paint.playhead.mockReturnValue({ line: screen.line, y: 20 });
  screen.view.current!.showPlaying(at);
  expect(screen.scrollTo).toHaveBeenLastCalledWith({ top: 40, left: 374, behavior: "smooth" });
  expect(screen.scrollIntoView).not.toHaveBeenCalled();
});
