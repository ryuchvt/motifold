import { describe, expect, it } from "vitest";
import { lineFacts } from "./lineFacts";
import type { StudyScoreInput } from "./shapes";

const input = (written: StudyScoreInput["written"]): StudyScoreInput => ({ piece: { title: null, composer: null, instrument: null }, fifths: 0, time: "4/4", written, returns: [], lines: ["Flute", "Oboe", "Bass"] });

describe("what each line does, measured", () => {
  it("finds a line doubled at the octave, and says what it does", () => {
    const facts = lineFacts(input([{ bar: "1", notes: "C5 C4 D5 D4 C2", at: "0 0 1 1 0", rhythm: "1 1 1 1 2", staves: "1 2 1 2 3" }]));
    const flute = facts.find((f) => f.line === "Flute")!;
    expect(flute.doubledBy).toEqual([{ line: "Oboe", share: 1 }]);
    expect(flute).toMatchObject({ from: "1", to: "1", notesPerBar: 2, chordShare: 0, meanStep: 2, lowest: "C5", highest: "D5" });
    expect(facts.find((f) => f.line === "Bass")!.doubledBy).toEqual([]);
  });

  it("still calls it doubling when one line anticipates the other a little", () => {
    const facts = lineFacts(input([{ bar: "1", notes: "B4 B4 E5 E5", at: "0 0 0.75 1", rhythm: "0.75 1 1.25 1", staves: "1 2 1 2" }]));
    expect(facts.find((f) => f.line === "Flute")!.doubledBy[0]!.line).toBe("Oboe");
  });

  it("doesn't call a tune a doubling because its notes sit inside another track's chord", () => {
    const facts = lineFacts(input([{ bar: "1", notes: "E5 C4 E4 G4", at: "0 0 0 0", rhythm: "4x4", staves: "1 2 2 2" }]));
    expect(facts.find((f) => f.line === "Flute")!.doubledBy).toEqual([]);
  });

  it("reads a bar written as one note after another, with no staves", () => {
    const facts = lineFacts({ ...input([{ bar: "1", notes: "C4 D4", rhythm: "2x2" }]), lines: undefined, piece: { title: null, composer: null, instrument: "Clarinet" } });
    expect(facts[0]).toMatchObject({ line: "Clarinet", notesPerBar: 2, meanStep: 2 });
  });

  it("starts a new stretch where a line's partners change, and when it stops", () => {
    const facts = lineFacts(input([
      { bar: "1", notes: "C5 C4", at: "0 0", rhythm: "4 4", staves: "1 2" },
      { bar: "2", notes: "D5 F3", at: "0 0", rhythm: "4 4", staves: "1 2" },
      { bar: "3", notes: "F3", at: "0", rhythm: "4", staves: "2" },
      { bar: "4", notes: "E5", at: "0", rhythm: "4", staves: "1" },
    ]));
    expect(facts.filter((f) => f.line === "Flute").map((f) => [f.from, f.to])).toEqual([["1", "1"], ["2", "2"], ["4", "4"]]);
  });

  it("doesn't count a held note as a new attack", () => {
    const facts = lineFacts(input([{ bar: "1", notes: "C5", at: "0", rhythm: "4", staves: "1" }, { bar: "2", notes: "C5", at: "0", rhythm: "4", staves: "1", held: "1" }]));
    expect(facts[0]!.notesPerBar).toBe(0.5);
  });
});
