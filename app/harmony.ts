// Checks a chord Muse Spark names against the notes written there. It can't say the harmony is the right reading, only
// whether the notes bear it out, so a chord the bar doesn't contain shows as doubtful and not as fact.

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};
const CHORD = /^([A-G])(#|b)?(maj7|m7b5|dim7|sus4|dim|aug|m7|m6|m|7|6)?(?:\/([A-G])(#|b)?)?$/;

const alteration = (accidental?: string) => (accidental ?? "").length * (accidental?.startsWith("#") ? 1 : -1);
const pitchClass = (letter: string, accidental?: string) => (LETTERS[letter]! + alteration(accidental) + 12) % 12;

/** The pitch classes of a chord symbol like "D7", "F#dim7" or "C/G", or null if it isn't one. */
export function chordTones(chord: string): number[] | null {
  const m = CHORD.exec(chord.trim());
  if (!m) return null;
  const root = pitchClass(m[1]!, m[2]);
  const tones = QUALITIES[m[3] ?? ""]!.map((i) => (root + i) % 12);
  if (m[4]) {
    const bass = pitchClass(m[4], m[5]);
    if (!tones.includes(bass)) tones.push(bass);
  }
  return tones;
}

/** How high a note name like "F#3" or "Bb2" sounds, in semitones, or null. */
export function noteHeight(name: string): number | null {
  const m = /^([A-G])(##|bb|#|b)?(-?\d)$/.exec(name);
  return m ? 12 * (Number(m[3]) + 1) + LETTERS[m[1]!]! + alteration(m[2]) : null;
}

/** The pitch class of a note name like "F#3" or "Bb2", or null. */
export function notePitchClass(name: string): number | null {
  const m = /^([A-G])(##|bb|#|b)?-?\d$/.exec(name);
  return m ? pitchClass(m[1]!, m[2]) : null;
}

/**
 * A limited check of a chord against the notes of its bars: its root and most of its tones are there, and most of the notes
 * belong to it. Passing notes are allowed for, because a broken chord in Bach has plenty. It ignores duration, voicing, the
 * bass, the numeral and the key, so failing doesn't make a chord wrong. Null when there's nothing to check it against.
 */
export function chordFits(chord: string, notes: string[]): boolean | null {
  const tones = chordTones(chord);
  const heard = notes.flatMap((n) => {
    const pc = notePitchClass(n);
    return pc === null ? [] : [pc];
  });
  if (!tones || heard.length === 0) return null;
  const present = new Set(heard);
  const found = tones.filter((t) => present.has(t)).length;
  const inside = heard.filter((p) => tones.includes(p)).length;
  return present.has(tones[0]!) && found * 2 > tones.length && inside * 2 >= heard.length;
}

export type HarmonicRole = "tonic" | "predominant" | "dominant" | "other";

/** What a Roman numeral does, for colouring the map. V and vii lean home, IV and ii lean to V, I and vi are home. */
export function harmonicRole(numeral: string): HarmonicRole {
  // "V7 of D" is a dominant, whatever follows the "of".
  const head = numeral.trim().replace(/^[♭♯#b]+/, "").split(/[\s/]/)[0] ?? "";
  const roman = /^(vii|VII|iii|III|ii|II|iv|IV|vi|VI|v|V|i|I)/.exec(head)?.[1]?.toLowerCase();
  if (roman === "v" || roman === "vii") return "dominant";
  if (roman === "ii" || roman === "iv") return "predominant";
  if (roman === "i" || roman === "vi") return "tonic";
  return "other";
}
