import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseScore } from "../score";
import { arrangeInput, checkOption, midiFile, pieceInput, placeNotes, scoreOfParts, scoreTracks, scoreWithSplits, withOption, type ArrangeOption } from "./arrange";
import { midiScoreXml, readMidi } from "./midi";
import { attacksOf, barsOf, playedFromMidi, readWithinBars } from "./timing";
import { scoreOfReading } from "./timingScore";

it("a normal grid MIDI keeps the composer's different key velocities on import", () => {
  const file = midiFile([{ name: "Piano", program: 0, notes: [{ start: 0, length: 1, height: 60, velocity: 30 }, { start: 1, length: 1, height: 64, velocity: 105 }] }], 90, { beats: 4, beatType: 4 });
  const before = readMidi(file).tracks[0]!.notes.map((n) => n.velocity);
  const after = readMidi(midiFile(scoreTracks(parseScore(midiScoreXml(file, "My sketch"))), 90, { beats: 4, beatType: 4 })).tracks[0]!.notes.map((n) => n.velocity);
  expect(after).toEqual(before);
});

it("a grid MIDI chord keeps each note's own velocity", () => {
  const file = midiFile([{ name: "Piano", program: 0, notes: [{ start: 0, length: 1, height: 60, velocity: 30 }, { start: 0, length: 1, height: 67, velocity: 105 }] }], 90, { beats: 4, beatType: 4 });
  const after = scoreTracks(parseScore(midiScoreXml(file, "My sketch")))[0]!.notes;
  expect(after.map((n) => [n.height, n.velocity]).sort()).toEqual([[60, 30], [67, 105]]);
});

it("the bundled freely played theme keeps each chord note's own key velocity", () => {
  const played = playedFromMidi(new Uint8Array(readFileSync("test-fixtures/sad-theme.mid")));
  const attacks = attacksOf(played);
  const saved = JSON.parse(readFileSync("test-fixtures/sad-theme-bars.json", "utf8")).answer;
  const reading = readWithinBars(attacks, saved.meter, saved.starts);
  const score = parseScore(scoreOfReading(played, attacks, reading, "Sad theme"));
  const notes = scoreTracks(score).flatMap((t) => t.notes);
  const origin = barsOf(attacks, reading)[0]!.start;
  const changed = attacks.flatMap((a, k) =>
    a.notes.flatMap((n) => {
      const expectedStart = reading.place[k]! - origin;
      const found = notes.find((m) => m.height === n.height && Math.abs(m.start - expectedStart) < 1e-6);
      expect(found, `source note ${n.id}`).toBeDefined();
      return found!.velocity === n.velocity ? [] : [{ id: n.id, beat: expectedStart, pitch: n.height, before: n.velocity, after: found!.velocity }];
    }),
  );
  expect(changed).toEqual([]);
});

