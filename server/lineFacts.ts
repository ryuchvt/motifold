import { noteHeight } from "../app/notes";
import { rhythmLengths, type StudyScoreInput } from "./shapes";

/** What a stretch of one line does, measured from the notes. It says nothing about what the line means. */
export interface LineFact {
  line: string;
  from: string;
  to: string;
  notesPerBar: number;
  /** How many of its attacks strike two notes or more. */
  chordShare: number;
  /** How far it moves from one attack to the next, in semitones, on average. */
  meanStep: number;
  lowest: string;
  highest: string;
  /** Other lines that sound the same pitches, in any octave, for this share of its time. */
  doubledBy: { line: string; share: number }[];
}

const STEP = 0.25;
const SAME = 0.6;
const round = (n: number) => Math.round(n * 100) / 100;

/** Each line's notes in one bar, by staff number. */
function linesInBar(w: StudyScoreInput["written"][number]) {
  const names = w.notes.split(" ").filter(Boolean);
  const lengths = rhythmLengths(w.rhythm).map(Number);
  // A bar with no `at` is one note straight after another.
  let running = 0;
  const starts = w.at ? w.at.split(" ").map(Number) : lengths.map((length) => (running += length) - length);
  const staves = w.staves?.split(" ") ?? [];
  const held = new Set((w.held ?? "").split(" ").filter(Boolean).map(Number));
  const out = new Map<number, { name: string; height: number; start: number; length: number; held: boolean }[]>();
  names.forEach((name, k) => {
    const height = noteHeight(name);
    const line = Number(staves[k] ?? 1);
    if (height === null || !Number.isFinite(starts[k]) || !Number.isFinite(lengths[k])) return;
    if (!out.has(line)) out.set(line, []);
    out.get(line)!.push({ name, height, start: starts[k]!, length: lengths[k]!, held: held.has(k + 1) });
  });
  return out;
}

/** What a line sounds on each step of the bar, as pitch classes. */
function sounding(notes: { height: number; start: number; length: number }[]) {
  const grid = new Map<number, Set<number>>();
  for (const n of notes) {
    for (let at = Math.round(n.start / STEP); at < Math.round((n.start + n.length) / STEP); at++) {
      if (!grid.has(at)) grid.set(at, new Set());
      grid.get(at)!.add(((n.height % 12) + 12) % 12);
    }
  }
  return grid;
}

/**
 * For each line, its stretches of playing, and which other lines sound the same pitches meanwhile. A stretch ends where the
 * line stops or its partners change, because that's usually where its job changes. Nothing here decides what's a melody.
 */
export function lineFacts(input: StudyScoreInput): LineFact[] {
  const lines = input.lines ?? [input.piece.instrument ?? "The line"];
  const bars = input.written.map((w) => ({ bar: w.bar, lines: linesInBar(w) }));
  const facts: LineFact[] = [];
  lines.forEach((name, i) => {
    const line = i + 1;
    const partnersIn = (b: (typeof bars)[number]) => {
      const mine = sounding(b.lines.get(line) ?? []);
      if (mine.size === 0) return new Map<number, number>();
      const shares = new Map<number, number>();
      lines.forEach((_, j) => {
        if (j + 1 === line) return;
        const theirs = sounding(b.lines.get(j + 1) ?? []);
        let same = 0;
        // Both ways: a tune sitting inside another track's chord isn't that track doubling it.
        for (const [at, pcs] of mine) {
          const other = theirs.get(at);
          if (other && other.size === pcs.size && [...pcs].every((pc) => other.has(pc))) same++;
        }
        const share = same / mine.size;
        if (share >= SAME) shares.set(j + 1, share);
      });
      return shares;
    };
    let run: { from: number; to: number; partners: string } | null = null;
    const close = () => {
      if (!run) return;
      const span = bars.slice(run.from, run.to + 1);
      const notes = span.flatMap((b) => b.lines.get(line) ?? []);
      const played = notes.filter((n) => !n.held).sort((a, b) => a.start - b.start);
      const attacks = span.flatMap((b, k) => {
        const byStart = new Map<number, number[]>();
        for (const n of b.lines.get(line) ?? []) if (!n.held) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n.height]);
        return [...byStart].sort((x, y) => x[0] - y[0]).map(([, heights]) => ({ k, heights }));
      });
      const tops = attacks.map((a) => Math.max(...a.heights));
      const steps = tops.slice(1).map((t, k) => Math.abs(t - tops[k]!));
      const heights = notes.map((n) => n.height);
      const low = notes.find((n) => n.height === Math.min(...heights))!;
      const high = notes.find((n) => n.height === Math.max(...heights))!;
      const shared = new Map<number, number>();
      for (const b of span) for (const [j, share] of partnersIn(b)) shared.set(j, (shared.get(j) ?? 0) + share);
      facts.push({
        line: name,
        from: bars[run.from]!.bar,
        to: bars[run.to]!.bar,
        notesPerBar: round(played.length / span.length),
        chordShare: round(attacks.filter((a) => a.heights.length > 1).length / Math.max(attacks.length, 1)),
        meanStep: round(steps.reduce((sum, s) => sum + s, 0) / Math.max(steps.length, 1)),
        lowest: low.name,
        highest: high.name,
        doubledBy: [...shared].map(([j, total]) => ({ line: lines[j - 1]!, share: round(total / span.length) })).filter((d) => d.share >= SAME),
      });
      run = null;
    };
    bars.forEach((b, k) => {
      if (!b.lines.get(line)?.length) {
        close();
        return;
      }
      const partners = [...partnersIn(b).keys()].sort().join(",");
      if (run && run.partners === partners) run.to = k;
      else {
        close();
        run = { from: k, to: k, partners };
      }
    });
    close();
  });
  return facts;
}
