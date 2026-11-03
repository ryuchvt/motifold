// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { StudyScoreAnswer, StudyScoreInput } from "../server/shapes";
import { PieceView } from "./PieceView";
import { pieceData } from "./pieceData";
import { StudyMap, studyMarksOf } from "./ScoreStudy";

vi.mock("./audio/samples", () => ({ loadManifest: async () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note></measure><measure number="2"><note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration></note><note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
const score = parseScore(xml);
const written: StudyScoreInput["written"] = [{ bar: "1", notes: "C4 E4 G4", rhythm: "1 1 2", measure: 0 }, { bar: "2", notes: "G3 B3 D4 F4", rhythm: "1x4", measure: 1 }];
const answer: StudyScoreAnswer = {
  overview: "A phrase and its answer.", sections: [{ from: "1", to: "1", form: "A", name: "Tune", mood: "open", what: "The phrase starts." }, { from: "2", to: "2", form: "A'", name: "Tune again", mood: "unsettled", what: "The idea comes back." }],
  harmony: [{ from: "1", to: "1", note: 1, chord: "C", numeral: "I" }, { from: "2", to: "2", note: 1, chord: "G7", numeral: "V7" }], moments: [],
};
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function host() { const el = document.body.appendChild(document.createElement("div")); root = createRoot(el); return el; }
const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) });

it("keeps a section's mouse and keyboard description above clipping panels and inside a small viewport", () => {
  vi.useFakeTimers();
  vi.stubGlobal("innerWidth", 320); vi.stubGlobal("innerHeight", 240);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return this.classList.contains("stage-tooltip") ? box(0, 0, 292, 160) : box(295, 214, 20, 20); });
  const el = host();
  act(() => root!.render(<div style={{ overflow: "hidden", height: 20 }}><PieceView data={pieceData(score, [], [])} sections={answer.sections} moments={[]} selected={{ from: "1", to: "2" }} focus={null} solo={[]} instrumentOf={() => "Piano"} hasNew={false} onSelect={() => {}} onSelectRange={() => {}} onFocus={() => {}} onSolo={() => {}} forms={answer.sections}/></div>));
  const button = el.querySelector<HTMLButtonElement>(".stage-section")!;
  act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.parentElement).toBe(document.body);
  expect(tooltip.textContent).toContain("The phrase starts.");
  expect(tooltip.style.left).toBe("16px");
  expect(tooltip.style.top).toBe("46px");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  act(() => button.focus());
  act(() => { button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); vi.advanceTimersByTime(150); });
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBeNull();
});

it("lets a pointer reach the description without losing it, then dismisses it when both pointer and focus leave", () => {
  vi.useFakeTimers();
  const el = host();
  act(() => root!.render(<PieceView data={pieceData(score, [], [])} sections={answer.sections} moments={[]} selected={{ from: "1", to: "2" }} focus={null} solo={[]} instrumentOf={() => "Piano"} hasNew={false} onSelect={() => {}} onSelectRange={() => {}} onFocus={() => {}} onSolo={() => {}} forms={answer.sections}/>));
  const button = el.querySelector<HTMLButtonElement>(".stage-section")!;
  act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  act(() => { button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); tooltip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); vi.advanceTimersByTime(150); });
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  act(() => { tooltip.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); vi.advanceTimersByTime(150); });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  act(() => root!.render(<PieceView data={pieceData(score, [], [])} sections={answer.sections} moments={[]} selected={{ from: "1", to: "2" }} focus={null} solo={[]} instrumentOf={() => "Piano"} hasNew={false} onSelect={() => {}} onSelectRange={() => {}} onFocus={() => {}} onSolo={() => {}} forms={answer.sections.map((section) => ({ ...section, what: "A newer reading." }))}/>));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("shows real chord symbols and numerals, their function legend, and matching labels on the score", () => {
  const onBar = vi.fn();
  const el = host();
  act(() => root!.render(<div className="studio"><StudyMap answer={answer} written={written} onBar={onBar}/></div>));
  const chords = [...el.querySelectorAll<HTMLButtonElement>(".study-chord")];
  expect(chords.map((button) => button.querySelector("strong")!.textContent)).toEqual(["C", "G7"]);
  expect(chords.map((button) => button.querySelector(".study-chord-numeral")!.textContent)).toEqual(["I", "V7"]);
  expect(el.querySelector(".study-legend")!.textContent).toContain("Home");
  expect(el.querySelector(".study-legend")!.textContent).toContain("Dominant");
  const sections = [...el.querySelectorAll(".form-sections>li")];
  expect(sections[0]!.className).toBe(sections[1]!.className);
  act(() => chords[1]!.click());
  expect(onBar).toHaveBeenCalledWith("2");
  expect(studyMarksOf(answer, written, score.parts[0]!).chords).toMatchObject([{ chord: "C", numeral: "I", noteKey: "P1:0:0" }, { chord: "G7", numeral: "V7", noteKey: "P1:1:0" }]);
});

it("does not invent chord labels when a reading has no harmony", () => {
  const el = host();
  act(() => root!.render(<StudyMap answer={{ ...answer, harmony: [] }} written={written} onBar={() => {}}/>));
  expect(el.textContent).toContain("This reading has no chord labels.");
  expect(el.querySelector(".study-chord")).toBeNull();
});
