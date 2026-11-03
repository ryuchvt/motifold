import { describe, expect, it } from "vitest";
import { midiFile, midiSlot } from "./arrange";
import { readMidi } from "./midi";

const parts = (count: number) => Array.from({ length: count }, (_, k) => ({ name: `Line ${k + 1}`, program: 40, notes: [{ start: 0, length: 1, height: 60 + (k % 12), velocity: 80 }] }));

describe("a full orchestra in one MIDI file", () => {
  it("never puts a pitched part on the drum channel, however many there are", () => {
    for (let k = 0; k < 64; k++) expect(midiSlot(k).channel).not.toBe(9);
    const tracks = parts(40);
    const back = readMidi(midiFile(tracks, 90, { beats: 4, beatType: 4 }));
    expect(back.tracks.map((t) => t.name)).toEqual(tracks.map((t) => t.name));
    expect(back.drums).toBe(0);
  });

  it("gives every part a channel and port of its own", () => {
    const slots = Array.from({ length: 60 }, (_, k) => midiSlot(k));
    expect(new Set(slots.map((s) => `${s.port}|${s.channel}`)).size).toBe(60);
    expect(slots.slice(0, 15).every((s) => s.port === 0)).toBe(true);
    expect(midiSlot(15).port).toBe(1);
  });

  it("names the port only past the first fifteen, before anything plays", () => {
    const bytes = midiFile(parts(16), 90, { beats: 4, beatType: 4 });
    const text = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
    expect(text.match(/ff 21 01/g)).toHaveLength(1);
    const port = text.indexOf("ff 21 01 01");
    expect(port).toBeGreaterThan(text.lastIndexOf("4c 69 6e 65 20 31 36"));
    expect(port).toBeLessThan(text.indexOf(" c0 28", port));
  });

  it("writes one part alone as it always did", () => {
    const text = Array.from(midiFile(parts(1), 90, { beats: 4, beatType: 4 }), (b) => b.toString(16).padStart(2, "0")).join(" ");
    expect(text).not.toContain("ff 21 01");
    expect(text).toContain("90 3c 50");
  });
});
