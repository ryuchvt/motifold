// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScore } from "../score";
import type { DistributeAnswer, FitAnswer, PieceReading, PlanAnswer, WriteAnswer } from "../server/shapes";
import { midiFile, pieceInput, ROLE_COLOURS } from "./arrange";
import { ArrangePanel, StretchHead } from "./ArrangePanel";
import { PieceView } from "./PieceView";
import { pieceData } from "./pieceData";
import { NEW_NOTES, useArrange, type Arranged } from "./useArrange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bar = (n: number, step: string, top = "") => `<measure number="${n}">${top}<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure>`;
const head = `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
const xmlText = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Inst 1</part-name></score-part><score-part id="P2"><part-name>Inst 2</part-name></score-part></part-list><part id="P1">${bar(1, "C", head)}${bar(2, "D")}</part><part id="P2">${bar(1, "E", head)}${bar(2, "F")}</part></score-partwise>`;
const score = parseScore(xmlText);
const loaded = { fileName: "sketch.xml", xmlText, score };
const part = score.parts[0]!;
const range = { from: 0, to: 1 };

const reading: PieceReading = {
  summary: "The tune is in Inst 1.",
  sections: [{ from: "1", to: "1", name: "Opening" }, { from: "2", to: "2", name: "Answer" }],
  tracks: [{ line: "Inst 1", instrument: "Violin", sure: true, why: "High single line" }, { line: "Inst 2", instrument: "Pad", sure: false, why: "Could be a pad" }],
  questions: [{ from: "1", to: "2", line: "Inst 2", ask: "Is Inst 2 a tune here?", choices: [{ label: "Yes, a countermelody", role: "countermelody" }, { label: "No, it only fills", role: "" }] }],
  roles: [{ from: "1", to: "2", line: "Inst 1", role: "melody", of: "", why: "It sings" }, { from: "1", to: "2", line: "Inst 2", role: "doubling", of: "Inst 1", why: "Same notes" }, { from: "1", to: "9", line: "Inst 2", role: "bass", of: "", why: "Not a bar" }],
  thin: [{ from: "1", to: "2", line: "Inst 2", why: "Same notes" }],
  missing: [{ from: "1", to: "2", what: "No ending", why: "It stops" }],
  structures: [{ name: "Backwards", why: "Try the end first", order: [{ from: "2", to: "2" }, { from: "1", to: "1" }] }],
};
const plans: PlanAnswer = {
  options: [
    { name: "Strings", idea: "Add a viola and a cello", why: [{ from: "1", to: "2", what: "Viola answers", principle: "Answer the tune" }] },
    { name: "Winds", idea: "Add a flute", why: [] },
  ],
};
const written: Record<string, WriteAnswer> = {
  Strings: { adds: [{ part: "Viola", bar: "1", events: "C4@0+4" }, { part: "Cello", bar: "2", events: "C3@0+4" }, { part: "Viola", bar: "3", events: "G4@0+4" }] },
  Winds: { adds: [{ part: "Flute", bar: "1", events: "G5@0+4" }] },
};
const plan: DistributeAnswer = {
  idea: "Violins sing and the cello holds",
  plan: [{ from: "1", to: "2", line: "Inst 1", voice: "all", part: "Violin I", octave: 1, why: "It sings" }, { from: "1", to: "2", line: "Inst 2", voice: "all", part: "Cello", octave: -1, why: "It holds" }],
};

const reply = (status: string, body: object = {}) => ({ ok: true, json: async () => ({ status, ...body }) }) as Response;
const fit: FitAnswer = { structures: [{ name: "Tune on time", why: "Lands it", order: [{ from: "2", to: "2" }] }] };
const answers: Record<string, object> = { read_piece: reading, distribute: plan, plan_options: plans, fit_form: fit };
/** Muse Spark's answer to each question, with the notes of whichever option was chosen. */
const spark = (url: string, init?: RequestInit) => {
  const shape = url.split("/").pop()!;
  return reply("ok", { answer: shape === "arrange" ? written[JSON.parse(init!.body as string).input.chosen.name] : answers[shape] });
};

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The screen as it is in the app, with its state to read. */
function setUp(file: string | null = null) {
  const now: { arranged: Arranged | null } = { arranged: null };
  function Host() {
    const arranged = useArrange(loaded, part, range, file);
    now.arranged = arranged;
    return (
      <>
        <StretchHead arranged={arranged} />
        <ArrangePanel arranged={arranged} busy={false} />
      </>
    );
  }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { get arranged() { return now.arranged!; }, host };
}

