import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { runCall, sha256, stableJson, type LedgerPort } from "./call";
import { Answers, Ledger, type ReserveRequest, type Sql, type SqlValue, type Transaction } from "./ledger";
import { POOLS, SLOTS } from "./pools";
import { reservationMicros } from "./prices";
import { arrange, writeTheme, type AnyShape, type ThemeInput, type WriteInput } from "./shapes";
import { MODEL, requestBody, SPARK_URL, type SparkEvent } from "./spark";

const start = Date.UTC(2026, 10, 4, 0, 0);
const source = { piece: { title: "Original local deadline contract", composer: null, instrument: "Piano" }, fifths: 0, time: "3/4", written: [{ bar: "1", notes: "C4 E4 G4", rhythm: "1 1 1", at: "0 1 2" }], returns: [], lines: ["Piano"], tracks: [], answers: [], cues: [], ask: "Neutral", reading: null, instruments: ["Violin", "Cello"] };
const write: WriteInput = { ...source, intent: "arrange", moreBars: 0, where: "inside", chosen: { name: "Local arrangement", idea: "Keep the source", why: [{ from: "1", to: "1", what: "Support", principle: "Keep the source" }] } };
const theme: ThemeInput = { ...source, moreBars: 32, where: "after", freedom: 2, chosen: { name: "Local theme", idea: "Develop the original", motif: { from: "1", to: "1", what: "The rising gesture" }, fifths: 0, time: "3/4", qpm: 90, why: [] } };
const cases: { shape: AnyShape; input: unknown; version: string; answer: unknown }[] = [
  { shape: arrange, input: write, version: "arrange-16", answer: { adds: [{ part: "Violin", bar: "1", events: "C4@0+3", dyn: "mp", role: "melody", art: "" }], doubles: [] } },
  { shape: writeTheme, input: theme, version: "write-theme-5", answer: { lines: Array.from({ length: 32 }, (_, i) => ({ role: "tune", bar: String(i + 1), events: "C4@0+3" })) } },
];

