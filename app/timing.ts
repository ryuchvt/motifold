// A piece played freely into a DAW has notes and no bars: the file's own grid means nothing. This finds a grid that fits the playing. It works out
// rhythm and tempo together, because neither can be read without the other (Raphael 2001, Cemgil and Kappen 2003): each attack gets a place in a bar,
// tempo drifts, and a longer note lets it drift further. Code measures every reading here. Which one is the music is for Muse Spark and the composer.
import type { ReadBarsInput } from "../server/shapes";
import { readMidi } from "./midi";

export interface PlayedNote {
  id: number;
  /** Seconds from the start of the file's own music. */
  at: number;
  end: number;
  height: number;
  velocity: number;
}

export interface Played {
  notes: PlayedNote[];
  pedal: { at: number; down: boolean }[];
  /** The tempo and time signature the file claims, which free playing ignores. */
  claimed: { qpm: number | null; beats: number; beatType: number };
  /** Empty bars the file's grid has before the first note, in its own time signature. */
  emptyBars: number;
}

/** Notes this soft barely sound, so they say nothing about the pulse. They stay in the file. */
export const GHOST_VELOCITY = 8;
/** Notes this close were meant together. Hands spread chords further than a tidy player does (Goebl 2001, up to 50 ms), and this file reaches 90. */
const TOGETHER_S = 0.1;

export function playedFromMidi(bytes: Uint8Array): Played {
  const midi = readMidi(bytes);
  const firstNote = Math.min(...midi.tracks.flatMap((t) => t.notes.map((n) => n.tick)));
  // A DAW can write its first event a long way ahead of the music, and nobody played that silence.
  const first = Number.isFinite(firstNote) && firstNote - midi.firstTick > midi.ppq * 4 ? firstNote : midi.firstTick;
  const tempos = midi.tempos.length ? midi.tempos : [{ tick: first, qpm: 120 }];
  const secondsAt = (tick: number) => {
    let seconds = 0;
    let at = first;
    let qpm = tempos[0]!.qpm;
    for (const t of tempos) {
      if (t.tick >= tick) break;
      if (t.tick > at) {
        seconds += ((t.tick - at) / midi.ppq) * (60 / qpm);
        at = t.tick;
      }
      qpm = t.qpm;
    }
    return seconds + ((tick - at) / midi.ppq) * (60 / qpm);
  };
  const notes = midi.tracks
    .flatMap((t) => t.notes)
    .map((n) => ({ at: secondsAt(n.tick), end: secondsAt(n.tick + n.length), height: n.height, velocity: n.velocity ?? 64 }))
    .sort((a, b) => a.at - b.at || a.height - b.height)
    .map((n, k) => ({ id: k + 1, ...n }));
  const time = midi.times[0] ?? { beats: 4, beatType: 4 };
  return {
    notes,
    pedal: midi.pedal.map((p) => ({ at: secondsAt(p.tick), down: p.value >= 64 })),
    claimed: { qpm: midi.tempos[0]?.qpm ?? null, beats: time.beats, beatType: time.beatType },
    emptyBars: Number.isFinite(firstNote) ? Math.floor((firstNote / midi.ppq / ((time.beats * 4) / time.beatType)) + 1e-9) : 0,
  };
}

/** One moment of playing: the notes struck together. */
export interface Attack {
  k: number;
  at: number;
  notes: PlayedNote[];
  low: number;
  /** Its lowest note is the lowest for some way around it, so it's the bass and not a note inside the pattern. */
  bass: boolean;
  /** How long the longest of its notes was held, in seconds. */
  held: number;
  /** The sustain pedal was lifted right here. */
  pedalChange: boolean;
}

export function attacksOf(played: Played): Attack[] {
  const groups: PlayedNote[][] = [];
  for (const n of played.notes) {
    if (n.velocity <= GHOST_VELOCITY) continue;
    const last = groups[groups.length - 1];
    if (last && n.at - last[0]!.at <= TOGETHER_S) last.push(n);
    else groups.push([n]);
  }
  const lifts = played.pedal.filter((p) => !p.down).map((p) => p.at);
  const lows = groups.map((g) => Math.min(...g.map((n) => n.height)));
  return groups.map((g, k) => {
    const low = lows[k]!;
    const around = lows.slice(Math.max(0, k - 3), k + 4);
    const at = g[0]!.at;
    return { k, at, notes: g, low, bass: low === Math.min(...around), held: Math.max(...g.map((n) => n.end - n.at)), pedalChange: lifts.some((t) => Math.abs(t - at) <= 0.25) };
  });
}

