import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScoreFile, partListening, playOrder } from ".";

// scripts/arioso-to-musicxml.py made this file from Mutopia piece 1902. Every note was also checked against Mutopia's own MIDI,
// and against what MuseScore reads from it, which aren't in this repo. This keeps what that check found.
const score = parseScoreFile(readFileSync("test-fixtures/arioso.musicxml")).score;
const [cello, piano] = score.parts as [(typeof score.parts)[number], (typeof score.parts)[number]];
const barOf = (part: typeof cello, number: string) => part.measures.find((m) => m.number === number)!;
const notesIn = (part: typeof cello, number: string, staff?: number) =>
  barOf(part, number).noteIndexes.map((i) => part.notes[i]!).filter((n) => !n.rest && !n.grace && (!staff || n.staff === staff));
const written = (n: { pitch: { step: string; alter: number; octave: number } | null }) => `${n.pitch!.step}${n.pitch!.alter > 0 ? "#" : n.pitch!.alter < 0 ? "b" : ""}${n.pitch!.octave}`;

describe("the Arioso file", () => {
  it("says what it is, whose it is and where it came from", () => {
    expect(score.title).toBe("Arioso, BWV 1056");
    expect(score.composer).toBe("J. S. Bach");
    expect(readFileSync("test-fixtures/arioso.musicxml", "utf8")).toContain("Creative Commons Attribution 3.0. From the Mutopia Project, piece 1902");
  });

  it("has a cello on one staff and a piano on two, with every bar in both", () => {
    expect(score.parts.map((p) => [p.name, p.staves])).toEqual([["Violoncello", 1], ["Piano", 2]]);
    expect(cello.measures.map((m) => m.number)).toEqual(piano.measures.map((m) => m.number));
    expect(cello.measures.map((m) => m.number)).toEqual(["1", "2", "3", "4", "5", "6", "7", "7a", "7b", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "19a", "20", "21"]);
  });

  it("has all its notes: 754 printed, 8 of them grace notes, and 31 only held over by a tie", () => {
    const all = [...cello.notes, ...piano.notes].filter((n) => !n.rest);
    expect(all).toHaveLength(754);
    expect(all.filter((n) => n.grace)).toHaveLength(8);
    expect(all.filter((n) => n.tieStop)).toHaveLength(31);
  });

  it("starts each line of Mutopia's page with what's there", () => {
    expect(notesIn(cello, "1").map(written).slice(0, 3)).toEqual(["B3", "B3", "C4"]);
    expect(notesIn(cello, "9").map(written).slice(0, 4)).toEqual(["C4", "B3", "A3", "C5"]);
    expect(notesIn(cello, "11").map(written)[0]).toBe("A4");
    expect(notesIn(cello, "21").map(written)).toEqual(["G2"]);
    expect(notesIn(piano, "21", 2).map(written)).toEqual(["G1", "G2"]);
  });

  it("keeps a held note held", () => {
    const [first, second] = notesIn(cello, "1");
    expect(first!.tieStart).toBe(true);
    expect(second!.tieStop).toBe(true);
    expect(written(second!)).toBe(written(first!));
  });

  it("keeps the piano's two voices on one staff, and the notes that sound together", () => {
    const six = notesIn(piano, "6", 1);
    expect(new Set(six.map((n) => n.voice))).toEqual(new Set(["1", "2"]));
    expect(notesIn(piano, "1", 1).filter((n) => n.onset === 12).map(written)).toEqual(["D4", "G4", "B4"]);
  });

  it("gives the triplets their own time", () => {
    const triplet = notesIn(cello, "13").filter((n) => n.duration === score.ticksPerQuarter / 6);
    expect(triplet.length).toBeGreaterThanOrEqual(9);
  });

  it("plays both repeats and all four endings in the right order", () => {
    const played = playOrder(cello.measures);
    expect(played.problems).toEqual([]);
    expect(played.unreachableEndings).toEqual([]);
    const order = played.measures.map((p) => cello.measures[p.measureIndex]!.number);
    expect(order.slice(0, 16)).toEqual(["1", "2", "3", "4", "5", "6", "7", "1", "2", "3", "4", "5", "6", "7a", "7b", "8"]);
    expect(order.slice(order.indexOf("19"), order.indexOf("19") + 3)).toEqual(["19", "19a", "7b"]);
    expect(order.slice(-3)).toEqual(["18", "20", "21"]);
  });

  it("has a cello part the app can listen to, past its grace notes", () => {
    const listening = partListening(cello, playOrder(cello.measures));
    expect(listening.listenable).toBe(true);
    expect(partListening(piano, playOrder(piano.measures)).listenable).toBe(false);
  });
});
