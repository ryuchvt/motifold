import type { PartListening } from "./listenable";
import { playOrder, type PlayedMeasure } from "./playOrder";
import type { NoteRef, Part, Score } from "./types";

/** Which bars to play: printed measures by index, inclusive, at one time through the music. */
export interface Passage {
  partId: string;
  fromMeasure: number;
  toMeasure: number;
  /** Bars played before the passage to get going. They are heard but not judged. */
  leadInBars: number;
  /** Which time through `fromMeasure` the passage starts at, when it is repeated. 1 = the first. */
  occurrence?: number;
}

/** A note the player is expected to sound. Tied notes are one expected note that keeps every printed note. */
export interface ExpectedNote {
  /** Position in the passage, lead-in included. Only for alignment. */
  index: number;
  /** Every printed note this sound covers, in order. The first is where it starts. */
  refs: NoteRef[];
  /** Which time through the music the starting bar is played. */
  occurrence: number;
  midi: number;
  hz: number;
  onsetMs: number;
  durationMs: number;
  /** Printed bar number and beat (in the time signature's beat unit, from 1) where it starts. */
  bar: string;
  beat: number;
  /** Heard but not judged: it starts before the passage. */
  leadIn: boolean;
}

/** A written rest, so a note played inside it can be caught (R5 T1). */
export interface ExpectedRest {
  onsetMs: number;
  durationMs: number;
  bar: string;
  occurrence: number;
  leadIn: boolean;
}

/** A bar Phrasepath can't listen to inside the passage: played through, never judged. */
export interface SkippedBar {
  measureIndex: number;
  bar: string;
  onsetMs: number;
  durationMs: number;
}

export type ExpectedResult =
  | {
      status: "ok";
      notes: ExpectedNote[];
      rests: ExpectedRest[];
      skipped: SkippedBar[];
      /** The passage's bars, end to end. */
      lengthMs: number;
      /** When the last sound ends: the end of the bars, or later when a tie runs on past them (recheck A1). */
      endMs: number;
    }
  | { status: "blocked"; measures: number[] }
  | { status: "not-found" };

export interface Tuning {
  /** Frequency of A4 in Hz. */
  a4: number;
}

const DEFAULT_TUNING: Tuning = { a4: 440 };

/** A tie marked for some repeat passes only (time-only) is a fresh attack on the others (review S2). */
const onPass = (passes: number[] | null, pass: number) => passes === null || passes.includes(pass);

/** The played measures a passage covers, lead-in first, found in performance order (R5 M1). */
export function passageMeasures(part: Part, passage: Passage): { played: PlayedMeasure[]; leadIn: number } | null {
  const order = playOrder(part.measures).measures;
  const wanted = passage.occurrence ?? 1;
  const start = order.findIndex((p) => p.measureIndex === passage.fromMeasure && p.occurrence === wanted);
  if (start < 0) return null;
  // End at the first arrival at the last bar after which the music doesn't go back inside the
  // passage. A repeat that starts within the passage is played out: a whole movement |: A B :| is
  // A B A B, not A B (recheck M2). A repeat that started before the passage is not: bars 9–10 of a
  // repeated 1–16 stay two bars. When the music leaves the passage without coming back to its last
  // bar, as |: A [1 B :| [2 C does for A to B, it ends the last time that bar was played (recheck M2).
  //
  // A repeat that goes back to before the passage isn't taken: B to D of |: A B C :| D is B C D, so
  // a context step can cross the end of an earlier repeat (recheck M2).
  const inside: PlayedMeasure[] = [];
  let end = -1;
  let lastArrival = -1;
  for (let i = start; i < order.length; i++) {
    const at = order[i]!.measureIndex;
    if (at < passage.fromMeasure && i > start) {
      const leftFrom = order[i - 1]!.measureIndex;
      while (i < order.length && order[i]!.measureIndex <= leftFrom) i++;
      i--;
      continue;
    }
    if (at < passage.fromMeasure || at > passage.toMeasure) break;
    inside.push(order[i]!);
    if (at !== passage.toMeasure) continue;
    lastArrival = inside.length;
    const next = order[i + 1];
    const goesBackInside = !!next && next.measureIndex <= at && next.measureIndex >= passage.fromMeasure;
    if (!goesBackInside) {
      end = inside.length;
      break;
    }
  }
  if (end < 0) end = lastArrival;
  if (end < 0) return null;
  const leadInStart = Math.max(0, start - Math.max(0, passage.leadInBars));
  return { played: [...order.slice(leadInStart, start), ...inside.slice(0, end)], leadIn: start - leadInStart };
}

/**
 * The notes and rests expected for a passage at a steady tempo (MODULES M2, ENGINE-SPEC §10).
 * Time 0 is the start of the first lead-in bar. Printed tempo changes are not followed: the player
 * practises at one chosen tempo.
 *
 * Ties at the edges follow one rule (R5 M2): a tied sound belongs to the bar where it starts. It is
 * kept whole, with every printed note it covers, even when it runs past the end of the passage. A
 * sound that started before the lead-in is still sounding when the take begins, so it is not
 * expected at all; its printed notes inside the passage are left unjudged.
 *
 * Bars that can't be listened to (chords, two voices: TECH §3) are skipped: no notes are expected
 * there, and a note tied out of one is already sounding. Only a passage with nothing left to judge
 * is refused.
 */
