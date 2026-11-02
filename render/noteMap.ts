import type { MusicSheet, Note } from "opensheetmusicdisplay";
import type { NoteRef, Score } from "../score";

/**
 * Links OSMD's notes to our printed notes (MODULES M3). OSMD keeps no pointer back to the
 * <note> element, so both sides are put into buckets by part, measure, staff, voice, onset and
 * kind (grace, rest or note), then paired by pitch inside each bucket. A bar where any visible
 * note fails to pair, or pairs with a different pitch or length (R5 M3, review S4), is reported, and
 * nothing measured is drawn on it.
 */
export interface NoteMap {
  refOf: Map<Note, NoteRef>;
  /** Measure indexes per part where the drawing and the parsed score disagree. */
  unmappedBars: Map<string, Set<number>>;
}

interface Entry<T> {
  item: T;
  /** MIDI pitch, -1 for a rest. */
  pitch: number;
  /** Ticks, for notes and rests (measure rests too, recheck S4). Null for grace notes: not compared. */
  duration: number | null;
  order: number;
  visible: boolean;
}

function bucketKey(partId: string, measureIndex: number, staff: number, voice: string, onset: number, kind: string) {
  return `${partId}|${measureIndex}|${staff}|${voice}|${onset}|${kind}`;
}

function push<T>(buckets: Map<string, Entry<T>[]>, key: string, entry: Entry<T>) {
  const list = buckets.get(key);
  if (list) list.push(entry);
  else buckets.set(key, [entry]);
}

export function mapSourceNotes(sheet: MusicSheet, score: Score): NoteMap {
  const ours = new Map<string, Entry<NoteRef>[]>();
  for (const part of score.parts) {
    part.notes.forEach((n, order) => {
      const kind = n.grace ? "grace" : n.rest ? "rest" : "note";
      push(ours, bucketKey(part.id, n.ref.measureIndex, n.staff, n.voice, n.onset, kind), {
        item: n.ref,
        pitch: n.pitch?.midi ?? -1,
        duration: kind === "grace" ? null : n.duration,
        order,
        visible: !n.hidden,
      });
    });
  }

  const theirs = new Map<string, Entry<Note>[]>();
  const ticksPerWhole = 4 * score.ticksPerQuarter;
  let order = 0;
  for (const measure of sheet.SourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const staffEntry of container.StaffEntries) {
        if (!staffEntry) continue;
        const staff = staffEntry.ParentStaff;
        const instrument = staff.ParentInstrument;
        const staffNumber = instrument.Staves.indexOf(staff) + 1;
        for (const voiceEntry of staffEntry.VoiceEntries) {
          const onset = Math.round(voiceEntry.Timestamp.RealValue * ticksPerWhole);
          const voice = String(voiceEntry.ParentVoice.VoiceId);
          for (const note of voiceEntry.Notes) {
            const kind = voiceEntry.IsGrace ? "grace" : note.isRest() ? "rest" : "note";
            push(theirs, bucketKey(instrument.IdString, measure.measureListIndex, staffNumber, voice, onset, kind), {
              item: note,
              // OSMD's half tone is MIDI minus 12.
              pitch: note.isRest() ? -1 : note.Pitch.getHalfTone() + 12,
              duration: kind === "grace" ? null : Math.round(note.Length.RealValue * ticksPerWhole),
              order: order++,
              visible: note.PrintObject,
            });
          }
        }
      }
    }
  }

  const refOf = new Map<Note, NoteRef>();
  const unmappedBars = new Map<string, Set<number>>();
  const flag = (partId: string, measureIndex: number) => {
    const bars = unmappedBars.get(partId) ?? new Set<number>();
    bars.add(measureIndex);
    unmappedBars.set(partId, bars);
  };
  const byPitch = <T>(a: Entry<T>, b: Entry<T>) => a.pitch - b.pitch || a.order - b.order;

  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    const a = (ours.get(key) ?? []).sort(byPitch);
    const b = (theirs.get(key) ?? []).sort(byPitch);
    const [partId, measureIndex] = key.split("|") as [string, string];
    const paired = Math.min(a.length, b.length);
    let differs = false;
    for (let i = 0; i < paired; i++) {
      refOf.set(b[i]!.item, a[i]!.item);
      const ours = a[i]!;
      const drawn = b[i]!;
      if (ours.pitch !== drawn.pitch || (ours.duration !== null && drawn.duration !== null && ours.duration !== drawn.duration)) differs = true;
    }
    const leftover = [...a.slice(paired), ...b.slice(paired)];
    if (differs || leftover.some((e) => e.visible)) flag(partId, Number(measureIndex));
  }
  return { refOf, unmappedBars };
}
