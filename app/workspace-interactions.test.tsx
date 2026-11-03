// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseScore } from '../score';
import { Workspace, moveBlock } from './Workspace';
import { playhead } from './playhead';
import { setTransport } from './spark';
import { useArrange, type Arranged } from './useArrange';
const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('./audio/preview', async (original) => ({ ...(await original<typeof import('./audio/preview')>()), createPreview: () => audio }));
vi.mock('./audio/samples', () => ({ loadManifest: async () => null }));
vi.mock('./ScoreView', () => ({ ScoreView: ({ onTap }: any) => <button aria-label="A note in bar 3" onClick={() => onTap({ bar: { partId: 'P1', measureIndex: 2 } })}>Note</button> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync('test-fixtures/contract-score.musicxml', 'utf8');
const score = parseScore(xmlText);
const loaded = { fileName: 'contract-score.musicxml', xmlText, score };
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); setTransport(null); vi.unstubAllGlobals(); audio.play.mockReset(); audio.stop.mockReset(); });
async function setup() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const saved = JSON.parse(readFileSync('test-fixtures/contract-arrangement.json', 'utf8'));
  setTransport(async (shape, raw) => {
    const input = raw as any;
    const answer = shape === 'read_piece' ? { ...saved.read.answer, questions: [] } : shape === 'plan_options' ? saved.plan.answer : shape === 'arrange' ? { adds: [{ part: 'Flute', bar: input.window.from, events: 'C5@0+1', dyn: 'mf' }], doubles: [] } : null;
    return answer ? { status: 'ok', answer, cached: false } : { status: 'fallback', reason: 'not-prepared' as const };
  });
  let current!: Arranged;
  function Host() {
    current = useArrange(loaded, score.parts[0]!, { from: 0, to: score.parts[0]!.measures.length - 1 }, null);
    return <Workspace arranged={current} loaded={loaded} busy={false} demo={false} prepared={[]} sourceNote={null} onStage={() => {}}/>;
  }
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(<Host/>));
  await act(() => current.askPiece());
  return { host, get now() { return current; }, flush: () => act(() => { frames.splice(0).forEach((callback) => callback(0)); }) };
}
const click = async (host: Element, name: string) => {
  const button = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name);
  if (!button) throw Error(`Missing ${name}`);
  await act(async () => button.click());
};
it('notation selection opens a passage inspector without shrinking the score excerpt', async () => {
  const screen = await setup();
  const before = screen.now.view;
  await click(screen.host, 'A note in bar 3');
  expect(screen.now.view).toEqual(before);
  expect(screen.host.querySelector('.composer-inspector')?.textContent).toContain('Bar 3');
  expect(playhead.beat).toBe(screen.now.overview!.bars.find((b) => b.number === '3')!.start);
  await click(screen.host, 'Play from here');
  expect(audio.play.mock.calls.at(-1)?.[2]).toBe(playhead.beat);
});
it('A/B auditions keep the actual playback position and the visible passage', async () => {
  const screen = await setup();
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(async () => { await Promise.all([screen.now.askPreview(0), screen.now.askPreview(1)]); });
  await click(screen.host, 'Pick');
  act(() => { screen.now.selectRange('9', '10'); playhead.seek(34.5); playhead.play(); });
  // This is a position inside a bar, rather than the overview's selected start.
  act(() => audio.play.mock.calls.at(-1)![3](35.25));
  await click(screen.host, 'Audition plan B');
  screen.flush();
  expect(screen.now.trying).toEqual({ kind: 'option', index: 1 });
  expect(screen.now.view).toEqual({ from: '9', to: '10' });
  expect(audio.play.mock.calls.at(-1)?.[2]).toBe(35.25);
  expect(screen.host.querySelectorAll('.composer-inspector .arrange-list>li')).toHaveLength(1);
  expect(screen.host.querySelectorAll('.inspector-action button')).toHaveLength(1);
});
it('moving complete form blocks keeps every original block exactly once', () => {
  const blocks = [{ from: '1', to: '6' }, { from: '7', to: '7a' }, { from: '7b', to: '14' }];
  expect(moveBlock(blocks, 2, 0)).toEqual([blocks[2], blocks[0], blocks[1]]);
  expect(blocks[0]).toEqual({ from: '1', to: '6' });
  expect(moveBlock(blocks, -1, 0)).toBe(blocks);
});
it('cancelling a pending audition keeps late notes from replacing Original or starting playback', async () => {
  const screen = await setup();
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(() => screen.now.askPreview(1));
  let release!: () => void;
  setTransport(async () => { await new Promise<void>((resolve) => { release = resolve; }); return { status: 'ok', cached: false, answer: { adds: [{ part: 'Flute', bar: '1', events: 'C5@0+1', dyn: 'mf' }], doubles: [] } }; });
  let pending!: Promise<unknown>;
  act(() => { pending = screen.now.askPreview(0); });
  await click(screen.host, 'Pick');
  await click(screen.host, 'Audition plan A');
  await click(screen.host, 'Original');
  await act(async () => { release(); await pending; });
  screen.flush();
  expect(screen.now.trying).toBeNull();
  expect(audio.play).not.toHaveBeenCalled();
});
it('a form trial preserves all source notes and cancels back to the exact original', async () => {
  const screen = await setup();
  const original = screen.now.shown;
  await click(screen.host, 'A note in bar 3');
  await click(screen.host, 'Reorder sections');
  await click(screen.host, 'Move section 1 later');
  expect(screen.now.trying).toEqual({ kind: 'structure', index: -1 });
  expect(screen.host.querySelector('.inspector')).toBeNull();
  const count = (text: string) => parseScore(text).parts.map((part) => part.notes.filter((n) => !n.rest).length);
  expect(count(screen.now.shown!.xmlText)).toEqual(count(xmlText));
  await click(screen.host, 'Original order');
  expect(screen.now.shown).toBe(original);
});
