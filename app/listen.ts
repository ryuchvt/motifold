// A recording of one line into notes, in the browser, with no model of any kind. YIN finds the pitch every 10 ms, and this turns those frames
// into notes: a note lasts while its pitch holds, ends in silence, and starts again where the level jumps on the same pitch, as a repeated key
// or a new breath does. It hears one line at a time, so a sung, hummed or played melody works, and chords don't.
import { midiFile } from "./arrange";
import type { PitchTrack } from "./audio/yin";

export const AUDIO_FILE = /\.(wav|mp3|m4a|aac|flac|aif|aiff|ogg|opus|webm)$/i;
export const isAudioFile = (file: Pick<File, "name" | "type">) => !/\.(mid|midi|xml|musicxml|mxl)$/i.test(file.name) && (AUDIO_FILE.test(file.name) || file.type.startsWith("audio/"));

export interface HeardNote {
  /** Seconds from the start of the recording. */
  start: number;
  length: number;
  /** MIDI note number. */
  pitch: number;
  /** How loud, 0 to 1, against the loudest moment of the recording. */
  level: number;
}

export const LISTEN = {
  /** Frames less periodic than this are noise or breath, not a pitch. */
  maxAperiodicity: 0.3,
  /** Frames quieter than this share of the loudest one are left out. */
  quiet: 0.04,
  /** A note carries on while its frames stay this close, in semitones, to where it's been sitting. */
  holdSemitones: 0.7,
  /** Frames in a row that agree somewhere else and start the next note. */
  changeFrames: 4,
  /** An octave, a twelfth or two octaves away is often the tracker slipping, so it has to last longer to count. */
  octaveFrames: 9,
  /** Unusable frames a note steps over without ending. */
  gapFrames: 4,
  /** Shorter than this isn't a note. */
  minSeconds: 0.07,
  /** On the same pitch, the level rising this many times over its recent low is a new attack... */
  reattack: 1.7,
  /** ...if that low had fallen under this share of the note's peak. */
  reattackDip: 0.7,
  /** A note this much quieter than the one before it, starting while that one dies away, is its ringing and not a new note. */
  tailLevel: 0.5,
  tailSeconds: 0.5,
};

const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const slips = (semitones: number) => [12, 19, 24].some((h) => Math.abs(Math.abs(semitones) - h) < 0.6);

/** The notes in a pitch track. */
export function notesFromPitch(track: PitchTrack, options: Partial<typeof LISTEN> = {}): HeardNote[] {
  const o = { ...LISTEN, ...options };
  const { frames } = track;
  const loudest = frames.reduce((most, f) => Math.max(most, f.rms), 1e-9);
  const pitch = frames.map((f) => (f.hz !== null && f.aperiodicity < o.maxAperiodicity && f.rms > loudest * o.quiet ? toMidi(f.hz) : null));
  const notes: HeardNote[] = [];
  // Each pitch is kept with its frame, because frames bridged over a gap have none.
  type Run = { from: number; to: number; values: number[]; at: number[] };
  const close = (run: Run) => {
    const length = (run.to - run.from + 1) * track.hopSec;
    if (length < o.minSeconds) return;
    // The first part of a note is its slide in.
    const settled = run.values.slice(Math.floor(run.values.length * 0.3));
    let peak = 0;
    for (let i = run.from; i <= run.to; i++) peak = Math.max(peak, frames[i]!.rms);
    notes.push({ start: Math.max(0, frames[run.from]!.timeSec - track.hopSec), length, pitch: Math.round(median(settled)), level: peak / loudest });
  };
  let run = null as Run | null;
  let elsewhere = null as Run | null;
  let gap = 0;
  for (let i = 0; i < frames.length; i++) {
    const m = pitch[i];
    if (m === null || m === undefined) {
      if (run && ++gap > o.gapFrames) {
        close(run);
        run = null;
        elsewhere = null;
      }
      continue;
    }
    gap = 0;
    if (!run) {
      run = { from: i, to: i, values: [m], at: [i] };
      continue;
    }
    const here = median(run.values.slice(-8));
    if (Math.abs(m - here) <= o.holdSemitones) {
      elsewhere = null;
      const attack = reattackAt(i, run);
      if (attack !== null) {
        const split = run.at.findIndex((k) => k >= attack);
        const cut = split < 0 ? run.at.length : split;
        close({ from: run.from, to: attack - 1, values: run.values.slice(0, cut), at: run.at.slice(0, cut) });
        run = { from: attack, to: i, values: [...run.values.slice(cut), m], at: [...run.at.slice(cut), i] };
      } else {
        run.to = i;
        run.values.push(m);
        run.at.push(i);
      }
      continue;
    }
    elsewhere = elsewhere && Math.abs(m - median(elsewhere.values)) <= o.holdSemitones ? { ...elsewhere, to: i, values: [...elsewhere.values, m], at: [...elsewhere.at, i] } : { from: i, to: i, values: [m], at: [i] };
    if (elsewhere.values.length >= (slips(m - here) ? o.octaveFrames : o.changeFrames)) {
      close(run);
      run = elsewhere;
      elsewhere = null;
    }
  }
  if (run) close(run);
  return notes.filter((n, k) => {
    const before = notes[k - 1];
    return !before || n.level >= before.level * o.tailLevel || n.start - (before.start + before.length) > o.tailSeconds;
  });

  /** Where a new attack on the same pitch starts, if the level has just jumped from a dip. */
  function reattackAt(i: number, current: { from: number }): number | null {
    if (i - current.from < 8) return null;
    let peak = 0;
    for (let k = current.from; k < i - 1; k++) peak = Math.max(peak, frames[k]!.rms);
    let low = i - 1;
    for (let k = Math.max(current.from + 4, i - 6); k < i; k++) if (frames[k]!.rms < frames[low]!.rms) low = k;
    const dip = frames[low]!.rms;
    return frames[i]!.rms > dip * o.reattack && dip < peak * o.reattackDip ? low + 1 : null;
  }
}

/** As a MIDI file in real time, which has no bars that mean anything, so it goes on to find them just as a file played without a click does. */
export function notesAsMidi(notes: HeardNote[]): Uint8Array {
  const beatsPerSecond = 2;
  const first = notes.length ? notes[0]!.start : 0;
  return midiFile(
    [{ name: "Recording", program: 0, notes: notes.map((n) => ({ start: (n.start - first) * beatsPerSecond, length: n.length * beatsPerSecond, height: n.pitch, velocity: Math.max(1, Math.min(127, Math.round(20 + n.level * 107))) })) }],
    120,
    { beats: 4, beatType: 4 },
  );
}

export interface Heard {
  midi: Uint8Array;
  notes: number;
  seconds: number;
}

/** Hears a recording off the page's thread. Stopping it ends the work at once. */
export async function listenTo(file: File, signal: AbortSignal): Promise<Heard> {
  const decoded = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
  const samples = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i]! += channel[i]! / decoded.numberOfChannels;
  }
  signal.throwIfAborted();
  const notes = await new Promise<HeardNote[]>((resolve, reject) => {
    const worker = new Worker(new URL("./listen.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: true; notes: HeardNote[] } | { ok: false; error: string }>) => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      if (event.data.ok) resolve(event.data.notes);
      else reject(new Error(event.data.error));
    };
    worker.postMessage({ samples, sampleRate: decoded.sampleRate }, [samples.buffer]);
  });
  return { midi: notesAsMidi(notes), notes: notes.length, seconds: decoded.duration };
}
