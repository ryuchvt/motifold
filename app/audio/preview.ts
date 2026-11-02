// A way to hear the notes, from recordings of real instruments with no model involved, and oscillators for anything there's no recording of. It's a
// sketch of the arrangement, like the playback in any notation program, and it's the composer's own instruments that say how it really sounds.
import { chooseSample, knownManifest, loadBuffers, loadManifest, playSample, seatOf, setOf } from "./samples";

export type Voice = "strings" | "winds" | "brass" | "pluck";

export interface HeardNote {
  start: number;
  length: number;
  height: number;
  voice: Voice;
  /** How loud, where 1 is a line a listener follows. */
  level: number;
  /** What's playing it, which picks the recording. */
  instrument?: string;
  /** How hard it's played, 1 to 127. */
  velocity?: number;
}

export function voiceOf(name: string): Voice {
  if (/piano|harp|celesta|guitar|pizz|pluck|arp|drum|percussion|timpani/i.test(name)) return "pluck";
  if (/trumpet|trombone|tuba|horn|brass/i.test(name) && !/english horn/i.test(name)) return "brass";
  if (/flute|piccolo|oboe|clarinet|bassoon|english horn|cor anglais|wind|voice/i.test(name)) return "winds";
  return "strings";
}

/** Beats to seconds and back, through whatever tempos are marked. */
export function beatClock(tempos: { beat: number; qpm: number }[]) {
  const marks = tempos.length ? [...tempos].sort((a, b) => a.beat - b.beat) : [{ beat: 0, qpm: 120 }];
  if (marks[0]!.beat > 0) marks.unshift({ beat: 0, qpm: marks[0]!.qpm });
  let at = 0;
  const steps = marks.map((mark, k) => {
    if (k) at += ((mark.beat - marks[k - 1]!.beat) * 60) / marks[k - 1]!.qpm;
    return { ...mark, at };
  });
  return {
    seconds(beat: number) {
      const step = [...steps].reverse().find((s) => s.beat <= beat) ?? steps[0]!;
      return step.at + ((beat - step.beat) * 60) / step.qpm;
    },
    beat(seconds: number) {
      const step = [...steps].reverse().find((s) => s.at <= seconds) ?? steps[0]!;
      return step.beat + ((seconds - step.at) * step.qpm) / 60;
    },
  };
}

/** One note on the way out. Exported so it can be rendered offline and checked. */
export function playNote(ctx: BaseAudioContext, out: AudioNode, note: Pick<HeardNote, "height" | "voice" | "level">, when: number, seconds: number): void {
  const freq = 440 * 2 ** ((note.height - 69) / 12);
  const level = 0.16 * note.level;
  const env = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.connect(env);
  env.connect(out);
  const oscillator = (type: OscillatorType, detune: number, gain: number, ratio = 1) => {
    const osc = ctx.createOscillator();
    const amount = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq * ratio;
    osc.detune.value = detune;
    amount.gain.value = gain;
    osc.connect(amount);
    amount.connect(filter);
    osc.start(when);
    return osc;
  };
  let oscillators: OscillatorNode[];
  let end = when + seconds;
  env.gain.setValueAtTime(0, when);
  if (note.voice === "pluck") {
    // Struck, and left to die away.
    filter.frequency.value = Math.min(9000, freq * 7);
    oscillators = [oscillator("triangle", 0, 1), oscillator("sine", 0, 0.5, 2)];
    end = when + Math.min(seconds + 0.5, 3);
    env.gain.linearRampToValueAtTime(level * 1.3, when + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, end);
  } else if (note.voice === "brass") {
    filter.frequency.setValueAtTime(freq * 1.5, when);
    filter.frequency.linearRampToValueAtTime(Math.min(7000, freq * 6), when + 0.09);
    oscillators = [oscillator("sawtooth", -3, 0.7), oscillator("sawtooth", 3, 0.7)];
    end += 0.1;
    env.gain.linearRampToValueAtTime(level, when + Math.min(0.04, seconds / 3));
    env.gain.setValueAtTime(level, end - 0.1);
    env.gain.linearRampToValueAtTime(0, end);
  } else if (note.voice === "winds") {
    filter.frequency.value = Math.min(6000, freq * 4);
    oscillators = [oscillator("triangle", 0, 1), oscillator("square", 2, 0.12)];
    end += 0.08;
    env.gain.linearRampToValueAtTime(level * 1.1, when + Math.min(0.05, seconds / 3));
    env.gain.setValueAtTime(level * 1.1, end - 0.08);
    env.gain.linearRampToValueAtTime(0, end);
  } else {
    // A slow swell and a soft release, with two strings slightly apart.
    filter.frequency.value = Math.min(5000, freq * 5);
    filter.Q.value = 0.4;
    oscillators = [oscillator("sawtooth", -5, 0.6), oscillator("sawtooth", 5, 0.6)];
    end += 0.2;
    env.gain.linearRampToValueAtTime(level, when + Math.min(0.12, seconds / 2));
    env.gain.setValueAtTime(level, end - 0.2);
    env.gain.linearRampToValueAtTime(0, end);
  }
  for (const osc of oscillators) osc.stop(end + 0.02);
}

