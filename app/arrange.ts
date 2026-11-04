// What the arranger's answers do to a score: moves the composer's notes onto the instruments they chose, checks every new note, puts it
// on the page, and packs it up as MIDI. A pitch or rhythm of theirs is never changed. Nothing here decides anything about the music.
import { XMLSerializer } from "@xmldom/xmldom";
import { zipSync } from "fflate";
import { noteHeight } from "./notes";
import { parseScore, type DynamicMark, type Part, type Score } from "../score";
import { parseXml } from "../score/file";
import { noteName } from "./notes";
import { newBarNumbers, type ArrangeInput, type DistributeAnswer, type OptionPlan, type PieceReading, type StudyScoreInput, type WriteAnswer } from "../server/shapes";
import { ONE_NOTE_AT_A_TIME } from "./orchestra";
import { nameInScore, scoreLines, soundsAtAll, studyInput, wholeScoreInput, wholeScoreParts } from "./scoreInput";
import { rangeOf } from "../shared/instrumentRanges";
export { rangeOf } from "../shared/instrumentRanges";

export type ArrangeOption = OptionPlan & WriteAnswer;
export type ArrangeStructure = PieceReading["structures"][number];

/** Crotchets are this many ticks in what we write, which holds 32nds and triplet 16ths. */
const DIV = 24;

/** The score as Muse Spark reads it: every part in full, or a lone line named as a one-track score. */
export function pieceInput(score: Score, part: Part, from: number, to: number): StudyScoreInput {
  // A melody laid out on one instrument leaves the rest of the template silent, and the first staff of that isn't the piece.
  const line = soundsAtAll(part) ? part : (score.parts.find(soundsAtAll) ?? part);
  const base = wholeScoreInput(score, from, to) ?? studyInput(score, line, from, to);
  // One piano part is still two lines, and its notes say which staff they're on.
  return { ...base, lines: base.lines ?? (line.staves > 1 ? scoreLines([line]).map((l) => l.label) : [base.piece.instrument ?? line.name]) };
}

/** What the arranger is asked. Bars can only go after the end of the score, or they'd land on what comes next. */
export function arrangeInput(
  score: Score,
  part: Part,
  from: number,
  to: number,
  ask: string | null,
  moreBars: number,
  reading: ArrangeInput["reading"],
  more: Partial<Pick<ArrangeInput, "instruments" | "where" | "tracks" | "answers" | "cues" | "source" | "freedom" | "intent">> = {},
): ArrangeInput {
  const reachesEnd = to >= (wholeScoreParts(score) ?? [part])[0]!.measures.length - 1;
  const where = more.where ?? "both";
  return { ...pieceInput(score, part, from, to), moreBars: reachesEnd && where !== "inside" ? moreBars : 0, ask: ask?.trim() || null, reading, instruments: more.instruments ?? null, where, tracks: more.tracks ?? [], answers: more.answers ?? [], cues: more.cues ?? [], ...(more.source ? { source: more.source } : {}), ...(more.freedom ? { freedom: more.freedom } : {}), ...(more.intent ? { intent: more.intent } : {}) };
}

export interface NewEvent {
  start: number;
  length: number;
  names: string[];
  /** Held into the next bar, or held over from the last, when these are the composer's own notes. */
  tieStart?: boolean;
  tieStop?: boolean;
  /** How hard it's played, 1 to 127. Absent: nothing has said. */
  velocity?: number;
}

/** Levels as MIDI velocities. A file's `sound dynamics` is a percentage of 90, which is what makes these the same numbers in MusicXML. */
const LEVELS: Record<string, number> = { ppp: 24, pp: 36, p: 50, mp: 64, mf: 80, f: 96, ff: 112, fff: 124 };
const DYN = /^(ppp|pp|p|mp|mf|f|ff|fff)(?:([<>])(ppp|pp|p|mp|mf|f|ff|fff))?$/;

export interface Dyn {
  from: string;
  /** Where a swell across the bar ends. */
  to: string | null;
  wedge: "crescendo" | "diminuendo" | null;
}

/** A level as Muse Spark writes it, like mp or p<mf. Anything else says nothing. */
export function readDyn(text: string | undefined): Dyn | null {
  const m = text ? DYN.exec(text.trim()) : null;
  return m ? { from: m[1]!, to: m[3] ?? null, wedge: m[2] === "<" ? "crescendo" : m[2] === ">" ? "diminuendo" : null } : null;
}

/** The velocity a level gives at this point of the bar. */
export function velocityIn(dyn: Dyn, at: number, barBeats: number): number {
  const from = LEVELS[dyn.from]!;
  if (!dyn.to) return from;
  return Math.round(from + (LEVELS[dyn.to]! - from) * Math.max(0, Math.min(1, at / Math.max(barBeats, 1e-6))));
}

const percent = (word: string) => Math.round(LEVELS[word]! / 0.09) / 10;

/** A level on the page and in playback: the mark before the notes, unless it hasn't changed, and the end of a swell after them. */
function dynMarks(dyn: Dyn | null, last: string | null, staffTag: string, say: "pizz." | "arco" | null = null): { before: string; after: string } {
  const direction = (inner: string, level?: string) => `<direction placement="below"><direction-type>${inner}</direction-type>${staffTag}${level ? `<sound dynamics="${percent(level)}"/>` : ""}</direction>`;
  return {
    before: (say ? `<direction placement="above"><direction-type><words>${say}</words></direction-type>${staffTag}</direction>` : "") + (dyn ? (dyn.from !== last ? direction(`<dynamics><${dyn.from}/></dynamics>`, dyn.from) : "") + (dyn.wedge ? direction(`<wedge type="${dyn.wedge}"/>`, dyn.from) : "") : ""),
    after: dyn?.to ? direction(`<wedge type="stop"/>`, dyn.to) : "",
  };
}

/** What's new on the page, with what a listener should follow picked out from what supports it. */
const TUNE_INK = "#d9531e";
const COUNTER_INK = "#2466d1";
const inkOf = (role: string | undefined, color: string | undefined) => (!color || color === FADED ? color : role === "melody" ? TUNE_INK : role === "countermelody" ? COUNTER_INK : color);

/** Sounding a Bb or F instrument's notes as its player reads them: how far up it's written, in steps and semitones, and what that does to the key. */
const TRANSPOSING: [RegExp, { diatonic: number; chromatic: number; fifths: number }][] = [
  [/bass clarinet/i, { diatonic: 8, chromatic: 14, fifths: 2 }],
  [/clarinet/i, { diatonic: 1, chromatic: 2, fifths: 2 }],
  [/trumpet|cornet/i, { diatonic: 1, chromatic: 2, fifths: 2 }],
  [/english horn|cor anglais/i, { diatonic: 4, chromatic: 7, fifths: 1 }],
  [/horn/i, { diatonic: 4, chromatic: 7, fifths: 1 }],
];

const STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** The same score with each Bb and F instrument written as its player reads it, for parts to play from. What it sounds doesn't change. */
export function transposedForPlayers(xmlText: string): string {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;
  const names = new Map(childrenOf(childrenOf(root, "part-list")[0]!, "score-part").map((p) => [p.getAttribute("id"), childrenOf(p, "part-name")[0]?.textContent ?? ""]));
  for (const part of childrenOf(root, "part")) {
    const rule = TRANSPOSING.find(([word]) => word.test(names.get(part.getAttribute("id")) ?? ""))?.[1];
    if (!rule) continue;
    const measures = childrenOf(part, "measure");
    const frames = measures.flatMap((m) => childrenOf(m, "attributes").flatMap((a) => childrenOf(a, "transpose")));
    // Supplied written frames, including a change of instrument, remain authoritative.
    if (frames.some((frame) => ["diatonic", "chromatic", "octave-change"].some((tag) => Number(childrenOf(frame, tag)[0]?.textContent ?? 0) !== 0))) continue;
    // Explicit zero frames are concert pitch. Replace them with the one written frame below.
    for (const frame of frames) frame.parentNode!.removeChild(frame);
    let first = true;
    for (const measure of measures) {
      for (const attributes of childrenOf(measure, "attributes")) {
        for (const key of childrenOf(attributes, "key")) {
          const fifths = childrenOf(key, "fifths")[0];
          if (fifths) fifths.textContent = String(Number(fifths.textContent) + rule.fifths);
        }
        if (first) {
          append(attributes, `<transpose><diatonic>${-rule.diatonic}</diatonic><chromatic>${-rule.chromatic}</chromatic></transpose>`);
          first = false;
        }
      }
      for (const note of childrenOf(measure, "note")) {
        const pitch = childrenOf(note, "pitch")[0];
        if (!pitch) continue;
        const step = childrenOf(pitch, "step")[0]!;
        const octave = childrenOf(pitch, "octave")[0]!;
        const alterEl = childrenOf(pitch, "alter")[0];
        const from = STEP_NAMES.indexOf(step.textContent!);
        const alter = Number(alterEl?.textContent ?? 0);
        const height = (Number(octave.textContent) + 1) * 12 + STEP_SEMITONES[from]! + alter + rule.chromatic;
        const place = from + rule.diatonic;
        const newStep = ((place % 7) + 7) % 7;
        const newOctave = Number(octave.textContent) + Math.floor(place / 7);
        const newAlter = height - ((newOctave + 1) * 12 + STEP_SEMITONES[newStep]!);
        step.textContent = STEP_NAMES[newStep]!;
        octave.textContent = String(newOctave);
        if (alterEl) pitch.removeChild(alterEl);
        if (newAlter) {
          const made = doc.createElement("alter");
          made.textContent = String(newAlter);
          pitch.insertBefore(made, octave);
        }
      }
    }
  }
  return serialize(doc);
}

