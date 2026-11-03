// @vitest-environment jsdom
// Feature acceptance on actual components/hooks. Every answer, key and audio controller is local/fake.
import { readFileSync } from 'node:fs';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseScore } from '../score';
import { scoreTracks } from './arrange';
import { readMidi } from './midi';
import { ArrangePanel } from './ArrangePanel';
import { PieceView } from './PieceView';
import { Studio } from './Studio';
import { playhead } from './playhead';
import { setOwnKey, setTransport } from './spark';
import { useArrange, type Arranged } from './useArrange';
import type { Selection } from './selection';
const audio = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }));
vi.mock('./audio/preview', async (original) => ({ ...(await original<typeof import('./audio/preview')>()), createPreview: () => audio }));
vi.mock('./audio/samples', async (original) => ({ ...(await original<typeof import('./audio/samples')>()), loadManifest: async () => null }));
vi.mock('./ScoreView', () => ({ ScoreView: ({ xmlText }: { xmlText: string }) => <pre className="qa-score">{xmlText}</pre> }));
const xmlText = readFileSync('test-fixtures/arioso.musicxml', 'utf8');
const score = parseScore(xmlText);
const part = score.parts[0]!;
const loaded = { fileName: 'arioso.musicxml', xmlText, score };
const range = { from: 0, to: part.measures.length - 1 };
const saved = JSON.parse(readFileSync('test-fixtures/arioso-arrangement.json', 'utf8'));
let root: Root | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {}; });
afterEach(async () => { await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); setOwnKey(null); setTransport(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); audio.play.mockReset(); audio.stop.mockReset(); playhead.set({ playing: false, words: '' }); });
const press = async (host: Element, matches: string | RegExp) => {
  const b = [...host.querySelectorAll('button')].find((el) => typeof matches === 'string' ? el.textContent?.trim() === matches : matches.test(`${el.getAttribute('aria-label') ?? ''} ${el.textContent}`));
  if (!b) throw Error(`Missing ${String(matches)}`);
  await act(async () => b.click());
};
function network() {
  const calls: { shape: string; input: any; headers: Headers }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/')) return new Response('{}', { status: 404 });
    const shape = url.split('/').at(-1)!;
    const input = JSON.parse(String(init?.body)).input;
    calls.push({ shape, input, headers: new Headers(init?.headers) });
    const bars = input.written?.map((w: { bar: string }) => w.bar) ?? [];
    const answer = shape === 'read_piece' ? saved.read.answer : shape === 'plan_options' ? { options: [{ name: 'A local option', idea: 'A flute answers', why: [{ from: bars[0], to: bars.at(-1), what: 'Flute answers', principle: 'Motion around the tune' }] }] }
      : shape === 'arrange' ? { adds: [{ part: 'Flute', bar: input.window?.from ?? '1', events: 'C5@0+1', dyn: 'mf' }], doubles: [] } : null;
    return Response.json(answer ? { status: 'ok', answer, cached: false } : { status: 'fallback', reason: 'not-prepared' });
  });
  return calls;
}
async function hostStudio() {
  const calls = network();
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(<Studio />));
  return { host, calls };
}
async function dropScore(host: Element) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [new File([xmlText], 'arioso.musicxml')] } });
  await act(async () => host.querySelector('.drop')!.dispatchEvent(event));
}
function hostArrangement(withView = false) {
  const calls = network();
  let current!: Arranged;
  function Host() {
    const arranged = current = useArrange(loaded, part, range, null);
    const [selection, pick] = useState<Selection | null>(null);
    return <>
      <button onClick={() => { arranged.selectRange('9', '10'); pick({ kind: 'bars', from: '9', to: '10' }); }}>Select external bars</button>
      {withView && arranged.overview && arranged.view && <PieceView data={arranged.overview} selected={arranged.view} sections={arranged.sections} moments={arranged.moments} focus={arranged.focus} solo={arranged.solo} instrumentOf={arranged.instrumentOf} hasNew={false} onSelect={arranged.select} onSelectRange={arranged.selectRange} onFocus={arranged.setFocus} onSolo={arranged.toggleSolo} picked={selection} onPick={pick} />}
      <ArrangePanel arranged={arranged} busy={false} selection={selection} onPick={pick} />
    </>;
  }
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host); act(() => root!.render(<Host />));
  return { host, calls, get now() { return current; } };
}

