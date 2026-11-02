import { findReturns, type Measure, type Part, type Pitch, type PrintedNote, type Score } from "../score";
import type { StudyScoreInput } from "../server/shapes";
import { noteName } from "./notes";


/** The notes of a bar as Muse Spark is told them, so its note numbers can be found on the score. */
export function writtenNotes(part: Part, measure: Part["measures"][number]) {
  return measure.noteIndexes
    .map((i) => part.notes[i]!)
    .filter((n) => !n.rest && !n.hidden && !n.grace && !n.cue && n.pitch)
    .sort((a, b) => a.onset - b.onset);
}

/** The notes of a bar across parts, in the order they sound, as Muse Spark is told them when it gets the whole score. */
export function writtenTogether(parts: Part[], index: number): { note: PrintedNote; part: Part }[] {
  return parts
    .flatMap((part) => {
      const measure = part.measures[index];
      return measure ? writtenNotes(part, measure).map((note) => ({ note, part })) : [];
    })
    .sort((a, b) => a.note.onset - b.note.onset);
}

/** A note as the score writes it: a G sharp stays a G sharp, because it's what the player reads and it isn't an A flat in the harmony. */
export function writtenName({ step, alter, octave }: Pitch): string {
  return `${step}${alter > 0 ? "#".repeat(Math.round(alter)) : "b".repeat(Math.round(-alter))}${octave}`;
}

/** Ticks as crotchet beats. */
const crotchets = (ticks: number, ticksPerQuarter: number) => Math.round((ticks / ticksPerQuarter) * 1000) / 1000;

/** How long each note lasts in crotchet beats: 0.25x16, or 1 0.5 0.5. */
function rhythmOf(notes: { duration: number }[], ticksPerQuarter: number, most = 200): string {
  const lengths = notes.map((n) => crotchets(n.duration, ticksPerQuarter));
  const out: string[] = [];
  for (let i = 0; i < lengths.length; ) {
    let run = 1;
    while (lengths[i + run] === lengths[i]) run++;
    out.push(run > 1 ? `${lengths[i]}x${run}` : String(lengths[i]));
    i += run;
  }
  const rhythm = out.join(" ");
  // Cut at a whole length, because half of one would be a wrong one.
  return rhythm.length > most ? rhythm.slice(0, most).replace(/\s\S*$/, "") : rhythm;
}

/** One note straight after another from the start of the bar, so the rhythm alone says when each one starts. */
const isOneLine = (notes: { onset: number; duration: number }[]) => notes.every((n, i) => n.onset === (i === 0 ? 0 : notes[i - 1]!.onset + notes[i - 1]!.duration));

/** The signs the score prints in a bar that change what's played next. Words for Muse Spark, which never sees the page. */
function repeatWords(m: Measure): string[] {
  return [
    ...(m.repeatForward ? ["repeat starts"] : []),
    ...m.endings.filter((e) => e.type === "start").map((e) => `ending ${e.numbers.join(" and ")}`),
    ...(m.repeatBackward ? ["repeat back"] : []),
  ];
}

const PITCH_CLASSES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** What the other parts sound on each beat of a bar, the lowest in square brackets, in the player's own written pitch. */
function othersOf(score: Score, part: Part, index: number): string {
  const others = score.parts.filter((p) => p.id !== part.id);
  const measure = part.measures[index];
  if (others.length === 0 || !measure) return "";
  const own = part.notes.find((n) => n.pitch && n.soundingMidi !== null);
  const shift = own ? own.pitch!.midi - own.soundingMidi! : 0;
  const beat = (score.ticksPerQuarter * 4) / (measure.time?.beatType ?? 4);
  const beats: string[] = [];
  for (let b = 0; b < (measure.time?.beats ?? 4); b++) {
    const at = b * beat;
    const sounding = others.flatMap((p) => (p.measures[index]?.noteIndexes ?? []).map((i) => p.notes[i]!)).filter((n) => !n.rest && !n.grace && n.soundingMidi !== null && n.onset <= at && at < n.onset + n.duration);
    const heights = sounding.map((n) => Math.round(n.soundingMidi!) + shift);
    if (heights.length === 0) {
      beats.push("-");
      continue;
    }
    const counts = new Map<number, number>();
    for (const h of heights) counts.set(((h % 12) + 12) % 12, (counts.get(((h % 12) + 12) % 12) ?? 0) + 1);
    const lowest = PITCH_CLASSES[((Math.min(...heights) % 12) + 12) % 12];
    beats.push(`[${lowest}] ${[...counts].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([pc]) => PITCH_CLASSES[pc]).join(" ")}`);
  }
  return beats.join(" | ").slice(0, 300);
}