/** A room, made of nothing but decaying noise, so the notes don't sound dry. */
function roomOf(ctx: BaseAudioContext): ConvolverNode {
  const length = Math.floor(ctx.sampleRate * 2.2);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  const room = ctx.createConvolver();
  room.buffer = impulse;
  return room;
}

/** Where the notes go: straight out, and into the room. Exported so it can be rendered offline and checked. */
export function previewOutput(ctx: BaseAudioContext): { input: GainNode; master: GainNode } {
  const input = ctx.createGain();
  const master = ctx.createGain();
  const limit = ctx.createDynamicsCompressor();
  const room = roomOf(ctx);
  const send = ctx.createGain();
  send.gain.value = 0.28;
  input.connect(master);
  input.connect(send);
  send.connect(room);
  room.connect(master);
  master.connect(limit);
  limit.connect(ctx.destination);
  return { input, master };
}

/** Plays notes from a beat, a little at a time, so stopping is instant and a long piece costs nothing up front. */
export function createPreview() {
  let ctx: AudioContext | null = null;
  let stopCurrent: (() => void) | null = null;
  let asked = 0;
  const buffers = new Map<string, AudioBuffer>();
  return {
    /** Fetches what's needed first, and says so through `onLoading`, so nothing arrives late. Until the list of recordings is known, or if it never is, the synth plays at once. */
    play(notes: HeardNote[], tempos: { beat: number; qpm: number }[], fromBeat: number, onBeat: (beat: number) => void, onEnd: () => void, onLoading?: (loading: boolean) => void) {
      stopCurrent?.();
      const mine = ++asked;
      ctx ??= new AudioContext();
      void ctx.resume();
      const audio = ctx;
      const clock = beatClock(tempos);
      const secondsOf = (n: HeardNote) => Math.max(0.05, clock.seconds(n.start + n.length) - clock.seconds(n.start));
      void loadManifest();
      const manifest = knownManifest();
      const pick = (n: HeardNote) => {
        const set = n.instrument ? setOf(n.instrument) : null;
        return manifest && set ? chooseSample(manifest, set, n.height, secondsOf(n)) : null;
      };
      const needed = [...new Set(notes.filter((n) => n.start + n.length > fromBeat).flatMap((n) => pick(n)?.url ?? []))];
      if (needed.some((u) => !buffers.has(u))) {
        onLoading?.(true);
        void loadBuffers(audio, needed, buffers).then(() => {
          onLoading?.(false);
          if (mine === asked) begin();
        });
      } else begin();
      function begin() {
      const { input, master } = previewOutput(audio);
      // A note already sounding at this beat is heard for what's left of it.
      const sorted = notes
        .filter((n) => n.start + n.length > fromBeat + 1e-6)
        .map((n) => (n.start < fromBeat ? { ...n, start: fromBeat, length: n.start + n.length - fromBeat } : n))
        .sort((a, b) => a.start - b.start);
      const lastBeat = Math.max(fromBeat, ...sorted.map((n) => n.start + n.length));
      const startedAt = audio.currentTime + 0.08 - clock.seconds(fromBeat);
      let next = 0;
      const schedule = () => {
        const horizon = audio.currentTime + 0.5;
        while (next < sorted.length && startedAt + clock.seconds(sorted[next]!.start) < horizon) {
          const n = sorted[next]!;
          const chosen = pick(n);
          const buffer = chosen ? buffers.get(chosen.url) : undefined;
          if (chosen && buffer) playSample(audio, input, buffer, chosen, startedAt + clock.seconds(n.start), secondsOf(n), n.velocity ?? 80, n.level, seatOf(n.instrument ?? ""));
          else playNote(audio, input, n, startedAt + clock.seconds(n.start), secondsOf(n));
          next++;
        }
      };
      schedule();
      const timer = setInterval(schedule, 120);
      let frame = 0;
      const tick = () => {
        const beat = clock.beat(audio.currentTime - startedAt);
        if (beat > lastBeat) {
          stop();
          onEnd();
          return;
        }
        onBeat(Math.max(fromBeat, beat));
        frame = requestAnimationFrame(tick);
      };
      const stop = () => {
        clearInterval(timer);
        cancelAnimationFrame(frame);
        master.gain.setTargetAtTime(0, audio.currentTime, 0.02);
        stopCurrent = null;
      };
      stopCurrent = stop;
      frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      asked++;
      stopCurrent?.();
    },
  };
}
