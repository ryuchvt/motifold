import { describe, expect, it } from "vitest";
import { arcPieces, wrapWords } from "./studyMarks";

// Three bars to a line of music, a hundred wide.
const boxOf = (bar: number) => ({ x: (bar % 3) * 100, y: Math.floor(bar / 3) * 200, width: 100, height: 60 });

describe("a section's arc over the lines of music", () => {
  it("stays whole when the section fits on one line", () => {
    expect(arcPieces([{ from: 0, to: 1, }], boxOf)).toEqual([{ section: 0, bar: 0, y: 0, x0: 0, x1: 200, opens: true, closes: true }]);
  });

  it("is cut at the end of a line, open where it carries over, and only its first piece carries the words", () => {
    expect(arcPieces([{ from: 1, to: 3, }], boxOf)).toEqual([
      { section: 0, bar: 1, y: 0, x0: 100, x1: 300, opens: true, closes: false },
      { section: 0, bar: 3, y: 200, x0: 0, x1: 100, opens: false, closes: true },
    ]);
  });

  it("skips a bar that wasn't drawn", () => {
    const missing = (bar: number) => (bar === 1 ? null : boxOf(bar));
    expect(arcPieces([{ from: 1, to: 2, }], missing)).toEqual([{ section: 0, bar: 2, y: 0, x0: 200, x1: 300, opens: false, closes: true }]);
  });
});

describe("words on the score", () => {
  const wide = (text: string) => text.length;

  it("keeps a line that fits", () => {
    expect(wrapWords("lands home", 20, wide)).toEqual(["lands home"]);
  });

  it("breaks between words, never inside one", () => {
    expect(wrapWords("falling line lands home on the tonic", 16, wide)).toEqual(["falling line", "lands home on", "the tonic"]);
  });

  it("gives a word too wide for the line a line of its own", () => {
    expect(wrapWords("a extraordinarily b", 5, wide)).toEqual(["a", "extraordinarily", "b"]);
  });
});
