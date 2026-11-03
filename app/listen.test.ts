import { describe, expect, it } from "vitest";
import { yin } from "./audio/yin";
import { isAudioFile, notesAsMidi, notesFromPitch } from "./listen";
import { readMidi } from "./midi";
import { looksFreelyPlayed } from "./timing";

const RATE = 44100;
type Tone = { at: number; length: number; midi: number; level?: number; decay?: number };
/** A tone with a few harmonics, struck and dying away like a piano, or held like a voice when it doesn't decay. */
function play(tones: Tone[], seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const t of tones) {
    const hz = 440 * 2 ** ((t.midi - 69) / 12);
    const from = Math.round(t.at * RATE);
    const to = Math.min(out.length, Math.round((t.at + t.length) * RATE));
    for (let i = from; i < to; i++) {
      const s = (i - from) / RATE;
      const envelope = (t.level ?? 0.5) * Math.min(1, s / 0.01) * Math.exp(-(t.decay ?? 0) * s) * Math.min(1, (to - i) / RATE / 0.01);
      out[i] = out[i]! + envelope * (Math.sin(2 * Math.PI * hz * s) + 0.5 * Math.sin(4 * Math.PI * hz * s) + 0.25 * Math.sin(6 * Math.PI * hz * s));
    }
  }
  return out;
}
const hear = (tones: Tone[], seconds: number) => notesFromPitch(yin(play(tones, seconds), RATE));

describe("a recording of one line into notes", () => {
  it("finds a sung line's pitches and when each starts", () => {
    const line = [60, 62, 64, 65, 67, 65, 64, 62].map((midi, k) => ({ at: 0.3 + k * 0.5, length: 0.45, midi }));
    const notes = hear(line, 4.6);
    expect(notes.map((n) => n.pitch)).toEqual(line.map((t) => t.midi));
    notes.forEach((n, k) => expect(Math.abs(n.start - line[k]!.at)).toBeLessThan(0.05));
  });

  it("hears a low cello note and a high flute note in their own octaves", () => {
    expect(hear([{ at: 0.2, length: 0.8, midi: 40 }], 1.2).map((n) => n.pitch)).toEqual([40]);
    expect(hear([{ at: 0.2, length: 0.8, midi: 86 }], 1.2).map((n) => n.pitch)).toEqual([86]);
  });

  it("splits the same key struck again while the first still rings", () => {
    const notes = hear([{ at: 0.2, length: 0.6, midi: 67, decay: 4 }, { at: 0.8, length: 0.8, midi: 67, decay: 4 }], 1.8);
    expect(notes.map((n) => n.pitch)).toEqual([67, 67]);
    expect(Math.abs(notes[1]!.start - 0.8)).toBeLessThan(0.06);
  });

  it("keeps a note held at one level as one note", () => {
    expect(hear([{ at: 0.2, length: 2, midi: 62 }], 2.5)).toHaveLength(1);
  });

  it("leaves out a much quieter pitch that only rings in the tail of a loud note", () => {
    const notes = hear([{ at: 0.2, length: 0.7, midi: 64, level: 0.8, decay: 2 }, { at: 0.9, length: 0.4, midi: 52, level: 0.06 }], 1.6);
    expect(notes.map((n) => n.pitch)).toEqual([64]);
  });

  it("keeps a soft note that starts after a rest", () => {
    const notes = hear([{ at: 0.2, length: 0.5, midi: 64, level: 0.8 }, { at: 1.6, length: 0.5, midi: 69, level: 0.15 }], 2.4);
    expect(notes.map((n) => n.pitch)).toEqual([64, 69]);
  });

  it("finds nothing in silence or in noise", () => {
    expect(hear([], 1)).toEqual([]);
    let seed = 7;
    const noise = new Float32Array(RATE).map(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.2);
    expect(notesFromPitch(yin(noise, RATE)).length).toBeLessThan(2);
  });

  it("writes MIDI with the timing and loudness it heard, which then finds its bars like free playing", () => {
    const line = Array.from({ length: 24 }, (_, k) => ({ start: 0.5 + k * 0.617 + (k % 3) * 0.041, length: 0.5, pitch: 60 + (k % 12), level: 0.3 + (k % 5) * 0.1 }));
    const midi = notesAsMidi(line);
    const read = readMidi(midi).tracks.flatMap((t) => t.notes);
    expect(read).toHaveLength(24);
    expect(read[0]!.tick).toBe(0);
    expect(new Set(read.map((n) => n.velocity)).size).toBeGreaterThan(1);
    expect(looksFreelyPlayed(midi)).toBe(true);
  });

  it("knows a recording from a score", () => {
    expect(isAudioFile({ name: "take.WAV", type: "" })).toBe(true);
    expect(isAudioFile({ name: "recording.webm", type: "audio/webm" })).toBe(true);
    expect(isAudioFile({ name: "x", type: "audio/mpeg" })).toBe(true);
    expect(isAudioFile({ name: "theme.mid", type: "audio/midi" })).toBe(false);
    expect(isAudioFile({ name: "theme.musicxml", type: "" })).toBe(false);
  });
});
