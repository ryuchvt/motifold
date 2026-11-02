import { barBox, HIGHLIGHT_CLASS } from "./barOverlay";
import { parseNoteRefKey, type DrawnScore } from "./drawScore";

const SVG_NS = "http://www.w3.org/2000/svg";
export const MARK_CLASS = "pp-mark";
const PLAYHEAD_CLASS = "pp-playhead";
const PLAYHEAD_WIDTH = 3;

/** A highlighter stroke across one printed note (by note key). */
export interface NoteMark {
  key: string;
  /** A CSS modifier: the stroke gets `pp-mark pp-mark-<kind>`. */
  kind: string;
}

/**
 * Draws a highlighter stroke across each note, the way a highlighter crosses a word: as wide as the
 * note and as tall as its staff, behind the notes and above the bar highlights. Notes of one chord
 * share one stroke. Bars where a note failed to map get none (MODULES M3).
 */
export function paintNoteMarks(drawn: DrawnScore, marks: NoteMark[]): void {
  const backend = drawn.osmd.Drawer?.Backends?.[0] as { getSvgElement?: () => SVGElement } | undefined;
  const svg = backend?.getSvgElement?.();
  if (!svg) return;
  for (const old of svg.querySelectorAll(`.${MARK_CLASS}`)) old.remove();

  const bars = svg.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  const after = bars.length ? bars[bars.length - 1]!.nextSibling : svg.firstChild;
  const done = new Set<Element>();
  for (const mark of marks) {
    const el = drawn.elementOf.get(mark.key);
    if (!el || done.has(el)) continue;
    const ref = parseNoteRefKey(mark.key);
    if (drawn.unmappedBars.get(ref.partId)?.has(ref.measureIndex)) continue;
    const box = barBox(drawn, ref.partId, ref.measureIndex);
    if (!box) continue;
    done.add(el);
    const note = (el as unknown as SVGGraphicsElement).getBBox();
    const width = Math.max(note.width + 8, 14);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(note.x + note.width / 2 - width / 2));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "3");
    rect.setAttribute("class", `${MARK_CLASS} ${MARK_CLASS}-${mark.kind}`);
    rect.setAttribute("data-mark", mark.key);
    svg.insertBefore(rect, after);
  }
}

export interface PlayheadAt {
  key: string;
  /** The next note, to slide towards it, while it's on the same line of music. */
  nextKey: string | null;
  frac: number;
  colour: string;
}

/**
 * A line across the staff at the note that's sounding, sliding towards the next. Null takes it away. Says which line
 * of music it's on, so the view can follow only when that changes.
 */
export function paintPlayhead(drawn: DrawnScore, at: PlayheadAt | null): { line: Element; y: number } | null {
  const backend = drawn.osmd.Drawer?.Backends?.[0] as { getSvgElement?: () => SVGElement } | undefined;
  const svg = backend?.getSvgElement?.();
  if (!svg) return null;
  let line = svg.querySelector(`.${PLAYHEAD_CLASS}`);
  const el = at && drawn.elementOf.get(at.key);
  const ref = at && parseNoteRefKey(at.key);
  const box = ref && !drawn.unmappedBars.get(ref.partId)?.has(ref.measureIndex) ? barBox(drawn, ref.partId, ref.measureIndex) : null;
  if (!at || !el || !box) {
    line?.remove();
    return null;
  }
  if (!line) {
    line = document.createElementNS(SVG_NS, "rect");
    line.setAttribute("class", PLAYHEAD_CLASS);
    line.setAttribute("width", String(PLAYHEAD_WIDTH));
    line.setAttribute("rx", "1.5");
    svg.appendChild(line);
  }
  const middle = (e: Element) => {
    const b = (e as unknown as SVGGraphicsElement).getBBox();
    return b.x + b.width / 2;
  };
  const here = middle(el);
  const nextRef = at.nextKey ? parseNoteRefKey(at.nextKey) : null;
  const nextEl = at.nextKey ? drawn.elementOf.get(at.nextKey) : null;
  const nextBox = nextRef ? barBox(drawn, nextRef.partId, nextRef.measureIndex) : null;
  const x = nextEl && nextBox?.y === box.y ? here + (middle(nextEl) - here) * Math.min(1, Math.max(0, at.frac)) : here;
  line.setAttribute("x", String(x - PLAYHEAD_WIDTH / 2));
  line.setAttribute("y", String(box.y));
  line.setAttribute("height", String(box.height));
  line.setAttribute("fill", at.colour);
  return { line, y: box.y };
}
