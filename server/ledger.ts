// The spend ledger (R8B §4). One SQLite database, in one Durable Object, holds every pool and every
// attempt. A call reserves its worst case inside one synchronous transaction before anything is sent,
// and settles on the usage Meta reports. Money that may have been spent is never released on a guess.
// Money is in micro-dollars.

export type SqlValue = string | number | null;

/** The part of Durable Object SQLite storage the ledger uses. Node's own SQLite stands in for tests. */
export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
}

export type Transaction = <T>(fn: () => T) => T;

export interface Pool {
  id: string;
  /** Everything this pool may ever spend. */
  capMicros: number;
  /** What it may spend in one UTC day. Null: no daily allowance. */
  dailyMicros: number | null;
  /** When it opens and closes, in ms since 1970. Null: always. */
  opensAt: number | null;
  closesAt: number | null;
  /** Calls one visitor may make in a UTC day, per call shape. A shape not listed has no limit. */
  perVisitor: Record<string, number>;
}

/**
 * reserved: authorised and holding the money and the slot, not yet sent.
 * dispatched: sent to Meta, outcome not yet known.
 * settled: Meta reported usage, and `charged_micros` is what it cost.
 * uncertain: sent, but no usage came back. Keeps its whole reservation until checked against billing.
 * released: never sent. Costs nothing.
 */
export type AttemptState = "reserved" | "dispatched" | "settled" | "uncertain" | "released";

export interface ReserveRequest {
  attemptId: string;
  requestHash: string;
  pool: string;
  shape: string;
  visitor: string;
  reserveMicros: number;
  model: string;
  priceVersion: string;
  /** How long the attempt may hold an execution slot. A crash frees the slot after this, never the money. */
  leaseMs: number;
  /** Calls allowed at once, across every pool. */
  slots: number;
}

/** "stopped": a call cost more than its reservation, so the bound is wrong and nothing more is sent until it's checked. */
export type Refusal = "closed" | "empty" | "today" | "quota" | "busy" | "conflict" | "duplicate" | "stopped";

export type ReserveResult = { ok: true } | { ok: false; reason: Refusal; state?: AttemptState };

/** A finished answer handed out again: it costs nothing and runs nothing, so no money, slot or lease. */
export type CacheClaim = Omit<ReserveRequest, "reserveMicros" | "leaseMs" | "slots">;

export interface Balance {
  capMicros: number;
  committedMicros: number;
  dailyMicros: number | null;
  todayMicros: number;
}

const DAY_MS = 86_400_000;

