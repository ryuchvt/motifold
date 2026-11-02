import type { Part, Pitch, PrintedNote } from "./types";

/** A note that differs where the music otherwise comes back unchanged. */
export interface ReturnChange {
  sourceMeasureIndex: number;
  sourceNoteIndex: number;
  measureIndex: number;
  noteIndex: number;
  from: Pitch;
  to: Pitch;
}

/** Bars `target` bring back bars `source`, note for note apart from `changes`. Indexes inclusive. */
export interface Return {
  partId: string;
  source: { from: number; to: number };
  target: { from: number; to: number };
  changes: ReturnChange[];
}

export interface ReturnOptions {
  /** Shortest passage worth naming, in bars. */
  minBars?: number;
  /** Fewest pitched notes the returning passage must hold, so held notes and rests don't count. */
  minNotes?: number;
}

type BarMatch = { kind: "exact" } | { kind: "change"; index: number } | null;

/** The notes a bar is compared on: everything that takes time, in order. Grace and hidden notes are left out. */
function barNotes(part: Part, measureIndex: number): PrintedNote[] {
  return part.measures[measureIndex]!.noteIndexes
    .map((i) => part.notes[i]!)
    .filter((n) => !n.grace && !n.hidden)
    .sort((a, b) => a.onset - b.onset || (a.pitch?.midi ?? -1) - (b.pitch?.midi ?? -1));
}

/** Same rhythm and rests, and at most one pitch different. */
function compareBars(a: PrintedNote[], b: PrintedNote[], lengthA: number, lengthB: number): BarMatch {
  if (lengthA !== lengthB || a.length !== b.length || a.length === 0) return null;
  let changed = -1;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.onset !== y.onset || x.duration !== y.duration || x.rest !== y.rest || x.tieStart !== y.tieStart) return null;
    if (x.rest) continue;
    if (x.pitch?.midi !== y.pitch?.midi || x.pitch?.step !== y.pitch?.step) {
      if (changed !== -1) return null;
      changed = i;
    }
  }
  return changed === -1 ? { kind: "exact" } : { kind: "change", index: changed };
}

/**
 * Finds passages that come back later in the part: note for note, or with one note changed in a
 * bar (M11's returns, the fact behind "the music comes back, one note doesn't"). The source always
 * ends before the return begins. When several earlier passages match the same return, the one with
 * the fewest changes, then the earliest, is kept.
 */
export function findReturns(part: Part, { minBars = 2, minNotes = 6 }: ReturnOptions = {}): Return[] {
  const count = part.measures.length;
  const notes = part.measures.map((_, i) => barNotes(part, i));
  const lengths = part.measures.map((m) => m.length);
  const match = (i: number, j: number) => compareBars(notes[i]!, notes[j]!, lengths[i]!, lengths[j]!);

  const candidates: Return[] = [];
  for (let distance = 1; distance < count; distance++) {
    let i = 0;
    while (i + distance < count) {
      if (!match(i, i + distance)) {
        i += 1;
        continue;
      }
      const start = i;
      const changes: ReturnChange[] = [];
      // Grow the run while bars keep matching and the source stays clear of the return.
      while (i + distance < count && i < start + distance) {
        const m = match(i, i + distance);
        if (!m) break;
        if (m.kind === "change") {
          const s = notes[i]![m.index]!;
          const t = notes[i + distance]![m.index]!;
          changes.push({
            sourceMeasureIndex: i,
            sourceNoteIndex: s.ref.noteIndex,
            measureIndex: i + distance,
            noteIndex: t.ref.noteIndex,
            from: s.pitch!,
            to: t.pitch!,
          });
        }
        i += 1;
      }
      const end = i - 1;
      const bars = end - start + 1;
      const pitched = notes.slice(start + distance, end + distance + 1).flat().filter((n) => !n.rest).length;
      if (bars >= minBars && pitched >= minNotes && changes.length * 2 <= bars) {
        candidates.push({
          partId: part.id,
          source: { from: start, to: end },
          target: { from: start + distance, to: end + distance },
          changes,
        });
      }
    }
  }

  // Keep the longest returns first; among equals, fewer changes, then the earliest source.
  candidates.sort(
    (a, b) =>
      b.target.to - b.target.from - (a.target.to - a.target.from) ||
      a.changes.length - b.changes.length ||
      a.source.from - b.source.from,
  );
  const kept: Return[] = [];
  for (const c of candidates) {
    const overlaps = kept.some((k) => c.target.from <= k.target.to && k.target.from <= c.target.to);
    if (!overlaps) kept.push(c);
  }
  return kept.sort((a, b) => a.target.from - b.target.from);
}