const press = (host: Element, name: string, last = false) => {
  const all = [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);
  const button = last ? all[all.length - 1] : all[0];
  if (!button) throw new Error(`No button called ${name}`);
  return act(async () => button.click());
};
const partNames = (s: { score: typeof score } | null) => s?.score.parts.map((p) => p.name);

describe("the arranger's two steps", () => {
  it("reads first and writes nothing until asked, then builds on that reading", async () => {
    const calls: { shape: string; input: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ shape: url.split("/").pop()!, input: JSON.parse(init.body as string).input });
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    expect(calls.map((c) => c.shape)).toEqual(["read_piece"]);
    expect(screen.arranged.piece.status).toBe("ready");
    await act(() => screen.arranged.askOptions("Keep it low", 4, "both"));
    expect(calls[1]!.shape).toBe("plan_options");
    expect(calls[1]!.input).toMatchObject({ moreBars: 4, ask: "Keep it low", reading: { roles: reading.roles, missing: reading.missing } });
    expect(screen.arranged.options.status).toBe("ready");
    // No notes are written until one way is chosen.
    expect(calls.map((c) => c.shape)).toEqual(["read_piece", "plan_options"]);
    await act(() => screen.arranged.askNotes(1));
    expect(calls[2]).toMatchObject({ shape: "arrange", input: { chosen: { name: "Winds" }, ask: "Keep it low" } });
  });

  it("shows what's being tried, takes a part off it, and puts the score back", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askOptions("", 4, "both"));
    expect(screen.arranged.shown).toBeNull();
    await act(() => screen.arranged.askNotes(0));
    expect(partNames(screen.arranged.shown)).toEqual(["Inst 1", "Inst 2", "Viola", "Cello"]);
    expect(screen.arranged.shown!.xmlText).toContain(`color="${NEW_NOTES}"`);
    act(() => screen.arranged.togglePart("Viola"));
    expect(partNames(screen.arranged.shown)).toEqual(["Inst 1", "Inst 2", "Cello"]);
    act(() => screen.arranged.setTrying(null));
    expect(screen.arranged.shown).toBeNull();
  });

  it("leaves out what's new in the bars on the page, in the file too, and puts it back", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askOptions("", 4, "both"));
    await act(() => screen.arranged.askNotes(0));
    act(() => screen.arranged.selectRange("1", "1"));
    expect(screen.host.textContent).toContain("Bars 1 to 1");
    await press(screen.host, "Direction");
    const violas = () => screen.arranged.shown!.score.parts.find((p) => p.name === "Viola")!.notes.filter((n) => !n.rest).length;
    expect(violas()).toBe(2);
    await press(screen.host, "Leave out what's new here");
    expect(violas()).toBe(1);
    expect(screen.arranged.offBars).toEqual(["1"]);
    expect(screen.host.textContent).toContain("Put back all 1 bar left out");
    expect(screen.host.textContent).toContain("2 new notes");
    await press(screen.host, "Put back what's new here");
    expect(violas()).toBe(2);
    expect(screen.arranged.offBars).toEqual([]);
    await press(screen.host, "Leave out what's new here");
    act(() => screen.arranged.setTrying(null));
    expect(screen.arranged.offBars).toEqual([]);
  });

  it("lands on what's left when the bars on the page have gone", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askOptions("", 4, "both"));
    await act(() => screen.arranged.askNotes(0));
    expect(screen.arranged.shown!.score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2", "3"]);
    act(() => screen.arranged.selectRange("3", "3"));
    await press(screen.host, "Direction");
    await press(screen.host, "Leave out what's new here");
    expect(screen.arranged.shown!.score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2"]);
    expect(screen.arranged.view).toEqual({ from: "1", to: "2" });
    await press(screen.host, "Put back all 1 bar left out");
    expect(screen.arranged.shown!.score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2", "3"]);
  });

  it("makes what's kept the composer's, in black, and goes back on request", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askOptions("", 4, "both"));
    await act(() => screen.arranged.askNotes(1));
    act(() => screen.arranged.keep());
    expect(screen.arranged.kept).toBe(true);
    expect(screen.arranged.options.status).toBe("none");
    expect(partNames(screen.arranged.shown)).toEqual(["Inst 1", "Inst 2", "Flute"]);
    expect(screen.arranged.shown!.xmlText).not.toContain("color=");
    act(() => screen.arranged.startAgain());
    expect(screen.arranged.shown).toBeNull();
    expect(screen.arranged.kept).toBe(false);
  });

  it("drops the reading when a new order is kept, because the bars have new numbers", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    act(() => screen.arranged.setTrying({ kind: "structure", index: 0 }));
    expect(screen.arranged.shown!.score.parts[0]!.notes.map((n) => n.pitch?.step)).toEqual(["D", "C"]);
    act(() => screen.arranged.keep());
    expect(screen.arranged.piece.status).toBe("none");
  });

  it("uses a saved answer only for the very notes it was made from", async () => {
    const notes = pieceInput(score, part, 0, 1).written;
    const saved = { read: { input: { written: notes }, answer: reading }, plan: { input: { written: notes, moreBars: 1 }, answer: plans }, notes: [written.Strings, written.Winds] };
    vi.stubGlobal("fetch", async (url: string) => (url === "/saved.json" ? reply("", saved) : reply("fallback", { reason: "no-key" })));
    const screen = setUp("/saved.json");
    await act(() => screen.arranged.askPiece());
    expect(screen.arranged.piece).toMatchObject({ status: "ready", saved: true });
    await act(() => screen.arranged.askOptions("", 9, "both"));
    expect(screen.arranged.options).toMatchObject({ status: "ready", saved: true });
    // Its bars count as asked when it was made, whatever the box says now.
    await act(() => screen.arranged.askNotes(0));
    const state = screen.arranged.options;
    expect(state.status === "ready" && state.input.moreBars).toBe(1);
    const shownNotes = state.status === "ready" ? state.notes[0] : null;
    expect(shownNotes?.status === "ready" && shownNotes.check.adds.map((a) => a.bar)).toEqual(["1", "2", "3"]);

    const other = { read: { input: { written: [] }, answer: reading } };
    vi.stubGlobal("fetch", async (url: string) => (url === "/saved.json" ? reply("", other) : reply("fallback", { reason: "no-key" })));
    const again = setUp("/saved.json");
    await act(() => again.arranged.askPiece());
    expect(again.arranged.piece.status).toBe("unavailable");
  });
});

