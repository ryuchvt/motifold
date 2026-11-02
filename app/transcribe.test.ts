import { describe, expect, it } from "vitest";
import { dropOvertones, isAudioFile, notesAsMidi, type HeardNote } from "./transcribe";
import { readMidi } from "./midi";
import { looksFreelyPlayed } from "./timing";

const note = (start: number, pitch: number, amp = 0.8, length = 0.5): HeardNote => ({ start, pitch, amp, length });

describe("a recording into notes", () => {
  it("knows an audio file from a score", () => {
    expect(isAudioFile({ name: "take.WAV", type: "" })).toBe(true);
    expect(isAudioFile({ name: "x", type: "audio/mpeg" })).toBe(true);
    expect(isAudioFile({ name: "theme.mid", type: "audio/midi" })).toBe(true);
    expect(isAudioFile({ name: "theme.musicxml", type: "" })).toBe(false);
  });

  it("drops a quiet octave or twelfth over a louder note, and keeps a real one", () => {
    const low = note(1, 60, 0.9);
    const overtone = note(1.02, 72, 0.3);
    const twelfth = note(1.01, 79, 0.2);
    const played = note(1, 72, 0.85);
    const later = note(2, 72, 0.3);
    const third = note(1, 64, 0.2);
    expect(dropOvertones([low, overtone, twelfth, third, later])).toEqual([low, third, later]);
    expect(dropOvertones([low, played])).toEqual([low, played]);
  });

  it("keeps real timing and loudness in a file that goes on to find its bars", () => {
    const notes = Array.from({ length: 24 }, (_, k) => note(0.5 + k * 0.617 + (k % 3) * 0.041, 60 + (k % 12), 0.3 + (k % 5) * 0.1));
    const midi = notesAsMidi(notes);
    const read = readMidi(midi);
    const heard = read.tracks.flatMap((t) => t.notes);
    expect(heard).toHaveLength(24);
    expect(new Set(heard.map((n) => n.velocity)).size).toBeGreaterThan(1);
    expect(heard[0]!.tick).toBe(0);
    expect(looksFreelyPlayed(midi)).toBe(true);
  });
});
