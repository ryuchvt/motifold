// Local fake HTTP and temporary SQLite only. Never reads the operator's actual ledger or audit.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { approvedRun, attemptExposure, createGuard, recordingProfile, reviewRetainedNightHolds, sqliteLedger } from './live-rehearsal.mjs';

const reservation = 1_480_720, profile = recordingProfile('night-204');
const base = { capMicros: profile.poolCapMicros, committedMicros: 21_048_076, dailyMicros: null, todayMicros: 0 };
const folders = [], servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(done => { server.closeAllConnections(); server.close(done); })));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
async function listen(server) { servers.push(server); await new Promise(done => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'motifold-night-recovery-')); folders.push(folder);
  const file = join(folder, 'approved.json'), run = approvedRun(file, base, profile), id = randomUUID();
  run.owned.set(id, { reservation, noCharge: false }); run.persist();
  const rows = new Map([[id, { id, pool: 'dev', state: 'uncertain', reserved_micros: reservation, charged_micros: null }]]);
  const ledger = {
    balance: () => ({ ...base, committedMicros: base.committedMicros + [...rows.values()].reduce((sum, row) => sum + attemptExposure(row), 0) }),
    attempt: id => rows.get(id) ?? null,
    snapshot(ids) { return { balance: this.balance(), attempts: new Map(ids.map(id => [id, this.attempt(id)])), pendingAttempts: [...rows.values()].filter(row => ['reserved', 'dispatched'].includes(row.state)).map(row => row.id) }; },
  };
  const audit = (changes = {}) => ({ version: 1, run: profile.run, started: run.snapshot().started, ceilingMicros: profile.ceilingMicros, reviewedAt: new Date().toISOString(), uncertain: [{ attemptId: id, reservationMicros: reservation }], noPendingAttempts: true, noProvisionalAttempts: true, preserveEveryHold: true, ...changes });
  return { folder, file, run, id, rows, ledger, audit };
}

it('refuses a night restart by default and never changes its retained hold, approval or balance', () => {
  const { run, file, rows, ledger } = fixture();
  const bytes = readFileSync(file, 'utf8'), before = JSON.stringify([...rows]), balance = ledger.balance();
  expect(() => reviewRetainedNightHolds(run, ledger)).toThrow('--review-uncertain');
  expect(readFileSync(file, 'utf8')).toBe(bytes); expect(JSON.stringify([...rows])).toBe(before); expect(ledger.balance()).toEqual(balance);
});

it('leaves a fully settled first run and unrelated historical uncertain holds outside the owned review set', () => {
  const { run, id, ledger, audit } = fixture();
  run.owned.delete(id); run.persist(); // The fixture hold is historical to this approved run.
  expect(reviewRetainedNightHolds(run, ledger)).toBeNull();
  expect(ledger.balance().committedMicros).toBe(base.committedMicros + reservation);
  expect(() => reviewRetainedNightHolds(run, ledger, audit())).toThrow('every exact retained');
});

it.each([
  ['another run', a => ({ ...a, run: 'another-run' })],
  ['another start', a => ({ ...a, started: '2000-01-01T00:00:00.000Z' })],
  ['a new allowance', a => ({ ...a, ceilingMicros: 24_000_000 })],
  ['missing confirmation', a => { const { noPendingAttempts, ...rest } = a; return rest; }],
  ['false pending confirmation', a => ({ ...a, noPendingAttempts: false })],
  ['false provisional confirmation', a => ({ ...a, noProvisionalAttempts: false })],
  ['release instruction', a => ({ ...a, preserveEveryHold: false })],
  ['extra action', a => ({ ...a, releaseHolds: true })],
  ['no exact hold', a => ({ ...a, uncertain: [] })],
  ['another UUID', a => ({ ...a, uncertain: [{ ...a.uncertain[0], attemptId: randomUUID() }] })],
  ['changed reservation', a => ({ ...a, uncertain: [{ ...a.uncertain[0], reservationMicros: reservation - 1 }] })],
  ['duplicate UUID', a => ({ ...a, uncertain: [...a.uncertain, ...a.uncertain] })],
  ['unreviewed extra UUID', a => ({ ...a, uncertain: [...a.uncertain, { attemptId: randomUUID(), reservationMicros: reservation }] })],
  ['review before run', a => ({ ...a, reviewedAt: '2000-01-01T00:00:00.000Z' })],
])('rejects an operator review with %s', (_name, changed) => {
  const { run, ledger, audit } = fixture();
  expect(() => reviewRetainedNightHolds(run, ledger, changed(audit()))).toThrow(/audit/);
});

