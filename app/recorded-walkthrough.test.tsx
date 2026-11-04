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
const audio=vi.hoisted(()=>({play:vi.fn(),stop:vi.fn()}));
vi.mock('./audio/preview',async original=>({...await original<typeof import('./audio/preview')>(),createPreview:()=>audio}));
vi.mock('./audio/samples', () => ({ loadManifest: async () => null }));
vi.mock('./Thinking', () => ({ MuseChip: () => null, Thinking: () => null, resetMuseActivity: () => {} }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const index = JSON.parse(readFileSync('public/demo/index.json', 'utf8'));
const expected = unzipSync(new Uint8Array(readFileSync(`public${index.pieces[0].verifiedExport.file}`)));
const run=index.pieces[0].runs.find((item:any)=>item.key===(index.pieces[0].tutorial?.runKey??'arrange-neutral'))??index.pieces[0].runs[0];
const calls=JSON.parse(readFileSync(`public/demo/sample-sketch/${run.key}.json`,'utf8'));
const recordedPlans=calls.find((call:any)=>call.shape==='plan_options').reply.answer.options;
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
  const frames=new Map<number,FrameRequestCallback>();let frame=0;
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++frame,callback);return frame});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const flush=()=>act(()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(0))});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Element.prototype.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn();
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if(url==='/api/access')return Response.json({state:'available',resetAt:null});
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
    await act(async () => button.click());flush();
  }
  async function settle(check: () => boolean) {
    for (let n = 0; n < 20 && !check(); n++) await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(check()).toBe(true);
  }
  await press('Start hands-on tutorial');
  expect(host.textContent).toContain('117 original note attacks');
  await press('Open the saved accepted bars');
  const tempo=host.querySelector<HTMLInputElement>('[aria-label="Inspect the tempo map"]')!;
  expect(tempo).toBeTruthy();
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(tempo,'4.25');tempo.dispatchEvent(new Event('input',{bubbles:true}))});flush();
  await press('Study these bars');
  await settle(() => now().piece.status === 'ready' && now().study.status === 'ready');
  await press('Confirm tracks');
  for (let q = 0; q < 3; q++) await press('Skip this');
  expect(host.querySelector('.tutorial-coach')?.textContent).toContain('Choose the direction and players');
  expect((host.querySelector('[aria-label="Ensemble"]') as unknown as HTMLSelectElement).value).toBe('String orchestra');
  await press('Create');
  await settle(() => { const o = now().options; return o.status === 'ready' && [0, 1].every(i => o.notes[i]?.status === 'ready'); });
  const previews = now().options;
  if (previews.status !== 'ready') throw Error('No plans');
  expect(previews.input).toMatchObject({ intent: 'arrange', where: 'inside', moreBars: 0 });
  expect(previews.plans.map(p => p.name)).toEqual(recordedPlans.map((plan:any)=>plan.name));
  expect(previews.notes[0]).toMatchObject({ status: 'ready', preview: true });
  expect(previews.notes[1]).toMatchObject({ status: 'ready', preview: true });
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Audition plan A"]')!.click());flush();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Audition plan B"]')!.click());flush();
  expect(audio.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  const a = host.querySelector<HTMLButtonElement>('.idea-choose')!;
  await act(async () => a.click());
  await press('Write the rest of this one');
  await settle(() => { const o = now().options; const n = o.status === 'ready' ? o.notes[0] : null; return n?.status === 'ready' && !n.writing && !n.preview && !n.missing?.length; });
  const final = now().options;
  if (final.status !== 'ready' || final.notes[0]?.status !== 'ready') throw Error('No full A');
  expect(final.notes[0].check).toMatchObject({ notes: index.pieces[0].verifiedExport.newNotes, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [] });
  expect(now().trying).toEqual({ kind: 'option', index: 0 });
  expect(final.notes[1]).toMatchObject({ preview: true });
  await press('Export');
  const blobs: Blob[] = []; const URLNow = URL;
  vi.stubGlobal('URL', class extends URLNow { static createObjectURL(blob: Blob) { blobs.push(blob); return 'blob:recorded-export'; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await press('Download MIDI');
  expect(host.textContent).toContain('Your arrangement is ready');
  expect(host.textContent).toContain('Make it longer');
  expect(host.textContent).toContain('Hear Cute become Sad');
  expect(blobs).toHaveLength(1);
  vi.useRealTimers();
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(file.result as ArrayBuffer); file.onerror = reject; file.readAsArrayBuffer(blobs[0]!); });
  const actual = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  // Compare entry payloads, so ZIP metadata timestamps can vary while all musical/export content stays exact.
  for (const name of Object.keys(expected)) expect(actual[name], name).toEqual(expected[name]);
  expect(fetched.filter(url => url.startsWith('/api/')&&url!=='/api/access')).toEqual([]);
  expect(Object.keys(expected)).toHaveLength(9);
});
