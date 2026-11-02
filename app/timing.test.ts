import { describe, expect, it } from "vitest";
import { parseScore } from "../score";
import { attacksOf, barFacts, barsOf, closingCurve, evidenceOf, GHOST_VELOCITY, largestShiftMs, mappedMidi, periodsOf, playedFromMidi, readInMeter, readWithinBars, spreadOf, type Attack, type BarStart, type Played } from "./timing";
import { scoreOfReading } from "./timingScore";

const vlq = (v: number): number[] => {
  const out = [v & 127];
  for (let rest = v >> 7; rest > 0; rest >>= 7) out.unshift((rest & 127) | 128);
  return out;
};

/** A file as a DAW writes free playing: one tempo, one time signature, far from zero, and notes wherever they fell. */
function midiOf(notes: { tick: number; length: number; height: number; velocity: number }[], start = 0, pedal: { tick: number; value: number }[] = []): Uint8Array {
  const events = [
    { tick: start, data: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] },
    { tick: start, data: [0xff, 0x58, 4, 4, 2, 24, 8] },
    ...notes.flatMap((n) => [{ tick: n.tick, data: [0x90, n.height, n.velocity] }, { tick: n.tick + n.length, data: [0x80, n.height, 0] }]),
    ...pedal.map((p) => ({ tick: p.tick, data: [0xb0, 64, p.value] })),
  ].sort((a, b) => a.tick - b.tick);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  return new Uint8Array([...text("MThd"), ...be32(6), 0, 0, 0, 1, 1, 0xe0, ...text("MTrk"), ...be32(body.length), ...body]);
}

/** A waltz of bass and tune, then an inner note, then the tune again, every bar a little different in time, as played. */
function waltz(bars: number, rubato: (bar: number) => number = (b) => (b % 2 ? 3.3 : 2.8)): Played {
  const notes: Played["notes"] = [];
  let at = 0.02;
  let id = 1;
  const add = (time: number, height: number, velocity = 40, held = 2) => notes.push({ id: id++, at: time, end: time + held, height, velocity });
  for (let b = 0; b < bars; b++) {
    const seconds = rubato(b);
    const beat = 0.92;
    add(at, 48);
    add(at + 0.015, b % 2 ? 65 : 64);
    add(at + beat / 2, 59);
    add(at + beat, 71);
    at += seconds;
  }
  return { notes, pedal: [], claimed: { qpm: 120, beats: 4, beatType: 4 }, emptyBars: 0 };
}
const startsOf = (attacks: Attack[]): BarStart[] => attacks.filter((a) => a.notes.length > 1).map((a) => ({ attack: a.k, bars: 1 }));

describe("reading what a DAW wrote", () => {
  it("times notes from the file's own start, with their velocity and the pedal, and counts the empty bars", () => {
    const start = 1920 * 100;
    const played = playedFromMidi(midiOf([{ tick: start + 480, length: 240, height: 60, velocity: 33 }, { tick: start + 960, length: 480, height: 64, velocity: 70 }], start, [{ tick: start + 480, value: 127 }, { tick: start + 960, value: 0 }]));
    expect(played.notes.map((n) => [n.at, n.height, n.velocity])).toEqual([[0.5, 60, 33], [1, 64, 70]]);
    expect(played.notes[0]!.end).toBeCloseTo(0.75);
    expect(played.pedal).toEqual([{ at: 0.5, down: true }, { at: 1, down: false }]);
    expect(played.emptyBars).toBe(100);
  });

  it("groups what the hands struck together, and leaves out notes too soft to say anything about the pulse", () => {
    const played = waltz(2);
    played.notes.push({ id: 99, at: 1.3, end: 1.4, height: 70, velocity: GHOST_VELOCITY });
    const attacks = attacksOf(played);
    expect(attacks.map((a) => a.notes.length)).toEqual([2, 1, 1, 2, 1, 1]);
    expect(attacks.flatMap((a) => a.notes).some((n) => n.id === 99)).toBe(false);
    expect(spreadOf(attacks)).toHaveLength(2);
    expect(spreadOf(attacks)[0]!.lowFirst).toBe(true);
  });

  it("finds that the playing repeats at the bar, among its other levels", () => {
    const periods = periodsOf(attacksOf(waltz(16, () => 2.8)));
    expect(periods.some((p) => Math.abs(p.seconds - 2.8) < 0.1)).toBe(true);
  });
});

