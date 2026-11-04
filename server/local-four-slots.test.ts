import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Ledger, type ReserveRequest, type Sql, type SqlValue, type Transaction } from "./ledger";
import { POOLS, SLOTS } from "./pools";

it("admits four local dev calls while retaining old money holds, public's three slots and every approved cap", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const sql: Sql = { exec(query: string, ...args: SqlValue[]) { const rows = db.prepare(query).all(...args) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
    const transaction: Transaction = fn => { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
    const ledger = new Ledger(sql, transaction);
    ledger.setup(POOLS);
    let next = 0;
    const request = (pool: string): ReserveRequest => ({ attemptId: `local-${++next}`, requestHash: `local-${next}`, pool, shape: "arrange", visitor: `local-visitor-${next}`, reserveMicros: 1000, model: "local-model", priceVersion: "local-price", leaseMs: 300_000, slots: SLOTS[pool]! });
    const old = request("dev");
    expect(ledger.reserve(old)).toEqual({ ok: true }); expect(ledger.dispatch(old.attemptId)).toBe(true);
    ledger.uncertain(old.attemptId, "Local retained hold");
    const held = ledger.attempt(old.attemptId);
    expect(held).toMatchObject({ state: "uncertain", reserved_micros: 1000 });
    const active = Array.from({ length: 4 }, () => request("dev"));
    for (const call of active) { expect(ledger.reserve(call)).toEqual({ ok: true }); expect(ledger.dispatch(call.attemptId)).toBe(true); }
    expect(ledger.reserve(request("dev"))).toEqual({ ok: false, reason: "busy" });
    expect(ledger.balance("dev")!.committedMicros).toBe(5000);
    for (let k = 0; k < 3; k++) { const call = request("public"); expect(ledger.reserve(call)).toEqual({ ok: true }); expect(ledger.dispatch(call.attemptId)).toBe(true); }
    expect(ledger.reserve(request("public"))).toEqual({ ok: false, reason: "busy" });
    expect(ledger.balance("public")!.committedMicros).toBe(3000);
    ledger.settle(active[0]!.attemptId, 300, "Local settled usage");
    expect(ledger.reserve(request("dev"))).toEqual({ ok: true });
    expect(ledger.balance("dev")!.committedMicros).toBe(5300);
    ledger.setup(POOLS);
    expect(ledger.attempt(old.attemptId)).toEqual(held);
    expect(SLOTS).toEqual({ dev: 4, public: 3, own: 50 });
    expect(ledger.balance("dev")).toMatchObject({ capMicros: 47_616_543, dailyMicros: null });
    expect(ledger.balance("public")).toMatchObject({ capMicros: 100_000_000, dailyMicros: 15_000_000 });
    expect(ledger.balance("own")!.capMicros).toBe(100_000_000_000);
  } finally { db.close(); }
});
