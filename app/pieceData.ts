// The whole piece as one picture: which notes each line plays and when, what each is doing, and how full the music is. Facts from the score, and
// roles from Muse Spark's reading when there is one. Nothing here needs a call.
import { noteHeight } from "./notes";
import type { Score } from "../score";
import type { PieceReading } from "../server/shapes";
import { fullBarBeats, type OptionCheck, type RoleFocus } from "./arrange";
import type { HeardNote } from "./audio/preview";
import { voiceOf } from "./audio/preview";
import { scoreLines } from "./scoreInput";

type Role = PieceReading["roles"][number]["role"];
export type NoteKind = Role | "new" | null;

export interface PieceNote {
  start: number;
  length: number;
  height: number;
  kind: NoteKind;
  /** How hard it's played, 1 to 127. Absent: nothing has said. */
  velocity?: number;
  /** Written by Muse Spark, whatever it's doing. */
  fresh?: boolean;
  /** Plucked. */
  pizz?: boolean;
}

/** What a new note's role shows as on the stage. Only a tune and a second tune stand out, and the rest is the texture they sit on. */
const KIND_OF_ROLE: Record<string, NoteKind> = { melody: "melody", countermelody: "countermelody", bass: "bass", harmony: "harmony", figure: "rhythm", rhythm: "rhythm", ornament: "rhythm", pedal: "pedal" };

/** The sections of an orchestra, which colour what's supporting. */
export function familyOf(name: string): string {
  if (/snare|bass drum|cymbal|tam-?tam|gong|triangle|timpani|glockenspiel|xylophone|marimba|vibraphone|tubular|percussion/i.test(name)) return "percussion";
  if (/harp|piano|celesta/i.test(name)) return "harp";
  if (/horn|trumpet|trombone|tuba|cornet/i.test(name) && !/english horn/i.test(name)) return "brass";
  if (/flute|piccolo|oboe|clarinet|bassoon|english horn|cor anglais/i.test(name)) return "winds";
  if (/violin|viola|cello|double bass|contrabass|string/i.test(name)) return "strings";
  return "other";
}

export interface PieceRow {
  label: string;
  notes: PieceNote[];
  low: number;
  high: number;
  /** It has the tune somewhere, so it gets the room to show its shape. */
  tall: boolean;
}

export interface PieceBar {
  number: string;
  start: number;
  length: number;
}

export interface PieceData {
  rows: PieceRow[];
  bars: PieceBar[];
  totalBeats: number;
  tempos: { beat: number; qpm: number }[];
  /** How many notes sound in each half beat, the composer's and the new ones apart. */
  fullness: { yours: number[]; added: number[] };
}

const WEIGHT = ["doubling", "harmony", "pedal", "rhythm", "bass", "countermelody", "melody"];

