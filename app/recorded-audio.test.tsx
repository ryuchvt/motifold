// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { recordedDemoCatalog, type DemoOutcome } from './demo';
import { useRecordedOutcome, outcomeAudio } from './recordedAudio';
import { recordedPieceData } from './OutcomeExplorer';
import { parseScore } from '../score';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

it('binds all supplied mixes and stem labels to the unchanged complete scores and real audio payloads', () => {
  const provenance = JSON.parse(readFileSync('public/demo/audio-provenance.json', 'utf8'));
  expect(provenance.outcomes).toHaveLength(3);
  for (const item of provenance.outcomes) {
    const catalog = recordedDemoCatalog(JSON.parse(readFileSync(`public/demo/${item.pieceId}/catalog.json`, 'utf8')), item.pieceId)!;
    const outcome = catalog.outcomes.find(row => row.id === item.outcomeId)!;
    const xml = readFileSync(`public${outcome.xml}`);
    expect(hash(xml)).toBe(item.xmlSha256); expect(outcome.renderXmlSha256).toBe(item.xmlSha256);
    expect(hash(readFileSync(`public${outcome.midi}`))).toBe(item.midiSha256);
    const rows = recordedPieceData(parseScore(xml.toString())).rows.map(row => row.label).sort();
    expect(outcome.renderStems!.map(stem => stem.label).sort()).toEqual(rows);
    expect(outcomeAudio(outcome, rows)).toEqual(rows.map(label => outcome.renderStems!.find(stem => stem.label === label)!.url));
    expect(outcomeAudio(outcome, ['unknown part'])).toBeUndefined();
    for (const file of item.files) expect(hash(readFileSync(`public${file.url}`))).toBe(file.mp3Sha256);
  }
});

it('drops rendered audio immediately for edits, partial scores, other versions and leaving replay mode', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const xml = '<score-partwise>Complete A</score-partwise>', changed = xml + '<!-- edited -->';
  const row: DemoOutcome = { id: 'complete-a', runKey: 'recorded-a', intent: 'arrange', ensemble: 'Strings', mood: '', option: 0, name: 'A', bars: 24, sourceBars: 24, status: 'complete', xml: '/demo/test/a.xml', midi: '/demo/test/a.mid', zip: '/demo/test/a.zip', xmlSha256: hash(xml), renderXmlSha256: hash(xml), render: '/demo/test/a.mp3' };
  const piece = { id: 'test', catalog: '/demo/test/catalog.json' };
  const fetcher = vi.fn(async (_url: string) => Response.json({ version: 1, pieceId: 'test', recorded: '2026-11-04', outcomes: [row] })); vi.stubGlobal('fetch', fetcher);
  const host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
  function Harness({ xml, enabled = true }: { xml: string; enabled?: boolean }) { return <output>{useRecordedOutcome(enabled ? piece : undefined, xml)?.render ?? 'browser'}</output>; }
  await act(async () => root!.render(<Harness xml={xml}/>)); await vi.waitFor(() => expect(host.textContent).toBe(row.render));
  act(() => root!.render(<Harness xml={changed}/>)); expect(host.textContent).toBe('browser');
  await act(async () => {}); expect(host.textContent).toBe('browser');
  await act(async () => root!.render(<Harness xml={xml}/>)); await vi.waitFor(() => expect(host.textContent).toBe(row.render));
  act(() => root!.render(<Harness xml={xml} enabled={false}/>)); expect(host.textContent).toBe('browser');
  expect(fetcher.mock.calls.every(call => call.length === 1)).toBe(true);
});
