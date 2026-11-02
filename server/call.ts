// One Spark call, from request to answer: the cache, the reservation, the call, the check and the
// settlement, in that order. The ledger sits behind a port, because on Cloudflare it lives in a
// Durable Object and every step is a remote call.
import type { CacheClaim, Refusal, ReserveRequest, ReserveResult } from "./ledger";
import { CONTEXT_WINDOW, costMicros, PRICES, reservationMicros, SEARCH_QUALIFIED } from "./prices";
import type { AnyShape } from "./shapes";
import { callSpark, MODEL, type SparkCall, type SparkEvent, type Source } from "./spark";

export interface LedgerPort {
  reserve(r: ReserveRequest): Promise<ReserveResult>;
  claimCached(r: CacheClaim): Promise<ReserveResult>;
  dispatch(attemptId: string): Promise<boolean>;
  settle(attemptId: string, chargedMicros: number, detail: string): Promise<unknown>;
  uncertain(attemptId: string, detail: string): Promise<unknown>;
  cached(hash: string): Promise<string | null>;
  remember(hash: string, shape: string, body: string): Promise<void>;
}

export interface CallContext {
  attemptId: string;
  pool: string;
  /** A hashed key for whoever is calling: never an address or a name. */
  visitor: string;
  key: string;
  ledger: LedgerPort;
  /** Calls allowed at once, across everyone. */
  slots: number;
  fetchImpl?: typeof fetch;
  /** Streams the call and hands each piece here. An answer from the cache has none. */
  onEvent?: (event: SparkEvent) => void;
}

export type Fallback = Refusal | "bad-input" | "disabled" | "timeout" | "network" | "failed" | "rejected";

export type CallResult =
  | { status: "ok"; answer: unknown; sources: Source[]; cached: boolean }
  | { status: "fallback"; reason: Fallback };

export async function runCall(shape: AnyShape, raw: unknown, ctx: CallContext): Promise<CallResult> {
  // A call whose cost has no qualified bound is never sent (review L1): search, or a model whose
  // context window isn't the one the reservation assumes.
  if ((shape.maxSearches && !SEARCH_QUALIFIED) || MODEL !== CONTEXT_WINDOW.model) return { status: "fallback", reason: "disabled" };
  const input = shape.parse(raw);
  if (input === null) return { status: "fallback", reason: "bad-input" };
  const prompt = shape.build(input);
  const hash = await sha256(stableJson({ shape: shape.name, version: shape.version, model: MODEL, input }));

  const hit = await ctx.ledger.cached(hash);
  if (hit) {
    // Even a free answer goes through the attempt check, so a reused attempt id with a changed
    // request is still a conflict (review L3). One step, at no cost, holding no slot.
    const claimed = await ctx.ledger.claimCached({
      attemptId: ctx.attemptId,
      requestHash: hash,
      pool: ctx.pool,
      shape: shape.name,
      visitor: ctx.visitor,
      model: MODEL,
      priceVersion: PRICES.version,
    });
    if (!claimed.ok && claimed.reason !== "duplicate") return { status: "fallback", reason: claimed.reason };
    return { status: "ok", ...(JSON.parse(hit) as { answer: unknown; sources: Source[] }), cached: true };
  }

  const call: SparkCall = {
    ...prompt,
    schemaName: shape.name,
    effort: shape.effort,
    maxOutputTokens: shape.maxOutputTokens,
    deadlineMs: shape.deadlineMs,
    cacheKey: `motifold-${shape.version}`,
    maxSearches: shape.maxSearches,
    safetyId: ctx.visitor.slice(0, 64),
    onEvent: ctx.onEvent,
  };
  const reserveMicros = reservationMicros(shape.maxOutputTokens);
  const reserved = await ctx.ledger.reserve({
    attemptId: ctx.attemptId,
    requestHash: hash,
    pool: ctx.pool,
    shape: shape.name,
    visitor: ctx.visitor,
    reserveMicros,
    model: MODEL,
    priceVersion: PRICES.version,
    leaseMs: shape.deadlineMs + 30_000,
    slots: ctx.slots,
  });
  if (!reserved.ok) return { status: "fallback", reason: reserved.reason };
  if (!(await ctx.ledger.dispatch(ctx.attemptId))) return { status: "fallback", reason: "failed" };

  const outcome = await callSpark(call, ctx.key, ctx.fetchImpl);
  if (outcome.status === "unknown") {
    await ctx.ledger.uncertain(ctx.attemptId, JSON.stringify(outcome));
    return { status: "fallback", reason: outcome.reason === "timeout" ? "timeout" : outcome.reason === "network" ? "network" : "failed" };
  }
  const charged = costMicros(outcome.usage, outcome.searches);
  const log = {
    usage: outcome.usage,
    searches: outcome.searches,
    ms: outcome.ms,
    reservedMicros: reserveMicros,
    chargedMicros: charged,
    // The bound is an assumption until real calls confirm it: any call over it is logged loudly.
    overBound: charged > reserveMicros,
  };
  if (outcome.status === "unusable") {
    await ctx.ledger.settle(ctx.attemptId, charged, JSON.stringify({ ...log, unusable: outcome.reason, detail: outcome.detail }));
    return { status: "fallback", reason: "failed" };
  }
  // A check that throws on an answer it didn't expect still refuses it, and the known charge settles (CH3).
  let problem: string | null;
  try {
    problem = shape.check(input, outcome.answer);
  } catch {
    problem = "the check couldn't read the answer";
  }
  if (problem) {
    const answer = JSON.stringify(outcome.answer).slice(0, 4000);
    await ctx.ledger.settle(ctx.attemptId, charged, JSON.stringify({ ...log, rejected: problem, answer }));
    return { status: "fallback", reason: "rejected" };
  }
  await ctx.ledger.settle(ctx.attemptId, charged, JSON.stringify(log));
  const body = { answer: outcome.answer, sources: outcome.sources };
  await ctx.ledger.remember(hash, shape.name, JSON.stringify(body));
  return { status: "ok", ...body, cached: false };
}

const encoder = new TextEncoder();

export async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON with every object's keys sorted, so equal inputs hash the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
