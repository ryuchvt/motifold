import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseScoreFile } from "../../score";
import { notesToHear, pieceData } from "../pieceData";
import { createPreview } from "./preview";

const started: { frequency: number; at: number }[] = [];
const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
class LocalAudioContext {
  currentTime = 0;
  sampleRate = 100;
  destination = node();
  resume = vi.fn(async () => {});
  createGain = () => ({ ...node(), gain: parameter() });
  createBiquadFilter = () => ({ ...node(), type: "lowpass", frequency: parameter(), Q: parameter() });
  createDynamicsCompressor = node;
  createConvolver = () => ({ ...node(), buffer: null });
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  createOscillator = () => {
    const made = { ...node(), type: "sine", frequency: parameter(), detune: parameter(), stop: vi.fn(), start: (at: number) => started.push({ frequency: made.frequency.value, at }) };
    return made;
  };
}

beforeEach(() => {
  started.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", LocalAudioContext);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("starting the synthetic score at bar 10 hears the remainder of the cello note tied into it", () => {
  const { score } = parseScoreFile(readFileSync("test-fixtures/contract-score.musicxml"));
  const data = pieceData(score, [], []);
  const bar = data.bars.find((b) => b.number === "10")!;
  const held = notesToHear(data, () => "Cello", null, ["Violoncello"])
    .find((n) => n.start < bar.start && n.start + n.length > bar.start)!;
  expect({ bar: bar.start, start: held.start, length: held.length, height: held.height }).toEqual({ bar: 40, start: 39, length: 1.5, height: 62 });
  const preview = createPreview();
  preview.play([held], data.tempos, bar.start, () => {}, () => {});
  // A seek shouldn't erase sound already written and sustained at that beat.
  expect(started.some((n) => Math.abs(n.frequency - 440 * 2 ** ((62 - 69) / 12)) < 1e-6)).toBe(true);
  preview.stop();
});

it("stopping clears future scheduling before a later note enters the look-ahead window", () => {
  const preview = createPreview();
  preview.play([
    { start: 0, length: 1, height: 60, voice: "winds", level: 1 },
    { start: 2, length: 1, height: 64, voice: "winds", level: 1 },
  ], [{ beat: 0, qpm: 120 }], 0, () => {}, () => {});
  expect(started.length).toBe(2); // Two oscillators for the first note.
  preview.stop();
  vi.advanceTimersByTime(10_000);
  expect(started.length).toBe(2);
});
