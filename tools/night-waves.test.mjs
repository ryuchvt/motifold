// Local fake HTTP upstreams only. No Worker, provider, key or shared ledger is used.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { approvedRun, attemptExposure, createGuard, recordingProfile, sqliteLedger } from './live-rehearsal.mjs';

const servers = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); }))); });
async function listen(server) { servers.push(server); await new Promise(done => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
const base = { capMicros: 44_048_076, committedMicros: 21_048_076, dailyMicros: null, todayMicros: 0 };
const reservation = 1_480_720;
const post = (origin, id = randomUUID()) => fetch(`${origin}/api/spark/arrange`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-motifold-record-case': 'wave-local-test' }, body: JSON.stringify({ attemptId: id, input: { only: 'A local fake' } }) });
const until = async predicate => { const end = Date.now() + 3000; while (!predicate()) { if (Date.now() > end) throw Error('Local condition did not become ready'); await new Promise(done => setTimeout(done, 2)); } };
function ledgerFor(rows, changes = {}) {
  const ledger = {
    balance: () => ({ ...base, committedMicros: base.committedMicros + [...rows.values()].reduce((sum, row) => sum + attemptExposure(row), 0), ...changes }),
    attempt: id => rows.get(id) ?? null,
    snapshot(ids) { return { balance: this.balance(), attempts: new Map(ids.map(id => [id, this.attempt(id)])) }; },
  };
  return ledger;
}
const opts = (upstream, ledger, change = {}) => ({ upstream, ledger, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => reservation, ceilingMicros: 23_000_000, armed: true, waveWidth: 2, afterSettled: async () => {}, ...change });
async function heldUpstream(rows, events, getGate) {
  const pending = [];
  const url = await listen(createServer(async (request, response) => {
    if (request.url === '/api/ledger') { if (getGate) { events.push('get-wait'); await getGate; } events.push('get'); response.end('{}'); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks));
    const index = pending.length;
    rows.set(attemptId, { state: 'dispatched', reserved_micros: reservation }); events.push(`start-${index}`);
    pending.push({ attemptId, finish(reply = { status: 'ok', cached: false, answer: {} }, charge = 1000) {
      rows.set(attemptId, { state: reply.reason === 'network' ? 'uncertain' : 'settled', reserved_micros: reservation, charged_micros: reply.reason === 'network' ? null : charge });
      events.push(`end-${index}`); response.end(JSON.stringify(reply));
    } });
  }));
  return { url, pending };
}

it('seals at most two requests, waits for both before one restart, and keeps queued GETs and the next wave out', async () => {
  const rows = new Map(), events = [], records = [];
  const upstream = await heldUpstream(rows, events);
  let releaseRestart; const restart = new Promise(done => { releaseRestart = done; });
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { record: entry => records.push(entry), afterSettled: async () => { events.push('restart-start'); await restart; events.push('restart-ready'); } }));
  const origin = await listen(guard.server);
  const a = post(origin), b = post(origin);
  await until(() => upstream.pending.length === 2);
  const get = fetch(`${origin}/api/ledger`), c = post(origin);
  upstream.pending[0].finish(); await (await a).text();
  await new Promise(done => setTimeout(done, 20));
  expect(events).toEqual(['start-0', 'start-1', 'end-0']);
  upstream.pending[1].finish(); await (await b).text();
  await until(() => events.includes('restart-start'));
  expect(events).not.toContain('get'); expect(upstream.pending).toHaveLength(2);
  releaseRestart(); await (await get).text();
  await until(() => upstream.pending.length === 3);
  expect(events.indexOf('get')).toBeGreaterThan(events.indexOf('restart-ready'));
  expect(events.indexOf('start-2')).toBeGreaterThan(events.indexOf('get'));
  upstream.pending[2].finish(); await (await c).text();
  await until(() => records.filter(entry => entry.kind === 'worker-isolation' && entry.phase === 'ready').length === 2);
  expect(records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'drained').map(entry => entry.size)).toEqual([2, 1]);
  expect(records.filter(entry => entry.sent === 'releasing').map(entry => [entry.waveId, entry.waveSlot, entry.waveCapacity])).toEqual([[1, 0, 2], [1, 1, 2], [2, 0, 2]]);
});

it('admits a second page four logical seconds later while the first is still in flight, bypassing a queued GET', async () => {
  const rows = new Map(), events = [];
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server);
  const a = post(origin); await until(() => upstream.pending.length === 1);
  const get = fetch(`${origin}/api/ledger`); now += 4000;
  const b = post(origin); await until(() => upstream.pending.length === 2);
  expect(events).not.toContain('get'); expect(events).not.toContain('restart');
  upstream.pending[0].finish(); await (await a).text();
  expect(events).not.toContain('restart');
  upstream.pending[1].finish(); await (await b).text();
  await (await get).text();
  expect(events.indexOf('get')).toBeGreaterThan(events.indexOf('restart'));
});