/** How much an attack stands out, from what makes a beat feel strong: a bass, more than one note, a long note, a change of pedal (Lerdahl and Jackendoff). */
const salience = (a: Attack) => 0.5 * (a.notes.length - 1) + (a.bass ? 1 : 0) + Math.min(1, a.held / 3) + (a.pedalChange ? 0.5 : 0);

export interface Period {
  seconds: number;
  /** How strongly the playing repeats at this distance, from 0 to 1 against the strongest found. */
  strength: number;
}

/**
 * How far apart things tend to repeat. Pulse comes in levels, so this is a list of them, from each step of an arpeggio up to a whole phrase. Attacks are
 * smeared by how far rubato moves them, so a repeat that drifts still counts.
 */
export function periodsOf(attacks: Attack[]): Period[] {
  const step = 0.02;
  const end = attacks[attacks.length - 1]!.at + 1;
  const signal = new Float64Array(Math.ceil(end / step));
  for (const a of attacks) {
    const width = 0.05;
    const weight = 0.5 + salience(a);
    const centre = a.at / step;
    for (let i = Math.max(0, Math.floor(centre - (3 * width) / step)); i < Math.min(signal.length, centre + (3 * width) / step); i++) signal[i]! += weight * Math.exp(-((i - centre) ** 2) / (2 * (width / step) ** 2));
  }
  const lags: number[] = [];
  for (let lag = Math.round(0.25 / step); lag < Math.min(signal.length / 2, Math.round(12 / step)); lag++) {
    let sum = 0;
    for (let i = 0; i + lag < signal.length; i++) sum += signal[i]! * signal[i + lag]!;
    lags.push(sum / (signal.length - lag));
  }
  const peaks: Period[] = [];
  lags.forEach((v, k) => {
    if (k === 0 || k === lags.length - 1 || v < lags[k - 1]! || v < lags[k + 1]!) return;
    if (v > 0) peaks.push({ seconds: (k + Math.round(0.25 / step)) * step, strength: v });
  });
  const top = Math.max(...peaks.map((p) => p.strength), 1e-9);
  return peaks.map((p) => ({ ...p, strength: p.strength / top })).filter((p) => p.strength > 0.25).sort((a, b) => b.strength - a.strength);
}

export interface Meter {
  beats: number;
  beatType: number;
}

/** Twelve to the crotchet holds both sixteenths and triplets. */
const GRID = 12;
const crotchetsOf = (m: Meter) => (m.beats * 4) / m.beatType;

/** How strong a place in the bar is, from the metre's own levels, and how a bar of it divides. */
function strengthOf(m: Meter, pos: number): number {
  const bar = crotchetsOf(m) * GRID;
  if (pos === 0) return 4;
  const compound = m.beatType === 8 && m.beats % 3 === 0;
  const beat = compound ? (GRID * 3) / 2 : (GRID * 4) / m.beatType;
  const half = m.beats === 4 && !compound ? bar / 2 : compound && m.beats === 12 ? bar / 2 : 0;
  if (half && pos % half === 0) return 3.5;
  if (pos % beat === 0) return 3;
  const sub = compound ? GRID / 2 : beat / 2;
  if (pos % sub === 0) return 2;
  if (pos % (GRID / 4) === 0) return 1;
  return 0.5;
}

/** A triplet has to earn its place. One note that fits it is usually rubato, and a plain value is the simpler thing to write (Cemgil and Kappen). */
const TRIPLET_COST = 3;
const tripletCost = (pos: number) => (pos % 3 !== 0 ? TRIPLET_COST : 0);

const places = (m: Meter) => {
  const out: number[] = [];
  for (let pos = 0; pos < crotchetsOf(m) * GRID; pos++) if (pos % 3 === 0 || pos % 4 === 0) out.push(pos);
  return out;
};

/** How much tempo may move, as a share per crotchet, and how far a note may sit from the line. Raphael lets both grow with length. */
const DRIFT = 0.06;
const SLOP_S = 0.03;
const SLOP_SHARE = 0.05;
const huber = (z: number) => (Math.abs(z) < 2 ? (z * z) / 2 : 2 * Math.abs(z) - 2);
/** Seconds to the crotchet, log-spaced from 180 down to 30 to the minute. */
const TEMPI = Array.from({ length: 61 }, (_, k) => (60 / 180) * Math.pow(6, k / 60));

export interface Reading {
  meter: Meter;
  /** Each attack's place, in crotchets from the start of the music. */
  place: number[];
  /** Seconds to the crotchet at each attack. */
  tempo: number[];
  /** The whole reading's cost, per attack. Lower fits better, and only compares readings of the same notes. */
  cost: number;
}

