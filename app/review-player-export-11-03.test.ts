// Written transposition is source data. Player exports must preserve what the file sounds.
import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseScore } from '../score';
import { packageFiles, scoreTracks, transposedForPlayers } from './arrange';
import { readMidi } from './midi';
const frame = (chromatic: number, diatonic: number) => `<transpose><diatonic>${diatonic}</diatonic><chromatic>${chromatic}</chromatic></transpose>`;
const note = '<note dynamics="88.9"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
const source = (transpose = '') => `<score-partwise><part-list><score-part id="P1"><part-name>Clarinet</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${transpose}</attributes>${note}</measure><measure number="2">${note}</measure></part></score-partwise>`;
const sounding = (xml: string) => scoreTracks(parseScore(xml));

it('preserves an existing Bb written frame and key, including in the optional ZIP score', () => {
  const xml = source(frame(-2, -1));
  const written = transposedForPlayers(xml);
  expect(sounding(xml)[0]!.notes[0]!.height).toBe(58);
  expect(sounding(written)).toEqual(sounding(xml));
  expect(parseScore(written).parts[0]!.notes.map((n) => n.pitch)).toEqual(parseScore(xml).parts[0]!.notes.map((n) => n.pitch));
  expect(parseScore(written).parts[0]!.measures[0]!.key.fifths).toBe(0);
  expect(written.match(/<transpose>/g)).toHaveLength(1);
  const files = unzipSync(packageFiles(xml, null, '', [], true));
  expect(sounding(strFromU8(files['score-transposed-for-players.musicxml']!))).toEqual(sounding(xml));
  expect(readMidi(files['all-parts.mid']!).tracks.flatMap((t) => t.notes.map((n) => n.height))).toEqual([58, 58]);
});

it('preserves written-frame changes and makes repeated concert-to-player export idempotent', () => {
  const xml = source(frame(-3, -2)).replace('<measure number="2">', `<measure number="2"><attributes>${frame(-2, -1)}</attributes>`);
  expect(sounding(transposedForPlayers(xml))).toEqual(sounding(xml));
  const concert = source();
  const once = transposedForPlayers(concert);
  expect(sounding(once)).toEqual(sounding(concert));
  expect(parseScore(once).parts[0]!.notes[0]!.pitch).toMatchObject({ step: 'D', octave: 4 });
  expect(transposedForPlayers(once)).toBe(once);
});

it('converts an explicitly concert-pitch zero frame without leaving competing transpose declarations', () => {
  const xml = source(frame(0, 0));
  const written = transposedForPlayers(xml);
  expect(sounding(written)).toEqual(sounding(xml));
  expect(parseScore(written).parts[0]!.notes[0]!.pitch).toMatchObject({ step: 'D', octave: 4 });
  expect(written.match(/<transpose>/g)).toHaveLength(1);
});
