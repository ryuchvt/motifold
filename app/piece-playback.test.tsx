// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import { PieceView } from "./PieceView";
import { pieceData } from "./pieceData";
import { playhead } from "./playhead";

const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock("./audio/preview", async (original) => ({ ...(await original<typeof import("./audio/preview")>()), createPreview: () => audio }));
vi.mock("./audio/samples", async (original) => ({ ...(await original<typeof import("./audio/samples")>()), loadManifest: async () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = '<score-partwise><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
const props = {
  data: pieceData(parseScore(xmlText), [], []), sections: [], moments: [], selected: { from: "1", to: "2" }, focus: null, solo: [],
  instrumentOf: () => "", hasNew: false, onSelect: () => {}, onSelectRange: () => {}, onFocus: () => {}, onSolo: () => {},
};
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  playhead.set({ playing: false });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function mount(onBeat: (beat: number | null) => void, render?: string) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const update = (next: typeof onBeat) => act(() => root!.render(<PieceView {...props} render={render} onBeat={next}/>));
  update(onBeat);
  return update;
}

it("reports actual audio beats to the latest callback and clears it on pause, stop, end and unmount", () => {
  const first = vi.fn(), latest = vi.fn();
  const update = mount(first);
  act(() => playhead.play());
  const tick = audio.play.mock.calls[0]![3] as (beat: number) => void;
  act(() => tick(2.25));
  expect(first.mock.calls).toEqual([[2.25]]);
  update(latest);
  expect(audio.play).toHaveBeenCalledOnce();
  act(() => tick(3.5));
  expect(first.mock.calls).toEqual([[2.25]]);
  expect(latest.mock.calls).toEqual([[3.5]]);
  act(() => playhead.pause());
  expect(latest.mock.calls).toEqual([[3.5], [null]]);
  act(() => tick(4));
  expect(latest.mock.calls).toEqual([[3.5], [null]]);

  act(() => playhead.play());
  const end = audio.play.mock.calls[1]![4] as () => void;
  act(end);
  expect(latest.mock.calls.at(-1)).toEqual([null]);
  expect(latest.mock.calls.slice(2)).toEqual([[null]]);
  act(() => playhead.play());
  act(() => playhead.stop());
  expect(latest.mock.calls.slice(3)).toEqual([[null]]);
  act(() => playhead.play());
  const finalTick = audio.play.mock.calls[3]![3] as (beat: number) => void;
  act(() => finalTick(6));
  act(() => root!.unmount());
  root = null;
  expect(latest.mock.calls.slice(4)).toEqual([[6], [null]]);
  finalTick(7);
  expect(latest.mock.calls.slice(4)).toEqual([[6], [null]]);
  expect(playhead.ready).toBe(false);
});

it("reports a saved bounce's clock through the latest callback and clears it at its end", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const bounce = { currentTime: 0, paused: true, onended: null as (() => void) | null, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  vi.stubGlobal("Audio", class { constructor() { return bounce; } });
  const first = vi.fn(), latest = vi.fn();
  const update = mount(first, "/local-bounce.wav");
  act(() => playhead.play());
  bounce.currentTime = 1.25;
  act(() => frames.shift()!(0));
  expect(first.mock.calls).toEqual([[2.5]]);
  update(latest);
  bounce.currentTime = 2;
  act(() => frames.shift()!(0));
  expect(latest.mock.calls).toEqual([[4]]);
  act(() => { bounce.paused = true; bounce.onended!(); });
  expect(latest.mock.calls).toEqual([[4], [null]]);
  act(() => frames.shift()!(0));
  expect(latest.mock.calls).toEqual([[4], [null]]);
});

it("keeps the callback at the heard position when a new version changes the overview's length", () => {
  const onBeat = vi.fn();
  mount(onBeat);
  act(() => playhead.play());
  const tick = audio.play.mock.calls[0]![3] as (beat: number) => void;
  act(() => tick(3.25));
  const extended = pieceData(parseScore(xmlText.replace('</part></score-partwise>', '<measure number="3"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>')), [], []);
  act(() => root!.render(<PieceView {...props} data={extended} onBeat={onBeat}/>));
  expect(onBeat.mock.calls).toEqual([[3.25], [3.25]]);
  expect(audio.play.mock.calls[1]![2]).toBe(3.25);
});
