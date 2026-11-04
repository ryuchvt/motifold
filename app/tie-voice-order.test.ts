import { expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { parseScore } from '../score';
import { packageFiles, pieceInput, placeNotes, scoreOfParts, scoreTracks, scoreWithSplits } from './arrange';
import { readMidi } from './midi';

const attrs = '<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (ticks: number, voice: string, ties = '', velocity = 90, name = 'C4') => `<note dynamics="${velocity / .9}"><pitch><step>${name[0]}</step><octave>${name.at(-1)}</octave></pitch><duration>${ticks}</duration>${ties.includes('e') ? '<tie type="stop"/>' : ''}${ties.includes('s') ? '<tie type="start"/>' : ''}<voice>${voice}</voice></note>`;
const rest = (ticks: number) => `<note><rest/><duration>${ticks}</duration><voice>1</voice></note>`;
const backup = (ticks: number) => `<backup><duration>${ticks}</duration></backup>`;
const xml = (bars: string[], second?: string[]) => `<score-partwise><part-list><score-part id="P1"><part-name>Source</part-name></score-part>${second ? '<score-part id="P2"><part-name>Other</part-name></score-part>' : ''}</part-list><part id="P1">${bars.map((bar, k) => `<measure number="${k + 1}">${k ? '' : attrs}${bar}</measure>`).join('')}</part>${second ? `<part id="P2">${second.map((bar, k) => `<measure number="${k + 1}">${k ? '' : attrs}${bar}</measure>`).join('')}</part>` : ''}</score-partwise>`;
const heard = (text: string) => scoreTracks(parseScore(text))[0]!.notes;
const bag = (notes: ReturnType<typeof heard>) => notes.map(n => [n.start, n.length, n.height, n.velocity]).sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));

