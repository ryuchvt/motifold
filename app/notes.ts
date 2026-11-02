// Note names and heights, in one place.
const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER: Record<string, number> = { "##": 2, "#": 1, b: -1, bb: -2 };

/** A note name like F#3 or Bb2 as a MIDI number, where C4 is 60. Null if it isn't one. */
export function noteHeight(name: string): number | null {
  const m = /^([A-G])(##|bb|#|b)?(-?\d)$/.exec(name);
  return m ? 12 * (Number(m[3]) + 1) + LETTERS[m[1]!]! + (m[2] ? ALTER[m[2]]! : 0) : null;
}

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = (midi: number) => `${NAMES[Math.round(midi) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