/** Parts that only double another part, copied out exactly. What's written for a part in a bar wins over a doubling of it. */
export function withDoubles(answer: WriteAnswer, bars: string[]): WriteAnswer["adds"] {
  const out = [...answer.adds];
  for (const d of answer.doubles ?? []) {
    const from = bars.indexOf(d.from);
    const to = bars.indexOf(d.to);
    if (from < 0 || to < from || d.part === d.of) continue;
    for (const bar of bars.slice(from, to + 1)) {
      if (out.some((a) => a.part === d.part && a.bar === bar)) continue;
      for (const source of answer.adds.filter((a) => a.part === d.of && a.bar === bar)) {
        out.push({ part: d.part, bar, events: source.events.replace(/([A-G](?:##|bb|#|b)?)(-?\d)/g, (_, name: string, octave: string) => `${name}${Number(octave) + d.octave}`), ...(source.dyn ? { dyn: source.dyn } : {}), ...(source.role ? { role: source.role } : {}), ...(source.art ? { art: source.art } : {}) });
      }
    }
  }
  return out;
}

/** The bars one call writes at a time, keeping the plan's stretches whole where they fit, because a whole score in one call runs out of time. */
export function writingWindows(why: OptionPlan["why"], bars: string[], most = 8): { from: string; to: string }[] {
  const named = [...why].filter((w) => bars.includes(w.from) && bars.includes(w.to)).sort((a, b) => bars.indexOf(a.from) - bars.indexOf(b.from));
  const windows: { from: number; to: number }[] = [];
  for (const w of named) {
    let from = bars.indexOf(w.from);
    const to = bars.indexOf(w.to);
    const open = windows[windows.length - 1];
    if (open && from <= open.to) from = open.to + 1;
    if (from > to) continue;
    if (open && from === open.to + 1 && to - open.from + 1 <= most) {
      open.to = to;
      continue;
    }
    for (let at = from; at <= to; at += most) windows.push({ from: at, to: Math.min(at + most - 1, to) });
  }
  return windows.map((w) => ({ from: bars[w.from]!, to: bars[w.to]! }));
}

/** To the nearest sixteenth, or to a triplet where that's clearly nearer. Takes crotchets. */
export function snap(beats: number): number {
  const straight = Math.round(beats * 4) / 4;
  const triplet = Math.round(beats * 3) / 3;
  return Math.abs(beats - triplet) + 0.02 < Math.abs(beats - straight) ? triplet : straight;
}

/**
 * Events in the form Muse Spark writes them, and how many it wrote that couldn't be read. Each goes on the nearest place notation can show,
 * because a moment at 0.1 of a beat is exactly what it's told, and no one can read a rest that long.
 */
export function parseEvents(text: string): { events: NewEvent[]; unreadable: number } {
  const events: NewEvent[] = [];
  let unreadable = 0;
  type Token = { names: string[]; heights: Set<number>; start: number; end: number; on: number; off: number; held: boolean; event?: NewEvent };
  const tokens: Token[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const m = /^([^@]+)@([0-9.]+)\+([0-9.]+)$/.exec(token);
    const written = m ? m[1]!.split(",") : [];
    const held = written.some((name) => name.includes("~"));
    const names = held ? written.map((name) => name.replace(/~$/, "")) : written;
    const [start, length] = m ? [Number(m[2]), Number(m[3])] : [NaN, NaN];
    const end = start + length;
    if (!m || (held && !written.every((name) => name.endsWith("~"))) || !names.every((name) => noteHeight(name) !== null) || ![start, length, end].every(Number.isFinite) || !(length > 0)) {
      unreadable++;
      continue;
    }
    tokens.push({ names, heights: new Set(names.map((name) => noteHeight(name)!)), start, end, on: snap(start), off: snap(end), held });
  }
  // Only absorb floating-point arithmetic roundoff, not a musical gap or overlap.
  const sameTime = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * 4 * Math.max(1, Math.abs(a), Math.abs(b));
  const before = (a: number, b: number) => a < b && !sameTime(a, b);
  for (const token of tokens) {
    if (!token.held) {
      token.event = { start: token.on, length: token.off > token.on ? token.off - token.on : 0.25, names: token.names };
      events.push(token.event);
      continue;
    }
    const predecessors = tokens.filter((other) => other !== token && sameTime(other.end, token.start) && other.names.length === token.names.length && token.names.every((name) => other.names.includes(name)));
    const previous = predecessors.length === 1 ? predecessors[0] : undefined;
    // Look through the whole entry: a later-listed duplicate or overlapping attack
    // must not turn an ambiguous continuation into a guessed tie. Chords must be
    // held in their entirety; a mixed held/reattacked chord needs separate voices.
    const ambiguous = previous && tokens.some((other) => other !== token && other !== previous && [...token.heights].some((height) => other.heights.has(height)) && before(other.start, token.end) && before(previous.start, other.end));
    if (!previous?.event || token.heights.size !== token.names.length || previous.heights.size !== previous.names.length || ambiguous || !before(token.on, token.off) || !sameTime(previous.event.start + previous.event.length, token.on)) {
      unreadable++;
      continue;
    }
    // This is one attack. Keeping one event also keeps new-parts MIDI consistent
    // with the full score; the notation writer splits its length into tied pieces.
    previous.event.length = token.off - previous.event.start;
    token.event = previous.event;
  }
  return { events, unreadable };
}

/** Percussion with no pitch. Every hit is written on one note, which any DAW can map to its sound. */
export const UNPITCHED = /snare|bass drum|cymbal|tam-?tam|gong|triangle/i;

export interface OptionCheck {
  /** One part in one bar, kept only if it was safe to keep. */
  adds: {
    part: string;
    bar: string;
    events: NewEvent[];
    /** Which bar it really is in the score, because printed numbers start again in each movement. Absent for a new bar. */
    measure?: number;
    /** Its level in this bar, as written, like mp or p<mf. */
    dyn?: string;
    /** What it's doing, which is what picks it out on the page and the stage. */
    role?: string;
    /** Plucked, which goes on a track of its own. */
    art?: string;
  }[];
  notes: number;
  /** New notes that landed on a bar the composer already plays in, and were left out. */
  overBars: number;
  unreadable: number;
  pastBarEnd: number;
  outOfRange: { part: string; bar: string; name: string }[];
  /** Long notes a semitone or a minor ninth from something else sounding, which may be a good suspension. A major seventh isn't one. */
  clashes: { bar: string; part: string; name: string }[];
}

const lastTime = (part: Part) => [...part.measures].reverse().find((m) => m.time)?.time ?? null;

/** A whole bar of the piece's last metre, in crotchets, which is how long a new bar is even when the last one written is a short ending. */
export const fullBarBeats = (part: Part | undefined) => {
  const time = part ? lastTime(part) : null;
  return time ? (time.beats * 4) / time.beatType : 4;
};

const beatsOfBar = (part: Part, index: number, ticksPerQuarter: number) => {
  const m = part.measures[index];
  if (m?.length) return m.length / ticksPerQuarter;
  return m?.time ? (m.time.beats * 4) / m.time.beatType : fullBarBeats(part);
};

/** What the composer's own lines already sound in a bar, each as start, length and pitch. */
function soundingIn(score: Score, parts: Part[], index: number) {
  return parts.flatMap((part) =>
    (part.measures[index]?.noteIndexes ?? [])
      .map((i) => part.notes[i]!)
      .filter((n) => !n.rest && !n.grace && !n.hidden && n.soundingMidi !== null)
      .map((n) => ({ start: n.onset / score.ticksPerQuarter, length: n.duration / score.ticksPerQuarter, height: n.soundingMidi!, staff: n.staff, partId: part.id })),
  );
}

/** Checks every new note against the composer's notes and the instruments. It never changes what the composer wrote. */
export function checkOption(option: ArrangeOption, score: Score, input: ArrangeInput): OptionCheck {
  const parts = wholeScoreParts(score) ?? score.parts;
  const lines = scoreLines(parts);
  const bars = input.written.map((w) => w.bar);
  const newBars = newBarNumbers(input);
  const check: OptionCheck = { adds: [], notes: 0, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [], clashes: [] };
  const kept: { bar: string; part: string; start: number; length: number; height: number; name: string }[] = [];
  for (const add of option.adds) {
    const index = bars.indexOf(add.bar);
    if (index < 0 && !newBars.includes(add.bar)) {
      check.overBars++;
      continue;
    }
    const line = lines.find((l) => l.label === add.part) ?? lines.find((l) => l.label.replace(/ (upper|lower)$/, "") === add.part);
    const measure = index >= 0 ? (input.written[index]!.measure ?? index) : -1;
    if (line && index >= 0) {
      const part = parts.find((p) => p.id === line.partId)!;
      const plays = (part.measures[measure]?.noteIndexes ?? []).some((i) => {
        const n = part.notes[i]!;
        return n.staff === line.staff && !n.rest && !n.hidden;
      });
      if (plays) {
        check.overBars++;
        continue;
      }
    }
    const { events, unreadable } = parseEvents(add.events);
    check.unreadable += unreadable;
    const lead = parts[0]!;
    const length = measure >= 0 ? beatsOfBar(lead, measure, score.ticksPerQuarter) : fullBarBeats(lead);
    const range = rangeOf(add.part);
    const dyn = readDyn(add.dyn);
    const usable = events
      .filter((e) => {
        if (e.start + e.length > length + 1e-3) {
          check.pastBarEnd++;
          return false;
        }
        return true;
      })
      .map((e) => ({ ...e, ...(UNPITCHED.test(add.part) ? { names: ["C4"] } : {}), ...(dyn ? { velocity: velocityIn(dyn, e.start, length) } : {}) }));
    for (const e of usable) {
      for (const name of e.names) {
        const height = noteHeight(name)!;
        check.notes++;
        if (range && (height < range[1] || height > range[2])) check.outOfRange.push({ part: add.part, bar: add.bar, name });
        kept.push({ bar: add.bar, part: add.part, start: e.start, length: e.length, height, name });
      }
    }
    if (usable.length) check.adds.push({ part: add.part, bar: add.bar, events: usable, ...(measure >= 0 ? { measure } : {}), ...(dyn ? { dyn: add.dyn } : {}), ...(add.role ? { role: add.role } : {}), ...(add.art === "pizz" && /violin|viola|cello|double bass|contrabass|string/i.test(add.part) ? { art: "pizz" } : {}) });
  }
  for (const n of kept) {
    if (n.length < 1) continue;
    const index = bars.indexOf(n.bar);
    const measure = index >= 0 ? (input.written[index]!.measure ?? index) : -1;
    const theirs = measure >= 0 ? soundingIn(score, parts, measure) : [];
    const others = [...theirs, ...kept.filter((o) => o.bar === n.bar && o !== n)];
    if (others.some((o) => o.start < n.start + n.length && n.start < o.start + o.length && [1, 13].includes(Math.abs(o.height - n.height)))) {
      check.clashes.push({ bar: n.bar, part: n.part, name: n.name });
    }
  }
  return check;
}

/** An empty score of the shape a recomposition asks for, which `arrange` then writes on as it would anything else. */
export function emptyScore(title: string, instruments: string[], shape: { fifths: number; time: string; qpm: number; bars: number }): string {
  const [beats, beatType] = shape.time.split("/").map(Number) as [number, number];
  const barTicks = Math.round(((beats * 4) / beatType) * DIV);
  const fifths = Math.max(-7, Math.min(7, shape.fifths));
  const list = instruments.map((name, k) => `<score-part id="T${k + 1}"><part-name>${esc(name)}</part-name></score-part>`).join("");
  const parts = instruments.map((name, k) => {
    const [, sign, line] = CLEFS.find(([word]) => word.test(name)) ?? [null, "G", 2];
    const octaveShift = WRITTEN_OCTAVE.find(([word]) => word.test(name))?.[1] ?? 0;
    const attributes = `<attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>${sign}</sign><line>${line}</line></clef>${octaveShift ? `<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>${-octaveShift}</octave-change></transpose>` : ""}</attributes>`;
    const tempo = k === 0 ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${shape.qpm}</per-minute></metronome></direction-type><sound tempo="${shape.qpm}"/></direction>` : "";
    const measures = Array.from({ length: shape.bars }, (_, b) => `<measure number="${b + 1}">${b === 0 ? attributes + tempo : ""}<note><rest measure="yes"/><duration>${barTicks}</duration><voice>1</voice></note></measure>`).join("");
    return `<part id="T${k + 1}">${measures}</part>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><movement-title>${esc(title)}</movement-title><part-list>${list}</part-list>${parts.join("")}</score-partwise>`;
}

/**
 * How often a motif's shape comes back in what's new: as it was, upside down or backwards, in any key, allowing a semitone for keeping to the key. A fact to show, because
 * whether it sounds derived is the composer's to judge. Doublings aren't counted twice.
 */
export function motifSightings(check: Pick<OptionCheck, "adds">, heights: number[]): { same: number; inverted: number; backwards: number } {
  const found = { same: 0, inverted: 0, backwards: 0 };
  if (heights.length < 3) return found;
  const steps = heights.slice(1).map((h, k) => h - heights[k]!);
  const fits = (at: number[], shape: number[]) => shape.every((s, k) => Math.abs(at[k]! - s) <= 1 && Math.sign(at[k]!) === Math.sign(s));
  const lines = new Map<string, { at: number; height: number }[]>();
  const order = [...new Set(check.adds.map((a) => a.bar))];
  for (const add of check.adds) {
    const line = lines.get(add.part) ?? [];
    for (const e of add.events) line.push({ at: order.indexOf(add.bar) * 1000 + e.start, height: Math.max(...e.names.map((n) => noteHeight(n) ?? 0)) });
    lines.set(add.part, line);
  }
  const seen = new Set<string>();
  for (const line of lines.values()) {
    line.sort((a, b) => a.at - b.at);
    const moved = line.slice(1).map((n, k) => n.height - line[k]!.height);
    for (let k = 0; k + steps.length <= moved.length; k++) {
      const here = moved.slice(k, k + steps.length);
      const key = `${line[k]!.at}|${here.join(",")}`;
      if (seen.has(key) || here.every((s) => s === 0)) continue;
      const kind = fits(here, steps) ? "same" : fits(here, steps.map((s) => -s)) ? "inverted" : fits(here, [...steps].reverse().map((s) => -s)) ? "backwards" : null;
      if (kind) {
        seen.add(key);
        found[kind]++;
      }
    }
  }
  return found;
}

/** Stretches of two bars or more that the plan names and no note came back for, because its reasons read as if the notes were there. */
export function planGaps(why: OptionPlan["why"], check: OptionCheck, input: Pick<ArrangeInput, "written" | "moreBars">): { from: string; to: string }[] {
  const bars = [...input.written.map((w) => w.bar), ...newBarNumbers(input)];
  const wrote = new Set(check.adds.map((a) => a.bar));
  const named = new Set(why.flatMap((w) => bars.slice(bars.indexOf(w.from), bars.indexOf(w.to) + 1)));
  const gaps: { from: string; to: string; bars: number }[] = [];
  let open: (typeof gaps)[number] | null = null;
  for (const bar of bars) {
    if (named.has(bar) && !wrote.has(bar)) {
      if (open) {
        open.to = bar;
        open.bars++;
      } else {
        open = { from: bar, to: bar, bars: 1 };
        gaps.push(open);
      }
    } else open = null;
  }
  return gaps.filter((g) => g.bars >= 2).map(({ from, to }) => ({ from, to }));
}

/** An option with some of it left out, whole new parts or what's new in some bars, which the composer can choose after reading it on the score. */
export function withoutParts(check: OptionCheck, off: string[], bars: string[] = []): OptionCheck {
  const stays = (o: { part: string; bar: string }) => !off.includes(o.part) && !bars.includes(o.bar);
  const adds = check.adds.filter(stays);
  return {
    ...check,
    adds,
    notes: adds.reduce((sum, a) => sum + a.events.reduce((n, e) => n + e.names.length, 0), 0),
    outOfRange: check.outOfRange.filter(stays),
    clashes: check.clashes.filter(stays),
  };
}

/** What a length is written as: ticks, its note value, its dots, and whether it's a triplet. */
const TYPES: [number, string, number, boolean][] = [
  [96, "whole", 0, false],
  [72, "half", 1, false],
  [48, "half", 0, false],
  [36, "quarter", 1, false],
  [32, "half", 0, true],
  [24, "quarter", 0, false],
  [18, "eighth", 1, false],
  [16, "quarter", 0, true],
  [12, "eighth", 0, false],
  [9, "16th", 1, false],
  [8, "eighth", 0, true],
  [6, "16th", 0, false],
  [4, "16th", 0, true],
  [3, "32nd", 0, false],
  [2, "32nd", 0, true],
  [1, "64th", 0, true],
];

/** A length no single note can show, like 2.5 beats, as tied notes that can. */
function pieces(ticks: number): (typeof TYPES)[number][] {
  const out: (typeof TYPES)[number][] = [];
  let left = ticks;
  while (left > 0) {
    const fits = TYPES.find(([t]) => t <= left)!;
    out.push(fits);
    left -= fits[0];
  }
  return out;
}

const typeXml = ([, type, dots, triplet]: (typeof TYPES)[number]) => `<type>${type}</type>${"<dot/>".repeat(dots)}${triplet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : ""}`;

/** A gap as rests a player can read. Anything too small for that is just time passing. */
const restXml = (ticks: number, voice: number, staffTag: string) =>
  pieces(ticks)
    .map((piece) => (piece[0] < 3 ? `<forward><duration>${piece[0]}</duration></forward>` : `<note><rest/><duration>${piece[0]}</duration><voice>${voice}</voice>${typeXml(piece)}${staffTag}</note>`))
    .join("");

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STEPS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURALS = [0, 2, 4, 5, 7, 9, 11];

function pitchXml(name: string, octaveShift = 0): string {
  const m = /^([A-G])(##|bb|#|b)?(-?\d)$/.exec(name)!;
  const alter = { "#": 1, b: -1, "##": 2, bb: -2 }[m[2] ?? ""] ?? 0;
  return `<pitch><step>${m[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${Number(m[3]) + octaveShift}</octave></pitch>`;
}

/** A concert pitch as a transposing part writes it, keeping the interval's letter when the part says what it is. */
function writtenInFrame(name: string, transposition: NonNullable<Part["transposition"]>): string {
  const m = /^([A-G])(##|bb|#|b)?(-?\d)$/.exec(name)!;
  const height = noteHeight(name)! - transposition.chromatic - 12 * transposition.octaveChange;
  const octaves = Number(m[3]) - transposition.octaveChange;
  const sounding = STEPS.indexOf(m[1]!) + 7 * octaves;
  const letter = sounding - (transposition.diatonic ?? Math.round((transposition.chromatic * 7) / 12));
  const step = ((letter % 7) + 7) % 7;
  const octave = Math.floor(letter / 7);
  const alter = height - (NATURALS[step]! + 12 * (octave + 1));
  return Math.abs(alter) <= 2 ? `${STEPS[step]}${alter > 0 ? "#".repeat(alter) : "b".repeat(-alter)}${octave}` : noteName(height);
}

/** Instruments that always read an octave from where they sound, as any player expects to see them. What's written is sound plus this. */
const WRITTEN_OCTAVE: [RegExp, number][] = [
  [/contrabassoon|double bass|contrabass/i, 1],
  [/piccolo|celesta|xylophone/i, -1],
  [/glockenspiel/i, -2],
];

/** The clef each instrument reads. Anything else gets the one nearest its notes. */
const CLEFS: [RegExp, string, number][] = [
  [UNPITCHED, "percussion", 2],
  [/viola/i, "C", 3],
  [/cello|bassoon|trombone|tuba|timpani|double bass|contrabass/i, "F", 4],
  [/violin|flute|piccolo|oboe|clarinet|trumpet|horn|cor anglais|harp|celesta|glockenspiel|xylophone|vibraphone|marimba|tubular bells/i, "G", 2],
];

/** One staff of one bar. Notes struck and released together are a chord, and overlapping ones go in voices of their own. */
function staffXml(events: NewEvent[], staff: number | null, voiceBase: number, barTicks: number, color?: string, octaveShift = 0, transposition: Part["transposition"] = null, marks?: { before: string; after: string }): string {
  type Token = { start: number; ticks: number; names: string[]; tieStart: boolean; tieStop: boolean; velocities: Map<string, number> };
  const chords = new Map<string, Token[]>();
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    const names = [...new Set(e.names)];
    const token: Token = { start: Math.round(e.start * DIV), ticks: Math.max(1, Math.round(e.length * DIV)), names, tieStart: !!e.tieStart, tieStop: !!e.tieStop, velocities: new Map(e.velocity !== undefined ? names.map((name) => [name, e.velocity!]) : []) };
    const key = `${token.start}|${token.ticks}|${token.tieStart}|${token.tieStop}`;
    const group = chords.get(key) ?? [];
    // A shared pitch is another voice, not another note of the same chord.
    const same = group.find((chord) => token.names.every((name) => !chord.names.includes(name)));
    if (same) {
      // Each note of a chord keeps how hard it was struck.
      for (const name of token.names) {
        if (same.names.includes(name)) continue;
        same.names.push(name);
        if (token.velocities.has(name)) same.velocities.set(name, token.velocities.get(name)!);
      }
    } else {
      group.push(token);
      chords.set(key, group);
    }
  }
  const voices: Token[][] = [];
  for (const token of [...chords.values()].flat()) {
    const free = voices.find((v) => v[v.length - 1]!.start + v[v.length - 1]!.ticks <= token.start);
    if (free) free.push(token);
    else voices.push([token]);
  }
  const staffTag = staff ? `<staff>${staff}</staff>` : "";
  if (voices.length === 0) return `<note><rest/><duration>${barTicks}</duration><voice>${voiceBase}</voice>${staffTag}</note>`;
  let xml = marks?.before ?? "";
  let cursor = 0;
  voices.forEach((voice, v) => {
    if (v) {
      xml += `<backup><duration>${cursor}</duration></backup>`;
      cursor = 0;
    }
    // The first voice shows its rests, as any part would. The ones under it stay out of the way.
    const gap = (ticks: number) => (v === 0 ? restXml(ticks, voiceBase, staffTag) : `<forward><duration>${ticks}</duration></forward>`);
    for (const { start, ticks, names, tieStart, tieStop, velocities } of voice) {
      if (start > cursor) {
        xml += gap(start - cursor);
        cursor = start;
      }
      const split = pieces(ticks);
      split.forEach((piece, k) => {
        const ties = [...(k || tieStop ? ["stop"] : []), ...(k < split.length - 1 || tieStart ? ["start"] : [])];
        names.forEach((name, i) => {
          const velocity = velocities.get(name);
          xml += `<note${color ? ` color="${color}"` : ""}${velocity !== undefined ? ` dynamics="${Math.round(velocity / 0.09) / 10}"` : ""}>${i ? "<chord/>" : ""}${pitchXml(transposition ? writtenInFrame(name, transposition) : name, octaveShift)}<duration>${piece[0]}</duration>${ties.map((t) => `<tie type="${t}"/>`).join("")}<voice>${voiceBase + v}</voice>${typeXml(piece)}${staffTag}${ties.length ? `<notations>${ties.map((t) => `<tied type="${t}"/>`).join("")}</notations>` : ""}</note>`;
        });
        cursor += piece[0];
      });
    }
    if (v === 0 && cursor < barTicks) {
      xml += gap(barTicks - cursor);
      cursor = barTicks;
    }
  });
  if (cursor < barTicks) xml += `<forward><duration>${barTicks - cursor}</duration></forward>`;
  return xml + (marks?.after ?? "");
}

const childrenOf = (el: Element, name?: string) => {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!name || (n as Element).tagName === name)) out.push(n as Element);
  return out;
};

/** Adds XML to an element, as nodes from the same document. */
function append(parent: Element, xml: string): void {
  const fragment = parseXml(`<x>${xml}</x>`).documentElement;
  const doc = parent.ownerDocument!;
  for (let n = fragment.firstChild; n; n = n.nextSibling) parent.appendChild(doc.importNode(n, true));
}

const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc as never);

/** Keep timed marks in a template bar independent of the rests being replaced. */
function anchorTimedMarks(measure: Element): () => void {
  let cursor = 0;
  const atCursor: { el: Element; cursor: number }[] = [];
  const offsetOf = (el: Element) => Number(childrenOf(el, "offset")[0]?.textContent ?? 0);
  const offsetTo = (el: Element, value: number, before?: Element | null) => {
    const old = childrenOf(el, "offset")[0];
    if (!old && value === 0) return;
    const offset = old ?? el.ownerDocument!.createElement("offset");
    offset.textContent = String(value);
    if (!old) el.insertBefore(offset, before ?? null);
  };
  for (const el of childrenOf(measure)) {
    const duration = Number(childrenOf(el, "duration")[0]?.textContent ?? 0);
    if (el.tagName === "forward") cursor += duration;
    else if (el.tagName === "backup") cursor = Math.max(0, cursor - duration);
    else if (el.tagName === "note" && !childrenOf(el, "chord").length && !childrenOf(el, "grace").length) cursor += duration;
    else if (el.tagName === "sound") offsetTo(el, cursor + offsetOf(el));
    else if (el.tagName === "direction") {
      const oldOffset = childrenOf(el, "offset")[0];
      const playbackOffset = oldOffset?.getAttribute("sound") === "yes" ? offsetOf(el) : 0;
      const metronome = childrenOf(el, "direction-type").flatMap((type) => childrenOf(type, "metronome"))[0];
      if (metronome && !childrenOf(el, "sound").some((sound) => sound.hasAttribute("tempo"))) {
        // A metronome-only direction can have different printed and audible offsets.
        // Keep its original cursor without conflating them or changing its sound child.
        if (cursor) atCursor.push({ el, cursor });
        continue;
      }
      for (const sound of childrenOf(el, "sound")) {
        const own = childrenOf(sound, "offset")[0];
        offsetTo(sound, cursor + (own ? offsetOf(sound) : playbackOffset));
      }
      if (childrenOf(el, "direction-type").some((type) => ["dynamics", "wedge"].some((tag) => childrenOf(type, tag).length))) {
        offsetTo(el, cursor + offsetOf(el), childrenOf(el).find((child) => child.tagName !== "direction-type"));
      }
    }
  }
  return () => {
    for (const { el, cursor } of atCursor) {
      const nodes = parseXml(`<x><forward><duration>${cursor}</duration></forward><backup><duration>${cursor}</duration></backup></x>`).documentElement;
      measure.insertBefore(measure.ownerDocument!.importNode(nodes.firstChild!, true), el);
      measure.insertBefore(measure.ownerDocument!.importNode(nodes.lastChild!, true), el.nextSibling);
    }
  };
}

/**
 * The score with an option's notes on it, as new parts and new bars. The composer's bars are never opened. Notes for one of their
 * tracks in a bar it rests in go on a part of their own under the score, to merge or not. `color` marks what's new on the page.
 */
export function withOption(xmlText: string, score: Score, check: OptionCheck, color?: string): string {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;
  const parts = wholeScoreParts(score) ?? score.parts;
  const lines = scoreLines(parts);
  const lead = score.parts[0]!;
  const lineOf = (part: string) => lines.find((l) => l.label === part) ?? lines.find((l) => l.label.replace(/ (upper|lower)$/, "") === part);
  // A staff from a chosen template was written here, in our own ticks, and rests until there's something for it.
  const laidOut = (name: string) => score.parts.find((p) => LAID_OUT.test(p.id) && p.name === name);
  const barList = lead.measures.map((m) => m.number);
  // A new bar with nothing in it is still a bar, or everything after it lands a bar early.
  const lastNumber = parseInt(barList[barList.length - 1] ?? "0", 10) || barList.length;
  const furthest = Math.max(lastNumber, ...check.adds.filter((a) => !barList.includes(a.bar)).map((a) => Number(a.bar)));
  const newBars = Array.from({ length: furthest - lastNumber }, (_, k) => String(lastNumber + k + 1));
  const inOrder = [...barList, ...newBars];
  const levelOf = (part: string, bar: string | undefined) => readDyn(check.adds.find((a) => a.part === part && a.bar === bar)?.dyn);
  /** Whether a part was last plucked, looking back past any bars it rested in. */
  const pluckedBefore = (part: string, bar: string) => {
    for (let k = inOrder.indexOf(bar) - 1; k >= 0; k--) {
      const add = check.adds.find((a) => a.part === part && a.bar === inOrder[k]);
      if (add) return add.art === "pizz";
    }
    return false;
  };
  /** A part's level in a bar, marked only where it changes, and after a swell, where the page should say what it reached. Plucking is said when it starts and stops. */
  const marksOf = (part: string | undefined, bar: string, staffTag = "") => {
    if (!part) return undefined;
    const dyn = levelOf(part, bar);
    const plucked = check.adds.find((a) => a.part === part && a.bar === bar)?.art === "pizz";
    const before = pluckedBefore(part, bar);
    const say = plucked && !before ? "pizz." : !plucked && before && check.adds.some((a) => a.part === part && a.bar === bar) ? "arco" : null;
    if (!dyn && !say) return undefined;
    const last = levelOf(part, inOrder[inOrder.indexOf(bar) - 1]);
    return dynMarks(dyn, last && !last.to ? last.from : null, staffTag, say);
  };
  const roleIn = (part: string | undefined, bar: string) => check.adds.find((a) => a.part === part && a.bar === bar)?.role;
  // The composer's own, or kept from an option before this one, and either way it stays.
  const usedIds = new Set(childrenOf(root, "part").map((el) => el.getAttribute("id")));
  const lastBar = lastTime(lead) ?? { beats: 4, beatType: 4 };
  const fullBar = Math.round(((lastBar.beats * 4) / lastBar.beatType) * DIV);
  // Bars after the last, in every part the composer has, with whatever goes in them.
  for (const partEl of childrenOf(root, "part")) {
    const id = partEl.getAttribute("id")!;
    const part = score.parts.find((p) => p.id === id);
    if (!part) continue;
    if (LAID_OUT.test(id)) {
      const measures = childrenOf(partEl, "measure");
      for (const bar of new Set(check.adds.filter((a) => laidOut(a.part)?.id === id && barList.includes(a.bar)).map((a) => a.bar))) {
        const measure = measures.find((m) => m.getAttribute("number") === bar);
        const inScore = lead.measures[barList.indexOf(bar)]!;
        if (!measure) continue;
        const restoreCursors = anchorTimedMarks(measure);
        for (const tag of ["note", "forward", "backup"]) for (const el of childrenOf(measure, tag)) measure.removeChild(el);
        restoreCursors();
        const closing = childrenOf(measure, "barline").filter((line) => line.getAttribute("location") !== "left");
        for (const line of closing) measure.removeChild(line);
        append(measure, staffXml(check.adds.filter((a) => a.bar === bar && a.part === part.name).flatMap((a) => a.events), null, 1, Math.round((inScore.length / score.ticksPerQuarter) * DIV), inkOf(roleIn(part.name, bar), color), 0, part.transposition, marksOf(part.name, bar)));
        for (const line of closing) measure.appendChild(line);
      }
    }
    for (const bar of newBars) {
      let inside = `<attributes><divisions>${DIV}</divisions></attributes>`;
      for (let staff = 1; staff <= part.staves; staff++) {
        const here = check.adds.filter((a) => a.bar === bar && (laidOut(a.part)?.id === id || (lineOf(a.part)?.partId === id && lineOf(a.part)?.staff === staff)));
        const events = here.flatMap((a) => a.events);
        if (staff > 1) inside += `<backup><duration>${fullBar}</duration></backup>`;
        inside += staffXml(events, part.staves > 1 ? staff : null, staff === 1 ? 1 : 5, fullBar, inkOf(here[0]?.role, color), 0, part.transposition, marksOf(here[0]?.part, bar, part.staves > 1 ? `<staff>${staff}</staff>` : ""));
      }
      append(partEl, `<measure number="${bar}">${inside}</measure>`);
    }
  }
  // New parts, one to a name, under the composer's.
  const newName = (a: OptionCheck["adds"][number]) => (laidOut(a.part) ? null : !lineOf(a.part) ? a.part : barList.includes(a.bar) ? `${a.part} (added)` : null);
  const names = [...new Set(check.adds.flatMap((a) => newName(a) ?? []))];
  const list = childrenOf(root, "part-list")[0]!;
  const allBars = [...barList, ...newBars];
  names.forEach((name) => {
    let number = 1;
    while (usedIds.has(`A${number}`)) number++;
    const id = `A${number}`;
    usedIds.add(id);
    append(list, `<score-part id="${id}"><part-name>${esc(name)}</part-name></score-part>`);
    const mine = check.adds.filter((a) => newName(a) === name);
    const heights = mine.flatMap((a) => a.events.flatMap((e) => e.names.map((n) => noteHeight(n)!)));
    const low = heights.reduce((sum, h) => sum + h, 0) / Math.max(heights.length, 1) < 58;
    const [, sign, line] = CLEFS.find(([word]) => word.test(name)) ?? [null, low ? "F" : "G", low ? 4 : 2];
    const octaveShift = WRITTEN_OCTAVE.find(([word]) => word.test(name))?.[1] ?? 0;
    let xml = `<part id="${id}">`;
    let shownTime = "";
    let shownKey: number | null = null;
    allBars.forEach((bar, b) => {
      const measure = lead.measures[b];
      const ticks = measure ? Math.round((measure.length / score.ticksPerQuarter) * DIV) || fullBar : fullBar;
      const time = measure?.time ?? lastBar;
      const timeKey = `${time.beats}/${time.beatType}`;
      const key = measure?.key.fifths ?? shownKey ?? 0;
      const changes = [
        ...(b === 0 ? [`<divisions>${DIV}</divisions>`] : []),
        ...(key !== shownKey ? [`<key><fifths>${key}</fifths></key>`] : []),
        ...(timeKey !== shownTime ? [`<time><beats>${time.beats}</beats><beat-type>${time.beatType}</beat-type></time>`] : []),
        ...(b === 0 ? [`<clef><sign>${sign}</sign><line>${line}</line></clef>`] : []),
        ...(b === 0 && octaveShift ? [`<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>${-octaveShift}</octave-change></transpose>`] : []),
      ];
      shownTime = timeKey;
      shownKey = key;
      // A bar number a score uses twice, like a first ending or a new movement, takes the notes where they were asked for.
      const events = mine.filter((a) => (a.measure === undefined ? a.bar === bar && allBars.indexOf(bar) === b : a.measure === b)).flatMap((a) => a.events);
      xml += `<measure number="${bar}">${changes.length ? `<attributes>${changes.join("")}</attributes>` : ""}${staffXml(events, null, 1, ticks, inkOf(mine.find((a) => a.bar === bar)?.role, color), octaveShift, null, marksOf(mine.find((a) => a.bar === bar)?.part, bar))}</measure>`;
    });
    append(root, `${xml}</part>`);
  });
  return serialize(doc);
}

/**
 * The composer's own bars in a new order, which adds no notes. Each jump gets the time, key and clef that bar had, so it reads on its
 * own. Repeat signs go, because this is the order it plays in.
 */
export function withStructure(xmlText: string, structure: Pick<ArrangeStructure, "order">, keepNumbers = false): string {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;
  for (const partEl of childrenOf(root, "part")) {
    const measures = childrenOf(partEl, "measure");
    const at = new Map(measures.map((m, i) => [m.getAttribute("number")!, i]));
    const order = structure.order.flatMap(({ from, to }) => {
      const [a, b] = [at.get(from), at.get(to)];
      return a === undefined || b === undefined || b < a ? [] : measures.slice(a, b + 1).map((_, k) => a + k);
    });
    if (order.length === 0) continue;
    // What each bar inherits, as it would have been reading from the top.
    const states: Record<string, Element[]>[] = [];
    const state: Record<string, Element[]> = {};
    // The tempo running as each bar starts. A bar's own marks stay inside it, in their places.
    const tempos: (string | null)[] = [];
    let tempo: string | null = null;
    measures.forEach((m, i) => {
      tempos[i] = tempo;
      // A DAW can write a tempo straight in the bar, with no direction around it.
      for (const sound of [...childrenOf(m, "sound"), ...childrenOf(m, "direction").flatMap((direction) => childrenOf(direction, "sound"))]) tempo = sound.getAttribute("tempo") ?? tempo;
      for (const a of childrenOf(m, "attributes")) {
        for (const tag of ["divisions", "key", "time", "staves", "transpose"]) {
          const found = childrenOf(a, tag);
          if (found.length) state[tag] = found;
        }
        const clefs = childrenOf(a, "clef");
        if (clefs.length) {
          const kept = (state.clef ?? []).filter((c) => !clefs.some((n) => (n.getAttribute("number") ?? "1") === (c.getAttribute("number") ?? "1")));
          state.clef = [...kept, ...clefs];
        }
      }
      states[i] = { ...state };
    });
    const clones = order.map((source, k) => {
      const clone = measures[source]!.cloneNode(true) as Element;
      if (!keepNumbers) clone.setAttribute("number", String(k + 1));
      clone.removeAttribute("implicit");
      for (const line of childrenOf(clone, "barline")) clone.removeChild(line);
      if (k === 0 || order[k - 1]! + 1 !== source) {
        const attributes = doc.createElement("attributes");
        const before = states[Math.max(0, source - 1)]!;
        for (const tag of ["divisions", "key", "time", "staves", "clef", "transpose"]) {
          for (const el of (source === 0 ? (states[0]![tag] ?? []) : (before[tag] ?? []))) attributes.appendChild(el.cloneNode(true));
        }
        clone.insertBefore(attributes, clone.firstChild);
        // Moved bars keep the tempo they came from, ahead of their first note, or the timing to picture would drift.
        if (tempos[source]) clone.insertBefore(parseXml(`<sound tempo="${tempos[source]}"/>`).documentElement.cloneNode(true), attributes.nextSibling);
      }
      return clone;
    });
    // A note held into a bar that no longer follows it stops at the barline, and the bar that's come next attacks its own first note.
    clones.forEach((clone, k) => {
      if (k + 1 < clones.length && order[k]! + 1 !== order[k + 1]) cutTies(clone, "start");
      if (k > 0 && order[k - 1]! + 1 !== order[k]) cutTies(clone, "stop");
    });
    // The first and last bars of a cut hold into nothing, unless it's only the page looking at them.
    if (!keepNumbers && clones.length) {
      if (order[0]! > 0) cutTies(clones[0]!, "stop");
      if (order[order.length - 1]! < measures.length - 1) cutTies(clones[clones.length - 1]!, "start");
    }
    for (const m of measures) partEl.removeChild(m);
    for (const clone of clones) partEl.appendChild(clone);
  }
  return serialize(doc);
}

/** The ties that cross this bar's edge, taken off. One that starts and stops inside the bar is only how a long note is written, and stays. */
function cutTies(measure: Element, kind: "start" | "stop"): void {
  const ofTies = (note: Element, type: string) => [...childrenOf(note, "tie").filter((t) => t.getAttribute("type") === type), ...childrenOf(note, "notations").flatMap((n) => childrenOf(n, "tied").filter((t) => t.getAttribute("type") === type))];
  const placed: { note: Element; onset: number; end: number }[] = [];
  let cursor = 0;
  let last = 0;
  let end = 0;
  for (let n = measure.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const ticks = Number(childrenOf(el, "duration")[0]?.textContent ?? 0);
    if (el.tagName === "backup") cursor -= ticks;
    else if (el.tagName === "forward") cursor += ticks;
    else if (el.tagName === "note") {
      if (childrenOf(el, "grace").length) continue;
      const onset = childrenOf(el, "chord").length ? last : cursor;
      placed.push({ note: el, onset, end: onset + ticks });
      last = onset;
      cursor = onset + ticks;
    }
    end = Math.max(end, cursor);
  }
  for (const { note, onset, end: noteEnd } of placed) {
    if (kind === "start" ? noteEnd < end : onset > 0) continue;
    for (const tie of ofTies(note, kind)) tie.parentNode!.removeChild(tie);
  }
}

/** Parts this file laid out itself, whose bars can be filled in place. */
const LAID_OUT = /^T\d+$/;

export interface PlacedPart {
  name: string;
  /** By position in the score's bars. */
  bars: NewEvent[][];
  /** Playback levels, by position in the score's bars too, when the notes came from a part that had some. */
  levels?: BarLevel[][];
  /** The source's printed dynamics and wedges, independent of its playback levels. */
  dynamicMarks?: BarDynamicMark[][];
}

export type BarDynamicMark = Omit<DynamicMark, "onset" | "staff"> & { beat: number };

/** A level at its beat in crotchets from the barline. */
export interface BarLevel {
  beat: number;
  velocity: number;
}

export interface PlacedCheck {
  /** Only the tune was placed, and the rest of the sketch is material for what's written next. */
  material?: boolean;
  notes: number;
  /** Notes the plan placed. Anything else stays on a part of its own. */
  placed: number;
  notPlaced: { line: string; notes: number }[];
  /** Notes moved by an octave, by the plan. */
  moved: number;
  /** Notes that landed on the same pitch at the same moment as another, and became one. */
  merged: number;
  outOfRange: { part: string; bar: string; name: string }[];
  /** Bars where an instrument that plays one note at a time has more than one. */
  together: { part: string; bar: string }[];
  /** Grace notes, which aren't carried over. */
  grace: number;
  /** Lines of the plan that pointed at nothing, and were ignored. */
  ignored: number;
}

interface LineNote {
  start: number;
  length: number;
  height: number;
  name: string;
  tieStart: boolean;
  tieStop: boolean;
  placed: boolean;
  velocity?: number;
  voice: string;
}

type OpenTie<T> = { value: T; end: number; voice: string };
const sameTieTime = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(1, Math.abs(a), Math.abs(b));

/** A stop must continue an explicit, contiguous start. A voice change is safe only when the choice is unique. */
function takeTies<T, K>(open: Map<number, OpenTie<T>[]>, start: number, stops: { key: K; height: number; voice: string }[]): Map<K, OpenTie<T>> {
  const claimed = new Map<K, OpenTie<T>>();
  for (const height of new Set(stops.map((stop) => stop.height))) {
    const live = (open.get(height) ?? []).filter((tie) => tie.end > start || sameTieTime(tie.end, start));
    const predecessors = live.filter((tie) => sameTieTime(tie.end, start));
    const successors = stops.filter((stop) => stop.height === height);
    const pair = (tie: OpenTie<T>, stop: (typeof successors)[number]) => {
      claimed.set(stop.key, tie);
      predecessors.splice(predecessors.indexOf(tie), 1);
      successors.splice(successors.indexOf(stop), 1);
      live.splice(live.indexOf(tie), 1);
    };
    // Reserve voice-matched successors for the whole onset before considering a voice change.
    for (const voice of new Set(successors.map((stop) => stop.voice))) {
      const before = predecessors.filter((tie) => tie.voice === voice);
      const after = successors.filter((stop) => stop.voice === voice);
      if (before.length === 1 && after.length === 1) pair(before[0]!, after[0]!);
    }
    if (predecessors.length === 1 && successors.length === 1) pair(predecessors[0]!, successors[0]!);
    if (live.length) open.set(height, live);
    else open.delete(height);
  }
  return claimed;
}

function holdTie<T>(open: Map<number, OpenTie<T>[]>, height: number, tie: OpenTie<T>): void {
  open.set(height, [...(open.get(height) ?? []), tie]);
}

/** Printed fragments inside one bar are one event before placement or voice selection. */
function joinInBar(notes: LineNote[], ticksPerQuarter: number): LineNote[] {
  const open = new Map<number, OpenTie<LineNote>[]>();
  const order = new Map<LineNote, number>();
  const out: LineNote[] = [];
  const sorted = notes.map((note, index) => ({ note, index })).sort((a, b) => a.note.start - b.note.start || Number(b.note.tieStop) - Number(a.note.tieStop) || a.index - b.index);
  for (let from = 0; from < sorted.length;) {
    let to = from + 1;
    while (to < sorted.length && sameTieTime(sorted[from]!.note.start, sorted[to]!.note.start)) to++;
    const group = sorted.slice(from, to);
    const held = takeTies(open, group[0]!.note.start, group.filter(({ note }) => note.tieStop).map(({ note }) => ({ key: note, height: note.height, voice: note.voice })));
    for (const { note, index } of group) {
      const previous = held.get(note);
      const combined = previous?.value ?? { ...note };
      if (previous) {
        // Keep the source's integer tick grid, regardless of how the tie was printed.
        combined.length = (Math.round(note.start * ticksPerQuarter) + Math.round(note.length * ticksPerQuarter) - Math.round(combined.start * ticksPerQuarter)) / ticksPerQuarter;
        combined.tieStart = note.tieStart;
      } else {
        out.push(combined);
        order.set(combined, index);
      }
      if (note.tieStart) holdTie(open, note.height, { value: combined, end: note.start + note.length, voice: note.voice });
    }
    from = to;
  }
  return out.sort((a, b) => order.get(a)! - order.get(b)!);
}

/** Every line of a score, bar by bar, as the notes that sound, with how many there are and how many grace notes aren't counted among them. */
function readLines(score: Score, input: StudyScoreInput): { lines: Map<string, LineNote[][]>; levels: Map<string, BarLevel[][]>; dynamicMarks: Map<string, BarDynamicMark[][]>; notes: number; grace: number } {
  const source = wholeScoreParts(score) ?? score.parts;
  const measures = input.written.map((w, k) => w.measure ?? k);
  let notes = 0;
  let grace = 0;
  const levels = new Map<string, BarLevel[][]>();
  const dynamicMarks = new Map<string, BarDynamicMark[][]>();
  const lines = new Map(
    scoreLines(source).map((line) => {
      const part = source.find((p) => p.id === line.partId)!;
      levels.set(line.label, measures.map((m) => (part.measures[m]?.levels ?? []).map((l) => ({ beat: l.onset / score.ticksPerQuarter, velocity: l.velocity }))));
      dynamicMarks.set(line.label, measures.map((m) => (part.measures[m]?.dynamicMarks ?? []).filter((mark) => !mark.staff || mark.staff === line.staff).map(({ onset, staff: _staff, ...mark }) => ({ beat: onset / score.ticksPerQuarter, ...mark }))));
      const inBars = measures.map((m) =>
        (part.measures[m]?.noteIndexes ?? []).flatMap((i): LineNote[] => {
          const n = part.notes[i]!;
          if (n.staff !== line.staff || n.rest || n.hidden || n.cue || !n.pitch || n.soundingMidi === null) return [];
          if (n.grace) {
            grace++;
            return [];
          }
          // A note held over a barline is one note, however many pieces it's written in.
          if (!n.tieStop) notes++;
          const height = Math.round(n.soundingMidi);
          const written = nameInScore(n, part);
          return [{ start: n.onset / score.ticksPerQuarter, length: n.duration / score.ticksPerQuarter, height, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}), name: noteHeight(written) === height ? written : noteName(height), tieStart: n.tieStart, tieStop: n.tieStop, placed: false, voice: n.voice }];
        }),
      );
      return [line.label, inBars.map((notes) => joinInBar(notes, score.ticksPerQuarter))] as const;
    }),
  );
  return { lines, levels, dynamicMarks, notes, grace };
}

/** Where each bar starts, in crotchets, so a tie or an overlap can be seen across a barline. */
function barStarts(score: Score, input: StudyScoreInput): number[] {
  const lead = (wholeScoreParts(score) ?? score.parts)[0]!;
  return input.written.map((w, k) => (lead.measures[w.measure ?? k]?.start ?? 0) / score.ticksPerQuarter);
}

/** A tie only holds if the note it runs into came to the same part. */
function settleTies(part: PlacedPart, barStart: number[]): void {
  const at = (k: number, e: NewEvent) => barStart[k]! + e.start;
  const heard = new Map<string, NewEvent>();
  part.bars.forEach((events, k) => events.forEach((e) => heard.set(`${Math.round(at(k, e) * 1000)}|${noteHeight(e.names[0]!)}`, e)));
  const heldInto = new Set<NewEvent>();
  part.bars.forEach((events, k) =>
    events.forEach((e) => {
      if (!e.tieStart) return;
      const next = heard.get(`${Math.round((at(k, e) + e.length) * 1000)}|${noteHeight(e.names[0]!)}`);
      if (next?.tieStop) heldInto.add(next);
      else e.tieStart = false;
    }),
  );
  part.bars.forEach((events) => events.forEach((e) => (e.tieStop = heldInto.has(e))));
}

/** The lines that play more than one note at once, and the most they ever play. Held notes count as sounding. */
export function chordTracks(score: Score, input: StudyScoreInput): { line: string; most: number }[] {
  const { lines } = readLines(score, input);
  const barStart = barStarts(score, input);
  return [...lines].flatMap(([line, inBars]) => {
    const most = mostAtOnce(inBars, barStart);
    return most > 1 ? [{ line, most }] : [];
  });
}

function mostAtOnce(inBars: LineNote[][], barStart: number[]): number {
  // Thirds of a beat don't add up exactly, and a note ending as the next begins isn't two at once.
  const place = (beat: number) => Math.round(beat * 1e6);
  const edges = inBars.flatMap((notes, k) => notes.flatMap((n) => [{ at: place(barStart[k]! + n.start), by: 1 }, { at: place(barStart[k]! + n.start + n.length), by: -1 }]));
  edges.sort((a, b) => a.at - b.at || a.by - b.by);
  let now = 0;
  let most = 0;
  for (const edge of edges) {
    now += edge.by;
    most = Math.max(most, now);
  }
  return most;
}

/**
 * A line of chords as that many single lines, one part for each note. The highest notes stay on top, and where a chord has fewer notes each goes to
 * the line nearest it, so a line moves as little as it can. A note held by a tie stays on its line.
 */
export function splitLine(inBars: LineNote[][], barStart: number[], label: string, bars: number): PlacedPart[] {
  const most = mostAtOnce(inBars, barStart);
  // Where each line sits, from the fullest chords, so a line starts in its own register.
  const full = inBars.flatMap((notes) => {
    const attacks = new Map<number, number[]>();
    for (const n of notes) attacks.set(n.start, [...(attacks.get(n.start) ?? []), n.height]);
    return [...attacks.values()].filter((chord) => chord.length === most).map((chord) => [...chord].sort((a, b) => b - a));
  });
  const all = inBars.flat().map((n) => n.height);
  const middle = all.reduce((sum, h) => sum + h, 0) / Math.max(all.length, 1);
  const home = Array.from({ length: most }, (_, v) => (full.length ? full.reduce((sum, chord) => sum + chord[v]!, 0) / full.length : middle + (most / 2 - v) * 4));
  const voices = Array.from({ length: most }, (_, v) => ({ end: -Infinity, height: home[v]!, heldInto: null as number | null }));
  const parts: PlacedPart[] = Array.from({ length: most }, (_, v) => ({ name: `${label} ${v + 1}`, bars: Array.from({ length: bars }, () => []) }));
  const moments = inBars.flatMap((notes, k) => notes.map((n) => ({ k, n, at: barStart[k]! + n.start })));
  const times = [...new Set(moments.map((m) => m.at))].sort((a, b) => a - b);
  const give = (v: number, m: (typeof moments)[number]) => {
    voices[v] = { end: m.at + m.n.length, height: m.n.height, heldInto: m.n.tieStart ? m.n.height : null };
    parts[v]!.bars[m.k]!.push({ start: m.n.start, length: m.n.length, names: [m.n.name], tieStart: m.n.tieStart, tieStop: m.n.tieStop, ...(m.n.velocity !== undefined ? { velocity: m.n.velocity } : {}) });
  };
  for (const time of times) {
    const here = moments.filter((m) => m.at === time).sort((a, b) => b.n.height - a.n.height);
    const taken = new Set<number>();
    const left = here.filter((m) => {
      if (!m.n.tieStop) return true;
      const v = voices.findIndex((voice, i) => !taken.has(i) && voice.heldInto === m.n.height && Math.abs(voice.end - time) < 1e-6);
      if (v < 0) return true;
      taken.add(v);
      give(v, m);
      return false;
    });
    const free = voices.flatMap((voice, v) => (!taken.has(v) && voice.end <= time + 1e-6 ? [v] : []));
    // Keep the order, top to bottom, and find the choice of lines that moves least.
    let best: number[] = free.slice(0, left.length);
    let bestCost = Infinity;
    const choose = (from: number, picked: number[]) => {
      if (picked.length === left.length) {
        const cost = picked.reduce((sum, v, i) => sum + Math.abs(voices[v]!.height - left[i]!.n.height), 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = [...picked];
        }
        return;
      }
      for (let i = from; i < free.length; i++) choose(i + 1, [...picked, free[i]!]);
    };
    choose(0, []);
    left.forEach((m, i) => give(best[i] ?? 0, m));
  }
  return parts;
}

/** The score with these lines split into single lines. Every other line stays as it is, and no note changes. */
export function scoreWithSplits(score: Score, input: StudyScoreInput, splitting: string[]): string {
  const { lines, levels, dynamicMarks } = readLines(score, input);
  const barStart = barStarts(score, input);
  // A staff with nothing on it yet is still one the composer chose, so it stays where it is.
  const parts = scoreLines(score.parts).flatMap(({ label }): PlacedPart[] => {
    const inBars = lines.get(label);
    if (!inBars) return [{ name: label, bars: input.written.map(() => []) }];
    const held = levels.get(label);
    const printed = dynamicMarks.get(label);
    const expression = { ...(held ? { levels: held } : {}), ...(printed ? { dynamicMarks: printed } : {}) };
    if (splitting.includes(label) && mostAtOnce(inBars, barStart) > 1) return splitLine(inBars, barStart, label, inBars.length).map((part) => ({ ...part, ...expression }));
    return [{ name: label, ...expression, bars: inBars.map((notes) => notes.map((n) => ({ start: n.start, length: n.length, names: [n.name], ...(n.velocity !== undefined ? { velocity: n.velocity } : {}), tieStart: n.tieStart, tieStop: n.tieStop }))) }];
  });
  for (const part of parts) settleTies(part, barStart);
  return scoreOfParts(score, input, parts);
}

const moveOctave = (name: string, octaves: number) => name.replace(/(-?\d+)$/, (o) => String(Number(o) + octaves));

/**
 * The composer's notes on the instruments they chose. Muse Spark's plan says only who plays which line, so no pitch or rhythm can change,
 * and whatever the plan leaves out goes on a part of its own for the composer to place or delete.
 */
export function placeNotes(score: Score, input: StudyScoreInput, answer: DistributeAnswer, instruments: string[], tuneOnly = false): { parts: PlacedPart[]; check: PlacedCheck } {
  const bars = input.written.map((w) => w.bar);
  const check: PlacedCheck = { notes: 0, placed: 0, notPlaced: [], moved: 0, merged: 0, outOfRange: [], together: [], grace: 0, ignored: 0 };
  const read = readLines(score, input);
  const lines = read.lines;
  check.notes = read.notes;
  check.grace = read.grace;
  const parts = new Map<string, PlacedPart>(instruments.map((name) => [name, { name, bars: bars.map(() => []) }]));
  const put = (target: PlacedPart, k: number, n: LineNote, octaves: number) => {
    const name = octaves ? moveOctave(n.name, octaves) : n.name;
    const inBar = target.bars[k]!;
    if (inBar.some((e) => e.start === n.start && e.length === n.length && e.names[0] === name && e.velocity === n.velocity && !!e.tieStart === n.tieStart && !!e.tieStop === n.tieStop)) {
      if (!n.tieStop) check.merged++;
    } else inBar.push({ start: n.start, length: n.length, names: [name], tieStart: n.tieStart, tieStop: n.tieStop, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}) });
  };
  for (const entry of answer.plan) {
    const [from, to] = [bars.indexOf(entry.from), bars.indexOf(entry.to)];
    const line = lines.get(entry.line);
    const target = parts.get(entry.part);
    if (from < 0 || to < from || !line || !target) {
      check.ignored++;
      continue;
    }
    for (let k = from; k <= to; k++) {
      // Where two lines come to one part in a bar, the first one's levels are the ones it plays.
      if (read.levels.get(entry.line)?.[k]?.length && !target.levels?.[k]?.length) (target.levels ??= bars.map(() => []))[k] = read.levels.get(entry.line)![k]!;
      if (read.dynamicMarks.get(entry.line)?.[k]?.length && !target.dynamicMarks?.[k]?.length) (target.dynamicMarks ??= bars.map(() => []))[k] = read.dynamicMarks.get(entry.line)![k]!;
      const attacks = new Map<number, LineNote[]>();
      for (const n of line[k]!) attacks.set(n.start, [...(attacks.get(n.start) ?? []), n]);
      for (const chord of attacks.values()) {
        const high = [...chord].sort((a, b) => b.height - a.height);
        const taken = entry.voice === "all" ? high : entry.voice === "bottom" ? high.slice(-1) : high.slice(Number(entry.voice) - 1, Number(entry.voice));
        for (const n of taken) {
          if (entry.octave && !n.tieStop) check.moved++;
          n.placed = true;
          put(target, k, n, entry.octave);
        }
      }
    }
  }
  for (const [label, inBars] of lines) {
    const left = inBars.map((notes) => notes.filter((n) => !n.placed));
    const struck = (bars: LineNote[][]) => bars.reduce((sum, notes) => sum + notes.filter((n) => !n.tieStop).length, 0);
    check.placed += struck(inBars) - struck(left);
    if (!left.some((notes) => notes.length)) continue;
    check.notPlaced.push({ line: label, notes: struck(left) });
    // What isn't the tune is what the rest gets written from, so it doesn't stay on the score as well.
    if (tuneOnly) {
      check.material = true;
      continue;
    }
    const target: PlacedPart = { name: `${label} (not placed)`, bars: bars.map(() => []), ...(read.levels.get(label)?.some((l) => l.length) ? { levels: read.levels.get(label)! } : {}), ...(read.dynamicMarks.get(label)?.some((m) => m.length) ? { dynamicMarks: read.dynamicMarks.get(label)! } : {}) };
    parts.set(target.name, target);
    left.forEach((notes, k) => notes.forEach((n) => put(target, k, n, 0)));
  }
  const barStart = barStarts(score, input);
  for (const part of parts.values()) {
    settleTies(part, barStart);
    part.bars.forEach((events, k) => {
      const range = rangeOf(part.name);
      events.forEach((e) => {
        const height = noteHeight(e.names[0]!)!;
        if (range && (height < range[1] || height > range[2])) check.outOfRange.push({ part: part.name, bar: bars[k]!, name: e.names[0]! });
      });
      if (ONE_NOTE_AT_A_TIME.test(part.name) && events.some((a, i) => events.some((b, j) => i < j && a.start < b.start + b.length && b.start < a.start + a.length))) check.together.push({ part: part.name, bar: bars[k]! });
    });
  }
  return { parts: [...parts.values()], check };
}

/** What the code found when it moved the notes, in plain sentences. */
export function placedWords(check: PlacedCheck, chosen = true): string[] {
  const some = <T>(list: T[], word: (x: T) => string) => list.slice(0, 4).map(word).join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
  const onto = chosen ? "the instruments you chose" : "these instruments";
  if (check.material) return [`Your tune is on ${onto}, ${check.placed} notes at the rhythm you played. Your other ${check.notes - check.placed} notes are the harmony and bass that the rest of the orchestra is written from.`];
  const sentences = [check.notPlaced.length ? `${check.placed} of your ${check.notes} notes are on ${onto}.` : `All ${check.notes} of your notes are on ${onto}, at the rhythm you wrote.`];
  const left = check.notes - check.placed;
  if (check.notPlaced.length) sentences.push(`${left === 1 ? "The other one is on a part of its own" : `The other ${left} are on parts of their own`} at the bottom, so nothing is lost: ${some(check.notPlaced, (n) => `${n.line}, ${n.notes} ${n.notes === 1 ? "note" : "notes"}`)}.`);
  if (check.moved) sentences.push(`${check.moved} were moved by an octave to fit their instrument.`);
  if (check.merged) sentences.push(`${check.merged} landed on the same pitch at the same moment as another note and became one.`);
  if (check.outOfRange.length) sentences.push(`${check.outOfRange.length === 1 ? "One sits" : `${check.outOfRange.length} sit`} outside the comfortable range of the instrument: ${some(check.outOfRange, (o) => `${o.part} ${o.name} in bar ${o.bar}`)}.`);
  if (check.together.length) sentences.push(`An instrument that plays one note at a time has more than one in ${check.together.length} bars, so those need dividing: ${some(check.together, (t) => `${t.part} in bar ${t.bar}`)}.`);
  if (check.grace) sentences.push(`${check.grace} grace notes weren't carried over.`);
  return sentences;
}

export interface BarHead {
  number: string;
  implicit: boolean;
  /** In crotchets. */
  length: number;
  time: { beats: number; beatType: number } | null;
  fifths: number;
  repeatForward: boolean;
  repeatBackward: number | null;
  endings: Part["measures"][number]["endings"];
  words: string[];
  qpm: number | null;
  /** Tempos later in the bar, each at its beat in crotchets from the barline. */
  moreTempos?: { beat: number; qpm: number }[];
}

/** Playback points and printed marks travel separately. A change in velocity never invents a hairpin. */
function levelsXml(levels: BarLevel[], marks: BarDynamicMark[], barBeats: number): { before: string; after: string } {
  const out = { before: "", after: "" };
  const events = [
    ...levels.map((level) => ({ beat: level.beat, xml: `<sound dynamics="${Math.round(level.velocity / 0.09) / 10}"/>` })),
    ...marks.map((mark) => {
      const inside = mark.kind === "wedge"
        ? `<wedge type="${esc(mark.value)}"${mark.number ? ` number="${esc(mark.number)}"` : ""}/>`
        : /^[A-Za-z_][\w.-]*$/.test(mark.value) ? `<dynamics><${mark.value}${mark.text ? `>${esc(mark.text)}</${mark.value}>` : "/>"}</dynamics>` : "";
      return { beat: mark.beat, xml: inside ? `<direction placement="below"><direction-type>${inside}</direction-type></direction>` : "" };
    }),
  ].sort((a, b) => a.beat - b.beat);
  for (const { beat, xml } of events) {
    if (!xml) continue;
    // The end of the bar follows its notes. Earlier events step there and back.
    if (beat >= barBeats - 1e-6) out.after += xml;
    else if (beat > 1e-6) {
      const gap = Math.round(beat * DIV);
      out.before += `<forward><duration>${gap}</duration></forward>${xml}<backup><duration>${gap}</duration></backup>`;
    } else out.before += xml;
  }
  return out;
}

/** A new score of these parts over these bars. Notes, rhythm, playback levels and the signs that say where it goes are carried, not articulation. */
export function scoreXml(about: { title: string | null; movementTitle: string | null; composer: string | null; arranger?: string | null; rights?: string[] }, bars: BarHead[], parts: PlacedPart[]): string {
  const heads = parts.map((part, k) => `<score-part id="T${k + 1}"><part-name>${esc(part.name)}</part-name></score-part>`).join("");
  const body = parts.map((part, p) => {
    const heights = part.bars.flat().flatMap((e) => e.names.map((n) => noteHeight(n)!));
    const low = heights.length > 0 && heights.reduce((sum, h) => sum + h, 0) / heights.length < 58;
    const [, sign, line] = CLEFS.find(([word]) => word.test(part.name)) ?? [null, low ? "F" : "G", low ? 4 : 2];
    const octaveShift = WRITTEN_OCTAVE.find(([word]) => word.test(part.name))?.[1] ?? 0;
    let shownTime = "";
    let shownKey: number | null = null;
    const written = bars.map((m, k) => {
      const ticks = Math.round(m.length * DIV);
      const timeKey = m.time ? `${m.time.beats}/${m.time.beatType}` : "";
      const changes = [
        ...(k === 0 ? [`<divisions>${DIV}</divisions>`] : []),
        ...(m.fifths !== shownKey ? [`<key><fifths>${m.fifths}</fifths></key>`] : []),
        ...(m.time && timeKey !== shownTime ? [`<time><beats>${m.time.beats}</beats><beat-type>${m.time.beatType}</beat-type></time>`] : []),
        ...(k === 0 ? [`<clef><sign>${sign}</sign><line>${line}</line></clef>`] : []),
        ...(k === 0 && octaveShift ? [`<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>${-octaveShift}</octave-change></transpose>`] : []),
      ];
      shownTime = timeKey || shownTime;
      shownKey = m.fifths;
      const opens = [...(m.repeatForward ? [`<repeat direction="forward"/>`] : []), ...m.endings.filter((e) => e.type === "start").map((e) => `<ending number="${e.numbers.join(",")}" type="start"/>`)];
      const closes = [...m.endings.filter((e) => e.type !== "start").map((e) => `<ending number="${e.numbers.join(",")}" type="${e.type}"/>`), ...(m.repeatBackward !== null ? [`<repeat direction="backward"${m.repeatBackward > 2 ? ` times="${m.repeatBackward}"` : ""}/>`] : [])];
      const later = (m.moreTempos ?? []).map((t) => {
        const gap = Math.round(t.beat * DIV);
        return `<forward><duration>${gap}</duration></forward><sound tempo="${t.qpm}"/><backup><duration>${gap}</duration></backup>`;
      });
      const levels = levelsXml(part.levels?.[k] ?? [], part.dynamicMarks?.[k] ?? [], m.length);
      const marks = p === 0 ? [...m.words.map((w) => `<direction placement="above"><direction-type><words>${esc(w)}</words></direction-type></direction>`), ...(m.qpm ? [`<sound tempo="${m.qpm}"/>`] : []), ...later].join("") : "";
      return `<measure number="${esc(m.number)}"${m.implicit ? ` implicit="yes"` : ""}>${opens.length ? `<barline location="left">${opens.join("")}</barline>` : ""}${changes.length ? `<attributes>${changes.join("")}</attributes>` : ""}${marks}${levels.before}${staffXml(part.bars[k] ?? [], null, 1, ticks, undefined, octaveShift)}${levels.after}${closes.length ? `<barline location="right">${closes.join("")}</barline>` : ""}</measure>`;
    });
    return `<part id="T${p + 1}">${written.join("")}</part>`;
  });
  const title = about.title ? `<work><work-title>${esc(about.title)}</work-title></work>` : "";
  const movement = about.movementTitle && about.movementTitle !== about.title ? `<movement-title>${esc(about.movementTitle)}</movement-title>` : "";
  const rights = about.rights ?? [];
  const named = [...(about.composer ? [`<creator type="composer">${esc(about.composer)}</creator>`] : []), ...(about.arranger ? [`<creator type="arranger">${esc(about.arranger)}</creator>`] : []), ...rights.map((r) => `<rights>${esc(r)}</rights>`)];
  const identification = named.length ? `<identification>${named.join("")}</identification>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${title}${movement}${identification}<part-list>${heads}</part-list>${body.join("")}</score-partwise>`;
}

/** These parts over the bars of the score they came from. */
export function scoreOfParts(score: Score, input: StudyScoreInput, parts: PlacedPart[]): string {
  // The score clock stays on its first part, even when that instrument rests.
  const lead = score.parts[0]!;
  const bars = input.written.map((w, k): BarHead => {
    const m = lead.measures[w.measure ?? k]!;
    // Every tempo in its place, because a DAW's automation doesn't wait for the barline.
    const atBarline = [...m.tempos].reverse().find((t) => t.onset === 0);
    const later = m.tempos.filter((t) => t.onset > 0).map((t) => ({ beat: t.onset / score.ticksPerQuarter, qpm: t.qpm }));
    return { number: m.number, implicit: m.implicit, length: m.length / score.ticksPerQuarter, time: m.time, fifths: m.key.fifths, repeatForward: m.repeatForward, repeatBackward: m.repeatBackward, endings: m.endings, words: m.words, qpm: atBarline?.qpm ?? null, ...(later.length ? { moreTempos: later } : {}) };
  });
  return scoreXml({ title: score.title ?? null, movementTitle: score.movementTitle ?? null, composer: score.composer ?? null, arranger: score.arranger ?? null, rights: score.rights ?? [] }, bars, parts);
}

/** The same roles, now on the instruments the plan gave them to, with what matters most drawn last. */
export function rolesAfter(plan: DistributeAnswer["plan"], roles: PieceReading["roles"], bars: string[]): PieceReading["roles"] {
  const moved = plan.flatMap((entry) =>
    roles.flatMap((r) => {
      if (r.line !== entry.line) return [];
      const from = Math.max(bars.indexOf(entry.from), bars.indexOf(r.from));
      const to = Math.min(bars.indexOf(entry.to), bars.indexOf(r.to));
      if (from < 0 || to < from) return [];
      return [{ ...r, line: entry.part, from: bars[from]!, to: bars[to]!, of: "" }];
    }),
  );
  const weight = ["doubling", "harmony", "pedal", "rhythm", "bass", "countermelody", "melody"];
  return moved.sort((a, b) => weight.indexOf(a.role) - weight.indexOf(b.role));
}

/**
 * What each role looks like on the page. Two colours, each with one meaning (Ryu's brief, 11-03): orange is everything the composer wrote,
 * the melody brightest and what supports it paler, and blue is everything Muse Spark adds.
 */
export const ROLE_COLOURS: Record<PieceReading["roles"][number]["role"], string> = {
  melody: "#e8672c",
  countermelody: "#c9582a",
  bass: "#b9714a",
  harmony: "#d4a084",
  rhythm: "#d4a084",
  pedal: "#d4a084",
  doubling: "#e2bfa9",
};

/** Rests, and whatever isn't being looked at, so the eye can leave it alone. */
export const FADED = "#d6d2c9";

export type RoleFocus = PieceReading["roles"][number]["role"] | "new" | null;

const ROLE_WEIGHT = ["doubling", "harmony", "pedal", "rhythm", "bass", "countermelody", "melody"];

/**
 * The score for the page only, with each note in the colour of what its line is doing in that bar. Where a staff has two roles in a bar, the one
 * a listener follows wins. With a focus, only that role keeps its colour. Downloads never go through here.
 */
export function withRoleColours(xmlText: string, score: Score, roles: PieceReading["roles"], bars: string[], focus: RoleFocus = null): string {
  const lines = [...scoreLines(wholeScoreParts(score) ?? score.parts), ...scoreLines(score.parts)];
  const roleAt = new Map<string, PieceReading["roles"][number]["role"]>();
  for (const r of [...roles].sort((a, b) => ROLE_WEIGHT.indexOf(a.role) - ROLE_WEIGHT.indexOf(b.role))) {
    const line = lines.find((l) => l.label === r.line);
    const [from, to] = [bars.indexOf(r.from), bars.indexOf(r.to)];
    if (!line || from < 0 || to < from) continue;
    for (const bar of bars.slice(from, to + 1)) roleAt.set(`${line.partId}|${line.staff}|${bar}`, r.role);
  }
  const doc = parseXml(xmlText);
  for (const part of childrenOf(doc.documentElement, "part")) {
    for (const measure of childrenOf(part, "measure")) {
      for (const note of childrenOf(measure, "note")) {
        if (childrenOf(note, "rest").length) {
          note.setAttribute("color", FADED);
          continue;
        }
        const staff = childrenOf(note, "staff")[0]?.textContent?.trim() || "1";
        const role = roleAt.get(`${part.getAttribute("id")}|${staff}|${measure.getAttribute("number")}`);
        if (focus) note.setAttribute("color", role === focus ? ROLE_COLOURS[role] : FADED);
        else if (role) note.setAttribute("color", ROLE_COLOURS[role]);
      }
    }
  }
  return serialize(doc);
}

/** These bars for the page, with only the staves that play in them, because a whole score at once is more than anyone can read. */
export function onlyBars(xmlText: string, from: string, to: string): string {
  const cut = withStructure(xmlText, { order: [{ from, to }] }, true);
  const doc = parseXml(cut);
  const parts = childrenOf(doc.documentElement, "part");
  const silent = parts.filter((part) => !childrenOf(part, "measure").some((m) => childrenOf(m, "note").some((n) => childrenOf(n, "pitch").length))).map((part) => part.getAttribute("id")!);
  // The piece's name is at the top of the page already. Here it would only push the music down.
  for (const tag of ["work", "movement-title", "credit"]) for (const el of childrenOf(doc.documentElement, tag)) doc.documentElement.removeChild(el);
  for (const part of parts) {
    const now = new Map<string, string>();
    for (const measure of childrenOf(part, "measure")) {
      // A DAW writes pedal marks all over, and in black they're the loudest thing on the page. They stay in the file.
      for (const direction of childrenOf(measure, "direction")) {
        if (childrenOf(direction, "direction-type").some((type) => childrenOf(type, "pedal").length)) measure.removeChild(direction);
      }
      // A DAW says the clef, key and time again wherever a track starts, and on a page that reads as a change.
      for (const block of childrenOf(measure, "attributes")) {
        for (const tag of ["key", "time", "clef"]) {
          for (const el of childrenOf(block, tag)) {
            const slot = `${tag}${el.getAttribute("number") ?? ""}`;
            const value = (el.textContent ?? "").replace(/\s+/g, "");
            if (now.get(slot) === value) block.removeChild(el);
            else now.set(slot, value);
          }
        }
      }
    }
  }
  const untitled = serialize(doc);
  return silent.length && silent.length < parts.length ? dropParts(untitled, silent) : untitled;
}

/** The score without parts the composer has deleted. */
export function dropParts(xmlText: string, ids: string[]): string {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;
  for (const el of childrenOf(root, "part")) if (ids.includes(el.getAttribute("id")!)) root.removeChild(el);
  const list = childrenOf(root, "part-list")[0];
  if (list) for (const el of childrenOf(list, "score-part")) if (ids.includes(el.getAttribute("id")!)) list.removeChild(el);
  return serialize(doc);
}

export interface MidiTrack {
  name: string;
  program: number;
  notes: { start: number; length: number; height: number; velocity?: number }[];
  /** Levels over time, as the mod wheel. */
  controls?: { beat: number; value: number }[];
}

const PROGRAMS: [RegExp, number][] = [
  [/piccolo/i, 72],
  [/flute/i, 73],
  [/oboe|english horn|cor anglais/i, 68],
  [/bass clarinet|clarinet/i, 71],
  [/bassoon/i, 70],
  [/horn/i, 60],
  [/trumpet/i, 56],
  [/trombone/i, 57],
  [/tuba/i, 58],
  [/timpani/i, 47],
  [/harp/i, 46],
  [/celesta/i, 8],
  [/violin/i, 40],
  [/viola/i, 41],
  [/cello/i, 42],
  [/double bass|contrabass/i, 43],
  [/bass guitar/i, 33],
  [/string/i, 48],
];

/** Every line of a score as notes in crotchets, with tied notes joined, so MIDI plays what's written. */
export function scoreTracks(score: Score): MidiTrack[] {
  return score.parts.flatMap((part) => {
    const staves = Array.from({ length: part.staves }, (_, s) => s + 1);
    return staves.flatMap((staff) => {
      const open = new Map<number, OpenTie<MidiTrack["notes"][number]>[]>();
      const notes: MidiTrack["notes"] = [];
      const plucked: MidiTrack["notes"] = [];
      const attackOrder = new Map<MidiTrack["notes"][number], number>();
      let pizz = false;
      const levels = levelPoints(part, score.ticksPerQuarter);
      for (const m of part.measures) {
        for (const word of m.words) {
          if (/^pizz/i.test(word.trim())) pizz = true;
          if (/^arco/i.test(word.trim())) pizz = false;
        }
        // Voices are serialized one at a time. A continuation can therefore be
        // printed before its start; process time first, then retain attack order below.
        const ordered = m.noteIndexes.filter((i) => {
          const n = part.notes[i]!;
          return n.staff === staff && !n.rest && !n.grace && !n.hidden && !n.cue && n.pitch && n.soundingMidi !== null;
        }).sort((i, j) => part.notes[i]!.onset - part.notes[j]!.onset || Number(part.notes[j]!.tieStop) - Number(part.notes[i]!.tieStop) || i - j);
        for (let from = 0; from < ordered.length;) {
          let to = from + 1;
          while (to < ordered.length && sameTieTime(part.notes[ordered[from]!]!.onset, part.notes[ordered[to]!]!.onset)) to++;
          const group = ordered.slice(from, to);
          const held = takeTies(open, m.start + part.notes[group[0]!]!.onset, group.filter((i) => part.notes[i]!.tieStop).map((i) => ({ key: i, height: Math.round(part.notes[i]!.soundingMidi!), voice: part.notes[i]!.voice })));
          for (const i of group) {
            const n = part.notes[i]!, height = Math.round(n.soundingMidi!), length = n.duration / score.ticksPerQuarter, startTicks = m.start + n.onset;
            const previous = held.get(i);
            let note: MidiTrack["notes"][number];
            if (previous) {
              note = previous.value;
              note.length += length;
            } else {
              const start = startTicks / score.ticksPerQuarter;
              const velocity = n.velocity ?? levelAt(levels, start);
              note = { start, length, height, ...(velocity !== undefined ? { velocity } : {}) };
              (pizz ? plucked : notes).push(note);
              attackOrder.set(note, i);
            }
            if (n.tieStart) holdTie(open, height, { value: note, end: startTicks + n.duration, voice: n.voice });
          }
          from = to;
        }
      }
      const name = part.staves > 1 ? `${part.name} ${["upper", "lower"][staff - 1] ?? staff}` : part.name;
      const controls = levelCurve(levels);
      // Keep simultaneous MIDI events in the source's established attack order.
      for (const line of [notes, plucked]) line.sort((a, b) => attackOrder.get(a)! - attackOrder.get(b)!);
      // Plucked notes get a track of their own, because a sample library plays them from a different patch.
      return [
        ...(notes.length ? [{ name, program: PROGRAMS.find(([word]) => word.test(name))?.[1] ?? 0, notes, ...(controls.length ? { controls } : {}) }] : []),
        ...(plucked.length ? [{ name: `${name} pizz`, program: 45, notes: plucked, ...(controls.length ? { controls } : {}) }] : []),
      ];
    });
  });
}

type LevelPoint = { beat: number; velocity: number; measure: number };

/** A part's playback levels in crotchets from the start, which two points in one bar make a swell. */
function levelPoints(part: Part, ticksPerQuarter: number): LevelPoint[] {
  return part.measures.flatMap((m, measure) => (m.levels ?? []).map((l) => ({ beat: (m.start + l.onset) / ticksPerQuarter, velocity: l.velocity, measure })));
}

function levelAt(points: LevelPoint[], beat: number): number | undefined {
  let k = points.length - 1;
  while (k >= 0 && points[k]!.beat > beat + 1e-6) k--;
  const here = points[k];
  if (!here) return undefined;
  const next = points[k + 1];
  if (!next || next.measure !== here.measure || next.beat <= here.beat) return here.velocity;
  return Math.round(here.velocity + ((next.velocity - here.velocity) * (beat - here.beat)) / (next.beat - here.beat));
}

/** The same levels as a mod wheel curve, which is what most orchestral sample libraries read as dynamics. */
function levelCurve(points: LevelPoint[]): { beat: number; value: number }[] {
  const curve: { beat: number; value: number }[] = [];
  points.forEach((p, k) => {
    curve.push({ beat: p.beat, value: p.velocity });
    const next = points[k + 1];
    if (!next || next.measure !== p.measure) return;
    for (let beat = p.beat + 0.25; beat < next.beat - 1e-6; beat += 0.25) curve.push({ beat, value: Math.round(p.velocity + ((next.velocity - p.velocity) * (beat - p.beat)) / (next.beat - p.beat)) });
  });
  return curve;
}

const vlq = (n: number): number[] => {
  const out = [n & 127];
  for (let rest = n >> 7; rest; rest >>= 7) out.unshift((rest & 127) | 128);
  return out;
};
const ascii = (s: string) => [...s].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** Channel 10 is drums in General MIDI, so it's left out every time round. Fifteen parts fill a port, and the next part starts another. */
const PITCHED_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
export const midiSlot = (track: number) => ({ port: Math.floor(track / PITCHED_CHANNELS.length), channel: PITCHED_CHANNELS[track % PITCHED_CHANNELS.length]! });

function trackBytes(track: MidiTrack, { port, channel }: ReturnType<typeof midiSlot>): number[] {
  const events = [
    // A level has to be in place before the note it's for.
    ...(track.controls ?? []).map((c) => ({ tick: Math.round(c.beat * 480), rank: 0, data: [0xb0 | channel, 1, c.value] })),
    ...track.notes.flatMap((n) => [
      { tick: Math.round(n.start * 480), rank: 2, data: [0x90 | channel, n.height, n.velocity ?? 80] },
      { tick: Math.round((n.start + n.length) * 480), rank: 1, data: [0x80 | channel, n.height, 0] },
    ]),
  ].sort((a, b) => a.tick - b.tick || a.rank - b.rank);
  const name = ascii(track.name);
  const body = [0, 0xff, 3, ...vlq(name.length), ...name, ...(port ? [0, 0xff, 0x21, 1, port] : []), 0, 0xc0 | channel, track.program];
  let at = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - at), ...e.data);
    at = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...ascii("MTrk"), ...be32(body.length), ...body];
}

/** A standard MIDI file that any DAW can open, lined up with the score from its first bar, with its tempos and any moments as markers. */
export function midiFile(tracks: MidiTrack[], qpm: number | { beat: number; qpm: number }[], time: { beats: number; beatType: number } | { beat: number; beats: number; beatType: number }[], markers: { beat: number; text: string }[] = []): Uint8Array {
  const tempos = typeof qpm === "number" ? [{ beat: 0, qpm }] : qpm.length ? qpm : [{ beat: 0, qpm: 120 }];
  const meters = Array.isArray(time) ? time : [{ beat: 0, ...time }];
  const events = [
    ...meters.map((m) => ({ tick: Math.round(m.beat * 480), data: [0xff, 0x58, 4, m.beats, Math.round(Math.log2(m.beatType)), 24, 8] })),
    ...tempos.map((t) => {
      const micros = Math.round(60_000_000 / t.qpm);
      return { tick: Math.round(t.beat * 480), data: [0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] };
    }),
    ...markers.map((m) => {
      const text = ascii(m.text.slice(0, 120));
      return { tick: Math.round(m.beat * 480), data: [0xff, 0x06, ...vlq(text.length), ...text] };
    }),
  ].sort((a, b) => a.tick - b.tick);
  const meta: number[] = [];
  let last = 0;
  for (const e of events) {
    meta.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  meta.push(0, 0xff, 0x2f, 0);
  const bytes = [...ascii("MThd"), ...be32(6), 0, 1, 0, tracks.length + 1, 480 >> 8, 480 & 255, ...ascii("MTrk"), ...be32(meta.length), ...meta];
  tracks.forEach((track, i) => bytes.push(...trackBytes(track, midiSlot(i))));
  return new Uint8Array(bytes);
}

/** Only what an option wrote, placed against the bars of the finished score. */
function newTracks(score: Score, check: OptionCheck): MidiTrack[] {
  const lead = score.parts[0]!;
  const byName = new Map<string, MidiTrack>();
  for (const add of check.adds) {
    const measure = add.measure !== undefined ? lead.measures[add.measure] : lead.measures.find((m) => m.number === add.bar);
    if (!measure) continue;
    const trackName = add.art === "pizz" ? `${add.part} pizz` : add.part;
    const track: MidiTrack = byName.get(trackName) ?? { name: trackName, program: add.art === "pizz" ? 45 : (PROGRAMS.find(([word]) => word.test(add.part))?.[1] ?? 0), notes: [] };
    byName.set(trackName, track);
    const start = measure.start / score.ticksPerQuarter;
    for (const e of add.events) for (const name of e.names) track.notes.push({ start: start + e.start, length: e.length, height: noteHeight(name)!, ...(e.velocity !== undefined ? { velocity: e.velocity } : {}) });
    const dyn = readDyn(add.dyn);
    const beats = measure.length / score.ticksPerQuarter;
    if (dyn) (track.controls ??= []).push(...levelCurve([{ beat: start, velocity: velocityIn(dyn, 0, beats), measure: 0 }, ...(dyn.to ? [{ beat: start + beats, velocity: velocityIn(dyn, beats, beats), measure: 0 }] : [])]));
  }
  return [...byName.values()];
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "part";

/** Every change of metre, so bar numbers in a DAW stay with the score's after a bar of 2/4. */
function meterMap(score: Score): { beat: number; beats: number; beatType: number }[] {
  const map: { beat: number; beats: number; beatType: number }[] = [];
  for (const m of score.parts[0]?.measures ?? []) {
    const last = map[map.length - 1];
    if (m.time && (!last || last.beats !== m.time.beats || last.beatType !== m.time.beatType)) map.push({ beat: m.start / score.ticksPerQuarter, ...m.time });
  }
  return map.length ? map : [{ beat: 0, beats: 4, beatType: 4 }];
}

/** A folder for a DAW: all the parts, each part alone, what's new on its own, the notation, and why. */
export function packageFiles(xmlText: string, added: OptionCheck | null, about: string, markers: { beat: number; text: string }[] = [], forPlayers = false): Uint8Array {
  const score = parseScore(xmlText);
  const qpm = (score.parts[0]?.measures ?? []).flatMap((m) => m.tempos.map((t) => ({ beat: (m.start + t.onset) / score.ticksPerQuarter, qpm: t.qpm })));
  const time = meterMap(score);
  const tracks = scoreTracks(score);
  const fresh = added ? newTracks(score, added) : [];
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "all-parts.mid": midiFile(tracks, qpm, time, markers),
    "score.musicxml": encoder.encode(xmlText),
    "why.txt": encoder.encode(about),
    ...(forPlayers ? { "score-transposed-for-players.musicxml": encoder.encode(transposedForPlayers(xmlText)) } : {}),
  };
  if (fresh.length) files["new-parts.mid"] = midiFile(fresh, qpm, time);
  tracks.forEach((track, i) => {
    files[`parts/${String(i + 1).padStart(2, "0")}-${safeName(track.name)}.mid`] = midiFile([track], qpm, time);
  });
  return zipSync(files);
}

/** Short phrases from Muse Spark, made to read as sentences. */
export const sentences = (...phrases: string[]) => phrases.map((p) => p.trim()).filter(Boolean).map((p) => `${p[0]!.toUpperCase()}${p.slice(1)}${/[.!?]$/.test(p) ? "" : "."}`).join(" ");

/** What goes in `why.txt`, so the reasons travel with the notes. */
export function whyText(title: string, name: string, idea: string, why: { from: string; to: string; what: string; principle: string; chords?: string; dynamics?: string }[], check: OptionCheck | null, placed: PlacedCheck | null = null): string {
  const lines = [`${title}: ${name}`, "", sentences(idea), ""];
  for (const w of why) lines.push(`Bars ${w.from} to ${w.to}. ${sentences(w.what, w.principle)}${w.chords ? ` Chords: ${w.chords}` : ""}${w.dynamics ? ` Level: ${w.dynamics}` : ""}`);
  if (placed) lines.push("", ...placedWords(placed));
  if (check) lines.push("", ...checkWords(check));
  lines.push("", check ? "Muse Spark wrote the new notes for you to check and change. New parts are at concert pitch." : "");
  lines.push(placed ? "Your notes keep their rhythm and their pitches, apart from any octave moves counted above." : "Your own notes are as you wrote them.");
  return lines.join("\n").trimEnd();
}

/** What the code found in an option, in plain sentences. It says what it measured and leaves the music to the composer. */
export function checkWords(check: OptionCheck): string[] {
  const sentences = [check.notes ? `${check.notes} new notes. The code checked each one against what's sounding and the range of its instrument.` : "Nothing new went on the score, because every instrument it wrote for already plays in those bars. Choose more instruments or ask for new bars."];
  const some = <T>(list: T[], word: (x: T) => string) => list.slice(0, 4).map(word).join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
  if (check.outOfRange.length) sentences.push(`${check.outOfRange.length === 1 ? "One sits" : `${check.outOfRange.length} sit`} outside the comfortable range of the instrument, which you can decide about: ${some(check.outOfRange, (o) => `${o.part} ${o.name} in bar ${o.bar}`)}.`);
  if (check.clashes.length) sentences.push(`${check.clashes.length === 1 ? "One long note sits" : `${check.clashes.length} long notes sit`} a semitone from something else sounding. That can be a good suspension or a slip, so check by ear: ${some(check.clashes, (c) => `${c.part} ${c.name} in bar ${c.bar}`)}.`);
  const left = check.overBars + check.unreadable + check.pastBarEnd;
  if (left) sentences.push(`${left} were left out, because they landed on your own notes, ran past the bar or couldn't be read.`);
  return sentences;
}
