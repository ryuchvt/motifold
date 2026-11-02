// Bounded failures in ordinary free-piano inputs. No model calls and no product changes.
import { describe, expect, it } from "vitest";
import { readBars, type ReadBarsInput } from "../server/shapes";
import { attacksOf, barsOf, mappedMidi, playedFromMidi, readWithinBars, type Played } from "./timing";

const played = (times: number[]): Played => ({
  notes: times.map((at, k) => ({ id: k + 1, at, end: at + 0.3, height: 60 + k, velocity: 64 })),
  pedal: [], claimed: { qpm: 120, beats: 4, beatType: 4 }, emptyBars: 0,
});
function checked(p: Played, meter: { beats: number; beatType: number }, starts: { attack: number; bars: number }[]) {
  const attacks = attacksOf(p);
  const input: ReadBarsInput = {
    title: null,
    attacks: attacks.map((a) => ({ k: a.k, at: a.at, bass: a.bass, pedal: a.pedalChange,
      notes: a.notes.map((n) => ({ id: n.id, name: "C4", velocity: n.velocity, held: n.end - n.at, at: n.at })) })),
    ghosts: [], periods: [], readings: [], claimed: { ...p.claimed, emptyBars: 0 }, ask: null,
  };
  expect(readBars.check(input, { meter, starts, why: "", phrases: [], time: [], slips: [], questions: [] })).toBeNull();
  return { attacks, reading: readWithinBars(attacks, meter, starts) };
}

describe("free-playing review contracts", () => {
  it("control: consecutive settled bars retain straight quarter-note timing", () => {
    const { reading } = checked(played([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]), { beats: 4, beatType: 4 }, [
      { attack: 0, bars: 1 }, { attack: 4, bars: 1 }, { attack: 8, bars: 1 },
    ]);
    expect(reading.place).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps the answer's first full bar numbered one when a pickup precedes it", () => {
    // A one-quarter upbeat into a plain waltz. The shape's prompt numbers phrases from its first start as 1.
    const { attacks, reading } = checked(played([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]), { beats: 3, beatType: 4 }, [
      { attack: 1, bars: 1 }, { attack: 4, bars: 1 }, { attack: 7, bars: 1 },
    ]);
    // Actual first full bar is numbered 2, so every displayed phrase is one bar early.
    expect(barsOf(attacks, reading).find((b) => b.attack === 1)?.number).toBe(1);
  });

  it("allows notes in the intervening bar when its downbeat is silent", () => {
    // Two straight 4/4 bars at 120, omitting only the second bar's downbeat.
    // The next struck downbeat is two bars later, which is exactly what starts[].bars describes.
    const { reading } = checked(played([0, 0.5, 1, 1.5, 2.5, 3, 3.5, 4]), { beats: 4, beatType: 4 }, [
      { attack: 0, bars: 1 }, { attack: 7, bars: 2 },
    ]);
    // Actual [0,.5,1,1.5,2.5,3,3.75,8] puts all intermediate notes in bar 1 and creates a 510-QPM empty bar.
    expect(reading.place).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  it("preserves a soft accidental key touch before the first musical attack in the MIDI", () => {
    const p = played(Array.from({ length: 8 }, (_, k) => 0.21 + k));
    p.notes.unshift({ id: 99, at: 0, end: 0.12, height: 50, velocity: 5 });
    const { attacks, reading } = checked(p, { beats: 3, beatType: 4 }, [
      { attack: 0, bars: 1 }, { attack: 3, bars: 1 }, { attack: 6, bars: 1 },
    ]);
    const back = playedFromMidi(mappedMidi(p, attacks, reading));
    // Its on/off both clamp to tick zero. Off sorts before on, so the note is absent on read-back.
    expect(back.notes).toHaveLength(p.notes.length);
  });
});
