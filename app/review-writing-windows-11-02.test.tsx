// @vitest-environment jsdom
// Original synthetic score and actual parsed cache keys. All network responses are local.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseScore } from '../score';
import { sha256, stableJson } from '../server/call';
import { MODEL } from '../server/spark';
import { arrange, type ArrangeInput, type WriteAnswer, type WriteInput } from '../server/shapes';
import { writingWindows } from './arrange';
import { attacksOf, playedFromMidi, readWithinBars } from './timing';
import { scoreOfReading } from './timingScore';
import { useArrange, type Arranged } from './useArrange';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync('test-fixtures/contract-score.musicxml', 'utf8');
const score = parseScore(xmlText);
const loaded = { fileName: 'contract-score.musicxml', xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync('test-fixtures/contract-arrangement.json', 'utf8'));
const reply = (status: string, extra: object = {}) => new Response(JSON.stringify({ status, ...extra }));
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function setup(reason: 'timeout' | 'empty') {
  const cache = new Map<string, WriteAnswer>();
  const uncached: { input: WriteInput; answer: WriteAnswer }[] = [];
  let windows: { from: string; to: string }[] = [];
  let failed = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const raw = JSON.parse(init.body as string).input;
    if (url.endsWith('read_piece')) return reply('ok', { answer: saved.read.answer });
    if (url.endsWith('plan_options')) {
      const input = raw as ArrangeInput;
      const bars = input.written.map((w) => w.bar);
      const chosen = { name: 'One line', idea: 'A flute answers the cello', why: [{ from: bars[0]!, to: bars[bars.length - 1]!, what: 'Flute answers', principle: 'Motion around the tune' }] };
      windows = writingWindows(chosen.why, bars);
      return reply('ok', { answer: { options: [chosen] } });
    }
    if (!url.endsWith('arrange')) throw new Error('Unexpected request');
    const input = arrange.parse(raw) as WriteInput;
    expect(input).not.toBeNull();
    const hash = await sha256(stableJson({ shape: arrange.name, version: arrange.version, model: MODEL, input }));
    const hit = cache.get(hash);
    if (hit) return reply('ok', { answer: hit, cached: true });
    if (input.window!.from === windows[1]!.from && !failed) {
      failed = true;
      return reply('fallback', { reason });
    }
    const answer = { adds: [{ part: 'Flute', bar: input.window!.to, events: input.earlier ? 'G5@0+1' : 'C5@0+1', dyn: 'mf' }], doubles: [] };
    uncached.push({ input, answer });
    cache.set(hash, answer);
    return reply('ok', { answer, cached: false });
  });
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return null; }
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { get now() { return current; }, get windows() { return windows; }, uncached };
}

it('preserves already completed later sections when writing the missing middle section', async () => {
  const screen = setup('timeout');
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions('', 0, 'inside'));
  expect(screen.windows.length).toBe(3);
  await act(() => screen.now.askNotes(0));
  const before = screen.now.options;
  expect(before.status).toBe('ready');
  if (before.status !== 'ready' || before.notes[0]!.status !== 'ready') throw new Error('No partial result');
  expect(before.notes[0]!.missing).toEqual([screen.windows[1]]);
  const lastBefore = before.notes[0]!.adds.find((a) => a.bar === screen.windows[2]!.to);
  expect(lastBefore).toBeTruthy();
  await act(() => screen.now.askNotes(0));
  const after = screen.now.options;
  if (after.status !== 'ready' || after.notes[0]!.status !== 'ready') throw new Error('No retry result');
  expect.soft(screen.uncached.filter((p) => p.input.window!.from === screen.windows[2]!.from), 'A completed later window must not become a second uncached request through Write what is missing').toHaveLength(1);
  expect(after.notes[0]!.adds.find((a) => a.bar === screen.windows[2]!.to), 'A missing-section retry must retain already finished later notes').toEqual(lastBefore);
});

it('marks every unfinished section when the pool stops writing after the first section', async () => {
  const screen = setup('empty');
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(() => screen.now.askNotes(0));
  const options = screen.now.options;
  if (options.status !== 'ready' || options.notes[0]!.status !== 'ready') throw new Error('No partial result');
  expect(options.notes[0]!.missing, 'The last section was never requested, but is also unfinished').toEqual(screen.windows.slice(1));
});


