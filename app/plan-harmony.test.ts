import { expect, it } from "vitest";
import { parseScore } from "../score";
import { recordedDemoCatalog, type DemoOutcome, type DemoPlanHarmony } from "./demo";
import { passagePlanHarmony } from "./planHarmony";

const complete: DemoOutcome = { id: "local-a", runKey: "local-plan", intent: "recompose", ensemble: "Full orchestra", mood: "Neutral", option: 0, name: "Original local plan", bars: 3, sourceBars: 3, status: "complete", xml: "/demo/local/a.xml", midi: "/demo/local/a.mid", zip: "/demo/local/a.zip", xmlSha256: "a".repeat(64) };
const catalog = (row: unknown) => ({ version: 1, pieceId: "local", recorded: "2026-11-04", outcomes: [row] });
const span = { from: "1", to: "3", chords: "Cmaj7 | Fadd9 / G7, leave the final colour open" };
const score = (labels: string[]) => parseScore(`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${labels.map((label,i)=>`<measure number="${label}">${i?"":'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>`).join("")}</part></score-partwise>`);

it("accepts old catalogs and exact bounded optional plan text bound to a complete score", () => {
  expect(recordedDemoCatalog(catalog(complete), "local")).not.toBeNull();
  const supplied = { ...complete, planHarmony: [{ ...span, chords: "  Cmaj7 | F♯m7 / B7  " }] };
  expect(recordedDemoCatalog(catalog(supplied), "local")!.outcomes[0]!.planHarmony).toBe(supplied.planHarmony);
  expect(recordedDemoCatalog(catalog({ ...complete, planHarmony: [] }), "local")).not.toBeNull();
});

it.each([
  null, {}, span, Array.from({ length: 41 }, () => span),
  [{ from: "1", to: "3" }], [{ ...span, roman: "I IV V" }],
  [{ ...span, from: "x".repeat(13) }], [{ ...span, to: "" }],
  [{ ...span, chords: "x".repeat(401) }], [{ ...span, chords: " " }],
  [{ ...span, chords: "C\nG" }], [{ ...span, chords: "C\u007fG" }], [{ ...span, from: 1 }],
])("rejects malformed optional harmony metadata: %j", planHarmony => {
  expect(recordedDemoCatalog(catalog({ ...complete, planHarmony }), "local")).toBeNull();
});

it("never accepts plan metadata for an unavailable/unbound score", () => {
  for (const row of [{ ...complete, status: "unavailable" }, { ...complete, status: "preview" }, { ...complete, xmlSha256: undefined }]) {
    expect(recordedDemoCatalog(catalog({ ...row, planHarmony: [span] }), "local")).toBeNull();
  }
});

it("matches whole overlapping spans in original order without distributing free-text chords among bars", () => {
  const actual = score(["1", "2", "3"]), planned: DemoPlanHarmony[] = [span, { from: "2", to: "2", chords: "Dm9, or hold the preceding colour" }];
  const before = JSON.stringify(planned);
  const found = passagePlanHarmony(actual, { from: "2", to: "2" }, planned);
  expect(found).toEqual({ spans: planned, unaddressable: false });
  expect(found.spans[0]).toBe(span); expect(found.spans[0]!.chords).toBe(span.chords);
  expect(JSON.stringify(planned)).toBe(before);
  expect(passagePlanHarmony(actual, { from: "3", to: "3" }, [planned[1]!])).toEqual({ spans: [], unaddressable: false });
});

it.each([
  { labels: ["1", "1", "3"], passage: { from: "1", to: "3" }, planned: [span] },
  { labels: ["1", "2", "3"], passage: { from: "3", to: "1" }, planned: [span] },
  { labels: ["1", "2", "3"], passage: { from: "1", to: "3" }, planned: [{ ...span, from: "4" }] },
  { labels: ["1", "2", "3"], passage: { from: "1", to: "3" }, planned: [{ ...span, from: "3", to: "1" }] },
])("refuses missing/reversed/ambiguous printed-bar addressing: %j", ({ labels, passage, planned }) => {
  expect(passagePlanHarmony(score(labels), passage, planned)).toEqual({ spans: [], unaddressable: true });
});
