import type { GraphicalMeasure } from "opensheetmusicdisplay";
import type { DrawnScore } from "./drawScore";

const SVG_NS = "http://www.w3.org/2000/svg";
export const HIGHLIGHT_CLASS = "pp-hl";
export const HIGHLIGHT_ID_ATTRIBUTE = "data-highlight";
export const HIGHLIGHT_BAR_ATTRIBUTE = "data-bar";

export interface BarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BarHighlight {
  /** Shared by every bar of one highlight, so clicking any of them finds it. */
  id: string;
  partId: string;
  measureIndex: number;
  /** A CSS modifier: the rectangle gets `pp-hl pp-hl-<kind>`. */
  kind: string;
}

interface StaveLike {
  getX(): number;
  getWidth(): number;
  getYForLine(line: number): number;
}

/**
 * The box around one bar of one part, in the SVG's own units. VexFlow zooms through the viewBox,
 * so these stay right at any zoom. A part on two staves (piano) gets one box over both, and with no part it's the whole line of music.
 */
export function barBox(drawn: DrawnScore, partId: string | null, measureIndex: number): BarBox | null {
  const row = drawn.osmd.GraphicSheet.MeasureList[measureIndex] ?? [];
  const staves = row
    .filter((m): m is GraphicalMeasure => !!m && (partId === null || m.ParentStaff.ParentInstrument.IdString === partId))
    .map((m) => (m as GraphicalMeasure & { getVFStave?: () => StaveLike }).getVFStave?.())
    .filter((s): s is StaveLike => !!s);
  if (staves.length === 0) return null;
  const pad = 6;
  const top = Math.min(...staves.map((s) => s.getYForLine(0))) - pad;
  const bottom = Math.max(...staves.map((s) => s.getYForLine(4))) + pad;
  const first = staves[0]!;
  return { x: first.getX(), y: top, width: first.getWidth(), height: bottom - top };
}

/** Removes earlier highlights and draws these behind the notes. Returns each rectangle by highlight id. */
export function paintHighlights(drawn: DrawnScore, highlights: BarHighlight[]): Map<string, SVGRectElement[]> {
  const backend = drawn.osmd.Drawer?.Backends?.[0] as { getSvgElement?: () => SVGElement } | undefined;
  const svg = backend?.getSvgElement?.() as SVGSVGElement | undefined;
  const out = new Map<string, SVGRectElement[]>();
  if (!svg) return out;
  for (const old of svg.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) old.remove();

  for (const h of highlights) {
    const box = barBox(drawn, h.partId, h.measureIndex);
    if (!box) continue;
    // A bar where a note failed to map gets no result drawn on it (MODULES M3).
    if (drawn.unmappedBars.get(h.partId)?.has(h.measureIndex)) continue;
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(box.x));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "4");
    rect.setAttribute("class", `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}-${h.kind}`);
    rect.setAttribute(HIGHLIGHT_ID_ATTRIBUTE, h.id);
    rect.setAttribute(HIGHLIGHT_BAR_ATTRIBUTE, `${h.partId}:${h.measureIndex}`);
    // First in the SVG, so the notes draw on top.
    svg.insertBefore(rect, svg.firstChild);
    out.set(h.id, [...(out.get(h.id) ?? []), rect]);
  }
  return out;
}
