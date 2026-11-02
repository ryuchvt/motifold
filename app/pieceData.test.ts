import { describe, expect, it } from "vitest";
import { parseScore } from "../score";
import { beatClock, voiceOf } from "./audio/preview";
import { notesToHear, pieceData } from "./pieceData";

const bar = (n: number, step: string, top = "", more = "") => `<measure number="${n}">${top}<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration>${more}<voice>1</voice></note></measure>`;
const head = (qpm = 60) => `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="${qpm}"/></direction>`;
const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Violin</part-name></score-part><score-part id="P2"><part-name>Tuba</part-name></score-part></part-list><part id="P1">${bar(1, "C", head(), '<tie type="start"/>')}${bar(2, "C", "", '<tie type="stop"/>')}${bar(3, "E")}</part><part id="P2">${bar(1, "G", head())}${bar(2, "A")}${bar(3, "B")}</part></score-partwise>`;
const score = parseScore(xml);
const roles = [{ from: "1", to: "3", line: "Violin", role: "melody" as const, of: "", why: "x" }, { from: "2", to: "2", line: "Tuba", role: "bass" as const, of: "", why: "x" }];
const BARS = ["1", "2", "3"];

describe("the whole piece as a picture", () => {
  const data = pieceData(score, roles, BARS);

  it("has every track with its notes in time, and a held note as one", () => {
    expect(data.rows.map((r) => r.label)).toEqual(["Violin", "Tuba"]);
    expect(data.rows[0]!.notes.map((n) => [n.start, n.length, n.height])).toEqual([[0, 8, 60], [8, 4, 64]]);
    expect(data.bars.map((b) => [b.number, b.start])).toEqual([["1", 0], ["2", 4], ["3", 8]]);
    expect(data.totalBeats).toBe(12);
  });

  it("says what each note is doing, and leaves it plain where nothing's been read", () => {
    expect(data.rows[0]!.notes[0]!.kind).toBe("melody");
    expect(data.rows[1]!.notes.map((n) => n.kind)).toEqual([null, "bass", null]);
    expect(data.rows[0]!.tall).toBe(true);
    expect(data.rows[1]!.tall).toBe(false);
    expect(pieceData(score, [], []).rows[0]!.notes[0]!.kind).toBeNull();
  });

  it("measures how full the music is", () => {
    expect(data.fullness.yours).toEqual(Array.from({ length: 24 }, () => 2));
    expect(data.fullness.added.every((v) => v === 0)).toBe(true);
  });

  it("puts new notes on their row, or a row of their own, past the last bar if they must", () => {
    const more = pieceData(score, roles, BARS, { adds: [{ part: "Tuba", bar: "4", events: [{ start: 0, length: 4, names: ["C2"] }] }, { part: "Flute", bar: "1", events: [{ start: 0, length: 1, names: ["C5"] }] }] });
    expect(more.rows.map((r) => r.label)).toEqual(["Violin", "Tuba", "Flute"]);
    expect(more.rows[1]!.notes.at(-1)).toEqual({ start: 12, length: 4, height: 36, kind: "new" });
    expect(more.bars.map((b) => b.number)).toEqual(["1", "2", "3", "4"]);
    expect(more.totalBeats).toBe(16);
    expect(more.fullness.added[0]).toBe(1);
    expect(more.rows[2]!.tall).toBe(true);
  });

  it("follows a new order back to the bars the roles were read on", () => {
    const moved = parseScore(`<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list><part id="P1">${bar(1, "A", head())}${bar(2, "G")}</part></score-partwise>`);
    const order = pieceData(moved, roles, BARS, { sourceBar: (b) => ["2", "1"][Number(b) - 1]! });
    expect(order.rows[0]!.notes.map((n) => n.kind)).toEqual(["bass", null]);
  });
});

describe("what's heard", () => {
  const data = pieceData(score, roles, BARS);

  it("is everything to begin with, with the tune forward", () => {
    const notes = notesToHear(data, () => "", null, []);
    expect(notes).toHaveLength(5);
    expect(notes.find((n) => n.height === 60)).toMatchObject({ voice: "strings", level: 1 });
    expect(notes.find((n) => n.height === 69)).toMatchObject({ voice: "brass", level: 0.8 });
  });

  it("is only the role picked out, or the tracks on their own", () => {
    expect(notesToHear(data, () => "", "melody", []).map((n) => n.height)).toEqual([60, 64]);
    expect(notesToHear(data, () => "", null, ["Tuba"])).toHaveLength(3);
  });

  it("uses what the composer says a track is, when its name doesn't say", () => {
    const inst = parseScore(xml.replace("Violin", "Inst 1"));
    expect(notesToHear(pieceData(inst, [], []), (l) => (l === "Inst 1" ? "Piano" : ""), null, [])[0]!.voice).toBe("pluck");
  });
});

describe("the sound", () => {
  it("chooses a voice from the name", () => {
    expect(voiceOf("Violin I")).toBe("strings");
    expect(voiceOf("Inst 1")).toBe("strings");
    expect(voiceOf("Horn 2")).toBe("brass");
    expect(voiceOf("English Horn")).toBe("winds");
    expect(voiceOf("Flute")).toBe("winds");
    expect(voiceOf("Harp")).toBe("pluck");
  });

  it("keeps time through tempo changes, both ways", () => {
    const clock = beatClock([{ beat: 0, qpm: 60 }, { beat: 4, qpm: 120 }]);
    expect(clock.seconds(4)).toBe(4);
    expect(clock.seconds(6)).toBe(5);
    expect(clock.beat(5)).toBe(6);
    expect(beatClock([]).seconds(2)).toBe(1);
  });
});
