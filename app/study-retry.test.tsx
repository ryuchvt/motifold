// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { parseScore } from '../score';
import { setTransport } from './spark';
import { useArrange, type Arranged } from './useArrange';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup = () => {};
afterEach(() => { act(cleanup); document.body.replaceChildren(); setTransport(null); });
it('retries harmony independently without repeating the reading or discarding the composer’s answers', async () => {
  const xmlText = '<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
  const score = parseScore(xmlText), loaded = { fileName: 'local.musicxml', score, xmlText };
  const calls: string[] = []; let studies = 0;
  setTransport(async (shape) => {
    calls.push(shape);
    if (shape === 'read_piece') return { status: 'ok', cached: false, answer: { summary: 'A source phrase', tracks: [], sections: [], questions: [], roles: [], missing: [], thin: [], structures: [] } };
    if (++studies === 1) return { status: 'fallback', reason: 'unreachable' };
    return { status: 'ok', cached: false, answer: { overview: 'A source phrase', sections: [], harmony: [{ from: '1', to: '1', note: 1, chord: 'C', numeral: 'I' }], moments: [] } };
  });
  let now!: Arranged;
  function Host() { now = useArrange(loaded, score.parts[0]!, { from: 0, to: 0 }, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div'))); cleanup = () => root.unmount();
  await act(async () => root.render(<Host/>));
  await act(() => now.askPiece());
  expect(now.study.status).toBe('unavailable');
  act(() => { now.confirmTracks(); now.answer(0, 'Keep the phrase'); });
  await act(() => now.askStudy());
  expect(calls.filter((shape) => shape === 'read_piece')).toHaveLength(1);
  expect(calls.filter((shape) => shape === 'study_score')).toHaveLength(2);
  expect(now.tracksConfirmed).toBe(true);
  expect(now.answered[0]).toBe('Keep the phrase');
  expect(now.study.status).toBe('ready');
});
