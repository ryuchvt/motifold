import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { Ledger, type AccessRequest, type Pool, type ReserveRequest, type Sql, type SqlValue, type Transaction } from "./ledger";
import { POOLS } from "./pools";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
const time = Date.UTC(2026, 10, 4, 12);
function setup(changes: Partial<Pool> = {}) {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  const sql: Sql = { exec(query, ...args: SqlValue[]) { const rows = db.prepare(query).all(...args) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
  const transaction: Transaction = fn => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  let now = time, next = 0;
  const ledger = new Ledger(sql, transaction, () => now);
  const pool: Pool = { id: "public", capMicros: 10_000, dailyMicros: null, opensAt: null, closesAt: null, perVisitor: {}, ...changes };
  ledger.setup([pool, { ...pool, id: "own", perVisitor: {} }]);
  const access: AccessRequest = { pool: pool.id, visitor: "one-private-hash", shape: "read_piece", reserveMicros: 1000, slots: 2, model: "local-model", priceVersion: "local-price" };
  const request = (change: Partial<ReserveRequest> = {}): ReserveRequest => { const id = String(++next); return { ...access, attemptId: id, requestHash: id, leaseMs: 1000, ...change }; };
  const snapshot = () => JSON.stringify(["pools", "attempts", "breakers"].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  return { ledger, db, access, request, pool, snapshot, now: (value: number) => { now = value; } };
}

it("repeated availability checks do not claim quotas, change leases, or mutate the ledger", () => {
  const x = setup({ perVisitor: { read_piece: 2 } });
  const before = x.snapshot(), changes = x.db.prepare("SELECT total_changes() AS n").get();
  for (let i = 0; i < 20; i++) expect(x.ledger.access(x.access)).toEqual({ state: "available", resetAt: null });
  expect(x.snapshot()).toBe(before);
  expect(x.db.prepare("SELECT total_changes() AS n").get()).toEqual(changes);
  expect(x.ledger.reserve(x.request())).toEqual({ ok: true });
});

it("counts uncertain holds against total and daily availability without releasing them at a day boundary", () => {
  const x = setup({ dailyMicros: 1500 });
  const r = x.request(); x.ledger.reserve(r); x.ledger.dispatch(r.attemptId); x.ledger.uncertain(r.attemptId, "No usage returned");
  const held = x.ledger.attempt(r.attemptId);
  expect(x.ledger.access(x.access)).toEqual({ state: "daily", resetAt: Date.UTC(2026, 10, 5) });
  x.now(Date.UTC(2026, 10, 5));
  expect(x.ledger.access(x.access)).toEqual({ state: "available", resetAt: null });
  expect(x.ledger.attempt(r.attemptId)).toEqual(held);
  expect(x.ledger.access({ ...x.access, reserveMicros: 9001 })).toEqual({ state: "totalunavailable", resetAt: null });
});

it("checks the caller's stage-specific UTC quota, including free cached claims, without consuming another", () => {
  const x = setup({ perVisitor: { read_piece: 2, arrange: 10 } });
  for (let i = 0; i < 2; i++) expect(x.ledger.claimCached(x.request())).toEqual({ ok: true });
  const before = x.snapshot();
  expect(x.ledger.access(x.access)).toEqual({ state: "userlimit", resetAt: Date.UTC(2026, 10, 5) });
  expect(x.ledger.access({ ...x.access, shape: "arrange" }).state).toBe("available");
  expect(x.ledger.access({ ...x.access, visitor: "another-private-hash" }).state).toBe("available");
  expect(x.snapshot()).toBe(before);
  x.now(Date.UTC(2026, 10, 5));
  expect(x.ledger.access(x.access).state).toBe("available");
});

it("counts only active leases in the selected pool, leaving expired money held", () => {
  const x = setup();
  for (let i = 0; i < 2; i++) x.ledger.reserve(x.request());
  const before = x.snapshot();
  expect(x.ledger.access(x.access)).toEqual({ state: "busy", resetAt: null });
  expect(x.ledger.access({ ...x.access, pool: "own" }).state).toBe("available");
  x.now(time + 1001);
  expect(x.ledger.access(x.access).state).toBe("available");
  expect(x.ledger.balance("public")!.committedMicros).toBe(2000);
  expect(x.snapshot()).toBe(before);
});

it("reports closed pools and broken price bounds without revealing the ledger", () => {
  const x = setup({ opensAt: time + 500 });
  expect(x.ledger.access(x.access)).toEqual({ state: "totalunavailable", resetAt: time + 500 });
  x.now(time + 501);
  const r = x.request(); x.ledger.reserve(r); x.ledger.dispatch(r.attemptId); x.ledger.settle(r.attemptId, 1001, "Over the bound");
  expect(x.ledger.access(x.access)).toEqual({ state: "serviceerror", resetAt: null });
  expect(x.ledger.access({ ...x.access, pool: "missing" })).toEqual({ state: "totalunavailable", resetAt: null });
});

it("applies only the newly approved dev cap while preserving every existing attempt and the public allowance", () => {
  const x = setup();
  x.ledger.setup(POOLS.map(pool => pool.id === "dev" ? { ...pool, capMicros: 44_048_076 } : pool));
  const held = x.request({ pool: "dev", reserveMicros: 16_000_000 }); x.ledger.reserve(held); x.ledger.dispatch(held.attemptId); x.ledger.uncertain(held.attemptId, "Held until billing is checked");
  const paid = x.request({ pool: "dev", reserveMicros: 26_616_543 }); x.ledger.reserve(paid); x.ledger.dispatch(paid.attemptId); x.ledger.settle(paid.attemptId, 26_616_543, "Known usage");
  const before = x.db.prepare("SELECT * FROM attempts ORDER BY id").all();
  x.ledger.setup(POOLS);
  expect(x.db.prepare("SELECT * FROM attempts ORDER BY id").all()).toEqual(before);
  expect(x.ledger.balance("dev")).toMatchObject({ capMicros: 47_616_543, committedMicros: 42_616_543, dailyMicros: null });
  expect(x.ledger.balance("dev")!.capMicros - x.ledger.balance("dev")!.committedMicros).toBe(5_000_000);
  expect(x.ledger.balance("public")).toMatchObject({ capMicros: 100_000_000, dailyMicros: 15_000_000 });
  expect(x.ledger.balance("own")).toMatchObject({ capMicros: 100_000_000_000, committedMicros: 0 });
});
