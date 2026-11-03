import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { approvedRun, attemptExposure, budgetDecision, createGuard, localOrigin, ownedWorker, recordedCall } from './live-rehearsal.mjs';

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

it('releases only an explicit cached success when its claim row is not visible, retaining fresh and older unknown holds', async () => {
  let sent = 0;
  const owned = new Map([[randomUUID(), { reservation: 500_000, noCharge: false }]]);
  const receipts = [];
  const upstream = await listen(createServer((_request, response) => { sent++; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ status: 'ok', cached: sent === 1, answer: {} })); }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: () => null }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, ceilingMicros: 2_000_000, armed: true, owned, record: (entry) => receipts.push(entry) });
  const origin = await listen(guard.server);
  expect(await (await post(origin)).json()).toMatchObject({ status: 'ok', cached: true });
  expect(guard.exposure()).toBe(500_000);
  expect([...owned.values()].filter((entry) => entry.noCharge)).toHaveLength(1);
  expect(await (await post(origin)).json()).toMatchObject({ status: 'ok', cached: false });
  expect(guard.exposure()).toBe(1_980_720);
  expect(await (await post(origin)).json()).toMatchObject({ status: 'fallback', reason: 'budget' });
  expect(sent).toBe(2);
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

it('isolates a fresh settled success before queued API calls or ledger polling, without restarting cache hits', async () => {
  const rows = new Map(), events = [], receipts = [];
  let releaseRestart, sent = 0;
  const restarted = new Promise((done) => { releaseRestart = done; });
  const upstream = await listen(createServer(async (request, response) => {
    if (request.url === '/api/ledger') { events.push('ledger'); response.end('{}'); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks));
    sent++; events.push(`call-${sent}`);
    const cached = sent !== 1;
    if (!cached) rows.set(attemptId, { state: 'settled', reserved_micros: 1_480_720, charged_micros: 1000 });
    response.end(JSON.stringify({ status: 'ok', cached, answer: {} }));
  }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: (id) => rows.get(id) }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, armed: true, record: (entry) => receipts.push(entry), afterSettled: async () => { events.push('restart-start'); await restarted; events.push('restart-ready'); } });
  const origin = await listen(guard.server);
  expect(await (await post(origin)).json()).toMatchObject({ status: 'ok', cached: false });
  const next = post(origin), balance = fetch(`${origin}/api/ledger`);
  await new Promise((done) => setTimeout(done, 30));
  expect(events).toEqual(['call-1', 'restart-start']);
  releaseRestart();
  expect(await (await next).json()).toMatchObject({ status: 'ok', cached: true });
  await (await balance).text();
  expect(events.indexOf('call-2')).toBeGreaterThan(events.indexOf('restart-ready'));
  expect(events.indexOf('ledger')).toBeGreaterThan(events.indexOf('restart-ready'));
  expect(events.filter((event) => event === 'restart-start')).toHaveLength(1);
  expect(guard.exposure()).toBe(1000);
  expect(receipts.filter((entry) => entry.kind === 'worker-isolation').map((entry) => entry.phase)).toEqual(['starting', 'ready']);
  const calls = receipts.map(recordedCall).filter(Boolean);
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.reply.status)).toEqual(['ok', 'ok']);
  expect(calls.every((call) => call.input?.piece === 'Only a local mock')).toBe(true);
});

it.each(['unknown', 'missing-settlement', 'restart-fails'])('blocks the next request after %s without retrying the previous attempt', async (condition) => {
  let sent = 0, restarts = 0;
  const row = { state: 'settled', reserved_micros: 1_480_720, charged_micros: 1000 };
  const upstream = await listen(createServer((_request, response) => { sent++; response.end(JSON.stringify(condition === 'unknown' ? { status: 'fallback', reason: 'network' } : { status: 'ok', cached: false, answer: {} })); }));
  const guard = createGuard({ upstream, ledger: { balance: () => base, attempt: () => condition === 'restart-fails' && sent > 0 ? row : null }, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => 1_480_720, armed: true, afterSettled: async () => { restarts++; throw Error('Local restart failed'); } });
  const origin = await listen(guard.server);
  await (await post(origin)).text();
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(sent).toBe(1);
  expect(restarts).toBe(condition === 'restart-fails' ? 1 : 0);
  expect(guard.exposure()).toBe(condition === 'restart-fails' ? 1000 : 1_480_720);
});

it('waits for the owned child exit and ledger readiness before resuming, and stops on unexpected exit', async () => {
  const events = [], children = [];
  let unexpected = 0, finishExit, readiness = true, down = true, onKill = () => {};
  const runtime = ownedWorker({ ready: async () => readiness, isDown: async () => down, readyDelayMs: 1, readyTries: 100, onUnexpectedExit: () => unexpected++, launch: () => {
    const child = new EventEmitter(); child.exitCode = child.signalCode = null;
    child.kill = (signal) => { events.push(signal); finishExit = () => { child.signalCode = signal; child.emit('exit'); }; onKill(); return true; };
    children.push(child); events.push('launch'); return child;
  } });
  await runtime.start();
  down = false;
  const restart = runtime.restart();
  expect(events).toEqual(['launch', 'SIGTERM']);
  expect(children).toHaveLength(1);
  finishExit();
  await new Promise((done) => setTimeout(done, 10));
  expect(children).toHaveLength(1); // The old workerd can outlive its Wrangler parent.
  down = true; await restart;
  expect(children).toHaveLength(2);
  expect(unexpected).toBe(0);
  children[1].exitCode = 1; children[1].emit('exit');
  expect(unexpected).toBe(1);
  readiness = false;
  const killed = new Promise((done) => { onKill = done; });
  const failed = runtime.restart();
  await killed;
  expect(events.at(-1)).toBe('SIGTERM');
  finishExit();
  await expect(failed).rejects.toThrow('did not become ready');
});

it('refuses to launch or adopt an existing runtime on the Worker port', async () => {
  let launches = 0;
  const runtime = ownedWorker({ launch: () => { launches++; }, ready: async () => true, isDown: async () => false, onUnexpectedExit: () => {} });
  await expect(runtime.start()).rejects.toThrow('already occupied');
  expect(launches).toBe(0);
});