/**
 * The best reading of these attacks in one metre. `fixed` says a bar starts at these attacks, for a composer's or Muse Spark's correction: anything
 * marked this way is treated as known and the rest is worked out again around it, which is how Raphael's model takes a person's help.
 */
export function readInMeter(attacks: Attack[], meter: Meter, barSeconds: number, fixed?: Set<number>): Reading {
  const spots = places(meter);
  const barLength = crotchetsOf(meter) * GRID;
  const n = attacks.length;
  const states = spots.length * TEMPI.length;
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  const length: Int16Array[] = [];
  // The level is the question being asked, so tempo stays within what rubato can reach from it.
  const usual = barSeconds / crotchetsOf(meter);
  const allowed = TEMPI.map((tau) => tau > usual / 1.6 && tau < usual * 1.6);
  const placeCost = (a: Attack, pos: number) => (fixed?.has(a.k) && pos !== 0 ? Infinity : tripletCost(pos) + (4 - strengthOf(meter, pos)) * (0.35 + 0.5 * salience(a)));
  const first = new Float64Array(states).fill(Infinity);
  spots.forEach((pos, p) => {
    for (let t = 0; t < TEMPI.length; t++) if (allowed[t]) first[p * TEMPI.length + t] = placeCost(attacks[0]!, pos) + (pos === 0 ? 0 : 1);
  });
  best.push(first);
  from.push(new Int32Array(states).fill(-1));
  length.push(new Int16Array(states));
  const LOOK = 3;
  for (let j = 1; j < n; j++) {
    const y = attacks[j]!.at - attacks[j - 1]!.at;
    const row = new Float64Array(states).fill(Infinity);
    const back = new Int32Array(states).fill(-1);
    const len = new Int16Array(states);
    const prev = best[j - 1]!;
    spots.forEach((posTo, pTo) => {
      const here = placeCost(attacks[j]!, posTo);
      if (here === Infinity) return;
      spots.forEach((posFrom, pFrom) => {
        const base = ((posTo - posFrom + barLength) % barLength) || barLength;
        for (let bars = 0; bars < LOOK; bars++) {
          const units = base + bars * barLength;
          const crotchets = units / GRID;
          for (let tTo = 0; tTo < TEMPI.length; tTo++) {
            if (!allowed[tTo]) continue;
            const tau = TEMPI[tTo]!;
            const expected = crotchets * tau;
            if (expected < y * 0.5 || expected > y * 1.8) continue;
            const z = (y - expected) / (SLOP_S + SLOP_SHARE * y);
            const fit = huber(z);
            const spread = DRIFT * Math.sqrt(crotchets);
            const reach = Math.ceil((spread * 3) / Math.log(TEMPI[1]! / TEMPI[0]!));
            for (let tFrom = Math.max(0, tTo - reach); tFrom <= Math.min(TEMPI.length - 1, tTo + reach); tFrom++) {
              const score = prev[pFrom * TEMPI.length + tFrom]!;
              if (score === Infinity) continue;
              const moved = Math.log(tau / TEMPI[tFrom]!) / spread;
              const total = score + here + fit + huber(moved);
              const at = pTo * TEMPI.length + tTo;
              if (total < row[at]!) {
                row[at] = total;
                back[at] = pFrom * TEMPI.length + tFrom;
                len[at] = units;
              }
            }
          }
        }
      });
    });
    best.push(row);
    from.push(back);
    length.push(len);
  }
  let at = 0;
  const last = best[n - 1]!;
  for (let s = 0; s < states; s++) if (last[s]! < last[at]!) at = s;
  const cost = last[at]! / n;
  const place = new Array<number>(n);
  const tempo = new Array<number>(n);
  const steps = new Array<number>(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    tempo[j] = TEMPI[at % TEMPI.length]!;
    steps[j] = length[j]![at]!;
    at = from[j]![at]!;
  }
  const startPos = (() => {
    // The first place comes from the state the path started in.
    let s = last.indexOf(Math.min(...last));
    for (let j = n - 1; j > 0; j--) s = from[j]![s]!;
    return spots[Math.floor(s / TEMPI.length)]!;
  })();
  let units = startPos;
  for (let j = 0; j < n; j++) {
    units += steps[j]!;
    place[j] = units / GRID;
  }
  return { meter, place, tempo, cost };
}

export interface Bar {
  number: number;
  /** In crotchets from the start of the music. */
  start: number;
  /** In seconds, on the reading's own map. */
  at: number;
  seconds: number;
  /** Crotchets to the minute across the bar. */
  qpm: number;
  /** The attack that starts the bar, or null when nothing is struck on its downbeat. */
  attack: number | null;
}

