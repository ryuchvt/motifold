import { describe, expect, it } from "vitest";
import { chooseSample, seatOf, setOf, type Manifest } from "./samples";

const manifest: Manifest = { violins: { long: [60, 64, 67], short: [60, 67] }, harp: { long: [45, 57], short: [] }, snare: { hit: true }, timpani: { long: [41.5, 46.8], short: [] } };

describe("choosing a recording", () => {
  it("knows each instrument by the names a score uses", () => {
    expect(setOf("Violin I")).toBe("violins");
    expect(setOf("English Horn")).toBe("oboe");
    expect(setOf("Horn 3")).toBe("horn");
    expect(setOf("Bass Trombone")).toBe("trombone");
    expect(setOf("Double Bass")).toBe("basses");
    expect(setOf("Bass Drum")).toBe("bassdrum");
    expect(setOf("Kazoo")).toBeNull();
  });
  it("takes the nearest pitch, and shifts it exactly", () => {
    const chosen = chooseSample(manifest, "violins", 65, 1)!;
    expect(chosen.url).toBe("/samples/violins/64.m4a");
    expect(chosen.rate).toBeCloseTo(2 ** (1 / 12));
    expect(chosen.sustains).toBe(true);
  });
  it("takes a short recording for a short note", () => {
    expect(chooseSample(manifest, "violins", 67, 0.2)!.url).toBe("/samples/violins/s67.m4a");
  });
  it("lets a plucked or struck note ring, and tunes a drum from its measured pitch", () => {
    expect(chooseSample(manifest, "harp", 45, 0.1)).toMatchObject({ url: "/samples/harp/45.m4a", sustains: false });
    expect(chooseSample(manifest, "timpani", 43, 1)!.url).toBe("/samples/timpani/41.5.m4a");
    expect(chooseSample(manifest, "timpani", 43, 1)!.rate).toBeCloseTo(2 ** (1.5 / 12));
  });
  it("plays a hit whatever the note", () => {
    expect(chooseSample(manifest, "snare", 60, 0.1)).toEqual({ url: "/samples/snare/hit.m4a", rate: 1, sustains: false });
  });
  it("leaves it to the synth when there's nothing near enough", () => {
    expect(chooseSample(manifest, "violins", 90, 1)).toBeNull();
    expect(chooseSample(manifest, "tuba", 40, 1)).toBeNull();
  });
  it("seats the sections apart", () => {
    expect(seatOf("Violin I")).toBeLessThan(seatOf("Cello"));
  });
});