describe("colours on the score", () => {
  it("colour the page once it's read, and never what's kept or downloaded", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    expect(screen.arranged.page!.xmlText).not.toContain("color=");
    await act(() => screen.arranged.askPiece());
    expect(screen.arranged.page!.xmlText).toContain(`color="${ROLE_COLOURS.melody}"`);
    expect(screen.arranged.shown).toBeNull();
    await act(() => screen.arranged.askOptions("", 4, "both"));
    await act(() => screen.arranged.askNotes(1));
    expect(screen.arranged.page!.xmlText).toContain(`color="${NEW_NOTES}"`);
    expect(screen.arranged.page!.xmlText).toContain(`color="${ROLE_COLOURS.melody}"`);
    expect(screen.arranged.shown!.xmlText).not.toContain(`color="${ROLE_COLOURS.melody}"`);
    act(() => screen.arranged.keep());
    expect(screen.arranged.shown!.xmlText).not.toContain("color=");
  });

  it("pick one role out and fade the rest, new notes included", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askOptions("", 4, "both"));
    await act(() => screen.arranged.askNotes(1));
    act(() => screen.arranged.setFocus("melody"));
    expect(screen.arranged.page!.xmlText).toContain(`color="${ROLE_COLOURS.melody}"`);
    expect(screen.arranged.page!.xmlText).not.toContain(`color="${NEW_NOTES}"`);
    act(() => screen.arranged.setFocus("new"));
    expect(screen.arranged.page!.xmlText).toContain(`color="${NEW_NOTES}"`);
    expect(screen.arranged.page!.xmlText).not.toContain(`color="${ROLE_COLOURS.melody}"`);
    act(() => screen.arranged.setFocus(null));
    expect(screen.arranged.page!.xmlText).toContain(`color="${ROLE_COLOURS.melody}"`);
  });

  it("survive a new order, because the colour was on the bar before it moved", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    act(() => screen.arranged.setTrying({ kind: "structure", index: 0 }));
    expect(screen.arranged.page!.xmlText).toContain(`color="${ROLE_COLOURS.melody}"`);
    expect(screen.arranged.page!.score.parts[0]!.measures.map((m) => m.number)).toEqual(["1", "2"]);
  });
});

