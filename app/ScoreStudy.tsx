import type { CSSProperties } from "react";
import { chordFits, harmonicRole, noteHeight, type HarmonicRole } from "./harmony";
import { noteRefKey, parseNoteRefKey } from "../render/drawScore";
import type { StudyMarks } from "../render/studyMarks";
import type { Part, Score } from "../score";
import { rhythmLengths, type StudyScoreAnswer, type StudyScoreInput } from "../server/shapes";
import { writtenTogether } from "./scoreInput";

type Written = StudyScoreInput["written"];
type Harmony = StudyScoreAnswer["harmony"][number];

type Role = HarmonicRole | "bridge";
const ROLE_WORDS: Record<Role, string> = { tonic: "Home", predominant: "Leading to the dominant", dominant: "Dominant", bridge: "Bridge into the next chord", other: "Elsewhere" };
/** What a mark is doing decides its colour, so a page can be skimmed for one kind of thing. */
const TONES = { lands: "Lands or arrives", pulls: "Pulls onward", moves: "Moves on", held: "Holds or repeats", with: "Between the parts" } as const;
type Tone = keyof typeof TONES;
const TONE_OF: Record<StudyScoreAnswer["moments"][number]["kind"], Tone> = { resolution: "lands", cadence: "lands", dominant: "pulls", "leading-tone": "pulls", modulation: "moves", bridge: "moves", pedal: "held", sequence: "held", climax: "lands", dialogue: "with", together: "with" };
const KIND_WORDS: Record<StudyScoreAnswer["moments"][number]["kind"], string> = {
  resolution: "Resolves",
  bridge: "Bridge",
  cadence: "Cadence",
  dominant: "Dominant",
  "leading-tone": "Leading tone",
  modulation: "New key",
  pedal: "Pedal",
  climax: "High point",
  sequence: "Sequence",
  dialogue: "Answers",
  together: "Together",
};
export const barsWords = (from: string, to: string) => (from === to ? `Bar ${from}` : `Bars ${from} to ${to}`);

/** Every note, in the order Muse Spark was told them, with where each bar's start. */
function allNotes(written: Written) {
  const names = written.flatMap((w) => w.notes.split(" ").filter(Boolean));
  const startOf = new Map<string, number>();
  let at = 0;
  for (const w of written) {
    startOf.set(w.bar, at);
    at += w.notes.split(" ").filter(Boolean).length;
  }
  return { names, startOf };
}

/** When each note of a bar starts, in crotchet beats. */
function startsIn(w: Written[number]): number[] {
  if (w.at) return w.at.split(" ").map(Number);
  let at = 0;
  return rhythmLengths(w.rhythm).map((length) => {
    const start = at;
    at += Number(length);
    return start;
  });
}

