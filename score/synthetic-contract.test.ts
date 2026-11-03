import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScore, parseScoreFile, partListening, playOrder } from ".";

// Original parser examples. The shared fixture supplies score shape, not a real piece's note sequence.
const fixture = () => parseScoreFile(readFileSync("test-fixtures/contract-score.musicxml")).score;
const attributes = '<attributes><divisions>6</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (step: string, duration: number, extra = "", octave = 4) => `<note>${extra.includes("<chord/>") ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra.replace("<chord/>", "")}</note>`;
const doc = (bars: string, name = "Cello") => `<score-partwise><work><work-title>Parser contract</work-title></work><identification><creator type="composer">Test author</creator></identification><part-list><score-part id="P1"><part-name>${name}</part-name></score-part></part-list><part id="P1">${bars}</part></score-partwise>`;
const measure = (number: string, body: string) => `<measure number="${number}">${body}</measure>`;

describe("original score parser contracts", () => {
  it("reads title and creator metadata independently of the notes", () => {
    const score = parseScore(doc(measure("1", attributes + note("C", 24))));
    expect(score.title).toBe("Parser contract");
    expect(score.composer).toBe("Test author");
  });

  it("keeps one cello staff, two piano staves and all nonnumeric printed labels in the shared fixture", () => {
    const score = fixture();
    expect(score.parts.map((part) => [part.id, part.staves])).toEqual([["P1", 1], ["P2", 2]]);
    const labels = ["1", "2", "3", "4", "5", "6", "7", "7a", "7b", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "19a", "20", "21"];
    for (const part of score.parts) expect(part.measures.map((m) => m.number)).toEqual(labels);
  });

  it("counts grace and tied printed notes without moving the following rhythmic attacks", () => {
    const grace = '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><type>16th</type></note>';
    const score = parseScore(doc(measure("1", attributes + grace + note("D", 6, '<tie type="start"/>') + note("D", 6, '<tie type="stop"/>') + note("E", 12))));
    const notes = score.parts[0]!.notes;
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => [n.onset / score.ticksPerQuarter, n.duration / score.ticksPerQuarter, n.grace])).toEqual([[0, 0, true], [0, 1, false], [1, 1, false], [2, 2, false]]);
    expect(notes[1]!.tieStart).toBe(true);
    expect(notes[2]!.tieStop).toBe(true);
    expect(notes[1]!.soundingMidi).toBe(notes[2]!.soundingMidi);
  });

  it("keeps both printed segments and their addresses when a tie crosses a barline", () => {
    const score = parseScore(doc(measure("1", attributes + note("F", 24, '<tie type="start"/>')) + measure("2", note("F", 6, '<tie type="stop"/>') + '<note><rest/><duration>18</duration></note>')));
    const part = score.parts[0]!;
    const notes = part.notes.filter((n) => !n.rest);
    expect(notes.map((n) => [n.ref.measureIndex, n.onset / score.ticksPerQuarter, n.duration / score.ticksPerQuarter, n.soundingMidi])).toEqual([[0, 0, 4, 65], [1, 0, 1, 65]]);
    expect(notes[0]!.tieStart).toBe(true);
    expect(notes[1]!.tieStop).toBe(true);
    expect(part.measures[1]!.start / score.ticksPerQuarter).toBe(4);
  });

  it("keeps simultaneous chords and separate voices on their own piano staves", () => {
    const upper = '<voice>1</voice><staff>1</staff>';
    const bars = measure("1", attributes.replace('</attributes>', '<staves>2</staves></attributes>') + note("C", 12, upper) + note("E", 12, '<chord/>' + upper) + '<backup><duration>12</duration></backup>' + note("G", 24, '<voice>2</voice><staff>1</staff>', 3) + '<backup><duration>24</duration></backup>' + note("C", 24, '<voice>3</voice><staff>2</staff>', 2));
    const score = parseScore(doc(bars, "Piano"));
    const part = score.parts[0]!;
    expect(part.staves).toBe(2);
    expect(part.notes.map((n) => [n.staff, n.voice, n.onset, n.soundingMidi, n.chord])).toEqual([[1, "1", 0, 60, false], [1, "1", 0, 64, true], [1, "2", 0, 55, false], [2, "3", 0, 36, false]]);
    expect(part.measures[0]!.length / score.ticksPerQuarter).toBe(4);
  });

  it("keeps triplet subdivisions exact rather than snapping them to straight eighths", () => {
    const triplet = '<type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    const score = parseScore(doc(measure("1", attributes + ["C", "D", "E"].map((step) => note(step, 2, triplet)).join("") + '<note><rest/><duration>18</duration></note>')));
    const notes = score.parts[0]!.notes.filter((n) => !n.rest);
    expect(notes.map((n) => n.onset / score.ticksPerQuarter)).toEqual([0, 1 / 3, 2 / 3]);
    expect(notes.map((n) => n.duration / score.ticksPerQuarter)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(score.parts[0]!.measures[0]!.length / score.ticksPerQuarter).toBe(4);
  });

  it("plays two independent repeats and all four endings without losing or repeating the wrong ending", () => {
    const start = '<barline location="left"><repeat direction="forward"/></barline>';
    const ending = (pass: number, last: boolean) => ({ before: `<barline location="left"><ending number="${pass}" type="start"/></barline>`, after: `<barline location="right"><ending number="${pass}" type="${last ? "discontinue" : "stop"}"/>${last ? "" : '<repeat direction="backward"/>'}</barline>` });
    const first = ending(1, false), second = ending(2, true);
    const bars = measure("1", attributes + start + note("C", 24)) + measure("2", first.before + note("D", 24) + first.after) + measure("2a", second.before + note("E", 24) + second.after) + measure("3", start + note("F", 24)) + measure("4", first.before + note("G", 24) + first.after) + measure("4a", second.before + note("A", 24) + second.after);
    const part = parseScore(doc(bars)).parts[0]!;
    const played = playOrder(part.measures);
    expect(played.problems).toEqual([]);
    expect(played.unreachableEndings).toEqual([]);
    expect(played.measures.map((m) => part.measures[m.measureIndex]!.number)).toEqual(["1", "2", "1", "2a", "3", "4", "3", "4a"]);
  });

  it("blocks a grace-note bar for listening while allowing the next plain monophonic bar", () => {
    const grace = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>';
    const part = parseScore(doc(measure("1", attributes + grace + note("C", 24)) + measure("2", note("E", 24)))).parts[0]!;
    const listening = partListening(part, playOrder(part.measures));
    expect(listening.listenable).toBe(true);
    expect(listening.blocked.get(0)).toEqual(["grace"]);
    expect(listening.blocked.has(1)).toBe(false);
  });

  it("does not offer a two-staff piano part as a monophonic listening line", () => {
    const part = parseScore(doc(measure("1", attributes.replace('</attributes>', '<staves>2</staves></attributes>') + note("C", 24)), "Piano")).parts[0]!;
    const listening = partListening(part, playOrder(part.measures));
    expect(listening.listenable).toBe(false);
    expect(listening.blocked.get(0)).toEqual(["staves"]);
  });
});
