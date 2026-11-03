// @vitest-environment jsdom
// Authentic source and successful reading/Study receipts. Every response comes from local files.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseScore } from '../score';
import { pieceInput, scoreTracks } from './arrange';
import { attacksOf, playedFromMidi } from './timing';
import { recordedRequestKey, skipReplay, stopDemo, type DemoPiece } from './demo';
import { Studio } from './Studio';

const state = vi.hoisted(() => ({ latest: null as any }));
vi.mock('./Workspace', () => ({ Workspace: (props: any) => { state.latest = props; return <main>Recorded score workspace</main>; } }));
vi.mock('./Thinking', () => ({ MuseChip: () => null, Thinking: () => null, resetMuseActivity: () => {} }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const xml = readFileSync('public/demo/sample-sketch/sample-sketch.musicxml', 'utf8');
const midi = new Uint8Array(readFileSync('public/demo/sample-sketch/Sample_sketch.mid'));
const receipts = JSON.parse(readFileSync('public/demo/sample-sketch/shared.json', 'utf8'));
const piece: DemoPiece = { id: 'sample-sketch', name: 'Sample sketch', words: 'A real recorded source.', midi: '/demo/sample-sketch/Sample_sketch.mid', xml: '/demo/sample-sketch/sample-sketch.musicxml', recipe: { intent: 'arrange', ensemble: 'String orchestra', moreBars: 0, where: 'inside', useMelodyOnly: false }, guide: ['Confirm the recorded source tracks.'], runs: [{ key: 'arrange-neutral', mode: 'arrange', mood: '' }] };
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; stopDemo(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren(); state.latest = null; });

it('keeps the exact original MIDI and faithfully reopens the accepted source used by both real calls', () => {
  expect(createHash('sha256').update(midi).digest('hex')).toBe('782c244e9d31572a3c3225c6af170a75ea94224b7e92ea1e1a6d6183ddb70d54');
  const played = playedFromMidi(midi), accepted = attacksOf(played).flatMap(a => a.notes);
  expect(played.notes).toHaveLength(117);
  expect(played.notes.filter(n => !accepted.some(a => a.id === n.id)).map(n => ({ id: n.id, height: n.height, velocity: n.velocity }))).toEqual([{ id: 19, height: 53, velocity: 1 }, { id: 33, height: 69, velocity: 5 }, { id: 45, height: 53, velocity: 4 }]);
  const score = parseScore(xml);
  expect(scoreTracks(score).reduce((sum, track) => sum + track.notes.length, 0)).toBe(accepted.length);
  const input = pieceInput(score, score.parts[0]!, 0, 23);
  expect(receipts.map((call: any) => call.shape)).toEqual(['read_piece', 'study_score']);
  for (const call of receipts) {
    expect(recordedRequestKey(call.shape, input)).toBe(recordedRequestKey(call.shape, call.input));
    expect(call.reply).toMatchObject({ status: 'ok', cached: false });
    expect(call.model).toBe('muse-spark-1.3');
    expect(call.ms).toBeGreaterThan(0);
  }
});

it('opens the exact XML, prefills the recorded neutral recipe and uses only local recorded answers', async () => {
  vi.useFakeTimers();
  const FileNow = File;
  vi.stubGlobal('File', class extends FileNow {
    private heldBuffer: ArrayBuffer;
    constructor(parts: BlobPart[], name: string, options?: FilePropertyBag) { super(parts, name, options); this.heldBuffer = parts[0] as ArrayBuffer; }
    async arrayBuffer() { return this.heldBuffer.slice(0); }
  });
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url === '/demo/index.json') return Response.json({ recorded: '2026-11-04T00:00:00Z', pieces: [piece] });
    if (url === piece.xml) return new Response(xml);
    if (url === '/demo/sample-sketch/shared.json') return Response.json(receipts);
    if (url === '/demo/sample-sketch/arrange-neutral.json') return Response.json([]);
    throw Error(`No provider or MIDI-import request is allowed: ${url}`);
  });
  const host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
  await act(async () => root!.render(<Studio/>));
  const door = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Watch it work'))!;
  await act(async () => door.click());
  expect(host.querySelectorAll('.piece-card button')).toHaveLength(1);
  expect(host.querySelector<HTMLAnchorElement>('.piece-card a')?.getAttribute('href')).toBe(piece.midi);
  const start = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Start recorded walkthrough')!;
  await act(async () => start.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); skipReplay(); await vi.advanceTimersByTimeAsync(15_000); });
  expect(state.latest.loaded.fileName).toBe('sample-sketch.musicxml');
  expect(state.latest.initialSetup).toEqual(piece.recipe);
  expect(state.latest.arranged.piece.status).toBe('ready');
  expect(state.latest.arranged.study.status).toBe('ready');
  expect(host.querySelector('.replay-guide')?.textContent).toContain('Confirm the recorded source tracks.');
  expect(fetched).not.toContain(piece.midi);
  expect(fetched.some(url => url.startsWith('/api/'))).toBe(false);
});
