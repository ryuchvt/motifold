import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { NoteRef, Score } from "../score";
import {
  HIGHLIGHT_BAR_ATTRIBUTE,
  HIGHLIGHT_CLASS,
  HIGHLIGHT_ID_ATTRIBUTE,
  paintHighlights,
  type BarHighlight,
} from "../render/barOverlay";
import { drawScore, NOTE_REFS_ATTRIBUTE, parseNoteRefKey, type DrawnScore } from "../render/drawScore";
import { paintNoteMarks, paintPlayhead, type NoteMark, type PlayheadAt } from "../render/noteMarks";
import { paintStudyMarks, type StudyMarks } from "../render/studyMarks";

/** Where to point a bubble, in px from the top left of the score view. */
export interface Anchor {
  x: number;
  top: number;
  bottom: number;
}

export type Tap =
  | { note: NoteRef | null; highlightId: string | null; bar: { partId: string; measureIndex: number } | null; anchor: Anchor }
  | null;

export interface ScoreViewHandle {
  /** Scrolls a highlighted bar into view and says where it is. */
  showBar(partId: string, measureIndex: number, at?: "middle" | "top"): Anchor | null;
  /** Moves the playback line, and follows it when it reaches another line of music. Null takes it away. */
  showPlaying(at: PlayheadAt | null): void;
}

interface Props {
  xmlText: string;
  /** One stretch of a piece, which has its name elsewhere on the page. */
  noTitle?: boolean;
  score: Score;
  zoom: number;
  highlights: BarHighlight[];
  /** Highlighter strokes across notes: the changed note, take results, the tapped note. */
  noteMarks: NoteMark[];
  /** The analysis in pencil, while studying the score. */
  studyMarks?: StudyMarks | null;
  /** More room to write in, while practising a few bars. */
  practising?: boolean;
  onTap: (tap: Tap) => void;
  onDrawn: (drawn: DrawnScore | null, error: string | null) => void;
}

/** A fingertip is wider than a notehead: a tap this close to a note picks it. */
const TAP_RADIUS_PX = 22;

export const ScoreView = forwardRef<ScoreViewHandle, Props>(function ScoreView(
  { xmlText, noTitle, score, zoom, highlights, noteMarks, studyMarks, practising, onTap, onDrawn },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<DrawnScore | null>(null);
  const [width, setWidth] = useState(0);
  const playingLine = useRef<number | null>(null);
  const room = !studyMarks ? null : practising ? "practice" : "study";

  // Redraw to fit when the space changes: the side panel opening or closing, a window resize,
  // an iPad turning. Rounded and debounced so a drag doesn't redraw on every pixel.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round((entry?.contentRect.width ?? 0) / 20) * 20;
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), 150);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    setDrawn(null);
    // Each draw gets its own host. OSMD loads asynchronously, so a draw that was cancelled
    // (React runs effects twice in development) can still finish; it then lands in a detached
    // host instead of beside the live one. OSMD's own auto-resize is off for the same reason.
    const host = document.createElement("div");
    el.appendChild(host);
    // The title and composer are drawn on the sheet, like a printed page.
    drawScore(host, xmlText, score, { autoResize: false, zoom, roomForPencil: room, drawTitle: !noTitle })
      .then((d) => {
        if (cancelled) return;
        setDrawn(d);
        onDrawn(d, null);
      })
      .catch((e: unknown) => {
        if (!cancelled) onDrawn(null, e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      host.remove();
    };
    // onDrawn is a callback prop; redrawing on its identity would loop.
  }, [xmlText, score, zoom, width, room, noTitle]);

  useEffect(() => {
    if (drawn) paintHighlights(drawn, highlights);
  }, [drawn, highlights]);

  // After the bar highlights, so the strokes sit above them and below the notes.
  useEffect(() => {
    if (drawn) paintNoteMarks(drawn, noteMarks);
  }, [drawn, highlights, noteMarks]);

  useEffect(() => {
    if (!drawn) return;
    paintStudyMarks(drawn, studyMarks ?? null);
    if (!studyMarks) return;
    // Words are placed by how wide they are, and the pencil font may arrive after the first paint.
    let live = true;
    void document.fonts?.load("13px Kalam").then(() => {
      if (live) paintStudyMarks(drawn, studyMarks);
    });
    return () => {
      live = false;
    };
  }, [drawn, studyMarks]);

  const anchorOf = (el: Element): Anchor => {
    const box = el.getBoundingClientRect();
    const origin = root.current!.getBoundingClientRect();
    return { x: box.left + box.width / 2 - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top };
  };

  useImperativeHandle(ref, () => ({
    showBar(partId, measureIndex, at = "middle") {
      const rect = root.current?.querySelector(`[${HIGHLIGHT_BAR_ATTRIBUTE}="${partId}:${measureIndex}"]`);
      if (!rect) return null;
      // At the top, with room above it for the section's words, so the writing under it is in view.
      (rect as SVGElement).style.scrollMarginTop = "190px";
      rect.scrollIntoView({ behavior: "smooth", block: at === "top" ? "start" : "center" });
      return anchorOf(rect);
    },
    showPlaying(at) {
      if (!drawn) return;
      const painted = paintPlayhead(drawn, at);
      if (painted && painted.y !== playingLine.current) {
        // Below whatever stays stuck to the top of the page: the chart, when it's playing, or the header.
        const covered = document.querySelector(".movement.playing")?.getBoundingClientRect().bottom ?? 0;
        (painted.line as SVGElement).style.scrollMarginTop = `${Math.max(covered, 72) + 16}px`;
        painted.line.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      playingLine.current = painted?.y ?? null;
    },
  }));

  const nearestNote = (x: number, y: number): Element | null => {
    if (!drawn) return null;
    let best: Element | null = null;
    let bestDistance = TAP_RADIUS_PX;
    for (const el of new Set(drawn.elementOf.values())) {
      const box = el.getBoundingClientRect();
      const dx = Math.max(box.left - x, 0, x - box.right);
      const dy = Math.max(box.top - y, 0, y - box.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        best = el;
        bestDistance = distance;
      }
    }
    return best;
  };

  const handleClick = (event: React.MouseEvent) => {
    const target = event.target as Element;
    const noteEl = target.closest(`[${NOTE_REFS_ATTRIBUTE}]`) ?? nearestNote(event.clientX, event.clientY);
    const highlightEl = target.closest(`.${HIGHLIGHT_CLASS}`);
    const key = noteEl?.getAttribute(NOTE_REFS_ATTRIBUTE)?.split(" ")[0];
    const note = key ? parseNoteRefKey(key) : null;
    const barKey = highlightEl?.getAttribute(HIGHLIGHT_BAR_ATTRIBUTE);
    const bar = note
      ? { partId: note.partId, measureIndex: note.measureIndex }
      : barKey
        ? { partId: barKey.slice(0, barKey.lastIndexOf(":")), measureIndex: Number(barKey.slice(barKey.lastIndexOf(":") + 1)) }
        : null;
    const anchorEl = noteEl ?? highlightEl;
    if (!anchorEl) {
      onTap(null);
      return;
    }
    onTap({ note, highlightId: highlightEl?.getAttribute(HIGHLIGHT_ID_ATTRIBUTE) ?? null, bar, anchor: anchorOf(anchorEl) });
  };

  return <div className="sheet-view" ref={root} onClick={handleClick} />;
});
