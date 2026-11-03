import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { unzipSync } from "fflate";
import { parseScore, type Score } from "../score";
import { arrangeInput, checkOption, packageFiles, pieceInput, placeNotes, scoreOfParts, scoreTracks, withOption } from "./arrange";
import { readMidi } from "./midi";
import { beatClock } from "./audio/preview";

const tempos = (score: Score) => score.parts[0]!.measures.flatMap(measure => measure.tempos.map(mark => ({ beat: (measure.start + mark.onset) / score.ticksPerQuarter, qpm: mark.qpm })));

it("writing into the accepted sketch's resting first player keeps all50 tempo positions in the score and every MIDI", () => {
  const source = parseScore(readFileSync("public/demo/sample-sketch/sample-sketch.musicxml", "utf8"));
  const input = pieceInput(source, source.parts[0]!, 0, 23);
  const layout = JSON.parse(readFileSync("public/demo/sample-sketch/arrange-neutral.json", "utf8")).find((call: { shape: string }) => call.shape === "distribute");
  // The ordinary Chamber failure: the first template player rests at bar21 until new writing fills it.
  const placed = placeNotes(source, input, layout.reply.answer, layout.input.instruments, false);
  const xml = scoreOfParts(source, input, [{ name: "Flute", bars: input.written.map(() => []) }, ...placed.parts]);
  const base = parseScore(xml);
  expect(base.parts[0]!.measures[20]!.tempos.map(mark => mark.onset / base.ticksPerQuarter)).toEqual([0, 1]);
  const asked = arrangeInput(base, base.parts[0]!, 0, 23, null, 0, null, { instruments: ["Flute"], where: "inside" });
  const check = checkOption({ name: "A short answer", idea: "A local test", why: [], adds: [{ part: "Flute", bar: "21", events: "G5@0+1 G5@1+1.5" }] }, base, asked);
  expect(check).toMatchObject({ notes: 2, overBars: 0, pastBarEnd: 0, unreadable: 0, outOfRange: [] });
  const written = withOption(xml, base, check), final = parseScore(written);
  expect(tempos(final)).toEqual(tempos(source));
  const original = beatClock(tempos(source)), exported = beatClock(tempos(final));
  expect(exported.seconds(72)).toBe(original.seconds(72));
  const sourceNotes = scoreTracks(base).filter(track => track.name !== "Flute");
  expect(scoreTracks(final).filter(track => track.name !== "Flute")).toEqual(sourceNotes);
  const files = unzipSync(packageFiles(written, check, "A local timing regression"));
  for (const [name, bytes] of Object.entries(files).filter(([name]) => name.endsWith(".mid"))) {
    const midi = readMidi(bytes);
    expect(midi.tempos, name).toEqual(tempos(source).map(mark => ({ tick: Math.round(mark.beat * midi.ppq), qpm: 60_000_000 / Math.round(60_000_000 / mark.qpm) })));
  }
});

it("replacing a template rest retains nonzero playback levels and printed dynamics/wedges", () => {
  const source = parseScore(`<score-partwise><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`);
  const input = pieceInput(source, source.parts[0]!, 0, 0);
  const xml = scoreOfParts(source, input, [{ name: "Flute", bars: [[]], levels: [[{ beat: 1, velocity: 40 }, { beat: 3, velocity: 80 }]], dynamicMarks: [[{ beat: 1.5, kind: "dynamics", value: "p" }, { beat: 2, kind: "wedge", value: "crescendo", number: "3" }, { beat: 4, kind: "wedge", value: "stop", number: "3" }]] }]);
  const base = parseScore(xml), asked = arrangeInput(base, base.parts[0]!, 0, 0, null, 0, null, { where: "inside" });
  const check = checkOption({ name: "New line", idea: "A local test", why: [], adds: [{ part: "Flute", bar: "1", events: "C5@0+4" }] }, base, asked);
  const final = parseScore(withOption(xml, base, check));
  const expression = (score: Score) => {
    const measure = score.parts[0]!.measures[0]!;
    return { levels: measure.levels?.map(mark => ({ ...mark, onset: mark.onset / score.ticksPerQuarter })), marks: measure.dynamicMarks?.map(mark => ({ ...mark, onset: mark.onset / score.ticksPerQuarter })) };
  };
  expect(expression(final)).toEqual(expression(base));
  expect(scoreTracks(final)[0]!.controls).toEqual(expect.arrayContaining([{ beat: 1, value: 40 }, { beat: 3, value: 80 }]));
});

it("keeps an imported metronome-only direction's playback position independent of its visual offset", () => {
  const xml = `<score-partwise><part-list><score-part id="T1"><part-name>Flute</part-name></score-part></part-list><part id="T1"><measure number="1"><attributes><divisions>24</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>24</duration></note><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type><offset>12</offset></direction><note><rest/><duration>72</duration></note></measure></part></score-partwise>`;
  const base = parseScore(xml), input = arrangeInput(base, base.parts[0]!, 0, 0, null, 0, null, { where: "inside" });
  const check = checkOption({ name: "New line", idea: "A local test", why: [], adds: [{ part: "Flute", bar: "1", events: "C5@0+4" }] }, base, input);
  const final = parseScore(withOption(xml, base, check));
  expect(tempos(base)).toEqual([{ beat: 1, qpm: 90 }]);
  expect(tempos(final)).toEqual(tempos(base));
  expect(final.parts[0]!.measures[0]!.length / final.ticksPerQuarter).toBe(4);
  expect(scoreTracks(final)[0]!.notes).toEqual([{ start: 0, length: 4, height: 72 }]);
});
