import { parseEvents, rangeOf, type OptionCheck } from '../app/arrange';
import { noteHeight, noteName } from '../app/notes';
import type { WriteAnswer } from '../server/shapes';

export interface NoteRangeRepair { bar: string; parts: string[]; ask: string }
const keyOf = (part: string, bar: string) => JSON.stringify([part, bar]);
const sorted = (items: string[]) => items.sort();
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
// The exporter gives omitted and exactly empty articulation the same meaning. Keep raw replies intact.
const artKey = (art: string | undefined) => art === '' ? null : art ?? null;
function requireThat(ok: unknown, why: string): asserts ok { if (!ok) throw Error(why); }

/** At most two complete bars, with no other hard failure. No correction is invented here. */
export function newNoteRangeRepairs(check: OptionCheck): NoteRangeRepair[] | null {
  if (check.overBars || check.unreadable || check.pastBarEnd || !check.outOfRange.length) return null;
  const bars = [...new Set(check.outOfRange.map(note => note.bar))];
  if (bars.length > 2) return null;
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
