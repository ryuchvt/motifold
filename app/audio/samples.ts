// Real instruments for hearing a score: recordings from Versilian Studios' VSCO 2 Community Edition, which is public domain, built by
// `scripts/build-samples.py`. Only the recordings a piece needs are fetched. Anything that can't be found falls back to the plain synth.

export interface SampleSet {
  long?: number[];
  short?: number[];
  pizz?: number[];
  hit?: boolean;
}
export type Manifest = Record<string, SampleSet>;

const SETS: [RegExp, string][] = [
  [/violin/i, "violins"],
  [/viola/i, "violas"],
  [/cello/i, "cellos"],
  [/double bass|contrabass/i, "basses"],
  [/piccolo/i, "piccolo"],
  [/flute/i, "flute"],
  [/oboe|english horn|cor anglais/i, "oboe"],
  [/clarinet/i, "clarinet"],
  [/bassoon/i, "bassoon"],
  [/horn/i, "horn"],
  [/trumpet|cornet/i, "trumpet"],
  [/trombone/i, "trombone"],
  [/tuba/i, "tuba"],
  [/timpani/i, "timpani"],
  [/harp/i, "harp"],
  [/glockenspiel|celesta/i, "glockenspiel"],
  [/xylophone/i, "xylophone"],
  [/marimba|vibraphone|tubular bells/i, "marimba"],
  [/snare/i, "snare"],
  [/bass drum/i, "bassdrum"],
  [/cymbal/i, "cymbals"],
  [/tam-?tam|gong/i, "tamtam"],
  [/triangle/i, "triangle"],
  [/piano|keyboard|melody/i, "piano"],
  [/string/i, "violins"],
];

/** Where each section sits on a stage, from -1 at the far left. */
const SEATS: [RegExp, number][] = [
  [/violin (i|1)\b/i, -0.5],
  [/violin (ii|2)\b/i, -0.25],
  [/viola/i, 0.15],
  [/cello/i, 0.35],
  [/double bass|contrabass/i, 0.5],
  [/flute|piccolo/i, -0.12],
  [/oboe/i, 0.12],
  [/clarinet/i, -0.08],
  [/bassoon/i, 0.08],
  [/horn/i, -0.3],
  [/trumpet/i, 0.2],
  [/trombone/i, 0.32],
  [/tuba/i, 0.42],
  [/timpani/i, -0.15],
  [/harp/i, -0.55],
  [/snare|bass drum|cymbal|tam-?tam|triangle|glockenspiel|xylophone/i, 0.05],
];

export const setOf = (instrument: string) => SETS.find(([word]) => word.test(instrument))?.[1] ?? null;
export const seatOf = (instrument: string) => SEATS.find(([word]) => word.test(instrument))?.[1] ?? 0;

/** How long a note has to be, in seconds, before a sustained recording suits it better than a short one. */
const SHORT_UNDER = 0.32;

export interface Chosen {
  url: string;
  /** What to multiply its speed by to reach the note. */
  rate: number;
  /** A sustained recording, which can loop if the note outlasts it. Anything else rings out on its own. */
  sustains: boolean;
}

/** The recording nearest a note. Null if there's none, or the nearest is too far from it to sound like the instrument. */
export function chooseSample(manifest: Manifest, set: string, height: number, seconds: number, pizz = false): Chosen | null {
  const entry = manifest[set];
  if (!entry) return null;
  if (entry.hit) return { url: `/samples/${set}/hit.m4a`, rate: 1, sustains: false };
  if (pizz && entry.pizz?.length) {
    const near = entry.pizz.reduce((best, m) => (Math.abs(m - height) < Math.abs(best - height) ? m : best));
    if (Math.abs(near - height) <= 12) return { url: `/samples/${set}/p${near}.m4a`, rate: 2 ** ((height - near) / 12), sustains: false };
  }
  const wantShort = seconds < SHORT_UNDER && !!entry.short?.length;
  const pool = wantShort ? entry.short! : (entry.long ?? []);
  if (!pool.length) return null;
  const nearest = pool.reduce((best, m) => (Math.abs(m - height) < Math.abs(best - height) ? m : best));
  if (Math.abs(nearest - height) > 12) return null;
  const hasShort = !!entry.short?.length;
  return { url: `/samples/${set}/${wantShort ? "s" : ""}${nearest}.m4a`, rate: 2 ** ((height - nearest) / 12), sustains: !wantShort && hasShort };
}

let manifestFile: Promise<Manifest | null> | null = null;
let manifestKnown: Manifest | null = null;
/** The list of what's there, fetched once. */
export function loadManifest(fetchImpl: typeof fetch = fetch): Promise<Manifest | null> {
  manifestFile ??= fetchImpl("/samples/manifest.json")
    .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : null))
    .then((found) => (manifestKnown = found))
    .catch(() => null);
  return manifestFile;
}
export const knownManifest = () => manifestKnown;

/** Fetches and decodes these, a few at a time, leaving out any that fail. */
export async function loadBuffers(ctx: BaseAudioContext, urls: string[], have: Map<string, AudioBuffer>, fetchImpl: typeof fetch = fetch): Promise<void> {
  const queue = urls.filter((u) => !have.has(u));
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const res = await fetchImpl(url);
        if (res.ok) have.set(url, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // The plain synth plays this one.
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

/** One note from a recording. Velocity sets how loud and how bright, because a soft note on any instrument has fewer overtones. Exported so it can be rendered offline and checked. */
export function playSample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, chosen: Chosen, when: number, seconds: number, velocity: number, level: number, seat: number): void {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();
  source.buffer = buffer;
  source.playbackRate.value = chosen.rate;
  const force = Math.max(0.05, Math.min(1, velocity / 127));
  filter.type = "lowpass";
  filter.frequency.value = 1500 + force * force * 15000;
  pan.pan.value = seat;
  const peak = 0.75 * level * force ** 1.4;
  const length = buffer.duration / chosen.rate;
  // A sustained recording stops when the note does. A plucked or struck one keeps ringing, though a new attack comes soon enough.
  const release = chosen.sustains ? 0.16 : 0.25;
  const end = chosen.sustains ? when + seconds : when + Math.min(length, Math.max(seconds + 0.6, 0.8));
  if (chosen.sustains && seconds > length - 0.3) {
    source.loop = true;
    source.loopStart = Math.min(1, buffer.duration * 0.3);
    source.loopEnd = buffer.duration - 0.25;
  }
  gain.gain.setValueAtTime(peak, when);
  gain.gain.setValueAtTime(peak, end);
  gain.gain.linearRampToValueAtTime(0, end + release);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(out);
  source.start(when);
  source.stop(end + release + 0.02);
}