it('seals a single-request wave at its first completion and admits no late request to the retiring runtime', async () => {
  const rows = new Map(), events = [];
  const upstream = await heldUpstream(rows, events);
  let releaseRestart; const restarted = new Promise(done => { releaseRestart = done; });
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { afterSettled: async () => { events.push('restart-start'); await restarted; events.push('restart-ready'); } }));
  const origin = await listen(guard.server), a = post(origin);
  await until(() => upstream.pending.length === 1);
  upstream.pending[0].finish(); await (await a).text(); await until(() => events.includes('restart-start'));
  const b = post(origin); await new Promise(done => setTimeout(done, 30));
  expect(upstream.pending).toHaveLength(1);
  releaseRestart(); await until(() => upstream.pending.length === 2);
  expect(events.indexOf('start-1')).toBeGreaterThan(events.indexOf('restart-ready'));
  upstream.pending[1].finish(); await (await b).text();
});

it('seals as soon as a terminal streamed result arrives, even before its HTTP body closes', async () => {
  const rows = new Map(), events = []; let closeFirst, sent = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(attemptId, { state: 'settled', reserved_micros: reservation, charged_micros: 1000 });
    if (sent === 1) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"kind":"result","result":{"status":"ok","cached":false,"answer":{}}}\n\n');
      closeFirst = () => response.end();
    } else response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} }));
  }));
  const guard = createGuard(opts(upstream, ledgerFor(rows), { afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server), a = await post(origin), reader = a.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"result"');
  const b = post(origin); await new Promise(done => setTimeout(done, 30));
  expect(sent).toBe(1); expect(events).toEqual([]);
  closeFirst(); while (!(await reader.read()).done) {}
  await (await b).text(); expect(sent).toBe(2); expect(events).toContain('restart');
});

it('freezes new work on an unknown result while allowing the other released stream to settle, without a restart', async () => {
  const rows = new Map(), events = [], records = [];
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { record: entry => records.push(entry), afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server), a = post(origin), b = post(origin);
  await until(() => upstream.pending.length === 2);
  upstream.pending[0].finish({ status: 'fallback', reason: 'network' }); await (await a).text();
  const c = post(origin); await new Promise(done => setTimeout(done, 50));
  expect(upstream.pending).toHaveLength(2); expect(events).not.toContain('restart');
  upstream.pending[1].finish(); await (await b).text();
  expect(await (await c).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(guard.exposure()).toBe(reservation + 1000);
  expect(events).not.toContain('restart');
  expect(records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'stopped')).toHaveLength(2);
});

it.each(['session', 'pool', 'daily'])('counts the first absent-row provisional reservation before admitting a second request against the %s cap', async cap => {
  const rows = new Map(), records = [], sent = [];
  const changes = cap === 'pool' ? { capMicros: base.committedMicros + reservation + 1 } : cap === 'daily' ? { dailyMicros: reservation + 1 } : {};
  let finish;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent.push(attemptId);
    // Deliberately no row yet. The guard's durable reservation must still count.
    finish = () => { rows.set(attemptId, { state: 'settled', reserved_micros: reservation, charged_micros: 1000 }); response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} })); };
  }));
  const guard = createGuard(opts(upstream, ledgerFor(rows, changes), { ceilingMicros: cap === 'session' ? reservation + 1 : 23_000_000, record: entry => records.push(entry) }));
  const origin = await listen(guard.server), a = post(origin), b = post(origin);
  await until(() => records.some(entry => entry.sent === false) && sent.length === 1);
  expect(sent).toHaveLength(1); expect(guard.exposure()).toBe(reservation);
  expect(records.find(entry => entry.sent === false).blocked).toBe(`${cap}-ceiling`);
  finish(); const replies = await Promise.all([a, b]);
  expect((await Promise.all(replies.map(reply => reply.json()))).map(reply => reply.status).sort()).toEqual(['fallback', 'ok']);
});

