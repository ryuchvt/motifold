// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { DrawnScore } from "./drawScore";
import { paintStudyMarks, type StudyMarks } from "./studyMarks";

vi.mock("./barOverlay", () => ({ barBox: () => ({ x: 0, y: 100, width: 200, height: 120 }) }));
const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
afterEach(() => { if (bbox) Object.defineProperty(SVGElement.prototype, "getBBox", bbox); else delete (SVGElement.prototype as Partial<SVGGraphicsElement>).getBBox; document.body.replaceChildren(); });
function setup() {
  // jsdom has no SVG text layout. Use its actual painted baselines plus a descender for the browser's bounding-box measurement.
  Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value(this: SVGElement) {
    const bottom = Math.max(0, ...[...this.querySelectorAll("text")].map((text) => Number(text.getAttribute("y")) + 4));
    return { x: 0, y: 0, width: 200, height: bottom };
  } });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "400"); svg.setAttribute("height", "200"); svg.setAttribute("viewBox", "0 0 500 250"); document.body.appendChild(svg);
  const drawn = { osmd: { Drawer: { Backends: [{ getSvgElement: () => svg }] }, GraphicSheet: { MeasureList: [[]] } }, elementOf: new Map(), unmappedBars: new Map() } as unknown as DrawnScore;
  const marks: StudyMarks = { partId: null, sections: [], chords: [], passages: [], focus: [], heights: {}, said: [{ bar: 0, tone: "held", words: "The accompaniment holds its line while the melody turns towards the next phrase. This description needs more than one line beneath the final system of music." }] };
  return { svg, drawn, marks };
}

it("fits the final system's descriptive lines without changing note scale, accumulating height, or leaving blank space after clearing", () => {
  const { svg, drawn, marks } = setup();
  paintStudyMarks(drawn, marks);
  const height = Number(svg.getAttribute("height")), view = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const lastLine = Math.max(...[...svg.querySelectorAll(".pp-study-said")].map((text) => Number(text.getAttribute("y")) + 4));
  expect(lastLine).toBeGreaterThan(250);
  expect(view[3]).toBeGreaterThan(lastLine);
  expect(height / view[3]!).toBeCloseTo(200 / 250);
  expect(svg.getAttribute("width")).toBe("400");
  paintStudyMarks(drawn, marks);
  expect(Number(svg.getAttribute("height"))).toBe(height);
  paintStudyMarks(drawn, null);
  expect(svg.querySelector(".pp-study")).toBeNull();
  expect(svg.getAttribute("height")).toBe("200");
  expect(svg.getAttribute("viewBox")).toBe("0 0 500 250");
});

it("preserves a new native canvas after the notation itself is resized", () => {
  const { svg, drawn, marks } = setup();
  paintStudyMarks(drawn, marks);
  svg.setAttribute("height", "300"); svg.setAttribute("viewBox", "0 0 500 375");
  paintStudyMarks(drawn, marks);
  paintStudyMarks(drawn, null);
  expect(svg.getAttribute("height")).toBe("300");
  expect(svg.getAttribute("viewBox")).toBe("0 0 500 375");
});
