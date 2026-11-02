import { describe, expect, it } from "vitest";
import { parseScore, type Score } from "../score";
import { distribute, type DistributeAnswer } from "../server/shapes";
import { checkWords, chordTracks, FADED, onlyBars, pieceInput, placedWords, placeNotes, ROLE_COLOURS, rolesAfter, scoreOfParts, scoreTracks, scoreWithSplits, withRoleColours } from "./arrange";
import { inScoreOrder, instrumentFromName, TEMPLATES } from "./orchestra";

const head = (clef = "G", line = 2) => `<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${line}</line></clef></attributes><direction><sound tempo="73"/></direction>`;
const pitch = (name: string) => `<pitch><step>${name[0]}</step>${name[1] === "#" ? "<alter>1</alter>" : name[1] === "b" ? "<alter>-1</alter>" : ""}<octave>${name.at(-1)}</octave></pitch>`;
const n = (name: string, ticks: number, more = "") => `<note>${more.includes("chord") ? "<chord/>" : ""}${pitch(name)}<duration>${ticks}</duration>${more.includes("tieS") ? '<tie type="start"/>' : ""}${more.includes("tieE") ? '<tie type="stop"/>' : ""}<voice>1</voice></note>`;
const chord = (names: string[], ticks: number) => names.map((name, k) => n(name, ticks, k ? "chord" : "")).join("");
const part = (id: string, bars: string[]) => `<part id="${id}">${bars.map((b, k) => `<measure number="${k + 1}">${b}</measure>`).join("")}</part>`;
const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Inst 1</part-name></score-part><score-part id="P2"><part-name>Kontakt</part-name></score-part><score-part id="P3"><part-name>Inst 2</part-name></score-part></part-list>
${part("P1", [head() + n("E5", 8), n("F#5", 8, "tieS"), n("F#5", 8, "tieE")])}
${part("P2", [head() + chord(["E4", "G4", "B4"], 8), chord(["D4", "F#4", "A4"], 8), chord(["C4", "E4", "G4"], 8)])}
${part("P3", [head("F", 4) + n("E5", 8), n("D3", 8), n("C3", 4) + n("D3", 4)])}</score-partwise>`;
const score = parseScore(xml);
const input = pieceInput(score, score.parts[0]!, 0, 2);
const plan = (entries: Partial<DistributeAnswer["plan"][number]>[]): DistributeAnswer => ({ idea: "x", plan: entries.map((e) => ({ from: "1", to: "3", line: "Inst 1", voice: "all", part: "Violin I", octave: 0, why: "x", ...e })) });
const notesOf = (s: Score, name: string) => {
  const p = s.parts.find((x) => x.name === name)!;
  return p.notes.filter((x) => !x.rest).map((x) => `${x.pitch!.step}${x.pitch!.alter === 1 ? "#" : ""}${x.pitch!.octave}`);
};
const WHOLE = [{ line: "Inst 1", part: "Violin I" }, { line: "Kontakt", part: "Violin II", voice: "1" as const }, { line: "Kontakt", part: "Viola", voice: "2" as const }, { line: "Kontakt", part: "Cello", voice: "3" as const }, { line: "Inst 2", part: "Double Bass", octave: -1 }];
const instruments = ["Violin I", "Violin II", "Viola", "Cello", "Double Bass"];

describe("moving the composer's notes", () => {
  it("splits a chord track into voices, top first, and keeps every note", () => {
    const { parts, check } = placeNotes(score, input, plan(WHOLE), instruments);
    const out = parseScore(scoreOfParts(score, input, parts));
    expect(notesOf(out, "Violin II")).toEqual(["B4", "A4", "G4"]);
    expect(notesOf(out, "Viola")).toEqual(["G4", "F#4", "E4"]);
    expect(notesOf(out, "Cello")).toEqual(["E4", "D4", "C4"]);
    expect(check).toMatchObject({ notes: 15, placed: 15, notPlaced: [], ignored: 0 });
  });

  it("can only move a line by whole octaves, and counts that", () => {
    const { parts, check } = placeNotes(score, input, plan(WHOLE), instruments);
    const out = parseScore(scoreOfParts(score, input, parts));
    // A double bass reads an octave above where it sounds.
    expect(out.parts.find((p) => p.name === "Double Bass")!.notes.filter((x) => !x.rest).map((x) => x.soundingMidi)).toEqual([64, 38, 36, 38]);
    expect(check.moved).toBe(4);
  });

  it("keeps what the plan leaves out, on a part of its own, so nothing is lost", () => {
    const { parts, check } = placeNotes(score, input, plan([{ line: "Inst 1", part: "Violin I" }, { line: "Inst 2", part: "Cello", from: "2", to: "2" }]), ["Violin I", "Cello"]);
    expect(check.notPlaced).toEqual([{ line: "Kontakt", notes: 9 }, { line: "Inst 2", notes: 3 }]);
    expect(parts.map((p) => p.name)).toEqual(["Violin I", "Cello", "Kontakt (not placed)", "Inst 2 (not placed)"]);
    expect(placedWords(check).join(" ")).toContain("so nothing is lost");
    const out = parseScore(scoreOfParts(score, input, parts));
    expect(notesOf(out, "Inst 2 (not placed)")).toEqual(["E5", "C3", "D3"]);
    expect(check.notes).toBe(check.placed + 12);
  });

  it("merges a doubling that lands on one instrument", () => {
    const { parts, check } = placeNotes(score, input, plan([{ line: "Inst 1", part: "Violin I", from: "1", to: "1" }, { line: "Inst 2", part: "Violin I", from: "1", to: "1" }]), ["Violin I"]);
    expect(check.merged).toBe(1);
    expect(notesOf(parseScore(scoreOfParts(score, input, parts)), "Violin I")).toContain("E5");
    expect(parts[0]!.bars[0]).toHaveLength(1);
  });

  it("holds a tie across the bar when both notes reach the same instrument, and lets go when they don't", () => {
    const whole = placeNotes(score, input, plan([{ line: "Inst 1", part: "Violin I" }]), ["Violin I"]);
    const out = parseScore(scoreOfParts(score, input, whole.parts));
    const held = out.parts[0]!.notes.filter((x) => !x.rest);
    expect(held[1]!.tieStart).toBe(true);
    expect(held[2]!.tieStop).toBe(true);
    expect(scoreTracks(out)[0]!.notes).toEqual([{ start: 0, length: 4, height: 76 }, { start: 4, length: 8, height: 78 }]);
    const half = placeNotes(score, input, plan([{ line: "Inst 1", part: "Violin I", from: "1", to: "2" }, { line: "Inst 1", part: "Viola", from: "3", to: "3" }]), ["Violin I", "Viola"]);
    const cut = parseScore(scoreOfParts(score, input, half.parts));
    expect(cut.parts[0]!.notes.filter((x) => !x.rest).at(-1)!.tieStart).toBe(false);
    expect(cut.parts[1]!.notes.find((x) => !x.rest)!.tieStop).toBe(false);
  });

  it("says when an instrument is given what it can't play", () => {
    const { check } = placeNotes(score, input, plan([{ line: "Kontakt", part: "Flute", octave: -2 }]), ["Flute"]);
    expect(check.outOfRange.length).toBeGreaterThan(0);
    expect(check.together.map((t) => t.bar)).toEqual(["1", "2", "3"]);
    expect(placedWords(check).join(" ")).toContain("need dividing");
  });

  it("ignores a line of the plan that points at nothing, and still loses no note", () => {
    const { check } = placeNotes(score, input, plan([{ line: "Nobody", part: "Violin I" }, { line: "Inst 1", part: "Nobody" }, { line: "Inst 1", part: "Violin I", from: "9", to: "9" }]), ["Violin I"]);
    expect(check.ignored).toBe(3);
    expect(check.placed).toBe(0);
    expect(check.notPlaced.reduce((sum, x) => sum + x.notes, 0)).toBe(check.notes);
  });
});

describe("the new score", () => {
  const { parts } = placeNotes(score, input, plan(WHOLE), [...instruments, "Flute"]);
  const text = scoreOfParts(score, input, parts);
  const out = parseScore(text);

  it("has a staff for every instrument chosen, even with nothing on it yet, and full bars throughout", () => {
    expect(out.parts.map((p) => p.name)).toEqual([...instruments, "Flute"]);
    for (const p of out.parts) for (const m of p.measures) expect(m.length / out.ticksPerQuarter).toBe(4);
    expect(out.parts[5]!.notes.every((x) => x.rest)).toBe(true);
  });

  it("shows real rests in the gaps", () => {
    const sparse = placeNotes(score, input, plan([{ line: "Inst 2", part: "Cello", from: "3", to: "3", voice: "1" }]), ["Cello"]);
    const shown = parseScore(scoreOfParts(score, input, sparse.parts)).parts[0]!;
    expect(shown.notes.filter((x) => x.rest).length).toBeGreaterThan(0);
  });

  it("keeps the tempo, key, time and bar numbers", () => {
    expect(out.parts[0]!.measures[0]!.tempos[0]!.qpm).toBe(73);
    expect(out.parts[0]!.measures[0]!.time).toEqual({ beats: 4, beatType: 4 });
    expect(out.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2", "3"]);
  });

  it("keeps repeats and endings, so it plays the way it did", () => {
    const repeated = xml.replace('<measure number="2">', '<measure number="2"><barline location="left"><ending number="1" type="start"/></barline>').replace('<measure number="3">', '<measure number="3"><barline location="left"><repeat direction="forward"/></barline>');
    const again = parseScore(repeated);
    const asked = pieceInput(again, again.parts[0]!, 0, 2);
    const moved = parseScore(scoreOfParts(again, asked, placeNotes(again, asked, plan(WHOLE), instruments).parts));
    expect(moved.parts[0]!.measures[1]!.endings[0]).toMatchObject({ numbers: [1], type: "start" });
    expect(moved.parts[0]!.measures[2]!.repeatForward).toBe(true);
  });

  it("writes a triplet as a triplet", () => {
    const three = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Inst 1</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n("C5", 1)}${n("D5", 1)}${n("E5", 1)}${n("F5", 9)}</measure></part></score-partwise>`;
    const s = parseScore(three);
    const asked = pieceInput(s, s.parts[0]!, 0, 0);
    const text2 = scoreOfParts(s, asked, placeNotes(s, asked, plan([{ line: "Inst 1", part: "Violin I", from: "1", to: "1" }]), ["Violin I"]).parts);
    expect(text2.match(/<actual-notes>3<\/actual-notes>/g)).toHaveLength(3);
    const back = parseScore(text2).parts[0]!;
    expect(back.notes.filter((x) => !x.rest).map((x) => Math.round((x.onset / parseScore(text2).ticksPerQuarter) * 1000) / 1000)).toEqual([0, 0.333, 0.667, 1]);
  });
});

