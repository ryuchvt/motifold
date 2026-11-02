// A file can hold several movements, like a suite. Each one restarts its printed bar numbers, and
// the player practises one movement at a time. These are suggestions: the app also offers the whole
// part, so a wrong guess can always be undone (recheck M3).
import type { Part } from "./types";

export interface Movement {
  /** "Prélude", from the words printed at its start. Null when the file doesn't name it. */
  name: string | null;
  fromMeasure: number;
  toMeasure: number;
}

/** The part's movements, in order. A file with one movement gives one, covering every measure. */
export function movements(part: Part): Movement[] {
  const starts = [0];
  for (let i = 1; i < part.measures.length; i++) {
    const n = parseInt(part.measures[i]!.number, 10);
    const before = parseInt(part.measures[i - 1]!.number, 10);
    // Bar numbers going back to 1, or to 0 for a pickup, after counting past it. A reset alone is
    // also what a cut or renumbered excerpt looks like (recheck M3), so the new start must be marked
    // as one too: a title, a tempo, or a new time or key signature.
    if (n <= 1 && before > 1 && marksAStart(part, i)) starts.push(i);
  }
  return starts.map((from, k) => {
    const to = (starts[k + 1] ?? part.measures.length) - 1;
    return { name: nameOf(part, from, to), fromMeasure: from, toMeasure: to };
  });
}

function marksAStart(part: Part, i: number): boolean {
  const here = part.measures[i]!;
  const before = part.measures[i - 1]!;
  return (
    nameOf(part, i, Math.min(i + 1, part.measures.length - 1)) !== null ||
    here.tempos.length > 0 ||
    JSON.stringify(here.time) !== JSON.stringify(before.time) ||
    JSON.stringify(here.key) !== JSON.stringify(before.key)
  );
}

/** The first printed words in the movement's first two bars that read like a title: capitalised, short. */
function nameOf(part: Part, from: number, to: number): string | null {
  for (let i = from; i <= Math.min(from + 1, to); i++) {
    for (const w of part.measures[i]!.words) {
      if (/^\p{Lu}/u.test(w) && w.length <= 30) return w.replace(/\.$/, "");
    }
  }
  return null;
}