/** The UTC day a moment falls in, as a number: days since 1970. */
export function dayOf(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

// What an attempt holds against its pool: the charge once settled, nothing once released, otherwise
// the whole reservation.
const COMMITTED = `COALESCE(SUM(CASE state WHEN 'settled' THEN charged_micros WHEN 'released' THEN 0 ELSE reserved_micros END), 0)`;

export class Ledger {
  constructor(
    private readonly sql: Sql,
    private readonly transaction: Transaction,
    private readonly now: () => number = Date.now,
  ) {}

  /** Creates the tables and writes the pools from the code's configuration. Attempts are kept. */
  setup(pools: Pool[]): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      cap_micros INTEGER NOT NULL,
      daily_micros INTEGER,
      opens_at INTEGER,
      closes_at INTEGER,
      per_visitor TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      pool TEXT NOT NULL,
      shape TEXT NOT NULL,
      visitor TEXT NOT NULL,
      day INTEGER NOT NULL,
      reserved_micros INTEGER NOT NULL,
      charged_micros INTEGER,
      state TEXT NOT NULL,
      model TEXT NOT NULL,
      price_version TEXT NOT NULL,
      lease_until INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      detail TEXT
    )`);
    // A charge over its reservation disproves the bound for that model and price list (review L1).
    // Cleared only by hand, after checking Meta's billing.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS breakers (
      model TEXT NOT NULL,
      price_version TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (model, price_version)
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS attempts_pool_day ON attempts (pool, day)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS attempts_visitor_day ON attempts (visitor, day, shape)`);
    this.transaction(() => {
      for (const p of pools) {
        this.sql.exec(
          `INSERT INTO pools (id, cap_micros, daily_micros, opens_at, closes_at, per_visitor) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET cap_micros = excluded.cap_micros, daily_micros = excluded.daily_micros,
             opens_at = excluded.opens_at, closes_at = excluded.closes_at, per_visitor = excluded.per_visitor`,
          p.id,
          p.capMicros,
          p.dailyMicros,
          p.opensAt,
          p.closesAt,
          JSON.stringify(p.perVisitor),
        );
      }
    });
  }

  /**
   * Checks the pool, the visitor's allowance and the free slots, and reserves the full amount, all in
   * one transaction. Only after this returns ok may the call be sent.
   */
  reserve(r: ReserveRequest): ReserveResult {
    return this.transaction((): ReserveResult => {
      const now = this.now();
      const day = dayOf(now);
      const known = this.known(r);
      if (known) return known;
      if (this.tripped(r.model, r.priceVersion)) return { ok: false, reason: "stopped" };
      const pool = this.open(r.pool, now);
      if (!pool) return { ok: false, reason: "closed" };
      if (this.committed(pool.id) + r.reserveMicros > pool.capMicros) return { ok: false, reason: "empty" };
      if (pool.dailyMicros !== null && this.committed(pool.id, day) + r.reserveMicros > pool.dailyMicros) {
        return { ok: false, reason: "today" };
      }
      if (this.quotaUsed(pool, r, day)) return { ok: false, reason: "quota" };
      const running = this.one(
        `SELECT COUNT(*) AS n FROM attempts WHERE state IN ('reserved', 'dispatched') AND lease_until > ?`,
        now,
      );
      if (Number(running?.n ?? 0) >= r.slots) return { ok: false, reason: "busy" };

      this.sql.exec(
        `INSERT INTO attempts (id, request_hash, pool, shape, visitor, day, reserved_micros, state, model, price_version,
           lease_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)`,
        r.attemptId,
        r.requestHash,
        pool.id,
        r.shape,
        r.visitor,
        day,
        r.reserveMicros,
        r.model,
        r.priceVersion,
        now + r.leaseMs,
        now,
        now,
      );
      return { ok: true };
    });
  }

  /**
   * Records a cached answer handed out, settled at no cost, in one transaction (review L3). The same
   * attempt and visitor checks as a paid call, but no breaker, no money and no execution slot, so it
   * never makes a paid call wait.
   */
  claimCached(r: CacheClaim): ReserveResult {
    return this.transaction((): ReserveResult => {
      const now = this.now();
      const day = dayOf(now);
      const known = this.known(r);
      if (known) return known;
      const pool = this.open(r.pool, now);
      if (!pool) return { ok: false, reason: "closed" };
      if (this.quotaUsed(pool, r, day)) return { ok: false, reason: "quota" };
      this.sql.exec(
        `INSERT INTO attempts (id, request_hash, pool, shape, visitor, day, reserved_micros, charged_micros, state, model,
           price_version, lease_until, created_at, updated_at, detail) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'settled', ?, ?, NULL, ?, ?, ?)`,
        r.attemptId,
        r.requestHash,
        pool.id,
        r.shape,
        r.visitor,
        day,
        r.model,
        r.priceVersion,
        now,
        now,
        JSON.stringify({ cached: true }),
      );
      return { ok: true };
    });
  }

  /**
   * Marks a reserved attempt as sent. False if it isn't reserved, or its slot lease has run out (the
   * slot may belong to someone else by now: review L2), and then it must not be sent. Also false if
   * a breaker tripped after it was reserved (recheck L1): it is released, since it never went out.
   */
  dispatch(attemptId: string): boolean {
    return this.transaction(() => {
      const row = this.one(`SELECT state, lease_until, model, price_version FROM attempts WHERE id = ?`, attemptId);
      if (row?.state !== "reserved" || row.lease_until === null || Number(row.lease_until) <= this.now()) return false;
      if (this.tripped(String(row.model), String(row.price_version))) {
        this.sql.exec(
          `UPDATE attempts SET state = 'released', lease_until = NULL, updated_at = ?, detail = 'stopped before sending' WHERE id = ?`,
          this.now(),
          attemptId,
        );
        return false;
      }
      this.sql.exec(`UPDATE attempts SET state = 'dispatched', updated_at = ? WHERE id = ?`, this.now(), attemptId);
      return true;
    });
  }

  /** Records what a sent call cost. Idempotent: a second settlement changes nothing. */
  settle(attemptId: string, chargedMicros: number, detail: string): "settled" | "already" | "not-sent" {
    return this.transaction(() => {
      const row = this.one(`SELECT state, reserved_micros, model, price_version FROM attempts WHERE id = ?`, attemptId);
      if (row?.state === "settled") return "already";
      if (row?.state !== "dispatched" && row?.state !== "uncertain") return "not-sent";
      if (chargedMicros > Number(row.reserved_micros)) {
        this.sql.exec(
          `INSERT INTO breakers (model, price_version, attempt_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          String(row.model),
          String(row.price_version),
          attemptId,
          this.now(),
        );
      }
      this.sql.exec(
        `UPDATE attempts SET state = 'settled', charged_micros = ?, lease_until = NULL, updated_at = ?, detail = ? WHERE id = ?`,
        chargedMicros,
        this.now(),
        detail,
        attemptId,
      );
      return "settled";
    });
  }

  /** A sent call whose cost is unknown: free the slot, keep the money. */
  uncertain(attemptId: string, detail: string): boolean {
    return this.move(attemptId, ["dispatched"], "uncertain", { detail });
  }

  /** An attempt that was never sent gives its money back. A sent one never does. */
  release(attemptId: string, detail: string): boolean {
    return this.move(attemptId, ["reserved"], "released", { detail });
  }

  balance(poolId: string): Balance | null {
    const pool = this.pool(poolId);
    if (!pool) return null;
    return {
      capMicros: pool.capMicros,
      committedMicros: this.committed(poolId),
      dailyMicros: pool.dailyMicros,
      todayMicros: this.committed(poolId, dayOf(this.now())),
    };
  }

  attempt(attemptId: string): Record<string, SqlValue> | null {
    return this.one(`SELECT * FROM attempts WHERE id = ?`, attemptId);
  }

  private move(attemptId: string, from: AttemptState[], to: AttemptState, opts: { keepLease?: boolean; detail?: string }): boolean {
    return this.transaction(() => {
      const row = this.one(`SELECT state FROM attempts WHERE id = ?`, attemptId);
      if (!row || !from.includes(row.state as AttemptState)) return false;
      this.sql.exec(
        `UPDATE attempts SET state = ?, updated_at = ?, detail = COALESCE(?, detail)${opts.keepLease ? "" : ", lease_until = NULL"} WHERE id = ?`,
        to,
        this.now(),
        opts.detail ?? null,
        attemptId,
      );
      return true;
    });
  }

  /** A reused attempt id: the same request is a duplicate, a changed one a conflict. Null if it's new. */
  private known(r: CacheClaim): ReserveResult | null {
    const existing = this.one(`SELECT request_hash, state FROM attempts WHERE id = ?`, r.attemptId);
    if (!existing) return null;
    return existing.request_hash === r.requestHash
      ? { ok: false, reason: "duplicate", state: existing.state as AttemptState }
      : { ok: false, reason: "conflict" };
  }

  /** The pool, if it exists and is open now. */
  private open(poolId: string, now: number): Pool | null {
    const pool = this.pool(poolId);
    if (!pool) return null;
    if ((pool.opensAt !== null && now < pool.opensAt) || (pool.closesAt !== null && now >= pool.closesAt)) return null;
    return pool;
  }

  private quotaUsed(pool: Pool, r: CacheClaim, day: number): boolean {
    const limit = pool.perVisitor[r.shape];
    if (limit === undefined) return false;
    const used = this.one(
      `SELECT COUNT(*) AS n FROM attempts WHERE visitor = ? AND day = ? AND shape = ? AND pool = ? AND state != 'released'`,
      r.visitor,
      day,
      r.shape,
      pool.id,
    );
    return Number(used?.n ?? 0) >= limit;
  }

  private tripped(model: string, priceVersion: string): boolean {
    return this.one(`SELECT 1 AS hit FROM breakers WHERE model = ? AND price_version = ?`, model, priceVersion) !== null;
  }

  private committed(poolId: string, day?: number): number {
    const row =
      day === undefined
        ? this.one(`SELECT ${COMMITTED} AS micros FROM attempts WHERE pool = ?`, poolId)
        : this.one(`SELECT ${COMMITTED} AS micros FROM attempts WHERE pool = ? AND day = ?`, poolId, day);
    return Number(row?.micros ?? 0);
  }

  private pool(id: string): Pool | null {
    const row = this.one(`SELECT * FROM pools WHERE id = ?`, id);
    if (!row) return null;
    return {
      id,
      capMicros: Number(row.cap_micros),
      dailyMicros: row.daily_micros === null ? null : Number(row.daily_micros),
      opensAt: row.opens_at === null ? null : Number(row.opens_at),
      closesAt: row.closes_at === null ? null : Number(row.closes_at),
      perVisitor: JSON.parse(String(row.per_visitor)) as Record<string, number>,
    };
  }

  private one(query: string, ...bindings: SqlValue[]): Record<string, SqlValue> | null {
    return this.sql.exec(query, ...bindings).toArray()[0] ?? null;
  }
}

/** Finished answers, by the hash of everything that went into them. A second identical request costs nothing. */
export class Answers {
  constructor(
    private readonly sql: Sql,
    private readonly now: () => number = Date.now,
  ) {}

  setup(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS answers (
      hash TEXT PRIMARY KEY,
      shape TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
  }

  get(hash: string): string | null {
    const row = this.sql.exec(`SELECT body FROM answers WHERE hash = ?`, hash).toArray()[0];
    return row ? String(row.body) : null;
  }

  put(hash: string, shape: string, body: string): void {
    this.sql.exec(
      `INSERT INTO answers (hash, shape, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING`,
      hash,
      shape,
      body,
      this.now(),
    );
  }
}