function setup() {
  const db = new DatabaseSync(":memory:"), reservations: ReserveRequest[] = [];
  const sql: Sql = { exec(query: string, ...args: SqlValue[]) { const rows = db.prepare(query).all(...args) as Record<string, SqlValue>[]; return { toArray: () => rows }; } };
  const transaction: Transaction = fn => { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const ledger = new Ledger(sql, transaction), answers = new Answers(sql); ledger.setup(POOLS); answers.setup();
  const port: LedgerPort = {
    reserve: async r => { reservations.push(r); return ledger.reserve(r); }, claimCached: async r => ledger.claimCached(r), dispatch: async id => ledger.dispatch(id),
    settle: async (id, charge, detail) => ledger.settle(id, charge, detail), uncertain: async (id, detail) => ledger.uncertain(id, detail),
    cached: async hash => answers.get(hash), remember: async (hash, shape, body) => answers.put(hash, shape, body),
  };
  return { db, ledger, answers, reservations, port };
}

it.each(cases)("$version settles a terminal response beyond240s with unchanged wire, reservation and cache identity", async ({ shape, input, version, answer }) => {
  await exercise(shape, input, version, answer, 360_000, false);
});
it.each(cases)("$version has an absolute600s cutoff even with fresh upstream keepalives and never retries", async ({ shape, input, version, answer }) => {
  await exercise(shape, input, version, answer, 700_000, true);
});

async function exercise(shape: AnyShape, input: unknown, version: string, answer: unknown, terminalAt: number, timeout: boolean) {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const { db, ledger, answers, reservations, port } = setup();
  const seen: SparkEvent[] = [], posts: { url: string; method: string | undefined; body: unknown; signal: AbortSignal }[] = [];
  let releaseStarted!: () => void, cleanup = () => {}, finished = false;
  const started = new Promise<void>(resolve => { releaseStarted = resolve; });
  const visitor = "local-deadline-visitor", attemptId = `${version}-${timeout ? "hard-stop" : "late-known"}`;
  const fetchImpl = (async (url, init) => {
    posts.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)), signal: init!.signal! });
    const stream = new ReadableStream({ start(controller) {
      let open = true;
      const emit = (value: object) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
      const keepalive = setInterval(() => emit({ type: "keepalive" }), 59_000);
      const terminal = setTimeout(() => {
        emit({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 8, output_tokens: 16 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] } });
        clearInterval(keepalive); open = false; controller.close();
      }, terminalAt);
      cleanup = () => { clearInterval(keepalive); clearTimeout(terminal); if (open) { open = false; controller.error(new DOMException("Local stream stopped", "AbortError")); } };
      emit({ type: "response.reasoning_summary_text.delta", delta: "A local summary, not evidence of completion" });
      init!.signal!.addEventListener("abort", cleanup, { once: true });
    } });
    releaseStarted();
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const pending = runCall(shape, input, { attemptId, pool: "dev", visitor, key: "local-fake-key", ledger: port, slots: SLOTS.dev!, fetchImpl, onEvent: event => seen.push(event) }).then(result => { finished = true; return result; });
  try {
    await started;
    expect(shape).toMatchObject({ version, effort: "medium", maxOutputTokens: 40_000, deadlineMs: 600_000 });
    expect(MODEL).toBe("muse-spark-1.3");
    const parsed = shape.parse(input)!, hash = await sha256(stableJson({ shape: shape.name, version, model: MODEL, input: parsed }));
    const oldWire = requestBody({ ...shape.build(parsed), schemaName: shape.name, effort: shape.effort, maxOutputTokens: shape.maxOutputTokens, deadlineMs: 240_000, cacheKey: `motifold-${version}`, maxSearches: shape.maxSearches, safetyId: visitor, onEvent: () => {} });
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ url: SPARK_URL, method: "POST", body: oldWire }); expect(posts[0]!.body).toEqual(oldWire);
    expect(reservations).toHaveLength(1); expect(reservations[0]).toMatchObject({ requestHash: hash, reserveMicros: reservationMicros(40_000), leaseMs: 630_000, slots: 4 });
    expect(ledger.attempt(attemptId)).toMatchObject({ state: "dispatched", lease_until: start+630_000, reserved_micros: 1_480_720, charged_micros: null });
    await vi.advanceTimersByTimeAsync(240_001);
    expect(finished).toBe(false); expect(posts[0]!.signal.aborted).toBe(false);
    expect(seen.some(event => event.kind === "thinking")).toBe(true);
    expect(seen.filter(event => event.kind === "other" && event.type === "keepalive").length).toBeGreaterThan(0);
    if (timeout) {
      await vi.advanceTimersByTimeAsync(359_998);
      expect(finished).toBe(false); expect(posts[0]!.signal.aborted).toBe(false);
      expect(seen.filter(event => event.kind === "other" && event.type === "keepalive")).toHaveLength(10);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ status: "fallback", reason: "timeout" });
      expect(posts[0]!.signal.aborted).toBe(true);
      const attempt = ledger.attempt(attemptId)!;
      expect(attempt).toMatchObject({ state: "uncertain", reserved_micros: 1_480_720, charged_micros: null });
      expect(JSON.parse(String(attempt.detail))).toMatchObject({ reason: "timeout", ms: 600_000 });
      expect(answers.get(hash)).toBeNull();
      expect(ledger.balance("dev")).toMatchObject({ capMicros: 44_048_076, committedMicros: 1_480_720 });
    } else {
      await vi.advanceTimersByTimeAsync(119_999);
      expect(await pending).toMatchObject({ status: "ok", cached: false, answer });
      const attempt = ledger.attempt(attemptId)!;
      expect(attempt).toMatchObject({ state: "settled", reserved_micros: 1_480_720, charged_micros: 78 });
      expect(JSON.parse(String(attempt.detail))).toMatchObject({ ms: 360_000, overBound: false });
      expect(answers.get(hash)).not.toBeNull();
      expect(ledger.balance("dev")).toMatchObject({ capMicros: 44_048_076, committedMicros: 78 });
    }
    await vi.advanceTimersByTimeAsync(700_000);
    expect(posts).toHaveLength(1); expect(reservations).toHaveLength(1);
    expect(ledger.balance("public")).toMatchObject({ capMicros: 100_000_000, committedMicros: 0 });
  } finally {
    cleanup(); await pending.catch(() => {}); db.close(); vi.useRealTimers();
  }
}
