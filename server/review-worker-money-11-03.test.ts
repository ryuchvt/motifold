// Local boundary checks only. No deployed Worker, real key or upstream request.
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
vi.mock('./call', async (original) => ({ ...(await original<typeof import('./call')>()), runCall: vi.fn(async () => ({ status: 'fallback', reason: 'bad-input' })) }));
// Variable import keeps Cloudflare-only declarations outside the browser test typecheck.
const workerModule = './worker';
const worker = (await import(workerModule)).default as { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
import { runCall } from './call';

const env = { MODE: 'hosted', META_API_KEY: 'review-owner-fake', VISITOR_SALT: 'review-salt', LEDGER: { idFromName: () => 'local', get: () => ({}) } };
const ctx = { waitUntil: () => {} };
const request = (own?: string) => new Request('https://review.invalid/api/spark/read_piece', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.10', ...(own === undefined ? {} : { 'x-motifold-key': own }) },
  body: JSON.stringify({ attemptId: '00000000-0000-0000-0000-000000000001', input: {} }),
});
afterEach(() => vi.clearAllMocks());

it('routes hosted judges without an own key through the limited public pool', async () => {
  await worker.fetch(request(), env as never, ctx as never);
  expect(vi.mocked(runCall).mock.calls[0]![2]).toMatchObject({ pool: 'public', key: 'review-owner-fake', slots: 3 });
});

it('rejects a malformed own-key header instead of using the owner key in the unlimited own pool', async () => {
  const response = await worker.fetch(request('x'), env as never, ctx as never);
  expect.soft(response.status).toBe(400);
  expect(runCall, 'a one-character header must never dispatch the owner key as an own-key call').not.toHaveBeenCalled();
});

it('uses a well formed own key only as that caller key', async () => {
  await worker.fetch(request('review-visitor-fake'), env as never, ctx as never);
  expect(vi.mocked(runCall).mock.calls[0]![2]).toMatchObject({ pool: 'own', key: 'review-visitor-fake', slots: 50 });
});
