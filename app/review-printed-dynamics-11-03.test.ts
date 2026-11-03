import { expect, it } from "vitest";
import { parseScore, type Score } from "../score";
import { pieceInput, placeNotes, scoreOfParts, scoreTracks, scoreWithSplits } from "./arrange";

const direction = (mark: string, sound?: number) => `<direction placement="below"><direction-type>${mark}</direction-type>${sound === undefined ? "" : `<sound dynamics="${sound}"/>`}</direction>`;
const chord = () => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>`;
const source = (...bars: string[]) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1">${bars.map((inside, k) => `<measure number="${k + 1}">${k ? "" : "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"}${inside}</measure>`).join("")}</part></score-partwise>`;
const inputOf = (score: Score) => pieceInput(score, score.parts[0]!, 0, score.parts[0]!.measures.length - 1);
const printed = (score: Score, part = 0) => score.parts[part]!.measures.map((m) => (m.dynamicMarks ?? []).map(({ onset, ...mark }) => ({ beat: onset / score.ticksPerQuarter, ...mark })));
const orderedNotes = (score: Score) => scoreTracks(score).flatMap((track) => track.notes).sort((a, b) => a.start - b.start || a.height - b.height);

it("splitting discrete printed p/f changes preserves the marks without inventing a hairpin or changing MIDI", () => {
  const score = parseScore(source(`${direction("<dynamics><p/></dynamics>", 55.6)}${chord()}${chord()}${direction("<dynamics><f/></dynamics>", 106.7)}${chord()}${chord()}`));
  const before = scoreTracks(score)[0]!;
  expect(before.notes.map((n) => n.velocity)).toEqual([50, 50, 73, 73, 96, 96, 96, 96]);
  const xml = scoreWithSplits(score, inputOf(score), ["Sketch"]);
  const rebuilt = parseScore(xml);
  expect(xml).not.toContain("<wedge");
  expect(printed(rebuilt)).toEqual([[{ beat: 0, kind: "dynamics", value: "p" }, { beat: 2, kind: "dynamics", value: "f" }]]);
  expect(printed(rebuilt, 1)).toEqual(printed(rebuilt));
  expect(orderedNotes(rebuilt)).toEqual(orderedNotes(score));
  for (const track of scoreTracks(rebuilt)) expect(track.controls).toEqual(before.controls);
});

it("moving a line preserves an explicit numbered hairpin across bars, independent of its playback points", () => {
  const score = parseScore(source(
    `${direction("<dynamics><p/></dynamics>", 55.6)}${direction('<wedge type="crescendo" number="3"/>')}${chord().repeat(4)}`,
    `${chord().repeat(2)}${direction('<wedge type="stop" number="3"/>')}${direction("<dynamics><f/></dynamics>", 106.7)}${chord().repeat(2)}`,
  ));
  const input = inputOf(score);
  const placed = placeNotes(score, input, { idea: "Move the written line", plan: [{ from: "1", to: "2", line: "Sketch", voice: "all", part: "Viola", octave: 0, why: "Keep its notes" }] }, ["Viola"]);
  const rebuilt = parseScore(scoreOfParts(score, input, placed.parts));
  expect(printed(rebuilt)).toEqual(printed(score));
  expect(printed(rebuilt).flat().filter((m) => m.kind === "wedge")).toEqual([{ beat: 0, kind: "wedge", value: "crescendo", number: "3" }, { beat: 2, kind: "wedge", value: "stop", number: "3" }]);
  expect(orderedNotes(rebuilt)).toEqual(orderedNotes(score));
  expect(scoreTracks(rebuilt)[0]!.controls).toEqual(scoreTracks(score)[0]!.controls);
});

it("printed dynamics without playback values remain notation only after splitting", () => {
  const score = parseScore(source(`${direction("<dynamics><other-dynamics>subito &amp; soft</other-dynamics></dynamics>")}${chord().repeat(4)}`));
  const xml = scoreWithSplits(score, inputOf(score), ["Sketch"]);
  const rebuilt = parseScore(xml);
  expect(printed(rebuilt)).toEqual([[{ beat: 0, kind: "dynamics", value: "other-dynamics", text: "subito & soft" }]]);
  expect(printed(rebuilt, 1)).toEqual(printed(rebuilt));
  expect(xml).not.toContain("<sound");
  expect(orderedNotes(rebuilt)).toEqual(orderedNotes(score));
  for (const track of scoreTracks(rebuilt)) expect(track.controls).toBeUndefined();
});

it("playback-only level changes rebuild without inventing printed dynamics", () => {
  const score = parseScore(source(`<sound dynamics="55.6"/>${chord().repeat(2)}<sound dynamics="106.7"/>${chord().repeat(2)}`));
  const xml = scoreWithSplits(score, inputOf(score), []);
  const rebuilt = parseScore(xml);
  expect(xml).not.toMatch(/<dynamics>|<wedge/);
  expect(printed(rebuilt)).toEqual([[]]);
  expect(scoreTracks(rebuilt)).toEqual(scoreTracks(score));
});
