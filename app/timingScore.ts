// Turning a settled reading into notation a person can read: bars of the found metre, each hand on its own staff, one line to a hand. The sustain pedal
// holds what the notes don't, as it did in the playing, and the last notes ring past the final bar in the MIDI only.
import { scoreXml, type BarHead, type NewEvent, type PlacedPart } from "./arrange";
import { barsOf, knotsOf, nameOf, placeOfTime, readingTempo, type Attack, type Played, type Reading } from "./timing";

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** Semitones a hand reaches comfortably from its lowest note. */
const HAND_REACH = 14;
/** On one line with no pedal, silence this long before the next note, in crotchets, is a rest and not a loose hand. */
const REAL_GAP = 0.5;

export function scoreOfReading(played: Played, attacks: Attack[], reading: Reading, title: string): string {
  const crotchets = (reading.meter.beats * 4) / reading.meter.beatType;
  const bars = barsOf(attacks, reading);
  const origin = bars[0]!.start;
  const placed = attacks.flatMap((a, k) => a.notes.map((n) => ({ place: reading.place[k]!, height: n.height, velocity: n.velocity, end: n.end, at: a.at, tempo: reading.tempo[k]! })));
  const barIndex = (place: number) => Math.floor((place - origin) / crotchets + 1e-9);
  // The lower hand holds the bar's lowest note and whatever it can reach from there, about a ninth. The upper hand has the rest.
  const lowest = bars.map((_, k) => {
    const heights = placed.filter((n) => barIndex(n.place) === k).map((n) => n.height);
    return heights.length ? Math.min(...heights) : 60;
  });
  // A melody alone has no second hand, and it isn't a low part because its notes fit under one.
  const oneLine = attacks.every((a) => a.notes.length === 1);
  const staffOf = (n: { place: number; height: number }) => (oneLine || n.height > lowest[barIndex(n.place)]! + HAND_REACH ? 0 : 1);
  const parts: PlacedPart[] = (oneLine ? ["Melody"] : ["Piano upper", "Piano lower"]).map((name) => ({ name, bars: bars.map(() => []) }));
  const knots = knotsOf(attacks, reading);
  const lastPlace = origin + bars.length * crotchets;
  /** When a note really stops sounding: when the key comes up, or later if the pedal is down then. */
  const soundsUntil = (end: number) => {
    const moves = [...played.pedal].sort((a, b) => a.at - b.at);
    const down = [...moves].reverse().find((p) => p.at <= end)?.down ?? false;
    return down ? (moves.find((p) => p.at > end && !p.down)?.at ?? Infinity) : end;
  };
  /** Where a note on one line stops on the page, when nothing holds it and it stops well before the next. */
  const endOf = (n: { place: number; end: number }, next: number | undefined) => {
    if (!oneLine || knots.length < 2) return next ?? lastPlace;
    const until = soundsUntil(n.end);
    if (until === Infinity) return next ?? lastPlace;
    const stopped = Math.max(n.place + 0.25, Math.round(placeOfTime(knots, until) * 4) / 4);
    return next === undefined ? Math.min(stopped, lastPlace) : next - stopped >= REAL_GAP ? stopped : next;
  };
  parts.forEach((_, staff) => {
    const mine = placed.filter((n) => staffOf(n) === staff).sort((a, b) => a.place - b.place);
    const places = [...new Set(mine.map((n) => n.place))].sort((a, b) => a - b);
    mine.forEach((n) => {
      const next = places.find((p) => p > n.place + 1e-6);
      // One line to a hand: a note lasts to the next one in that hand, and the last ones ring as they were played.
      const heldTo = endOf(n, next);
      let from = n.place;
      while (from < heldTo - 1e-6) {
        const k = barIndex(from);
        const barEnd = origin + (k + 1) * crotchets;
        const to = Math.min(heldTo, barEnd);
        const event: NewEvent = { start: from - (origin + k * crotchets), length: to - from, names: [nameOf(n.height)], velocity: n.velocity, tieStop: !eq(from, n.place), tieStart: to < heldTo - 1e-6 };
        if (parts[staff]!.bars[k]) parts[staff]!.bars[k]!.push(event);
        from = to;
      }
    });
  });
  const barCount = parts[0]!.bars.length;
  // The same tempo map as the MIDI, beat by beat, so what's written and what's exported keep the time it was played in.
  const marks = readingTempo(attacks, reading).map((m) => ({ ...m, qpm: Math.round(m.qpm * 10000) / 10000 }));
  const heads: BarHead[] = Array.from({ length: barCount }, (_, k) => {
    const start = origin + k * crotchets;
    const inBar = marks.filter((m) => m.place >= start - 1e-6 && m.place < start + crotchets - 1e-6);
    const atBarline = inBar.find((m) => m.place <= start + 1e-6);
    const later = inBar.filter((m) => m.place > start + 1e-6).map((m) => ({ beat: m.place - start, qpm: m.qpm }));
    return { number: String(bars[0]!.number + k), implicit: bars[0]!.number + k === 0, length: crotchets, time: k === 0 ? { beats: reading.meter.beats, beatType: reading.meter.beatType } : null, fifths: 0, repeatForward: false, repeatBackward: null, endings: [], words: [], qpm: atBarline?.qpm ?? null, ...(later.length ? { moreTempos: later } : {}) };
  });
  // A hand that never plays isn't a part, or it's the first thing anyone reads.
  const sounding = parts.filter((part) => part.bars.some((events) => events.length));
  return scoreXml({ title: null, movementTitle: title, composer: null }, heads, sounding.length === 1 && !oneLine ? [{ ...sounding[0]!, name: "Piano" }] : sounding);
}
