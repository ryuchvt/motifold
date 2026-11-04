import { expect, it, vi } from 'vitest';
import { serveAudioAsset } from './audioAssets';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
import worker from './worker';

const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
const response = (method = 'GET') => new Response(method === 'HEAD' ? null : data, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '8', ETag: '"recording"', 'Last-Modified': 'Wed, 04 Nov 2026 10:00:00 GMT' } });
async function request(range?: string, method = 'GET', extra: Record<string, string> = {}) {
  const fetch = vi.fn(async (r: Request) => response(r.method));
  const result = await serveAudioAsset(new Request('https://test.invalid/demo/piece/audio/full-mix.mp3', { method, headers: { ...(range ? { Range: range } : {}), ...extra } }), { fetch });
  return { result, fetch };
}

it.each([
  ['bytes=0-1', 0, 1], ['bytes=3-', 3, 7], ['bytes=-3', 5, 7], ['bytes=-100', 0, 7], ['bytes=4-100', 4, 7],
])('returns exact audio bytes for %s', async (range, from, to) => {
  const { result, fetch } = await request(range);
  expect(result.status).toBe(206);
  expect(result.headers.get('Content-Range')).toBe(`bytes ${from}-${to}/8`);
  expect(result.headers.get('Content-Length')).toBe(String(to - from + 1));
  expect(result.headers.get('Accept-Ranges')).toBe('bytes');
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(data.slice(from, to + 1));
  expect(fetch.mock.calls[0]![0].headers.get('Range')).toBeNull();
});

it.each(['bytes=8-', 'bytes=5-2', 'bytes=-0'])('reports an unsatisfiable %s without a misleading audio body', async range => {
  const { result } = await request(range);
  expect(result.status).toBe(416); expect(result.headers.get('Content-Range')).toBe('bytes */8'); expect(await result.text()).toBe('');
});

it.each([undefined, 'items=0-1', 'bytes=0-1,3-4', 'bytes=', 'bytes=999999999999999999999999999999-'])('streams the full file when no supported single range is requested', async range => {
  const { result } = await request(range);
  expect(result.status).toBe(200); expect(new Uint8Array(await result.arrayBuffer())).toEqual(data);
});

it('handles HEAD, matching If-Range and stale or weak validators', async () => {
  const { result } = await request('bytes=2-4', 'HEAD');
  expect(result.status).toBe(206); expect(result.headers.get('Content-Length')).toBe('3'); expect(await result.text()).toBe('');
  for (const validator of ['"recording"', 'Wed, 04 Nov 2026 10:00:00 GMT']) expect((await request('bytes=2-4', 'GET', { 'If-Range': validator })).result.status).toBe(206);
  for (const validator of ['"old"', 'W/"recording"', 'Tue, 03 Nov 2026 10:00:00 GMT']) expect((await request('bytes=2-4', 'GET', { 'If-Range': validator })).result.status).toBe(200);
});

it('preserves asset errors and conditional responses, rejects SPA HTML, and refuses writes', async () => {
  const req = new Request('https://test.invalid/demo/missing.mp3');
  expect((await serveAudioAsset(req, { fetch: async () => new Response(null, { status: 304 }) })).status).toBe(304);
  expect((await serveAudioAsset(req, { fetch: async () => new Response('missing', { status: 404 }) })).status).toBe(404);
  expect((await serveAudioAsset(req, { fetch: async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }) })).status).toBe(404);
  const fetch = vi.fn(); expect((await serveAudioAsset(new Request(req, { method: 'POST' }), { fetch })).status).toBe(405); expect(fetch).not.toHaveBeenCalled();
});

it('routes real nested demo audio before any ledger or provider access', async () => {
  const unavailable = () => { throw Error('Audio must not access credit or a provider'); };
  const env = { ASSETS: { fetch: async () => response() }, get LEDGER() { return unavailable(); } };
  vi.stubGlobal('fetch', unavailable);
  try {
    const result = await worker.fetch(new Request('https://test.invalid/demo/cute-test/outcomes/recompose-sad-full-a/audio/full-mix.mp3', { headers: { Range: 'bytes=0-1' } }) as never, env as never, {} as never);
    expect(result.status).toBe(206); expect(new Uint8Array(await result.arrayBuffer())).toEqual(data.slice(0, 2));
  } finally { vi.unstubAllGlobals(); }
});