/** Seconds at a place in the music, going straight between the attacks around it. */
export function timeOfPlace(attacks: Attack[], reading: Reading, place: number): number {
  const p = reading.place;
  const n = p.length;
  if (place <= p[0]!) return attacks[0]!.at + (place - p[0]!) * reading.tempo[0]!;
  if (place >= p[n - 1]!) return attacks[n - 1]!.at + (place - p[n - 1]!) * reading.tempo[n - 1]!;
  let k = 0;
  while (p[k + 1]! < place) k++;
  return attacks[k]!.at + ((place - p[k]!) / (p[k + 1]! - p[k]!)) * (attacks[k + 1]!.at - attacks[k]!.at);
}

/** Bars from the reading. A place between attacks falls where the time between them says. */
export function barsOf(attacks: Attack[], reading: Reading): Bar[] {
  const length = crotchetsOf(reading.meter);
  const first = Math.floor(reading.place[0]! / length) * length;
  const end = reading.place[reading.place.length - 1]!;
  const bars: Bar[] = [];
  // A pickup isn't bar 1. Muse Spark and the score both count from the first full bar.
  const pickup = reading.place[0]! > first + 1e-6;
  for (let start = first, number = pickup ? 0 : 1; start <= end + 1e-6; start += length, number++) {
    const at = timeOfPlace(attacks, reading, start);
    const next = timeOfPlace(attacks, reading, start + length);
    const k = reading.place.findIndex((p) => Math.abs(p - start) < 1e-6);
    bars.push({ number, start, at, seconds: next - at, qpm: (length * 60) / (next - at), attack: k >= 0 ? k : null });
  }
  return bars;
}

export interface Evidence {
  bars: number;
  /** Of the notes struck, how far they sit from the reading's smooth tempo line, as the median in ms. */
  residualMs: number;
  /** Of the bass notes, how many land on a downbeat. */
  bassOnDownbeat: { on: number; of: number };
  /** Of the times the pedal is lifted, how many land by a bar's start. */
  pedalOnDownbeat: { on: number; of: number };
  /** Of the bars, how many share the commonest rhythm: parallel music should get parallel bars (Lerdahl and Jackendoff). */
  sameRhythm: { on: number; of: number; rhythm: string };
  /** Slowest and fastest bars, in crotchets to the minute. */
  tempoRange: [number, number];
  /** Attacks on a grid finer than the eighth note. */
  fine: number;
}

export function evidenceOf(attacks: Attack[], reading: Reading): Evidence {
  const length = crotchetsOf(reading.meter);
  const bars = barsOf(attacks, reading);
  const onDownbeat = (k: number) => Math.abs(((reading.place[k]! % length) + length) % length) < 1e-6;
  const changes = attacks.filter((a) => a.bass);
  const lifts = attacks.filter((a) => a.pedalChange);
  const rhythms = new Map<number, string[]>();
  reading.place.forEach((p) => {
    const bar = Math.floor(p / length);
    rhythms.set(bar, [...(rhythms.get(bar) ?? []), String(Math.round(((p - bar * length) * GRID)) / GRID)]);
  });
  const counts = new Map<string, number>();
  for (const r of rhythms.values()) counts.set(r.join(" "), (counts.get(r.join(" ")) ?? 0) + 1);
  const [rhythm, on] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const residuals = attacks.map((a, k) => {
    if (k === 0 || k === attacks.length - 1) return 0;
    const line = reading.tempo[k]! * (reading.place[k]! - reading.place[k - 1]!) + attacks[k - 1]!.at;
    return Math.abs(a.at - line) * 1000;
  });
  const qpms = bars.slice(0, -1).map((b) => b.qpm);
  return {
    bars: bars.length,
    residualMs: [...residuals].sort((a, b) => a - b)[residuals.length >> 1] ?? 0,
    bassOnDownbeat: { on: changes.filter((a) => onDownbeat(a.k)).length, of: changes.length },
    pedalOnDownbeat: { on: lifts.filter((a) => onDownbeat(a.k)).length, of: lifts.length },
    sameRhythm: { on, of: rhythms.size, rhythm },
    tempoRange: [Math.min(...qpms), Math.max(...qpms)],
    fine: reading.place.filter((p) => Math.round(p * GRID) % (GRID / 2) !== 0).length,
  };
}

export const METERS: Meter[] = [
  { beats: 2, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 4, beatType: 4 },
  { beats: 6, beatType: 8 },
  { beats: 9, beatType: 8 },
  { beats: 12, beatType: 8 },
];