it.each([2, 4])('retains the same approved23 ceiling and a prior missing-row hold across a width%i guard restart', async waveWidth => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-wave-approved-'));
  try {
    const profile = recordingProfile('night-204'), file = join(folder, 'approved.json');
    const first = approvedRun(file, base, profile);
    first.owned.set(randomUUID(), { reservation: 22_000_000, noCharge: false }); first.persist();
    const resumed = approvedRun(file, base, profile); let sent = 0;
    const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
    const guard = createGuard(opts(upstream, ledgerFor(new Map()), { waveWidth, owned: resumed.owned, persist: resumed.persist }));
    expect(await (await post(await listen(guard.server))).json()).toMatchObject({ reason: 'budget' });
    expect(sent).toBe(0); expect(guard.exposure()).toBe(22_000_000); expect(resumed.snapshot().ceilingMicros).toBe(23_000_000);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it.each([['cached', 'cached', 0], ['cached', 'ok', 1], ['rejected', 'ok', 1]])('handles %s plus %s as one drained wave with %i restarts', async (first, second, count) => {
  const rows = new Map(), events = [], records = [];
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { continueSettledFailures: true, afterSettled: async () => events.push('restart'), record: entry => records.push(entry) }));
  const origin = await listen(guard.server), a = post(origin), b = post(origin);
  await until(() => upstream.pending.length === 2);
  for (const [index, type] of [first, second].entries()) upstream.pending[index].finish(type === 'rejected' ? { status: 'fallback', reason: 'rejected' } : { status: 'ok', cached: type === 'cached', answer: {} }, type === 'cached' ? 0 : 1000);
  await Promise.all([a, b].map(async reply => (await reply).text()));
  await until(() => records.some(entry => entry.kind === 'worker-wave' && entry.phase === 'drained'));
  expect(events.filter(event => event === 'restart')).toHaveLength(count);
  expect(guard.exposure()).toBe([first, second].filter(type => type !== 'cached').length * 1000);
});

it('blocks subsequent work after a failed wave restart without retrying either settled attempt', async () => {
  const rows = new Map(), events = [];
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { afterSettled: async () => { events.push('restart'); throw Error('Local fake restart failure'); } }));
  const origin = await listen(guard.server), a = post(origin), b = post(origin);
  await until(() => upstream.pending.length === 2);
  upstream.pending.forEach(job => job.finish());
  await Promise.all([a, b].map(async reply => (await reply).text()));
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(upstream.pending).toHaveLength(2); expect(events.filter(event => event === 'restart')).toHaveLength(1); expect(guard.exposure()).toBe(2000);
});

it('takes a coherent readonly SQLite snapshot and never changes any existing attempt or cap', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-wave-snapshot-')), file = join(folder, 'ledger.sqlite');
  const db = new DatabaseSync(file);
  let ledger;
  try {
    db.exec('CREATE TABLE pools(id TEXT,cap_micros INTEGER,daily_micros INTEGER); CREATE TABLE attempts(id TEXT,shape TEXT,pool TEXT,state TEXT,reserved_micros INTEGER,charged_micros INTEGER,detail TEXT,day INTEGER,lease_until INTEGER)');
    db.prepare('INSERT INTO pools VALUES(?,?,?)').run('dev', base.capMicros, null);
    db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)').run('held', 'arrange', 'dev', 'uncertain', reservation, null, '{}', Math.floor(Date.now() / 86400000), null);
    const before = JSON.stringify(db.prepare('SELECT * FROM attempts').all()), changes = db.prepare('SELECT total_changes() AS n').get();
    ledger = await sqliteLedger(file);
    const snapshot = ledger.snapshot(['held', 'not-yet-visible']);
    expect(snapshot.balance.committedMicros).toBe(reservation); expect(snapshot.attempts.get('held')).toMatchObject({ state: 'uncertain', reserved_micros: reservation }); expect(snapshot.attempts.get('not-yet-visible')).toBeNull();
    expect(JSON.stringify(db.prepare('SELECT * FROM attempts').all())).toBe(before); expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(db.prepare('SELECT cap_micros FROM pools').get().cap_micros).toBe(base.capMicros);
  } finally { ledger?.close(); db.close(); rmSync(folder, { recursive: true, force: true }); }
});

it('permits only widths1/2/4 and requires atomic accounting and owned isolation for concurrent waves', () => {
  const ledger = ledgerFor(new Map());
  expect(() => createGuard(opts('http://127.0.0.1:8790', ledger, { waveWidth: 3 }))).toThrow('Wave width');
  expect(() => createGuard(opts('http://127.0.0.1:8790', ledger, { waveWidth: 5 }))).toThrow('Wave width');
  for (const width of [2, 4]) {
    expect(() => createGuard(opts('http://127.0.0.1:8790', { balance: ledger.balance, attempt: ledger.attempt }, { waveWidth: width }))).toThrow('atomic');
    expect(() => createGuard(opts('http://127.0.0.1:8790', ledger, { waveWidth: width, afterSettled: undefined }))).toThrow('isolation');
  }
});