describe("the whole piece", () => {
  const mount = (over: Partial<Parameters<typeof PieceView>[0]> = {}) => {
    const calls = { select: vi.fn(), range: vi.fn(), focus: vi.fn(), solo: vi.fn() };
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    unmount = () => root.unmount();
    const data = pieceData(score, reading.roles, ["1", "2"]);
    act(() => root.render(<PieceView data={data} sections={reading.sections} moments={[]} selected={{ from: "1", to: "1" }} focus={null} solo={[]} instrumentOf={() => ""} hasNew={false} onSelect={calls.select} onSelectRange={calls.range} onFocus={calls.focus} onSolo={calls.solo} {...over} />));
    return { host, ...calls };
  };
  const button = (host: Element, name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent!.trim() === name)!;

  it("shows every track, the sections and what the colours mean", () => {
    const { host } = mount();
    expect([...host.querySelectorAll(".stage-name")].map((b) => b.textContent)).toEqual(["Inst 1", "Inst 2"]);
    expect([...host.querySelectorAll(".stage-section")].map((b) => b.textContent)).toEqual(["Opening", "Answer"]);
    expect([...host.querySelectorAll(".stage-chip")].map((b) => b.textContent!.trim())).toEqual(["Melody", "Doubling"]);
    expect(host.querySelector(".note.kind-melody")).toBeTruthy();
  });

  it("is there before anything is read, in no colour", () => {
    const { host } = mount({ data: pieceData(score, [], []), sections: [] });
    expect(host.querySelectorAll(".stage-name")).toHaveLength(2);
    expect(host.querySelector(".note.kind-melody")).toBeNull();
    expect(host.querySelector(".note.kind-plain")).toBeTruthy();
    expect(host.querySelector(".stage-chip")).toBeNull();
  });

  it("picks a section for the notation, a role to follow, and a track on its own", () => {
    const { host, select, focus, solo } = mount();
    act(() => button(host, "Answer").click());
    expect(select).toHaveBeenCalledWith("2");
    act(() => button(host, "Melody").click());
    expect(focus).toHaveBeenCalledWith("melody");
    act(() => button(host, "Inst 2").click());
    expect(solo).toHaveBeenCalledWith("Inst 2");
  });

  it("makes a drag across bars the stretch on the page, and a press still picks the section", () => {
    const { host, select, range } = mount();
    const rows = host.querySelector(".stage-rows")!;
    rows.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) });
    const fire = (type: string, clientX: number) => act(() => void rows.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })));
    fire("pointerdown", 80);
    fire("pointermove", 10);
    fire("pointerup", 10);
    fire("click", 10);
    expect(range).toHaveBeenCalledWith("1", "2");
    expect(select).not.toHaveBeenCalled();
    fire("pointerdown", 80);
    fire("pointerup", 80);
    fire("click", 80);
    expect(select).toHaveBeenCalledWith("2");
    expect(range).toHaveBeenCalledTimes(1);
  });

  it("offers new notes in the key once they're on the score, and dims what isn't picked", () => {
    const { host } = mount({ hasNew: true, focus: "melody" });
    expect(button(host, "New")).toBeTruthy();
    expect(host.querySelector(".note.kind-doubling")!.getAttribute("class")).toContain("dim");
    expect(host.querySelector(".note.kind-melody")!.getAttribute("class")).not.toContain("dim");
  });

  it("marks the moments on the piece", () => {
    const { host } = mount({ moments: [{ what: "Door opens", beats: 2, bar: "1", beat: 2, seconds: 1, newBar: false, landing: null }] });
    expect(host.querySelector(".stage-moment")!.textContent).toBe("Door opens");
  });
});