/** What the other parts sound while a chord lasts, and not on the bar's other beats, where the harmony may have moved on. */
function heardWhile(h: Harmony, next: Harmony | undefined, written: Written): string[] {
  const order = written.map((w) => w.bar);
  return order.slice(order.indexOf(h.from), order.indexOf(h.to) + 1).flatMap((bar) => {
    const w = written[order.indexOf(bar)]!;
    if (!w.others) return [];
    const beats = w.others.split("|");
    const beat = w.beat ?? 1;
    const starts = startsIn(w);
    const first = bar === h.from ? Math.floor((starts[(h.note ?? 1) - 1] ?? 0) / beat) : 0;
    const ending = next?.from === bar ? starts[(next.note ?? 1) - 1] : undefined;
    const last = bar === h.to && ending !== undefined ? Math.max(first + 1, Math.ceil(ending / beat)) : beats.length;
    return beats.slice(first, last).flatMap((sounding) => sounding.split(/[^A-Gb#]+/).filter(Boolean).map((name) => `${name}4`));
  });
}

/** What a limited check of each chord against its own notes says, up to where the next chord starts. It can't say the chord is the right reading. */
function checkedChords(answer: StudyScoreAnswer, written: Written): { h: Harmony; fits: boolean | null }[] {
  const { names, startOf } = allNotes(written);
  const order = written.map((w) => w.bar);
  const startAt = (h: Harmony) => (startOf.get(h.from) ?? 0) + (h.note ?? 1) - 1;
  return answer.harmony.map((h, i) => {
    const next = answer.harmony[i + 1];
    const afterTo = (startOf.get(order[order.indexOf(h.to) + 1] ?? "") ?? names.length);
    const end = next && startAt(next) < afterTo ? startAt(next) : afterTo;
    // With an accompaniment the harmony is mostly in the other parts, so what they sound while it lasts counts too.
    return { h, fits: h.chord === "pass" ? null : chordFits(h.chord, [...names.slice(startAt(h), end), ...heardWhile(h, next, written)]) };
  });
}

/** The chords it named on each bar, for the map and the score. */
export function chordsByBar(answer: StudyScoreAnswer, written: Written): Map<string, { h: Harmony; fits: boolean | null; role: Role }[]> {
  const order = written.map((w) => w.bar);
  const out = new Map<string, { h: Harmony; fits: boolean | null; role: Role }[]>();
  for (const { h, fits } of checkedChords(answer, written)) {
    const i = order.indexOf(h.from);
    const j = order.indexOf(h.to);
    if (i < 0 || j < i) continue;
    const entry = { h, fits, role: h.chord === "pass" ? ("bridge" as const) : harmonicRole(h.numeral) };
    for (const bar of order.slice(i, j + 1)) out.set(bar, [...(out.get(bar) ?? []), entry]);
  }
  return out;
}

/** Which bar of the part a study means. Printed numbers start again in each movement, so they only mean something within it. */
export function measureOfStudied(written: Written, bar: string): number {
  return written.find((w) => w.bar === bar)?.measure ?? -1;
}

const chordWords = (chord: string, ok: boolean | null) => `${chord}${ok === false ? " ?" : ""}`;
/** These go somewhere, so an arrow goes to the note they land on. */
const LANDING = new Set<StudyScoreAnswer["moments"][number]["kind"]>(["resolution", "cadence", "dominant", "leading-tone", "bridge", "dialogue"]);

/** The study as pencil on the score, in the score's own measure indexes and notes. With several parts, its numbers count through all of them. */
export function studyMarksOf(answer: StudyScoreAnswer, written: Written, studied: Part | Part[]): StudyMarks {
  const parts = Array.isArray(studied) ? studied : [studied];
  const order = written.map((w) => w.bar);
  const index = (bar: string) => measureOfStudied(written, bar);
  const keysOf = (bar: string) => {
    const at = index(bar);
    return at < 0 ? [] : writtenTogether(parts, at).map(({ note }) => noteRefKey(note.ref));
  };
  // Which part and staff each note is on, so a mark on one of them doesn't take in the others.
  const lines: Record<string, string> = {};
  const heights: Record<string, number> = {};
  for (const w of written) {
    for (const { note, part } of writtenTogether(parts, w.measure ?? -1)) {
      lines[noteRefKey(note.ref)] = `${part.id}:${note.staff}`;
      heights[noteRefKey(note.ref)] = note.pitch!.midi;
    }
  }
  const sections = answer.sections.flatMap((s, i) => {
    const [from, to] = [index(s.from), index(s.to)];
    const form = formOf(s, i);
    return from < 0 || to < from ? [] : [{ from, to, form, tint: tintOf(form), name: s.name, mood: s.mood?.trim() || null, what: s.what?.trim() || null }];
  });
  const chords = [...chordsByBar(answer, written)].flatMap(([bar, here]) => {
    const at = index(bar);
    // A stretch is written once, where its chord starts, as a musician would write it.
    const starting = here.filter(({ h }) => h.from === bar);
    const keys = keysOf(bar);
    return at < 0 ? [] : starting.map(({ h, fits: ok, role }, i) => {
      // A bridge is written as where it's going.
      const goal = answer.harmony.slice(answer.harmony.indexOf(h) + 1).find((n) => n.chord !== "pass" && n.chord !== "?");
      const chord = h.chord === "pass" ? (goal ? `\u2192 ${goal.chord}` : "\u2192") : chordWords(h.chord, ok);
      return { bar: at, noteKey: keys[(h.note ?? 1) - 1] ?? null, along: i / starting.length, chord, numeral: h.numeral, doubtful: ok === false || h.chord === "?", role };
    });
  });
  const passages = answer.moments.flatMap((m) => {
    const [from, to] = [order.indexOf(m.bar), order.indexOf(m.toBar ?? m.bar)];
    if (from < 0 || to < from) return [];
    const keys = order.slice(from, to + 1).flatMap((bar, i, bars) => {
      const inBar = keysOf(bar);
      return inBar.slice(i === 0 ? (m.note ?? 1) - 1 : 0, i === bars.length - 1 ? (m.toNote ?? inBar.length) : inBar.length);
    });
    // Its first and last notes say which lines it's about: one line, or what passes between two.
    const about = new Set([lines[keys[0]!], lines[keys[keys.length - 1]!]]);
    const own = keys.filter((key) => about.has(lines[key]));
    return own.length ? [{ keys: own, lands: LANDING.has(m.kind), tone: TONE_OF[m.kind] ?? "held", words: m.what }] : [];
  });
  // A composer's study has no places to focus first: that was for learning a piece.
  return { partId: parts.length === 1 ? parts[0]!.id : null, sections, chords, passages, focus: [], heights, lines };
}

/** How high and low the written line goes in each bar, as a shape. Measured from the notes, so it says nothing about how to play it. */
function rangeShape(written: Written): string {
  // The line on top: the solo, or a piano's right hand.
  const topLine = (w: Written[number]) => {
    const staves = w.staves?.split(" ");
    return w.notes.split(" ").filter((_, k) => !staves || staves[k] === "1");
  };
  const heights = written.map((w) => topLine(w).flatMap((n) => noteHeight(n) ?? []));
  const all = heights.flat();
  if (all.length === 0) return "";
  const [low, high] = [Math.min(...all), Math.max(...all)];
  const y = (h: number) => (high === low ? 50 : 96 - ((h - low) / (high - low)) * 92);
  const played = heights.flatMap((h, i) => (h.length ? [{ x: i + 0.5, top: y(Math.max(...h)), bottom: y(Math.min(...h)) }] : []));
  const up = played.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.top}`).join(" ");
  const down = [...played].reverse().map((p) => `L${p.x} ${p.bottom}`).join(" ");
  return `${up} ${down} Z`;
}

/** Its form letter with any primes, however it was written, or its place in the piece for an answer without one. */
const formOf = (s: StudyScoreAnswer["sections"][number], i: number) => {
  const found = /^([A-Za-z])(['′″\d]*)/.exec(s.form?.trim() ?? "");
  return found ? found[1]!.toUpperCase() + found[2]! : String.fromCharCode(65 + (i % 26));
};
/** The same idea gets the same tint however it's primed, so the eye sees A and A' belong together. */
const TINTS = 6;
const tintOf = (form: string) => (form.charCodeAt(0) - 65 + TINTS) % TINTS;

/** The thing to see first: a piece isn't this many bars, it's this many ideas. */
function ideasWords(answer: StudyScoreAnswer, written: Written): string {
  const ideas = new Set(answer.sections.map((s, i) => formOf(s, i)[0])).size;
  // The score's own count: a pickup and a second ending aren't more bars, and a movement's numbers start from its own beginning.
  const lastPrinted = /^\d+$/.test(written[written.length - 1]?.bar ?? "") ? Number(written[written.length - 1]!.bar) : written.length;
  return `${lastPrinted} bars, ${ideas} ${ideas === 1 ? "idea" : "ideas"}`;
}

/** The whole piece on one line, like the form chart a musician draws: its sections, how long each is and its harmony. */
export function StudyMap({ answer, written, onBar }: { answer: StudyScoreAnswer; written: Written; onBar: (bar: string) => void }) {
  const chords = chordsByBar(answer, written);
  const order = written.map((w) => w.bar);
  const shape = rangeShape(written);
  return (
    <figure className="study-map" style={{ "--bars": order.length } as CSSProperties}>
      <figcaption>
        <strong>{ideasWords(answer, written)}</strong>
        <span className="study-legend">
          {(Object.keys(TONES) as Tone[]).filter((tone) => tone !== "with" || answer.moments.some((m) => TONE_OF[m.kind] === "with")).map((tone) => (
            <span key={tone} className={`study-key pp-tone-${tone}`}>
              <span className="study-swatch tone" aria-hidden /> {TONES[tone]}
            </span>
          ))}
        </span>
        <span className="study-legend">
          {(Object.keys(ROLE_WORDS) as Role[]).map((role) => (
            <span key={role} className="study-key">
              <span className={`study-swatch ${role}`} aria-hidden /> {ROLE_WORDS[role]}
            </span>
          ))}
          {shape && (
            <span className="study-key">
              <span className="study-swatch range" aria-hidden /> Range of the line
            </span>
          )}
        </span>
      </figcaption>
      {shape && (
        <div className="form-range" title="How high and low the written line goes in each bar">
          <svg viewBox={`0 0 ${order.length} 100`} preserveAspectRatio="none" aria-hidden>
            <path d={shape} />
          </svg>
        </div>
      )}
      <ol className="form-sections">
        {answer.sections.map((s, i) => {
          const from = order.indexOf(s.from);
          const span = order.indexOf(s.to) - from + 1;
          return (
            <li key={`${s.from}-${s.name}`} style={{ gridColumn: `${from + 1} / span ${span}` }}>
              <button className="form-section" title={s.what} onClick={() => onBar(s.from)}>
                <span className="form-arc" aria-hidden />
                <span className="form-count">({span})</span>
                <span className="form-words">
                  <span className={`form-letter form-tint-${tintOf(formOf(s, i))}`}>{formOf(s, i)}</span> {s.name}
                </span>
                {s.mood?.trim() && <em className="form-mood">{s.mood.trim()}</em>}
              </button>
            </li>
          );
        })}
      </ol>
      <ol className="form-bars">
        {order.map((bar) => {
          const here = chords.get(bar) ?? [];
          const moment = answer.moments.find((m) => m.bar === bar);
          const words = [`Bar ${bar}`, ...here.map(({ h, fits: ok }) => `${chordWords(h.chord, ok)} ${h.numeral}`), ...(moment ? [`${KIND_WORDS[moment.kind]}: ${moment.what}`] : [])].join(", ");
          return (
            <li key={bar}>
              <button className={`form-bar ${here[0]?.role ?? "other"}`} title={words} aria-label={words} onClick={() => onBar(bar)} />
            </li>
          );
        })}
      </ol>
      <ol className="form-numbers" aria-hidden>
        {answer.sections.map((s) => (
          <li key={s.from} style={{ gridColumn: `${order.indexOf(s.from) + 1} / span 3` }}>
            {s.from}
          </li>
        ))}
      </ol>
    </figure>
  );
}


/** What isn't on the score: what the piece is, and how far to trust the chords. */
export function StudyWords({ answer, written }: { answer: StudyScoreAnswer; written: Written }) {
  const checked = checkedChords(answer, written).filter(({ h }) => h.chord !== "?" && h.chord !== "pass");
  const doubtful = checked.filter(({ fits }) => fits === false).length;
  return (
    <>
      <p className="arrange-said">{answer.overview}</p>
      <p className="spark-note">
        Muse Spark's reading of the notation, written on the score below. The word above each section is only its suggestion. {checked.length - doubtful} of the {checked.length} chords it named pass a limited check, which asks only whether enough of the chord's notes are written there. It doesn't test the numeral, the inversion or the key.
        {doubtful > 0 ? " A question mark means the check couldn't support that chord, not that the chord is wrong." : ""}
      </p>
    </>
  );
}

/** The marks moved onto a page that shows only some of the bars, measures `from` to `to` of the score they were made on. What's off the page is left out. */
export function marksOnPage(marks: StudyMarks, page: Score, from: number, to: number): StudyMarks {
  // A note's key counts it within its bar, so on the page only the bar moves.
  const moved = (key: string): string | null => {
    const ref = parseNoteRefKey(key);
    if (ref.measureIndex < from || ref.measureIndex > to || !page.parts.some((p) => p.id === ref.partId)) return null;
    return noteRefKey({ ...ref, measureIndex: ref.measureIndex - from });
  };
  const keyed = <T,>(record: Record<string, T> | undefined) => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(record ?? {})) {
      const now = moved(key);
      if (now) out[now] = value;
    }
    return out;
  };
  const inside = (bar: number) => bar >= from && bar <= to;
  return {
    ...marks,
    sections: marks.sections.filter((s) => s.to >= from && s.from <= to).map((s) => ({ ...s, from: Math.max(s.from, from) - from, to: Math.min(s.to, to) - from })),
    chords: marks.chords.filter((c) => inside(c.bar)).map((c) => ({ ...c, bar: c.bar - from, noteKey: c.noteKey ? moved(c.noteKey) : null })),
    passages: marks.passages.flatMap((p) => {
      const keys = p.keys.flatMap((k) => moved(k) ?? []);
      // Half a mark would point at the wrong arrival.
      return keys.length === p.keys.length ? [{ ...p, keys }] : [];
    }),
    focus: [],
    heights: keyed(marks.heights),
    lines: keyed(marks.lines),
  };
}
