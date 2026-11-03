import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { parseScore } from '../score/index.ts';
import * as arrange from '../app/arrange.ts';
import * as timing from '../app/timing.ts';
import { readMidi } from '../app/midi.ts';
import { buildPerformanceSources } from './performance-source.mjs';

const original = new Uint8Array(readFileSync('test-fixtures/Sample_sketch.mid'));
const sourceXml = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8');
const savedBars = JSON.parse(readFileSync('test-fixtures/sample-sketch-bars.json', 'utf8'));
const readers = { parseScore, ...arrange, ...timing, readMidi };

it('packages the actual three distinct source files without altering the original or inventing notes', () => {
  const result = buildPerformanceSources({ original, sourceXml, savedBars, readers });
  expect(result.files['original-performance-117.mid']).toEqual(original);
  expect(createHash('sha256').update(result.files['original-performance-117.mid']).digest('hex')).toBe('782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54');
  const played = timing.playedFromMidi(original), attacks = timing.attacksOf(played), reading = timing.readWithinBars(attacks, savedBars.answer.meter, savedBars.answer.starts);
  expect(result.files['performance-tempo-map-117.mid']).toEqual(timing.mappedMidi(played, attacks, reading));
  expect(readMidi(result.files['performance-tempo-map-117.mid']).tracks.flatMap(track => track.notes)).toHaveLength(117);
  expect(readMidi(result.files['accepted-score-114.mid']).tracks.flatMap(track => track.notes)).toHaveLength(114);
  expect(result.manifest.files.map(file => file.file)).toEqual(['original-performance-117.mid', 'performance-tempo-map-117.mid', 'accepted-score-114.mid']);
  expect(result.manifest.files[1].label).toContain('rubato, velocities and note-offs within MIDI tick rounding');
  expect(result.manifest.files[2].label).toContain('Nearby attacks are grouped and note durations are interpreted');
});

it('keeps all117 real fixture onsets and note-offs within2ms after aligning the first musical note, through50 tempo anchors', () => {
  const result = buildPerformanceSources({ original, sourceXml, savedBars, readers });
  // Independently turn each MIDI back to seconds through the app's MIDI reader, not the pack's comparison helper.
  const before = timing.playedFromMidi(original).notes, after = timing.playedFromMidi(result.files['performance-tempo-map-117.mid']).notes;
  const beforeFirst = before[0].at, afterFirst = after[0].at;
  let maxOnset = 0, maxDuration = 0;
  for (const pitch of new Set(before.map(note => note.height))) {
    const a = before.filter(note => note.height === pitch), b = after.filter(note => note.height === pitch);
    expect(a).toHaveLength(b.length);
    for (let k = 0; k < a.length; k++) {
      expect(b[k].velocity).toBe(a[k].velocity);
      maxOnset = Math.max(maxOnset, Math.abs((a[k].at - beforeFirst) - (b[k].at - afterFirst)));
      maxDuration = Math.max(maxDuration, Math.abs((a[k].end - a[k].at) - (b[k].end - b[k].at)));
    }
  }
  expect(maxOnset).toBeLessThan(.002); expect(maxDuration).toBeLessThan(.002);
  const mapped = readMidi(result.files['performance-tempo-map-117.mid']);
  expect(mapped.tempos).toHaveLength(50); expect(mapped.times).toEqual([{ tick: 0, beats: 3, beatType: 4 }]);
  expect(afterFirst).toBe(0);
  expect(result.manifest.normalization.originalDawLeadSeconds).toBe(2698);
  expect(result.manifest.normalization.originalInitialNoteLeadSeconds).toBeCloseTo(1 / 48, 8);
  expect(result.manifest.normalization.removedBeforeFirstNoteSeconds).toBeCloseTo(2698 + 1 / 48, 8);
});