describe("your notes on your instruments", () => {
  it("guesses what a track is from its name first, and starts from Muse Spark's guess otherwise", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    expect(screen.arranged.tracks).toEqual({ "Inst 1": "Violin", "Inst 2": "Pad" });
  });

  it("sends what the composer settled, moves the notes, and leaves them all there", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    act(() => screen.arranged.setTrack("Inst 2", "Strings"));
    act(() => screen.arranged.answer(0, "Yes, a countermelody"));
    await act(() => screen.arranged.askPlaced(["Cello", "Violin I"], "Keep it warm"));
    expect(calls.distribute).toMatchObject({ instruments: ["Violin I", "Cello"], ask: "Keep it warm", answers: [{ ask: "Is Inst 2 a tune here?", answer: "Yes, a countermelody" }] });
    expect(calls.distribute!.tracks).toContainEqual({ line: "Inst 2", instrument: "Strings" });
    expect(partNames(screen.arranged.shown)).toEqual(["Violin I", "Cello"]);
    const placed = screen.arranged.placed;
    expect(placed.status === "ready" && placed.check).toMatchObject({ notes: 4, placed: 4, moved: 4, notPlaced: [] });
    expect(screen.arranged.shown!.score.parts[0]!.notes.map((n) => `${n.pitch?.step}${n.pitch?.octave}`)).toEqual(["C5", "D5"]);
  });

  it("stops calling a section after an instrument that's gone, and keeps the rest of its names", async () => {
    const sections = [{ from: "1", to: "1", name: "Piano alone" }, { from: "2", to: "2", name: "Violin answers" }];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.endsWith("read_piece") ? reply("ok", { answer: { ...reading, sections } }) : spark(url, init)));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    expect(screen.arranged.sections.map((s) => s.name)).toEqual(["Piano alone", "Violin answers"]);
    await act(() => screen.arranged.askPlaced(["Cello", "Violin I"], ""));
    expect(screen.arranged.sections.map((s) => s.name)).toEqual(["", "Violin answers"]);
  });

  it("settles a role from an answer, and draws the roles on the new instruments", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    act(() => screen.arranged.answer(0, "Yes, a countermelody"));
    expect(screen.arranged.map!.roles.find((r) => r.line === "Inst 2")).toMatchObject({ role: "countermelody", why: "You said so" });
    await act(() => screen.arranged.askPlaced(["Violin I", "Cello"], ""));
    expect(screen.arranged.map!.lines).toEqual(["Violin I", "Cello"]);
    expect(screen.arranged.map!.roles.find((r) => r.line === "Cello")).toMatchObject({ role: "countermelody" });
  });

  it("splits a part that can't play chords, keeps the empty staves, and carries its role onto each line", async () => {
    const toFlute: DistributeAnswer = { idea: "x", plan: [{ from: "1", to: "2", line: "Inst 1", voice: "all", part: "Flute", octave: 1, why: "x" }, { from: "1", to: "2", line: "Inst 2", voice: "all", part: "Flute", octave: 1, why: "x" }] };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.endsWith("distribute") ? reply("ok", { answer: toFlute }) : spark(url, init)));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askPlaced(["Flute", "Viola"], ""));
    const before = screen.arranged.placed;
    expect(before.status === "ready" && before.check.together.length).toBe(2);
    act(() => screen.arranged.splitPlaced());
    expect(partNames(screen.arranged.shown)).toEqual(["Flute 1", "Flute 2", "Viola"]);
    expect(screen.arranged.map!.lines).toEqual(["Flute 1", "Flute 2", "Viola"]);
    expect(screen.arranged.map!.roles.filter((r) => r.line.startsWith("Flute")).length).toBeGreaterThan(1);
    const after = screen.arranged.placed;
    expect(after.status === "ready" && after.check.together).toEqual([]);
  });

  it("deletes a part and can bring it back", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askPlaced(["Violin I", "Viola", "Cello"], ""));
    expect(partNames(screen.arranged.shown)).toEqual(["Violin I", "Viola", "Cello"]);
    act(() => screen.arranged.toggleGone("T2"));
    expect(partNames(screen.arranged.shown)).toEqual(["Violin I", "Cello"]);
    act(() => screen.arranged.toggleGone("T2"));
    expect(partNames(screen.arranged.shown)).toEqual(["Violin I", "Viola", "Cello"]);
  });

  it("writes new notes onto the chosen staves, in place, and only names those", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    await act(() => screen.arranged.askPlaced(["Violin I", "Viola", "Cello"], ""));
    await act(() => screen.arranged.askOptions("", 4, "both"));
    expect(calls.plan_options!.instruments).toEqual(["Violin I", "Viola", "Cello"]);
    await act(() => screen.arranged.askNotes(0));
    expect(calls.arrange!.instruments).toEqual(["Violin I", "Viola", "Cello"]);
    expect(partNames(screen.arranged.shown)).toEqual(["Violin I", "Viola", "Cello"]);
    const viola = screen.arranged.shown!.score.parts[1]!;
    expect(viola.measures[0]!.noteIndexes.map((i) => viola.notes[i]!.pitch?.step)).toEqual(["C"]);
    expect(viola.measures[2]!.noteIndexes.map((i) => viola.notes[i]!.pitch?.step)).toEqual(["G"]);
  });
});