describe("splitting a track of chords", () => {
  const chordsXml = (bars: string[]) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Kontakt</part-name></score-part><score-part id="P2"><part-name>Inst 1</part-name></score-part></part-list>${part("P1", bars.map((b, k) => (k ? b : head() + b)))}${part("P2", bars.map((_, k) => (k ? n("E5", 8) : head() + n("E5", 8))))}</score-partwise>`;
  const line = (s: Score, name: string) => s.parts.find((p) => p.name === name)!.notes.filter((x) => !x.rest).map((x) => `${x.pitch!.step}${x.pitch!.alter === 1 ? "#" : ""}${x.pitch!.octave}`);
  const splitOf = (xmlText: string) => {
    const s = parseScore(xmlText);
    const asked = pieceInput(s, s.parts[0]!, 0, s.parts[0]!.measures.length - 1);
    return { before: s, asked, after: parseScore(scoreWithSplits(s, asked, ["Kontakt"])) };
  };

  it("finds the tracks that play chords, and how many at once", () => {
    const s = parseScore(chordsXml([chord(["E4", "G4", "B4"], 8), chord(["D4", "A4"], 8)]));
    expect(chordTracks(s, pieceInput(s, s.parts[0]!, 0, 1))).toEqual([{ line: "Kontakt", most: 3 }]);
  });

  it("makes one line for each note, top to bottom, and changes nothing else", () => {
    const { before, after } = splitOf(chordsXml([chord(["E4", "G4", "B4"], 8), chord(["D4", "F#4", "A4"], 8)]));
    expect(after.parts.map((p) => p.name)).toEqual(["Kontakt 1", "Kontakt 2", "Kontakt 3", "Inst 1"]);
    expect(line(after, "Kontakt 1")).toEqual(["B4", "A4"]);
    expect(line(after, "Kontakt 2")).toEqual(["G4", "F#4"]);
    expect(line(after, "Kontakt 3")).toEqual(["E4", "D4"]);
    expect(line(after, "Inst 1")).toEqual(["E5", "E5"]);
    const key = (s: Score) => scoreTracks(s).flatMap((t) => t.notes.map((x) => `${x.start}|${x.length}|${x.height}`)).sort();
    expect(key(after)).toEqual(key(before));
  });

  it("gives a smaller chord to the nearest lines, so each moves as little as it can", () => {
    const { after } = splitOf(chordsXml([chord(["C4", "E4", "G4"], 8), chord(["C4", "G4"], 8), n("E4", 8)]));
    expect(line(after, "Kontakt 1")).toEqual(["G4", "G4"]);
    expect(line(after, "Kontakt 2")).toEqual(["E4", "E4"]);
    expect(line(after, "Kontakt 3")).toEqual(["C4", "C4"]);
  });

  it("keeps a held note on its own line across the bar", () => {
    const { after } = splitOf(chordsXml([n("G4", 8, "tieS") + "<backup><duration>8</duration></backup>" + n("C4", 8), n("G4", 8, "tieE") + "<backup><duration>8</duration></backup>" + n("D4", 8)]));
    const top = after.parts[0]!.notes.filter((x) => !x.rest);
    expect(top.map((x) => [x.pitch!.step, x.tieStart, x.tieStop])).toEqual([["G", true, false], ["G", false, true]]);
    expect(line(after, "Kontakt 2")).toEqual(["C4", "D4"]);
    expect(scoreTracks(after)[0]!.notes).toEqual([{ start: 0, length: 8, height: 67 }]);
  });

  it("leaves a track with no chords as it is", () => {
    const s = parseScore(chordsXml([n("C4", 8), n("D4", 8)]));
    const asked = pieceInput(s, s.parts[0]!, 0, 1);
    expect(chordTracks(s, asked)).toEqual([]);
    expect(parseScore(scoreWithSplits(s, asked, ["Kontakt"])).parts.map((p) => p.name)).toEqual(["Kontakt", "Inst 1"]);
  });
});

describe("colouring notes by what they do", () => {
  const roles = [{ from: "1", to: "2", line: "Inst 1", role: "melody" as const, of: "", why: "x" }, { from: "1", to: "3", line: "Inst 2", role: "bass" as const, of: "", why: "x" }];
  const notesIn = (text: string, id: string, bar: string) => {
    const part = text.split(`<part id="${id}"`)[1]!.split("</part>")[0]!;
    return part.split(`<measure number="${bar}"`)[1]!.split("</measure>")[0]!;
  };
  const painted = withRoleColours(xml, score, roles, ["1", "2", "3"]);

  it("colours each line for the bars it has that role, and leaves the rest black", () => {
    expect(notesIn(painted, "P1", "1")).toContain(`color="${ROLE_COLOURS.melody}"`);
    expect(notesIn(painted, "P1", "3")).not.toContain("color=");
    expect(notesIn(painted, "P3", "3")).toContain(`color="${ROLE_COLOURS.bass}"`);
    expect(notesIn(painted, "P2", "1")).not.toContain("color=");
  });

  it("changes nothing a reader would play", () => {
    const key = (s: Score) => scoreTracks(s).flatMap((t) => t.notes.map((x) => `${x.start}|${x.length}|${x.height}`));
    expect(key(parseScore(painted))).toEqual(key(score));
  });

  it("lets the line a listener follows win where a staff has two roles in a bar", () => {
    const both = withRoleColours(xml, score, [{ from: "1", to: "1", line: "Inst 1", role: "melody", of: "", why: "x" }, { from: "1", to: "1", line: "Inst 1", role: "doubling", of: "", why: "x" }], ["1", "2", "3"]);
    expect(notesIn(both, "P1", "1")).toContain(ROLE_COLOURS.melody);
    expect(notesIn(both, "P1", "1")).not.toContain(ROLE_COLOURS.doubling);
  });

  it("fades everything but the role picked out, including notes with no role", () => {
    const only = withRoleColours(xml, score, roles, ["1", "2", "3"], "bass");
    expect(notesIn(only, "P3", "1")).toContain(ROLE_COLOURS.bass);
    expect(notesIn(only, "P1", "1")).toContain(FADED);
    expect(notesIn(only, "P2", "1")).toContain(FADED);
  });

  it("tells the staves of one part apart", () => {
    const grand = parseScore(`<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff></note></measure></part></score-partwise>`);
    const text = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><staff>2</staff></note></measure></part></score-partwise>`;
    const out = withRoleColours(text, grand, [{ from: "1", to: "1", line: "Piano upper", role: "melody", of: "", why: "x" }, { from: "1", to: "1", line: "Piano lower", role: "bass", of: "", why: "x" }], ["1"]);
    expect(out.indexOf(ROLE_COLOURS.melody)).toBeLessThan(out.indexOf(ROLE_COLOURS.bass));
    expect(out.match(/color=/g)).toHaveLength(2);
  });
});

