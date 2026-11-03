import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { arrangeInput, checkOption, emptyScore, rangeOf as checkedRangeOf, withDoubles } from "../app/arrange";
import { noteName } from "../app/notes";
import { TEMPLATES } from "../app/orchestra";
import { parseScore } from "../score";
import { rangeOf } from "../shared/instrumentRanges";
import { runCall, sha256, stableJson, type LedgerPort } from "./call";
import { Answers, Ledger, type Sql, type SqlValue, type Transaction } from "./ledger";
import { POOLS, SLOTS } from "./pools";
import { reservationMicros } from "./prices";
import { arrange, distribute, type ArrangeInput, type DistributeInput, type WriteInput } from "./shapes";
import { MODEL } from "./spark";

const source: ArrangeInput = {
  piece: { title: "Original local range contract", composer: null, instrument: "Piano" }, fifths: 0, time: "4/4",
  written: [{ bar: "1", notes: "C4", rhythm: "4" }], returns: [], lines: ["Piano"], tracks: [], answers: [], cues: [],
  reading: null, ask: null, moreBars: 0, where: "inside", intent: "arrange", instruments: ["Violin I", "Flute 1"],
};
const chosen = { name: "Local arrangement", idea: "Keep the source", why: [{ from: "1", to: "1", what: "Share the line", principle: "Keep the source" }] };
const write = (instruments = source.instruments!): WriteInput => ({ ...source, instruments, chosen });
const layout = (instruments = source.instruments!): DistributeInput => ({ ...source, instruments, roles: [] });

it("keeps the exact checker function and existing subtype bounds shared with prompts", () => {
  expect(checkedRangeOf).toBe(rangeOf);
  for (const [name, low, high] of [["Violin I", 55, 103], ["Flute 1", 60, 96], ["Alto Flute", 55, 91], ["Bass Clarinet", 38, 77], ["Clarinet 1", 50, 94], ["Bass Trombone", 28, 67], ["Trombone 1", 40, 72], ["Contrabassoon", 22, 53], ["Bassoon", 34, 75]] as const) {
    expect(rangeOf(name)?.slice(1), name).toEqual([low, high]);
  }
  expect(rangeOf("Unspecified player")).toBeUndefined();
});

it.each(TEMPLATES)("gives both prompts the exact selected sounding bounds for $name", template => {
  for (const prompt of [distribute.build(layout(template.instruments)), arrange.build(write(template.instruments))]) {
    expect(prompt.instructions).toContain("sounding-pitch bounds");
    for (const name of template.instruments) {
      const range = rangeOf(name);
      if (range) expect(prompt.input, name).toContain(`${name}: ${noteName(range[1])}..${noteName(range[2])} inclusive (MIDI ${range[1]}..${range[2]})`);
    }
  }
});

it("does not invent bounds or leak unselected instruments and checks doubles at their destination", () => {
  const prompt = arrange.build(write(["Cello", "Flute 1", "Unspecified player"]));
  expect(prompt.input).not.toContain("Violin I:");
  expect(prompt.input).not.toContain("Unspecified player:");
  expect(prompt.instructions).toContain("every doubled pitch after applying `octave`");
  expect(prompt.instructions).toContain("destination `part`");
  const xml = emptyScore("Local doubles", ["Cello", "Flute 1"], { fifths: 0, time: "4/4", qpm: 80, bars: 1 });
  const score = parseScore(xml), input = arrangeInput(score, score.parts[0]!, 0, 0, null, 0, null, { instruments: ["Cello", "Flute 1"], where: "inside" });
  const adds = [{ part: "Cello", bar: "1", events: "B3@0+1" }];
  const doubled = (octave: number) => checkOption({ ...chosen, adds: withDoubles({ adds, doubles: [{ part: "Flute 1", of: "Cello", from: "1", to: "1", octave }] }, ["1"]) }, score, input);
  expect(doubled(0).outOfRange).toEqual([{ part: "Flute 1", bar: "1", name: "B3" }]);
  expect(doubled(1).outOfRange).toEqual([]);
});

it("still rejects the actual three failed pitches instead of relaxing destination checks", () => {
  const instruments = ["Violin I", "Violin II", "Flute 1"];
  const xml = emptyScore("Original local range fixture", instruments, { fifths: 0, time: "4/4", qpm: 80, bars: 32 });
  const score = parseScore(xml), input = arrangeInput(score, score.parts[0]!, 0, 31, null, 0, null, { instruments, where: "inside" });
  const adds = [{ part: "Violin I", bar: "10", events: "F3@0+1" }, { part: "Violin II", bar: "10", events: "F3@0+1" }, { part: "Flute 1", bar: "30", events: "B3@0+1" }];
  const check = checkOption({ ...chosen, adds }, score, input);
  expect(check).toMatchObject({ notes: 3, unreadable: 0, overBars: 0, pastBarEnd: 0 });
  expect(check.outOfRange).toEqual(adds.map(({ part, bar, events }) => ({ part, bar, name: events.split("@")[0] })));
});

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
  return { db, ledger, answers, port };
}

it.each([
  { shape: distribute, input: layout(), old: "distribute-6", next: "distribute-7", deadline: 300_000, answer: { idea: "Keep the source", plan: [{ line: "Piano", from: "1", to: "1", voice: "all", part: "Violin I", octave: 0, why: "Carry the line" }] } },
  { shape: arrange, input: write(), old: "arrange-15", next: "arrange-16", deadline: 600_000, answer: { adds: [{ part: "Flute 1", bar: "1", events: "G4@0+1", dyn: "mf", role: "melody", art: "" }], doubles: [] } },
])("sends $next with range facts under its own cache identity and unchanged reservation", async ({ shape, input, old, next, deadline, answer }) => {
  const { db, ledger, answers, port } = setup();
  try {
    const parsed = shape.parse(input)!;
    const oldHash = await sha256(stableJson({ shape: shape.name, version: old, model: MODEL, input: parsed }));
    answers.put(oldHash, shape.name, JSON.stringify({ answer, sources: [] }));
    let posts = 0;
    const fetchImpl = (async (_url, init) => {
      posts++;
      const body = JSON.parse(String(init?.body));
      expect(body.input).toContain("Violin I: G3..G7 inclusive (MIDI 55..103)");
      expect(body.input).toContain("Flute 1: C4..C7 inclusive (MIDI 60..96)");
      expect(body).toMatchObject({ prompt_cache_key: `motifold-${next}`, max_output_tokens: 40_000, store: false });
      return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 1, output_tokens: 1 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }));
    }) as typeof fetch;
    const context = (attemptId: string) => ({ attemptId, pool: "dev", visitor: "local-range-visitor", key: "local-fake-key", ledger: port, slots: SLOTS.dev!, fetchImpl });
    expect(await runCall(shape, input, context(`${next}-first`))).toMatchObject({ status: "ok", cached: false, answer });
    expect(await runCall(shape, input, context(`${next}-cached`))).toMatchObject({ status: "ok", cached: true, answer });
    expect(posts).toBe(1);
    expect(shape.maxOutputTokens).toBe(40_000); expect(shape.deadlineMs).toBe(deadline);
    expect(ledger.attempt(`${next}-first`)).toMatchObject({ state: "settled", reserved_micros: reservationMicros(40_000), charged_micros: 6 });
    expect(ledger.balance("dev")).toMatchObject({ capMicros: 44_048_076, committedMicros: 6 });
    expect(ledger.balance("public")).toMatchObject({ capMicros: 100_000_000, committedMicros: 0 });
  } finally { db.close(); }
});
