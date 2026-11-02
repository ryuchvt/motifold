// Review-only: actual Elegie meter change plus ordinary DAW tempo automation.
// External source material remains opt-in and is never copied into this repo.
import { existsSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseScore, parseScoreFile } from "../score";
import { midiFile, onlyBars, packageFiles, scoreTracks, withOption, withStructure, type OptionCheck } from "./arrange";
import { beatClock } from "./audio/preview";
import { placeCues } from "./cues";
import { midiScoreXml, readMidi } from "./midi";
import { pieceData } from "./pieceData";

const four = { beats: 4, beatType: 4 };

it("MIDI import retains an ordinary mid-bar tempo change at its beat, not at the barline", () => {
  const midi = midiFile([{ name: "Piano", program: 0, notes: [
    { start: 0, length: 4, height: 60 }, { start: 4, length: 4, height: 64 },
  ] }], [{ beat: 0, qpm: 60 }, { beat: 2, qpm: 120 }], four);
  const source = readMidi(midi);
  expect(source.tempos.map((t) => [t.tick / source.ppq, t.qpm])).toEqual([[0, 60], [2, 120]]);
  const score = parseScore(midiScoreXml(midi, "A cue accelerates halfway through the bar"));
  const marks = pieceData(score, [], []).tempos;
  // Both 60 for beats 0..2 and 120 after beat 2 are part of what the DAW played.
  expect(marks).toEqual([{ beat: 0, qpm: 60 }, { beat: 2, qpm: 120 }]);
});

it("picture cues agree with the preview clock through a tempo change inside a written bar", () => {
  const score = parseScore(`<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <direction><sound tempo="120"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure><measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note></measure>
  </part></score-partwise>`);
  const data = pieceData(score, [], []);
  expect(beatClock(data.tempos).seconds(4)).toBe(3);
  expect(placeCues([{ time: "3", what: "The cut" }], score)[0]).toMatchObject({ bar: "2", beat: 0, beats: 4 });
});

const elegie = process.env.PHRASEPATH_ELEGIE_MXL ?? "local-inputs/scores/faure-elegie-cello-piano.mxl";
describe.skipIf(!existsSync(elegie))("actual Elegie exported to the DAW", () => {
  it("keeps bar 44's 2/4 and the return to 4/4, so later bar numbers agree", () => {
    const { xmlText, score } = parseScoreFile(readFileSync(elegie));
    const lead = score.parts[0]!;
    expect(lead.measures[43]!.number).toBe("44");
    expect(lead.measures[43]!.time).toEqual({ beats: 2, beatType: 4 });
    expect(lead.measures[44]!.start / score.ticksPerQuarter).toBe(174);
    const exported = readMidi(unzipSync(packageFiles(xmlText, null, "Review, no model call"))["all-parts.mid"]!);
    expect(exported.times.map((m) => ({ beat: m.tick / exported.ppq, beats: m.beats, beatType: m.beatType }))).toEqual([
      { beat: 0, beats: 4, beatType: 4 },
      { beat: 172, beats: 2, beatType: 4 },
      { beat: 174, beats: 4, beatType: 4 },
    ]);
  });
});

it("real supplied pickup and split bars retain their absolute score note times in MIDI", () => {
  // This is a positive statement about note-on time, not equality between a DAW's
  // integer bar labels and the score's printed 0/7a/7b/19a labels.
  for (const file of ["test-fixtures/arioso.musicxml", "test-fixtures/fur-elise.musicxml"]) {
    const { xmlText, score } = parseScoreFile(readFileSync(file));
    const fromScore = scoreTracks(score).flatMap((t) => t.notes.map((n) => [n.start, n.length, n.height]));
    const imported = readMidi(unzipSync(packageFiles(xmlText, null, "Review"))["all-parts.mid"]!);
    const fromMidi = imported.tracks.flatMap((t) => t.notes.map((n) => [n.tick / imported.ppq, n.length / imported.ppq, n.height]));
    const ordered = (ns: number[][]) => ns.sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]! || a[1]! - b[1]!);
    expect(ordered(fromMidi)).toEqual(ordered(fromScore));
  }
});

it("a real Arioso form starting at bar 9 exports its inherited tempo at the start", () => {
  const xml = readFileSync("test-fixtures/arioso.musicxml", "utf8");
  const reordered = withStructure(xml, { order: [{ from: "9", to: "10" }] });
  const score = parseScore(reordered);
  // Preview backfills the first mark to beat zero, which can mask this export fault.
  expect(beatClock(pieceData(score, [], []).tempos).seconds(4)).toBeCloseTo(4 * 60 / 31.5);
  const midi = readMidi(unzipSync(packageFiles(reordered, null, "Review"))["all-parts.mid"]!);
  expect(midi.tempos[0]).toMatchObject({ tick: 0 });
  expect(midi.tempos[0]!.qpm).toBeCloseTo(31.5);
});

it("extending the real Arioso after its half-bar 7a shows the note at the beat exported to MIDI", () => {
  const xml = onlyBars(readFileSync("test-fixtures/arioso.musicxml", "utf8"), "1", "7a");
  const score = parseScore(xml);
  const check: OptionCheck = {
    adds: [{ part: "Flute", bar: "9", events: [{ start: 0, length: 1, names: ["C4"] }] }],
    notes: 1, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [], clashes: [],
  };
  const finished = parseScore(withOption(xml, score, check));
  const played = scoreTracks(finished).find((t) => t.name === "Flute")!.notes[0]!;
  expect(played.start).toBe(32); // New bar 8 is a full 4/4 bar after source beat 28.
  const picture = pieceData(score, [], [], { adds: check.adds }).rows.find((r) => r.label === "Flute")!.notes[0]!;
  expect(picture.start).toBe(played.start);
});