export function pieceData(score: Score, roles: PieceReading["roles"], bars: string[], more: { adds?: OptionCheck["adds"]; sourceBar?: (bar: string) => string } = {}): PieceData {
  const tpq = score.ticksPerQuarter;
  const lead = score.parts.find((p) => p.measures.length) ?? score.parts[0];
  const roleAt = new Map<string, Role>();
  for (const r of [...roles].sort((a, b) => WEIGHT.indexOf(a.role) - WEIGHT.indexOf(b.role))) {
    const [from, to] = [bars.indexOf(r.from), bars.indexOf(r.to)];
    if (from < 0 || to < from) continue;
    for (const bar of bars.slice(from, to + 1)) roleAt.set(`${r.line}|${bar}`, r.role);
  }
  const pieceBars: PieceBar[] = (lead?.measures ?? []).map((m) => ({ number: m.number, start: m.start / tpq, length: (m.length || m.nominalLength || 4 * tpq) / tpq }));
  const rows: PieceRow[] = scoreLines(score.parts).map(({ label, partId, staff }) => {
    const part = score.parts.find((p) => p.id === partId)!;
    const held = new Map<number, PieceNote>();
    const notes: PieceNote[] = [];
    for (const m of part.measures) {
      for (const i of m.noteIndexes) {
        const n = part.notes[i]!;
        if (n.staff !== staff || n.rest || n.grace || n.hidden || n.cue || n.soundingMidi === null) continue;
        const height = Math.round(n.soundingMidi);
        const length = n.duration / tpq;
        const running = n.tieStop ? held.get(height) : undefined;
        if (running) running.length += length;
        else {
          const note: PieceNote = { start: (m.start + n.onset) / tpq, length, height, kind: roleAt.get(`${label}|${more.sourceBar ? more.sourceBar(m.number) : m.number}`) ?? null, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}) };
          notes.push(note);
          if (n.tieStart) held.set(height, note);
        }
        if (!n.tieStart) held.delete(height);
      }
    }
    return { label, notes, low: 0, high: 0, tall: false };
  });
  // New notes go on the row they're for, or a row of their own, over bars that may not exist yet.
  const barLength = fullBarBeats(lead);
  const lastNumber = parseInt(pieceBars[pieceBars.length - 1]?.number ?? "0", 10) || pieceBars.length;
  const lastBar = pieceBars[pieceBars.length - 1];
  const endOfBars = lastBar ? lastBar.start + lastBar.length : 0;
  const startOf = (bar: string) => {
    const found = pieceBars.find((b) => b.number === bar);
    if (found) return found.start;
    const number = parseInt(bar, 10);
    return number > lastNumber ? endOfBars + (number - lastNumber - 1) * barLength : null;
  };
  for (const add of more.adds ?? []) {
    const start = add.measure !== undefined ? (pieceBars[add.measure]?.start ?? null) : startOf(add.bar);
    if (start === null) continue;
    let row = rows.find((r) => r.label === add.part) ?? rows.find((r) => r.label.replace(/ (upper|lower)$/, "") === add.part);
    if (!row) {
      row = { label: add.part, notes: [], low: 0, high: 0, tall: false };
      rows.push(row);
    }
    for (const e of add.events) for (const name of e.names) row.notes.push({ start: start + e.start, length: e.length, height: noteHeight(name)!, kind: (add.role && KIND_OF_ROLE[add.role]) || "new", fresh: true, ...(add.art === "pizz" ? { pizz: true } : {}), ...(e.velocity !== undefined ? { velocity: e.velocity } : {}) });
  }
  const lastEnd = Math.max(endOfBars, ...rows.flatMap((r) => r.notes.map((n) => n.start + n.length)));
  for (let next = endOfBars, number = lastNumber + 1; next < lastEnd - 1e-6; next += barLength, number++) pieceBars.push({ number: String(number), start: next, length: barLength });
  for (const row of rows) {
    const heights = row.notes.map((n) => n.height);
    row.low = heights.length ? Math.min(...heights) : 60;
    row.high = heights.length ? Math.max(...heights) : 60;
    row.tall = row.notes.some((n) => n.kind === "melody" || n.kind === "new");
  }
  const steps = Math.ceil(lastEnd * 2);
  const yours = Array.from({ length: steps }, () => 0);
  const added = Array.from({ length: steps }, () => 0);
  for (const row of rows) {
    for (const n of row.notes) {
      for (let k = Math.floor(n.start * 2 + 1e-6); k < Math.ceil((n.start + n.length) * 2 - 1e-6) && k < steps; k++) (n.kind === "new" ? added : yours)[k]!++;
    }
  }
  const tempos = (lead?.measures ?? []).flatMap((m) => m.tempos.map((t) => ({ beat: (m.start + t.onset) / tpq, qpm: t.qpm })));
  return { rows, bars: pieceBars, totalBeats: lastEnd, tempos, fullness: { yours, added } };
}

/** What to hear, which is what's in view: only the role picked out and the tracks soloed, if any. The tune sits forward of what supports it. */
export function notesToHear(data: PieceData, instrumentOf: (label: string) => string, focus: RoleFocus, solo: string[]): HeardNote[] {
  const level = (kind: NoteKind) => (kind === "melody" || kind === "new" ? 1 : kind === "countermelody" ? 0.85 : kind === "bass" ? 0.8 : kind === "doubling" ? 0.4 : 0.55);
  return data.rows.flatMap((row) => {
    if (solo.length && !solo.includes(row.label)) return [];
    const instrument = `${instrumentOf(row.label)} ${row.label}`;
    const voice = voiceOf(instrument);
    return row.notes.filter((n) => !focus || n.kind === focus || (focus === "new" && n.fresh)).map((n) => ({ start: n.start, length: n.length, height: n.height, voice, level: level(n.kind), instrument, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}), ...(n.pizz ? { pizz: true } : {}) }));
  });
}
