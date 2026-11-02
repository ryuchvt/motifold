import { barBox, type BarBox } from "./barOverlay";
import { NOTE_REFS_ATTRIBUTE, parseNoteRefKey, type DrawnScore } from "./drawScore";

const SVG_NS = "http://www.w3.org/2000/svg";
const STUDY_CLASS = "pp-study";
/** Room for the bar number OSMD writes above the staff. */
const ABOVE_STAFF = 16;
const ARC_RISE = 9;
/** The height of a line of chords and of a line of words, under the staff and over it. */
const LINE = 16;
const WORD_LINE = 14;
const COUNT_HALF = 14;
/** Words narrower than this would wrap a word at a time, so they start further left instead. */
const NARROWEST_WORDS = 150;
const GAP = 8;
const MOST_CIRCLED = 8;
/** OSMD lays out in its own units, ten to the SVG's pixel. */
const OSMD_UNIT = 10;

/** What a musician pencils on a score while studying it, by measure index (Mark Tse, "Score (Studying) Marking"). */
export interface StudyMarks {
  /** Null when it read every part, and then its writing belongs to the whole line of music. */
  partId: string | null;
  /** `form` is its letter, and `tint` is shared by every section of the same idea, so the eye sees it's the same music again. */
  sections: { from: number; to: number; form: string; tint: number; name: string; mood: string | null; what: string | null }[];
  chords: { bar: number; noteKey: string | null; along: number; chord: string; numeral: string; doubtful: boolean; role: string }[];
  /** Exact notes, circled. With `lands`, the last note is the one the others go to, and an arrow goes to it. `tone` is its colour. */
  passages: { keys: string[]; lands: boolean; tone: string; words: string }[];
  /** How high each marked note is, which tells the notes of a chord apart on the page. */
  heights: Record<string, number>;
  /** Which part and staff each note is on, so a mark across two gets a circle on each. */
  lines?: Record<string, string>;
  focus: { bar: number; words: string }[];
  /** Muse Spark on the latest try, written at the bars being practised. */
  said?: { bar: number; tone: string; words: string }[];
}

export interface ArcPiece {
  section: number;
  /** The first bar under this piece, which says how far its line of music reaches. */
  bar: number;
  /** The staff's top, which tells one line of music from another. */
  y: number;
  x0: number;
  x1: number;
  /** The section starts on this line, so the arc curves down at its left and it carries the words. */
  opens: boolean;
  /** The section ends on this line, so the arc curves down at its right. */
  closes: boolean;
}

/** Each section's arc, cut at the end of a line of music the way a bracket carries a phrase over a page. */
export function arcPieces(sections: Pick<StudyMarks["sections"][number], "from" | "to">[], boxOf: (bar: number) => BarBox | null): ArcPiece[] {
  return sections.flatMap((section, s) => {
    const pieces: ArcPiece[] = [];
    for (let bar = section.from; bar <= section.to; bar++) {
      const box = boxOf(bar);
      if (!box) continue;
      const last = pieces[pieces.length - 1];
      if (last && last.y === box.y) last.x1 = box.x + box.width;
      else pieces.push({ section: s, bar, y: box.y, x0: box.x, x1: box.x + box.width, opens: bar === section.from, closes: false });
    }
    const last = pieces[pieces.length - 1];
    if (last && boxOf(section.to)?.y === last.y) last.closes = true;
    return pieces;
  });
}

