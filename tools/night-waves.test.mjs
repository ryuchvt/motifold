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
async function heldUpstream(rows, events) {
  const pending = [];
  const url = await listen(createServer(async (request, response) => {
    if (request.url === '/api/ledger') { events.push('get'); response.end('{}'); return; }
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

it('retains the same approved23 ceiling and a prior missing-row hold across a wave-guard restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-wave-approved-'));
  try {
    const profile = recordingProfile('night-204'), file = join(folder, 'approved.json');
    const first = approvedRun(file, base, profile);
    first.owned.set(randomUUID(), { reservation: 22_000_000, noCharge: false }); first.persist();
    const resumed = approvedRun(file, base, profile); let sent = 0;
    const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
    const guard = createGuard(opts(upstream, ledgerFor(new Map()), { owned: resumed.owned, persist: resumed.persist }));
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
    db.exec('CREATE TABLE pools(id TEXT,cap_micros INTEGER,daily_micros INTEGER); CREATE TABLE attempts(id TEXT,shape TEXT,pool TEXT,state TEXT,reserved_micros INTEGER,charged_micros INTEGER,detail TEXT,day INTEGER)');
    db.prepare('INSERT INTO pools VALUES(?,?,?)').run('dev', base.capMicros, null);
    db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)').run('held', 'arrange', 'dev', 'uncertain', reservation, null, '{}', Math.floor(Date.now() / 86400000));
    const before = JSON.stringify(db.prepare('SELECT * FROM attempts').all()), changes = db.prepare('SELECT total_changes() AS n').get();
    ledger = await sqliteLedger(file);
    const snapshot = ledger.snapshot(['held', 'not-yet-visible']);
    expect(snapshot.balance.committedMicros).toBe(reservation); expect(snapshot.attempts.get('held')).toMatchObject({ state: 'uncertain', reserved_micros: reservation }); expect(snapshot.attempts.get('not-yet-visible')).toBeNull();
    expect(JSON.stringify(db.prepare('SELECT * FROM attempts').all())).toBe(before); expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(db.prepare('SELECT cap_micros FROM pools').get().cap_micros).toBe(base.capMicros);
  } finally { ledger?.close(); db.close(); rmSync(folder, { recursive: true, force: true }); }
});

it('refuses wave widths above2 or waves without atomic accounting and owned isolation', () => {
  const ledger = ledgerFor(new Map());
  expect(() => createGuard(opts('http://127.0.0.1:8790', ledger, { waveWidth: 3 }))).toThrow('Wave width');
  expect(() => createGuard(opts('http://127.0.0.1:8790', { balance: ledger.balance, attempt: ledger.attempt }))).toThrow('atomic');
  expect(() => createGuard(opts('http://127.0.0.1:8790', ledger, { afterSettled: undefined }))).toThrow('isolation');
});