/** Only the notation: nothing about how anyone played. */
export function studyInput(score: Score, part: Part, from: number, to: number): StudyScoreInput {
  const measures = part.measures.slice(from, to + 1);
  const seen = new Set<string>();
  const written = measures.flatMap((m) => {
    if (seen.has(m.number)) return [];
    seen.add(m.number);
    const printed = writtenNotes(part, m);
    // A very busy bar still gets its first notes, cut at a whole note name.
    let names = printed.map((n) => writtenName(n.pitch!));
    while (names.join(" ").length > 400) names = names.slice(0, -1);
    const shown = printed.slice(0, names.length);
    const notes = names.join(" ");
    const rhythm = rhythmOf(shown, score.ticksPerQuarter);
    const marks = [...m.words, ...repeatWords(m)].join(" ").replace(/[^\x20-\x7e]/g, "").slice(0, 80).trim();
    // Without these a chord reads as a run of notes, and two hands as one line.
    const at = part.staves > 1 || !isOneLine(shown) ? shown.map((n) => crotchets(n.onset, score.ticksPerQuarter)).join(" ") : "";
    const staves = part.staves > 1 ? shown.map((n) => n.staff).join(" ") : "";
    const others = othersOf(score, part, part.measures.indexOf(m));
    // Printed numbers start again in each movement, so `measure` says which bar it really is, and `beat` is how long the
    // beats of `others` are, for the chord check. The server drops both.
    return [{ bar: m.number, notes, ...(rhythm ? { rhythm } : {}), ...(at ? { at } : {}), ...(staves ? { staves } : {}), ...(marks ? { marks } : {}), ...(others ? { others, beat: 4 / (m.time?.beatType ?? 4) } : {}), measure: part.measures.indexOf(m) }];
  });
  const number = (i: number) => part.measures[i]?.number ?? String(i + 1);
  const returns = findReturns(part)
    .filter((r) => r.target.from >= from && r.target.to <= to)
    .slice(0, 40)
    .map((r) => ({ from: number(r.target.from), to: number(r.target.to), likeFrom: number(r.source.from), likeTo: number(r.source.to), changed: r.changes.length }));
  const first = measures[0];
  return {
    piece: { title: score.title ?? null, composer: score.composer ?? null, instrument: part.name.replace(/\s+/g, " ").trim().slice(0, 80) || null },
    fifths: first?.key.fifths ?? 0,
    time: first?.time ? `${first.time.beats}/${first.time.beatType}` : null,
    written,
    returns,
  };
}

const plainName = (part: Part) => part.name.replace(/\s+/g, " ").trim().slice(0, 30) || part.id;
export const soundsAtAll = (part: Part) => part.notes.some((n) => !n.rest && !n.hidden && n.pitch);
/** A score with more staves than this is a whole orchestra, and it stays one line and what the others sound on each beat. */
const MOST_LINES = 32;
/** What the server takes, less a little for the rest of the call. */
const MOST_BYTES = 60 * 1024;

/** A DAW can name several tracks the same, and they still have to be told apart. */
function partLabels(parts: Part[]): Map<string, string> {
  const used = new Map<string, number>();
  return new Map(
    parts.map((part) => {
      const name = plainName(part);
      const k = (used.get(name) ?? 0) + 1;
      used.set(name, k);
      return [part.id, k > 1 ? `${name} ${k}` : name];
    }),
  );
}