const midiNoteOns = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out: number[][] = [];
  for (let track = 8 + view.getUint32(4); track + 8 <= bytes.length;) {
    let at = track + 8, tick = 0, running = 0;
    const end = at + view.getUint32(track + 4);
    const vlq = () => { let value = 0, byte: number; do { byte = bytes[at++]!; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
    while (at < end) {
      tick += vlq();
      let status = bytes[at]!;
      if (status < 128) status = running; else at++;
      if (status === 255) { at++; const length = vlq(); at += length; continue; }
      if (status === 240 || status === 247) { const length = vlq(); at += length; continue; }
      running = status;
      const kind = status >> 4;
      if (kind === 9 && bytes[at + 1]! > 0) out.push([tick, bytes[at]!, bytes[at + 1]!]);
      at += kind === 12 || kind === 13 ? 1 : 2;
    }
    track = end;
  }
  return out;
};

it('joins a stop serialized before its start in another voice, including actual MIDI stems', () => {
  const text = xml([rest(48) + note(18, '1', 'e', 30) + rest(30) + backup(96) + note(48, '2', 's') + rest(48)]);
  expect(bag(heard(text))).toEqual([[0, 2.75, 60, 90]]);
  const files = unzipSync(packageFiles(text, null, ''));
  for (const name of ['all-parts.mid', 'parts/01-Source.mid']) expect(readMidi(files[name]!).tracks[0]!.notes).toEqual([{ tick: 0, length: 1320, height: 60, velocity: 90 }]);
});

it('keeps simultaneous same-pitch tie chains in distinct voices', () => {
  const text = xml([note(24, '1', 's') + note(24, '1', 'e', 20) + rest(48) + backup(96) + rest(12) + note(12, '2', 's', 50) + note(48, '2', 'e', 30) + rest(24)]);
  expect(bag(heard(text))).toEqual([[0, 2, 60, 90], [.5, 2.5, 60, 50]]);
});

it('reserves voice-matched continuations before an orphan regardless of XML successor order', () => {
  const stop1 = rest(24) + note(48, '1', 'e', 20) + rest(24);
  const stop2 = rest(24) + note(24, '2', 'e', 40) + rest(48);
  const start = note(24, '1', 's') + rest(72);
  for (const [first, second] of [[stop1, stop2], [stop2, stop1]]) expect(bag(heard(xml([first + backup(96) + second + backup(96) + start])))).toEqual([[0, 3, 60, 90], [1, 1, 60, 40]]);
});

it('does not guess between two orphan successors for one cross-voice predecessor', () => {
  const first = rest(24) + note(24, '2', 'e', 40) + rest(48), second = rest(24) + note(48, '3', 'e', 50) + rest(24);
  for (const [a, b] of [[first, second], [second, first]]) expect(bag(heard(xml([a + backup(96) + b + backup(96) + note(24, '1', 's') + rest(72)])))).toEqual([[0, 1, 60, 90], [1, 1, 60, 40], [1, 2, 60, 50]]);
});

it('keeps an equal-onset fresh attack separate without deleting a held stop/start chain', () => {
  const text = xml([rest(24) + note(12, '1', '', 40) + rest(60) + backup(96) + note(24, '2', 's') + note(24, '2', 'es', 20) + note(24, '2', 'e', 20) + rest(24)]);
  expect(bag(heard(text))).toEqual([[0, 3, 60, 90], [1, .5, 60, 40]]);
});

it('does not join a gap or an ordinary repeated pitch, and keeps orphan stops audible', () => {
  expect(bag(heard(xml([note(24, '1', 's') + rest(24) + note(24, '1', 'e', 40) + rest(24)])))).toEqual([[0, 1, 60, 90], [2, 1, 60, 40]]);
  expect(bag(heard(xml([note(24, '1') + note(24, '1', '', 40) + rest(48)])))).toEqual([[0, 1, 60, 90], [1, 1, 60, 40]]);
});

const route = (text: string) => {
  const source = parseScore(text), input = pieceInput(source, source.parts[0]!, 0, source.parts[0]!.measures.length - 1);
  const answer = { idea: 'Place source', plan: (input.lines ?? ['Source']).map(line => ({ line, part: 'Harp', from: '1', to: String(source.parts[0]!.measures.length), voice: 'all' as const, octave: 0, why: 'Keep source' })) };
  const placed = placeNotes(source, input, answer, ['Harp']);
  return { source, input, placed, output: scoreOfParts(source, input, placed.parts) };
};

it('deduplicates complete in-bar ties, not equal prefixes with different releases', () => {
  const source = xml([note(48, '1', 's') + note(16, '1', 'e') + rest(32)], [note(48, '1', 's') + note(18, '1', 'e') + rest(30)]);
  const result = route(source);
  expect(result.placed.check).toMatchObject({ notes: 2, placed: 2, merged: 0 });
  expect(bag(heard(result.output))).toEqual([[0, 8 / 3, 60, 90], [0, 2.75, 60, 90]]);
});

it('recognises equal whole ties with different printed fragments', () => {
  const result = route(xml([note(48, '1', 's') + note(16, '1', 'e') + rest(32)], [note(24, '1', 's') + note(40, '1', 'e') + rest(32)]));
  expect(result.placed.check.merged).toBe(1);
  expect(bag(heard(result.output))).toEqual([[0, 8 / 3, 60, 90]]);
});

it('keeps outer cross-bar ties through placement and local splitting', () => {
  const result = route(xml([note(48, '1', 's') + note(48, '1', 'es'), note(24, '1', 'e') + rest(72)]));
  expect(result.placed.check.notes).toBe(1);
  expect(bag(heard(result.output))).toEqual([[0, 5, 60, 90]]);
  const placed = parseScore(result.output), input = pieceInput(placed, placed.parts[0]!, 0, 1);
  expect(bag(heard(scoreWithSplits(placed, input, [])))).toEqual([[0, 5, 60, 90]]);
});

it('does not guess between overlapping predecessors when no voice identifies the continuation', () => {
  const text = xml([note(24, '1', 's') + rest(72) + backup(96) + note(24, '2', 's', 70) + rest(72) + backup(96) + rest(24) + note(24, '3', 'e', 40) + rest(48)]);
  expect(bag(heard(text))).toEqual([[0, 1, 60, 90], [0, 1, 60, 70], [1, 1, 60, 40]]);
});

it('retains two same-pitch source attacks with different velocities, including both MIDI note-ons', () => {
  const result = route(xml([note(24, '1', '', 90) + rest(72)], [note(24, '1', '', 50) + rest(72)]));
  expect(result.placed.check.merged).toBe(0);
  expect(bag(heard(result.output))).toEqual([[0, 1, 60, 90], [0, 1, 60, 50]]);
  const midi = readMidi(unzipSync(packageFiles(result.output, null, ''))['all-parts.mid']!);
  expect(midi.tracks[0]!.notes.map(n => [n.tick, n.length, n.height])).toEqual([[0, 480, 60], [0, 480, 60]]);
  expect(midiNoteOns(unzipSync(packageFiles(result.output, null, ''))['all-parts.mid']!)).toEqual([[0, 60, 90], [0, 60, 50]]);
});

it('keeps a held outer tie and an untied same-pitch attack distinct at placement', () => {
  const result = route(xml([note(96, '1', 's'), note(24, '1', 'e') + rest(72)], [note(96, '1', '', 50), rest(96)]));
  expect(result.placed.check.merged).toBe(0);
  expect(bag(heard(result.output))).toEqual([[0, 4, 60, 50], [0, 5, 60, 90]]);
});

it('retains original attack order after chronological tie matching', () => {
  const text = xml([rest(24) + note(24, '1', '', 90, 'E4') + rest(48) + backup(96) + note(24, '2', '', 50) + rest(72)]);
  expect(heard(text).map(n => [n.start, n.height])).toEqual([[1, 64], [0, 60]]);
});
