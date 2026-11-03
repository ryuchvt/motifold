import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { SAMPLE_FILE, SAMPLE_SHA256, sketchPreview } from './sampleSketch';
import { playedFromMidi } from './timing';
import { initialSetup, previewTransport } from './uiPreview';
import saved from '../test-fixtures/sample-sketch-arrangement.json';
import { checkOption, pieceInput, placeNotes, scoreOfParts, type ArrangeOption } from './arrange';
import { parseScore } from '../score';
import type { ArrangeInput, DistributeAnswer } from '../server/shapes';
import preview from '../test-fixtures/sample-sketch-preview.json';
import study from '../test-fixtures/sample-sketch-study.json';

const bytes = new Uint8Array(readFileSync(`test-fixtures/${SAMPLE_FILE}`));
it('opens the exact selected piano performance using its saved 24-bar reading', async () => {
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(SAMPLE_SHA256);
  expect(playedFromMidi(bytes).notes).toHaveLength(117);
  const preview = await sketchPreview(bytes);
  expect(preview.fileName).toBe('Sample_sketch.mid');
  expect(preview.score.title).toBe('Sample sketch');
  expect(preview.score.parts.map((p) => p.name)).toEqual(['Piano upper', 'Piano lower']);
  expect(preview.score.parts.every((p) => p.measures.length === 24)).toBe(true);
  expect(preview.score.parts[0]!.measures[0]!.time).toEqual({ beats: 3, beatType: 4 });
  expect(pieceInput(preview.score, preview.score.parts[0]!, 0, 23).written).toEqual(saved.read.input.written);
});
it('rejects a different MIDI instead of applying this performance’s saved answers to it', async () => {
  const changed = bytes.slice();
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await expect(sketchPreview(changed)).rejects.toThrow('does not match its saved answers');
});
it('shows the real recorded chords for this exact source in the local preview', async () => {
  const source = await sketchPreview(bytes);
  const input = pieceInput(source.score, source.score.parts[0]!, 0, 23);
  expect(input.written).toEqual(study.input.written);
  expect(study.reply.cached).toBe(false);
  expect(study.model).toBe('muse-spark-1.3');
  expect(study.reply.answer.harmony).toHaveLength(24);
  expect(await previewTransport('study_score', input, () => {})).toEqual({ status: 'ok', cached: true, answer: study.reply.answer });
  expect(await previewTransport('study_score', { ...input, written: input.written.slice(1) }, () => {})).toEqual({ status: 'fallback', reason: 'not-prepared' });
});
it('uses the same piano theme’s saved arrangement names without a provider request', async () => {
  const reply = await previewTransport('plan_options', {}, () => {});
  expect(initialSetup).toEqual({ ensemble: 'Full orchestra', mood: 'Hopeful', moreBars: 16, intent: 'expand', useMelodyOnly: true });
  expect(reply.status).toBe('ok');
  if (reply.status !== 'ok') return;
  const answer = reply.answer as { options: { name: string }[] };
  expect(answer.options.map((p) => p.name)).toEqual(['Rising Hymn', 'Lament in A minor']);
});

it('keeps both complete saved mood runs on the exact reconstructed orchestral source', async () => {
  const source = await sketchPreview(bytes);
  const input = pieceInput(source.score, source.score.parts[0]!, 0, 23);
  expect(input.written).toEqual(preview.distribute.input.written);
  const placed = placeNotes(source.score, input, preview.distribute.answer as DistributeAnswer, preview.distribute.input.instruments, true);
  const score = parseScore(scoreOfParts(source.score, input, placed.parts));
  expect(pieceInput(score, score.parts[0]!, 0, 23).written).toEqual(preview.plan.input.written);
  for (let index = 0; index < 2; index++) {
    const notes = preview.notes[index]!;
    expect(new Set(notes.adds.map((add) => add.bar)).size).toBe(40);
    const checked = checkOption({ ...preview.plan.answer.options[index]!, adds: notes.adds } as ArrangeOption, score, preview.plan.input as ArrangeInput);
    expect([checked.overBars, checked.unreadable, checked.pastBarEnd]).toEqual([0, 0, 0]);
    expect(checked.notes).toBe([483, 472][index]);
    expect(checked.outOfRange.length).toBe(index === 0 ? 0 : 5);
  }
});
