import { expect, it } from 'vitest';
import { assertNewNoteRangeRepair, newNoteRangeRepairs } from './new-note-range-repair';
import type { OptionCheck } from '../app/arrange';
import type { WriteAnswer } from '../server/shapes';
import { arrangeInput, checkOption, emptyScore, packageFiles, scoreTracks, withOption } from '../app/arrange';
import { parseScore } from '../score';
import { unzipSync, strFromU8 } from 'fflate';
const check: OptionCheck = { adds: [], notes: 5, overBars: 0, unreadable: 0, pastBarEnd: 0, clashes: [], outOfRange: [{ part: 'Violin I', bar: '10', name: 'F3' }, { part: 'Violin II', bar: '10', name: 'F3' }, { part: 'Flute 1', bar: '30', name: 'B3' }] };
const before: WriteAnswer['adds'] = [{ part: 'Violin I', bar: '10', events: 'A3@0+1 G3@1+1 F3@2+1', dyn: 'p<mf', role: 'countermelody', art: 'pizz' }, { part: 'Violin II', bar: '10', events: 'A3@0+1 G3@1+1 F3@2+1', dyn: 'p', role: 'harmony', art: '' }, { part: 'Cello', bar: '10', events: 'C3@0+3', dyn: 'p', role: 'bass', art: '' }, { part: 'Flute 1', bar: '30', events: 'B3@0+1.5 C4@1.5+1.5', dyn: 'mp', role: 'melody', art: '' }];
const repair = newNoteRangeRepairs(check)![0]!;
const valid = () => before.map(add => add.bar === '10' && repair.parts.includes(add.part) ? { ...add, events: add.events.replace('F3', 'F4') } : structuredClone(add));
it('derives at most two short neutral sounding-range requests from the same range checker', () => {
  const repairs = newNoteRangeRepairs(check)!;
  expect(repairs.map(item => [item.bar, item.parts])).toEqual([['10', ['Violin I', 'Violin II']], ['30', ['Flute 1']]]);
  expect(repairs[0]!.ask).toContain('Violin I G3..G7'); expect(repairs[1]!.ask).toContain('Flute 1 C4..C7');
  expect(repairs.every(item => item.ask.length <= 400 && !item.ask.includes('mood'))).toBe(true);
  for (const change of [{ outOfRange: [] }, { unreadable: 1 }, { overBars: 1 }, { pastBarEnd: 1 }, { outOfRange: [...check.outOfRange, { part: 'Flute 1', bar: '31', name: 'B3' }] }, { outOfRange: [{ part: 'Unknown', bar: '1', name: 'C4' }] }]) expect(newNoteRangeRepairs({ ...check, ...change })).toBeNull();
});
it('permits only octave changes in the flagged part+bar keys while preserving every other entry', () => {
  expect(() => assertNewNoteRangeRepair(before, valid(), repair)).not.toThrow();
  expect(valid()[2]).toEqual(before[2]); expect(valid()[3]).toEqual(before[3]);
});
it.each(['drop', 'add', 'pitch-class', 'spelling', 'sub-grid-time', 'duration', 'dyn', 'role', 'art', 'unrelated-part', 'unrelated-bar', 'grouping', 'still-low'] as const)('rejects an invalid repair: %s', change => {
  const after = valid();
  if (change === 'drop') after[0]!.events = 'A3@0+1 G3@1+1';
  if (change === 'add') after[0]!.events += ' C4@0+1';
  if (change === 'pitch-class') after[0]!.events = after[0]!.events.replace('F4', 'F#4');
  if (change === 'spelling') after[0]!.events = after[0]!.events.replace('F4', 'E#4');
  if (change === 'sub-grid-time') after[0]!.events = after[0]!.events.replace('@2+', '@2.01+');
  if (change === 'duration') after[0]!.events = after[0]!.events.replace('F4@2+1', 'F4@2+0.5');
  if (change === 'dyn') after[0]!.dyn = 'p';
  if (change === 'role') after[0]!.role = 'harmony';
  if (change === 'art') after[0]!.art = '';
  if (change === 'unrelated-part') after[2]!.events = 'C4@0+3';
  if (change === 'unrelated-bar') after[3]!.events = 'B4@0+1.5 C5@1.5+1.5';
  if (change === 'grouping') { after.push({ ...after[0]!, events: 'F4@2+1' }); after[0]!.events = 'A3@0+1 G3@1+1'; }
  if (change === 'still-low') after[0]!.events = before[0]!.events;
  expect(() => assertNewNoteRangeRepair(before, after, repair)).toThrow(/Range repair/);
});
it('keeps a held continuation as the same held token and rejects an added attack', () => {
  const original = [{ ...before[0]!, events: 'F3@0+1 F3~@1+2' }], moved = [{ ...original[0]!, events: 'F4@0+1 F4~@1+2' }];
  expect(() => assertNewNoteRangeRepair(original, moved, repair)).not.toThrow();
  expect(() => assertNewNoteRangeRepair(original, [{ ...moved[0]!, events: 'F4@0+1 F4@1+2' }], repair)).toThrow();
});

