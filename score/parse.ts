import { musicXmlText, parseXml, ScoreFileError } from "./file";
import type {
  Bowing,
  Clef,
  Ending,
  JumpKind,
  KeySignature,
  Measure,
  Part,
  Pitch,
  PrintedNote,
  Score,
  Step,
  TempoMark,
  TimeSignature,
  Transposition,
} from "./types";

const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const JUMP_ATTRIBUTES: JumpKind[] = ["dacapo", "dalsegno", "fine", "tocoda", "coda", "segno"];

// --- small DOM helpers -------------------------------------------------------------------------

function children(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as Element).tagName === name)) out.push(n as Element);
  }
  return out;
}

function child(el: Element, name: string): Element | undefined {
  return children(el, name)[0];
}

function text(el: Element | undefined, name?: string): string | null {
  const target = el && name ? child(el, name) : el;
  const value = target?.textContent?.trim();
  return value ? value : null;
}

function num(el: Element | undefined, name?: string): number | null {
  const value = text(el, name);
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

// --- entry points --------------------------------------------------------------------------------

/** Parses MusicXML from a file's bytes (.musicxml, .xml or compressed .mxl). */
export function parseScoreFile(bytes: Uint8Array): { xmlText: string; score: Score } {
  const xmlText = musicXmlText(bytes);
  return { xmlText, score: parseScore(xmlText) };
}

export function parseScore(xmlText: string): Score {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;
  const format =
    root.tagName === "score-partwise" ? "partwise" : root.tagName === "score-timewise" ? "timewise" : null;
  if (!format) throw new ScoreFileError(`Not a MusicXML score (root element <${root.tagName}>).`);

  const measuresByPart = format === "partwise" ? partwiseMeasures(root) : timewiseMeasures(root);
  const partList = partListInfo(root);

  // One tick base for the whole file: the least common multiple of every <divisions> value,
  // so every duration in every part is a whole number of ticks.
  let ticksPerQuarter = 1;
  for (const d of Array.from(root.getElementsByTagName("divisions"))) {
    const value = num(d);
    if (value && value > 0 && Number.isInteger(value)) ticksPerQuarter = lcm(ticksPerQuarter, value);
  }

  const parts: Part[] = [];
  for (const [partId, measureEls] of measuresByPart) {
    const info = partList.get(partId);
    parts.push(parsePart(partId, info, measureEls, ticksPerQuarter));
  }

  const workTitle = text(child(root, "work"), "work-title");
  const movementTitle = text(root, "movement-title");
  const identification = child(root, "identification");
  const composer =
    (identification &&
      children(identification, "creator")
        .find((c) => c.getAttribute("type") === "composer")
        ?.textContent?.trim()) ||
    creditText(root, "composer");
  const arranger = identification ? children(identification, "creator").find((c) => c.getAttribute("type") === "arranger")?.textContent?.trim() : null;
  const rights = identification ? children(identification, "rights").flatMap((r) => r.textContent?.trim() || []) : [];
  return {
    format,
    title: workTitle ?? movementTitle ?? creditText(root, "title"),
    workTitle,
    movementTitle,
    composer: composer || null,
    arranger: arranger || null,
    rights,
    ticksPerQuarter,
    parts,
  };
}

// --- file structure ------------------------------------------------------------------------------

function partwiseMeasures(root: Element): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  for (const part of children(root, "part")) {
    out.set(part.getAttribute("id") ?? `P${out.size + 1}`, children(part, "measure"));
  }
  return out;
}

/** A timewise file nests parts inside measures. Regroup it so the rest of the parser sees parts. */
function timewiseMeasures(root: Element): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  for (const measure of children(root, "measure")) {
    for (const part of children(measure, "part")) {
      const id = part.getAttribute("id") ?? "P1";
      // The part element carries the measure's content; copy the measure's attributes onto it.
      for (const attr of ["number", "implicit"]) {
        const value = measure.getAttribute(attr);
        if (value !== null && !part.hasAttribute(attr)) part.setAttribute(attr, value);
      }
      if (!out.has(id)) out.set(id, []);
      out.get(id)!.push(part);
    }
  }
  return out;
}

interface PartInfo {
  name: string;
  abbreviation: string | null;
  instrument: string | null;
}

function partListInfo(root: Element): Map<string, PartInfo> {
  const out = new Map<string, PartInfo>();
  const list = child(root, "part-list");
  if (!list) return out;
  for (const sp of children(list, "score-part")) {
    const id = sp.getAttribute("id");
    if (!id) continue;
    out.set(id, {
      name: text(sp, "part-name") ?? id,
      abbreviation: text(sp, "part-abbreviation"),
      instrument: text(child(sp, "score-instrument"), "instrument-name"),
    });
  }
  return out;
}

