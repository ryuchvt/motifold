// @vitest-environment jsdom
// The published recording through Studio, Create, A selection and direct Export. No API request is allowed.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { Studio } from './Studio';
import { stopDemo } from './demo';
import type { Arranged } from './useArrange';

const state = vi.hoisted(() => ({ now: null as Arranged | null }));
vi.mock('./useArrange', async original => {
  const real = await original<typeof import('./useArrange')>();
  return { ...real, useArrange: (...args: Parameters<typeof real.useArrange>) => { const value = real.useArrange(...args); state.now = value; return value; } };
});
vi.mock('./ScoreView', () => ({ ScoreView: () => <div>Notation canvas</div> }));
vi.mock('./audio/samples', () => ({ loadManifest: async () => null }));
vi.mock('./Thinking', () => ({ MuseChip: () => null, Thinking: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const index = JSON.parse(readFileSync('public/demo/index.json', 'utf8'));
const expected = unzipSync(new Uint8Array(readFileSync('public/demo/sample-sketch/neutral-strings-a.zip')));
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; stopDemo(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); state.now = null; });

it('reproduces the complete real A export through the actual recorded Create workflow, without Keep or a provider request', async () => {
  vi.useFakeTimers();
  const FileNow = File;
  vi.stubGlobal('File', class extends FileNow {
    private heldBuffer: ArrayBuffer;
    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) { super(parts, name, options); this.heldBuffer = parts[0] as ArrayBuffer; }
    async arrayBuffer() { return this.heldBuffer.slice(0); }
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Element.prototype.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn();
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (!url.startsWith('/demo/')) throw Error(`Provider and unrelated requests are blocked: ${url}`);
    const file = `public${url}`;
    return new Response(readFileSync(file), { headers: { 'content-type': url.endsWith('.json') ? 'application/json' : 'application/xml' } });
  });
  const host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
  await act(async () => root!.render(<Studio/>));
  const now = () => state.now!;
  async function press(text: string) {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text || b.querySelector('strong')?.textContent === text);
    if (!button) throw Error(`Missing ${text}`);
    expect(button.disabled, text).toBe(false);
    await act(async () => button.click());
  }
  async function settle(check: () => boolean) {
    for (let n = 0; n < 20 && !check(); n++) await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(check()).toBe(true);
  }
  await press('Watch it work');
  await press('Start recorded walkthrough');
  await settle(() => now().piece.status === 'ready' && now().study.status === 'ready');
  await press('Confirm tracks');
  for (let q = 0; q < 3; q++) await press('Skip this');
  await press('Next: Setup');
  expect((host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement).value).toBe('String orchestra');
  await press('Create');
  await settle(() => { const o = now().options; return o.status === 'ready' && [0, 1].every(i => o.notes[i]?.status === 'ready'); });
  const previews = now().options;
  if (previews.status !== 'ready') throw Error('No plans');
  expect(previews.input).toMatchObject({ intent: 'arrange', where: 'inside', moreBars: 0 });
  expect(previews.plans.map(p => p.name)).toEqual(['Held middle voices with repeat contrast', 'Pulsed support with brief answers']);
  expect(previews.notes[0]).toMatchObject({ status: 'ready', preview: true, check: { notes: 8 } });
  expect(previews.notes[1]).toMatchObject({ status: 'ready', preview: true, check: { notes: 24 } });
  const a = host.querySelector<HTMLButtonElement>('.idea-choose')!;
  await act(async () => a.click());
  await press('Write the rest of this one');
  await settle(() => { const o = now().options; const n = o.status === 'ready' ? o.notes[0] : null; return n?.status === 'ready' && !n.writing && !n.preview && !n.missing?.length; });
  const final = now().options;
  if (final.status !== 'ready' || final.notes[0]?.status !== 'ready') throw Error('No full A');
  expect(final.notes[0].check).toMatchObject({ notes: 42, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [] });
  expect(now().trying).toEqual({ kind: 'option', index: 0 });
  expect(final.notes[1]).toMatchObject({ preview: true });
  await press('Export');
  const blobs: Blob[] = []; const URLNow = URL;
  vi.stubGlobal('URL', class extends URLNow { static createObjectURL(blob: Blob) { blobs.push(blob); return 'blob:recorded-export'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await press('Download MIDI');
  expect(now().trying).toEqual({ kind: 'option', index: 0 });
  expect(blobs).toHaveLength(1);
  vi.useRealTimers();
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(file.result as ArrayBuffer); file.onerror = reject; file.readAsArrayBuffer(blobs[0]!); });
  const actual = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  // Compare entry payloads, so ZIP metadata timestamps can vary while all musical/export content stays exact.
  for (const name of Object.keys(expected)) expect(actual[name], name).toEqual(expected[name]);
  expect(fetched.some(url => url.startsWith('/api/'))).toBe(false);
  expect(index.pieces[0].verifiedExport.notes).toBe(211);
});