it.each(['Trumpet 1', 'Violin I'])('exports identical notation and every MIDI byte for omitted/empty articulation on %s', part => {
  const xml = emptyScore('Local articulation proof', ['Trumpet 1', 'Violin I'], { fifths: 0, time: '3/4', qpm: 80, bars: 32 });
  const score = parseScore(xml), input = arrangeInput(score, score.parts[0]!, 0, 31, '', 0, null);
  const original: WriteAnswer['adds'] = [
    { part: 'Violin I', bar: '27', events: 'C5@0+3', dyn: 'p<mf', role: 'countermelody', art: 'pizz' },
    { part, bar: '28', events: 'C4@0+2 E3@2.5+0.5', dyn: 'mp', role: 'melody' },
  ];
  const empty = original.map((add, i) => i === 1 ? { ...add, art: '' } : { ...add });
  const checks = [original, empty].map(adds => checkOption({ name: 'Local proof', idea: 'Same notes', why: [], adds }, score, input));
  expect(checks[0]).toEqual(checks[1]);
  const written = checks.map(check => withOption(xml, score, check));
  expect(written[0]).toBe(written[1]);
  if (part === 'Violin I') expect(written[0]).toContain('arco');
  expect(scoreTracks(parseScore(written[0]!)).some(track => (track.controls?.length ?? 0) > 1)).toBe(true);
  const files = written.map((text, i) => unzipSync(packageFiles(text, checks[i]!, 'Same articulation proof')));
  const names = Object.keys(files[0]!).filter(name => name.endsWith('.mid')).sort();
  expect(names).toContain('all-parts.mid'); expect(names).toContain('new-parts.mid');
  expect(names.some(name => name.startsWith('parts/'))).toBe(true);
  for (const name of ['score.musicxml', ...names]) expect(files[1]![name], name).toEqual(files[0]![name]);
  expect(strFromU8(files[0]!['score.musicxml']!)).toBe(written[0]);
});

it.each([undefined, ''])('permits only omitted/empty art equivalence in a flagged entry, without mutating raw evidence (%s)', art => {
  const original: WriteAnswer['adds'] = [{ part: 'Trumpet 1', bar: '28', events: 'C4@0+2 E3@2.5+0.5', dyn: 'mp', role: 'melody', ...(art === undefined ? {} : { art }) }, { part: 'Cello', bar: '28', events: 'C3@0+3', dyn: 'p', role: 'bass' }];
  const moved = structuredClone(original); moved[0]!.events = 'C4@0+2 E4@2.5+0.5';
  if (art === undefined) moved[0]!.art = ''; else delete moved[0]!.art;
  const snapshots = structuredClone([original, moved]);
  expect(() => assertNewNoteRangeRepair(original, moved, { bar: '28', parts: ['Trumpet 1'], ask: 'Local proof' })).not.toThrow();
  expect([original, moved]).toEqual(snapshots);
});

it.each(['added-art', 'removed-art', 'emptied-art', 'whitespace-art', 'dyn', 'role', 'unrelated-art'] as const)('keeps the other raw expression gates strict: %s', change => {
  const original: WriteAnswer['adds'] = [{ part: 'Trumpet 1', bar: '28', events: 'E3@0+3' }, { part: 'Cello', bar: '28', events: 'C3@0+3' }];
  const moved = structuredClone(original); moved[0]!.events = 'E4@0+3';
  if (change === 'added-art') moved[0]!.art = 'pizz';
  if (change === 'removed-art' || change === 'emptied-art') { original[0]!.art = 'pizz'; if (change === 'emptied-art') moved[0]!.art = ''; }
  if (change === 'whitespace-art') moved[0]!.art = ' ';
  if (change === 'dyn') moved[0]!.dyn = '';
  if (change === 'role') moved[0]!.role = '';
  if (change === 'unrelated-art') moved[1]!.art = '';
  expect(() => assertNewNoteRangeRepair(original, moved, { bar: '28', parts: ['Trumpet 1'], ask: 'Local proof' })).toThrow(/Range repair/);
});