it('Play from here seeks to the externally selected bars, rather than the old private overview cursor', async () => {
  const screen = hostArrangement(true);
  await act(() => screen.now.askPiece());
  await press(screen.host, 'Select external bars');
  expect(screen.now.view).toEqual({ from: '9', to: '10' });
  await press(screen.host, 'Play from here');
  const expected = screen.now.overview!.bars.find((b) => b.number === '9')!.start;
  expect(expected).toBeGreaterThan(0);
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.play.mock.calls[0]![2], 'Audition must start on the bar named by the inspector').toBe(expected);
});

it('selecting shared credit after own-key use omits the remembered own key', async () => {
  setOwnKey('review-visitor-fake');
  const screen = await hostStudio();
  await press(screen.host, 'Carry on with the key you gave');
  await press(screen.host, /Motifold/);
  await press(screen.host, /try.*credit|shared credit/i);
  await dropScore(screen.host);
  expect(screen.calls.some((c) => c.shape === 'read_piece')).toBe(true);
  expect(screen.calls.every((c) => !c.headers.has('x-motifold-key'))).toBe(true);
});

it('releases acquired microphone tracks when MediaRecorder.start throws', async () => {
  const stopped = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopped }] }));
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', class { state = 'inactive'; mimeType = 'audio/webm'; start() { throw new Error('recorder cannot start'); } stop() {} });
  const screen = await hostStudio();
  await press(screen.host, /try.*credit|shared credit/i);
  await press(screen.host, /sing, hum or play it in/i);
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(stopped, 'The failed recorder still owns an acquired stream').toHaveBeenCalledOnce();
});

it('rewrites only selected bars, then keeps and exports the whole arrangement rather than the visible excerpt', async () => {
  const screen = hostArrangement();
  await act(() => screen.now.askPiece());
  await act(() => screen.now.askOptions('', 0, 'inside'));
  await act(() => screen.now.askNotes(0));
  if (screen.now.options.status !== 'ready' || screen.now.options.notes[0]?.status !== 'ready') throw Error('No written notes');
  const outside = screen.now.options.notes[0].adds.filter((a) => !['9', '10'].includes(a.bar));
  await press(screen.host, 'Select external bars');
  expect(screen.now.page!.score.parts[0]!.measures).toHaveLength(2);
  await act(() => screen.now.askFix(0, '9', '10', 'A thinner answer'));
  expect(screen.calls.at(-1)!.input.window).toEqual({ from: '9', to: '10' });
  if (screen.now.options.status !== 'ready' || screen.now.options.notes[0]?.status !== 'ready') throw Error('No repaired notes');
  expect(screen.now.options.notes[0].adds.filter((a) => !['9', '10'].includes(a.bar))).toEqual(outside);
  const blobs: Blob[] = [];
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL(blob: Blob) { blobs.push(blob); return 'blob:review'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => screen.now.download());
  act(() => screen.now.keep());
  expect(screen.now.kept).toBe(true);
  expect(screen.now.standing!.parts[0]!.measures).toHaveLength(part.measures.length);
  const kept = screen.now.standing!;
  for (const track of scoreTracks(score)) expect(scoreTracks(kept).find((t) => t.name === track.name)).toEqual(track);
  act(() => screen.now.download());
  expect(blobs).toHaveLength(2);
  for (const blob of blobs) {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(file.result as ArrayBuffer); file.onerror = reject; file.readAsArrayBuffer(blob); });
    const files = unzipSync(new Uint8Array(bytes));
    const exported = parseScore(strFromU8(files['score.musicxml']!));
    expect(exported.parts[0]!.measures).toHaveLength(part.measures.length);
    expect(exported.parts.some((p) => p.name === 'Flute')).toBe(true);
    const midi = readMidi(files['all-parts.mid']!);
    expect(Math.max(...midi.tracks.flatMap((t) => t.notes.map((n) => n.tick)))).toBeGreaterThan(60 * midi.ppq);
  }
});
