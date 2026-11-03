// The printed score, as parsed from MusicXML. Times are integer ticks:
// `Score.ticksPerQuarter` ticks to a quarter note, the same for every part.

/** A printed note: its part, its 0-based <measure> index and its <note> index within that measure. */
export interface NoteRef {
  partId: string;
  measureIndex: number;
  noteIndex: number;
}

export type Step = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface Pitch {
  step: Step;
  alter: number;
  octave: number;
  /** Written pitch as MIDI. Fractional when the alter is microtonal. */
  midi: number;
}

export type Bowing = "up" | "down";

export interface PrintedNote {
  ref: NoteRef;
  rest: boolean;
  /** Null for rests and unpitched notes. */
  pitch: Pitch | null;
  /** Pitch as it sounds, after the part's transposition. */
  soundingMidi: number | null;
  /** How hard it's played, 1 to 127, when the file says so per note (MusicXML `dynamics`). */
  velocity?: number;
  unpitched: boolean;
  /** Shares its onset with the note before it (<chord/>). */
  chord: boolean;
  grace: boolean;
  cue: boolean;
  /** Hidden from print (print-object="no"), as editors write filler rests. */
  hidden: boolean;
  staff: number;
  voice: string;
  /** Ticks from the start of the measure, in written order. */
  onset: number;
  /** Ticks. Zero for grace notes. */
  duration: number;
  type: string | null;
  dots: number;
  tieStart: boolean;
  tieStop: boolean;
  /**
   * The repeat passes a sound tie applies to (MusicXML `time-only`), by kind. Null: every pass.
   * "1" on a start means the note is held into the next only the first time through.
   */
  tieStartPasses: number[] | null;
  tieStopPasses: number[] | null;
  /** Slur numbers started and stopped on this note. */
  slurStarts: number[];
  slurStops: number[];
  articulations: string[];
  ornaments: string[];
  technical: string[];
  fingerings: string[];
  string: number | null;
  bowing: Bowing | null;
}

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export interface KeySignature {
  fifths: number;
  mode: string | null;
}

export interface Clef {
  staff: number;
  sign: string;
  line: number | null;
  octaveChange: number;
}

export interface Ending {
  numbers: number[];
  type: "start" | "stop" | "discontinue";
}

export type JumpKind = "dacapo" | "dalsegno" | "fine" | "tocoda" | "coda" | "segno";

export interface TempoMark {
  /** Ticks from the start of the measure. */
  onset: number;
  /** Quarter notes per minute. */
  qpm: number;
}

/** Printed dynamics and hairpins, kept separately from playback level points. */
export interface DynamicMark {
  onset: number;
  kind: "dynamics" | "wedge";
  value: string;
  text?: string;
  number?: string;
  staff?: number;
}

export interface Measure {
  index: number;
  /** The printed number attribute, which can repeat, skip or be text. */
  number: string;
  /** A pickup or other measure printed without its full length. */
  implicit: boolean;
  /** Ticks from the start of the part, in written order. */
  start: number;
  /** Ticks the measure actually spans. */
  length: number;
  /** Ticks the time signature asks for, or null with no time signature. */
  nominalLength: number | null;
  time: TimeSignature | null;
  key: KeySignature;
  clefs: Clef[];
  staves: number;
  repeatForward: boolean;
  /** Times the section is played when this measure ends a repeat. */
  repeatBackward: number | null;
  endings: Ending[];
  jumps: JumpKind[];
  tempos: TempoMark[];
  /** Playback levels the measure's directions set (MusicXML `sound dynamics`), as velocities. Only there if it has some. */
  levels?: { onset: number; velocity: number }[];
  /** Only marks the source actually printed. Level changes alone imply no hairpin. */
  dynamicMarks?: DynamicMark[];
  /** Printed words in the measure's directions, in order: "Prélude.", "cresc.", "Molto adagio". */
  words: string[];
  /** An octave-shift (8va and the like) is in force somewhere in the measure. */
  octaveShift: boolean;
  /** Indexes into `Part.notes`. */
  noteIndexes: number[];
}

export interface Transposition {
  chromatic: number;
  octaveChange: number;
  /** The interval's letter steps, when the file says. */
  diatonic?: number;
}

export interface Part {
  id: string;
  name: string;
  abbreviation: string | null;
  instrument: string | null;
  staves: number;
  transposition: Transposition | null;
  measures: Measure[];
  /** Every printed note, in document order. */
  notes: PrintedNote[];
}

export interface Score {
  format: "partwise" | "timewise";
  title: string | null;
  workTitle: string | null;
  movementTitle: string | null;
  composer: string | null;
  arranger?: string | null;
  /** The file's own rights lines, which travel with anything made from it. */
  rights?: string[];
  ticksPerQuarter: number;
  parts: Part[];
}
