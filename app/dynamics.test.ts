import { describe, expect, it } from "vitest";
import { readMidi } from "./midi";
import { checkOption, midiFile, readDyn, scoreTracks, transposedForPlayers, velocityIn, withDoubles, withOption, writingWindows, type ArrangeOption } from "./arrange";
import { parseScore } from "../score";
import type { ArrangeInput, OptionPlan } from "../server/shapes";

const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Violin I</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration></note></measure><measure number="2"><note><pitch><step>D</step><octave>5</octave></pitch><duration>12</duration></note></measure></part></score-partwise>`;
const input = { piece: { title: "T", composer: "", instrument: "Violin I" }, fifths: 0, time: "3/4", written: [{ bar: "1", notes: "C5" }, { bar: "2", notes: "D5" }], returns: [], tracks: [], answers: [], ask: null, moreBars: 0, reading: null, instruments: null, where: "both", cues: [] } as unknown as ArrangeInput;
const option = (adds: ArrangeOption["adds"]): ArrangeOption => ({ name: "A", idea: "B", why: [], adds });

describe("dynamics", () => {
  it("reads a level and a swell, and nothing else", () => {
    expect(readDyn("mp")).toEqual({ from: "mp", to: null, wedge: null });
    expect(readDyn("p<f")).toEqual({ from: "p", to: "f", wedge: "crescendo" });
    expect(readDyn("ff>p")).toEqual({ from: "ff", to: "p", wedge: "diminuendo" });
    expect(readDyn("loud")).toBeNull();
    expect(readDyn(undefined)).toBeNull();
  });

  it("gives a velocity along a swell", () => {
    const swell = readDyn("p<f")!;
    expect(velocityIn(swell, 0, 3)).toBe(50);
    expect(velocityIn(swell, 3, 3)).toBe(96);
    expect(velocityIn(swell, 1.5, 3)).toBe(73);
  });

  it("carries a level from the answer to the page and to MIDI, with a mod wheel curve for a swell", () => {
    const score = parseScore(xml);
    const check = checkOption(option([{ part: "Cello", bar: "1", events: "C3@0+3", dyn: "p<f" }, { part: "Cello", bar: "2", events: "D3@0+1 E3@1+1", dyn: "f" }]), score, input);
    expect(check.adds[0]!.events[0]!.velocity).toBe(50);
    const text = withOption(xml, score, check);
    expect(text).toContain("<p/>");
    expect(text).toContain(`<wedge type="crescendo"/>`);
    expect(text).toContain(`<wedge type="stop"/>`);
    const after = scoreTracks(parseScore(text));
    const cello = after.find((t) => t.name === "Cello")!;
    expect(cello.notes.map((n) => n.velocity)).toEqual([50, 96, 96]);
    expect(cello.controls![0]).toEqual({ beat: 0, value: 50 });
    expect(cello.controls!.some((c) => c.beat === 1.5 && c.value === 73)).toBe(true);
  });

  it("marks a level only where it changes", () => {
    const score = parseScore(xml);
    const check = checkOption(option([{ part: "Cello", bar: "1", events: "C3@0+3", dyn: "mf" }, { part: "Cello", bar: "2", events: "D3@0+3", dyn: "mf" }]), score, input);
    expect(withOption(xml, score, check).match(/<mf\/>/g)).toHaveLength(1);
  });

  it("writes velocity and the curve into the file, and leaves a track with no levels as it was", () => {
    const file = midiFile([{ name: "Cello", program: 42, notes: [{ start: 0, length: 1, height: 48, velocity: 101 }], controls: [{ beat: 0, value: 77 }] }, { name: "Plain", program: 42, notes: [{ start: 0, length: 1, height: 50 }] }], 60, { beats: 3, beatType: 4 });
    const read = readMidi(file);
    expect(read.tracks.flatMap((t) => t.notes).map((n) => n.velocity)).toEqual([101, 80]);
    const bytes = [...file];
    const at = bytes.findIndex((b, k) => (b & 0xf0) === 0xb0 && bytes[k + 1] === 1 && bytes[k + 2] === 77);
    expect(at).toBeGreaterThan(0);
  });

  it("keeps how hard a note was played when it comes from a score that says so", () => {
    const played = xml.replace("<note><pitch><step>C", `<note dynamics="111.1"><pitch><step>C`);
    expect(scoreTracks(parseScore(played))[0]!.notes[0]!.velocity).toBe(100);
  });
});

describe("percussion", () => {
  it("writes every unpitched hit on one note, whatever came back", () => {
    const check = checkOption(option([{ part: "Snare Drum", bar: "1", events: "G4@0+0.5 A4@1+0.5", dyn: "f" }]), parseScore(xml), input);
    expect(check.adds[0]!.events.map((e) => e.names)).toEqual([["C4"], ["C4"]]);
    expect(check.outOfRange).toEqual([]);
  });
});

describe("doubling by reference", () => {
  const bars = ["1", "2", "3"];
  it("copies a line exactly, moved by octaves, with its level", () => {
    const adds = withDoubles({ adds: [{ part: "Violin II", bar: "1", events: "D4,G4@0+1 Bb4@1+2", dyn: "mf" }], doubles: [{ part: "Flute", of: "Violin II", from: "1", to: "1", octave: 1 }] }, bars);
    expect(adds[1]).toEqual({ part: "Flute", bar: "1", events: "D5,G5@0+1 Bb5@1+2", dyn: "mf" });
  });
  it("lets what's written for a part win over a doubling, and ignores nonsense", () => {
    const adds = withDoubles({ adds: [{ part: "A", bar: "1", events: "C4@0+1" }, { part: "A", bar: "2", events: "D4@0+1" }, { part: "B", bar: "1", events: "E4@0+1" }], doubles: [{ part: "B", of: "A", from: "1", to: "2", octave: 0 }, { part: "A", of: "A", from: "1", to: "2", octave: 0 }, { part: "C", of: "A", from: "9", to: "9", octave: 0 }] }, bars);
    expect(adds).toHaveLength(4);
    expect(adds.find((a) => a.part === "B" && a.bar === "1")!.events).toBe("E4@0+1");
    expect(adds.find((a) => a.part === "B" && a.bar === "2")!.events).toBe("D4@0+1");
  });
});

describe("writing a section at a time", () => {
  const bars = Array.from({ length: 40 }, (_, k) => String(k + 1));
  const stretch = (from: number, to: number): OptionPlan["why"][number] => ({ from: String(from), to: String(to), what: "", principle: "" });
  it("joins short stretches and cuts long ones", () => {
    expect(writingWindows([stretch(1, 6), stretch(7, 8), stretch(9, 12), stretch(13, 16), stretch(17, 40)], bars)).toEqual([
      { from: "1", to: "8" }, { from: "9", to: "16" }, { from: "17", to: "24" }, { from: "25", to: "32" }, { from: "33", to: "40" },
    ]);
  });
  it("skips bars the plan doesn't name, and doesn't write a bar twice", () => {
    expect(writingWindows([stretch(1, 4), stretch(3, 6), stretch(20, 22)], bars)).toEqual([{ from: "1", to: "6" }, { from: "20", to: "22" }]);
  });
});

describe("what the players read", () => {
  const score = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Clarinet 1</part-name></score-part><score-part id="P2"><part-name>Horn 1</part-name></score-part><score-part id="P3"><part-name>Flute</part-name></score-part></part-list>${["P1", "P2", "P3"].map((id) => `<part id="${id}"><measure number="1"><attributes><divisions>4</divisions><key><fifths>-1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note></measure></part>`).join("")}</score-partwise>`;
  const sounds = (xml: string) => parseScore(xml).parts.map((p) => p.notes.map((n) => n.soundingMidi));

  it("writes a Bb and an F instrument as they read, and what they sound doesn't change", () => {
    const written = transposedForPlayers(score);
    expect(sounds(written)).toEqual(sounds(score));
    const [clarinet, horn, flute] = parseScore(written).parts;
    expect(clarinet!.notes[2]!.pitch).toMatchObject({ step: "D", octave: 5 });
    expect(clarinet!.measures[0]!.key.fifths).toBe(1);
    expect(horn!.notes[2]!.pitch).toMatchObject({ step: "G", octave: 5 });
    expect(horn!.measures[0]!.key.fifths).toBe(0);
    expect(flute!.notes[2]!.pitch).toMatchObject({ step: "C", octave: 5 });
  });
});

