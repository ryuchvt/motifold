import type { Score } from '../score';
import { noteRefKey } from '../render/drawScore';
import type { PlayheadAt } from '../render/noteMarks';
import type { PieceBar } from './pieceData';

/** A cursor on one actual printed stave. Global playback time is mapped through printed bars, not excerpt offsets. */
export function scoreCursor(score: Score, bars: PieceBar[]): (beat: number | null) => PlayheadAt | null {
  const part = score.parts.find((p) => p.notes.some((n) => !n.rest && !n.hidden && !n.cue && !n.grace && n.pitch));
  const repeated = new Set(bars.filter((bar, i) => bars.findIndex((b) => b.number === bar.number) !== i).map((b) => b.number));
  const onsets = new Map(bars.map((b) => [b.number, b.start]));
  const events = (part?.notes ?? []).flatMap((note) => {
    const number = part?.measures[note.ref.measureIndex]?.number;
    const start = number === undefined || repeated.has(number) ? undefined : onsets.get(number);
    if (start === undefined || note.rest || note.hidden || note.cue || note.grace || !note.pitch || note.duration <= 0) return [];
    const beat = start + note.onset / score.ticksPerQuarter;
    return [{ beat, end: beat + note.duration / score.ticksPerQuarter, key: noteRefKey(note.ref) }];
  }).sort((a, b) => a.beat - b.beat || b.end - a.end);
  const line = events.filter((event, index) => index === 0 || events[index - 1]!.beat !== event.beat);
  return (beat) => {
    if (beat === null) return null;
    for (let index = line.length - 1; index >= 0; index--) {
      const event = line[index]!;
      if (event.beat > beat) continue;
      if (beat >= event.end) continue;
      const next = line.slice(index + 1).find((n) => n.beat > beat);
      return { key: event.key, nextKey: next?.key ?? null, frac: next ? Math.max(0, Math.min(1, (beat - event.beat) / (next.beat - event.beat))) : 0, colour: '#596c82' };
    }
    return null;
  };
}