/** Every part and staff, in score order, with the name Muse Spark is told it by. */
export function scoreLines(parts: Part[]): { label: string; partId: string; staff: number }[] {
  const labels = partLabels(parts);
  return parts.flatMap((part) =>
    Array.from({ length: part.staves }, (_, s) => ({
      label: part.staves === 1 ? labels.get(part.id)! : `${labels.get(part.id)!} ${["upper", "lower"][s] ?? `staff ${s + 1}`}`,
      partId: part.id,
      staff: s + 1,
    })),
  );
}

/** The parts a whole-score study reads, or null when it's a single part or too much to send. */
export function wholeScoreParts(score: Score): Part[] | null {
  const parts = score.parts.filter(soundsAtAll);
  const lines = parts.reduce((n, part) => n + part.staves, 0);
  return parts.length < 2 || lines > MOST_LINES ? null : parts;
}

/** A transposing part's notes are given as they sound, or the harmony read across parts would be wrong. */
export function nameInScore(note: PrintedNote, part: Part): string {
  const transposed = part.transposition && (part.transposition.chromatic !== 0 || part.transposition.octaveChange !== 0);
  return transposed && note.soundingMidi !== null ? noteName(note.soundingMidi) : writtenName(note.pitch!);
}

/**
 * Every part in full, so it reads a solo with its accompaniment as one piece of music, and can point at notes in either.
 * Null when there's one part, or when the score is too big, and then it gets a line and what the others sound on each beat.
 */
export function wholeScoreInput(score: Score, from: number, to: number): StudyScoreInput | null {
  const parts = wholeScoreParts(score);
  if (!parts) return null;
  const labels = partLabels(parts);
  const named = scoreLines(parts);
  const lines = named.map((l) => l.label);
  const lineOf = new Map(named.map((l, k) => [`${l.partId}:${l.staff}`, k + 1]));
  const lead = parts[0]!;
  const seen = new Set<string>();
  const written = lead.measures.slice(from, to + 1).flatMap((m) => {
    if (seen.has(m.number)) return [];
    seen.add(m.number);
    const index = lead.measures.indexOf(m);
    const together = writtenTogether(parts, index);
    let names = together.map(({ note, part }) => nameInScore(note, part));
    while (names.join(" ").length > 1200) names = names.slice(0, -1);
    const shown = together.slice(0, names.length);
    const rhythm = rhythmOf(shown.map(({ note }) => note), score.ticksPerQuarter, 1000);
    const at = shown.map(({ note }) => crotchets(note.onset, score.ticksPerQuarter)).join(" ");
    const staves = shown.map(({ note, part }) => lineOf.get(`${part.id}:${note.staff}`) ?? 1).join(" ");
    const held = shown.flatMap(({ note }, k) => (note.tieStop ? [k + 1] : [])).join(" ");
    const marks = [...new Set(parts.flatMap((part) => part.measures[index]?.words ?? [])), ...repeatWords(m)].join(" ").replace(/[^\x20-\x7e]/g, "").slice(0, 80).trim();
    return [{ bar: m.number, notes: names.join(" "), ...(rhythm ? { rhythm } : {}), ...(at ? { at } : {}), ...(staves ? { staves } : {}), ...(held ? { held } : {}), ...(marks ? { marks } : {}), measure: index }];
  });
  const number = (i: number) => lead.measures[i]?.number ?? String(i + 1);
  const returns = parts
    .flatMap((part) =>
      findReturns(part)
        .filter((r) => r.target.from >= from && r.target.to <= to)
        .map((r) => ({ from: number(r.target.from), to: number(r.target.to), likeFrom: number(r.source.from), likeTo: number(r.source.to), changed: r.changes.length, line: labels.get(part.id)! })),
    )
    .slice(0, 40);
  const first = lead.measures[from];
  const input: StudyScoreInput = {
    piece: { title: score.title ?? null, composer: score.composer ?? null, instrument: parts.map((part) => labels.get(part.id)!).join(" and ").slice(0, 80) },
    fifths: first?.key.fifths ?? 0,
    time: first?.time ? `${first.time.beats}/${first.time.beatType}` : null,
    written,
    returns,
    lines,
  };
  return JSON.stringify(input).length > MOST_BYTES ? null : input;
}