it.each(['reserved', 'dispatched', 'provisional', 'unowned-pending'])('refuses actual %s work even when an audit claims everything drained', state => {
  const { run, rows, ledger, audit } = fixture(), id = randomUUID();
  if (state !== 'unowned-pending') run.owned.set(id, { reservation, noCharge: false });
  if (state !== 'provisional') rows.set(id, { id, pool: 'dev', state: state === 'unowned-pending' ? 'dispatched' : state, reserved_micros: reservation, charged_micros: null });
  expect(() => reviewRetainedNightHolds(run, ledger, audit())).toThrow(/Pending|provisional/);
});

it('rejects a ledger/approval reservation mismatch and cannot turn an uncertain row into no-charge', () => {
  const { run, rows, id, ledger, audit } = fixture();
  run.owned.get(id).noCharge = true;
  expect(reviewRetainedNightHolds(run, ledger, audit()).uncertain).toEqual([{ attemptId: id, reservationMicros: reservation }]);
  rows.get(id).reserved_micros--;
  expect(() => reviewRetainedNightHolds(run, ledger, audit())).toThrow('reservation does not match');
});

it.each(['session', 'pool', 'daily'])('counts a valid reviewed hold against the unchanged %s cap before any new dispatch', async cap => {
  const { run, rows, ledger, audit } = fixture();
  if (cap === 'session') {
    // Retained settled work plus the reviewed hold leaves less than one worst-case reservation.
    const id = randomUUID(), spent = profile.ceilingMicros - 2 * reservation + 1;
    run.owned.set(id, { reservation: spent, noCharge: false }); rows.set(id, { id, pool: 'dev', state: 'settled', reserved_micros: spent, charged_micros: spent });
  }
  if (cap === 'pool') ledger.balance = () => ({ ...base, committedMicros: base.capMicros - reservation + 1 });
  if (cap === 'daily') ledger.balance = () => ({ ...base, committedMicros: base.committedMicros + reservation, dailyMicros: 2 * reservation - 1, todayMicros: reservation });
  const before = JSON.stringify([...rows]), approved = JSON.stringify(run.snapshot());
  expect(reviewRetainedNightHolds(run, ledger, audit()).uncertain).toHaveLength(1);
  expect(JSON.stringify([...rows])).toBe(before); expect(JSON.stringify(run.snapshot())).toBe(approved);
  let sent = 0; const records = [];
  const upstream = await listen(createServer((_request, response) => { sent++; response.end('{}'); }));
  const guard = createGuard({ upstream, ledger, owned: run.owned, persist: run.persist, armed: true, ceilingMicros: profile.ceilingMicros, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => reservation, record: e => records.push(e) });
  const reply = await fetch(`${await listen(guard.server)}/api/spark/arrange`, { method: 'POST', body: JSON.stringify({ attemptId: randomUUID(), input: {} }) });
  expect(await reply.json()).toMatchObject({ reason: 'budget' }); expect(sent).toBe(0);
  expect(records.at(-1)).toMatchObject({ sent: false, blocked: `${cap}-ceiling` });
  expect(guard.exposure()).toBeGreaterThanOrEqual(reservation);
});

it('stops on the next unknown and rejects reuse of an older review on another startup', async () => {
  const { run, id, rows, ledger, audit } = fixture(), reviewed = audit(), heldBefore = { ...rows.get(id) };
  reviewRetainedNightHolds(run, ledger, reviewed);
  let sent = 0, restarted = 0;
  const upstream = await listen(createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { attemptId } = JSON.parse(Buffer.concat(chunks)); sent++;
    rows.set(attemptId, { id: attemptId, pool: 'dev', state: 'uncertain', reserved_micros: reservation, charged_micros: null });
    response.end(JSON.stringify({ status: 'fallback', reason: 'timeout' }));
  }));
  const guard = createGuard({ upstream, ledger, owned: run.owned, persist: run.persist, armed: true, waveWidth: 2, afterSettled: async () => restarted++, ceilingMicros: profile.ceilingMicros, shapes: { arrange: { maxOutputTokens: 40_000 } }, reserve: () => reservation });
  const origin = await listen(guard.server);
  const post = () => fetch(`${origin}/api/spark/arrange`, { method: 'POST', body: JSON.stringify({ attemptId: randomUUID(), input: {} }) }).then(r => r.json());
  expect(await post()).toMatchObject({ reason: 'timeout' }); expect(await post()).toMatchObject({ reason: 'rehearsal-stopped' });
  expect(sent).toBe(1); expect(restarted).toBe(0); expect(guard.exposure()).toBe(2 * reservation); expect(rows.get(id)).toEqual(heldBefore);
  expect(() => reviewRetainedNightHolds(run, ledger, reviewed)).toThrow('every exact retained');
});

