import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { approvedRun, attemptExposure, budgetDecision, createGuard, recordingProfile, recordedCall } from './live-rehearsal.mjs';

const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); }))); });
async function listen(server) { servers.push(server); await new Promise(done => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
const baseline = { capMicros: 44_048_076, committedMicros: 21_048_076, dailyMicros: null, todayMicros: 0 };
const post = (origin, id = randomUUID(), headers = {}) => fetch(`${origin}/api/spark/arrange`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ attemptId: id, input: { only: 'A local test' } }) });

it('grants only the named approved batch while preserving earlier rehearsal records and global headroom', () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-night-budget-'));
  try {
    const oldFile = join(folder, 'old.json'), nightFile = join(folder, 'night.json');
    const old = approvedRun(oldFile, { ...baseline, capMicros: 26_000_000 });
    old.owned.set('older-unknown', { reservation: 1_480_720, noCharge: false }); old.persist();
    const oldBytes = readFileSync(oldFile, 'utf8');
    const profile = recordingProfile('night-204');
    expect(profile.ceilingMicros).toBe(23_000_000);
    expect(profile.poolCapMicros).toBe(baseline.committedMicros + 23_000_000);
    expect(profile.poolCapMicros + 100_000_000 + 4_000_000 + 1_000_000).toBeLessThanOrEqual(150_000_000);
    const night = approvedRun(nightFile, baseline, profile);
    night.owned.set('night-unknown', { reservation: 1_480_720, noCharge: false }); night.persist();
    const resumed = approvedRun(nightFile, { ...baseline, committedMicros: baseline.committedMicros + 1_480_720 }, profile);
    expect(resumed.owned.get('night-unknown')).toEqual({ reservation: 1_480_720, noCharge: false });
    expect(resumed.snapshot().initialBalance).toEqual(baseline);
    expect(readFileSync(oldFile, 'utf8')).toBe(oldBytes);
    expect(budgetDecision(baseline, 21_519_280, 1_480_720, profile.ceilingMicros)).toBeNull();
    expect(budgetDecision(baseline, 21_519_281, 1_480_720, profile.ceilingMicros)).toBe('session-ceiling');
    expect(() => approvedRun(nightFile, baseline)).toThrow('approved rehearsal record changed');
    expect(() => recordingProfile('other')).toThrow('Unknown');
    expect(() => recordingProfile('__proto__')).toThrow('Unknown');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it('isolates a charged rejection before proceeding, but never proceeds after an unknown charge', async () => {
  const rows = new Map(), receipts = [], restarted = [];
  let sent = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(attemptId, { state: sent === 1 ? 'settled' : 'uncertain', reserved_micros: 1_480_720, charged_micros: sent === 1 ? 50_000 : null });
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ status: 'fallback', reason: sent === 1 ? 'rejected' : 'network' }));
  }));
  const ledger = { balance: () => ({ ...baseline, committedMicros: baseline.committedMicros + [...rows.values()].reduce((sum, row) => sum + attemptExposure(row), 0) }), attempt: id => rows.get(id) };
  const guard = createGuard({ upstream, ledger, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, ceilingMicros: 23_000_000, armed: true, continueSettledFailures: true, afterSettled: async entry => restarted.push(entry.attemptId), record: entry => receipts.push(entry) });
  const url = await listen(guard.server);
  const a = randomUUID(), b = randomUUID();
  expect(await (await post(url, a, { 'x-motifold-record-case': 'arrange-neutral-strings-a' })).json()).toMatchObject({ reason: 'rejected' });
  expect(await (await post(url, b)).json()).toMatchObject({ reason: 'network' });
  expect(await (await post(url)).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(sent).toBe(2);
  expect(restarted).toEqual([a]);
  expect(guard.exposure()).toBe(1_530_720);
  const recorded = receipts.map(recordedCall).filter(Boolean);
  expect(recorded[0]).toMatchObject({ captureCase: 'arrange-neutral-strings-a', attemptId: a });
  expect(JSON.stringify(recorded)).not.toContain('authorization');
});

it('forwards coarse availability as a read-only request without allocating an attempt', async () => {
  const seen = [];
  const upstream = await listen(createServer((request, response) => { seen.push(request.url); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ state: 'available', resetAt: null })); }));
  const owned = new Map();
  const guard = createGuard({ upstream, ledger: { balance: () => baseline, attempt: () => null }, shapes: {}, reserve: () => 0, owned });
  const url = await listen(guard.server);
  expect(await (await fetch(`${url}/api/access?shape=read_piece`)).json()).toEqual({ state: 'available', resetAt: null });
  expect(seen).toEqual(['/api/access?shape=read_piece']);
  expect(owned.size).toBe(0);
  expect(guard.exposure()).toBe(0);
});

it('keeps untagged interactive traffic outside the approved automated recording batch', async () => {
  let forwarded = 0;
  const upstream = await listen(createServer((_request, response) => { forwarded++; response.end('{}'); }));
  const owned = new Map();
  const guard = createGuard({ upstream, ledger: { balance: () => baseline, attempt: () => null }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, owned, armed: true, requireCaptureCase: true });
  const url = await listen(guard.server);
  expect(await (await post(url)).json()).toMatchObject({ reason: 'recording-case-required' });
  expect(forwarded).toBe(0);
  expect(owned.size).toBe(0);
});