/** Bars the composer or Muse Spark has settled: the attack that starts each one, and how many bars since the last, normally one. */
export type BarStart = { attack: number; bars: number };

/** Rhythm and tempo inside bars that are already settled. Everything is the same reading as above, with the bars no longer in question. */
export function readWithinBars(attacks: Attack[], meter: Meter, starts: BarStart[]): Reading {
  const spots = places(meter);
  const barLength = crotchetsOf(meter) * GRID;
  const gaps = new Map(starts.map((s) => [s.attack, s.bars]));
  const firstFixed = starts[0]!.attack;
  const lastFixed = starts[starts.length - 1]!.attack;
  const seconds = starts.slice(1).map((s, k) => (attacks[s.attack]!.at - attacks[starts[k]!.attack]!.at) / s.bars).sort((a, b) => a - b);
  const usual = (seconds[seconds.length >> 1] ?? 2) / crotchetsOf(meter);
  const allowed = TEMPI.map((tau) => tau > usual / 2 && tau < usual * 2);
  const n = attacks.length;
  // Between starts more than a bar apart, barlines pass with nothing struck on them, so a state also counts how many this stretch has crossed.
  const most = Math.max(...starts.map((s) => s.bars), 1);
  const gapAhead = (j: number) => starts.find((s) => s.attack >= j)?.bars ?? 1;
  const states = spots.length * TEMPI.length * most;
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  const steps: Int16Array[] = [];
  const placeCost = (a: Attack, pos: number) => (gaps.has(a.k) && pos !== 0 ? Infinity : tripletCost(pos) + (4 - strengthOf(meter, pos)) * (0.35 + 0.5 * salience(a)));
  const first = new Float64Array(states).fill(Infinity);
  spots.forEach((pos, p) => {
    if (placeCost(attacks[0]!, pos) === Infinity) return;
    for (let t = 0; t < TEMPI.length; t++) if (allowed[t]) first[(p * TEMPI.length + t) * most] = placeCost(attacks[0]!, pos);
  });
  best.push(first);
  from.push(new Int32Array(states).fill(-1));
  steps.push(new Int16Array(states));
  for (let j = 1; j < n; j++) {
    const y = attacks[j]!.at - attacks[j - 1]!.at;
    const row = new Float64Array(states).fill(Infinity);
    const back = new Int32Array(states).fill(-1);
    const len = new Int16Array(states);
    const gap = gaps.get(j);
    spots.forEach((posTo, pTo) => {
      const here = placeCost(attacks[j]!, posTo);
      if (here === Infinity) return;
      spots.forEach((posFrom, pFrom) => {
        const wrap = (posTo - posFrom + barLength) % barLength || barLength;
        // Each way here: how far it goes, how many barlines the stretch had crossed before it, and how many after.
        const ways: { units: number; before: number; after: number }[] = [];
        if (gap !== undefined) {
          for (let c = 0; c < gap; c++) ways.push({ units: wrap + (gap - 1 - c) * barLength, before: c, after: 0 });
        } else if (j > lastFixed || j < firstFixed) {
          // After the last start the music runs free, and so does a pickup before the first.
          for (const b of [0, 1, 2]) ways.push({ units: wrap + b * barLength, before: 0, after: 0 });
        } else {
          const ahead = gapAhead(j);
          for (let c = 0; c < ahead; c++) {
            if (posTo > posFrom) ways.push({ units: posTo - posFrom, before: c, after: c });
            // A downbeat in this stretch is silent, or it would have been a start.
            if (c + 1 < ahead && posTo !== 0 && posTo <= posFrom) ways.push({ units: wrap, before: c, after: c + 1 });
          }
        }
        for (const { units, before, after } of ways) {
          const crotchets = units / GRID;
          const spread = DRIFT * Math.sqrt(crotchets);
          const reach = Math.ceil((spread * 4) / Math.log(TEMPI[1]! / TEMPI[0]!));
          for (let tTo = 0; tTo < TEMPI.length; tTo++) {
            if (!allowed[tTo]) continue;
            const tau = TEMPI[tTo]!;
            const fit = huber((y - crotchets * tau) / (SLOP_S + SLOP_SHARE * y));
            for (let tFrom = Math.max(0, tTo - reach); tFrom <= Math.min(TEMPI.length - 1, tTo + reach); tFrom++) {
              const was = (pFrom * TEMPI.length + tFrom) * most + before;
              const score = best[j - 1]![was]!;
              if (score === Infinity) continue;
              const total = score + here + fit + huber(Math.log(tau / TEMPI[tFrom]!) / spread);
              const at = (pTo * TEMPI.length + tTo) * most + after;
              if (total < row[at]!) {
                row[at] = total;
                back[at] = was;
                len[at] = units;
              }
            }
          }
        }
      });
    });
    best.push(row);
    from.push(back);
    steps.push(len);
  }
  const last = best[n - 1]!;
  let at = 0;
  for (let s = 0; s < states; s++) if (last[s]! < last[at]!) at = s;
  const cost = last[at]! / n;
  const path = new Array<number>(n);
  for (let j = n - 1, s = at; j >= 0; j--) {
    path[j] = s;
    s = from[j]![s]!;
  }
  // The music starts on the settled grid: a pickup before the first start comes before bar one's place.
  const place = new Array<number>(n);
  const tempo = path.map((s) => TEMPI[Math.floor(s / most) % TEMPI.length]!);
  const pos0 = spots[Math.floor(Math.floor(path[0]! / most) / TEMPI.length)]!;
  place[0] = pos0 / GRID;
  for (let j = 1; j < n; j++) place[j] = place[j - 1]! + steps[j]![path[j]!]! / GRID;
  return { meter, place, tempo, cost };
}