it.each([['reserved', null], ['dispatched', null], ['reserved', 3_600_000], ['dispatched', 3_600_000]])('blocks global %s work with lease delta %s in the same readonly snapshot', async (state, leaseDelta) => {
  const { folder, run, id, audit } = fixture(), file = join(folder, 'ledger.sqlite'), db = new DatabaseSync(file), pending = randomUUID();
  db.exec('CREATE TABLE pools(id TEXT,cap_micros INTEGER,daily_micros INTEGER); CREATE TABLE attempts(id TEXT,shape TEXT,pool TEXT,state TEXT,reserved_micros INTEGER,charged_micros INTEGER,detail TEXT,day INTEGER,lease_until INTEGER)');
  db.prepare('INSERT INTO pools VALUES(?,?,?)').run('dev', profile.poolCapMicros, null);
  const add = db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)');
  add.run(id, 'write_theme', 'dev', 'uncertain', reservation, null, '{}', Math.floor(Date.now() / 86_400_000), null);
  add.run(pending, 'arrange', 'dev', state, reservation, null, '{}', Math.floor(Date.now() / 86_400_000), leaseDelta === null ? null : Date.now() + leaseDelta);
  const before = db.prepare('SELECT * FROM attempts ORDER BY id').all(), ledger = await sqliteLedger(file);
  try {
    expect(ledger.snapshot([id]).pendingAttempts).toEqual([pending]);
    expect(() => reviewRetainedNightHolds(run, ledger, audit())).toThrow('Pending ledger attempts');
    expect(db.prepare('SELECT * FROM attempts ORDER BY id').all()).toEqual(before);
  } finally { ledger.close(); db.close(); }
});

it.each(['reserved', 'dispatched'])('keeps an expired unowned %s hold fully counted but rejects it when owned', async state => {
  const { folder, file: approval, run, id, audit } = fixture(), file = join(folder, 'ledger.sqlite'), db = new DatabaseSync(file), historical = randomUUID();
  db.exec('CREATE TABLE pools(id TEXT,cap_micros INTEGER,daily_micros INTEGER); CREATE TABLE attempts(id TEXT,shape TEXT,pool TEXT,state TEXT,reserved_micros INTEGER,charged_micros INTEGER,detail TEXT,day INTEGER,lease_until INTEGER)');
  db.prepare('INSERT INTO pools VALUES(?,?,?)').run('dev', profile.poolCapMicros, 10_000_000);
  const add = db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)'), day = Math.floor(Date.now() / 86_400_000);
  add.run(id, 'write_theme', 'dev', 'uncertain', reservation, null, '{}', day, null);
  add.run(historical, 'arrange', 'dev', state, reservation, null, 'Expired historical reservation remains unresolved', day, Date.now() - 3_600_000);
  const before = db.prepare('SELECT * FROM attempts ORDER BY id').all(), changes = db.prepare('SELECT total_changes() AS n').get(), bytes = readFileSync(approval, 'utf8'), ledger = await sqliteLedger(file);
  try {
    const snapshot = ledger.snapshot([id]);
    expect(snapshot.pendingAttempts).toEqual([]);
    expect(snapshot.balance).toMatchObject({ committedMicros: 2 * reservation, todayMicros: 2 * reservation });
    expect(reviewRetainedNightHolds(run, ledger, audit()).uncertain).toEqual([{ attemptId: id, reservationMicros: reservation }]);
    expect(attemptExposure(ledger.attempt(historical))).toBe(reservation);
    expect(db.prepare('SELECT * FROM attempts ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(readFileSync(approval, 'utf8')).toBe(bytes);
    // The same expired row cannot be ignored when it belongs to the retained night run.
    run.owned.set(historical, { reservation, noCharge: false }); run.persist();
    const ownedApproval = readFileSync(approval, 'utf8');
    expect(() => reviewRetainedNightHolds(run, ledger, audit())).toThrow('unfinished owned attempt');
    expect(db.prepare('SELECT * FROM attempts ORDER BY id').all()).toEqual(before);
    expect(readFileSync(approval, 'utf8')).toBe(ownedApproval);
  } finally { ledger.close(); db.close(); }
});

it('rejects missing audit paths and the review flag on another profile before any local service starts', () => {
  for (const args of [['--profile', 'night-204', '--review-uncertain'], ['--profile', 'rehearsal', '--review-uncertain', 'not-read.json']]) {
    const result = spawnSync(process.execPath, ['tools/live-rehearsal.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stderr).toContain('--review-uncertain requires');
  }
});
