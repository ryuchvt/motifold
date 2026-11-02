import { describe, expect, it } from "vitest";
import { parseScore } from "../score";
import { planOptions } from "../server/shapes";
import { arrangeInput, type OptionCheck } from "./arrange";
import { barsToReach, cueHits, cueWords, orderHits, parseTime, placeCues, timeWords } from "./cues";

const bar = (n: number, more = "") => `<measure number="${n}">${more}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure>`;
const top = (qpm: number) => `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="${qpm}"/></direction>`;
const scoreAt = (qpm: number, bars = 8) => parseScore(`<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${Array.from({ length: bars }, (_, k) => bar(k + 1, k === 0 ? top(qpm) : "")).join("")}</part></score-partwise>`);

describe("reading a time", () => {
  it("takes the ways a composer writes one", () => {
    expect(parseTime("69.5")).toBe(69.5);
    expect(parseTime("1:09.5")).toBe(69.5);
    expect(parseTime("0:01:09")).toBe(69);
    expect(parseTime("00:01:09:12")).toBe(69.5);
    expect(parseTime(" 2 ")).toBe(2);
  });

  it("doesn't guess at anything else", () => {
    for (const bad of ["", "soon", "1:xx", "-1.9", "1:2:3:4:5"]) expect(parseTime(bad)).toBeNull();
  });

  it("writes one back", () => {
    expect(timeWords(69.5)).toBe("1:09.5");
    expect(timeWords(6.5)).toBe("0:06.5");
  });
});

describe("where a moment falls", () => {
  it("turns a time into a bar and a beat at the score's tempo", () => {
    // 120 a minute: a bar of 4/4 takes 2 seconds.
    expect(placeCues([{ time: "2", what: "Hit" }], scoreAt(120))[0]).toMatchObject({ bar: "2", beat: 0, beats: 4, seconds: 2, newBar: false, what: "Hit" });
    expect(placeCues([{ time: "3.25", what: "" }], scoreAt(120))[0]).toMatchObject({ bar: "2", beat: 2.5, newBar: false });
  });

  it("counts on past the last bar, at its length and tempo", () => {
    const [cue] = placeCues([{ time: "21", what: "" }], scoreAt(120, 8));
    expect(cue).toMatchObject({ bar: "11", beat: 2, newBar: true, beats: 42 });
    expect(barsToReach([cue!], scoreAt(120, 8))).toBe(3);
  });

  it("works out the tempo that puts it on the bar", () => {
    const [cue] = placeCues([{ time: "2.1", what: "" }], scoreAt(120));
    expect(cue!.landing).toEqual({ bar: "2", qpm: 114.3, from: 120 });
    expect(cueWords(cue!)).toBe("0:02.1 is bar 2, beat 1.2. At 114.3 and not 120, it would fall on the first beat of bar 2.");
  });

  it("says nothing about tempo when it's already on the bar, or the tempo changes", () => {
    expect(placeCues([{ time: "2", what: "" }], scoreAt(120))[0]!.landing).toBeNull();
    const changing = parseScore(`<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list><part id="P1">${bar(1, top(120))}${bar(2, '<direction><sound tempo="60"/></direction>')}${bar(3)}</part></score-partwise>`);
    const [cue] = placeCues([{ time: "3.1", what: "" }], changing);
    expect(cue).toMatchObject({ bar: "2", beat: 1.1 });
    expect(cue!.landing).toBeNull();
  });

  it("takes a DAW's marker by its beat, whatever the tempo", () => {
    expect(placeCues([{ time: "", what: "Door", beats: 6 }], scoreAt(90))[0]).toMatchObject({ bar: "2", beat: 2, what: "Door", newBar: false });
  });

  it("leaves out what isn't a time", () => {
    expect(placeCues([{ time: "soon", what: "x" }, { time: "", what: "y" }], scoreAt(120))).toEqual([]);
  });
});

describe("what's written at a moment", () => {
  const check = (adds: OptionCheck["adds"]): OptionCheck => ({ adds, notes: 1, overBars: 0, unreadable: 0, pastBarEnd: 0, outOfRange: [], clashes: [] });
  const cue = { what: "Melody in", beats: 4, bar: "2", beat: 0, seconds: 2, newBar: false, landing: null };

  it("says who starts there", () => {
    expect(cueHits([cue], check([{ part: "Flute", bar: "2", events: [{ start: 0, length: 1, names: ["C5"] }] }, { part: "Horn", bar: "2", events: [{ start: 0.1, length: 1, names: ["C4"] }] }]))).toEqual(["Melody in, bar 2: Flute, Horn start there."]);
  });

  it("says plainly when nothing does", () => {
    expect(cueHits([cue], check([{ part: "Flute", bar: "2", events: [{ start: 2, length: 1, names: ["C5"] }] }]))).toEqual(["Melody in, bar 2: nothing new starts there."]);
  });
});

describe("a new order against the moments", () => {
  it("says which of the composer's bars each moment lands in, and who has the tune", () => {
    const roles = [{ from: "5", to: "8", line: "Violin", role: "melody" as const, of: "", why: "x" }];
    const order = [{ from: "1", to: "2" }, { from: "5", to: "8" }];
    expect(orderHits([{ time: "4", what: "Tune" }], scoreAt(120), order, roles)).toEqual(["Tune: your bar 5, the first beat, where Violin has the melody."]);
    expect(orderHits([{ time: "0", what: "Top" }], scoreAt(120), order, roles)).toEqual(["Top: your bar 1, the first beat, with no melody marked there."]);
  });

  it("says when the order is too short", () => {
    expect(orderHits([{ time: "99", what: "End" }], scoreAt(120), [{ from: "1", to: "2" }], [])).toEqual(["End: this order ends before it."]);
  });
});

describe("what goes to Muse Spark", () => {
  const score = scoreAt(120);
  const asked = arrangeInput(score, score.parts[0]!, 0, 7, null, 2, null, { cues: [{ bar: "9", beat: 0, time: "0:16.0", what: "Door opens" }] });

  it("gives each moment as a bar and a beat", () => {
    const parsed = planOptions.parse(asked)!;
    expect(planOptions.build(parsed).input).toContain("Moments the music has to hit:\nBar 9, crotchet 0 from the start of the bar (0:16.0): Door opens");
    expect(planOptions.build(parsed).instructions).toContain("those moments are fixed");
  });

  it("takes no moment on a bar that won't exist", () => {
    expect(planOptions.parse({ ...asked, cues: [{ bar: "99", beat: 0, time: "x", what: "y" }] })).toBeNull();
    expect(planOptions.parse({ ...asked, cues: [{ bar: "9", beat: -1, time: "x", what: "y" }] })).toBeNull();
  });
});
