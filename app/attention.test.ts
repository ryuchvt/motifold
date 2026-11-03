import { describe, expect, it } from "vitest";
import { attentionOf, writingProgress } from "./attention";
import type { Arranged } from "./useArrange";

const written = ["1", "2", "3", "4"].map((bar) => ({ bar, notes: "C4" }));
const piece = {
  status: "ready",
  written,
  lines: ["Inst 1", "Synth"],
  saved: false,
  answer: {
    summary: "",
    sections: [],
    roles: [],
    thin: [],
    structures: [],
    tracks: [
      { line: "Inst 1", instrument: "Violin", sure: true, why: "" },
      { line: "Synth", instrument: "Harp", sure: false, why: "Plucked and wide" },
    ],
    questions: [{ from: "2", to: "3", line: "Synth", ask: "A tune here?", choices: [] }],
    missing: [{ from: "3", to: "4", what: "No ending", why: "It stops" }],
  },
} as unknown as Arranged["piece"];
// Twelve bars and two stretches of six, so the plan is written as two sections.
const long = Array.from({ length: 12 }, (_, k) => ({ bar: String(k + 1), notes: "C4" }));
const plan = { name: "A", idea: "", why: [{ from: "1", to: "6", what: "", principle: "" }, { from: "7", to: "12", what: "", principle: "" }] };
const input = { written: long, moreBars: 0 } as unknown as Extract<Arranged["options"], { status: "ready" }>["input"];

describe("what needs the composer's eye", () => {
  it("marks only what Muse Spark said: an unsure track, an open question, and what could be added", () => {
    const items = attentionOf({ piece, answered: {}, options: { status: "none" }, trying: null, tracks: { "Inst 1": "Violin", Synth: "Harp" }, tracksConfirmed: false });
    expect(items.map((a) => [a.kind, a.from, a.to])).toEqual([
      ["track", "1", "4"],
      ["question", "2", "3"],
      ["missing", "3", "4"],
    ]);
    expect(items[2]!.label).toBe("Could add: No ending");
  });

  it("lets go of a track once confirmed or changed, and of a question once answered", () => {
    const confirmed = attentionOf({ piece, answered: { 0: "Yes" }, options: { status: "none" }, trying: null, tracks: { Synth: "Harp" }, tracksConfirmed: true });
    expect(confirmed.map((a) => a.kind)).toEqual(["missing"]);
    const changed = attentionOf({ piece, answered: {}, options: { status: "none" }, trying: null, tracks: { Synth: "Celesta" }, tracksConfirmed: false });
    expect(changed.some((a) => a.kind === "track")).toBe(false);
  });
});

describe("the plan as it's written", () => {
  it("shows the first section writing before anything is back, even before it's on the score", () => {
    const options = { status: "ready", plans: [plan], input, notes: { 0: { status: "asking" } }, saved: false } as unknown as Arranged["options"];
    expect(writingProgress({ options, trying: null }).map((w) => w.state)).toEqual(["writing", "queued"]);
  });

  it("marks what's written, what's writing, and what didn't finish", () => {
    const writing = { status: "ready", plans: [plan], input, notes: { 0: { status: "ready", adds: [], check: {}, writing: { from: "7", to: "12", done: 1, of: 2 } } }, saved: false } as unknown as Arranged["options"];
    expect(writingProgress({ options: writing, trying: { kind: "option", index: 0 } }).map((w) => w.state)).toEqual(["written", "writing"]);
    const failed = { status: "ready", plans: [plan], input, notes: { 0: { status: "ready", adds: [], check: {}, missing: [{ from: "7", to: "12" }] } }, saved: false } as unknown as Arranged["options"];
    expect(writingProgress({ options: failed, trying: { kind: "option", index: 0 } }).map((w) => w.state)).toEqual(["written", "unfinished"]);
  });
});