function creditText(root: Element, type: string): string | null {
  for (const credit of children(root, "credit")) {
    const types = children(credit, "credit-type").map((t) => t.textContent?.trim());
    if (types.includes(type)) {
      const words = children(credit, "credit-words")
        .map((w) => w.textContent?.trim())
        .filter(Boolean);
      if (words.length) return words.join(" ");
    }
  }
  return null;
}

// --- one part ------------------------------------------------------------------------------------

function parsePart(id: string, info: PartInfo | undefined, measureEls: Element[], tpq: number): Part {
  const notes: PrintedNote[] = [];
  const measures: Measure[] = [];

  // State carried from measure to measure.
  let divisions = 1;
  let time: TimeSignature | null = null;
  let key: KeySignature = { fifths: 0, mode: null };
  let clefs: Clef[] = [];
  let staves = 1;
  let maxStaves = 1;
  let transposition: Transposition | null = null;
  let octaveShiftOpen = false;
  let partStart = 0;

  measureEls.forEach((measureEl, measureIndex) => {
    const ticks = (duration: number) => Math.round((duration * tpq) / divisions);

    let cursor = 0;
    let maxCursor = 0;
    let lastOnset = 0;
    let noteIndex = 0;
    let timeAtStart = time;
    let keyAtStart = key;
    let clefsAtStart = clefs;
    let octaveShift = octaveShiftOpen;
    const noteIndexes: number[] = [];
    const endings: Ending[] = [];
    const jumps: JumpKind[] = [];
    const tempos: TempoMark[] = [];
    const levels: NonNullable<Measure["levels"]> = [];
    const dynamicMarks: NonNullable<Measure["dynamicMarks"]> = [];
    const words: string[] = [];
    let repeatForward = false;
    let repeatBackward: number | null = null;

    const readSound = (sound: Element | undefined, directionOffset = 0) => {
      if (!sound) return;
      // A sound's own offset wins over its direction's playback offset.
      const onset = cursor + ticks(num(sound, "offset") ?? directionOffset);
      const tempo = Number(sound.getAttribute("tempo"));
      if (sound.hasAttribute("tempo") && tempo > 0) tempos.push({ onset, qpm: tempo });
      const level = Number(sound.getAttribute("dynamics"));
      if (sound.hasAttribute("dynamics") && level >= 0) levels.push({ onset, velocity: Math.max(1, Math.min(127, Math.round(level * 0.9))) });
      for (const kind of JUMP_ATTRIBUTES) {
        if (sound.hasAttribute(kind) && !jumps.includes(kind)) jumps.push(kind);
      }
    };

    for (const el of children(measureEl)) {
      switch (el.tagName) {
        case "attributes": {
          const d = num(el, "divisions");
          if (d && d > 0) divisions = d;
          const keyEl = child(el, "key");
          if (keyEl) key = { fifths: num(keyEl, "fifths") ?? 0, mode: text(keyEl, "mode") };
          const timeEl = child(el, "time");
          if (timeEl) {
            const beats = num(timeEl, "beats");
            const beatType = num(timeEl, "beat-type");
            time = beats && beatType ? { beats, beatType } : time;
          }
          const s = num(el, "staves");
          if (s && s > 0) {
            staves = s;
            maxStaves = Math.max(maxStaves, s);
          }
          const clefEls = children(el, "clef");
          if (clefEls.length) {
            const updated = new Map(clefs.map((c) => [c.staff, c]));
            for (const c of clefEls) {
              const staff = Number(c.getAttribute("number") ?? 1);
              updated.set(staff, {
                staff,
                sign: text(c, "sign") ?? "G",
                line: num(c, "line"),
                octaveChange: num(c, "clef-octave-change") ?? 0,
              });
            }
            clefs = [...updated.values()].sort((a, b) => a.staff - b.staff);
          }
          const transposeEl = child(el, "transpose");
          if (transposeEl) {
            transposition = {
              chromatic: num(transposeEl, "chromatic") ?? 0,
              octaveChange: num(transposeEl, "octave-change") ?? 0,
              ...(num(transposeEl, "diatonic") ? { diatonic: num(transposeEl, "diatonic")! } : {}),
            };
          }
          // Attributes at the very start describe the measure itself.
          if (cursor === 0) {
            timeAtStart = time;
            keyAtStart = key;
            clefsAtStart = clefs;
          }
          break;
        }
        case "note": {
          const note = parseNote(el, id, measureIndex, noteIndex, cursor, lastOnset, ticks, transposition);
          noteIndex += 1;
          if (!note.chord && !note.grace) {
            lastOnset = cursor;
            cursor += note.duration;
          }
          maxCursor = Math.max(maxCursor, cursor);
          noteIndexes.push(notes.length);
          notes.push(note);
          break;
        }
        case "backup":
          cursor = Math.max(0, cursor - ticks(num(el, "duration") ?? 0));
          break;
        case "forward":
          cursor += ticks(num(el, "duration") ?? 0);
          maxCursor = Math.max(maxCursor, cursor);
          break;
        case "direction": {
          const offset = child(el, "offset");
          const printedOnset = cursor + ticks(num(offset) ?? 0);
          const playbackOffset = offset?.getAttribute("sound") === "yes" ? num(offset) ?? 0 : 0;
          for (const dt of children(el, "direction-type")) {
            const staff = num(el, "staff");
            for (const dynamics of children(dt, "dynamics")) {
              for (const mark of children(dynamics)) dynamicMarks.push({ onset: printedOnset, kind: "dynamics", value: mark.tagName, ...(mark.textContent?.trim() ? { text: mark.textContent.trim() } : {}), ...(staff ? { staff } : {}) });
            }
            for (const wedge of children(dt, "wedge")) {
              const type = wedge.getAttribute("type");
              const number = wedge.getAttribute("number");
              if (type) dynamicMarks.push({ onset: printedOnset, kind: "wedge", value: type, ...(number ? { number } : {}), ...(staff ? { staff } : {}) });
            }
            const metronome = child(dt, "metronome");
            const perMinute = num(metronome, "per-minute");
            const unit = text(metronome, "beat-unit");
            if (metronome && perMinute && unit && !child(el, "sound")?.hasAttribute("tempo")) {
              const dotted = children(metronome, "beat-unit-dot").length;
              tempos.push({ onset: cursor + ticks(playbackOffset), qpm: perMinute * beatUnitQuarters(unit, dotted) });
            }
            for (const w of children(dt, "words")) {
              const t = w.textContent?.replace(/\s+/g, " ").trim();
              if (t) words.push(t);
            }
            const shift = child(dt, "octave-shift");
            if (shift) {
              octaveShift = true;
              octaveShiftOpen = shift.getAttribute("type") !== "stop";
            }
            if (child(dt, "segno") && !jumps.includes("segno")) jumps.push("segno");
            if (child(dt, "coda") && !jumps.includes("coda")) jumps.push("coda");
          }
          readSound(child(el, "sound"), playbackOffset);
          break;
        }
        case "sound":
          readSound(el);
          break;
        case "barline": {
          const repeat = child(el, "repeat");
          if (repeat?.getAttribute("direction") === "forward") repeatForward = true;
          if (repeat?.getAttribute("direction") === "backward") {
            repeatBackward = Number(repeat.getAttribute("times") ?? 2) || 2;
          }
          const ending = child(el, "ending");
          if (ending) {
            const type = ending.getAttribute("type");
            if (type === "start" || type === "stop" || type === "discontinue") {
              endings.push({ numbers: endingNumbers(ending.getAttribute("number")), type });
            }
          }
          if (child(el, "segno") && !jumps.includes("segno")) jumps.push("segno");
          if (child(el, "coda") && !jumps.includes("coda")) jumps.push("coda");
          break;
        }
      }
    }

    const nominalLength = timeAtStart
      ? Math.round((timeAtStart.beats * 4 * tpq) / timeAtStart.beatType)
      : null;
    measures.push({
      index: measureIndex,
      number: measureEl.getAttribute("number") ?? String(measureIndex + 1),
      implicit: measureEl.getAttribute("implicit") === "yes",
      start: partStart,
      length: maxCursor,
      nominalLength,
      time: timeAtStart,
      key: keyAtStart,
      clefs: clefsAtStart,
      staves,
      repeatForward,
      repeatBackward,
      endings,
      jumps,
      tempos,
      ...(levels.length ? { levels } : {}),
      ...(dynamicMarks.length ? { dynamicMarks } : {}),
      words,
      octaveShift: octaveShift || octaveShiftOpen,
      noteIndexes,
    });
    partStart += maxCursor;
  });

  return {
    id,
    name: info?.name ?? id,
    abbreviation: info?.abbreviation ?? null,
    instrument: info?.instrument ?? null,
    staves: maxStaves,
    transposition,
    measures,
    notes,
  };
}

