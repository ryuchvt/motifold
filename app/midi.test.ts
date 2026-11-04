import { describe, expect, it } from "vitest";
import { parseScore, ScoreFileError } from "../score";
import { midiFile, packageFiles, scoreTracks, snap } from "./arrange";
import { isMidi, markersOf, midiLeadIn, midiScoreXml, readMidi } from "./midi";
import { unzipSync } from "fflate";
import { beatClock } from "./audio/preview";
import { openedScore } from "./opened";

const time = { beats: 4, beatType: 4 };
const file = midiFile(
  [
    { name: "Strng Long", program: 48, notes: [{ start: 0, length: 3, height: 60 }, { start: 0, length: 3, height: 64 }, { start: 3, length: 2, height: 62 }] },
    { name: "Inst 2", program: 42, notes: [{ start: 4, length: 4, height: 48 }] },
  ],
  [{ beat: 0, qpm: 73 }, { beat: 4, qpm: 90 }],
  time,
  [{ beat: 4, text: "Door opens" }, { beat: 6.5, text: "Hit" }],
);

describe("reading a MIDI file", () => {
  const midi = readMidi(file);

  it("finds its tracks, notes and what they play", () => {
    expect(isMidi(file)).toBe(true);
    expect(midi.tracks.map((t) => [t.name, t.program, t.notes.length])).toEqual([["Strng Long", 48, 3], ["Inst 2", 42, 1]]);
    expect(midi.tracks[0]!.notes[0]).toMatchObject({ tick: 0, length: 1440, height: 64 });
  });

  it("finds its tempos, time and markers", () => {
    expect(midi.tempos.map((t) => Math.round(t.qpm))).toEqual([73, 90]);
    expect(midi.times).toEqual([{ tick: 0, beats: 4, beatType: 4 }]);
    expect(markersOf(file)).toEqual([{ beats: 4, what: "Door opens" }, { beats: 6.5, what: "Hit" }]);
  });

  it("refuses what isn't one, and a file timed in frames", () => {
    expect(() => readMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(ScoreFileError);
    const frames = file.slice();
    frames[12] = 0xe7;
    expect(() => readMidi(frames)).toThrow(/SMPTE/);
  });

  it("leaves drums out, and splits a single track by channel", () => {
    // Format 0, with a note on channel 1, one on channel 2 and a drum on channel 10.
    const body = [0, 0x90, 60, 80, 0x60, 0x80, 60, 0, 0, 0x91, 64, 80, 0x60, 0x81, 64, 0, 0, 0x99, 36, 80, 0x60, 0x89, 36, 0, 0, 0xff, 0x2f, 0];
    const bytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);
    const read = readMidi(bytes);
    expect(read.tracks.map((t) => t.notes[0]!.height)).toEqual([60, 64]);
    expect(read.drums).toBe(1);
  });
});

