// @vitest-environment jsdom
// Actual opening hook and ledger. All credit and model responses are synthetic and local.
const sqliteModule = 'node:sqlite';
const { DatabaseSync } = await import(/* @vite-ignore */ sqliteModule) as typeof import('node:sqlite');
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { parseScore } from '../score';
import { runCall, type LedgerPort } from '../server/call';
import { Answers, Ledger, type Sql, type SqlValue, type Transaction } from '../server/ledger';
import { POOLS, SLOTS } from '../server/pools';
import { reservationMicros } from '../server/prices';
import { readPiece, studyScore, type StudyScoreAnswer } from '../server/shapes';
import { useArrange, type Arranged } from './useArrange';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xmlText = readFileSync('test-fixtures/contract-score.musicxml', 'utf8');
const score = parseScore(xmlText);
const part = score.parts[0]!;
const loaded = { fileName: 'contract-score.musicxml', xmlText, score };
const range = { from: 0, to: part.measures.length - 1 };
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('keeps the required read available when the optional study finishes and frees enough daily credit', async () => {
  const db = new DatabaseSync(':memory:');
  const sql: Sql = { exec(q: string, ...a: SqlValue[]) { const rows = db.prepare(q).all(...a) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
  const transaction: Transaction = (fn) => { db.exec('BEGIN'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const ledger = new Ledger(sql, transaction);
  const answers = new Answers(sql);
  ledger.setup(POOLS); answers.setup();
  // $13.50 already used from the approved $15 daily public line. No real spending occurs.
  expect(ledger.reserve({ attemptId: 'earlier-spend', requestHash: 'earlier', pool: 'public', visitor: 'other', shape: 'earlier', reserveMicros: 13_500_000, model: 'earlier', priceVersion: 'earlier', leaseMs: 1000, slots: 3 })).toEqual({ ok: true });
  ledger.dispatch('earlier-spend'); ledger.settle('earlier-spend', 13_500_000, 'local fixture');
  const port: LedgerPort = {
    reserve: async (r) => ledger.reserve(r), claimCached: async (r) => ledger.claimCached(r), dispatch: async (id) => ledger.dispatch(id),
    settle: async (id, c, d) => ledger.settle(id, c, d), uncertain: async (id, d) => ledger.uncertain(id, d),
    cached: async (h) => answers.get(h), remember: async (h, s, b) => answers.put(h, s, b),
  };
  let dispatchedStudy!: () => void;
  const studyStarted = new Promise<void>((resolve) => { dispatchedStudy = resolve; });
  let finishStudy!: (response: Response) => void;
  const studyReply = new Promise<Response>((resolve) => { finishStudy = resolve; });
  const savedReading = JSON.parse(readFileSync('test-fixtures/contract-arrangement.json', 'utf8')).read.answer;
  const coreProvider = vi.fn(async () => Response.json({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(savedReading) }] }] }));
  const results: { shape: string; result: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const context = { attemptId: body.attemptId, pool: 'public', visitor: 'judge', key: 'review-fake-owner', ledger: port, slots: SLOTS.public! };
    if (url.endsWith('study_score')) {
      const result = await runCall(studyScore, body.input, { ...context, fetchImpl: (async () => { dispatchedStudy(); return studyReply; }) as typeof fetch });
      results.push({ shape: 'study_score', result });
      return Response.json(result);
    }
    // Study is sent first by askPiece. Keep that valid execution order deterministic.
    await Promise.race([studyStarted, new Promise<void>((done) => setTimeout(done, 10))]);
    const result = await runCall(readPiece, body.input, { ...context, fetchImpl: coreProvider as typeof fetch });
    results.push({ shape: 'read_piece', result });
    const bars = body.input.written.map((w: { bar: string }) => w.bar);
    const answer: StudyScoreAnswer = { overview: 'A line and accompaniment.', sections: [{ from: bars[0], to: bars.at(-1), form: 'A', name: 'Opening', mood: 'searching', what: 'One phrase returns' }], harmony: [{ from: bars[0], to: bars.at(-1), note: 1, chord: '?', numeral: '?' }], moments: [] };
    finishStudy(Response.json({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }));
    return Response.json(result);
  });
  let current!: Arranged;
  function Host() { current = useArrange(loaded, part, range, null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(<Host />)); unmount = () => root.unmount();
  await act(() => current.askPiece());
  expect(results.some((r) => r.shape === 'read_piece')).toBe(true);
  // The study now goes after the reading has its answer (Claude, review F3), so it finishes a moment later.
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(current.study.status).toBe('ready');
  });
  const balance = ledger.balance('public')!;
  expect(balance.dailyMicros! - balance.todayMicros).toBeGreaterThan(reservationMicros(readPiece.maxOutputTokens));
  expect(current.piece.status, 'Optional study took the last reservation first; after it settles the required read is still stuck unavailable until the composer retries').toBe('ready');
});
