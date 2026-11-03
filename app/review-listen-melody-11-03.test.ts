// My own piano melody, recorded, against the MIDI it was played from. The files stay out of the repo, so this runs only where they are.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { yin } from "./audio/yin";
import { notesFromPitch } from "./listen";
import { readMidi } from "./midi";

const folder = "local-inputs/sad-theme/";
const recording = `${folder}LLL_Clasical_music_melody.wav`;
const played = `${folder}LLL_Clasical_music_melody.mid`;

function wav(path: string): { samples: Float32Array; rate: number } {
  const b = readFileSync(path);
  let at = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") [channels, rate, bits] = [b.readUInt16LE(at + 10), b.readUInt32LE(at + 12), b.readUInt16LE(at + 22)];
    if (id === "data") data = b.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  const width = bits / 8;
  const samples = new Float32Array(data!.length / width / channels);
  for (let i = 0; i < samples.length; i++) {
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * width;
      samples[i] = samples[i]! + (bits === 24 ? data!.readIntLE(o, 3) / 8388608 : data!.readInt16LE(o) / 32768) / channels;
    }
  }
  return { samples, rate };
}

/** The MIDI's notes in seconds, from its own tempo map. */
function playedNotes(path: string): { start: number; pitch: number }[] {
  const m = readMidi(new Uint8Array(readFileSync(path)));
  const tempos = m.tempos.length ? m.tempos : [{ tick: 0, qpm: 120 }];
  const seconds = (tick: number) => {
    let s = 0;
    let last = 0;
    let qpm = tempos[0]!.qpm;
    for (const t of tempos) {
      if (t.tick >= tick) break;
      s += ((t.tick - last) / m.ppq / qpm) * 60;
      [last, qpm] = [t.tick, t.qpm];
    }
    return s + ((tick - last) / m.ppq / qpm) * 60;
  };
  return m.tracks.flatMap((t) => t.notes.map((n) => ({ start: seconds(n.tick), pitch: n.height }))).sort((a, b) => a.start - b.start);
}

/** Notes heard at the right pitch within 80 ms, with the two lined up at their first notes and then at the best small shift. */
function matched(heard: { start: number; pitch: number }[], real: { start: number; pitch: number }[]): number {
  const h = heard.map((n) => ({ ...n, start: n.start - heard[0]!.start }));
  const r = real.map((n) => ({ ...n, start: n.start - real[0]!.start }));
  let best = 0;
  for (let shift = -0.5; shift <= 0.5; shift += 0.005) {
    const used = new Set<number>();
    let right = 0;
    for (const n of r) {
      const k = h.findIndex((m, j) => !used.has(j) && m.pitch === n.pitch && Math.abs(m.start + shift - n.start) < 0.08);
      if (k >= 0) {
        used.add(k);
        right++;
      }
    }
    best = Math.max(best, right);
  }
  return best;
}

describe.skipIf(!existsSync(recording) || !existsSync(played))("my recorded piano melody", () => {
  it("hears most of its notes and adds few that weren't played", () => {
    const { samples, rate } = wav(recording);
    const heard = notesFromPitch(yin(samples, rate));
    const real = playedNotes(played);
    const right = matched(heard, real);
    // 11-03: 44 of 52 found, 50 heard. Two G4s sound as a clean G2 in the recording, and four soft notes above C6 are under the level it keeps.
    expect(right / real.length).toBeGreaterThanOrEqual(0.84);
    expect(right / heard.length).toBeGreaterThanOrEqual(0.87);
  }, 120_000);
});
