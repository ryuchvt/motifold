// Moments the music has to hit, for writing to picture. A time is a fact, so the code turns it into a bar and a beat, and says what really
// happens there once something's written. Muse Spark decides how the music gets to it.
import type { Score } from "../score";
import type { PieceReading } from "../server/shapes";
import { fullBarBeats, type OptionCheck } from "./arrange";

export interface Cue {
  /** As the composer typed it, like 1:09.5. Empty for a marker read from a file, which already knows its beat. */
  time: string;
  what: string;
  /** Crotchets from the start of the first bar, from a marker in a MIDI file. */
  beats?: number;
}

export interface PlacedCue {
  what: string;
  /** Crotchets from the start of the first bar. */
  beats: number;
  bar: string;
  /** Crotchets from the start of the bar. */
  beat: number;
  seconds: number;
  /** Past the composer's last bar. */
  newBar: boolean;
  /** The tempo that would put it on the first beat of the nearest bar, if the tempo doesn't change before it. */
  landing: { bar: string; qpm: number; from: number } | null;
}

/** A time as a composer writes it: 69.5, 1:09.5, 0:01:09, or timecode at 24 frames, 00:01:09:12. Null if it isn't one. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (!text.trim() || parts.length > 4 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const [frames, seconds] = parts.length === 4 ? [Number(parts[3]) / 24, parts.slice(0, 3)] : [0, parts];
  return seconds.reduce((sum, p) => sum * 60 + Number(p), 0) + frames;
}

export function timeWords(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  const rest = (seconds - whole * 60).toFixed(1);
  return `${whole}:${rest.padStart(4, "0")}`;
}

/** How long the start of a bar takes, through whatever tempos are marked inside it. */
function secondsInto(steps: { beat: number; qpm: number }[], beats: number): number {
  let seconds = 0;
  steps.forEach((step, k) => {
    const until = Math.min(beats, steps[k + 1]?.beat ?? Infinity);
    if (until > step.beat) seconds += ((until - step.beat) * 60) / step.qpm;
  });
  return seconds;
}

/** How many beats into a bar this many seconds gets. */
function beatsInto(steps: { beat: number; qpm: number }[], seconds: number): number {
  let left = seconds;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k]!;
    const next = steps[k + 1];
    const takes = next ? ((next.beat - step.beat) * 60) / step.qpm : Infinity;
    if (left < takes) return step.beat + (left * step.qpm) / 60;
    left -= takes;
  }
  return 0;
}

/** Each bar's place in time, in the order given, on the same clock the preview plays by. */
function timeline(score: Score, order?: number[]) {
  const lead = score.parts[0]!;
  const tpq = score.ticksPerQuarter;
  const beatsOf = (k: number) => (lead.measures[k]!.length || lead.measures[k]!.nominalLength || 4 * tpq) / tpq;
  const firstMark = lead.measures.flatMap((m) => m.tempos)[0]?.qpm ?? 120;
  // A tempo stays until the next one, reading from the top of what was written.
  let running = firstMark;
  const stepsOf = lead.measures.map((m) => {
    const steps = [{ beat: 0, qpm: running }];
    for (const t of m.tempos) {
      const beat = t.onset / tpq;
      if (beat <= 1e-6) steps[0]!.qpm = t.qpm;
      else steps.push({ beat, qpm: t.qpm });
      running = t.qpm;
    }
    return steps;
  });
  let beat = 0;
  let seconds = 0;
  const bars = (order ?? lead.measures.map((_, k) => k)).map((k) => {
    const steps = stepsOf[k]!;
    const bar = { index: k, number: lead.measures[k]!.number, beat, seconds, beats: beatsOf(k), qpm: steps[0]!.qpm, endQpm: steps[steps.length - 1]!.qpm, steps };
    beat += bar.beats;
    seconds += secondsInto(steps, bar.beats);
    return bar;
  });
  return { bars, totalBeats: beat, totalSeconds: seconds, steady: new Set(stepsOf.flat().map((s) => s.qpm)).size === 1, newBar: fullBarBeats(lead) };
}

/** Where each moment falls in this score. Past the end, new bars carry on in the last metre at the last tempo. */
export function placeCues(cues: Cue[], score: Score, order?: number[]): PlacedCue[] {
  if (!score.parts[0]?.measures.length) return [];
  const { bars, totalBeats, totalSeconds, steady, newBar } = timeline(score, order);
  const last = bars[bars.length - 1]!;
  const lastNumber = parseInt(last.number, 10) || bars.length;
  const nameOf = (n: number) => (n < bars.length ? bars[n]!.number : String(lastNumber + n - bars.length + 1));
  return cues.flatMap((cue): PlacedCue[] => {
    const said = cue.beats ?? null;
    const heard = said === null ? parseTime(cue.time) : null;
    if (said === null && heard === null) return [];
    const inside = said === null ? [...bars].reverse().find((b) => b.seconds <= heard! + 1e-6) : [...bars].reverse().find((b) => b.beat <= said + 1e-6);
    const past = said === null ? heard! >= totalSeconds : said >= totalBeats;
    if (past) {
      const beats = said === null ? totalBeats + ((heard! - totalSeconds) * last.endQpm) / 60 : said;
      const over = beats - totalBeats;
      const add = Math.floor(over / newBar + 1e-6);
      const seconds = heard ?? totalSeconds + (over * 60) / last.endQpm;
      return [{ what: cue.what, beats, bar: String(lastNumber + add + 1), beat: round(over - add * newBar), seconds, newBar: true, landing: landing(beats, seconds, steady, last.endQpm, nameOf, bars, last.beat + last.beats, newBar) }];
    }
    const beatInBar = said === null ? beatsInto(inside!.steps, heard! - inside!.seconds) : said - inside!.beat;
    const beats = inside!.beat + beatInBar;
    const seconds = heard ?? inside!.seconds + secondsInto(inside!.steps, beatInBar);
    return [{ what: cue.what, beats, bar: inside!.number, beat: round(beatInBar), seconds, newBar: false, landing: landing(beats, seconds, steady, inside!.qpm, nameOf, bars, last.beat + last.beats, newBar) }];
  });
}