it('fills four already queued paid slots, drains all four before one restart, and holds GETs and a fifth call behind it', async () => {
  const rows = new Map(), events = [], records = [];
  let releaseGet, releaseRestart, restarts = 0, received = 0, getReceived = 0;
  const getGate = new Promise(done => { releaseGet = done; }), restartGate = new Promise(done => { releaseRestart = done; });
  const upstream = await heldUpstream(rows, events, getGate);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { waveWidth: 4, record: entry => records.push(entry), afterSettled: async () => {
    restarts++; events.push(`restart-start-${restarts}`);
    if (restarts === 1) await restartGate;
    events.push(`restart-ready-${restarts}`);
  } }));
  guard.server.on('request', request => { if (request.url.startsWith('/api/spark/')) request.once('end', () => { received++; }); else if (request.url === '/api/ledger') getReceived++; });
  const origin = await listen(guard.server), bootstrap = fetch(`${origin}/api/ledger`);
  await until(() => events.includes('get-wait'));
  const ids = Array.from({ length: 4 }, () => randomUUID()), calls = ids.map(id => post(origin, id));
  const callOf = job => calls[ids.indexOf(job.attemptId)];
  await until(() => received === 4);
  expect(upstream.pending).toHaveLength(0);
  releaseGet(); await (await bootstrap).text();
  await until(() => upstream.pending.length === 4);
  expect(guard.exposure()).toBe(4 * reservation);
  const queuedGet = fetch(`${origin}/api/ledger`);
  await until(() => getReceived === 2);
  const fifth = post(origin);
  for (const index of [2, 0, 3]) { const job = upstream.pending[index]; job.finish(); await (await callOf(job)).text(); }
  expect(restarts).toBe(0); expect(upstream.pending).toHaveLength(4);
  expect(events.filter(event => event === 'get')).toHaveLength(1);
  upstream.pending[1].finish(); await (await callOf(upstream.pending[1])).text();
  await until(() => restarts === 1);
  expect(upstream.pending).toHaveLength(4); expect(events).not.toContain('restart-ready-1');
  releaseRestart(); await (await queuedGet).text(); await until(() => upstream.pending.length === 5);
  expect(events.lastIndexOf('get')).toBeGreaterThan(events.indexOf('restart-ready-1'));
  expect(events.indexOf('start-4')).toBeGreaterThan(events.lastIndexOf('get'));
  upstream.pending[4].finish(); await (await fifth).text();
  await until(() => records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'drained').length === 2);
  expect(restarts).toBe(2);
  expect(records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'drained').map(entry => entry.size)).toEqual([4, 1]);
  expect(records.filter(entry => entry.sent === 'releasing').map(entry => [entry.waveId, entry.waveSlot, entry.waveCapacity])).toEqual([[1, 0, 4], [1, 1, 4], [1, 2, 4], [1, 3, 4], [2, 0, 4]]);
});

it('admits third and fourth late streams to an open wave despite a queued GET', async () => {
  const rows = new Map(), events = []; let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { waveWidth: 4, afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server), calls = [post(origin)];
  await until(() => upstream.pending.length === 1);
  const get = fetch(`${origin}/api/ledger`);
  for (let size = 2; size <= 4; size++) { now += 4000; calls.push(post(origin)); await until(() => upstream.pending.length === size); }
  expect(events).not.toContain('get'); expect(events).not.toContain('restart');
  upstream.pending.forEach(job => job.finish());
  await Promise.all(calls.map(async call => (await call).text())); await (await get).text();
  expect(events.filter(event => event === 'restart')).toHaveLength(1);
  expect(events.indexOf('get')).toBeGreaterThan(events.indexOf('restart'));
});

it('seals a partly filled four-slot wave at a terminal SSE result before body closure', async () => {
  const rows = new Map(), events = []; let closeFirst, sent = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(attemptId, { state: 'settled', reserved_micros: reservation, charged_micros: 1000 });
    if (sent === 1) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"kind":"result","result":{"status":"ok","cached":false,"answer":{}}}\n\n');
      closeFirst = () => response.end();
    } else response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} }));
  }));
  const guard = createGuard(opts(upstream, ledgerFor(rows), { waveWidth: 4, afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server), first = await post(origin), reader = first.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"result"');
  const later = [post(origin), post(origin), post(origin)];
  await new Promise(done => setTimeout(done, 25)); expect(sent).toBe(1); expect(events).toEqual([]);
  closeFirst(); while (!(await reader.read()).done) {}
  await Promise.all(later.map(async call => (await call).text()));
  expect(sent).toBe(4); expect(events[0]).toBe('restart');
});

