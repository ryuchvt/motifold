// Temporary approval files, fake loopback HTTP and readonly fake SQLite only. No actual ledger or provider.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { approvedRun, attemptExposure, createGuard, focusedCuteRequest, recordingProfile, sqliteLedger, validateFocusedCuteMode, validateFocusedCuteStart } from './live-rehearsal.mjs';
import { POOLS } from '../server/pools';
import { reservationMicros } from '../server/prices';

const profile = recordingProfile('focused-cute-test');
const prior = { capMicros: 44_048_076, committedMicros: 42_616_543, dailyMicros: null, todayMicros: 0 };
const reservation = reservationMicros(40_000), folders = [], servers = [];
const input = { intent: 'arrange', where: 'inside', moreBars: 0 };
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function folder() { const p = mkdtempSync(join(tmpdir(), 'motifold-cute-budget-')); folders.push(p); return p; }
async function listen(server) { servers.push(server); await new Promise(done => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
function snapshot(balance = prior, attempts = new Map(), pendingAttempts = []) { return { balance, attempts, pendingAttempts }; }
function fixture() {
  const file = join(folder(), profile.recordName), run = approvedRun(file, prior, profile), rows = new Map();
  const ledger = {
    balance: () => ({ ...prior, capMicros: profile.poolCapMicros, committedMicros: prior.committedMicros + [...rows.values()].reduce((n, row) => n + attemptExposure(row), 0) }),
    attempt: id => rows.get(id) ?? null,
    snapshot(ids) { return snapshot(this.balance(), new Map(ids.map(id => [id, this.attempt(id)]))); },
  };
  return { file, run, rows, ledger };
}
const post = (origin, changes = {}) => fetch(`${origin}/api/spark/${changes.shape ?? 'arrange'}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...((changes.captureCase ?? 'cute-arrange') ? { 'x-motifold-record-case': changes.captureCase ?? 'cute-arrange' } : {}) },
  body: JSON.stringify({ attemptId: changes.id ?? randomUUID(), input: changes.input ?? input }),
});
function guardOptions(ledger, run) { return { ledger, owned: run.owned, persist: run.persist, ceilingMicros: profile.ceilingMicros, armed: true, requireCaptureCase: true, allowRequest: focusedCuteRequest, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: reservationMicros }; }

it('adds exactly the separately approved $5 above committed exposure, preserving the old approval bytes', () => {
  const p = folder(), oldFiles = [];
  for (const name of ['rehearsal', 'night-204']) {
    const old = recordingProfile(name), file = join(p, old.recordName);
    const run = approvedRun(file, { ...prior, capMicros: old.poolCapMicros }, old);
    run.owned.set(randomUUID(), { reservation, noCharge: false }); run.persist();
    oldFiles.push([file, readFileSync(file)]);
  }
  expect(profile).toMatchObject({ ceilingMicros: 5_000_000, initialCommittedMicros: 42_616_543, priorPoolCapMicros: 44_048_076, poolCapMicros: 47_616_543 });
  expect(profile.poolCapMicros).toBe(profile.initialCommittedMicros + profile.ceilingMicros);
  expect(profile.poolCapMicros).not.toBe(prior.capMicros + 5_000_000);
  expect(POOLS.find(p => p.id === 'dev').capMicros).toBe(profile.poolCapMicros);
  expect(POOLS.find(p => p.id === 'public')).toMatchObject({ capMicros: 100_000_000, dailyMicros: 15_000_000 });
  expect(POOLS.find(p => p.id === 'own').capMicros).toBe(100_000_000_000);
  validateFocusedCuteStart(snapshot());
  const file = join(p, profile.recordName), run = approvedRun(file, prior, profile), initial = run.snapshot();
  expect(initial.initialBalance).toEqual(prior);
  const id = randomUUID(); run.owned.set(id, { reservation, noCharge: false }); run.persist();
  const row = { id, pool: 'dev', state: 'settled', reserved_micros: reservation, charged_micros: 50_000 };
  const next = { ...prior, capMicros: profile.poolCapMicros, committedMicros: prior.committedMicros + 50_000 };
  validateFocusedCuteStart(snapshot(next, new Map([[id, row]])), run.snapshot());
  const resumed = approvedRun(file, next, profile);
  expect(resumed.snapshot().started).toBe(initial.started);
  expect(resumed.snapshot().initialBalance).toEqual(prior);
  expect(resumed.owned.get(id)).toEqual({ reservation, noCharge: false });
  for (const [oldFile, bytes] of oldFiles) expect(readFileSync(oldFile)).toEqual(bytes);
});

it.each([
  ['old rehearsal cap', { ...prior, capMicros: 26_000_000 }],
  ['untracked raised cap', { ...prior, capMicros: profile.poolCapMicros }],
  ['arbitrary cap', { ...prior, capMicros: 50_000_000 }],
  ['lower exposure', { ...prior, committedMicros: prior.committedMicros - 1 }],
  ['higher exposure', { ...prior, committedMicros: prior.committedMicros + 1 }],
  ['changed daily policy', { ...prior, dailyMicros: 10_000_000 }],
])('refuses a fresh focused approval from %s before persisting it', (_name, balance) => {
  const file = join(folder(), profile.recordName);
  expect(() => validateFocusedCuteStart(snapshot(balance))).toThrow();
  expect(() => approvedRun(file, balance, profile)).toThrow('baseline changed');
  expect(existsSync(file)).toBe(false);
});

it.each(['uncertain', 'reserved', 'dispatched', 'provisional', 'global-active'])('refuses %s on restart without changing the saved approval or hold', state => {
  const { run, rows, ledger, file } = fixture(), id = randomUUID();
  if (state !== 'global-active') { run.owned.set(id, { reservation, noCharge: false }); run.persist(); }
  if (!['provisional', 'global-active'].includes(state)) rows.set(id, { id, pool: 'dev', state, reserved_micros: reservation, charged_micros: null, lease_until: 1 });
  const before = readFileSync(file), held = JSON.stringify([...rows]);
  const x = ledger.snapshot([...run.owned.keys()]); if (state === 'global-active') x.pendingAttempts.push(id);
  expect(() => validateFocusedCuteStart(x, run.snapshot())).toThrow();
  expect(readFileSync(file)).toEqual(before); expect(JSON.stringify([...rows])).toBe(held);
});

it('rejects baseline resets and retains the ceiling and zero-charge cache ownership across restarts', () => {
  const { run, ledger, file } = fixture();
  const id = randomUUID(); run.owned.set(id, { reservation, noCharge: true }); run.persist();
  const before = readFileSync(file), x = ledger.snapshot([id]);
  expect(() => validateFocusedCuteStart(x, run.snapshot())).not.toThrow();
  for (const change of [{ committedMicros: 0 }, { committedMicros: prior.committedMicros - 1 }, { committedMicros: prior.committedMicros + 1 }, { capMicros: 44_048_076 }, { capMicros: 49_048_076 }]) {
    expect(() => validateFocusedCuteStart({ ...x, balance: { ...x.balance, ...change } }, run.snapshot())).toThrow();
  }
  expect(() => validateFocusedCuteStart(x, { ...run.snapshot(), ceilingMicros: 6_000_000 })).toThrow('approval changed');
  expect(readFileSync(file)).toEqual(before);
});

it('requires serial owned isolation before any real-ledger or Worker startup', () => {
  expect(() => validateFocusedCuteMode({ startWorker: true, isolate: true, waveWidth: 1 })).not.toThrow();
  for (const options of [{ startWorker: false, isolate: true, waveWidth: 1 }, { startWorker: true, isolate: false, waveWidth: 1 }, { startWorker: true, isolate: true, waveWidth: 2 }, { startWorker: true, isolate: true, waveWidth: 4 }]) {
    expect(() => validateFocusedCuteMode(options)).toThrow('requires serial');
  }
  const result = spawnSync(process.execPath, ['tools/live-rehearsal.mjs', '--profile', 'focused-cute-test', '--armed'], { encoding: 'utf8' });
  expect(result.status).toBe(1); expect(result.stderr).toContain('requires serial');
});

it('admits only the exact two tagged jobs and excludes matrix, other moods, Expand and repairs before forwarding', async () => {
  let sent = 0; const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
  const { run, ledger } = fixture();
  const guard = createGuard({ ...guardOptions(ledger, run), upstream, shapes: Object.fromEntries(['read_bars', 'distribute', 'plan_options', 'plan_recompose', 'write_theme', 'arrange', 'fit_form'].map(n => [n, { maxOutputTokens: 40_000 }])) });
  const origin = await listen(guard.server);
  for (const request of [
    { captureCase: '' }, { captureCase: 'cute-arrange-a' }, { captureCase: 'recompose-sad-full-orchestra' },
    { input: { ...input, intent: 'expand' } }, { input: { ...input, moreBars: 16 } }, { input: { ...input, fix: { ask: 'repair', current: 'C3@0+1' } } },
    { shape: 'fit_form' }, { shape: 'plan_recompose' },
    { captureCase: 'cute-sad-recompose', shape: 'plan_recompose', input: { ask: 'The mood I want: hopeful.', freedom: 2, where: 'after', moreBars: 32 } },
  ]) expect((await (await post(origin, request)).json()).status).toBe('fallback');
  expect(sent).toBe(0); expect(run.owned.size).toBe(0);
  expect(focusedCuteRequest({ captureCase: 'cute-arrange', shape: 'read_bars', input: {} })).toBe(true);
  expect(focusedCuteRequest({ captureCase: 'cute-arrange', shape: 'distribute', input })).toBe(true);
  expect(focusedCuteRequest({ captureCase: 'cute-sad-recompose', shape: 'write_theme', input: { ask: 'The mood I want: sad.', freedom: 2, where: 'after', moreBars: 32 } })).toBe(true);
  expect(focusedCuteRequest({ captureCase: 'cute-sad-recompose', shape: 'arrange', input: { ask: 'The mood I want: sad.', freedom: 2, where: 'inside', moreBars: 0, seed: { tune: 'C4' } } })).toBe(true);
});

it('persists full reservations before forwarding, isolates success at the $5 boundary, then refuses more work', async () => {
  const { run, ledger, rows } = fixture(), spent = randomUUID(), seen = [], isolation = [];
  run.owned.set(spent, { reservation: 3_519_280, noCharge: false }); run.persist();
  rows.set(spent, { id: spent, pool: 'dev', state: 'settled', reserved_micros: 3_519_280, charged_micros: 3_519_280 });
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks));
    expect(run.owned.get(attemptId)).toEqual({ reservation, noCharge: false });
    seen.push(attemptId); rows.set(attemptId, { id: attemptId, pool: 'dev', state: 'settled', reserved_micros: reservation, charged_micros: reservation });
    response.end(JSON.stringify({ status: 'ok', cached: false, answer: {} }));
  }));
  const receipts = [], guard = createGuard({ ...guardOptions(ledger, run), upstream, afterSettled: async e => isolation.push(e.attemptId), record: e => receipts.push(e) });
  const origin = await listen(guard.server), id = randomUUID();
  expect(await (await post(origin, { id })).json()).toMatchObject({ status: 'ok' });
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'budget' });
  expect(seen).toEqual([id]); expect(isolation).toEqual([id]); expect(guard.exposure()).toBe(5_000_000);
  expect(ledger.balance().committedMicros).toBe(profile.poolCapMicros);
  expect(receipts.at(-1)).toMatchObject({ sent: false, blocked: 'session-ceiling' });
});

it('retains a new unknown reservation, stops physical calls and refuses a restart without reusing the old review', async () => {
  const { run, ledger, rows, file } = fixture(); let sent = 0, isolation = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(attemptId, { id: attemptId, pool: 'dev', state: 'uncertain', reserved_micros: reservation, charged_micros: null });
    response.end(JSON.stringify({ status: 'fallback', reason: 'network' }));
  }));
  const guard = createGuard({ ...guardOptions(ledger, run), upstream, afterSettled: async () => isolation++ });
  const origin = await listen(guard.server);
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'network' });
  expect(await (await post(origin)).json()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(sent).toBe(1); expect(isolation).toBe(0); expect(guard.exposure()).toBe(reservation);
  const before = readFileSync(file);
  expect(() => validateFocusedCuteStart(ledger.snapshot([...run.owned.keys()]), run.snapshot())).toThrow('unknown or unfinished');
  expect(readFileSync(file)).toEqual(before);
});

it('counts historical unknown and expired dispatched holds in the readonly transition baseline without modifying any row', async () => {
  const p = folder(), file = join(p, 'ledger.sqlite'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE pools(id TEXT,cap_micros INTEGER,daily_micros INTEGER); CREATE TABLE attempts(id TEXT,shape TEXT,pool TEXT,state TEXT,reserved_micros INTEGER,charged_micros INTEGER,detail TEXT,day INTEGER,lease_until INTEGER)');
  db.prepare('INSERT INTO pools VALUES(?,?,?)').run('dev', prior.capMicros, null);
  const add = db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)');
  add.run('historical-known', 'arrange', 'dev', 'settled', 21_928_963, 21_928_963, '{}', 0, null);
  for (let i = 0; i < 13; i++) add.run(`historical-unknown-${i}`, 'arrange', 'dev', 'uncertain', i === 0 ? reservationMicros(30_000) : reservation, null, '{}', 0, null);
  add.run('historical-expired', 'arrange', 'dev', 'dispatched', reservation, null, '{}', 0, 1);
  const before = db.prepare('SELECT * FROM attempts ORDER BY id').all(), changes = db.prepare('SELECT total_changes() AS n').get();
  const ledger = await sqliteLedger(file);
  try {
    const x = ledger.snapshot([]); expect(x.balance.committedMicros).toBe(42_616_543);
    expect(() => validateFocusedCuteStart(x)).not.toThrow();
    expect(() => validateFocusedCuteStart({ ...x, balance: { ...x.balance, committedMicros: 42_616_544 } })).toThrow('baseline changed');
    expect(x.pendingAttempts).toEqual([]);
    expect(db.prepare('SELECT * FROM attempts ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
  } finally { ledger.close(); db.close(); }
});
