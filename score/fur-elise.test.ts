import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findReturns, parseScoreFile, partListening, playOrder } from ".";

// scripts/fur-elise-to-musicxml.py made this file from Mutopia piece 931. Every note was also checked against Mutopia's own
// MIDI, and against what MuseScore reads from it, which aren't in this repo. This keeps what that check found.
const score = parseScoreFile(readFileSync("test-fixtures/fur-elise.musicxml")).score;
const part = score.parts[0]!;
const barOf = (number: string) => part.measures.find((m) => m.number === number)!;
const notesIn = (number: string, staff?: number) =>
  barOf(number).noteIndexes.map((i) => part.notes[i]!).filter((n) => !n.rest && !n.grace && (!staff || n.staff === staff));
const written = (n: { pitch: { step: string; alter: number; octave: number } | null }) => `${n.pitch!.step}${n.pitch!.alter > 0 ? "#" : n.pitch!.alter < 0 ? "b" : ""}${n.pitch!.octave}`;

describe("the Für Elise file", () => {
  it("has every bar and every note of the source", () => {
    expect(score.title).toBe("Für Elise, WoO 59");
    expect(score.composer).toBe("Ludwig van Beethoven");
    expect(part.measures).toHaveLength(106);
    expect(part.notes.filter((n) => !n.rest).length).toBe(905);
    expect(part.notes.filter((n) => n.grace).length).toBe(3);
    expect(part.staves).toBe(2);
  });

  it("numbers its bars as Mutopia's page prints them, with the second ending as 8a", () => {
    expect(part.measures.map((m) => m.number).slice(0, 11)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "8a", "9"]);
    expect(part.measures.at(-1)!.number).toBe("104");
    // A number at the start of each line of that page, and what's there.
    expect(notesIn("11", 1).map(written)[0]).toBe("C5");
    expect(notesIn("26", 1).map(written).slice(0, 2)).toEqual(["A5", "G5"]);
    expect(notesIn("82", 1).map(written)[0]).toBe("C#6");
  });

  it("keeps the sharps a pianist reads", () => {
    expect(notesIn("0", 1).map(written)).toEqual(["E5", "D#5"]);
    expect(notesIn("3", 1).map(written)).toEqual(["B4", "E4", "G#4", "B4"]);
  });

  it("has the opening's own rhythm and hands", () => {
    expect(notesIn("2", 1).map((n) => n.onset / score.ticksPerQuarter)).toEqual([0, 0.75, 1, 1.25]);
    expect(notesIn("2", 2).map(written)).toEqual(["A2", "E3", "A3"]);
    expect(part.notes.some((n) => n.rest && n.ref.measureIndex === barOf("2").index)).toBe(true);
  });

  it("has the chord over the pedal, and the triplets", () => {
    expect(notesIn("61", 1).map(written)).toEqual(["E4", "G4", "Bb4", "C#5"]);
    expect(new Set(notesIn("61", 1).map((n) => n.onset)).size).toBe(1);
    expect(notesIn("78", 1).map(written)).toEqual(["A3", "C4", "E4", "A4", "C5", "E5", "D5", "C5", "B4"]);
    expect(notesIn("78", 1)[1]!.onset / score.ticksPerQuarter).toBeCloseTo(1 / 6);
    // The 8va only changes how it's printed.
    expect(notesIn("80", 1).map(written)[4]).toBe("C7");
    expect(barOf("80").octaveShift).toBe(true);
  });

  it("plays the repeats and both pairs of endings in the right order", () => {
    const played = playOrder(part.measures);
    expect(played.problems).toEqual([]);
    expect(played.unreachableEndings).toEqual([]);
    const order = played.measures.map((p) => part.measures[p.measureIndex]!.number);
    expect(order.slice(0, 19)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "0", "1", "2", "3", "4", "5", "6", "7", "8a", "9"]);
    const second = order.indexOf("22");
    expect(order.slice(second - 1, second + 2)).toEqual(["21", "22", "9"]);
    expect(order.at(-1)).toBe("104");
    expect(order.includes("23")).toBe(true);
    expect(order.indexOf("23")).toBeGreaterThan(second);
  });

  it("is a score to study: a piano part isn't one the app can listen to", () => {
    expect(partListening(part, playOrder(part.measures)).listenable).toBe(false);
  });

  it("finds its refrain coming back", () => {
    const returns = findReturns(part).map((r) => [part.measures[r.target.from]!.number, part.measures[r.source.from]!.number]);
    expect(returns).toContainEqual(["15", "1"]);
    expect(returns).toContainEqual(["53", "1"]);
  });
});