/** Attacks on a beat: the places a tempo map holds still. Anything between stays exactly as played, so a bar's feel survives the map. */
export function knotsOf(attacks: Attack[], reading: Reading): { place: number; at: number }[] {
  const beat = reading.meter.beatType === 8 && reading.meter.beats % 3 === 0 ? 1.5 : 4 / reading.meter.beatType;
  return attacks.flatMap((a, k) => (Math.abs(reading.place[k]! / beat - Math.round(reading.place[k]! / beat)) < 1e-6 ? [{ place: reading.place[k]!, at: a.at }] : []));
}

/** The tempo from each place on the line to the next, and the last one carried on. */
export function tempoMarks(line: { place: number; at: number }[]): { place: number; qpm: number }[] {
  const qpmOf = (a: { place: number; at: number }, b: { place: number; at: number }) => ((b.place - a.place) * 60) / (b.at - a.at);
  return line.map((k, i) => ({ place: k.place, qpm: i + 1 < line.length ? qpmOf(k, line[i + 1]!) : qpmOf(line[i - 1]!, k) }));
}

/** The tempo map the score and the MIDI both go by, from the start of the first bar. */
export function readingTempo(attacks: Attack[], reading: Reading): { place: number; qpm: number }[] {
  const length = crotchetsOf(reading.meter);
  const origin = Math.floor(reading.place[0]! / length) * length;
  return tempoMarks([{ place: origin, at: timeOfPlace(attacks, reading, origin) }, ...knotsOf(attacks, reading).filter((k) => k.place > origin + 1e-6)]);
}

/** Where a moment of real time falls in the music, on the tempo map. Past either end it carries on at the nearest tempo. */
export function placeOfTime(knots: { place: number; at: number }[], at: number): number {
  const n = knots.length;
  const line = (a: { place: number; at: number }, b: { place: number; at: number }) => a.place + ((at - a.at) / (b.at - a.at)) * (b.place - a.place);
  if (at <= knots[0]!.at) return line(knots[0]!, knots[1]!);
  if (at >= knots[n - 1]!.at) return line(knots[n - 2]!, knots[n - 1]!);
  let k = 0;
  while (knots[k + 1]!.at < at) k++;
  return line(knots[k]!, knots[k + 1]!);
}

const vlq = (v: number): number[] => {
  const out = [v & 127];
  for (let rest = v >> 7; rest > 0; rest >>= 7) out.unshift((rest & 127) | 128);
  return out;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 127);
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/**
 * The same playing on the bars that were found: a tempo map, with every note where it was struck, as loud and as long. Bars now line up in a DAW and no
 * note has moved in real time, except by the rounding of a tick.
 */