const round = (x: number) => Math.round(x * 100) / 100;

/** The classic sum for hitting a cue on the bar: beats before the bar, over the seconds it has to take. */
function landing(beats: number, seconds: number, steady: boolean, qpm: number, nameOf: (n: number) => string, bars: { beat: number }[], end: number, newBar: number): PlacedCue["landing"] {
  if (!steady || seconds <= 0) return null;
  const starts = bars.map((b) => b.beat);
  // Bars past the end are whole bars of the last metre.
  for (let next = end; next < beats + newBar * 2; next += newBar) starts.push(next);
  let nearest = 0;
  starts.forEach((s, n) => {
    if (Math.abs(s - beats) < Math.abs(starts[nearest]! - beats)) nearest = n;
  });
  if (Math.abs(starts[nearest]! - beats) < 0.05 || starts[nearest] === 0) return null;
  return { bar: nameOf(nearest), qpm: Math.round(((starts[nearest]! * 60) / seconds) * 10) / 10, from: qpm };
}

/** How many new bars it takes to reach the last moment. */
export function barsToReach(placed: PlacedCue[], score: Score): number {
  const last = parseInt(score.parts[0]?.measures.at(-1)?.number ?? "0", 10) || (score.parts[0]?.measures.length ?? 0);
  return placed.reduce((most, cue) => (cue.newBar ? Math.max(most, Number(cue.bar) - last) : most), 0);
}

const beatWords = (beat: number) => (beat === 0 ? "the first beat" : `beat ${round(beat + 1)}`);

export function cueWords(cue: PlacedCue): string {
  const where = `${timeWords(cue.seconds)} is bar ${cue.bar}, ${beatWords(cue.beat)}${cue.newBar ? ", in a new bar" : ""}.`;
  return cue.landing ? `${where} At ${cue.landing.qpm} and not ${cue.landing.from}, it would fall on the first beat of bar ${cue.landing.bar}.` : where;
}

/** Whether what was written really does something at each moment. It says what starts there, and leaves whether that's enough to the composer. */
export function cueHits(cues: PlacedCue[], check: OptionCheck): string[] {
  return cues.map((cue) => {
    const starting = check.adds.filter((a) => a.bar === cue.bar && a.events.some((e) => Math.abs(e.start - cue.beat) <= 0.25)).map((a) => a.part);
    const name = cue.what.trim() || timeWords(cue.seconds);
    return starting.length ? `${name}, bar ${cue.bar}: ${[...new Set(starting)].join(", ")} start${starting.length === 1 ? "s" : ""} there.` : `${name}, bar ${cue.bar}: nothing new starts there.`;
  });
}

/** With the composer's bars in a new order, which of their bars each moment falls in, and who has the tune there. */
export function orderHits(cues: Cue[], score: Score, order: { from: string; to: string }[], roles: PieceReading["roles"]): string[] {
  const lead = score.parts[0];
  if (!lead) return [];
  const numbers = lead.measures.map((m) => m.number);
  const indexes = order.flatMap(({ from, to }) => {
    const [a, b] = [numbers.indexOf(from), numbers.indexOf(to)];
    return a < 0 || b < a ? [] : numbers.slice(a, b + 1).map((_, k) => a + k);
  });
  if (!indexes.length) return [];
  const { bars, totalSeconds, totalBeats } = timeline(score, indexes);
  return cues.flatMap((cue) => {
    const said = cue.beats ?? null;
    const heard = said === null ? parseTime(cue.time) : null;
    if (said === null && heard === null) return [];
    const name = cue.what.trim() || cue.time;
    if (said === null ? heard! >= totalSeconds : said >= totalBeats) return [`${name}: this order ends before it.`];
    const inside = said === null ? [...bars].reverse().find((b) => b.seconds <= heard! + 1e-6)! : [...bars].reverse().find((b) => b.beat <= said + 1e-6)!;
    const beat = said === null ? beatsInto(inside.steps, heard! - inside.seconds) : said - inside.beat;
    const at = (r: PieceReading["roles"][number]) => numbers.indexOf(r.from) <= inside.index && inside.index <= numbers.indexOf(r.to);
    const tune = [...new Set(roles.filter((r) => r.role === "melody" && at(r)).map((r) => r.line))];
    return [`${name}: your bar ${inside.number}, ${beatWords(beat)}${tune.length ? `, where ${tune.join(" and ")} ${tune.length > 1 ? "have" : "has"} the melody` : ", with no melody marked there"}.`];
  });
}
