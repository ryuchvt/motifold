// What needs the composer's eye, at the bars it's about. All of it comes from what Muse Spark and the code actually said: nothing is
// flagged that they didn't flag, and a suggestion is worded as one ("Could add"), never as an error.
import { newBarNumbers } from "../server/shapes";
import { writingWindows } from "./arrange";
import { instrumentFromName } from "./orchestra";
import type { Arranged } from "./useArrange";

export type AttentionKind = "track" | "question" | "missing" | "unfinished" | "gap";

export interface Attention {
  id: string;
  kind: AttentionKind;
  from: string;
  to: string;
  /** The track it's about, for a marker on that lane. */
  line?: string;
  /** A few words for the marker's preview. */
  label: string;
  detail: string;
  why?: string;
  /** Which question or which plan it belongs to. */
  index?: number;
}

export const barsWords = (from: string, to: string) => (from === to ? `Bar ${from}` : `Bars ${from} to ${to}`);

export function attentionOf(arranged: Pick<Arranged, "piece" | "answered" | "options" | "trying" | "tracks" | "tracksConfirmed">): Attention[] {
  const { piece, answered, options, trying } = arranged;
  if (piece.status !== "ready") return [];
  const bars = piece.written.map((w) => w.bar);
  const first = bars[0] ?? "1";
  const last = bars[bars.length - 1] ?? first;
  const out: Attention[] = [];
  for (const line of piece.lines) {
    const guess = piece.answer.tracks?.find((t) => t.line === line);
    // A name that says what it is was never a guess, and one the composer has set isn't Muse Spark's any more.
    if (arranged.tracksConfirmed || !guess || guess.sure || instrumentFromName(line) || (arranged.tracks[line] ?? "") !== guess.instrument) continue;
    out.push({ id: `track:${line}`, kind: "track", from: first, to: last, line, label: `${line}: ${guess.instrument || "not sure"}?`, detail: `Muse Spark isn't sure what ${line} is.`, why: guess.why });
  }
  (piece.answer.questions ?? []).forEach((q, index) => {
    if (answered[index]?.trim()) return;
    out.push({ id: `question:${index}`, kind: "question", from: q.from, to: q.to, line: q.line, label: q.ask, detail: q.ask, index });
  });
  piece.answer.missing.forEach((m, k) => {
    out.push({ id: `missing:${k}`, kind: "missing", from: m.from, to: m.to, label: `Could add: ${m.what}`, detail: m.what, why: m.why });
  });
  if (options.status === "ready" && trying?.kind === "option") {
    const notes = options.notes[trying.index];
    if (notes?.status === "ready") {
      for (const m of notes.missing ?? []) out.push({ id: `unfinished:${m.from}`, kind: "unfinished", from: m.from, to: m.to, label: `${barsWords(m.from, m.to)} didn't finish`, detail: "This section didn't come back. It can be written again on its own.", index: trying.index });
    }
  }
  return out;
}

/** Each section of the plan on screen as it's written, in the order it's written: queued, writing, written or not finished. */
export function writingProgress(arranged: Pick<Arranged, "options" | "trying">): { from: string; to: string; state: "queued" | "writing" | "written" | "unfinished" }[] {
  const { options, trying } = arranged;
  if (options.status !== "ready") return [];
  // The plan on the score, or the one being written before its first section is back to put there.
  const busy = Object.entries(options.notes).find(([, n]) => n.status === "asking" || (n.status === "ready" && !!n.writing))?.[0];
  const index = trying?.kind === "option" ? trying.index : busy !== undefined ? Number(busy) : -1;
  const plan = options.plans[index];
  const notes = options.notes[index];
  if (!plan || !notes) return [];
  const bars = [...options.input.written.map((w) => w.bar), ...newBarNumbers(options.input)];
  const windows = writingWindows(plan.why, bars);
  const at = (bar: string) => bars.indexOf(bar);
  const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => at(a.from) <= at(b.to) && at(b.from) <= at(a.to);
  return windows.map((w) => {
    // Before the first section comes back, it's the first that's being written.
    if (notes.status === "asking") return { ...w, state: w === windows[0] ? ("writing" as const) : ("queued" as const) };
    if (notes.status !== "ready") return { ...w, state: "unfinished" as const };
    if (notes.missing?.some((m) => overlaps(m, w))) return { ...w, state: "unfinished" as const };
    if (notes.writing) {
      if (overlaps(notes.writing, w)) return { ...w, state: "writing" as const };
      return { ...w, state: at(w.from) < at(notes.writing.from) ? ("written" as const) : ("queued" as const) };
    }
    return { ...w, state: "written" as const };
  });
}