export function mappedMidi(played: Played, attacks: Attack[], reading: Reading): Uint8Array {
  const PPQ = 480;
  const length = crotchetsOf(reading.meter);
  // A soft touch before the first strike is still in the file, so it gets a bar of its own to stay in.
  const knots = knotsOf(attacks, reading);
  const earliest = Math.min(reading.place[0]!, ...(knots.length > 1 ? played.notes.map((n) => placeOfTime(knots, n.at)) : []));
  const origin = Math.floor(earliest / length) * length;
  const tick = (place: number) => Math.round((place - origin) * PPQ);
  const metas: { tick: number; data: number[] }[] = [
    { tick: 0, data: [0xff, 0x58, 4, reading.meter.beats, Math.round(Math.log2(reading.meter.beatType)), 24, 8] },
  ];
  const line = [{ place: origin, at: timeOfPlace(attacks, reading, origin) }, ...knots.filter((k) => k.place > origin + 1e-6)];
  for (const mark of tempoMarks(line)) {
    const micros = Math.round(60_000_000 / mark.qpm);
    metas.push({ tick: tick(mark.place), data: [0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255] });
  }
  const events: { tick: number; order: number; data: number[] }[] = [];
  for (const n of played.notes) {
    events.push({ tick: Math.max(0, tick(placeOfTime(line, n.at))), order: 1, data: [0x90, n.height, n.velocity] });
    events.push({ tick: Math.max(0, tick(placeOfTime(line, n.end))), order: 0, data: [0x80, n.height, 0] });
  }
  for (const p of played.pedal) events.push({ tick: Math.max(0, tick(placeOfTime(line, p.at))), order: 0, data: [0xb0, 64, p.down ? 127 : 0] });
  const track = (list: { tick: number; data: number[] }[]) => {
    const body: number[] = [];
    let last = 0;
    for (const e of list) {
      body.push(...vlq(e.tick - last), ...e.data);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    return [...ascii("MTrk"), ...be32(body.length), ...body];
  };
  return new Uint8Array([
    ...ascii("MThd"), ...be32(6), 0, 1, 0, 2, PPQ >> 8, PPQ & 255,
    ...track(metas.sort((a, b) => a.tick - b.tick)),
    ...track(events.sort((a, b) => a.tick - b.tick || a.order - b.order)),
  ]);
}

/** The biggest shift any note has between the two files, once each is turned back into seconds. */
export function largestShiftMs(before: Played, after: Played, offset = 0): number {
  const sort = (p: Played) => [...p.notes].sort((a, b) => a.at - b.at || a.height - b.height);
  const [a, b] = [sort(before), sort(after)];
  if (a.length !== b.length) return Infinity;
  return Math.max(...a.map((n, k) => Math.abs(n.at - offset - b[k]!.at) * 1000));
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const nameOf = (height: number) => `${NAMES[height % 12]}${Math.floor(height / 12) - 1}`;

export interface BarFact {
  number: number;
  at: number;
  seconds: number;
  qpm: number;
  /** How far the bar's start sits from a steady pulse through the whole piece, in ms. Positive is late. */
  behindMs: number;
  level: number;
  notes: number;
}

/** The time of each bar, and where it stands against a steady pulse, which shows whether time taken comes back. Facts only. */
export function barFacts(attacks: Attack[], reading: Reading): BarFact[] {
  const bars = barsOf(attacks, reading);
  const n = bars.length;
  const whole = bars.slice(0, -1);
  const secs = whole.map((b) => b.seconds).sort((a, b) => a - b);
  const usual = secs[secs.length >> 1] ?? 1;
  return bars.map((b, k) => {
    const inside = attacks.filter((a, i) => reading.place[i]! >= b.start - 1e-6 && reading.place[i]! < b.start + crotchetsOf(reading.meter) - 1e-6);
    const velocities = inside.flatMap((a) => a.notes.map((x) => x.velocity));
    return { number: b.number, at: b.at, seconds: b.seconds, qpm: b.qpm, behindMs: (b.at - (bars[0]!.at + k * usual)) * 1000, level: velocities.length ? velocities.reduce((s, v) => s + v, 0) / velocities.length : 0, notes: velocities.length };
  }).slice(0, n);
}

/** Who comes first when two hands strike together, in ms, for every attack of more than one note. */
export function spreadOf(attacks: Attack[]): { at: number; ms: number; lowFirst: boolean }[] {
  return attacks.filter((a) => a.notes.length > 1).map((a) => {
    const byTime = [...a.notes].sort((x, y) => x.at - y.at);
    return { at: a.at, ms: (byTime[byTime.length - 1]!.at - byTime[0]!.at) * 1000, lowFirst: byTime[0]!.height === a.low };
  });
}

/** The tempo of each step of the closing notes, against Friberg and Sundberg's stopping runner, tempo = (1 + (w^q − 1) x)^(1/q). Listeners liked q of 2 or 3. */
export function closingCurve(attacks: Attack[], fromAttack: number): { steps: number[]; q: number; finalShare: number } {
  const closing = attacks.slice(fromAttack);
  const steps = closing.slice(1).map((a, k) => a.at - closing[k]!.at);
  if (steps.length < 2) return { steps, q: NaN, finalShare: NaN };
  const rate = steps.map((s) => steps[0]! / s);
  const w = Math.min(1, rate[rate.length - 1]!);
  let bestQ = 1;
  let bestErr = Infinity;
  for (let q = 0.5; q <= 6; q += 0.25) {
    const err = rate.reduce((sum, v, k) => {
      const x = (k + 0.5) / rate.length;
      const model = Math.pow(1 + (Math.pow(w, q) - 1) * x, 1 / q);
      return sum + (model - v) ** 2;
    }, 0);
    if (err < bestErr) {
      bestErr = err;
      bestQ = q;
    }
  }
  return { steps, q: bestQ, finalShare: w };
}

/**
 * Whether a file's notes ignore its own grid, so its bars can't mean anything: one or two tracks, a single tempo at most, and many notes away from any
 * sixteenth or triplet. A chance scatter lands near that grid about two times in five. Playing to a click can look like this too, so the composer can keep the file's bars.
 */
export function looksFreelyPlayed(bytes: Uint8Array): boolean {
  const midi = readMidi(bytes);
  const notes = midi.tracks.flatMap((t) => t.notes);
  if (midi.tracks.length > 2 || midi.tempos.length > 1 || notes.length < 8 || notes.length > 500) return false;
  const near = (tick: number, step: number) => Math.min(tick % step, step - (tick % step));
  const off = notes.filter((n) => Math.min(near(n.tick, midi.ppq / 4), near(n.tick, midi.ppq / 3)) > midi.ppq / 48);
  return off.length / notes.length > 0.4;
}

/** What Muse Spark is told about free playing, with what the code finds in each metre at the distances things repeat. That takes seconds, so it gives the page a turn between readings. */
export async function barsInput(played: Played, attacks: Attack[], ask: string | null = null): Promise<ReadBarsInput> {
  const periods = periodsOf(attacks).filter((p) => p.seconds >= 0.3).slice(0, 12);
  const barLengths = [...new Set(periods.filter((p) => p.seconds > 1 && p.seconds < 9).slice(0, 5).map((p) => p.seconds))];
  const readings = [];
  for (const bar of barLengths) {
    for (const m of METERS) {
      await new Promise((go) => setTimeout(go));
      const r = readInMeter(attacks, m, bar);
      const e = evidenceOf(attacks, r);
      readings.push({ cost: r.cost, meter: `${m.beats}/${m.beatType}`, barSeconds: bar, bars: e.bars, residualMs: e.residualMs, bassOn: e.bassOnDownbeat.on, bassOf: e.bassOnDownbeat.of, pedalOn: e.pedalOnDownbeat.on, pedalOf: e.pedalOnDownbeat.of, sameOn: e.sameRhythm.on, sameOf: e.sameRhythm.of, rhythm: e.sameRhythm.rhythm, qpmLow: e.tempoRange[0], qpmHigh: e.tempoRange[1] });
    }
  }
  readings.sort((a, b) => a.cost - b.cost);
  // To the millisecond, which is all it's shown. It keeps a long piece under the Worker's limit, and the last digits differ between browsers and would miss the cache.
  const ms = (x: number) => Math.round(x * 1000) / 1000;
  return {
    title: null,
    attacks: attacks.map((a) => ({ k: a.k, at: ms(a.at), notes: a.notes.map((n) => ({ id: n.id, name: nameOf(n.height), velocity: n.velocity, held: ms(n.end - n.at), at: ms(n.at) })), bass: a.bass, pedal: a.pedalChange })),
    ghosts: played.notes.filter((n) => n.velocity <= GHOST_VELOCITY).map((n) => ({ id: n.id, at: ms(n.at), name: nameOf(n.height), velocity: n.velocity })),
    periods: periods.map((p) => ({ seconds: ms(p.seconds), strength: ms(p.strength) })),
    readings: readings.slice(0, 18).map(({ cost: _cost, ...x }) => ({ ...x, barSeconds: ms(x.barSeconds), residualMs: ms(x.residualMs), qpmLow: ms(x.qpmLow), qpmHigh: ms(x.qpmHigh) })),
    claimed: { ...played.claimed, emptyBars: played.emptyBars },
    ask,
  };
}

/** How a bar's notes were struck, in decibels against the piece's usual bar, for a file with no recording to measure. */
export function strikeLevels(facts: BarFact[]): number[] {
  const db = facts.map((b) => 20 * Math.log10(Math.max(b.level, 1)));
  const usual = [...db].sort((a, b) => a - b)[db.length >> 1] ?? 0;
  return db.map((v) => v - usual);
}