describe("a MIDI file as a score", () => {
  const score = parseScore(midiScoreXml(file, "Sketch"));

  it("has a part for each track, in bars, with its tempo", () => {
    expect(score.movementTitle).toBe("Sketch");
    expect(score.parts.map((p) => p.name)).toEqual(["Strng Long", "Inst 2"]);
    expect(score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2"]);
    expect(score.parts[0]!.measures[0]!.tempos[0]!.qpm).toBe(73);
    expect(score.parts[0]!.measures[1]!.tempos[0]!.qpm).toBe(90);
  });

  it("plays back what the file played, with a note over the barline tied", () => {
    expect(scoreTracks(score).find((t) => t.name === "Strng Long")!.notes).toEqual([{ start: 0, length: 3, height: 64, velocity: 80 }, { start: 0, length: 3, height: 60, velocity: 80 }, { start: 3, length: 2, height: 62, velocity: 80 }]);
    const ticked = score.parts[0]!.notes.filter((n) => n.pitch?.step === "D");
    expect(ticked.map((n) => [n.tieStart, n.tieStop])).toEqual([[true, false], [false, true]]);
  });

  it("puts rough timing on the nearest grid, keeping a clear triplet", () => {
    expect(snap(1.02)).toBe(1);
    expect(snap(0.26)).toBe(0.25);
    expect(snap(0.34)).toBeCloseTo(1 / 3);
    expect(snap(0.67)).toBeCloseTo(2 / 3);
  });

  it("refuses a file with no notes", () => {
    expect(() => midiScoreXml(midiFile([], 120, time), "x")).toThrow(/no notes/);
  });
});

describe("opening a file", () => {
  it("takes MIDI as well as MusicXML", () => {
    expect(openedScore(file, "sketch.mid").score.parts).toHaveLength(2);
  });

  it("says plainly what it can't read, and what to do", () => {
    expect(() => openedScore(new Uint8Array(4), "cue.sib")).toThrow(/Export MusicXML from Sibelius/);
    expect(() => openedScore(new Uint8Array(4), "cue.mscz")).toThrow(/Export MusicXML from MuseScore/);
    expect(() => openedScore(new Uint8Array(4), "take.m4a")).toThrow(/can't read audio/);
  });
});

describe("an explicit import without empty DAW bars", () => {
  const cut = 1497;
  const source = midiFile([
    { name: "Piano", program: 0, notes: [{ start: cut + 1 / 3, length: 4, height: 64, velocity: 91 }, { start: cut + 1 / 3, length: 1, height: 60, velocity: 57 }] },
    { name: "Cello", program: 42, notes: [{ start: cut + 3.25, length: 2, height: 48, velocity: 73 }] },
  ], [{ beat: 0, qpm: 98 }, { beat: cut - 2, qpm: 130 }, { beat: cut + .5, qpm: 150 }], { beats: 3, beatType: 4 }, [{ beat: cut + 1, text: "Theme" }]);

  it("requires a choice and leaves the ordinary converter and source bytes unchanged", () => {
    const before = source.slice();
    expect(midiLeadIn(source)).toEqual({ emptyBars: 499, totalBars: 501 });
    expect(parseScore(midiScoreXml(source, "Full timeline")).parts[0]!.measures).toHaveLength(501);
    expect(openedScore(source, "sketch.mid", { skipEmptyMidiBars: true }).score.parts[0]!.measures).toHaveLength(2);
    expect(source).toEqual(before);
    expect(markersOf(source)).toEqual([{ beats: cut + 1, what: "Theme" }]);
  });

  it("retains every interpreted note and its pickup position, velocity and cross-bar duration", () => {
    const original = scoreTracks(parseScore(midiScoreXml(source, "Full timeline")));
    const trimmed = scoreTracks(parseScore(midiScoreXml(source, "Music", { skipEmptyBars: true })));
    expect(trimmed.map(t => t.name)).toEqual(original.map(t => t.name));
    for (let t = 0; t < original.length; t++) {
      expect(trimmed[t]!.notes).toHaveLength(original[t]!.notes.length);
      for (let n = 0; n < original[t]!.notes.length; n++) {
        const a = original[t]!.notes[n]!, b = trimmed[t]!.notes[n]!;
        expect(b.height).toBe(a.height);expect(b.velocity).toBe(a.velocity);
        expect(b.start).toBeCloseTo(a.start - cut, 9);expect(b.length).toBeCloseTo(a.length, 9);
      }
    }
    expect(trimmed[0]!.notes[0]!.start).toBeCloseTo(1 / 3, 9);
  });

  it("carries the active tempo into the first retained bar and keeps intra-bar changes in the actual export", () => {
    const xml = midiScoreXml(source, "Music", { skipEmptyBars: true });
    const midi = readMidi(unzipSync(packageFiles(xml, null, "Music"))["all-parts.mid"]!);
    expect(midi.tempos.map(t => ({ beat: t.tick / midi.ppq, qpm: Math.round(t.qpm) }))).toEqual([{ beat: 0, qpm: 130 }, { beat: .5, qpm: 150 }]);
    const old = readMidi(source), oldClock = beatClock(old.tempos.map(t => ({ beat: t.tick / old.ppq, qpm: t.qpm })));
    const newClock = beatClock(midi.tempos.map(t => ({ beat: t.tick / midi.ppq, qpm: t.qpm })));
    for (const note of midi.tracks.flatMap(t => t.notes)) {
      const beat = note.tick / midi.ppq;
      expect(Math.abs(newClock.seconds(beat) - (oldClock.seconds(cut + beat) - oldClock.seconds(cut)))).toBeLessThan(.002);
    }
  });

  it("counts empty bars across metre changes and retains later changes", () => {
    const start = 8 + 20 * 3;
    const changing = midiFile([{ name: "Piano", program: 0, notes: [{ start: start + .5, length: 1, height: 60 }, { start: start + 3.25, length: 3, height: 67 }] }], 120,
      [{ beat: 0, beats: 4, beatType: 4 }, { beat: 8, beats: 3, beatType: 4 }, { beat: start + 3, beats: 5, beatType: 8 }]);
    expect(midiLeadIn(changing)).toEqual({ emptyBars: 22, totalBars: 25 });
    const score = parseScore(midiScoreXml(changing, "Changing metre", { skipEmptyBars: true }));
    expect(score.parts[0]!.measures.map(m => m.time)).toEqual([{ beats: 3, beatType: 4 }, { beats: 5, beatType: 8 }, { beats: 5, beatType: 8 }]);
    expect(scoreTracks(score)[0]!.notes[0]!.start).toBe(.5);
  });

  it("rejects an invalid zero-length MIDI metre instead of looping over its grid", () => {
    const invalid = midiFile([{ name: "Piano", program: 0, notes: [{ start: 0, length: 1, height: 60 }] }], 120, { beats: 0, beatType: 4 });
    expect(() => midiLeadIn(invalid)).toThrow(/no usable bar length/);
    expect(() => midiScoreXml(invalid, "Invalid")).toThrow(/no usable bar length/);
  });
});
