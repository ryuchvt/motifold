// Reading a standard MIDI file, for a composer who works in a DAW: its notes as a score, and its markers as moments to hit. Quantising is a
// fact about the grid, and a part is whatever the file says is a track.
import { scoreXml, snap, type BarHead, type PlacedPart } from "./arrange";
import { instrumentFromName } from "./orchestra";
import { ScoreFileError } from "../score";

export interface MidiNote {
  tick: number;
  length: number;
  height: number;
  velocity?: number;
}

export interface MidiRead {
  ppq: number;
  tracks: { name: string; program: number | null; notes: MidiNote[] }[];
  tempos: { tick: number; qpm: number }[];
  times: { tick: number; beats: number; beatType: number }[];
  fifths: number;
  markers: { tick: number; text: string }[];
  /** The sustain pedal's moves, with how far down each was. */
  pedal: { tick: number; value: number }[];
  /** Where the file's own first event is. A DAW can start far from zero, like at its one hour mark. */
  firstTick: number;
  /** Notes on channel 10, which are drums and have no pitch to write. */
  drums: number;
}

export const isMidi = (bytes: Uint8Array) => bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;

const fail = (why: string) => new ScoreFileError(`This MIDI file can't be read: ${why}.`);

export function readMidi(bytes: Uint8Array): MidiRead {
  if (!isMidi(bytes)) throw fail("it isn't a MIDI file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(10);
  const ppq = view.getUint16(12);
  if (ppq & 0x8000 || ppq === 0) throw fail("it's timed in SMPTE frames, not beats");
  const out: MidiRead = { ppq, tracks: [], tempos: [], times: [], fifths: 0, markers: [], pedal: [], firstTick: Infinity, drums: 0 };
  let at = 8 + view.getUint32(4);
  const text = (from: number, length: number) => String.fromCharCode(...bytes.slice(from, from + length)).replace(/[\u0000-\u001f]/g, " ").trim();
  for (let t = 0; t < count && at + 8 <= bytes.length; t++) {
    const isTrack = bytes[at] === 0x4d && bytes[at + 1] === 0x54 && bytes[at + 2] === 0x72 && bytes[at + 3] === 0x6b;
    const length = view.getUint32(at + 4);
    const end = Math.min(at + 8 + length, bytes.length);
    if (!isTrack) {
      at = end;
      continue;
    }
    let i = at + 8;
    const vlq = () => {
      let v = 0;
      let b: number;
      do {
        b = bytes[i++]!;
        v = (v << 7) | (b & 127);
      } while (b & 128 && i < end);
      return v;
    };
    let tick = 0;
    let running = 0;
    let name = "";
    let started = false;
    // A single track can hold several channels, as in a format 0 file, and each is its own part.
    const channels = new Map<number, { program: number | null; notes: MidiNote[]; open: Map<number, number[]>; velocities: Map<string, number> }>();
    const channel = (c: number) => {
      const found = channels.get(c);
      if (found) return found;
      const made = { program: null, notes: [], open: new Map<number, number[]>(), velocities: new Map<string, number>() };
      channels.set(c, made);
      return made;
    };
    while (i < end) {
      tick += vlq();
      if (!started) {
        started = true;
        out.firstTick = Math.min(out.firstTick, tick);
      }
      let status = bytes[i]!;
      if (status < 0x80) status = running;
      else i++;
      if (status === 0xff) {
        const type = bytes[i++]!;
        const size = vlq();
        if (type === 0x03 && !name) name = text(i, size);
        if (type === 0x51 && size === 3) out.tempos.push({ tick, qpm: 60_000_000 / ((bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!) });
        if (type === 0x58 && size >= 2) out.times.push({ tick, beats: bytes[i]!, beatType: 2 ** bytes[i + 1]! });
        if (type === 0x59 && size >= 1 && tick === 0) out.fifths = view.getInt8(i);
        if (type === 0x06 || type === 0x07) out.markers.push({ tick, text: text(i, size) });
        i += size;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        i += vlq();
        continue;
      }
      running = status;
      const kind = status >> 4;
      const c = status & 15;
      if (kind === 8 || kind === 9) {
        const [height, velocity] = [bytes[i]!, bytes[i + 1]!];
        i += 2;
        if (c === 9) {
          if (kind === 9 && velocity > 0) out.drums++;
          continue;
        }
        const ch = channel(c);
        const held = ch.open.get(height) ?? [];
        if (kind === 9 && velocity > 0) {
          ch.open.set(height, [...held, tick]);
          ch.velocities.set(`${height}|${tick}`, velocity);
        } else if (held.length) {
          ch.notes.push({ tick: held[0]!, length: tick - held[0]!, height, velocity: ch.velocities.get(`${height}|${held[0]!}`) });
          ch.open.set(height, held.slice(1));
        }
      } else if (kind === 11) {
        if (bytes[i] === 64) out.pedal.push({ tick, value: bytes[i + 1]! });
        i += 2;
      } else if (kind === 12) {
        channel(c).program = bytes[i]!;
        i++;
      } else if (kind === 13) i++;
      else i += 2;
    }
    for (const [c, ch] of channels) {
      if (!ch.notes.length) continue;
      ch.notes.sort((a, b) => a.tick - b.tick || b.height - a.height);
      out.tracks.push({ name: name || `Track ${out.tracks.length + 1}${channels.size > 1 ? ` channel ${c + 1}` : ""}`, program: ch.program, notes: ch.notes });
    }
    at = end;
  }
  out.tempos.sort((a, b) => a.tick - b.tick);
  out.times.sort((a, b) => a.tick - b.tick);
  out.markers.sort((a, b) => a.tick - b.tick);
  out.pedal.sort((a, b) => a.tick - b.tick);
  if (!Number.isFinite(out.firstTick)) out.firstTick = 0;
  return out;
}

/** A DAW's markers as moments, in crotchets from the start, so they stay on their beat whatever the tempo. */
export function markersOf(bytes: Uint8Array): { beats: number; what: string }[] {
  const midi = readMidi(bytes);
  return midi.markers.map((m) => ({ beats: m.tick / midi.ppq, what: m.text }));
}

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const spelled = (height: number, fifths: number) => `${(fifths < 0 ? FLAT : SHARP)[height % 12]}${Math.floor(height / 12) - 1}`;

/** General MIDI's families, for a track with no useful name. */
const FAMILIES: [number, string][] = [[8, "Piano"], [16, "Celesta"], [24, "Organ"], [32, "Guitar"], [40, "Bass"], [41, "Violin"], [42, "Viola"], [43, "Cello"], [44, "Double Bass"], [46, "Strings"], [47, "Harp"], [48, "Timpani"], [56, "Strings"], [57, "Trumpet"], [58, "Trombone"], [59, "Tuba"], [61, "Trumpet"], [62, "Horn"], [64, "Brass"], [69, "Oboe"], [70, "English Horn"], [71, "Bassoon"], [72, "Clarinet"], [73, "Piccolo"], [74, "Flute"]];

function nameOf(track: MidiRead["tracks"][number], used: Map<string, number>): string {
  const family = track.program === null ? null : (FAMILIES.find(([below]) => track.program! < below)?.[1] ?? null);
  const base = /^Track \d+/.test(track.name) && !instrumentFromName(track.name) && family ? family : track.name;
  const k = (used.get(base) ?? 0) + 1;
  used.set(base, k);
  return k > 1 ? `${base} ${k}` : base;
}

function midiBars(midi: MidiRead) {
  if (!midi.tracks.length) throw fail("it has no notes, apart from any drums");
  const beatsOf = (tick: number) => tick / midi.ppq;
  const lastBeat = Math.max(...midi.tracks.flatMap((t) => t.notes.map((n) => snap(beatsOf(n.tick + n.length)))));
  const times = midi.times.length && midi.times[0]!.tick === 0 ? midi.times : [{ tick: 0, beats: 4, beatType: 4 }, ...midi.times];
  const bars: { start: number; length: number; time: { beats: number; beatType: number } }[] = [];
  for (let start = 0, t = 0; start < lastBeat - 1e-6 || bars.length === 0; ) {
    while (t + 1 < times.length && beatsOf(times[t + 1]!.tick) <= start + 1e-6) t++;
    const time = { beats: times[t]!.beats, beatType: times[t]!.beatType };
    const length = (time.beats * 4) / time.beatType;
    if (!Number.isFinite(length) || length <= 0) throw fail("its time signature has no usable bar length");
    bars.push({ start, length, time });
    start += length;
  }
  return bars;
}

function firstSoundingBar(midi: MidiRead, bars: ReturnType<typeof midiBars>): number {
  const first = Math.min(...midi.tracks.flatMap(track => track.notes.map(note => note.tick / midi.ppq)));
  return Math.max(0, bars.findIndex(bar => first < bar.start + bar.length - 1e-6));
}

/** Whole empty bars before the music, measured on the file's changing metre grid. No source event is moved. */
export function midiLeadIn(bytes: Uint8Array): { emptyBars: number; totalBars: number } {
  const midi = readMidi(bytes), bars = midiBars(midi);
  return { emptyBars: firstSoundingBar(midi, bars), totalBars: bars.length };
}

/** The file as a score. Leaving out leading empty bars is an explicit import choice, never an edit to the MIDI. */
export function midiScoreXml(bytes: Uint8Array, title: string, options: { skipEmptyBars?: boolean } = {}): string {
  const midi = readMidi(bytes), allBars = midiBars(midi);
  const skipped = options.skipEmptyBars ? firstSoundingBar(midi, allBars) : 0;
  const bars = allBars.slice(skipped);
  const beatsOf = (tick: number) => tick / midi.ppq;
  const used = new Map<string, number>();
  const parts: PlacedPart[] = midi.tracks.map((track) => {
    const part: PlacedPart = { name: nameOf(track, used), bars: bars.map(() => []) };
    for (const n of track.notes) {
      const from = snap(beatsOf(n.tick));
      const until = Math.max(snap(beatsOf(n.tick + n.length)), from + 0.25);
      const name = spelled(n.height, midi.fifths);
      bars.forEach((bar, k) => {
        const start = Math.max(from, bar.start);
        const end = Math.min(until, bar.start + bar.length);
        if (end <= start + 1e-6) return;
        part.bars[k]!.push({ start: start - bar.start, length: end - start, names: [name], tieStop: from < bar.start - 1e-6, tieStart: until > bar.start + bar.length + 1e-6, ...(n.velocity !== undefined ? { velocity: n.velocity } : {}) });
      });
    }
    return part;
  });
  const heads: BarHead[] = bars.map((bar, k) => {
    const inBar = midi.tempos.filter((t) => beatsOf(t.tick) >= bar.start - 1e-6 && beatsOf(t.tick) < bar.start + bar.length - 1e-6);
    const rounded = (qpm: number) => Math.round(qpm * 100) / 100;
    const atBarline = [...inBar].reverse().find((t) => beatsOf(t.tick) <= bar.start + 1e-6);
    // A file plays at 120 until its first tempo, by the MIDI standard.
    const carried = k === 0 && skipped > 0 ? [...midi.tempos].reverse().find(t => beatsOf(t.tick) <= bar.start + 1e-6) : null;
    const qpm = atBarline ? rounded(atBarline.qpm) : k === 0 && skipped > 0 ? rounded(carried?.qpm ?? 120) : k === 0 && inBar.length ? 120 : null;
    const moreTempos = inBar.filter((t) => beatsOf(t.tick) > bar.start + 1e-6).map((t) => ({ beat: beatsOf(t.tick) - bar.start, qpm: rounded(t.qpm) }));
    return { number: String(k + 1), implicit: false, length: bar.length, time: bar.time, fifths: midi.fifths, repeatForward: false, repeatBackward: null, endings: [], words: [], qpm, ...(moreTempos.length ? { moreTempos } : {}) };
  });
  return scoreXml({ title: null, movementTitle: title, composer: null }, heads, parts);
}
