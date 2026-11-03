import { placedWords, rangeOf, type PlacedCheck } from "./arrange";
import { noteName } from "./notes";

export const placementHasProblems = (check: PlacedCheck) => check.placed !== check.notes || !!(check.notPlaced.length || check.ignored || check.together.length || check.outOfRange.length);
export const canSuggestRangeRepair = (check: PlacedCheck) => check.placed === check.notes && !check.notPlaced.length && !check.ignored && !check.together.length && check.outOfRange.length > 0;
export function placementCheckWords(check: PlacedCheck): string[] {
  return [...placedWords(check), ...(check.ignored ? [`${check.ignored} placement ${check.ignored === 1 ? "entry was" : "entries were"} ignored because a source line, bar range or player could not be matched.`] : [])];
}

/** Technical guidance for composer review, bounded by the existing placement words limit. */
export function placementRangeWords(outOfRange: PlacedCheck["outOfRange"], limit = 400): string | null {
  if (!outOfRange.length || !Number.isFinite(limit)) return null;
  const max = Math.max(0, Math.min(400, Math.floor(limit)));
  const parts = [...new Set(outOfRange.map(note => note.part))];
  if (parts.some(part => !rangeOf(part))) return null;
  const bounds = parts.map(part => { const range = rangeOf(part)!; return `${part} ${noteName(range[1])}..${noteName(range[2])}`; }).join("; ");
  let words = `Register repair only: keep every source note's pitch class, onset, duration and harmony. Whole-octave placement or redistribute existing voices only; no new material or mood. Sounding ranges: ${bounds}.`;
  if (words.length > max) return null;
  const examples = parts.map(part => [...new Set(outOfRange.filter(note => note.part === part).map(note => `${note.part} bar${note.bar}:${note.name}`))]);
  const facts = Array.from({ length: Math.max(...examples.map(items => items.length)) }, (_, index) => examples.flatMap(items => items[index] ? [items[index]!] : [])).flat();
  for (const fact of facts) {
    const more = ` ${fact};`;
    if (words.length + more.length > max) break;
    words += more;
  }
  return words;
}
