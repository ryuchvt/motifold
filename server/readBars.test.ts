import { describe, expect, it } from "vitest";
import { readBars, SHAPES, type ReadBarsInput } from "./shapes";

const attack = (k: number, at: number) => ({ k, at, notes: [{ id: k + 1, name: "C4", velocity: 40, held: 1, at }], bass: k % 2 === 0, pedal: false });
const input: ReadBarsInput = {
  title: null,
  attacks: [0, 1, 2, 3, 4, 5].map((k) => attack(k, k * 0.5)),
  ghosts: [{ id: 99, at: 0.7, name: "F3", velocity: 1 }],
  periods: [{ seconds: 1, strength: 1 }],
  readings: [{ meter: "3/4", barSeconds: 1, bars: 3, residualMs: 20, bassOn: 3, bassOf: 3, pedalOn: 0, pedalOf: 0, sameOn: 3, sameOf: 3, rhythm: "0 1", qpmLow: 100, qpmHigh: 120 }],
  claimed: { qpm: 120, beats: 4, beatType: 4, emptyBars: 1349 },
  ask: null,
};
const answer = (over = {}) => ({ meter: { beats: 3, beatType: 4 }, why: "The bass repeats", starts: [{ attack: 0, bars: 1 }, { attack: 2, bars: 1 }, { attack: 4, bars: 1 }], phrases: [{ fromBar: 1, toBar: 3, what: "One idea" }], time: [{ fromBar: 1, toBar: 3, what: "It leans" }], slips: [], questions: [], ...over });

describe("finding the bars", () => {
  it("judges can reach it, and it answers from the input it's given", () => {
    expect(SHAPES.read_bars).toBe(readBars);
    expect(readBars.devOnly).toBeUndefined();
    expect(readBars.parse(input)).toMatchObject({ claimed: { emptyBars: 1349 } });
    expect(readBars.check(input, answer())).toBeNull();
  });

  it("refuses input that isn't measured facts", () => {
    expect(readBars.parse({ ...input, attacks: [attack(0, 0)] })).toBeNull();
    expect(readBars.parse({ ...input, attacks: input.attacks.map((a) => ({ ...a, k: 0 })) })).toBeNull();
    expect(readBars.parse({ ...input, readings: [{ ...input.readings[0]!, meter: "waltz" }] })).toBeNull();
  });

  it("refuses bars that aren't there, out of order, or a metre nobody writes", () => {
    expect(readBars.check(input, answer({ starts: [{ attack: 4, bars: 1 }, { attack: 2, bars: 1 }] }))).toBe("bars out of order");
    expect(readBars.check(input, answer({ starts: [{ attack: 0, bars: 1 }, { attack: 40, bars: 1 }] }))).toBe("a bar start that isn't there");
    expect(readBars.check(input, answer({ meter: { beats: 40, beatType: 4 } }))).toBe("a metre nobody writes");
    expect(readBars.check(input, answer({ phrases: [{ fromBar: 1, toBar: 90, what: "Too far" }] }))).toBe("a phrase outside the bars");
  });

  it("keeps a good answer that mentions a number, because it's paid for and the bars are what matter", () => {
    expect(readBars.check(input, answer({ why: "It runs at 73 bpm" }))).toBeNull();
    expect(readBars.check(input, answer({ why: "Your coach would say so" }))).toBe("the words stray outside the music");
  });

  it("shows it every attack and tells it the file's grid means nothing", () => {
    const { instructions, input: text } = readBars.build(input);
    expect(instructions).toContain("Never change the metre to explain a slowing");
    expect(text).toContain("A0 0.000s 1:C4 v40");
    expect(text).toContain("1349 empty bars");
    expect(text).toContain("99:F3 v1");
  });
});
