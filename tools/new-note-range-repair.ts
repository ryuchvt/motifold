import { parseEvents, rangeOf, type OptionCheck } from '../app/arrange';
import { noteHeight, noteName } from '../app/notes';
import type { WriteAnswer } from '../server/shapes';

export interface NoteRangeRepair { bar: string; parts: string[]; ask: string }
const keyOf = (part: string, bar: string) => JSON.stringify([part, bar]);
const sorted = (items: string[]) => items.sort();
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
export const repairReviewJson = stable;
export interface NoteRepairReviewIdentity { sourceSha256: string; recipeSha256: string; planSha256: string; rawAddsSha256: string; label: string }
const PULSE_A_REVIEW: NoteRepairReviewIdentity = {
  sourceSha256: 'a8b4ee04a41ee125b8e7e042fe6c5dd3baf82fe65fd588eac6823770a9b8304f',
  recipeSha256: '00afdc980fc24914c41bfcec7e845c9b87a5e2eaf55915e8480232a605d74200',
  planSha256: 'd21f14f98c9ff1d6cfaab0096431ce8759d86282ad66ba684f938b27274a7101',
  rawAddsSha256: 'c5c9a1b9aa4ff67ba526062c81fd1bf0c0b69cb00e61e4a691fc2342e97becb6',
  label: 'A',
};
/** One operator-reviewed original outcome. Digests are computed from live state or authenticated writes, never a summary allowance. */
export function reviewedNoteRepair(identity: NoteRepairReviewIdentity | undefined, check: OptionCheck): boolean {
  const flags = check.outOfRange.map(note => [note.part, note.bar, note.name].join('/')).sort();
  return same(identity, PULSE_A_REVIEW) && check.notes === 635 && !check.overBars && !check.unreadable && !check.pastBarEnd && same(flags, [
    'Violin II/5/E3', 'Violin II/7/D3', 'Violin II/7/E3', 'Violin II/8/D3', 'Violin II/8/F3', 'Violin II/9/E3',
  ]);
}
export function reviewedNoteRepairPhases(identity: NoteRepairReviewIdentity, check: OptionCheck, caseId: string): string[] {
  return reviewedNoteRepair(identity, check) ? [3, 4].map(ordinal => `${caseId}-a-note-range-repair-${ordinal}`) : [];
}
// The exporter gives omitted and exactly empty articulation the same meaning. Keep raw replies intact.
const artKey = (art: string | undefined) => art === '' ? null : art ?? null;
function requireThat(ok: unknown, why: string): asserts ok { if (!ok) throw Error(why); }

/** Two bars by default; only the fingerprinted Pulse A review permits its four original bars. */
export function newNoteRangeRepairs(check: OptionCheck, review?: NoteRepairReviewIdentity): NoteRangeRepair[] | null {
  if (check.overBars || check.unreadable || check.pastBarEnd || !check.outOfRange.length) return null;
  const bars = [...new Set(check.outOfRange.map(note => note.bar))];
  if (bars.length > (reviewedNoteRepair(review, check) ? 4 : 2)) return null;
  const repairs: NoteRangeRepair[] = [];
  for (const bar of bars) {
    const parts = [...new Set(check.outOfRange.filter(note => note.bar === bar).map(note => note.part))];
    if (parts.some(part => !rangeOf(part))) return null;
    const bounds = parts.map(part => { const range = rangeOf(part)!; return `${part} ${noteName(range[1])}..${noteName(range[2])}`; }).join('; ');
    const ask = `Technical register repair only, bar ${bar}. Whole-octave moves only for ${bounds} (sounding). Keep every pitch class, exact onset/duration, note count, dyn/role/art. Keep all other part+bar entries identical. Return the complete bar. No new music.`;
    if (ask.length > 400) return null;
    repairs.push({ bar, parts, ask });
  }
  return repairs;
}

/** Strict raw timing/held-token bags prevent notation rounding from hiding a musical edit. */
export function assertNewNoteRangeRepair(before: WriteAnswer['adds'], after: WriteAnswer['adds'], repair: NoteRangeRepair): void {
  const allowed = new Set(repair.parts.map(part => keyOf(part, repair.bar)));
  const unrelated = (adds: WriteAnswer['adds']) => {
    const groups = new Map<string, string[]>();
    for (const add of adds.filter(add => !allowed.has(keyOf(add.part, add.bar)))) {
      const key = keyOf(add.part, add.bar), entries = groups.get(key) ?? [];
      entries.push(stable(add)); groups.set(key, entries);
    }
    // askFix moves the repaired bar to the end. Keep within-key order and all data.
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  };
  requireThat(same(unrelated(before), unrelated(after)), 'Range repair changed unrelated entries');
  const bag = (adds: WriteAnswer['adds'], final: boolean) => {
    const notes: string[] = [], entries = new Map<string, number>();
    for (const add of adds.filter(add => allowed.has(keyOf(add.part, add.bar)))) {
      requireThat(parseEvents(add.events).unreadable === 0, 'Range repair has unreadable events');
      const key = keyOf(add.part, add.bar), entry = entries.get(key) ?? 0;
      entries.set(key, entry + 1);
      // Keep grouping and expression order too, including empty expression entries.
      notes.push(JSON.stringify([add.part, add.bar, entry, 'entry', add.dyn ?? null, add.role ?? null, artKey(add.art)]));
      for (const token of add.events.trim().split(/\s+/).filter(Boolean)) {
        const match = /^([^@]+)@([0-9.]+)\+([0-9.]+)$/.exec(token)!;
        for (const name of match[1]!.split(',')) {
          const held = name.endsWith('~'), pitch = held ? name.slice(0, -1) : name, height = noteHeight(pitch);
          requireThat(height !== null, 'Range repair has an invalid pitch');
          const range = rangeOf(add.part)!;
          requireThat(!final || (height >= range[1] && height <= range[2]), 'Range repair remains outside the sounding range');
          notes.push(JSON.stringify([add.part, add.bar, entry, pitch.replace(/-?\d+$/, ''), ((height % 12) + 12) % 12, Number(match[2]), Number(match[3]), held, add.dyn ?? null, add.role ?? null, artKey(add.art)]));
        }
      }
    }
    return sorted(notes);
  };
  requireThat(same(bag(before, false), bag(after, true)), 'Range repair changed note counts, pitch classes, timing or expression');
}
