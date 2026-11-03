import { expect, it } from "vitest";
import { parseScore } from "./index";

const read = (inside: string) => parseScore(`<score-partwise><part-list><score-part id="P1"><part-name>Sketch</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${inside}<note><rest/><duration>8</duration></note></measure></part></score-partwise>`).parts[0]!.measures[0]!;
const direction = (offset: string, sound: string) => `<direction><direction-type><dynamics><p/></dynamics></direction-type>${offset}${sound}</direction>`;

it("direction offsets are visual unless playback is explicit, and a sound's own offset takes precedence", () => {
  const cases = [
    { offset: "<offset>4</offset>", sound: '<sound tempo="60" dynamics="50"/>', audible: 0 },
    { offset: '<offset sound="no">4</offset>', sound: '<sound tempo="60" dynamics="50"/>', audible: 0 },
    { offset: '<offset sound="yes">4</offset>', sound: '<sound tempo="60" dynamics="50"/>', audible: 4 },
    { offset: '<offset sound="yes">4</offset>', sound: '<sound tempo="60" dynamics="50"><offset>2</offset></sound>', audible: 2 },
    { offset: '<offset sound="yes">4</offset>', sound: '<sound tempo="60" dynamics="50"><offset>0</offset></sound>', audible: 0 },
  ];
  for (const row of cases) {
    const measure = read(direction(row.offset, row.sound));
    expect(measure.tempos).toEqual([{ onset: row.audible, qpm: 60 }]);
    expect(measure.levels).toEqual([{ onset: row.audible, velocity: 45 }]);
    expect(measure.dynamicMarks).toEqual([{ onset: 4, kind: "dynamics", value: "p" }]);
  }
});

it("standalone sound offsets are relative to the musical cursor, and visual metronome offsets do not silently seek playback", () => {
  expect(read('<forward><duration>2</duration></forward><sound tempo="72"><offset>4</offset></sound><backup><duration>2</duration></backup>').tempos).toEqual([{ onset: 6, qpm: 72 }]);
  const metronome = (attribute: string) => `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type><offset${attribute}>4</offset></direction>`;
  expect(read(metronome("")).tempos).toEqual([{ onset: 0, qpm: 90 }]);
  expect(read(metronome(' sound="yes"')).tempos).toEqual([{ onset: 4, qpm: 90 }]);
});
