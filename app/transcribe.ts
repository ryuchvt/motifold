// A recording into notes, in the browser, with Spotify's Basic Pitch (Apache-2.0). Nothing is uploaded and no Meta model is involved. It works best on a piano or one
// instrument at a time. The settings were chosen against one piece, my own theme, where it found 91% of the notes of the piano version and 96% of the melody.
import { midiFile } from "./arrange";

export const AUDIO_FILE = /\.(wav|mp3|m4a|aac|flac|aif|aiff|ogg|opus)$/i;
export const isAudioFile = (file: Pick<File, "name" | "type">) => AUDIO_FILE.test(file.name) || file.type.startsWith("audio/");

export interface HeardNote {
  start: number;
  length: number;
  pitch: number;
  /** How loud, 0 to 1. */
  amp: number;
}

/** A quiet note an octave, a twelfth or two octaves over a louder one sounding when it starts is usually that note's overtone, which a piano is full of. */
export function dropOvertones(notes: HeardNote[], keep = 0.7): HeardNote[] {
  return notes.filter((n) => !notes.some((o) => o !== n && [12, 19, 24, 28, 31].includes(n.pitch - o.pitch) && o.start <= n.start + 0.06 && o.start + o.length > n.start && n.amp < o.amp * keep));
}

/** As a MIDI file in real time, which has no bars that mean anything, so it goes on to find them just as a file played without a click does. */
export function notesAsMidi(notes: HeardNote[]): Uint8Array {
  const beatsPerSecond = 2;
  const first = notes.length ? Math.min(...notes.map((n) => n.start)) : 0;
  return midiFile(
    [{ name: "Recording", program: 0, notes: notes.map((n) => ({ start: (n.start - first) * beatsPerSecond, length: Math.max(n.length, 0.03) * beatsPerSecond, height: n.pitch, velocity: Math.max(1, Math.min(127, Math.round(20 + n.amp * 107))) })) }],
    120,
    { beats: 4, beatType: 4 },
  );
}

let listening: Promise<unknown> = Promise.resolve();

/** Hears a file, saying how far along it is from 0 to 1. One at a time, because what a listen holds in memory is let go of all together when it ends. A progress callback that throws stops it. */
export function transcribeFile(file: File, onProgress: (fraction: number) => void): Promise<{ midi: Uint8Array; notes: number; seconds: number }> {
  const heard = listening.then(() => hear(file, onProgress));
  listening = heard.catch(() => {});
  return heard;
}

/** A model of under a megabyte, so the only wait is the listening. */
async function hear(file: File, onProgress: (fraction: number) => void): Promise<{ midi: Uint8Array; notes: number; seconds: number }> {
  const RATE = 22050;
  const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await file.arrayBuffer());
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const channel = audio.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i]! += channel[i]! / audio.numberOfChannels;
  }
  const [tf, { BasicPitch, noteFramesToTime, outputToNotesPoly }] = await Promise.all([import("@tensorflow/tfjs"), import("@spotify/basic-pitch")]);
  await tf.ready();
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const model = await tf.loadGraphModel("/transcribe/model.json");
  // Basic Pitch leaves its tensors for the caller, so everything it makes goes when this scope ends, whichever way the listen ends.
  tf.engine().startScope();
  try {
    await new BasicPitch(Promise.resolve(model)).evaluateModel(
      mono,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      onProgress,
    );
  } finally {
    tf.engine().endScope();
    model.dispose();
  }
  const heard = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.65, 0.4, 11, true, null, null, false)).map((n) => ({ start: n.startTimeSeconds, length: n.durationSeconds, pitch: n.pitchMidi, amp: n.amplitude }));
  const notes = dropOvertones(heard).sort((a, b) => a.start - b.start);
  return { midi: notesAsMidi(notes), notes: notes.length, seconds: audio.duration };
}