describe("rhythm and tempo together", () => {
  it("places the notes of settled bars however much the bars differ in seconds", () => {
    const attacks = attacksOf(waltz(8));
    const reading = readWithinBars(attacks, { beats: 3, beatType: 4 }, startsOf(attacks));
    expect(reading.place.slice(0, 6)).toEqual([0, 0.5, 1, 3, 3.5, 4]);
    const bars = barsOf(attacks, reading);
    expect(bars.map((b) => b.number).slice(0, 2)).toEqual([1, 2]);
    expect(bars[0]!.at).toBeCloseTo(0.02);
    expect(bars[1]!.at).toBeCloseTo(2.82);
    expect(bars[0]!.qpm).toBeCloseTo(180 / 2.8, 0);
  });

  it("doesn't call a slowed note a triplet", () => {
    const played = waltz(4);
    const late = played.notes[played.notes.length - 1]!;
    late.at += 0.25;
    const attacks = attacksOf(played);
    const reading = readWithinBars(attacks, { beats: 3, beatType: 4 }, startsOf(attacks));
    expect(reading.place.every((p) => Math.round(p * 12) % 3 === 0)).toBe(true);
  });

  it("gives every metre an answer to compare, with what counts as evidence", () => {
    const attacks = attacksOf(waltz(12));
    const three = evidenceOf(attacks, readInMeter(attacks, { beats: 3, beatType: 4 }, 3));
    expect(three.bassOnDownbeat.of).toBeGreaterThan(0);
    expect(three.tempoRange[0]).toBeLessThan(three.tempoRange[1]);
  });

  it("says how far each bar sits from a steady pulse, and describes a closing slowing", () => {
    const attacks = attacksOf(waltz(6, (b) => (b === 2 ? 4 : 3)));
    const reading = readWithinBars(attacks, { beats: 3, beatType: 4 }, startsOf(attacks));
    const facts = barFacts(attacks, reading);
    expect(facts[3]!.behindMs).toBeCloseTo(1000, -1);
    expect(closingCurve(attacks, 0).steps.length).toBeGreaterThan(1);
  });
});

describe("the tempo map", () => {
  const played = waltz(8);
  const attacks = attacksOf(played);
  const reading = readWithinBars(attacks, { beats: 3, beatType: 4 }, startsOf(attacks));

  it("moves no note in real time, keeps every note's velocity, and puts bars where they were found", () => {
    const back = playedFromMidi(mappedMidi(played, attacks, reading));
    expect(back.notes).toHaveLength(played.notes.length);
    const offset = back.notes[0]!.at - played.notes[0]!.at;
    expect(largestShiftMs(played, back, -offset)).toBeLessThan(3);
    expect(back.notes.map((n) => n.velocity)).toEqual(played.notes.map((n) => n.velocity));
    expect(back.claimed.beats).toBe(3);
  });

  it("carries the pedal across", () => {
    const withPedal = { ...played, pedal: [{ at: 0.1, down: true }, { at: 5, down: false }] };
    const back = playedFromMidi(mappedMidi(withPedal, attacks, reading));
    expect(back.pedal.map((p) => p.down)).toEqual([true, false]);
  });
});

describe("the notation", () => {
  const played = waltz(4);
  const attacks = attacksOf(played);
  const reading = readWithinBars(attacks, { beats: 3, beatType: 4 }, startsOf(attacks));
  const xml = scoreOfReading(played, attacks, reading, "Free");

  it("writes bars of the metre it found, one staff to a hand, by what a hand can reach", () => {
    const score = parseScore(xml);
    expect(score.parts.map((p) => p.name)).toEqual(["Piano upper", "Piano lower"]);
    expect(score.parts[0]!.measures).toHaveLength(4);
    expect(score.parts[0]!.measures[0]!.time).toEqual({ beats: 3, beatType: 4 });
    const pitched = (k: number) => score.parts[k]!.notes.filter((n) => !n.rest && !n.tieStop).map((n) => n.soundingMidi);
    expect(pitched(1).slice(0, 2)).toEqual([48, 59]);
    expect(pitched(0).slice(0, 2)).toEqual([64, 71]);
  });

  it("writes a tempo a renderer can read, carried in the bar and not in an empty direction", () => {
    expect(xml).not.toContain("<direction><sound");
    expect(parseScore(xml).parts[0]!.measures[0]!.tempos[0]!.qpm).toBeGreaterThan(0);
  });
});