/** Words broken into lines that fit, keeping every word whole. */
export function wrapWords(words: string, width: number, widthOf: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words.trim().split(/\s+/)) {
    const longer = line ? `${line} ${word}` : word;
    if (line && widthOf(longer) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const arcPath = ({ x0, x1, opens, closes }: ArcPiece, y: number): string => {
  const inset = 3;
  const bend = Math.min(14, (x1 - x0) / 3);
  const left = opens ? `M${x0 + inset} ${y} Q${x0 + inset} ${y - ARC_RISE} ${x0 + inset + bend} ${y - ARC_RISE}` : `M${x0} ${y - ARC_RISE}`;
  const right = closes ? `L${x1 - inset - bend} ${y - ARC_RISE} Q${x1 - inset} ${y - ARC_RISE} ${x1 - inset} ${y}` : `L${x1} ${y - ARC_RISE}`;
  return `${left} ${right}`;
};

/**
 * How far a whole system reaches above and below, every instrument, beams and slurs included. It's the outline OSMD spaces
 * its own lines by. Writing goes outside it, so with an accompaniment the chords sit under the piano and never on it.
 */
function reachOfLine(drawn: DrawnScore, measureIndex: number): { top: number; bottom: number } | null {
  const staves = (drawn.osmd.GraphicSheet.MeasureList[measureIndex] ?? []).filter(Boolean);
  const edges = staves.flatMap((m) => {
    const line = m?.ParentStaffLine;
    const outline = line?.SkyBottomLineCalculator;
    const y = line?.PositionAndShape?.AbsolutePosition?.y;
    return outline && y !== undefined ? [{ top: (y + outline.getSkyLineMin()) * OSMD_UNIT, bottom: (y + outline.getBottomLineMax()) * OSMD_UNIT }] : [];
  });
  return edges.length ? { top: Math.min(...edges.map((e) => e.top)), bottom: Math.max(...edges.map((e) => e.bottom)) } : null;
}

/** Where each bar's music starts, past the clef and key signature at the start of a line. */
function firstNotes(drawn: DrawnScore, partId: string | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, el] of drawn.elementOf) {
    const ref = parseNoteRefKey(key);
    if (partId !== null && ref.partId !== partId) continue;
    const x = (el as unknown as SVGGraphicsElement).getBBox().x;
    out.set(ref.measureIndex, Math.min(out.get(ref.measureIndex) ?? Infinity, x));
  }
  return out;
}

/**
 * The analysis written on the music, so it's all in view while playing: a structure line and an arc at each section with
 * its letter and what it does, exact notes circled with a note beside them, and the chord and numeral under the notes.
 * None of it takes a tap away from the notes. Null clears it.
 */
