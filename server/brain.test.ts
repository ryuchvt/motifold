import { describe, expect, it } from "vitest";
import { MOODS, PIANO_WRITING, READING_A_SCORE } from "./brain";
import { arrange, distribute, fitForm, planOptions, planRecompose, readPiece, SHAPES, writeTheme, type ArrangeInput, type OptionPlan, type WriteInput } from "./shapes";

const asked = (change: Partial<ArrangeInput> = {}): ArrangeInput =>
  ({
    piece: { title: "Theme", composer: "", instrument: "Melody" },
    fifths: 0,
    time: "3/4",
    written: [{ bar: "1", notes: "C5" }, { bar: "2", notes: "D5" }],
    returns: [],
    tracks: [],
    answers: [],
    ask: null,
    moreBars: 0,
    reading: null,
    instruments: ["Violin I", "Cello"],
    where: "both",
    cues: [],
    ...change,
  }) as ArrangeInput;
const plan = (chords?: string): OptionPlan => ({ name: "Dawn", idea: "It opens out.", why: [{ from: "1", to: "2", what: "Cello walks", principle: "Motion below", ...(chords ? { chords } : {}) }] });
const written = (chords?: string): WriteInput => ({ ...asked(), chosen: plan(chords) });

describe("what the arranger knows about music", () => {
  it("has a plan name its chords bar by bar, as part of the answer", () => {
    const { instructions, schema } = planOptions.build(asked());
    expect(instructions).toContain("In `chords`");
    const why = (schema as { properties: { options: { items: { properties: { why: { items: { required: string[] } } } } } } }).properties.options.items.properties.why.items;
    expect(why.required).toContain("chords");
  });

  it("carries the chosen chords into the writing", () => {
    const raw = written("Am | F C/E");
    expect((arrange.parse(raw) as WriteInput).chosen.why[0]!.chords).toBe("Am | F C/E");
    expect(arrange.build(raw).input).toContain("Chords: Am | F C/E");
  });

  it("still takes a plan saved before chords were asked for", () => {
    const parsed = arrange.parse(written()) as WriteInput;
    expect(parsed.chosen.why[0]).not.toHaveProperty("chords");
    expect(arrange.build(parsed).input).not.toContain("Chords:");
  });

  it("refuses chords that aren't plain text of a sensible length", () => {
    expect(arrange.parse({ ...asked(), chosen: { ...plan(), why: [{ ...plan().why[0]!, chords: 7 }] } })).toBeNull();
    expect(arrange.parse(written("x".repeat(401)))).toBeNull();
  });

  it("takes one section at a time, carrying on from what's just been written", () => {
    const raw: WriteInput = { ...written("C | G"), window: { from: "2", to: "2" }, earlier: "Viola: C4@0+3 / Cello: C3@0+3" };
    const parsed = arrange.parse(raw) as WriteInput;
    expect(parsed.window).toEqual({ from: "2", to: "2" });
    const built = arrange.build(parsed);
    expect(built.input).toContain("write only bars 2 to 2");
    expect(built.input).toContain("Viola: C4@0+3");
    const schema = built.schema as { properties: { adds: { items: { properties: { bar: { enum: string[] }; dyn: unknown } } }; doubles: unknown } };
    expect(schema.properties.adds.items.properties.bar.enum).toEqual(["2"]);
    expect(schema.properties.adds.items.properties.dyn).toBeDefined();
    expect(schema.properties.doubles).toBeDefined();
    expect(arrange.parse({ ...raw, window: { from: "9", to: "9" } })).toBeNull();
  });

  it("tells the writer that a bare stretch still has the notes it names", () => {
    expect(arrange.build(written()).instructions).toContain("still has the notes it names");
  });

  it("thinks about mood when planning, and doesn't spend the writing call's time on it", () => {
    expect(planOptions.build(asked()).instructions).toContain(MOODS);
    expect(arrange.build(written()).instructions).not.toContain(MOODS);
  });

  it("only thinks about piano writing when there's a piano", () => {
    expect(planOptions.build(asked()).instructions).not.toContain(PIANO_WRITING);
    expect(planOptions.build(asked({ instruments: ["Piano", "Cello"] })).instructions).toContain(PIANO_WRITING);
    expect(arrange.build({ ...written(), instruments: ["Piano"] }).instructions).toContain(PIANO_WRITING);
  });

  it("reaches every call that makes a musical decision", () => {
    expect(readPiece.build(asked()).instructions).toContain(READING_A_SCORE);
    expect(distribute.build({ ...asked(), instruments: ["Cello"], roles: [] }).instructions).toContain("translation and not copying");
    expect(fitForm.build({ ...asked(), roles: [], moments: [{ beats: 0, time: "0:00", what: "" }] }).instructions).toContain("Not every moment deserves a hit");
  });
});

describe("recomposing and writing from a source", () => {
  it("says how free it can go, and writes the tune before anything else", () => {
    const instructions = (freedom: number) => planRecompose.build({ ...asked({ moreBars: 32, freedom }) }).instructions;
    expect(instructions(1)).toContain("How free: close");
    expect(instructions(5)).toContain("How free: seed");
    expect(SHAPES.write_theme).toBe(writeTheme);
    const theme = writeTheme.build({ ...asked({ moreBars: 32 }), chosen: { name: "A", idea: "B", motif: { from: "1", to: "1", what: "C" }, fifths: 0, time: "3/4", qpm: 90, why: [] } });
    expect(theme.instructions).toContain("Write three lines across every bar");
    expect(writeTheme.check(asked(), { lines: [{ role: "bass", bar: "1", events: "C2@0+3" }] })).toBe("no tune");
  });

  it("uses the sketch as source when only the tune is on the score", () => {
    const withSource = planOptions.build(asked({ source: "Bar 1: upper: C5 lower: C3" }));
    expect(withSource.instructions).toContain("your source material");
    expect(withSource.input).toContain("Bar 1: upper: C5 lower: C3");
    expect(planOptions.build(asked()).instructions).toContain("that's their harmony and it's fixed");
    expect(distribute.build({ ...asked(), instruments: ["Cello"], roles: [], tuneOnly: true }).instructions).toContain("Place only the composer's tune");
  });

  it("asks for layers, ornament and a role for each part", () => {
    const built = arrange.build(written());
    expect(built.instructions).toContain("Keep at least three things a listener could follow apart");
    expect(built.instructions).toContain("Decoration is what makes a line sound played");
    const schema = built.schema as { properties: { adds: { items: { required: string[] } } } };
    expect(schema.properties.adds.items.required).toEqual(expect.arrayContaining(["role", "art"]));
  });
});
