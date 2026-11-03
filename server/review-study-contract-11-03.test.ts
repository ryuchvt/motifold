// The original synthetic score and the Study contract. No model call or musical-quality verdict.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseScore } from '../score';
import { pieceInput } from '../app/arrange';
import { studyScore, readPiece, type StudyScoreAnswer } from './shapes';
import { reservationMicros } from './prices';
import { POOLS } from './pools';
const score = parseScore(readFileSync('test-fixtures/contract-score.musicxml', 'utf8'));
const input = pieceInput(score, score.parts[0]!, 0, score.parts[0]!.measures.length - 1);
const bars = input.written.map((w) => w.bar);
const answer: StudyScoreAnswer = {
  overview: 'A line and accompaniment.',
  sections: [{ from: bars[0]!, to: bars.at(-1)!, form: 'A', name: 'Opening', mood: 'searching', what: 'A phrase returns' }],
  harmony: [{ from: bars[0]!, to: bars.at(-1)!, note: 1, chord: '?', numeral: '?' }], moments: [],
};

it('accepts the same bounded score input as the reading and sends note identities through the Study-only contract', () => {
  expect(studyScore.parse(input)).toEqual(readPiece.parse(input));
  const parsed = studyScore.parse(input)!;
  const body = studyScore.build(parsed);
  expect(body.input).toContain(`Bar ${bars[0]}:`);
  expect(body.instructions).toContain('before anything is added');
  expect(body.input).toContain('~@');
});

it('does not resurrect practice-plan or performance fields in the composer Study response schema', () => {
  const body = studyScore.build(studyScore.parse(input)!);
  expect(Object.keys((body.schema as { properties: object }).properties).sort()).toEqual(['harmony', 'moments', 'overview', 'sections']);
  expect(studyScore.check(input, answer)).toBeNull();
  const lastNote = input.written[0]!.notes.split(' ').filter(Boolean).length;
  expect(studyScore.check(input, { ...answer, moments: [{ bar: bars[0], toBar: bars[0], note: lastNote + 1, toNote: lastNote + 1, kind: 'cadence', what: 'The phrase arrives' }] })).toBe('a moment points at notes that aren\'t there');
  expect(studyScore.check(input, { ...answer, harmony: [{ from: 'outside', to: 'outside', note: 1, chord: '?', numeral: '?' }] })).toBe('the harmony points at bars out of order or that don\'t exist');
});

it('meters the extra Study against the existing public cap with two visits and its own full reservation', () => {
  expect(POOLS.find((p) => p.id === 'public')!.perVisitor.study_score).toBe(2);
  expect(reservationMicros(studyScore.maxOutputTokens)).toBe(1_480_720);
  expect(reservationMicros(studyScore.maxOutputTokens) + reservationMicros(readPiece.maxOutputTokens)).toBe(2_918_940);
  expect(new TextEncoder().encode(JSON.stringify({ attemptId: '00000000-0000-0000-0000-000000000001', input })).byteLength).toBeLessThan(64 * 1024);
});