describe("plucked strings", () => {
  it("say so on the page, and go on a MIDI track of their own", () => {
    const parsed = parseScore(xml);
    const check = checkOption(option([{ part: "Cello", bar: "1", events: "C3@0+1 G3@1+1", dyn: "mf", role: "figure", art: "pizz" }, { part: "Cello", bar: "2", events: "D3@0+3", dyn: "mf", role: "bass" }, { part: "Flute", bar: "1", events: "C5@0+1", art: "pizz" }]), parsed, input);
    expect(check.adds.find((a) => a.part === "Flute")!.art).toBeUndefined();
    const text = withOption(xml, parsed, check);
    expect(text).toContain("pizz.");
    expect(text).toContain("arco");
    const names = scoreTracks(parseScore(text)).map((t) => t.name);
    expect(names).toContain("Cello");
    expect(names).toContain("Cello pizz");
    expect(scoreTracks(parseScore(text)).find((t) => t.name === "Cello pizz")!.notes).toHaveLength(2);
  });

  it("picks out a tune and a second tune on the page", () => {
    const parsed = parseScore(xml);
    const check = checkOption(option([{ part: "Cello", bar: "1", events: "C3@0+3", role: "melody" }, { part: "Viola", bar: "1", events: "C4@0+3", role: "countermelody" }, { part: "Flute", bar: "1", events: "C5@0+3", role: "harmony" }]), parsed, input);
    const text = withOption(xml, parsed, check, "#a8329b");
    expect(text).toContain("#d9531e");
    expect(text).toContain("#2466d1");
    expect(text).toContain("#a8329b");
  });
});
