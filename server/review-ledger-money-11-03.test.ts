// The actual SQLite ledger and fake accepted/network outcomes, entirely in memory.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Answers, Ledger, type ReserveRequest, type Sql, type SqlValue, type Transaction } from './ledger';
import { runCall, type LedgerPort } from './call';
import { POOLS, SLOTS } from './pools';
import { readPiece, SHAPES } from './shapes';
import { reservationMicros } from './prices';
import { parseScore } from '../score';
import { pieceInput } from '../app/arrange';

function setup() {
  const db = new DatabaseSync(':memory:');
  const sql: Sql = { exec(query: string, ...args: SqlValue[]) { const rows = db.prepare(query).all(...args) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
  const transaction: Transaction = (fn) => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const ledger = new Ledger(sql, transaction);
  const answers = new Answers(sql);
  ledger.setup(POOLS); answers.setup();
  const port: LedgerPort = {
    reserve: async (r) => ledger.reserve(r), claimCached: async (r) => ledger.claimCached(r),
    dispatch: async (id) => ledger.dispatch(id), settle: async (id, c, d) => ledger.settle(id, c, d), uncertain: async (id, d) => ledger.uncertain(id, d),
    cached: async (h) => answers.get(h), remember: async (h, s, b) => answers.put(h, s, b),
  };
  let next = 0;
  const request = (pool: string): ReserveRequest => ({ attemptId: String(++next), requestHash: String(next), pool, visitor: 'review-visitor', shape: 'arrange', reserveMicros: 1000, model: 'review-model', priceVersion: 'review-price', leaseMs: 300_000, slots: SLOTS[pool]! });
  return { ledger, port, request };
}

it('has a per-visitor public limit for every paid hosted shape, including write_theme', () => {
  const publicPool = POOLS.find((p) => p.id === 'public')!;
  for (const shape of Object.values(SHAPES).filter((s) => !s.devOnly)) expect(publicPool.perVisitor[shape.name], shape.name).toBeGreaterThan(0);
  expect(publicPool.perVisitor.write_theme).toBe(1);
});

it('does not let calls on visitor keys consume the three public execution slots', () => {
  const { ledger, request } = setup();
  for (let k = 0; k < 3; k++) {
    const own = request('own');
    expect(ledger.reserve(own)).toEqual({ ok: true });
    expect(ledger.dispatch(own.attemptId)).toBe(true);
  }
  expect(ledger.reserve(request('public')), 'The configured public pool still has zero running calls and three free slots').toEqual({ ok: true });
});

it('keeps unknown first-request exposure when a fast response loss is followed by a successful retry', async () => {
  const { ledger, port } = setup();
  const saved = JSON.parse(readFileSync('test-fixtures/contract-arrangement.json', 'utf8'));
  const score = parseScore(readFileSync('test-fixtures/contract-score.musicxml', 'utf8'));
  const input = pieceInput(score, score.parts[0]!, 0, score.parts[0]!.measures.length - 1);
  expect(readPiece.parse(input)).not.toBeNull();
  let requestsAccepted = 0;
  const fetchImpl = (async () => {
    requestsAccepted++;
    if (requestsAccepted === 1) {
      // This mock represents an upstream that accepted the request, then the
      // connection dropped before any response/usage reached the client.
      throw new TypeError('response connection reset after upstream acceptance');
    }
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(saved.read.answer) }] }] }));
  }) as typeof fetch;
  const result = await runCall(readPiece, input, { attemptId: 'review-fast-reset', pool: 'public', visitor: 'review-visitor', key: 'review-fake-owner', ledger: port, slots: SLOTS.public!, fetchImpl });
  // Disabling the retry or separately accounting for it are both valid repairs.
  // The safety invariant is that a response loss cannot erase unknown exposure.
  expect(requestsAccepted).toBeGreaterThanOrEqual(1);
  expect(result.status).toBe(requestsAccepted === 1 ? 'fallback' : 'ok');
  expect(ledger.balance('public')!.committedMicros, 'No first-request usage was received, so that exposure cannot be replaced by the second request tiny charge').toBeGreaterThanOrEqual(reservationMicros(readPiece.maxOutputTokens));
});

it('keeps a normal own key out of the ledger, response and upstream request body', async () => {
  const { ledger, port } = setup();
  const score = parseScore(readFileSync('test-fixtures/contract-score.musicxml', 'utf8'));
  const input = pieceInput(score, score.parts[0]!, 0, score.parts[0]!.measures.length - 1);
  const saved = JSON.parse(readFileSync('test-fixtures/contract-arrangement.json', 'utf8'));
  const fakeKey = 'review-visitor-token';
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${fakeKey}`);
    expect(String(init?.body)).not.toContain(fakeKey);
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(saved.read.answer) }] }] }));
  }) as typeof fetch;
  const result = await runCall(readPiece, input, { attemptId: 'review-own-key', pool: 'own', visitor: 'review-visitor', key: fakeKey, ledger: port, slots: SLOTS.own!, fetchImpl });
  expect(result).toMatchObject({ status: 'ok' });
  expect(JSON.stringify(ledger.attempt('review-own-key'))).not.toContain(fakeKey);
  expect(JSON.stringify(result)).not.toContain(fakeKey);
});

it('does not let full public slots make a visitor key wait', () => {
  const { ledger, request } = setup();
  for (let k = 0; k < SLOTS.public!; k++) {
    const pub = request('public');
    expect(ledger.reserve(pub)).toEqual({ ok: true });
    expect(ledger.dispatch(pub.attemptId)).toBe(true);
  }
  expect(ledger.reserve(request('public'))).toEqual({ ok: false, reason: 'busy' });
  expect(ledger.reserve(request('own'))).toEqual({ ok: true });
});