export function expectedNotes(
  score: Score,
  passage: Passage,
  qpm: number,
  listening?: PartListening,
  tuning: Tuning = DEFAULT_TUNING,
): ExpectedResult {
  const part = score.parts.find((p) => p.id === passage.partId);
  if (!part) return { status: "not-found" };
  const span = passageMeasures(part, passage);
  if (!span) return { status: "not-found" };

  const assessed = span.played.slice(span.leadIn);
  const isBlocked = (m: number) => listening?.blocked.has(m) ?? false;
  if (assessed.length > 0 && assessed.every((p) => isBlocked(p.measureIndex))) {
    return { status: "blocked", measures: [...new Set(assessed.map((p) => p.measureIndex))] };
  }

  const msPerTick = 60000 / qpm / score.ticksPerQuarter;
  const notes: ExpectedNote[] = [];
  const rests: ExpectedRest[] = [];
  const skipped: SkippedBar[] = [];
  /** Open tie chains by sounding pitch: the expected note still being held. */
  const open = new Map<number, ExpectedNote>();
  /** Tie chains already sounding when the take began, or tied out of a skipped bar: never expected (review S3). */
  const unjudged = new Set<number>();
  let barStart = 0;
  let afterSkip = false;

  span.played.forEach((played, position) => {
    const measure = part.measures[played.measureIndex]!;
    if (isBlocked(played.measureIndex)) {
      skipped.push({ measureIndex: played.measureIndex, bar: measure.number, onsetMs: barStart * msPerTick, durationMs: measure.length * msPerTick });
      open.clear();
      unjudged.clear();
      afterSkip = true;
      barStart += measure.length;
      return;
    }
    const tiedIn = position === 0 || afterSkip;
    afterSkip = false;
    const leadIn = position < span.leadIn;
    const ticksPerBeat = (4 * score.ticksPerQuarter) / (measure.time?.beatType ?? 4);
    const sounding = measure.noteIndexes
      .map((i) => part.notes[i]!)
      .filter((n) => !n.grace && !n.hidden)
      .sort((a, b) => a.onset - b.onset);

    for (const n of sounding) {
      const onsetMs = (barStart + n.onset) * msPerTick;
      const durationMs = n.duration * msPerTick;
      if (n.rest) {
        rests.push({ onsetMs, durationMs, bar: measure.number, occurrence: played.occurrence, leadIn });
        continue;
      }
      if (n.soundingMidi === null) continue;
      const tieStart = n.tieStart && onPass(n.tieStartPasses, played.pass);
      const tieStop = n.tieStop && onPass(n.tieStopPasses, played.pass);
      const held = tieStop ? open.get(n.soundingMidi) : undefined;
      if (held) {
        held.refs.push(n.ref);
        held.durationMs += durationMs;
      } else if (tieStop && (unjudged.has(n.soundingMidi) || (tiedIn && n.onset === 0))) {
        // Tied in from before the take began, or from a skipped bar: already sounding, nothing to
        // expect, through to the end of its chain.
        if (tieStart) unjudged.add(n.soundingMidi);
        else unjudged.delete(n.soundingMidi);
        continue;
      } else {
        const note: ExpectedNote = {
          index: notes.length,
          refs: [n.ref],
          occurrence: played.occurrence,
          midi: n.soundingMidi,
          hz: tuning.a4 * 2 ** ((n.soundingMidi - 69) / 12),
          onsetMs,
          durationMs,
          bar: measure.number,
          beat: Math.round((n.onset / ticksPerBeat + 1) * 100) / 100,
          leadIn,
        };
        notes.push(note);
        if (tieStart) open.set(n.soundingMidi, note);
      }
      if (!tieStart) open.delete(n.soundingMidi);
    }
    barStart += measure.length;
  });

  // A sound tied past the last bar is kept whole: follow the tie into the bars after the passage.
  if (open.size > 0) {
    const order = playOrder(part.measures).measures;
    const last = span.played.at(-1)!;
    let i = order.findIndex((p) => p.measureIndex === last.measureIndex && p.occurrence === last.occurrence) + 1;
    while (open.size > 0 && i < order.length) {
      const { measureIndex, pass } = order[i]!;
      const measure = part.measures[measureIndex]!;
      const stillTied = new Set<number>();
      for (const n of measure.noteIndexes.map((j) => part.notes[j]!)) {
        if (n.soundingMidi === null || !n.tieStop || !onPass(n.tieStopPasses, pass)) continue;
        const held = open.get(n.soundingMidi);
        if (!held) continue;
        held.refs.push(n.ref);
        held.durationMs += n.duration * msPerTick;
        if (n.tieStart && onPass(n.tieStartPasses, pass)) stillTied.add(n.soundingMidi);
      }
      for (const pitch of [...open.keys()]) if (!stillTied.has(pitch)) open.delete(pitch);
      i += 1;
    }
  }

  const lengthMs = barStart * msPerTick;
  const endMs = Math.max(lengthMs, ...notes.map((n) => n.onsetMs + n.durationMs));
  return { status: "ok", notes, rests, skipped, lengthMs, endMs };
}
