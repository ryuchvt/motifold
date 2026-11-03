// @vitest-environment jsdom
// Note-address contracts using the bundled Arioso, with local responses only.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore, type Score } from "../score";
import { studyScore, type StudyScoreAnswer, type StudyScoreInput } from "../server/shapes";
import { parseNoteRefKey } from "../render/drawScore";
import { pieceInput, withStructure } from "./arrange";
import { noteHeight } from "./notes";
import { wholeScoreInput, wholeScoreParts } from "./scoreInput";
import { useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const arioso = readFileSync("test-fixtures/arioso.musicxml", "utf8");
const response = (answer: unknown) => new Response(JSON.stringify({ status: "ok", answer, cached: false }));
let unmount = () => {};
afterEach(() => { act(unmount); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function answerFor(input: StudyScoreInput, note: number): StudyScoreAnswer {
  const from = input.written[0]!.bar;
  const to = input.written.at(-1)!.bar;
  const answer: StudyScoreAnswer = {
    overview: "A reading of the supplied notes.",
    sections: [{ from, to, form: "A", name: "Opening", mood: "calm", what: "The tune begins" }],
    harmony: [{ from, to: from, note, chord: "pass", numeral: "pass" }],
    moments: [{ bar: from, note, toBar: from, toNote: note, kind: "climax", what: "This note" }],
  };
  const parsed = studyScore.parse(input);
  expect(parsed).not.toBeNull();
  expect(studyScore.check(parsed!, answer)).toBeNull();
  return answer;
}

function setup(xmlText: string, note = 2, deferred = false) {
  const score = parseScore(xmlText);
  const part = score.parts[0]!;
  let asked!: StudyScoreInput;
  let finishStudy = () => {};
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string).input as StudyScoreInput;
    if (url.endsWith("study_score")) {
      asked = input;
      const answer = answerFor(input,note);
      return deferred ? await new Promise<Response>(resolve => { finishStudy = () => resolve(response(answer)); }) : response(answer);
    }
    if (url.endsWith("read_piece")) return response({ summary: "The supplied sketch", sections: [{ from: input.written[0]!.bar, to: input.written.at(-1)!.bar, name: "Opening" }], roles: [], missing: [], thin: [], structures: [] });
    throw Error("Unexpected request");
  });
  const loaded = { fileName: "arioso.musicxml", xmlText, score };
  const range = { from: 0, to: part.measures.length - 1 };
  let current!: Arranged;
  function Host() { current = useArrange(loaded,part,range,null); return null; }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { score, get now() { return current; }, get asked() { return asked; }, finishStudy: () => finishStudy() };
}

function markedPitch(score: Score, key: string): number {
  const ref = parseNoteRefKey(key);
  const part = score.parts.find(p=>p.id === ref.partId)!;
  return part.notes.find(n=>n.ref.measureIndex === ref.measureIndex && n.ref.noteIndex === ref.noteIndex)!.pitch!.midi;
}

it("maps a study of the actual pre-split Arioso onto the exact notes of that split score", async () => {
  const screen = setup(arioso);
  expect(screen.now.chords.map(c=>c.line)).toContain("Piano upper");
  act(() => screen.now.toggleSplit("Piano upper"));
  await act(() => screen.now.askPiece());
  const key = screen.now.studyMarks!.passages[0]!.keys[0]!;
  expect(markedPitch(screen.now.page!.score,key)).toBe(noteHeight(screen.asked.written[0]!.notes.split(" ")[1]!)!);
});

it("does not let an old delayed study land after a new order has been kept", async () => {
  const screen = setup(arioso,2,true);
  await act(() => screen.now.askPiece());
  expect(screen.now.study.status).toBe("asking");
  act(() => { screen.now.setHandOrder([{from:"9",to:"10"}]); screen.now.setTrying({kind:"structure",index:-1}); });
  act(() => screen.now.keep());
  expect(screen.now.study.status).toBe("none");
  await act(async () => { screen.finishStudy(); await Promise.resolve(); });
  expect(screen.now.study.status).toBe("none");
  expect(screen.now.studyMarks).toBeNull();
});

it("never moves first-movement study marks onto the different notes of a later movement with the same printed bar numbers", async () => {
  // Two actual Arioso excerpts, with numbering restarted as in a multi-movement MusicXML.
  const fourBars = withStructure(arioso,{order:[{from:"1",to:"2"},{from:"9",to:"10"}]});
  const restarted = fourBars.replace(/<measure number="3"/g,'<measure number="1"').replace(/<measure number="4"/g,'<measure number="2"');
  const screen = setup(restarted,1);
  await act(() => screen.now.askPiece());
  act(() => screen.now.selectRange("1","2"));
  expect(screen.asked.written.map(w=>w.measure)).toEqual([0,1]);
  // Marking nothing on bars it can't place is a valid repair (Claude, review F5). Marking them is valid only on the very notes studied.
  const key = screen.now.studyMarks?.passages[0]?.keys[0];
  if (key) expect(markedPitch(screen.now.page!.score,key), "the first B3 supplied to the study is painted over bar 9's C4 from the other excerpt").toBe(noteHeight(screen.asked.written[0]!.notes.split(" ")[0]!)!);
});

it("uses the same single-line note numbering as a valid large-score fallback", async () => {
  // Repeat the bundled score with unique numbers: a normal 216-bar import, below the 300-bar input limit.
  const longXml = arioso.replace(/(<part id="[^"]+">)([\s\S]*?)(<\/part>)/g,(_all,open:string,body:string,close:string)=> {
    let number=0;
    return open+Array.from({length:9},()=>body.replace(/<measure number="[^"]+"/g,()=>`<measure number="${++number}"`)).join("")+close;
  });
  const screen = setup(longXml,2);
  expect(wholeScoreParts(screen.score)).not.toBeNull();
  expect(wholeScoreInput(screen.score,0,215)).toBeNull(); // The existing 60-KB whole-score fallback.
  expect(pieceInput(screen.score,screen.score.parts[0]!,0,215).lines).toEqual(["Violoncello"]);
  await act(() => screen.now.askPiece());
  act(() => screen.now.selectRange("1","2"));
  const key = screen.now.studyMarks!.passages[0]!.keys[0]!;
  expect(markedPitch(screen.now.page!.score,key), "note 2 of the supplied solo is B3, whereas all-part numbering paints piano G2").toBe(noteHeight(screen.asked.written[0]!.notes.split(" ")[1]!)!);
}, 30_000);