export function paintStudyMarks(drawn: DrawnScore, marks: StudyMarks | null): void {
  const backend = drawn.osmd.Drawer?.Backends?.[0] as { getSvgElement?: () => SVGElement } | undefined;
  const svg = backend?.getSvgElement?.();
  if (!svg) return;
  for (const old of svg.querySelectorAll(`.${STUDY_CLASS}`)) old.remove();
  if (!marks) return;

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", STUDY_CLASS);
  svg.appendChild(group);
  const write = (x: number, y: number, kind: string, words: string) => {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("class", `${STUDY_CLASS}-${kind}`);
    text.textContent = words;
    group.appendChild(text);
    return text;
  };
  const shape = (name: string, kind: string, attributes: Record<string, string | number>) => {
    const el = document.createElementNS(SVG_NS, name);
    el.setAttribute("class", `${STUDY_CLASS}-${kind}`);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    group.appendChild(el);
    return el;
  };
  /** Words broken to fit, measured in this kind of writing. */
  const wrap = (kind: string, words: string, width: number) => {
    const probe = write(-1000, -1000, kind, "");
    const lines = wrapWords(words, width, (text) => {
      probe.textContent = text;
      return probe.getComputedTextLength?.() ?? text.length * 7;
    });
    probe.remove();
    return lines;
  };

  const { partId } = marks;
  const boxOf = (bar: number) => barBox(drawn, partId, bar);
  const singleStaff = (drawn.osmd.GraphicSheet.MeasureList[0] ?? []).filter(Boolean).length <= 1;
  const starts = firstNotes(drawn, partId);
  const staffPad = 6;
  const below = (bar: number, box: BarBox) => Math.max(reachOfLine(drawn, bar)?.bottom ?? -Infinity, box.y + box.height - staffPad) + LINE + 7;
  const rowRight = new Map<number, number>();
  for (let bar = 0; bar < drawn.osmd.GraphicSheet.MeasureList.length; bar++) {
    const box = boxOf(bar);
    if (box) rowRight.set(box.y, Math.max(rowRight.get(box.y) ?? 0, box.x + box.width));
  }

  /**
   * Where a note is. The notes of a chord share one drawing, whose box takes in the stem and any fermata, so a chord's
   * note is found by its own head. Null when that can't be told, because a mark mustn't claim a note it can't find.
   */
  const noteAt = (key: string) => {
    const group = drawn.elementOf.get(key);
    if (!group) return null;
    const refs = group.getAttribute(NOTE_REFS_ATTRIBUTE)?.split(" ") ?? [];
    if (refs.length < 2) return (group as unknown as SVGGraphicsElement).getBBox();
    const heads = [...group.querySelectorAll(".vf-notehead")].map((head) => (head as unknown as SVGGraphicsElement).getBBox());
    const low = (k: string) => marks.heights[k] ?? NaN;
    if (heads.length !== refs.length || refs.some((k) => Number.isNaN(low(k)))) return null;
    const lowFirst = [...refs].sort((a, b) => low(a) - low(b));
    const lowestOnPage = [...heads].sort((a, b) => b.y - a.y);
    return lowestOnPage[lowFirst.indexOf(key)] ?? null;
  };

  // The section's colour under the music, so the eye finds the same idea again from across the page.
  const wash = document.createElementNS(SVG_NS, "g");
  wash.setAttribute("class", `${STUDY_CLASS} ${STUDY_CLASS}-wash`);
  svg.insertBefore(wash, svg.firstChild);
  for (const piece of arcPieces(marks.sections, boxOf)) {
    const rect = document.createElementNS(SVG_NS, "rect");
    const box = boxOf(piece.bar)!;
    rect.setAttribute("x", String(piece.x0));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(piece.x1 - piece.x0));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("class", `form-tint-${marks.sections[piece.section]!.tint}`);
    wash.appendChild(rect);
  }

  // Chords close together, like across a short bar, sit side by side and not on top of each other.
  const chordEnds = new Map<number, number>();
  for (const { bar, noteKey, along, chord, numeral, doubtful, role } of marks.chords) {
    const box = boxOf(bar);
    if (!box) continue;
    const start = starts.get(bar) ?? box.x + 4;
    const wanted = (noteKey && noteAt(noteKey)?.x) || start + (box.x + box.width - start) * along;
    const x = Math.max(wanted, (chordEnds.get(box.y) ?? -Infinity) + GAP);
    const y = below(bar, box);
    const tone = doubtful ? "pp-study-doubtful" : `pp-role-${role}`;
    const written = write(x, y, `chord ${tone}`, chord);
    chordEnds.set(box.y, x + (written.getComputedTextLength?.() ?? chord.length * 8));
    if (numeral && numeral !== "?" && numeral !== "pass") write(x, y + LINE, `numeral ${tone}`, numeral);
  }

  // Under the chords, each note takes the first free line of its line of music.
  const used = new Map<number, number[]>();
  const placeWords = (bar: number, box: BarBox, atX: number, kind: string, words: string) => {
    const right = rowRight.get(box.y) ?? box.x + box.width;
    const x = Math.max(box.x, Math.min(atX, right - NARROWEST_WORDS));
    const lines = wrap(kind, words, right - x);
    const row = used.get(box.y) ?? [];
    used.set(box.y, row);
    let line = 0;
    while (lines.some((_, k) => (row[line + k] ?? -Infinity) > x - GAP)) line++;
    const top = below(bar, box) + 2 * LINE;
    lines.forEach((text, k) => {
      const written = write(x, top + (line + k) * WORD_LINE, kind, text);
      row[line + k] = x + (written.getComputedTextLength?.() ?? text.length * 7);
    });
  };

  for (const { bar, tone, words } of marks.said ?? []) {
    const box = boxOf(bar);
    if (box) placeWords(bar, box, starts.get(bar) ?? box.x + 4, `said pp-tone-${tone}`, words);
  }

  for (const { keys, lands, tone, words } of marks.passages) {
    const inTone = `pp-tone-${tone}`;
    // What goes somewhere is circled and what it lands on isn't, along with the rest of the chord it lands on.
    const landing = drawn.elementOf.get(keys[keys.length - 1]!);
    const leading = lands && keys.length > 1 ? keys.filter((key) => drawn.elementOf.get(key) !== landing) : keys;
    // All of it one chord: there's nothing leading anywhere, so the chord itself gets the circle and the words.
    const oneChord = leading.length === 0;
    const circled = oneChord ? keys : leading;
    // One piece for each line of music and, when it's about two parts, one for each of them.
    const pieces: { bar: number; box: BarBox; line: string; x0: number; x1: number; y0: number; y1: number }[] = [];
    let end: (typeof pieces)[number] | undefined;
    for (const key of circled) {
      const note = noteAt(key);
      const bar = parseNoteRefKey(key).measureIndex;
      const box = boxOf(bar);
      if (!note || !box) continue;
      const line = marks.lines?.[key] ?? "";
      const same = [...pieces].reverse().find((p) => p.box.y === box.y && p.line === line);
      if (same) {
        same.x1 = Math.max(same.x1, note.x + note.width);
        same.y0 = Math.min(same.y0, note.y);
        same.y1 = Math.max(same.y1, note.y + note.height);
        end = same;
      } else {
        end = { bar, box, line, x0: note.x, x1: note.x + note.width, y0: note.y, y1: note.y + note.height };
        pieces.push(end);
      }
    }
    // A few notes get circled. A long stretch like a pedal gets a bracket under it, because a box that size hides the music.
    const wide = circled.length > MOST_CIRCLED;
    for (const p of pieces) {
      if (!wide) {
        shape("rect", `passage ${inTone}`, { x: p.x0 - 5, y: p.y0 - 4, width: p.x1 - p.x0 + 10, height: p.y1 - p.y0 + 8, rx: 10 });
        continue;
      }
      // Under the staff on one staff. With more than one that's under the others too, so it goes under its own notes.
      const y = singleStaff ? Math.max(p.box.y + p.box.height, p.y1) + 2 : p.y1 + 6;
      shape("path", `arrow ${inTone}`, { d: `M${p.x0} ${y - 5} L${p.x0} ${y} L${p.x1} ${y} ${p === end && lands ? `M${p.x1 - 6} ${y - 4} L${p.x1} ${y} L${p.x1 - 6} ${y + 4}` : `L${p.x1} ${y - 5}`}` });
    }
    // An arrow from one part to another is only for what passes between them. Anything else keeps its circles and its words.
    const crossing = marks.lines && marks.lines[keys[keys.length - 1]!] !== end?.line;
    if (lands && end && keys.length > 1 && !wide && !oneChord && (!crossing || tone === "with")) {
      const target = noteAt(keys[keys.length - 1]!);
      const targetBox = boxOf(parseNoteRefKey(keys[keys.length - 1]!).measureIndex);
      const fromX = end.x1 + 5;
      const fromY = (end.y0 + end.y1) / 2;
      // A note on the next line of music is out of reach, so the arrow only points on towards it.
      const onLine = target && targetBox?.y === end.box.y;
      const toX = onLine ? target.x + target.width / 2 : fromX + 18;
      const toY = onLine ? target.y - 3 : fromY;
      shape("path", `arrow ${inTone}`, { d: `M${fromX} ${fromY} Q${(fromX + toX) / 2} ${Math.min(fromY, toY) - 12} ${toX} ${toY} M${toX - 5} ${toY - 5} L${toX} ${toY} L${toX + 5} ${toY - 5}` });
    }
    const first = pieces[0];
    if (first) placeWords(first.bar, first.box, first.x0, `note ${inTone}`, words);
  }

  for (const { bar, words } of marks.focus) {
    const box = boxOf(bar);
    if (box) placeWords(bar, box, starts.get(bar) ?? box.x + 4, "focus", `Focus: ${words}`);
  }

  const pieces = arcPieces(marks.sections, boxOf);
  for (const piece of pieces) {
    const y = Math.min(reachOfLine(drawn, piece.bar)?.top ?? Infinity, piece.y + staffPad - ABOVE_STAFF) - 4;
    shape("path", `${piece.opens ? "arc" : "arc pp-study-carried"} form-ink-${marks.sections[piece.section]!.tint}`, { d: arcPath(piece, y) });
    const section = marks.sections[piece.section]!;
    const middle = (piece.x0 + piece.x1) / 2;
    if (piece.opens && piece.x1 - piece.x0 > 2 * COUNT_HALF) write(middle, y - ARC_RISE + 4, "count", `(${section.to - section.from + 1})`).setAttribute("text-anchor", "middle");
    if (!piece.opens) continue;

    // The structure line goes through the staff where the section starts.
    const box = boxOf(section.from)!;
    const lineX = (starts.get(section.from) ?? box.x) - 7;
    shape("line", "structure", { x1: lineX, x2: lineX, y1: y - ARC_RISE, y2: box.y + box.height - staffPad });

    // The words stop where the next section's begin.
    const next = pieces.find((p) => p.opens && p.y === piece.y && p.x0 > piece.x0);
    const width = (next?.x0 ?? rowRight.get(piece.y) ?? piece.x1) - piece.x0 - GAP;
    const what = section.what ? wrap("what", section.what, width) : [];
    let line = y - ARC_RISE - GAP;
    for (const text of [...what].reverse()) {
      write(piece.x0 + 3, line, "what", text);
      line -= WORD_LINE;
    }
    const formAt = piece.x0 + 13;
    shape("circle", `circle form-tint-${section.tint}`, { cx: formAt, cy: line - 5, r: 10 });
    write(formAt, line - 1, "letter", section.form).setAttribute("text-anchor", "middle");
    const nameX = formAt + 15;
    const name = write(nameX, line, "name", section.name);
    if (section.mood) write(nameX + (name.getComputedTextLength?.() ?? section.name.length * 8) + 7, line, "mood", section.mood);
  }
}
