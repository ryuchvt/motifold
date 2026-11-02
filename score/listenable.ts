import type { PlayOrder } from "./playOrder";
import type { Part, PrintedNote } from "./types";

/**
 * Why a bar can't be listened to (TECH §3, the blocked list). The app reads and draws every bar;
 * it only judges a take on bars with none of these.
 */
export type BlockReason =
  | "chord" // chords and double stops
  | "voices" // more than one sounding voice
  | "staves" // a part on more than one staff, like piano
  | "unpitched"
  | "grace"
  | "tremolo"
  | "harmonic"
  | "ornament"
  | "octave-shift"
  | "jump" // a D.C., D.S. or coda that is not written out
  | "unreachable-ending";

export interface PartListening {
  partId: string;
  /** True when at least one bar of the part can be listened to. */
  listenable: boolean;
  /** Reasons per measure index. A measure missing from the map can be listened to. */
  blocked: Map<number, BlockReason[]>;
}

const ORNAMENT_TAGS = new Set([
  "trill-mark",
  "turn",
  "delayed-turn",
  "inverted-turn",
  "delayed-inverted-turn",
  "vertical-turn",
  "shake",
  "wavy-line",
  "mordent",
  "inverted-mordent",
  "schleifer",
  "haydn",
  "arpeggiate",
]);

function sounds(n: PrintedNote): boolean {
  return !n.rest && !n.hidden;
}

export function partListening(part: Part, order: PlayOrder): PartListening {
  const blocked = new Map<number, BlockReason[]>();
  const add = (measureIndex: number, reason: BlockReason) => {
    const reasons = blocked.get(measureIndex) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    blocked.set(measureIndex, reasons);
  };

  for (const m of part.measures) {
    const notes = m.noteIndexes.map((i) => part.notes[i]!);
    const sounding = notes.filter(sounds);
    if (part.staves > 1) add(m.index, "staves");
    if (sounding.some((n) => n.chord)) add(m.index, "chord");
    if (new Set(sounding.map((n) => n.voice)).size > 1) add(m.index, "voices");
    if (sounding.some((n) => n.unpitched)) add(m.index, "unpitched");
    if (sounding.some((n) => n.grace)) add(m.index, "grace");
    if (sounding.some((n) => n.ornaments.includes("tremolo"))) add(m.index, "tremolo");
    if (sounding.some((n) => n.technical.includes("harmonic"))) add(m.index, "harmonic");
    if (sounding.some((n) => n.ornaments.some((o) => ORNAMENT_TAGS.has(o)))) add(m.index, "ornament");
    if (m.octaveShift) add(m.index, "octave-shift");
  }
  // A jump that isn't written out leaves the played order unknown from that point on.
  if (order.jumpMeasures.length > 0) {
    const first = Math.min(...order.jumpMeasures);
    for (const m of part.measures) if (m.index >= first) add(m.index, "jump");
  }
  for (const index of order.unreachableEndings) add(index, "unreachable-ending");

  const listenable = part.measures.some((m) => !blocked.has(m.index) && m.noteIndexes.length > 0);
  return { partId: part.id, listenable, blocked };
}