function beatUnitQuarters(unit: string, dots: number): number {
  const base: Record<string, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    "16th": 0.25,
    "32nd": 0.125,
  };
  let value = base[unit] ?? 1;
  let add = value / 2;
  for (let i = 0; i < dots; i++) {
    value += add;
    add /= 2;
  }
  return value;
}

/** "1, 2" or "1 2" → [1, 2]. Text that isn't a list of numbers gives an empty list. */
function endingNumbers(attr: string | null): number[] {
  if (!attr) return [];
  return attr
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function parseNote(
  el: Element,
  partId: string,
  measureIndex: number,
  noteIndex: number,
  cursor: number,
  lastOnset: number,
  ticks: (d: number) => number,
  transposition: Transposition | null,
): PrintedNote {
  const chord = !!child(el, "chord");
  const grace = !!child(el, "grace");
  const rest = !!child(el, "rest");
  const unpitched = !!child(el, "unpitched");

  let pitch: Pitch | null = null;
  const pitchEl = child(el, "pitch");
  if (pitchEl) {
    const step = (text(pitchEl, "step") ?? "C") as Step;
    const alter = num(pitchEl, "alter") ?? 0;
    const octave = num(pitchEl, "octave") ?? 4;
    pitch = { step, alter, octave, midi: (octave + 1) * 12 + (STEP_SEMITONES[step] ?? 0) + alter };
  }
  const soundingMidi =
    pitch && transposition
      ? pitch.midi + transposition.chromatic + 12 * transposition.octaveChange
      : (pitch?.midi ?? null);

  // The sound tie (<tie>) says what is played; the drawn tie (<tied>) only stands in when it is missing.
  const tieEls = children(el, "tie");
  const ties = tieEls.map((t) => t.getAttribute("type"));
  const passesOf = (kind: string): number[] | null => {
    const only = tieEls.find((t) => t.getAttribute("type") === kind)?.getAttribute("time-only");
    if (!only) return null;
    const passes = only.split(",").map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0);
    return passes.length ? passes : null;
  };
  const notations = children(el, "notations");
  const inNotations = (name: string) => notations.flatMap((n) => children(n, name));
  const slurs = inNotations("slur");
  const technicalEls = inNotations("technical").flatMap((t) => children(t));
  const tiedEls = inNotations("tied").map((t) => t.getAttribute("type"));

  let bowing: Bowing | null = null;
  if (technicalEls.some((t) => t.tagName === "up-bow")) bowing = "up";
  if (technicalEls.some((t) => t.tagName === "down-bow")) bowing = "down";
  const stringEl = technicalEls.find((t) => t.tagName === "string");

  return {
    ref: { partId, measureIndex, noteIndex },
    rest,
    pitch,
    soundingMidi,
    unpitched,
    chord,
    grace,
    cue: !!child(el, "cue"),
    hidden: el.getAttribute("print-object") === "no",
    ...(el.hasAttribute("dynamics") ? { velocity: Math.max(1, Math.min(127, Math.round(Number(el.getAttribute("dynamics")) * 0.9))) } : {}),
    staff: num(el, "staff") ?? 1,
    voice: text(el, "voice") ?? "1",
    onset: chord ? lastOnset : cursor,
    duration: grace ? 0 : ticks(num(el, "duration") ?? 0),
    type: text(el, "type"),
    dots: children(el, "dot").length,
    tieStart: tieEls.length ? ties.includes("start") : tiedEls.includes("start"),
    tieStop: tieEls.length ? ties.includes("stop") : tiedEls.includes("stop"),
    tieStartPasses: passesOf("start"),
    tieStopPasses: passesOf("stop"),
    slurStarts: slurs.filter((s) => s.getAttribute("type") === "start").map((s) => Number(s.getAttribute("number") ?? 1)),
    slurStops: slurs.filter((s) => s.getAttribute("type") === "stop").map((s) => Number(s.getAttribute("number") ?? 1)),
    articulations: inNotations("articulations").flatMap((a) => children(a).map((x) => x.tagName)),
    ornaments: [
      ...inNotations("ornaments").flatMap((o) => children(o).map((x) => x.tagName)),
      ...inNotations("arpeggiate").map(() => "arpeggiate"),
    ],
    technical: technicalEls.map((t) => t.tagName),
    fingerings: technicalEls.filter((t) => t.tagName === "fingering").map((t) => t.textContent?.trim() ?? ""),
    string: stringEl ? Number(stringEl.textContent) || null : null,
    bowing,
  };
}