describe("one stretch for the page", () => {
  it("hides pedal marks on the page, and keeps a tempo in the same place", () => {
    const marked = xml.replace('<measure number="2">', '<measure number="2"><direction><direction-type><pedal type="start"/></direction-type></direction><direction><direction-type><words>Slower</words></direction-type></direction>');
    const page = onlyBars(marked, "1", "3");
    expect(page).not.toContain("<pedal");
    expect(page).toContain("Slower");
    expect(page).toContain('tempo="73"');
    expect(marked).toContain("<pedal");
  });

  it("says a clef, key and time once, however often the file repeats them", () => {
    const bar = (n: number, head: string) => `<measure number="${n}">${head}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note></measure>`;
    const head = (beats: number, sign: string) => `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><clef><sign>${sign}</sign><line>2</line></clef></attributes>`;
    const text = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Inst 1</part-name></score-part></part-list><part id="P1">${bar(1, head(4, "G"))}${bar(2, "")}${bar(3, head(4, "G"))}${bar(4, head(4, "C"))}${bar(5, head(3, "C"))}</part></score-partwise>`;
    const page = onlyBars(text, "1", "5");
    expect(page.match(/<clef>/g)).toHaveLength(2);
    expect(page.match(/<time>/g)).toHaveLength(2);
    expect(page.match(/<key>/g)).toHaveLength(1);
    expect(page.match(/<divisions>/g)!.length).toBeGreaterThanOrEqual(4);
    const shown = parseScore(page).parts[0]!.measures;
    expect(shown[3]!.clefs[0]!.sign).toBe("C");
    expect(shown[4]!.time).toEqual({ beats: 3, beatType: 4 });
  });

  it("shows only those bars, with their own numbers, and what each needs to read on its own", () => {
    const shown = parseScore(onlyBars(xml, "2", "3"));
    expect(shown.parts[0]!.measures.map((m) => m.number)).toEqual(["2", "3"]);
    expect(shown.parts[0]!.measures[0]!.time).toEqual({ beats: 4, beatType: 4 });
    expect(shown.parts[2]!.measures[0]!.clefs[0]!.sign).toBe("F");
    expect(shown.parts[0]!.measures[0]!.tempos[0]!.qpm).toBe(73);
  });

  it("leaves out the staves with nothing to play there, and the title", () => {
    const rest = '<note><rest/><duration>8</duration><voice>1</voice></note>';
    const quiet = `<?xml version="1.0"?><score-partwise><work><work-title>Sketch</work-title></work><part-list><score-part id="P1"><part-name>Inst 1</part-name></score-part><score-part id="P2"><part-name>Inst 2</part-name></score-part></part-list>${part("P1", [head() + n("C4", 8), n("D4", 8)])}${part("P2", [head() + n("E4", 8), rest])}</score-partwise>`;
    const shown = parseScore(onlyBars(quiet, "2", "2"));
    expect(shown.parts.map((p) => p.name)).toEqual(["Inst 1"]);
    expect(shown.title ?? null).toBeNull();
    expect(parseScore(onlyBars(quiet, "1", "2")).parts.map((p) => p.name)).toEqual(["Inst 1", "Inst 2"]);
  });

  it("keeps the staves if every one is silent, so the page is never empty", () => {
    const silent = xml.replace(/<note>[\s\S]*?<\/note>/g, '<note><rest/><duration>8</duration><voice>1</voice></note>');
    expect(parseScore(onlyBars(silent, "1", "1")).parts.length).toBe(3);
  });
});

describe("when nothing could be written", () => {
  it("says why, and what to do", () => {
    expect(checkWords({ adds: [], notes: 0, overBars: 45, unreadable: 0, pastBarEnd: 0, outOfRange: [], clashes: [] })[0]).toContain("Choose more instruments or ask for new bars");
  });
});

describe("roles after the move", () => {
  it("follows the plan, only where it overlaps, and draws the tune last", () => {
    const roles = [{ from: "1", to: "3", line: "Inst 1", role: "melody" as const, of: "", why: "x" }, { from: "1", to: "2", line: "Kontakt", role: "doubling" as const, of: "Inst 1", why: "x" }];
    const moved = rolesAfter([{ from: "2", to: "3", line: "Inst 1", voice: "all", part: "Flute", octave: 0, why: "x" }, { from: "1", to: "3", line: "Kontakt", voice: "1", part: "Flute", octave: 0, why: "x" }], roles, ["1", "2", "3"]);
    expect(moved).toEqual([{ from: "1", to: "2", line: "Flute", role: "doubling", of: "", why: "x" }, { from: "2", to: "3", line: "Flute", role: "melody", of: "", why: "x" }]);
  });
});

describe("what goes to Muse Spark", () => {
  const asked = { ...input, instruments, roles: [], tracks: [{ line: "Kontakt", instrument: "Pad" }], answers: [{ ask: "Key?", answer: "E minor" }], ask: "Warm" };

  it("names the instruments and what the composer settled", () => {
    const parsed = distribute.parse(asked)!;
    const { input: text, schema } = distribute.build(parsed);
    expect(text).toContain("The instruments, in score order: Violin I, Violin II, Viola, Cello, Double Bass.");
    expect(text).toContain("Kontakt: Pad");
    expect(text).toContain("Key? E minor");
    expect(text).toContain("The composer says: Warm");
    expect(JSON.stringify(schema)).toContain('"enum":["Violin I"');
  });

  it("takes nothing it shouldn't", () => {
    expect(distribute.parse({ ...asked, instruments: [] })).toBeNull();
    expect(distribute.parse({ ...asked, instruments: ["Viola", "Viola"] })).toBeNull();
    expect(distribute.parse({ ...asked, tracks: [{ line: "Nobody", instrument: "Pad" }] })).toBeNull();
    expect(distribute.parse({ ...asked, answers: [{ ask: "x", answer: "y".repeat(301) }] })).toBeNull();
    expect(distribute.parse(null)).toBeNull();
  });

  it("never loses a paid answer over its shape", () => {
    expect(distribute.check(asked, { idea: "x", plan: [] })).toBeNull();
    expect(distribute.check(asked, { idea: "Your coach will like this.", plan: [] })).not.toBeNull();
    expect(distribute.check(asked, {})).not.toBeNull();
  });
});

describe("facts about instruments", () => {
  it("knows a DAW's short names, and doesn't guess at the rest", () => {
    expect(instrumentFromName("Strng Long")).toBe("Strings");
    expect(instrumentFromName("str")).toBe("Strings");
    expect(instrumentFromName("Brass 2")).toBe("Brass");
    expect(instrumentFromName("Vln 1")).toBe("Violin I");
    expect(instrumentFromName("VC")).toBe("Cello");
    expect(instrumentFromName("Inst 1")).toBeNull();
    expect(instrumentFromName("Kontakt")).toBeNull();
  });

  it("puts any choice in score order", () => {
    expect(inScoreOrder(["Double Bass", "Flute", "Violin II", "Horn 1", "Violin I", "Theremin"])).toEqual(["Flute", "Horn 1", "Violin I", "Violin II", "Double Bass", "Theremin"]);
  });

  it("has templates already in score order", () => {
    for (const t of TEMPLATES) expect(inScoreOrder(t.instruments)).toEqual(t.instruments);
    expect(TEMPLATES.every((t) => t.instruments.length <= 32)).toBe(true);
  });
});
