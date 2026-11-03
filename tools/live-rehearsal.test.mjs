import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { approvedRun, attemptExposure, budgetDecision, createGuard, localOrigin } from './live-rehearsal.mjs';

const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => { server.closeAllConnections(); server.close(done); }))); });
async function listen(server) { servers.push(server); await new Promise((done) => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
const base = { capMicros: 26_000_000, committedMicros: 17_663_487, dailyMicros: null, todayMicros: 0 };
const body = (attemptId = randomUUID()) => JSON.stringify({ attemptId, input: { piece: 'Only a local mock' } });
const post = (origin, contents = body(), headers = {}) => fetch(`${origin}/api/spark/arrange`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: contents });

it('counts unknown and dispatched exposure at the full reservation and fails closed on bad limits', () => {
  expect(['reserved', 'dispatched', 'uncertain'].map((state) => attemptExposure({ state, reserved_micros: 1_480_720, charged_micros: null }))).toEqual([1_480_720, 1_480_720, 1_480_720]);
  expect(attemptExposure({ state: 'settled', reserved_micros: 1_480_720, charged_micros: 100_000 })).toBe(100_000);
  expect(attemptExposure({ state: 'released', reserved_micros: 1_480_720 })).toBe(0);
  expect(budgetDecision(base, 3_519_280, 1_480_720, 5_000_000)).toBeNull();
  expect(budgetDecision(base, 3_519_281, 1_480_720, 5_000_000)).toBe('session-ceiling');
  expect(budgetDecision({ ...base, committedMicros: 25_000_000 }, 0, 1_480_720, 5_000_000)).toBe('pool-ceiling');
  expect(budgetDecision({ ...base, dailyMicros: 10, todayMicros: NaN }, 0, 1, 5_000_000)).toBe('invalid-ledger');
  expect(() => localOrigin('https://example.com')).toThrow();
  expect(() => localOrigin('http://127.0.0.1:8790/private')).toThrow();
});

it('retains the approved ceiling and unknown attempts across a restart instead of issuing a new allowance', () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-rehearsal-'));
  try {
    const file = join(folder, 'approved.json');
    const first = approvedRun(file, base);
    const id = randomUUID();
    first.owned.set(id, { reservation: 1_480_720, noCharge: false }); first.persist();
    const restarted = approvedRun(file, { ...base, committedMicros: base.committedMicros + 1_480_720 });
    expect(restarted.owned.get(id)).toEqual({ reservation: 1_480_720, noCharge: false });
    expect(restarted.snapshot().initialBalance).toEqual(base);
    expect(restarted.snapshot().ceilingMicros).toBe(5_000_000);
    writeFileSync(file, JSON.stringify({ ...restarted.snapshot(), ceilingMicros: 10_000_000 }));
    expect(() => approvedRun(file, base)).toThrow('approved rehearsal record changed');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it('does not dispatch unarmed calls or own-key traffic and never records the key header', async () => {
  let sent = 0; const receipts = [];
  const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
  const ledger = { balance: () => base, attempt: () => null };
  const unarmed = createGuard({ upstream, ledger, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, record: (entry) => receipts.push(entry) });
  const unarmedUrl = await listen(unarmed.server);
  expect(await (await post(unarmedUrl)).json()).toMatchObject({ status: 'fallback', reason: 'rehearsal-unarmed' });
  const armed = createGuard({ upstream, ledger, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, armed: true, record: (entry) => receipts.push(entry) });
  const armedUrl = await listen(armed.server);
  expect(await (await post(armedUrl, body(), { 'x-motifold-key': 'local-fake-key-value' })).json()).toMatchObject({ reason: 'own-key-outside-dev-budget' });
  expect(sent).toBe(0);
  expect(JSON.stringify(receipts)).not.toContain('local-fake-key-value');
});

it('serializes parallel browser requests and checks the next full reservation against the settled receipt', async () => {
  const rows = new Map(), receipts = []; let sent = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(input.attemptId, { state: 'dispatched', reserved_micros: 1_480_720 });
    setTimeout(() => { rows.set(input.attemptId, { state: 'settled', reserved_micros: 1_480_720, charged_micros: 900_000 }); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} })); }, 25);
  }));
  const ledger = { balance: () => ({ ...base, committedMicros: base.committedMicros + [...rows.values()].reduce((sum, row) => sum + attemptExposure(row), 0) }), attempt: (id) => rows.get(id) };
  const guard = createGuard({ upstream, ledger, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, ceilingMicros: 2_000_000, armed: true, record: (entry) => receipts.push(entry) });
  const origin = await listen(guard.server);
  const responses = await Promise.all([post(origin), post(origin)]);
  const replies = await Promise.all(responses.map((response) => response.json()));
  expect(replies.map((reply) => reply.status)).toEqual(['ok', 'fallback']);
  expect(replies[1].reason).toBe('budget');
  expect(sent).toBe(1);
  expect(guard.exposure()).toBe(900_000);
  expect(receipts.at(-1)).toMatchObject({ sent: false, blocked: 'session-ceiling' });
});

it('streams real chunks without waiting for completion and records reasoning arrival times and ledger charges', async () => {
  const rows = new Map(), receipts = []; let finish;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    rows.set(input.attemptId, { state: 'dispatched', reserved_micros: 1_480_720 });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"kind":"thinking","text":"A local mock"}\n\n');
    finish = () => { rows.set(input.attemptId, { state: 'settled', reserved_micros: 1_480_720, charged_micros: 1200 }); response.end('data: {"kind":"result","result":{"status":"ok","cached":false,"answer":{},"version":"local-1","model":"local-model"}}\n\n'); };
  }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: (id) => rows.get(id) }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, armed: true, record: (entry) => receipts.push(entry) });
  const response = await post(await listen(guard.server));
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('A local mock');
  expect(receipts).toHaveLength(1); // Only the release exists while the SSE response is still open.
  finish();
  while (!(await reader.read()).done) {}
  expect(receipts.at(-1).thinking).toEqual([{ at: expect.any(Number), text: 'A local mock' }]);
  expect(receipts.at(-1).receipt.charged_micros).toBe(1200);
  expect(receipts.at(-1).reply).toMatchObject({ version: 'local-1', model: 'local-model' });
});

it('retains a missing receipt after response loss and blocks subsequent paid requests', async () => {
  let sent = 0;
  const upstream = await listen(createServer((_request, response) => { sent++; response.destroy(); }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: () => null }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, armed: true });
  const origin = await listen(guard.server);
  expect((await post(origin)).status).toBe(502);
  expect(guard.exposure()).toBe(1_480_720);
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(sent).toBe(1);
});

it('never lets an absolute or authority-form request override the validated local upstream', async () => {
  let sent = 0;
  const other = await listen(createServer((_request, response) => { sent++; response.end('should not be reached'); }));
  const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: () => null }, shapes: {}, reserve: () => 1, armed: true });
  const origin = await listen(guard.server);
  for (const path of [`${other}/private`, `//${new URL(other).host}/private`]) {
    const status = await new Promise((done) => { const call = request(origin, { path }, (response) => { response.resume(); response.once('end', () => done(response.statusCode)); }); call.end(); });
    expect(status).toBe(400);
  }
  expect(sent).toBe(0);
});
