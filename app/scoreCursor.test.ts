import { expect, it } from 'vitest';
import { parseScore } from '../score';
import { scoreCursor } from './scoreCursor';
const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure number="9"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration></note></measure></part></score-partwise>';
it('maps global heard time into excerpt note identities, clearing rests and pauses', () => {
  const at = scoreCursor(parseScore(xml), [{ number: '9', start: 32, length: 4 }]);
  expect(at(32.5)).toMatchObject({ key: 'P1:0:0', nextKey: 'P1:0:2', frac: .25 });
  expect(at(33.5)).toBeNull();
  expect(at(34)).toMatchObject({ key: 'P1:0:2' });
  expect(at(31)).toBeNull();
  expect(at(null)).toBeNull();
  expect(at(36)).toBeNull();
});
it('draws no cursor when repeated printed numbers cannot locate the music safely', () => {
  const at = scoreCursor(parseScore(xml), [{ number: '9', start: 0, length: 4 }, { number: '9', start: 32, length: 4 }]);
  expect(at(32)).toBeNull();
});
it('keeps a sounding long voice visible after a shorter overlapping voice ends', () => {
  const score = parseScore(xml.replace('<duration>1</duration></note><note><rest/>', '<duration>4</duration></note><backup><duration>4</duration></backup><note><rest/>'));
  const at = scoreCursor(score, [{ number: '9', start: 32, length: 4 }]);
  // The first note holds for four beats while the second voice rests then enters.
  expect(at(35.5)).toMatchObject({ key: "P1:0:0" });
});
