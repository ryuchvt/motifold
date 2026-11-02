import type { Measure } from "./types";

export interface PlayedMeasure {
  measureIndex: number;
  /** Which time through this measure: 1 the first time, 2 after a repeat, and so on. */
  occurrence: number;
  /**
   * Which pass of the innermost repeat this is. Inside a repeat that an outer repeat plays twice, the
   * occurrences run 1 to 4 but the passes run 1, 2, 1, 2. Endings and time-only ties follow the pass
   * (recheck S2).
   */
  pass: number;
}

export interface PlayOrder {
  measures: PlayedMeasure[];
  /** Measures holding a D.C., D.S., coda or fine instruction. These are not played out. */
  jumpMeasures: number[];
  /** Measures that start an ending no pass ever reaches. */
  unreachableEndings: number[];
  /** Backward repeats with no partner, or a structure that would not terminate. */
  problems: string[];
}

const MAX_PASSES_PER_MEASURE = 16;

/**
 * Plays out repeats and first/second endings in performance order (TECH §3, ENGINE-SPEC §10).
 * A backward repeat returns to the nearest forward repeat before it, or to the start of the piece
 * or the end of the previous completed repeat when there is none. An ending is played on the passes
 * its numbers list, counted by the innermost repeat. Jumps (D.C., D.S., coda) are reported, never
 * guessed at.
 */
export function playOrder(measures: Measure[]): PlayOrder {
  const order: PlayedMeasure[] = [];
  const occurrences = new Map<number, number>();
  const jumpsTaken = new Map<number, number>();
  const reachedEndings = new Set<number>();
  const problems: string[] = [];

  // Open repeats, innermost last (review S1). The bottom frame has no forward sign: a backward
  // repeat without one goes back to the start, or to just after the last repeat that finished.
  interface Frame {
    start: number;
    pass: number;
    implicit: boolean;
  }
  const frames: Frame[] = [{ start: 0, pass: 1, implicit: true }];
  const top = () => frames[frames.length - 1]!;
  const finish = (end: number) => {
    // Reset the finished repeat's counters, so an outer repeat can play it all again.
    for (let j = top().start; j <= end; j++) jumpsTaken.delete(j);
    frames.pop();
    if (frames.length === 0) frames.push({ start: end + 1, pass: 1, implicit: true });
    else if (top().implicit) Object.assign(top(), { start: end + 1, pass: 1 });
  };
  let arrivedByJump = false;
  let i = 0;

  while (i < measures.length) {
    const m = measures[i]!;
    if (m.repeatForward && !arrivedByJump) frames.push({ start: i, pass: 1, implicit: false });
    arrivedByJump = false;
    const pass = top().pass;

    const endingStart = m.endings.find((e) => e.type === "start");
    if (endingStart && endingStart.numbers.length > 0 && !endingStart.numbers.includes(pass)) {
      // Skip this ending: go past the measure where it stops.
      const end = endingEnd(measures, i);
      i = end + 1;
      continue;
    }
    if (endingStart) reachedEndings.add(i);

    const occurrence = (occurrences.get(i) ?? 0) + 1;
    if (occurrence > MAX_PASSES_PER_MEASURE) {
      problems.push(`Measure ${m.number} would be played more than ${MAX_PASSES_PER_MEASURE} times.`);
      break;
    }
    occurrences.set(i, occurrence);
    order.push({ measureIndex: i, occurrence, pass });

    if (m.repeatBackward !== null) {
      const taken = jumpsTaken.get(i) ?? 0;
      if (taken < m.repeatBackward - 1) {
        jumpsTaken.set(i, taken + 1);
        top().pass += 1;
        i = top().start;
        arrivedByJump = true;
        continue;
      }
      finish(i);
    } else if (m.endings.some((e) => e.type !== "start" && e.numbers.includes(pass))) {
      // The last ending of a group closes without a backward repeat: the repeated section is over.
      finish(i);
    }
    i += 1;
  }

  // A segno or coda sign on its own is only a target. The instructions are what jump.
  const jumpMeasures = measures
    .filter((m) => m.jumps.some((j) => j !== "segno" && j !== "coda"))
    .map((m) => m.index);
  const unreachableEndings = measures
    .filter((m) => m.endings.some((e) => e.type === "start") && !reachedEndings.has(m.index))
    .map((m) => m.index);
  return { measures: order, jumpMeasures, unreachableEndings, problems };
}

/** The measure where the ending that starts at `start` stops (its own measure if it is one bar). */
function endingEnd(measures: Measure[], start: number): number {
  for (let j = start; j < measures.length; j++) {
    if (measures[j]!.endings.some((e) => e.type === "stop" || e.type === "discontinue")) return j;
    if (j > start && measures[j]!.endings.some((e) => e.type === "start")) return j - 1;
  }
  return start;
}