it('still reaches checked notes through the entire saved theme with no API key', async () => {
  const savedTheme = JSON.parse(readFileSync('test-fixtures/sample-sketch-arrangement.json', 'utf8'));
  const savedBars = JSON.parse(readFileSync('test-fixtures/sample-sketch-bars.json', 'utf8'));
  const played = playedFromMidi(new Uint8Array(readFileSync('test-fixtures/Sample_sketch.mid')));
  const attacks = attacksOf(played);
  const reading = readWithinBars(attacks, savedBars.answer.meter, savedBars.answer.starts);
  const themeXml = scoreOfReading(played, attacks, reading, 'Sample sketch');
  const themeScore = parseScore(themeXml);
  const themePart = themeScore.parts[0]!;
  const themePage = { fileName: 'theme.mid', xmlText: themeXml, score: themeScore };
  const themeRange = { from: 0, to: themePart.measures.length - 1 };
  vi.stubGlobal('fetch', async (url: string) => url === '/saved-theme.json'
    ? new Response(JSON.stringify(savedTheme))
    : reply('fallback', { reason: 'empty' }));
  let current!: Arranged;
  function Host() { current = useArrange(themePage, themePart, themeRange, '/saved-theme.json'); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  await act(() => current.askPiece());
  expect(current.piece).toMatchObject({ status: 'ready', saved: true });
  await act(() => current.askPlaced(savedTheme.distribute.input.instruments, ''));
  expect(current.placed).toMatchObject({ status: 'ready', saved: true });
  await act(() => current.askOptions('', 8, 'both'));
  expect(current.options).toMatchObject({ status: 'ready', saved: true });
  await act(() => current.askNotes(0));
  if (current.options.status !== 'ready' || current.options.notes[0]!.status !== 'ready') throw new Error('No saved notes');
  expect(current.options.notes[0]!.adds).toEqual(savedTheme.notes[0].adds);
  expect(current.options.notes[0]!.check.notes).toBeGreaterThan(0);
});

it('keeps what it has when going back for the missing section fails again', async () => {
  const screen = setup('timeout');
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(() => screen.now.askNotes(0));
  const before = screen.now.options;
  if (before.status !== 'ready' || before.notes[0]!.status !== 'ready') throw new Error('No partial result');
  vi.stubGlobal('fetch', async () => reply('fallback', { reason: 'empty' }));
  await act(() => screen.now.askNotes(0));
  const after = screen.now.options;
  if (after.status !== 'ready' || after.notes[0]!.status !== 'ready') throw new Error('Lost the partial result');
  expect(after.notes[0]!.adds).toEqual(before.notes[0]!.adds);
  expect(after.notes[0]!.missing).toEqual([screen.windows[1]]);
});

it('fills in the middle section between the finished ones, in bar order, with the end of the section before it', async () => {
  const screen = setup('timeout');
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(() => screen.now.askNotes(0));
  await act(() => screen.now.askNotes(0));
  const after = screen.now.options;
  if (after.status !== 'ready' || after.notes[0]!.status !== 'ready') throw new Error('No retry result');
  expect(after.notes[0]!.missing).toBeUndefined();
  expect(after.notes[0]!.adds.map((a) => a.bar)).toEqual(screen.windows.map((w) => w.to));
  expect(screen.uncached.filter((p) => p.input.window!.from === screen.windows[1]!.from)[0]!.input.earlier).toBeTruthy();
});

it('a recomposition goes back for its missing section with its motif and tune still in hand', async () => {
  const seeds: (WriteInput['seed'] | undefined)[] = [];
  let failed = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const raw = JSON.parse(init.body as string).input;
    if (url.endsWith('plan_recompose')) return reply('ok', { answer: { options: [{ name: 'New', idea: 'Grows from the opening', why: [{ from: '1', to: '8', what: 'First', principle: 'Grow' }, { from: '9', to: '16', what: 'Second', principle: 'Answer' }], motif: { from: '1', to: '1', what: 'The opening rises' }, fifths: 0, time: '4/4', qpm: 80 }] } });
    if (url.endsWith('write_theme')) return reply('ok', { answer: { lines: [{ bar: "1", role: "tune", events: "C5@0+1" }] } });
    if (!url.endsWith('arrange')) throw new Error('Unexpected request');
    const asked = raw as WriteInput;
    seeds.push(asked.seed);
    if (asked.window!.from === '9' && !failed) {
      failed = true;
      return reply('fallback', { reason: 'timeout' });
    }
    return reply('ok', { answer: { adds: [{ part: 'Flute', bar: asked.window!.to, events: 'C5@0+1', dyn: 'mf' }], doubles: [] }, cached: false });
  });
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  await act(() => current.askRecompose('', 16, ['Flute', 'Cello']));
  await act(() => current.writeRecomposed(0));
  const first = current.options;
  if (first.status !== 'ready' || first.notes[0]!.status !== 'ready') throw new Error('No partial result');
  expect(first.notes[0]!.missing).toEqual([{ from: '9', to: '16' }]);
  await act(() => current.askNotes(0));
  const after = current.options;
  if (after.status !== 'ready' || after.notes[0]!.status !== 'ready') throw new Error('No retry result');
  expect(after.notes[0]!.missing).toBeUndefined();
  expect(seeds).toHaveLength(3);
  expect(seeds[2]).toEqual(seeds[1]);
  expect(seeds[2]!.motif).toContain('The opening rises');
});
