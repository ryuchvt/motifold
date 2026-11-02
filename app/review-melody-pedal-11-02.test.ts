import { describe, expect, it } from "vitest";
import { parseScore } from "../score";
import { scoreTracks } from "./arrange";
import { attacksOf, type Played, type Reading } from "./timing";
import { scoreOfReading } from "./timingScore";

const reading: Reading = { meter: { beats: 4, beatType: 4 }, place: [0, 1, 2, 3, 4], tempo: [0.5, 0.5, 0.5, 0.5, 0.5], cost: 0 };
function melody(held: number, pedal: Played["pedal"] = []): Played {
  return { notes: [60, 62, 64, 65, 67].map((height, k) => ({ id: k + 1, at: k * 0.5, end: k * 0.5 + held, height, velocity: 64 })),
    pedal, claimed: { qpm: 120, beats: 4, beatType: 4 }, emptyBars: 0 };
}
function notes(p: Played) {
  return scoreTracks(parseScore(scoreOfReading(p, attacksOf(p), reading, "A freely played melody"))).flatMap((t) => t.notes);
}

describe("single-line notation pedal state", () => {
  it("writes short monophonic notes and leaves substantial silence as rests", () => {
    const p = melody(0.125);
    const score = parseScore(scoreOfReading(p, attacksOf(p), reading, "Melody"));
    expect(score.parts.map((part) => part.name)).toEqual(["Melody"]);
    expect(notes(p)[0]!.length).toBe(0.25);
  });
  it("closes a small legato hand gap to the next note under the stated notation policy", () => {
    expect(notes(melody(0.49))[0]!.length).toBe(1);
  });
  it("lets an actual pedal-down hold bridge the gap", () => {
    expect(notes(melody(0.125, [{ at: 0, down: true }, { at: 1, down: false }]))[0]!.length).toBe(1);
  });
  it("treats an ordinary initial CC64=0 as pedal up, preserving the same rests", () => {
    // DAWs commonly emit this reset even when the sustain pedal is never pressed.
    expect(notes(melody(0.125, [{ at: 0, down: false }]))).toEqual(notes(melody(0.125)));
  });
  it("preserves rests in a phrase played after the pedal has been released", () => {
    const p = melody(0.125, [{ at: 0, down: true }, { at: 0.5, down: false }]);
    // The third note starts at 1s, half a second after release. Actual notation still extends it to the next attack.
    expect(notes(p).find((n) => n.height === 64)!.length).toBe(0.25);
  });
});
