// Facts about instruments: what a DAW's short names mean, the ensembles a composer reaches for, and the order a score is laid out in.

/** A working name that says what it is, which needs no judgement. Inst 1 or Kontakt says nothing, so those go to Muse Spark. */
const SHORT_NAMES: [RegExp, string][] = [
  [/\b(strng|strngs|string|strings|str|strs)\b/i, "Strings"],
  [/\b(brs|brass)\b/i, "Brass"],
  [/\b(ww|woodwinds?|winds?)\b/i, "Woodwinds"],
  [/\b(vln|vn|vl|violins?)\s*(1|i)\b/i, "Violin I"],
  [/\b(vln|vn|vl|violins?)\s*(2|ii)\b/i, "Violin II"],
  [/\b(vln|vn|vl|violins?)\b/i, "Violin"],
  [/\b(vla|va|violas?)\b/i, "Viola"],
  [/\b(vc|vcl|vlc|cello|cellos|violoncello)\b/i, "Cello"],
  [/\b(cb|db|kb|contrabass|double\s*bass)\b/i, "Double Bass"],
  [/\b(picc|piccolo)\b/i, "Piccolo"],
  [/\b(fl|flt|flutes?)\b/i, "Flute"],
  [/\b(ob|oboes?)\b/i, "Oboe"],
  [/\b(ca|cor\s*anglais|english\s*horn)\b/i, "English Horn"],
  [/\b(bcl|bass\s*clarinet)\b/i, "Bass Clarinet"],
  [/\b(cl|clar|clarinets?)\b/i, "Clarinet"],
  [/\b(bsn|fg|bassoons?)\b/i, "Bassoon"],
  [/\b(hn|hrn|fr\s*hn|horns?)\b/i, "Horn"],
  [/\b(tpt|trp|tr|trumpets?)\b/i, "Trumpet"],
  [/\b(btbn|bass\s*trombone)\b/i, "Bass Trombone"],
  [/\b(tbn|trb|trombones?)\b/i, "Trombone"],
  [/\b(tba|tuba)\b/i, "Tuba"],
  [/\b(timp|timps|timpani)\b/i, "Timpani"],
  [/\b(drums?|kit)\b/i, "Drums"],
  [/\b(perc|percussion)\b/i, "Percussion"],
  [/\b(hp|harp)\b/i, "Harp"],
  [/\b(cel|celesta)\b/i, "Celesta"],
  [/\b(pno|pf|piano)\b/i, "Piano"],
  [/\b(gtr|guitar)\b/i, "Guitar"],
  [/\b(vox|voc|voice|choir)\b/i, "Voice"],
  [/\bpad\b/i, "Pad"],
  [/\bbass\b/i, "Bass"],
];

export function instrumentFromName(name: string): string | null {
  return SHORT_NAMES.find(([word]) => word.test(name))?.[1] ?? null;
}

/** Top to bottom of a score, so whatever's chosen comes out laid out the way a player and a conductor expect. */
const SCORE_ORDER: RegExp[] = [/piccolo/i, /flute/i, /oboe/i, /english horn|cor anglais/i, /bass clarinet/i, /clarinet/i, /contrabassoon/i, /bassoon/i, /horn/i, /trumpet/i, /(?<!bass )trombone/i, /bass trombone/i, /tuba/i, /timpani/i, /glockenspiel|xylophone|vibraphone|marimba|tubular bells/i, /snare/i, /bass drum/i, /cymbal/i, /tam-?tam|gong/i, /triangle/i, /percussion/i, /harp/i, /celesta/i, /piano/i, /guitar/i, /voice|choir|soprano|alto|tenor|baritone/i, /violin\s*(i|1)\b/i, /violin\s*(ii|2)\b/i, /violin/i, /viola/i, /cello/i, /double bass|contrabass/i];

const rankOf = (name: string) => {
  const rank = SCORE_ORDER.findIndex((word) => word.test(name));
  return rank < 0 ? SCORE_ORDER.length : rank;
};

/** A whole template keeps its own order, because a wind quintet puts its horn above the bassoon. */
export function inScoreOrder(names: string[]): string[] {
  const asIs = TEMPLATES.find((t) => t.instruments.length === names.length && t.instruments.every((i) => names.includes(i)));
  return asIs ? asIs.instruments : names.map((name, k) => ({ name, k })).sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.k - b.k).map(({ name }) => name);
}

const STRINGS = ["Violin I", "Violin II", "Viola", "Cello", "Double Bass"];

export const TEMPLATES: { name: string; instruments: string[] }[] = [
  { name: "String orchestra", instruments: STRINGS },
  { name: "String quartet", instruments: STRINGS.slice(0, 4) },
  { name: "Chamber orchestra", instruments: ["Flute", "Oboe", "Clarinet", "Bassoon", "Horn 1", "Horn 2", ...STRINGS] },
  // 32 staves, which is the most a whole score can be read at.
  { name: "Full orchestra", instruments: ["Piccolo", "Flute 1", "Flute 2", "Oboe 1", "Oboe 2", "Clarinet 1", "Clarinet 2", "Bassoon 1", "Bassoon 2", "Horn 1", "Horn 2", "Horn 3", "Horn 4", "Trumpet 1", "Trumpet 2", "Trumpet 3", "Trombone 1", "Trombone 2", "Bass Trombone", "Tuba", "Timpani", "Glockenspiel", "Snare Drum", "Bass Drum", "Cymbals", "Harp", ...STRINGS] },
  { name: "Woodwind quintet", instruments: ["Flute", "Oboe", "Clarinet", "Horn", "Bassoon"] },
  { name: "Brass quintet", instruments: ["Trumpet 1", "Trumpet 2", "Horn", "Trombone", "Tuba"] },
];

/** The boxes to tick when picking by hand. */
export const PICKABLE = ["Piccolo", "Flute", "Oboe", "English Horn", "Clarinet", "Bass Clarinet", "Bassoon", "Horn", "Trumpet", "Trombone", "Bass Trombone", "Tuba", "Timpani", "Glockenspiel", "Xylophone", "Marimba", "Tubular Bells", "Snare Drum", "Bass Drum", "Cymbals", "Tam-tam", "Triangle", "Harp", "Celesta", "Piano", ...STRINGS];

/** What a track can be called without typing. This version is for orchestral writing, and anything else is Other. */
export const TRACK_CHOICES: { group: string; names: string[] }[] = [
  { group: "Strings", names: ["Strings", "Violin", "Violin I", "Violin II", "Viola", "Cello", "Double Bass"] },
  { group: "Woodwinds", names: ["Woodwinds", "Piccolo", "Flute", "Oboe", "English Horn", "Clarinet", "Bass Clarinet", "Bassoon"] },
  { group: "Brass", names: ["Brass", "Horn", "Trumpet", "Trombone", "Bass Trombone", "Tuba"] },
  { group: "Percussion", names: ["Percussion", "Timpani", "Drums"] },
  { group: "Keyboard and harp", names: ["Piano", "Harp", "Celesta"] },
  { group: "Voices", names: ["Voice", "Choir"] },
];

/** Instruments that play one note at a time, so two at once on one staff needs saying. */
export const ONE_NOTE_AT_A_TIME = /piccolo|flute|oboe|english horn|cor anglais|clarinet|bassoon|horn|trumpet|trombone|tuba/i;
