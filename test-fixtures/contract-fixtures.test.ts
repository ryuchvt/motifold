// The saved local responses must describe this generated score, not a different input.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseScore } from '../score';
import { arrangeInput, checkOption, pieceInput, placeNotes, scoreOfParts } from '../app/arrange';
import { wholeScoreInput, wholeScoreParts } from '../app/scoreInput';
import { distribute, planOptions, readPiece } from '../server/shapes';
import saved from './contract-arrangement.json';

const xml = readFileSync('test-fixtures/contract-score.musicxml', 'utf8');
const score = parseScore(xml);
const last = score.parts[0]!.measures.length - 1;
const input = pieceInput(score, score.parts[0]!, 0, last);
const placed = placeNotes(score, input, saved.distribute.answer, saved.distribute.input.instruments);
const placedScore = parseScore(scoreOfParts(score, input, placed.parts));
const plan = arrangeInput(placedScore, placedScore.parts[0]!, 0, last, null, 0, null, { instruments: saved.distribute.input.instruments, where: 'inside' });

it('keeps synthetic saved responses faithful to the current input and placement', () => {
  expect(saved.provenance.kind).toBe('synthetic');
  expect(input).toEqual(saved.read.input);
  expect(input.written).toEqual(saved.distribute.input.written);
  expect(plan).toEqual(saved.plan.input);
  for (const [shape, asked, answer] of [[readPiece, input, saved.read.answer], [distribute, saved.distribute.input, saved.distribute.answer], [planOptions, plan, saved.plan.answer]] as const) {
    const parsed = shape.parse(asked);
    expect(parsed, shape.name).not.toBeNull();
    expect(shape.check(parsed! as never, answer), shape.name).toBeNull();
  }
});

it('retains every new answer note after placement, including Flute in the second option', () => {
  expect(saved.notes[1]!.adds.some(a => a.part === 'Flute')).toBe(true);
  saved.notes.forEach((answer, index) => {
    const check = checkOption({ ...saved.plan.answer.options[index]!, ...answer }, placedScore, plan);
    expect(check.notes).toBe(answer.adds.length * 2);
    expect(check).toMatchObject({ overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [] });
  });
});

it('still reaches the whole-score size fallback without making the solo input too large', () => {
  const repeated = xml.replace(/(<part id="[^"]+">)([\s\S]*?)(<\/part>)/g, (_all, open: string, body: string, close: string) => {
    let number = 0;
    return open + Array.from({ length: 9 }, () => body.replace(/<measure number="[^"]+"/g, () => `<measure number="${++number}"`)).join('') + close;
  });
  const large = parseScore(repeated);
  expect(large.parts[0]!.measures).toHaveLength(216);
  expect(wholeScoreParts(large)).not.toBeNull();
  expect(wholeScoreInput(large, 0, 215)).toBeNull();
  const solo = pieceInput(large, large.parts[0]!, 0, 215);
  expect(solo.lines).toEqual(['Violoncello']);
  expect(readPiece.parse(solo)).not.toBeNull();
  expect(JSON.stringify(solo).length).toBeLessThan(60 * 1024);
});