it('freezes after one unknown result and drains the other three released calls without restarting or admitting a fifth', async () => {
  const rows = new Map(), events = [];
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { waveWidth: 4, afterSettled: async () => events.push('restart') }));
  const origin = await listen(guard.server), ids = Array.from({ length: 4 }, () => randomUUID()), calls = ids.map(id => post(origin, id));
  const callOf = job => calls[ids.indexOf(job.attemptId)];
  await until(() => upstream.pending.length === 4);
  upstream.pending[0].finish({ status: 'fallback', reason: 'network' }); await (await callOf(upstream.pending[0])).text();
  const fifth = post(origin);
  await new Promise(done => setTimeout(done, 25)); expect(upstream.pending).toHaveLength(4); expect(events).not.toContain('restart');
  for (const index of [3, 1, 2]) { const job = upstream.pending[index]; job.finish(); await (await callOf(job)).text(); }
  expect(await (await fifth).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(upstream.pending).toHaveLength(4); expect(events).not.toContain('restart');
  expect(guard.exposure()).toBe(reservation + 3000);
  expect(rows.get(upstream.pending[0].attemptId)).toMatchObject({ state: 'uncertain', reserved_micros: reservation });
});

it.each(['session', 'pool', 'daily'])('counts all three absent-row holds before rejecting the fourth release against the %s cap', async cap => {
  const rows = new Map(), records = [], sent = [], finishes = [];
  const changes = cap === 'pool' ? { capMicros: base.committedMicros + 3 * reservation + 1 } : cap === 'daily' ? { dailyMicros: 3 * reservation + 1 } : {};
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent.push(attemptId);
    finishes.push(() => { rows.set(attemptId, { state: 'settled', reserved_micros: reservation, charged_micros: 1000 }); response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} })); });
  }));
  const owned = new Map();
  const guard = createGuard(opts(upstream, ledgerFor(rows, changes), { waveWidth: 4, owned, ceilingMicros: cap === 'session' ? 3 * reservation + 1 : 23_000_000, record: entry => records.push(entry) }));
  const origin = await listen(guard.server), calls = Array.from({ length: 4 }, () => post(origin));
  await until(() => sent.length === 3 && records.some(entry => entry.sent === false));
  expect(rows.size).toBe(0); expect(owned.size).toBe(3); expect(guard.exposure()).toBe(3 * reservation);
  expect(records.find(entry => entry.sent === false).blocked).toBe(`${cap}-ceiling`);
  finishes.forEach(finish => finish());
  const replies = await Promise.all(calls.map(async call => (await call).json()));
  expect(replies.map(reply => reply.status).sort()).toEqual(['fallback', 'ok', 'ok', 'ok']);
});

it.each([2, 4])('handles a local refusal outside a width%i wave without stopping the next valid request', async waveWidth => {
  const rows = new Map(), events = [];
  const upstream = await heldUpstream(rows, events);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { waveWidth }));
  const origin = await listen(guard.server);
  expect(await (await fetch(`${origin}/api/not-allowed`)).json()).toMatchObject({ reason: 'unknown-route' });
  expect(upstream.pending).toHaveLength(0); expect(guard.exposure()).toBe(0);
  const next = post(origin); await until(() => upstream.pending.length === 1);
  upstream.pending[0].finish(); expect(await (await next).json()).toMatchObject({ status: 'ok' });
});

it('seals at a local terminal refusal before admitting another queued job to the same wave', async () => {
  const rows = new Map(), events = [], records = []; let releaseGet, received = 0;
  const gate = new Promise(done => { releaseGet = done; });
  const upstream = await heldUpstream(rows, events, gate);
  const guard = createGuard(opts(upstream.url, ledgerFor(rows), { waveWidth: 4, armed: false, record: entry => records.push(entry) }));
  guard.server.on('request', request => { if (request.url.startsWith('/api/spark/')) request.once('end', () => { received++; }); });
  const origin = await listen(guard.server), bootstrap = fetch(`${origin}/api/ledger`);
  await until(() => events.includes('get-wait'));
  const calls = Array.from({ length: 4 }, () => post(origin)); await until(() => received === 4);
  releaseGet(); await (await bootstrap).text();
  const replies = await Promise.all(calls.map(async call => (await call).json()));
  expect(replies.every(reply => reply.reason === 'rehearsal-unarmed')).toBe(true);
  expect(upstream.pending).toHaveLength(0); expect(guard.exposure()).toBe(0);
  await until(() => records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'drained').length === 4);
  expect(records.filter(entry => entry.kind === 'worker-wave' && entry.phase === 'drained').map(entry => entry.size)).toEqual([1, 1, 1, 1]);
});
