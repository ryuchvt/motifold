import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { runCall, sha256, stableJson, type LedgerPort } from "./call";
import { Answers, Ledger, type Sql, type SqlValue, type Transaction } from "./ledger";
import { POOLS, SLOTS } from "./pools";
import { PRICES, reservationMicros } from "./prices";
import { writeTheme, type ThemeInput } from "./shapes";
import { MODEL } from "./spark";

const input: ThemeInput = {
  piece: { title: "Original local theme contract", composer: null, instrument: "Piano" },
  fifths: 0, time: "3/4", written: [{ bar: "1", notes: "C4 E4 G4", rhythm: "1 1 1", at: "0 1 2" }],
  returns: [], lines: ["Piano"], tracks: [], answers: [], cues: [], ask: "Neutral", moreBars: 32,
  where: "after", freedom: 2, reading: null, instruments: ["Violin", "Cello"],
  chosen: { name: "Local theme", idea: "Develop the original", motif: { from: "1", to: "1", what: "The three-note rise" }, fifths: 0, time: "3/4", qpm: 90, why: [] },
};
const answer = { lines: Array.from({ length: 32 }, (_, i) => ({ role: "tune", bar: String(i + 1), events: "C4@0+3" })) };

function setup() {
  const db = new DatabaseSync(":memory:");
  const sql: Sql = { exec(query: string, ...args: SqlValue[]) { const rows = db.prepare(query).all(...args) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
  const transaction: Transaction = fn => { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const ledger = new Ledger(sql, transaction), answers = new Answers(sql);
  ledger.setup(POOLS); answers.setup();
  const port: LedgerPort = {
    reserve: async r => ledger.reserve(r), claimCached: async r => ledger.claimCached(r),
    dispatch: async id => ledger.dispatch(id), settle: async (id, charge, detail) => ledger.settle(id, charge, detail), uncertain: async (id, detail) => ledger.uncertain(id, detail),
    cached: async hash => answers.get(hash), remember: async (hash, shape, body) => answers.put(hash, shape, body),
  };
  const context = (attemptId: string, fetchImpl: typeof fetch) => ({ attemptId, pool: "dev", visitor: "local-theme-visitor", key: "local-fake-key", ledger: port, slots: SLOTS.dev!, fetchImpl, onEvent: () => {} });
  return { db, ledger, answers, context };
}

it("sends medium theme reasoning once under a new cache version while retaining earlier unknown money", async () => {
  const { db, ledger, answers, context } = setup();
  try {
    const reserveMicros = reservationMicros(40_000);
    expect(ledger.reserve({ attemptId: "earlier-unknown", requestHash: "earlier-request", pool: "dev", visitor: "local-theme-visitor", shape: "write_theme", reserveMicros, model: MODEL, priceVersion: PRICES.version, leaseMs: 270_000, slots: SLOTS.dev! })).toEqual({ ok: true });
    ledger.dispatch("earlier-unknown"); ledger.uncertain("earlier-unknown", "Local mock: usage was not received");
    const retained = ledger.attempt("earlier-unknown");
    const parsed = writeTheme.parse(input)!;
    const oldHash = await sha256(stableJson({ shape: writeTheme.name, version: "write-theme-4", model: MODEL, input: parsed }));
    answers.put(oldHash, writeTheme.name, JSON.stringify({ answer: { lines: [{ role: "tune", bar: "1", events: "D4@0+3" }] }, sources: [] }));
    let posts = 0;
    const fetchImpl = (async (_url, init) => {
      posts++;
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ reasoning: { effort: "medium", summary: "auto" }, max_output_tokens: 40_000, prompt_cache_key: "motifold-write-theme-5", stream: true, store: false });
      const completed = { type: "response.completed", response: { status: "completed", usage: { input_tokens: 8, output_tokens: 16 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] } };
      return new Response(`data: ${JSON.stringify(completed)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const result = await runCall(writeTheme, input, context("medium-theme", fetchImpl));
    expect(result).toMatchObject({ status: "ok", cached: false });
    expect(result).toHaveProperty("answer", answer);
    expect(await runCall(writeTheme, input, context("same-medium-theme", fetchImpl))).toMatchObject({ status: "ok", answer, cached: true });
    expect(posts).toBe(1);
    expect(ledger.attempt("medium-theme")).toMatchObject({ state: "settled", reserved_micros: reserveMicros, charged_micros: 78 });
    expect(ledger.attempt("earlier-unknown")).toEqual(retained);
    expect(ledger.balance("dev")).toMatchObject({ capMicros: 44_048_076, committedMicros: reserveMicros + 78 });
    expect(ledger.balance("public")).toMatchObject({ capMicros: 100_000_000, committedMicros: 0 });
    expect(writeTheme.deadlineMs).toBe(600_000);
  } finally { db.close(); }
});

it("retains the whole reservation if a medium theme stream times out after summaries and keepalives", async () => {
  const { db, ledger, answers, context } = setup();
  try {
    let posts = 0;
    const fetchImpl = (async (_url, init) => {
      posts++;
      return new Response(new ReadableStream({ start(controller) {
        const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
        controller.enqueue(encode({ type: "response.reasoning_summary_text.delta", delta: "A local summary" }));
        controller.enqueue(encode({ type: "keepalive" }));
        init!.signal!.addEventListener("abort", () => controller.error(new DOMException("Local deadline", "AbortError")), { once: true });
      } }), { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    // A short local deadline exercises the same unknown-charge path without waiting the full production deadline.
    expect(await runCall({ ...writeTheme, deadlineMs: 20 }, input, context("unfinished-medium-theme", fetchImpl))).toEqual({ status: "fallback", reason: "timeout" });
    expect(posts).toBe(1);
    expect(ledger.attempt("unfinished-medium-theme")).toMatchObject({ state: "uncertain", reserved_micros: reservationMicros(40_000), charged_micros: null });
    expect(ledger.balance("dev")!.committedMicros).toBe(reservationMicros(40_000));
    const hash = await sha256(stableJson({ shape: writeTheme.name, version: writeTheme.version, model: MODEL, input: writeTheme.parse(input) }));
    expect(answers.get(hash)).toBeNull();
  } finally { db.close(); }
});
