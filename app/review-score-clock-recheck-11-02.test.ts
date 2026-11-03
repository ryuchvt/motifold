import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { parseScore, type Score } from "../score";
import { midiFile, packageFiles, pieceInput, placeNotes, scoreOfParts, scoreWithSplits } from "./arrange";
import { beatClock } from "./audio/preview";
import { midiScoreXml, readMidi } from "./midi";
import { attacksOf, largestShiftMs, mappedMidi, playedFromMidi, readWithinBars } from "./timing";
import { scoreOfReading } from "./timingScore";

// Ordinary DAW tempo automation, the same contract as A10. No model calls.
const midi = midiFile([{ name: "Piano", program: 0, notes: [
  { start: 0, length: 1, height: 60 }, { start: 0, length: 1, height: 64 },
  { start: 2, length: 1, height: 67 }, { start: 4, length: 4, height: 72 },
] }], [{ beat: 0, qpm: 60 }, { beat: 2, qpm: 120 }, { beat: 6, qpm: 90 }], { beats: 4, beatType: 4 });
const score = parseScore(midiScoreXml(midi, "DAW sketch"));
const input = pieceInput(score, score.parts[0]!, 0, 1);
const tempos = (s: Score) => s.parts[0]!.measures.flatMap(m => m.tempos.map(t => ({ beat: (m.start + t.onset) / s.ticksPerQuarter, qpm: t.qpm })));

describe("the tempo map through the ordinary arranger workflow", () => {
  it("keeps every timed change when notes are put on chosen players", () => {
    const placed = placeNotes(score, input, { idea: "A direct placement", plan: [{
      line: "Piano", voice: "all", from: "1", to: "2", part: "Violin I", octave: 0, why: "Keep the source notes",
    }] }, ["Violin I"]);
    expect(tempos(parseScore(scoreOfParts(score, input, placed.parts)))).toEqual(tempos(score));
  });

  it("keeps every timed change when a chord track is split", () => {
    expect(tempos(parseScore(scoreWithSplits(score, input, ["Piano"])))).toEqual(tempos(score));
  });
});

it("the actual theme keeps its attack times from Use these bars through the saved placement and MIDI", () => {
  const played = playedFromMidi(new Uint8Array(readFileSync("test-fixtures/Sample_sketch.mid")));
  const attacks = attacksOf(played);
  const answer = JSON.parse(readFileSync("test-fixtures/sample-sketch-bars.json", "utf8")).answer;
  const reading = readWithinBars(attacks, answer.meter, answer.starts);
  const originalXml = scoreOfReading(played, attacks, reading, "Sad theme");
  const originalScore = parseScore(originalXml);
  const asked = pieceInput(originalScore, originalScore.parts[0]!, 0, 23);
  const distribution = JSON.parse(readFileSync("test-fixtures/sample-sketch-arrangement.json", "utf8")).distribute;
  const parts = placeNotes(originalScore, asked, distribution.answer, distribution.input.instruments).parts;
  const placedXml = scoreOfParts(originalScore, asked, parts);
  const exported = readMidi(unzipSync(packageFiles(placedXml, null, "Review"))["all-parts.mid"]!);
  // Match an actual struck note by identity and musical beat, not by nearest same-pitch onset.
  const note = played.notes.find(n => n.id === 110)!;
  expect(note.height).toBe(79); // G5, bar 23 beat 2.
  const attack = attacks.findIndex(a => a.notes.some(n => n.id === note.id));
  expect(reading.place[attack]).toBe(67);
  expect(exported.tracks.some(t => t.notes.some(n => n.height === note.height && n.tick / exported.ppq === 67))).toBe(true);
  // The separate raw-MIDI download is the positive control and preserves all 117 notes.
  const rawBack = playedFromMidi(mappedMidi(played, attacks, reading));
  expect(rawBack.notes).toHaveLength(117);
  expect(largestShiftMs(played, rawBack, played.notes[0]!.at - rawBack.notes[0]!.at)).toBeLessThan(2);
  const clock = beatClock(exported.tempos.map(t => ({ beat: t.tick / exported.ppq, qpm: t.qpm })));
  const expected = note.at - attacks[0]!.at;
  // Current export: 63.037725 s. Original: 62.642708 s. The error is about 395 ms.
  expect(Math.abs(clock.seconds(67) - expected) * 1000).toBeLessThan(2);
});
