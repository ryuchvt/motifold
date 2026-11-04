import { expect, it } from "vitest";
import { unzipSync } from "fflate";
import { parseScore } from "../score";
import { packageFiles, pieceInput, placeNotes, scoreOfParts, scoreTracks, scoreWithSplits } from "./arrange";
import { readMidi } from "./midi";
import { pieceData } from "./pieceData";

const note = (step: string, octave: number, duration: number, chord = false) => `<note dynamics="100">${chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice></note>`;
const meter = (beats: number, beatType: number) => `<attributes><divisions>24</divisions><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`;
const bars = [[3, 4, 72], [5, 8, 60], [3, 4, 72]];
const sourceXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list><part id="P1">${bars.map(([beats, unit, ticks], i) => `<measure number="${i + 1}">${meter(beats!, unit!)}<sound tempo="${[173, 160, 180][i]}"/>${i === 1 ? '<forward><duration>12</duration></forward><sound tempo="120"/><backup><duration>12</duration></backup>' : ""}${note("C", 4, ticks!)}${note("E", 4, ticks!, true)}</measure>`).join("")}</part><part id="P2">${bars.map(([beats, unit, ticks], i) => `<measure number="${i + 1}">${meter(beats!, unit!)}${note("C", 2, ticks!)}</measure>`).join("")}</part></score-partwise>`;

it("retains the silent first part's score clock through placement, native voice splitting and every MIDI stem", () => {
  const source = parseScore(sourceXml), input = pieceInput(source, source.parts[0]!, 0, 2);
  const placed = placeNotes(source, input, { idea: "Carry the source onto these instruments", plan: [
    { line: "Piano", part: "Flute", from: "1", to: "3", voice: "all", octave: 0, why: "Carry both source voices before splitting" },
    { line: "Bass", part: "Cello", from: "1", to: "3", voice: "all", octave: 0, why: "Carry the source bass" },
  ] }, ["Piccolo", "Flute", "Cello"]);
  expect(placed.check.notes).toBe(9);
  expect(placed.check.placed).toBe(9);
  expect(placed.check.merged).toBe(0);
  const laidOut = parseScore(scoreOfParts(source, input, placed.parts));
  expect(laidOut.parts[0]!.name).toBe("Piccolo");
  expect(laidOut.parts[0]!.notes.every(note => note.rest)).toBe(true);
  const splitXml = scoreWithSplits(laidOut, pieceInput(laidOut, laidOut.parts[0]!, 0, 2), ["Flute"]), split = parseScore(splitXml);
  expect(split.parts.map(part => part.name)).toEqual(["Piccolo", "Flute 1", "Flute 2", "Cello"]);
  const notes = (score: typeof source) => scoreTracks(score).flatMap(track => track.notes.map(note => [note.start, note.length, note.height, note.velocity])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  expect(notes(split)).toEqual(notes(source));
  const clock = (score: typeof source) => score.parts[0]!.measures.map(measure => ({ start: measure.start / score.ticksPerQuarter, length: measure.length / score.ticksPerQuarter, time: measure.time, tempos: measure.tempos.map(tempo => [tempo.onset / score.ticksPerQuarter, tempo.qpm]) }));
  expect(clock(laidOut)).toEqual(clock(source));
  expect(clock(split)).toEqual(clock(source));
  expect(pieceData(split, [], []).tempos).toEqual([{ beat: 0, qpm: 173 }, { beat: 3, qpm: 160 }, { beat: 3.5, qpm: 120 }, { beat: 5.5, qpm: 180 }]);
  const files = unzipSync(packageFiles(splitXml, null, "Local clock regression"));
  const midiNames = Object.keys(files).filter(name => name.endsWith(".mid"));
  expect(midiNames).toHaveLength(4);
  for (const name of midiNames) {
    const midi = readMidi(files[name]!);
    expect(midi.tempos.map(tempo => tempo.tick / midi.ppq)).toEqual([0, 3, 3.5, 5.5]);
    midi.tempos.forEach((tempo, i) => expect(tempo.qpm).toBeCloseTo([173, 160, 120, 180][i]!, 2));
    expect(midi.times.map(time => [time.tick / midi.ppq, time.beats, time.beatType])).toEqual([[0, 3, 4], [3, 5, 8], [5.5, 3, 4]]);
  }
});
