import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import type { NoteRef, Score } from "../score";
import { mapSourceNotes } from "./noteMap";

export const NOTE_REFS_ATTRIBUTE = "data-note-refs";

export function noteRefKey(ref: NoteRef): string {
  return `${ref.partId}:${ref.measureIndex}:${ref.noteIndex}`;
}

export function parseNoteRefKey(key: string): NoteRef {
  const at = key.lastIndexOf(":");
  const before = key.lastIndexOf(":", at - 1);
  return {
    partId: key.slice(0, before),
    measureIndex: Number(key.slice(before + 1, at)),
    noteIndex: Number(key.slice(at + 1)),
  };
}

export interface DrawnScore {
  osmd: OpenSheetMusicDisplay;
  /** The SVG group drawn for each printed note. Notes of one chord share a group. */
  elementOf: Map<string, SVGGElement>;
  /** Measure indexes per part where results must not be drawn, because a note failed to map. */
  unmappedBars: Map<string, Set<number>>;
}

/** In OSMD's units, about ten pixels each: words and an arc above the staff, chords and notes below it. */
const ROOM_FOR_PENCIL = { study: 17, practice: 25 };
/** The first line's words go between the composer's name and the staff. */
const ROOM_UNDER_COMPOSER = 9;

export interface DrawOptions {
  drawTitle?: boolean;
  autoResize?: boolean;
  /** 1 fits the container's width; larger draws bigger notes and fewer bars per line. */
  zoom?: number;
  /** Room between the lines of music, because a musician writes there, and more while practising. */
  roomForPencil?: keyof typeof ROOM_FOR_PENCIL | null;
}

/** Draws the MusicXML with OSMD and links every drawn note to its printed note (MODULES M3). */
export async function drawScore(
  container: HTMLElement,
  xmlText: string,
  score: Score,
  { drawTitle = true, autoResize = true, zoom = 1, roomForPencil = null }: DrawOptions = {},
): Promise<DrawnScore> {
  const osmd = new OpenSheetMusicDisplay(container, {
    backend: "svg",
    autoResize,
    drawTitle,
    drawComposer: drawTitle,
    drawPartNames: true,
    drawMeasureNumbers: true,
    measureNumberInterval: 1,
  });
  await osmd.load(xmlText);
  if (roomForPencil) {
    osmd.EngravingRules.MinSkyBottomDistBetweenSystems = ROOM_FOR_PENCIL[roomForPencil];
    osmd.EngravingRules.SystemComposerDistance = ROOM_UNDER_COMPOSER;
  }
  osmd.Zoom = zoom;
  osmd.render();

  const { refOf, unmappedBars } = mapSourceNotes(osmd.Sheet, score);
  const elementOf = new Map<string, SVGGElement>();
  const flag = (partId: string, measureIndex: number) => {
    const bars = unmappedBars.get(partId) ?? new Set<number>();
    bars.add(measureIndex);
    unmappedBars.set(partId, bars);
  };

  forEachGraphicalNote(osmd, (gn) => {
    const ref = refOf.get(gn.sourceNote);
    const element = (gn as GraphicalNote & { getSVGGElement?: () => SVGGElement | null }).getSVGGElement?.() ?? null;
    if (!ref) {
      if (gn.sourceNote.PrintObject) {
        flag(gn.sourceNote.ParentStaff.ParentInstrument.IdString, gn.sourceNote.SourceMeasure.measureListIndex);
      }
      return;
    }
    if (!element) {
      if (gn.sourceNote.PrintObject) flag(ref.partId, ref.measureIndex);
      return;
    }
    const key = noteRefKey(ref);
    elementOf.set(key, element);
    const existing = element.getAttribute(NOTE_REFS_ATTRIBUTE);
    element.setAttribute(NOTE_REFS_ATTRIBUTE, existing ? `${existing} ${key}` : key);
  });

  // A visible printed note that nothing was drawn for also blocks its bar.
  for (const part of score.parts) {
    for (const n of part.notes) {
      if (!n.hidden && !elementOf.has(noteRefKey(n.ref))) flag(part.id, n.ref.measureIndex);
    }
  }
  return { osmd, elementOf, unmappedBars };
}

function forEachGraphicalNote(osmd: OpenSheetMusicDisplay, visit: (gn: GraphicalNote) => void): void {
  for (const row of osmd.GraphicSheet.MeasureList) {
    for (const measure of row) {
      if (!measure) continue;
      for (const staffEntry of measure.staffEntries) {
        for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const gn of voiceEntry.notes) visit(gn);
        }
      }
    }
  }
}
