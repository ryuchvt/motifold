// @vitest-environment jsdom
// Actual recorded source, layout, plans and previews. No provider request is allowed.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseScore } from '../score';
import { startDemo, stopDemo, type DemoPiece } from './demo';
import { useArrange, type Arranged } from './useArrange';
import { withDoubles } from './arrange';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8');
const score = parseScore(xmlText), loaded = { fileName: 'sample-sketch.musicxml', xmlText, score };
const shared = JSON.parse(readFileSync('public/demo/sample-sketch/shared.json', 'utf8'));
const run = JSON.parse(readFileSync('public/demo/sample-sketch/arrange-neutral.json', 'utf8'));
const piece: DemoPiece = { id: 'sample-sketch', name: 'Sample sketch', words: 'A real recorded source.', midi: '/demo/sample-sketch/Sample_sketch.mid', xml: '/demo/sample-sketch/sample-sketch.musicxml', recipe: { intent: 'arrange', ensemble: 'String orchestra', moreBars: 0, where: 'inside', useMelodyOnly: false }, guide: ['Use the exact recorded choices.'], runs: [{ key: 'arrange-neutral', mode: 'arrange', mood: '' }] };
let unmount = () => {};
afterEach(() => { act(unmount); stopDemo(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reaches the real neutral layout, plans and distinct A/B previews through the exact guided input, with the API blocked', async () => {
  vi.useFakeTimers();
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url === '/demo/sample-sketch/shared.json') return Response.json(shared);
    if (url === '/demo/sample-sketch/arrange-neutral.json') return Response.json(run);
    throw Error(`No provider request is allowed: ${url}`);
  });
  startDemo(piece, '2026-11-04');
  let current!: Arranged;
  function Host() { current = useArrange(loaded, score.parts[0]!, { from: 0, to: 23 }, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div'))); unmount = () => root.unmount();
  await act(async () => root.render(<Host/>));
  async function finish(start: () => Promise<unknown>) {
    let pending!: Promise<unknown>;
    act(() => { pending = start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await pending; });
  }
  await finish(() => current.askPiece());
  expect(current.piece.status).toBe('ready');
  expect(current.study.status).toBe('ready');
  act(() => current.confirmTracks());
  const layout = run.find((c: any) => c.shape === 'distribute');
  await finish(() => current.askPlaced(layout.input.instruments, '', false, 'arrange'));
  expect(current.placed).toMatchObject({ status: 'ready', check: { notes: 114, placed: 114, notPlaced: [] } });
  await finish(() => current.askOptions('', 0, 'inside', 'arrange'));
  expect(current.options.status).toBe('ready');
  if (current.options.status !== 'ready') throw Error('No recorded plans');
  expect(current.options.plans.map(p => p.name)).toEqual(['Held middle voices with repeat contrast', 'Pulsed support with brief answers']);
  await finish(() => Promise.all([current.askPreview(0), current.askPreview(1)]));
  if (current.options.status !== 'ready') throw Error('No recorded options');
  for (const index of [0, 1]) {
    const notes = current.options.notes[index];
    const receipt = run.find((c: any) => c.shape === 'arrange' && c.input.chosen.name === ['Held middle voices with repeat contrast', 'Pulsed support with brief answers'][index] && c.input.window.from === '1');
    expect(notes).toMatchObject({ status: 'ready', preview: true });
    if (notes?.status !== 'ready') throw Error('Missing recorded preview');
    expect(notes.adds).toEqual(withDoubles(receipt.reply.answer, current.options.input.written.map(w => w.bar)));
    expect(notes.check).toMatchObject({ notes: index === 0 ? 8 : 24, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [] });
  }
  expect(fetched).toEqual(['/demo/sample-sketch/shared.json', '/demo/sample-sketch/arrange-neutral.json']);
});