describe("splitting chords first", () => {
  const chordal = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Kontakt</part-name></score-part></part-list><part id="P1"><measure number="1">${head}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>`;
  const page = { fileName: "chords.xml", xmlText: chordal, score: parseScore(chordal) };
  const setUpChords = () => {
    const now: { arranged: Arranged | null } = { arranged: null };
    function Host() {
      const arranged = useArrange(page, page.score.parts[0]!, range, null);
      now.arranged = arranged;
      return <ArrangePanel arranged={arranged} busy={false} />;
    }
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(<Host />));
    unmount = () => root.unmount();
    return { get arranged() { return now.arranged!; }, host };
  };

  it("offers it before anything is read, shows it at once, and reads each line on its own", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return reply("fallback", { reason: "disabled" });
    });
    const screen = setUpChords();
    expect(screen.host.textContent).toContain("Kontakt, 2 lines");
    expect(screen.arranged.shown).toBeNull();
    await press(screen.host, "Kontakt, 2 lines");
    expect(partNames(screen.arranged.shown)).toEqual(["Kontakt 1", "Kontakt 2"]);
    await press(screen.host, "Read my score");
    expect(calls.read_piece!.lines).toEqual(["Kontakt 1", "Kontakt 2"]);
  });

  it("can be undone", async () => {
    const screen = setUpChords();
    await press(screen.host, "Kontakt, 2 lines");
    await press(screen.host, "Kontakt, 2 lines");
    expect(screen.arranged.shown).toBeNull();
  });
});

describe("writing to picture", () => {
  it("adds the bars it takes to reach a moment, and sends it as a bar and a beat", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    // 120 a minute with no tempo marked, so a 4/4 bar is 2 seconds, and 6.5 seconds is bar 4, the second half of beat 2.
    act(() => screen.arranged.setCues([{ time: "6.5", what: "The door opens" }]));
    await act(() => screen.arranged.askOptions("", 1, "inside"));
    expect(calls.plan_options).toMatchObject({ where: "both", moreBars: 2, cues: [{ bar: "4", beat: 1, time: "0:06.5", what: "The door opens" }] });
    await act(() => screen.arranged.askNotes(0));
    expect(calls.arrange).toMatchObject({ cues: [{ bar: "4", beat: 1 }] });
  });

  it("fits the composer's bars to the moments, and says what lands on each", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    act(() => screen.arranged.setCues([{ time: "1", what: "Tune" }]));
    await act(() => screen.arranged.askFit(""));
    expect(calls.fit_form).toMatchObject({ moments: [{ beats: 2, what: "Tune" }] });
    expect(screen.arranged.structures.map((s) => s.name)).toEqual(["Backwards", "Tune on time"]);
  });

  it("reads a DAW's markers as moments", async () => {
    const screen = setUp();
    const bytes = midiFile([{ name: "Strings", program: 48, notes: [{ start: 0, length: 4, height: 60 }] }], 120, { beats: 4, beatType: 4 }, [{ beat: 8, text: "Door opens" }]);
    await act(() => screen.arranged.importMarkers(new File([bytes as BlobPart], "markers.mid")));
    expect(screen.arranged.cues).toEqual([{ time: "", what: "Door opens", beats: 8 }]);
  });

  it("says so when a file has no markers", async () => {
    const screen = setUp();
    const bytes = midiFile([{ name: "Strings", program: 48, notes: [{ start: 0, length: 4, height: 60 }] }], 120, { beats: 4, beatType: 4 });
    await act(() => screen.arranged.importMarkers(new File([bytes as BlobPart], "markers.mid")));
    expect(screen.arranged.cues).toEqual([]);
    expect(screen.arranged.markerNote).toBe("That file has no markers in it.");
  });
});

describe("the panel", () => {
  it("asks one thing at a time, in order, before it writes", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const { host } = setUp();
    await press(host, "Read my score");
    expect(host.textContent).toContain("What is each track?");
    expect((host.querySelector(".arrange-tracks select") as unknown as HTMLSelectElement).value).toBe("Violin");
    expect(host.querySelector(".unsure")).toBeTruthy();
    await press(host, "Looks right");
    expect(host.textContent).toContain("Is Inst 2 a tune here?");
    expect(host.textContent).toContain("question 1 of 1");
    expect(host.textContent).not.toContain("No ending");
    await press(host, "Other");
    expect(host.querySelector('input[aria-label="Your own answer"]')).toBeTruthy();
    await press(host, "Yes, a countermelody");
    expect(host.textContent).toContain("The tune is in Inst 1.");
    expect(host.textContent).toContain("No ending.");
    await press(host, "Who plays it?");
    await press(host, "String quartet");
    await press(host, "Put my notes on these");
    expect(host.textContent).toContain("Violins sing and the cello holds.");
    expect(host.textContent).toContain("All 4 of your notes are on the instruments you chose");
    await press(host, "Next");
    expect(host.textContent).toContain("Where should it go?");
    await press(host, "Generate");
    expect(host.textContent).toContain("Add a viola and a cello.");
    expect(host.textContent).toContain("The code checked each one");
    await press(host, "Take it off");
    await press(host, "Put it on the score");
    await press(host, "Take it off");
    await press(host, "Skip to the form");
    expect(host.textContent).toContain("Change the order?");
    expect(host.textContent).toContain("Bar 2, then bar 1.");
    await press(host, "Add a stretch");
    expect(host.querySelector('input[aria-label="Stretch 1 from bar"]')).toBeTruthy();
  });

  it("offers the usual instruments for a track, matches a guess however it's written, and takes anything else as Other", async () => {
    const guesses = { ...reading, tracks: [{ line: "Inst 1", instrument: "double bass", sure: true, why: "Low" }, { line: "Inst 2", instrument: "Theremin", sure: false, why: "Odd" }] };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.endsWith("read_piece") ? reply("ok", { answer: guesses }) : spark(url, init)));
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    const selects = () => [...screen.host.querySelectorAll(".arrange-tracks select")] as unknown as HTMLSelectElement[];
    const own = () => screen.host.querySelector(".arrange-track-own") as HTMLInputElement | null;
    expect(selects().map((s) => s.value)).toEqual(["Double Bass", "other"]);
    expect(own()!.value).toBe("Theremin");
    expect([...selects()[0]!.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Strings", "Woodwinds", "Brass", "Percussion", "Keyboard and harp", "Voices"]);
    const choose = (select: HTMLSelectElement, value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    choose(selects()[1]!, "Drums");
    expect(screen.arranged.tracks["Inst 2"]).toBe("Drums");
    expect(own()).toBeNull();
    choose(selects()[0]!, "other");
    expect(screen.arranged.tracks["Inst 1"]).toBe("");
    expect(own()).not.toBeNull();
    expect(selects()[0]!.value).toBe("other");
  });

  it("says nothing about a track the composer isn't sure of, so Muse Spark goes by its notes", async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls[url.split("/").pop()!] = JSON.parse(init.body as string).input;
      return spark(url, init);
    });
    const screen = setUp();
    await act(() => screen.arranged.askPiece());
    const select = screen.host.querySelector(".arrange-tracks select") as unknown as HTMLSelectElement;
    expect(select.options[0]!.textContent).toBe("Not sure");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(screen.arranged.tracks["Inst 1"]).toBe("");
    expect(screen.host.querySelector(".arrange-tracks li")!.querySelector("input")).toBeNull();
    await act(() => screen.arranged.askPlaced(["Cello", "Violin I"], ""));
    expect(calls.distribute!.tracks).toEqual([{ line: "Inst 2", instrument: "Pad" }]);
  });

  it("lets a question be skipped", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const screen = setUp();
    await press(screen.host, "Read my score");
    await press(screen.host, "Looks right");
    await press(screen.host, "Skip this");
    expect(screen.host.textContent).toContain("What's missing");
    expect(screen.arranged.answered).toEqual({});
  });

  it("lets a composer keep their own tracks and go straight on", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const { host } = setUp();
    await press(host, "Read my score");
    await press(host, "Looks right");
    await press(host, "Skip this");
    await press(host, "Who plays it?");
    await press(host, "Keep my tracks as they are");
    expect(host.textContent).toContain("Where should it go?");
    expect(host.textContent).toContain("Timing, for picture");
  });

  it("shows where a moment falls and what tempo would put it on the bar", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => spark(url, init));
    const { host } = setUp();
    await press(host, "Read my score");
    await press(host, "Looks right");
    await press(host, "Skip this");
    await press(host, "Who plays it?");
    await press(host, "Keep my tracks as they are");
    await press(host, "Add a moment");
    const time = host.querySelector<HTMLInputElement>('input[aria-label="Moment 1, time"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(time, "2.1");
      time.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("0:02.1 is bar 2, beat 1.2.");
    expect(host.textContent).toContain("At 114.3 and not 120, it would fall on the first beat of bar 2.");
  });

  it("says when it ran out of room, which isn't the same as having no way to ask, and offers again", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.endsWith("arrange") ? reply("fallback", { reason: "failed" }) : spark(url, init)));
    const { host } = setUp();
    await press(host, "Read my score");
    await press(host, "Looks right");
    await press(host, "Skip this");
    await press(host, "Who plays it?");
    await press(host, "Keep my tracks as they are");
    await press(host, "Generate");
    expect(host.textContent).toContain("It didn't finish this one.");
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "Write this one")).toHaveLength(2);
  });

  it("says plainly when it can't answer", async () => {
    vi.stubGlobal("fetch", async () => reply("fallback", { reason: "no-key" }));
    const { host } = setUp();
    await press(host, "Read my score");
    expect(host.textContent).toContain("can't answer here");
  });
});