const sourceXml = `<score-partwise><part-list><score-part id="P1"><part-name>Violin I</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;

function keptSwell() {
  const score = parseScore(sourceXml);
  const input = arrangeInput(score, score.parts[0]!, 0, 0, null, 0, null);
  const option: ArrangeOption = { name: "Swell", idea: "", why: [], adds: [{ part: "Cello", bar: "1", events: "C3,E3@0+4", dyn: "p<f" }] };
  const kept = parseScore(withOption(sourceXml, score, checkOption(option, score, input)));
  return { kept, xml: withOption(sourceXml, score, checkOption(option, score, input)), before: scoreTracks(kept).find((t) => t.name === "Cello")! };
}

it("splitting the kept score keeps a written cello swell in the MIDI and on the page", () => {
  const { kept, before } = keptSwell();
  expect(before.controls!.length).toBeGreaterThan(2);
  const split = scoreWithSplits(kept, pieceInput(kept, kept.parts[0]!, 0, 0), ["Cello"]);
  const tracks = scoreTracks(parseScore(split));
  for (const name of ["Cello 1", "Cello 2"]) expect(tracks.find((t) => t.name === name)!.controls).toEqual(before.controls);
  expect(tracks.find((t) => t.name === "Violin I")!.controls).toBeUndefined();
  expect(split.match(/<p\/>/g)).toHaveLength(2);
  expect(split.match(/<wedge type="crescendo"\/>/g)).toHaveLength(2);
  expect(split.match(/<wedge type="stop"\/>/g)).toHaveLength(2);
});

it("splitting keeps every note where it was and what it's worth", () => {
  const { kept, before } = keptSwell();
  const split = scoreWithSplits(kept, pieceInput(kept, kept.parts[0]!, 0, 0), ["Cello"]);
  const notes = scoreTracks(parseScore(split)).filter((t) => t.name.startsWith("Cello")).flatMap((t) => t.notes);
  expect(notes.sort((a, b) => a.height - b.height)).toEqual([...before.notes].sort((a, b) => a.height - b.height));
});

it("a level set in an imported score stays when it goes through the same rebuild", () => {
  const level = (n: number) => `<direction><direction-type><words>x</words></direction-type><sound dynamics="${n}"/></direction>`;
  const xml = sourceXml.replace("<note>", `${level(60)}<note>`);
  const score = parseScore(xml);
  const before = scoreTracks(score)[0]!;
  expect(before.notes[0]!.velocity).toBe(54);
  const after = scoreTracks(parseScore(scoreWithSplits(score, pieceInput(score, score.parts[0]!, 0, 0), [])))[0]!;
  expect(after.controls).toEqual(before.controls);
  expect(after.notes).toEqual(before.notes);
});

it("a line's levels go with it to the instrument the plan gives it to", () => {
  const { kept, before } = keptSwell();
  const input = pieceInput(kept, kept.parts[0]!, 0, 0);
  const placed = placeNotes(kept, input, { plan: [{ from: "1", to: "1", line: "Cello", part: "Viola", voice: "all", octave: 0 }], why: "" } as never, ["Viola"]);
  const tracks = scoreTracks(parseScore(scoreOfParts(kept, input, placed.parts)));
  expect(tracks.find((t) => t.name === "Viola")!.controls).toEqual(before.controls);
});

it("a level on an empty bar and one partway through a bar both stay", () => {
  const measure = (n: number, inside: string) => `<measure number="${n}">${n === 1 ? `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` : ""}${inside}</measure>`;
  const sound = (level: number) => `<direction><direction-type><words>x</words></direction-type><sound dynamics="${level}"/></direction>`;
  const c = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>`;
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Viola</part-name></score-part></part-list><part id="P1">${measure(1, `${c}${sound(90)}${c}`)}${measure(2, `${sound(50)}<note><rest/><duration>8</duration></note>`)}</part></score-partwise>`;
  const score = parseScore(xml);
  const after = parseScore(scoreWithSplits(score, pieceInput(score, score.parts[0]!, 0, 1), []));
  expect(after.parts[0]!.measures.map((m) => m.levels?.map((l) => [l.onset / after.ticksPerQuarter, l.velocity]))).toEqual([[[2, 81]], [[0, 45]]]);
  expect(after.parts[0]!.measures[0]!.length).toBe(score.parts[0]!.measures[0]!.length * (after.ticksPerQuarter / score.ticksPerQuarter));
});

it("a split score prints the level a swell arrived at when the next bar starts from it", () => {
  const source = sourceXml.replace("</measure>", `</measure><measure number="2"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note></measure>`);
  const score = parseScore(source);
  const input = arrangeInput(score, score.parts[0]!, 0, 1, null, 0, null);
  const option: ArrangeOption = { name: "Two", idea: "", why: [], adds: [{ part: "Cello", bar: "1", events: "C3,E3@0+4", dyn: "p<f" }, { part: "Cello", bar: "2", events: "D3,F3@0+4", dyn: "f>mp" }] };
  const keptXml = withOption(source, score, checkOption(option, score, input));
  const kept = parseScore(keptXml);
  const split = scoreWithSplits(kept, pieceInput(kept, kept.parts[0]!, 0, 1), ["Cello"]);
  expect(keptXml.match(/<f\/>/g)).toHaveLength(1);
  expect(split.match(/<f\/>/g)).toHaveLength(2);
  const tracks = scoreTracks(parseScore(split));
  expect(tracks.find((t) => t.name === "Cello 1")!.controls).toEqual(scoreTracks(kept).find((t) => t.name === "Cello")!.controls);
});
