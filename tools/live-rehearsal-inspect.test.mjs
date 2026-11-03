import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { parseScore } from '../score/index.ts';
import { sketchPreview } from '../app/sampleSketch.ts';
import { midiFile, packageFiles, scoreTracks } from '../app/arrange.ts';
import { readMidi } from '../app/midi.ts';
import { inspectArchive } from './live-rehearsal-inspect.mjs';
const readers = { parseScore, scoreTracks, readMidi };

it('checks the actual selected Sample sketch ZIP as a full 24-bar score with matching MIDI', async () => {
  const source = await sketchPreview(new Uint8Array(readFileSync('test-fixtures/Sample_sketch.mid')));
  const report = inspectArchive(packageFiles(source.xmlText, null, 'Local export check'), readers, 24);
  expect(report.scoreAndMidiAgree).toBe(true);
  expect(report.parts.every((part) => part.bars === 24)).toBe(true);
  expect(report.notes).toBeGreaterThan(100);
  expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
});

it('refuses a truncated expected score or a MIDI that differs from its accompanying score', async () => {
  const source = await sketchPreview(new Uint8Array(readFileSync('test-fixtures/Sample_sketch.mid')));
  const archive = packageFiles(source.xmlText, null, 'Local export check');
  expect(() => inspectArchive(archive, readers, 25)).toThrow('expected full score');
  const files = unzipSync(archive);
  files['all-parts.mid'] = midiFile([{ name: 'Different', program: 0, notes: [{ start: 0, length: 1, height: 60 }] }], 90, { beats: 3, beatType: 4 });
  expect(() => inspectArchive(zipSync(files), readers, 24)).toThrow('disagree');
});
