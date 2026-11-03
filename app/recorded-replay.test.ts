import { afterEach, expect, it, vi } from 'vitest';
import { askSpark, onSpark, type RecordedCall } from './spark';
import { recordedDemoIndex, recordedRequestKey, replay, skipReplay, startDemo, stopDemo, type DemoPiece } from './demo';

const piece: DemoPiece = {
  id: 'sample-sketch', name: 'Sample sketch', words: 'A recorded neutral arrangement.', midi: '/demo/sample-sketch/Sample_sketch.mid', xml: '/demo/sample-sketch/sample-sketch.musicxml',
  recipe: { intent: 'arrange', ensemble: 'String orchestra', moreBars: 0, where: 'inside', useMelodyOnly: false },
  guide: ['Confirm the recorded source tracks.', 'Choose Arrange, String orchestra and neutral.', 'Keep every source note and add no bars.', 'Only the recorded choice can finish.'],
  runs: [{ key: 'arrange-neutral', mode: 'arrange', mood: '' }],
};
const input = {
  piece: { title: 'Sample sketch', composer: null, instrument: 'Piano' }, fifths: 0, time: '3/4', written: [{ bar: '1', notes: 'C4', rhythm: '3' }, { bar: '2', notes: 'D4', rhythm: '3' }],
  returns: [], intent: 'arrange', where: 'inside', moreBars: 0, instruments: ['Violin I', 'Violin II', 'Viola', 'Cello', 'Double Bass'], ask: null, answers: [], tracks: [], cues: [], reading: null,
  chosen: { name: 'A', idea: 'A supporting line', why: [{ from: '1', to: '2', what: 'Cello answers', principle: 'Support the theme' }] }, window: { from: '1', to: '2' },
};
const receipt = (asked: unknown, note = 'C3', change: Partial<RecordedCall> = {}): RecordedCall => ({ shape: 'arrange', input: asked, reply: { status: 'ok', answer: { adds: [{ part: 'Cello', bar: '1', events: `${note}@0+1` }], doubles: [] }, cached: false }, ms: 0, thinking: [], version: 'arrange-14', model: 'local-test', ...change });
function recordings(calls: RecordedCall[], shared: RecordedCall[] = []) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/demo/sample-sketch/shared.json') return Response.json(shared);
    if (url === '/demo/sample-sketch/arrange-neutral.json') return Response.json(calls);
    throw Error(`Unprepared network request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  startDemo(piece, '2026-11-04T00:00:00Z');
  return fetcher;
}
afterEach(() => { stopDemo(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('plays genuine A and B receipts distinctly even when their windows start at the same bar', async () => {
  const b = { ...input, chosen: { ...input.chosen, name: 'B' } };
  const aReply = receipt(input, 'C3'), bReply = receipt(b, 'D3');
  const fetcher = recordings([aReply, bReply]);
  expect(await askSpark('arrange', input)).toEqual(aReply.reply);
  expect(await askSpark('arrange', b)).toEqual(bReply.reply);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/demo/sample-sketch/shared.json', '/demo/sample-sketch/arrange-neutral.json']);
});

it('refuses meaningful edits without an API fallback, including same-start windows and different source notes', async () => {
  const fetcher = recordings([receipt(input)]);
  const edits = [
    { ...input, intent: 'expand' }, { ...input, instruments: ['Flute'] }, { ...input, window: { from: '1', to: '1' } },
    { ...input, chosen: { ...input.chosen, name: 'B' } }, { ...input, written: [{ bar: '1', notes: 'Eb4', rhythm: '3' }, input.written[1]] },
    { ...input, answers: [{ ask: 'Who leads?', answer: 'Cello' }] }, { ...input, earlier: 'Viola: E4@0+3' }, { ...input, fix: { ask: 'Thinner', current: 'Cello: C3@0+1' } },
  ];
  for (const changed of edits) expect(await askSpark('arrange', changed)).toEqual({ status: 'fallback', reason: 'not-prepared' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('compares wire JSON values rather than property insertion order, and returns a fresh answer each time', async () => {
  recordings([receipt(input)]);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  expect(recordedRequestKey('arrange', reordered)).toBe(recordedRequestKey('arrange', input));
  const first = await askSpark('arrange', reordered);
  if (first.status !== 'ok') throw Error('Missing saved reply');
  (first.answer as any).adds[0].events = 'Changed';
  expect(await askSpark('arrange', input)).toEqual(receipt(input).reply);
});

it('uses a successful cold-retry receipt and refuses ambiguous takes or missing provenance', async () => {
  const good = receipt(input);
  recordings([receipt(input, 'C3', { reply: { status: 'fallback', reason: 'unreachable' } }), good]);
  expect(await askSpark('arrange', input)).toEqual(good.reply);
  recordings([good, receipt(input, 'F3')]);
  expect(await askSpark('arrange', input)).toEqual({ status: 'fallback', reason: 'not-prepared' });
  recordings([receipt(input, 'C3', { version: undefined })]);
  expect(await askSpark('arrange', input)).toEqual({ status: 'fallback', reason: 'not-prepared' });
});

it('cancels pending thinking and replies when the recording is left', async () => {
  vi.useFakeTimers();
  const lines: string[] = [];
  recordings([receipt(input, 'C3', { ms: 1000, thinking: [{ at: 500, text: 'A recorded line.' }] })]);
  const off = onSpark(event => { if (event.kind === 'thinking') lines.push(event.text); });
  try {
    const pending = askSpark('arrange', input);
    await vi.advanceTimersByTimeAsync(100);
    stopDemo();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ status: 'fallback', reason: 'stale' });
    expect(lines).toEqual([]);
    expect(replay.enabled).toBe(false);
    expect(replay.active).toBe(false);
  } finally { off(); }
});

it('can skip a long recorded wait without changing its real elapsed time or answer', async () => {
  vi.useFakeTimers();
  const saved = receipt(input, 'C3', { ms: 90_000, thinking: [{ at: 45_000, text: 'A real captured summary.' }] });
  recordings([saved]);
  const pending = askSpark('arrange', input);
  await vi.advanceTimersByTimeAsync(1);
  expect(replay.realMs).toBe(90_000);
  skipReplay();
  await vi.advanceTimersByTimeAsync(60);
  expect(await pending).toEqual(saved.reply);
  expect(replay.realMs).toBe(90_000);
  expect(replay.active).toBe(false);
});

it('opens the replay door only for the narrow prepared recipe with actual guidance', () => {
  const index = { recorded: '2026-11-04T00:00:00Z', pieces: [piece] };
  expect(recordedDemoIndex(index)).toEqual(index);
  expect(recordedDemoIndex({ ...index, pieces: [] })).toBeNull();
  expect(recordedDemoIndex({ ...index, recorded: '' })).toBeNull();
  expect(recordedDemoIndex({ ...index, pieces: [{ ...piece, guide: [] }] })).toBeNull();
  expect(recordedDemoIndex({ ...index, pieces: [{ ...piece, recipe: { ...piece.recipe, intent: 'expand' } }] })).toBeNull();
});
