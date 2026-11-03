import { useEffect, useMemo, useRef, useState } from "react";
import { parseScore, type Part, type Score } from "../score";
import { newBarNumbers, type ArrangeInput, type DistributeAnswer, type DistributeInput, type FitAnswer, type FitInput, type OptionPlan, placedNotes, type PieceReading, type RecomposePlan, type ThemeAnswer, type ThemeInput, type PlanAnswer, type Settled, type StudyScoreAnswer, type StudyScoreInput, type WriteAnswer, type WriteInput } from "../server/shapes";
import { arrangeInput, checkOption, emptyScore, motifSightings, withDoubles, writingWindows, chordTracks, dropParts, FADED, packageFiles, pieceInput, placeNotes, rolesAfter, scoreOfParts, scoreWithSplits, snap, onlyBars, whyText, withOption, withoutParts, withRoleColours, withStructure, type OptionCheck, type PlacedCheck, type RoleFocus } from "./arrange";
import { barsToReach, placeCues, timeWords, type Cue } from "./cues";
import { markersOf } from "./midi";
import { instrumentFromName, inScoreOrder, ONE_NOTE_AT_A_TIME } from "./orchestra";
import { pieceData } from "./pieceData";
import { askSpark } from "./spark";
import { noteHeight } from "./notes";
import { scoreLines, soundsAtAll, wholeScoreInput, wholeScoreParts } from "./scoreInput";
import { marksOnPage, studyMarksOf } from "./ScoreStudy";

/** What's new on the page: blue, the one colour besides the melody's orange, and the pair colour-blind readers tell apart best. */
export const NEW_NOTES = "#2f6fd6";

/** The study of the sketch: its form and harmony, asked with the reading and drawn on the score. `parts` are the ones its note numbers count through. */
export type StudyState =
  | { status: "none" }
  | { status: "asking" }
  | { status: "unavailable" }
  | { status: "ready"; answer: StudyScoreAnswer; written: StudyScoreInput["written"]; parts: Part[] };

export type PieceState =
  | { status: "none" }
  | { status: "asking" }
  | { status: "unavailable" }
  | { status: "ready"; answer: PieceReading; written: StudyScoreInput["written"]; lines: string[]; saved: boolean };

export type PlacedState =
  | { status: "none" }
  | { status: "asking" }
  | { status: "unavailable" }
  /** `chosen`: what the composer asked for, which a saved answer wasn't made for unless it matches `instruments`. */
  | { status: "ready"; answer: DistributeAnswer; check: PlacedCheck; instruments: string[]; chosen: string[]; saved: boolean };

/** The notes of one option, written only once the composer has chosen it. */
export type OptionNotes = { status: "asking" } | { status: "unfinished" } | { status: "unavailable" } | { status: "ready"; writing?: { from: string; to: string; done: number; of: number }; missing?: { from: string; to: string }[]; again?: { seed: WriteInput["seed"] | null; theme: ThemeAnswer["lines"] }; adds: WriteAnswer["adds"]; check: OptionCheck; changed?: boolean };

export type OptionsState =
  | { status: "none" }
  | { status: "asking" }
  | { status: "unavailable" }
  | { status: "ready"; plans: OptionPlan[]; input: ArrangeInput; notes: Record<number, OptionNotes>; saved: boolean };

/** Index -1 is the order the composer put together by hand. */
export type Trying = { kind: "option" | "structure"; index: number } | null;

export type Stretch = { from: string; to: string };

interface Page {
  xmlText: string;
  score: Score;
}

interface Saved {
  read?: { input?: Pick<StudyScoreInput, "written">; answer?: PieceReading };
  distribute?: { input?: Pick<DistributeInput, "written" | "instruments">; answer?: DistributeAnswer };
  plan?: { input?: Pick<ArrangeInput, "written" | "moreBars">; answer?: PlanAnswer };
  /** The notes of each option, in order. */
  notes?: (WriteAnswer | null)[];
}

export type RecomposeState = { status: "none" } | { status: "asking" } | { status: "unavailable" } | { status: "ready"; plans: RecomposePlan[]; input: ArrangeInput };

/** The composer's sketch as text, for a call that writes from it but doesn't have it on the score. */
export function sourceText(input: Pick<ArrangeInput, "written" | "lines">): string {
  return input.written.map((w) => `Bar ${w.bar}: ${w.at ? placedNotes(w, input.lines) : w.notes}`).join(" / ").replace(/[\u0000-\u001f]/g, " ").slice(0, 16000);
}

/** The bars a motif comes from, as a line: the top note of each moment on the upper staff, because a piano's lower hand isn't the tune. */
export function motifHeights(input: ArrangeInput, from: string, to: string): number[] {
  const bars = input.written.map((w) => w.bar);
  return input.written.slice(bars.indexOf(from), bars.indexOf(to) + 1).flatMap((w) => {
    const names = w.notes.split(" ").filter(Boolean);
    const at = (w.at ?? "").split(" ");
    const staves = (w.staves ?? "").split(" ");
    const top = new Map<string, number>();
    names.forEach((name, k) => {
      if (staves[k] && staves[k] !== "1") return;
      const height = noteHeight(name);
      if (height === null) return;
      const when = at[k] ?? String(k);
      top.set(when, Math.max(top.get(when) ?? 0, height));
    });
    return [...top.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, height]) => height);
  }).slice(0, 8);
}

export function useArrange(loaded: (Page & { fileName: string }) | null, part: Part | null, range: { from: number; to: number }, savedFile: string | null) {
  /** The score as it stands now: the composer's, once its notes are placed or something has been kept. */
  const [kept, setKept] = useState<Page | null>(null);
  /** Tracks of chords the composer wants as single lines, before anything is read. */
  const [splitting, setSplitting] = useState<string[]>([]);
  /** Parts the composer has deleted. They can come back until the next step. */
  const [gone, setGone] = useState<string[]>([]);
  const [piece, setPiece] = useState<PieceState>({ status: "none" });
  const [study, setStudy] = useState<StudyState>({ status: "none" });
  const studyTurn = useRef(0);
  /** What the composer says each track is, by the name Muse Spark knows it by. */
  const [tracks, setTracks] = useState<Record<string, string>>({});
  /** What they answered, by question. */
  const [answered, setAnswered] = useState<Record<number, string>>({});
  const [placed, setPlaced] = useState<PlacedState>({ status: "none" });
  const [options, setOptions] = useState<OptionsState>({ status: "none" });
  const [trying, setTryingNow] = useState<Trying>(null);
  /** New parts the composer has taken off what's being tried. */
  const [off, setOff] = useState<string[]>([]);
  /** Bars where the composer has left out what's new. */
  const [offBars, setOffBars] = useState<string[]>([]);
  const [handOrder, setHandOrder] = useState<Stretch[]>([]);
  /** One role picked out on the score, with everything else faded. */
  const [focus, setFocus] = useState<RoleFocus>(null);
  /** Tracks to see and hear on their own. */
  const [solo, setSolo] = useState<string[]>([]);
  /** The bars shown as notation. */
  const [selected, setSelected] = useState<Stretch | null>(null);
  /** Moments the music has to hit, typed or read from a DAW's markers. */
  const [cues, setCues] = useState<Cue[]>([]);
  const [markerNote, setMarkerNote] = useState<string | null>(null);
  /** Orders Muse Spark found for those moments. */
  const [fitted, setFitted] = useState<PieceReading["structures"]>([]);
  const [fitting, setFitting] = useState<"none" | "asking" | "unavailable">("none");
  const [recompose, setRecompose] = useState<RecomposeState>({ status: "none" });
  /** The new piece being written, once one is chosen. */
  const [recomposed, setRecomposed] = useState<{ plan: RecomposePlan; heights: number[]; opening: number[]; tuneBars: number; bars: number } | null>(null);
  const [fixing, setFixing] = useState<"none" | "asking" | "unavailable">("none");
  const turn = useRef(0);

  const clear = () => {
    setRecompose({ status: "none" });
    setRecomposed(null);
    setFixing("none");
    turn.current++;
    setKept(null);
    setSplitting([]);
    setGone([]);
    setPiece({ status: "none" });
    studyTurn.current++;
    setStudy({ status: "none" });
    setTracks({});
    setAnswered({});
    setPlaced({ status: "none" });
    setOptions({ status: "none" });
    setTryingNow(null);
    setOff([]);
    setOffBars([]);
    setHandOrder([]);
    setFocus(null);
    setSolo([]);
    setSelected(null);
    setCues([]);
    setMarkerNote(null);
    setFitted([]);
    setFitting("none");
  };
  useEffect(clear, [loaded?.score, part?.id, range.from, range.to]);

  /** The composer's sketch, as the code measures it, with any chords they've split. */
  const sketch = useMemo(() => {
    if (!loaded || !part) return null;
    const input = pieceInput(loaded.score, part, range.from, range.to);
    return { input, chords: chordTracks(loaded.score, input) };
  }, [loaded, part?.id, range.from, range.to]);
  const source: Page | null = useMemo(() => {
    if (!loaded || !sketch || splitting.length === 0) return loaded;
    const xmlText = scoreWithSplits(loaded.score, sketch.input, splitting);
    return { xmlText, score: parseScore(xmlText) };
  }, [loaded, sketch, splitting]);
  const split = !!source && source !== loaded;

  const base: Page | null = useMemo(() => {
    const page = kept ?? source;
    if (!page || gone.length === 0) return page;
    const xmlText = dropParts(page.xmlText, gone);
    return { xmlText, score: parseScore(xmlText) };
  }, [kept, source, gone]);

  const mine = base?.score.parts.find((p) => p.id === part?.id) ?? (base ? (wholeScoreParts(base.score)?.[0] ?? base.score.parts[0] ?? null) : null);
  // A placed score holds only these bars, and what's kept can run past where the score used to end.
  const reachedEnd = !!part && range.to >= part.measures.length - 1;
  const span = { from: kept || split ? 0 : range.from, to: mine && (kept || split || reachedEnd) ? mine.measures.length - 1 : range.to };

  const savedOf = async (): Promise<Saved | null> => {
    if (!savedFile) return null;
    try {
      const res = await fetch(savedFile);
      return res.ok ? ((await res.json()) as Saved) : null;
    } catch {
      return null;
    }
  };

  const setTrying = (next: Trying) => {
    setOff([]);
    setOffBars([]);
    setTryingNow(next);
  };
  const togglePart = (name: string) => setOff((now) => (now.includes(name) ? now.filter((p) => p !== name) : [...now, name]));
  /** The score under them has changed, so nothing still on its way may land on it. */
  const dropAsked = () => {
    turn.current++;
    setPiece((now) => (now.status === "asking" ? { status: "none" } : now));
    setPlaced((now) => (now.status === "asking" ? { status: "none" } : now));
    setFitting("none");
    setTrying(null);
    setOptions({ status: "none" });
  };
  const toggleGone = (id: string) => {
    dropAsked();
    setGone((now) => (now.includes(id) ? now.filter((p) => p !== id) : [...now, id]));
  };

  const askPiece = async () => {
    if (!base || !mine) return;
    const now = ++turn.current;
    setPiece({ status: "asking" });
    const input = pieceInput(base.score, mine, span.from, span.to);
    const studied = ++studyTurn.current;
    // The parts its note numbers count through: every part only when that's what was sent, because a big score falls back to one line (review F4).
    const line = soundsAtAll(mine) ? mine : (base.score.parts.find(soundsAtAll) ?? mine);
    const parts = wholeScoreInput(base.score, span.from, span.to) ? wholeScoreParts(base.score)! : [line];
    setStudy({ status: "asking" });
    const reply = await askSpark("read_piece", input);
    if (turn.current !== now) return;
    // The study comes after the reading, which every later step needs, so it can never take the credit the reading would have had (review F3),
    // and only once there's a reading to show it beside.
    const study = async () => {
      const r = await askSpark("study_score", input);
      if (studyTurn.current !== studied) return;
      const answer = r.status === "ok" ? (r.answer as StudyScoreAnswer | undefined) : undefined;
      setStudy(answer && [answer.sections, answer.harmony, answer.moments].every(Array.isArray) ? { status: "ready", answer, written: input.written, parts } : { status: "unavailable" });
    };
    const ready = (answer: PieceReading, saved: boolean) => {
      const lines = input.lines ?? [];
      // A name that says what it is needs no judgement, and anything else starts as Muse Spark's guess.
      setTracks(Object.fromEntries(lines.map((line) => [line, instrumentFromName(line) ?? answer.tracks?.find((t) => t.line === line)?.instrument ?? ""])));
      setAnswered({});
      setPiece({ status: "ready", answer, written: input.written, lines, saved });
    };
    if (reply.status === "ok") {
      ready(reply.answer as PieceReading, false);
      void study();
      return;
    }
    const saved = await savedOf();
    if (turn.current !== now) return;
    // Only for the very notes it was made from.
    if (saved?.read?.answer && JSON.stringify(saved.read.input?.written) === JSON.stringify(input.written)) {
      ready(saved.read.answer, true);
      void study();
      return;
    }
    setPiece({ status: "unavailable" });
    setStudy({ status: "none" });
  };

  /** Their answers, as what goes to Muse Spark next. */
  const answers: Settled["answers"] = piece.status === "ready" ? (piece.answer.questions ?? []).flatMap((q, k) => (answered[k]?.trim() ? [{ ask: q.ask, answer: answered[k]!.trim() }] : [])) : [];

  /** The roles as Muse Spark read them, with the composer's answers over them. */
  const roles = useMemo(() => {
    if (piece.status !== "ready") return [];
    const bars = piece.written.map((w) => w.bar);
    let now = piece.answer.roles;
    (piece.answer.questions ?? []).forEach((q, k) => {
      const role = q.choices.find((c) => c.label === answered[k])?.role;
      if (!role) return;
      const [from, to] = [bars.indexOf(q.from), bars.indexOf(q.to)];
      const inside = (r: PieceReading["roles"][number]) => r.line === q.line && bars.indexOf(r.from) >= from && bars.indexOf(r.to) <= to;
      now = [...now.filter((r) => !inside(r)), { from: q.from, to: q.to, line: q.line, role, of: "", why: "You said so" }];
    });
    return now;
  }, [piece, answered]);

  /** Who's doing what on the score as it stands. */
  const map = useMemo(() => {
    if (piece.status !== "ready" || !base) return null;
    const bars = piece.written.map((w) => w.bar);
    if (placed.status !== "ready") return { roles, written: piece.written, lines: piece.lines };
    const lines = scoreLines(base.score.parts).map((l) => l.label);
    // A part split into single lines has the role it had on each of them.
    const moved = rolesAfter(placed.answer.plan, roles, bars).flatMap((r) => (lines.includes(r.line) ? [r] : lines.filter((l) => l.startsWith(`${r.line} `)).map((line) => ({ ...r, line }))));
    return { roles: moved, written: piece.written, lines };
  }, [piece, roles, placed, base]);

  /** Their notes on the instruments they chose. Always from what they wrote, so it can be asked again. */
  const askPlaced = async (chosen: string[], words: string, tuneOnly = false) => {
    if (!source || !part || piece.status !== "ready") return;
    const now = ++turn.current;
    setTrying(null);
    setOptions({ status: "none" });
    setPlaced({ status: "asking" });
    const instruments = inScoreOrder(chosen);
    const from = split ? (wholeScoreParts(source.score)?.[0] ?? source.score.parts[0]!) : part;
    const written = split ? pieceInput(source.score, from, 0, from.measures.length - 1) : pieceInput(source.score, part, range.from, range.to);
    const input: DistributeInput = { ...written, instruments, roles, answers, ...(tuneOnly ? { tuneOnly: true } : {}), ask: words.trim() || null, tracks: (written.lines ?? []).flatMap((line) => (tracks[line]?.trim() ? [{ line, instrument: tracks[line]!.trim() }] : [])) };
    const reply = await askSpark("distribute", input);
    if (turn.current !== now) return;
    const ready = (answer: DistributeAnswer, onto: string[], saved: boolean) => {
      const { parts, check } = placeNotes(source.score, input, answer, onto, tuneOnly);
      const xmlText = scoreOfParts(source.score, input, parts);
      setKept({ xmlText, score: parseScore(xmlText) });
      setGone([]);
      setPlaced({ status: "ready", answer, check, instruments: onto, chosen: instruments, saved });
    };
    if (reply.status === "ok") return ready(reply.answer as DistributeAnswer, instruments, false);
    const saved = await savedOf();
    if (turn.current !== now) return;
    // A saved answer was made for its own instruments, whatever's ticked now.
    if (saved?.distribute?.answer && saved.distribute.input?.instruments && JSON.stringify(saved.distribute.input.written) === JSON.stringify(input.written)) ready(saved.distribute.answer, saved.distribute.input.instruments, true);
    else setPlaced({ status: "unavailable" });
  };

  /** An instrument that plays one note at a time, given chords, as single lines. No note changes. */
  const splitPlaced = () => {
    if (!base || !mine || placed.status !== "ready") return;
    const input = pieceInput(base.score, mine, 0, mine.measures.length - 1);
    const those = chordTracks(base.score, input).filter((c) => ONE_NOTE_AT_A_TIME.test(c.line)).map((c) => c.line);
    const xmlText = scoreWithSplits(base.score, input, those);
    dropAsked();
    setKept({ xmlText, score: parseScore(xmlText) });
    setGone([]);
    setPlaced({ ...placed, check: { ...placed.check, together: [] } });
  };

  const askOptions = async (words: string, moreBars: number, where: ArrangeInput["where"]) => {
    if (!base || !mine) return;
    const now = ++turn.current;
    setTrying(null);
    setOptions({ status: "asking" });
    const lines = pieceInput(base.score, mine, span.from, span.to).lines ?? [];
    const reading = piece.status === "ready" && map ? { roles: map.roles.filter((r) => lines.includes(r.line)).slice(0, 200), missing: piece.answer.missing } : null;
    const instruments = placed.status === "ready" ? base.score.parts.map((p) => p.name).filter((name) => !name.endsWith("(not placed)")) : null;
    // A moment past the last bar needs the bars to get there.
    const moments = placeCues(cues, base.score);
    const needed = Math.min(32, barsToReach(moments, base.score));
    const going = where === "inside" && needed ? "both" : where;
    const input = arrangeInput(base.score, mine, span.from, span.to, words, going === "inside" ? 0 : Math.max(moreBars, needed), reading, {
      instruments: instruments?.length ? instruments : null,
      where: going,
      answers,
      tracks: lines.flatMap((line) => (tracks[line]?.trim() ? [{ line, instrument: tracks[line]!.trim() }] : [])),
      ...(placed.status === "ready" && placed.check.material && sketch ? { source: sourceText(sketch.input) } : {}),
    });
    const reachable = new Set([...input.written.map((w) => w.bar), ...newBarNumbers(input)]);
    // On the grid the notes will be written on, or it asks for a moment nobody can write down.
    input.cues = moments.filter((m) => reachable.has(m.bar)).slice(0, 40).map((m) => ({ bar: m.bar, beat: snap(m.beat), time: timeWords(m.seconds), what: m.what }));
    const reply = await askSpark("plan_options", input);
    if (turn.current !== now) return;
    const ready = (answer: PlanAnswer, asked: ArrangeInput, saved: boolean): OptionsState => ({ status: "ready", plans: answer.options, input: asked, notes: {}, saved });
    if (reply.status === "ok") return setOptions(ready(reply.answer as PlanAnswer, input, false));
    const saved = await savedOf();
    if (turn.current !== now) return;
    // A saved answer was asked for its own number of new bars, whatever the box says now.
    if (saved?.plan?.answer && JSON.stringify(saved.plan.input?.written) === JSON.stringify(input.written)) setOptions(ready(saved.plan.answer, { ...input, moreBars: saved.plan.input?.moreBars ?? input.moreBars }, true));
    else setOptions({ status: "unavailable" });
  };

  const askedOf = recomposed ? "recompose" : "arrange";
  const moodWord = options.status === "ready" ? /The mood I want: (\w+)/.exec(options.input.ask ?? "")?.[1]?.toLowerCase() : null;
  /** Which prepared run this is, if any, like arrange-hopeful. */
  const moodKey = moodWord ? (recomposed ? `recompose-${options.status === "ready" ? (options.input.freedom ?? 3) : 3}-${moodWord}` : `${askedOf}-${moodWord}`) : null;

  /** The composer's own chords for one stretch of a plan, which the notes are then written from. Notes already written stay until they ask again. */
  const setChords = (index: number, stretch: number, chords: string) =>
    setOptions((state) => {
      if (state.status !== "ready") return state;
      const plans = state.plans.map((plan, k) => (k === index ? { ...plan, why: plan.why.map((w, j) => (j === stretch ? { ...w, chords, yours: true } : w)) } : plan));
      const notes = state.notes[index];
      return { ...state, plans, notes: notes?.status === "ready" ? { ...state.notes, [index]: { ...notes, changed: true } } : state.notes };
    });

  /** The notes of the option the composer chose, which go straight on the score. */
  const askNotes = async (index: number) => {
    if (!base || options.status !== "ready") return;
    const held = options.notes[index];
    // Changed chords are written again everywhere, finished sections too, or bars written from the old chords would stay under the new ones (review M4).
    const unfinished = held?.status === "ready" && held.missing?.length && !held.changed ? { adds: held.adds, missing: held.missing } : null;
    const again = held?.status === "ready" ? held.again : undefined;
    await writeNotes(base, options.input, options.plans[index]!, index, options.saved, again?.seed ?? null, again?.theme ?? [], unfinished);
  };

  /** Writes a plan a section at a time, so a failure loses only that section, and what's written shows up as it's written. Coming back for what's unfinished asks only for those sections, and whatever is on the score stays. */
  const writeNotes = async (page: Page, input: ArrangeInput, plan: OptionPlan, index: number, isSaved: boolean, seed: WriteInput["seed"] | null, theme: ThemeAnswer["lines"] = [], unfinished: { adds: WriteAnswer["adds"]; missing: { from: string; to: string }[] } | null = null) => {
    const now = turn.current;
    const setNotes = (notes: OptionNotes) => setOptions((state) => (state.status === "ready" && state.input === input ? { ...state, notes: { ...state.notes, [index]: notes } } : state));
    const written = (adds: WriteAnswer["adds"], progress: Pick<Extract<OptionNotes, { status: "ready" }>, "writing" | "missing" | "again"> = {}) => {
      setNotes({ status: "ready", adds, check: checkOption({ ...plan, adds }, page.score, input), ...progress });
      setTrying({ kind: "option", index });
    };
    if (!unfinished) setNotes({ status: "asking" });
    const bars = [...input.written.map((w) => w.bar), ...newBarNumbers(input)];
    // A plan that names no bars still gets written, in one go.
    const sections = writingWindows(plan.why, bars);
    const windows: ({ from: string; to: string } | null)[] = unfinished ? unfinished.missing : sections.length ? sections : [null];
    const already = sections.length - (unfinished ? windows.length : sections.length);
    const finished = new Set(unfinished?.adds.map((a) => a.bar));
    let adds: WriteAnswer["adds"] = unfinished?.adds ?? [];
    const missing: { from: string; to: string }[] = [];
    let last: { status: "fallback"; reason: string } | null = null;
    for (const [k, window] of windows.entries()) {
      if ((k || unfinished) && adds.length && window) written(adds, { writing: { ...window, done: already + k, of: sections.length } });
      const before = window ? bars[bars.indexOf(window.from) - 1] : undefined;
      const earlier = adds.filter((a) => a.bar === before).map((a) => `${a.part}: ${a.events}`).join(" / ");
      const these = window ? bars.slice(bars.indexOf(window.from), bars.indexOf(window.to) + 1) : bars;
      const composed = theme.filter((l) => these.includes(l.bar)).map((l) => `Bar ${l.bar} ${l.role}: ${l.events}`).join(" / ").slice(0, 8000);
      const asked: WriteInput = { ...input, chosen: plan, ...(window ? { window } : {}), ...(earlier ? { earlier: earlier.slice(0, 8000) } : {}), ...(seed ? { seed: { ...seed, ...(composed ? { theme: composed } : {}) } } : {}) };
      const reply = await askSpark("arrange", asked);
      if (turn.current !== now) return;
      if (reply.status === "ok") {
        adds = [...adds, ...withDoubles(reply.answer as WriteAnswer, bars).filter((a) => !finished.has(a.bar))];
        continue;
      }
      last = reply;
      if (window) missing.push(window);
      // No money or no way to ask won't change for the next section, so the sections after it are unfinished too.
      if (reply.reason !== "failed" && reply.reason !== "timeout" && reply.reason !== "network" && reply.reason !== "rejected") {
        missing.push(...windows.slice(k + 1).flatMap((w) => (w ? [w] : [])));
        break;
      }
    }
    if (unfinished) adds = [...adds].sort((a, b) => bars.indexOf(a.bar) - bars.indexOf(b.bar));
    if (adds.length) return written(adds, missing.length ? { missing, again: { seed, theme } } : {});
    const saved = isSaved ? await savedOf() : null;
    if (turn.current !== now) return;
    const kept = saved?.notes?.[index];
    if (kept) return written(kept.adds);
    // It ran out of room or time, which is different from having no way to ask.
    setNotes({ status: last && last.reason !== "failed" && last.reason !== "timeout" && last.reason !== "network" && last.reason !== "rejected" ? "unavailable" : "unfinished" });
  };

  /** Two new pieces in words, from the composer's tune taken as a main motif (Ryu, 11-02). */
  const askRecompose = async (words: string, length: number, instruments: string[], freedom = 3) => {
    if (!base || !mine) return;
    const now = ++turn.current;
    setRecompose({ status: "asking" });
    const lines = pieceInput(base.score, mine, span.from, span.to).lines ?? [];
    const reading = piece.status === "ready" && map ? { roles: map.roles.filter((r) => lines.includes(r.line)).slice(0, 200), missing: piece.answer.missing } : null;
    const input = { ...arrangeInput(base.score, mine, span.from, span.to, words, 0, reading, { instruments, where: "after", answers, freedom, tracks: lines.flatMap((line) => (tracks[line]?.trim() ? [{ line, instrument: tracks[line]!.trim() }] : [])) }), moreBars: length };
    const reply = await askSpark("plan_recompose", input);
    if (turn.current !== now) return;
    setRecompose(reply.status === "ok" ? { status: "ready", plans: (reply.answer as { options: RecomposePlan[] }).options, input } : { status: "unavailable" });
  };

  /** One of those pieces: its tune, countermelody and bass first, then everything else around them, on a new empty score of the shape it asks for. */
  const writeRecomposed = async (index: number) => {
    if (recompose.status !== "ready") return;
    // At its closest a recomposition keeps the composer's key and metre, whatever it proposed.
    const proposed = recompose.plans[index]!;
    const asked = recompose.input;
    const plan = asked.freedom === 1 ? { ...proposed, fifths: asked.fifths ?? proposed.fifths, time: asked.time ?? proposed.time } : proposed;
    const instruments = asked.instruments ?? [];
    const length = asked.moreBars;
    const qpm = Math.max(30, Math.min(220, plan.qpm));
    const xmlText = emptyScore(plan.name, instruments, { fifths: plan.fifths, time: plan.time, qpm, bars: length });
    const page: Page = { xmlText, score: parseScore(xmlText) };
    const now = ++turn.current;
    const heights = motifHeights(asked, plan.motif.from, plan.motif.to);
    const opening = motifHeights(asked, asked.written[0]!.bar, asked.written[Math.min(1, asked.written.length - 1)]!.bar).slice(0, 3);
    setKept(page);
    setPlaced({ status: "none" });
    setOff([]);
    setOffBars([]);
    setRecomposed({ plan, heights, opening, tuneBars: 0, bars: length });
    const input = arrangeInput(page.score, page.score.parts[0]!, 0, length - 1, asked.ask, 0, null, { instruments, where: "inside", answers: asked.answers, freedom: asked.freedom });
    setOptions({ status: "ready", plans: [plan], input, notes: {}, saved: false });
    const composed = await askSpark("write_theme", { ...asked, chosen: plan } satisfies ThemeInput);
    if (turn.current !== now) return;
    const lines = composed.status === "ok" ? (composed.answer as ThemeAnswer).lines : [];
    setRecomposed({ plan, heights, opening, tuneBars: new Set(lines.filter((l) => l.role === "tune").map((l) => l.bar)).size, bars: length });
    const tune = sourceText(asked).slice(0, 16000);
    await writeNotes(page, input, plan, 0, false, { tune, motif: `${plan.motif.what} From bars ${plan.motif.from} to ${plan.motif.to}.` }, lines);
  };

  /** Rewrites only these bars of what's been written, from what the composer says. Everything else stays. */
  const askFix = async (index: number, from: string, to: string, words: string) => {
    if (!base || options.status !== "ready") return;
    const held = options.notes[index];
    if (held?.status !== "ready") return;
    const { input } = options;
    const plan = options.plans[index]!;
    const bars = [...input.written.map((w) => w.bar), ...newBarNumbers(input)];
    const these = bars.slice(bars.indexOf(from), bars.indexOf(to) + 1);
    const now = turn.current;
    setFixing("asking");
    const current = held.adds.filter((a) => these.includes(a.bar)).map((a) => `${a.part}, bar ${a.bar}: ${a.events}`).join(" / ").slice(0, 8000);
    const reply = await askSpark("arrange", { ...input, chosen: plan, window: { from, to }, fix: { ask: words, current: current || "nothing yet" } } satisfies WriteInput);
    if (turn.current !== now) return;
    setFixing(reply.status === "ok" ? "none" : "unavailable");
    if (reply.status !== "ok") return;
    const adds = [...held.adds.filter((a) => !these.includes(a.bar)), ...withDoubles(reply.answer as WriteAnswer, bars)];
    // A section this fix wrote all of isn't missing any more. Any other unfinished section still is.
    const missing = held.missing?.filter((m) => !(these.includes(m.from) && these.includes(m.to)));
    setOptions((state) => (state.status === "ready" && state.input === input ? { ...state, notes: { ...state.notes, [index]: { status: "ready", adds, check: checkOption({ ...plan, adds }, base.score, input), ...(missing?.length ? { missing, ...(held.again ? { again: held.again } : {}) } : {}) } } } : state));
  };

  /** Orders of the composer's own bars that put the right music on their moments. */
  const askFit = async (words: string) => {
    if (!base || !mine || !cues.length) return;
    const now = ++turn.current;
    setFitting("asking");
    const written = pieceInput(base.score, mine, span.from, span.to);
    const lines = written.lines ?? [];
    const input: FitInput = {
      ...written,
      roles: (map?.roles ?? []).filter((r) => lines.includes(r.line)).slice(0, 200),
      moments: placeCues(cues, base.score).slice(0, 40).map((m) => ({ beats: Math.round(m.beats * 100) / 100, time: timeWords(m.seconds), what: m.what })),
      ask: words.trim() || null,
    };
    const reply = await askSpark("fit_form", input);
    if (turn.current !== now) return;
    if (reply.status !== "ok") return setFitting("unavailable");
    setFitted((reply.answer as FitAnswer).structures);
    setFitting("none");
  };

  /** A DAW's markers, added to whatever's been typed. */
  const importMarkers = async (file: File) => {
    try {
      const markers = markersOf(new Uint8Array(await file.arrayBuffer()));
      setCues((now) => [...now, ...markers.map((m) => ({ time: "", what: m.what, beats: m.beats }))]);
      setMarkerNote(markers.length ? null : "That file has no markers in it.");
    } catch (e) {
      setMarkerNote((e as Error).message);
    }
  };

  const structures = useMemo(() => [...(piece.status === "ready" ? piece.answer.structures : []), ...fitted], [piece, fitted]);

  /** The notes of what's being tried, plainly for a file or in colour for the page. */
  const tried = (color?: string, from = base?.xmlText): string | null => {
    if (!base || !trying || !from) return null;
    if (trying.kind === "structure") {
      if (trying.index < 0) return handOrder.length ? withStructure(from, { order: handOrder }) : null;
      const structure = structures[trying.index];
      return structure ? withStructure(from, structure) : null;
    }
    const notes = options.status === "ready" ? options.notes[trying.index] : undefined;
    return notes?.status === "ready" ? withOption(from, base.score, withoutParts(notes.check, off, offBars), color) : null;
  };

  const shown: Page | null = useMemo(() => {
    const xmlText = tried(NEW_NOTES);
    const standing = kept || split || gone.length ? base : null;
    if (!xmlText) return standing;
    try {
      return { xmlText, score: parseScore(xmlText) };
    } catch {
      return standing;
    }
    // `tried` only reads these.
  }, [base, trying, off, offBars, structures, options, kept, split, gone, handOrder]);

  /** The bars of the structure being tried, in playing order, by the numbers the composer knows them by. */
  const orderedBars = useMemo(() => {
    if (!base || trying?.kind !== "structure") return null;
    const order = trying.index < 0 ? handOrder : structures[trying.index]?.order;
    const numbers = base.score.parts[0]?.measures.map((m) => m.number) ?? [];
    return (order ?? []).flatMap(({ from, to }) => {
      const [a, b] = [numbers.indexOf(from), numbers.indexOf(to)];
      return a < 0 || b < a ? [] : numbers.slice(a, b + 1);
    });
  }, [base, trying, handOrder, structures]);

  const readBars = useMemo(() => map?.written.map((w) => w.bar) ?? [], [map]);

  /** The composer's bars as they stand, to measure every order by. */
  const baseBars = useMemo(() => (base ? pieceData(base.score, [], []).bars : []), [base]);
  /**
   * Each order as blocks of the composer's own sections, so the difference is seen and not read (Ryu, 11-03). The first is the order as written.
   * `index` is the structure's, -1 for one put together by hand, and null for the order as written.
   */
  const orders = useMemo(() => {
    if (piece.status !== "ready" || baseBars.length === 0) return [];
    const numbers = baseBars.map((b) => b.number);
    const named = piece.answer.sections ?? [];
    const sectionAt = (k: number) => named.findIndex((s) => numbers.indexOf(s.from) <= k && k <= numbers.indexOf(s.to));
    const blocks = (order: Stretch[]) =>
      order.flatMap(({ from, to }) => {
        const [a, b] = [numbers.indexOf(from), numbers.indexOf(to)];
        const out: { from: string; to: string; name: string; tint: number; beats: number }[] = [];
        for (let k = a; a >= 0 && k <= b; k++) {
          const at = sectionAt(k);
          const last = out[out.length - 1];
          if (last && last.tint === at && numbers.indexOf(last.to) === k - 1) {
            last.to = numbers[k]!;
            last.beats += baseBars[k]!.length;
          } else out.push({ from: numbers[k]!, to: numbers[k]!, name: named[at]?.name ?? "", tint: at, beats: baseBars[k]!.length });
        }
        return out;
      });
    const written = { index: null, name: "As you wrote it", why: "", blocks: blocks([{ from: numbers[0]!, to: numbers[numbers.length - 1]! }]) };
    return [written, ...structures.map((s, index) => ({ index, name: s.name, why: s.why, blocks: blocks(s.order) })), ...(handOrder.length ? [{ index: -1, name: "Your own order", why: "", blocks: blocks(handOrder) }] : [])];
  }, [piece, baseBars, structures, handOrder]);

  /** The whole piece as a picture. It's there as soon as a score opens, and the colours arrive with the reading. */
  const overview = useMemo(() => {
    if (!base) return null;
    if (orderedBars && shown) return pieceData(shown.score, map?.roles ?? [], readBars, { sourceBar: (bar) => orderedBars[Number(bar) - 1] ?? bar });
    const notes = trying?.kind === "option" && options.status === "ready" ? options.notes[trying.index] : undefined;
    return pieceData(base.score, map?.roles ?? [], readBars, { adds: notes?.status === "ready" ? withoutParts(notes.check, off, offBars).adds : undefined });
  }, [base, map, readBars, orderedBars, shown, trying, options, off, offBars]);

  const sections = useMemo(() => {
    if (piece.status !== "ready" || orderedBars) return [];
    const players = base?.score.parts.map((p) => p.name.toLowerCase()).filter((name) => !name.endsWith("(not placed)")) ?? [];
    return (piece.answer.sections ?? [])
      .filter((s) => overview?.bars.some((b) => b.number === s.from) && overview.bars.some((b) => b.number === s.to))
      .map((s) => {
        // "Piano alone" isn't true once the piano's notes are on a violin, so the section goes by its bars.
        const named = instrumentFromName(s.name)?.toLowerCase();
        return placed.status === "ready" && named && !players.some((name) => name.includes(named)) ? { ...s, name: "" } : s;
      });
  }, [piece, orderedBars, overview, placed, base]);
  const barNumbers = useMemo(() => overview?.bars.map((b) => b.number) ?? [], [overview]);

  /** The stretch around a bar: its section if it has one, and otherwise eight bars. */
  const stretchAround = (bar: string): Stretch | null => {
    const k = barNumbers.indexOf(bar);
    if (k < 0) return null;
    const section = sections.find((s) => barNumbers.indexOf(s.from) <= k && k <= barNumbers.indexOf(s.to));
    if (section) return { from: section.from, to: section.to };
    const start = k - (k % 4);
    return { from: barNumbers[start]!, to: barNumbers[Math.min(start + 7, barNumbers.length - 1)]! };
  };

  // What's just gone on the score is what the composer wants to read.
  useEffect(() => {
    if (trying?.kind !== "option" || options.status !== "ready") return;
    const notes = options.notes[trying.index];
    if (notes?.status !== "ready") return;
    const first = notes.check.adds.map((a) => a.bar).sort((a, b) => barNumbers.indexOf(a) - barNumbers.indexOf(b))[0];
    const around = first ? stretchAround(first) : null;
    if (around) setSelected(around);
  }, [trying]);

  const view: Stretch | null = useMemo(() => {
    if (selected && barNumbers.includes(selected.from) && barNumbers.includes(selected.to)) return selected;
    // Bars that have just gone leave the composer at the end of what's left, and not back at the top.
    if (selected && barNumbers.length) return { from: barNumbers[Math.max(0, barNumbers.length - 8)]!, to: barNumbers[barNumbers.length - 1]! };
    if (sections[0]) return { from: sections[0].from, to: sections[0].to };
    return barNumbers.length ? { from: barNumbers[0]!, to: barNumbers[Math.min(7, barNumbers.length - 1)]! } : null;
  }, [selected, barNumbers, sections]);

  /** The bars on the page that have something new in them, whether or not it's been left out. */
  const newHere = useMemo(() => {
    const notes = trying?.kind === "option" && options.status === "ready" ? options.notes[trying.index] : undefined;
    if (notes?.status !== "ready" || !view) return [];
    const onPage = barNumbers.slice(barNumbers.indexOf(view.from), barNumbers.indexOf(view.to) + 1);
    const fresh = new Set(withoutParts(notes.check, off).adds.map((a) => a.bar));
    return onPage.filter((bar) => fresh.has(bar));
  }, [trying, options, off, view, barNumbers]);
  const offHere = newHere.length > 0 && newHere.every((bar) => offBars.includes(bar));

  /** The same score for looking at: one stretch of it, with only the staves that play there, and every note in the colour of what it's doing. Nothing that leaves the page goes through this. */
  const page: Page | null = useMemo(() => {
    if (!base) return null;
    const painted = map ? withRoleColours(base.xmlText, base.score, map.roles, readBars, focus) : base.xmlText;
    const whole = tried(focus && focus !== "new" ? FADED : NEW_NOTES, painted) ?? painted;
    const xmlText = view ? onlyBars(whole, view.from, view.to) : whole;
    return { xmlText, score: parseScore(xmlText) };
    // `tried` only reads these.
  }, [base, map, readBars, focus, trying, off, offBars, structures, options, handOrder, view]);

  /** What's on the page becomes the composer's own, to read again or to build on. */
  const keep = () => {
    const xmlText = tried();
    if (!xmlText) return;
    turn.current++;
    setKept({ xmlText, score: parseScore(xmlText) });
    setGone([]);
    setOptions({ status: "none" });
    // A kept recomposition is simply the composer's score now, so going again offers new plans for it (review F2).
    setRecomposed(null);
    setRecompose({ status: "none" });
    // A new order renumbers the bars, so the old reading no longer points at anything.
    if (trying?.kind === "structure") {
      setPiece({ status: "none" });
      studyTurn.current++;
      setStudy({ status: "none" });
      setPlaced({ status: "none" });
      setHandOrder([]);
      setFitted([]);
    }
    setTrying(null);
  };

  /** A folder of MIDI and notation for a DAW, of whatever's on the page, lined up with the composer's session at bar 1. */
  const download = (forPlayers = false) => {
    if (!loaded || !base) return;
    const xmlText = tried() ?? base.xmlText;
    const title = base.score.movementTitle ?? base.score.title ?? loaded.fileName;
    const notes = trying?.kind === "option" && options.status === "ready" ? options.notes[trying.index] : undefined;
    const check = notes?.status === "ready" ? withoutParts(notes.check, off, offBars) : null;
    const option = check && options.status === "ready" ? options.plans[trying!.index]! : null;
    const structure = trying?.kind === "structure" ? (structures[trying.index] ?? { name: "Your own order", why: "", order: handOrder }) : null;
    const placedCheck = placed.status === "ready" ? placed.check : null;
    const why = option
      ? whyText(title, option.name, option.idea, option.why, check, placedCheck)
      : structure
        ? whyText(title, structure.name, structure.why, [], null, placedCheck)
        : whyText(title, placed.status === "ready" ? "On your instruments" : "The score as it stands", placed.status === "ready" ? placed.answer.idea : "", [], null, placedCheck);
    // The moments go back to the DAW as markers, on the beat they fall on in this score.
    const markers = placeCues(cues, parseScore(xmlText)).map((m) => ({ beat: m.beats, text: m.what || timeWords(m.seconds) }));
    const bytes = packageFiles(xmlText, check, why, markers, forPlayers);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    link.download = `${title.replace(/[^\w.-]+/g, "-")}-arrangement.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const studyMarks = useMemo(() => {
    if (study.status !== "ready" || trying || kept || !base || !page) return null;
    const marks = studyMarksOf(study.answer, study.written, study.parts);
    if (!view) return marks;
    const measures = base.score.parts[0]?.measures ?? [];
    // Printed numbers that start again, in a later movement, can't say which bars are on the page, so nothing is marked rather than the wrong music (review F5).
    if (new Set(measures.map((m) => m.number)).size !== measures.length) return null;
    const [from, to] = [measures.findIndex((m) => m.number === view.from), measures.findIndex((m) => m.number === view.to)];
    return from < 0 || to < from ? null : marksOnPage(marks, page.score, from, to);
  }, [study, trying, kept, base, page, view]);

  return {
    piece,
    study,
    /** The study in pencil on the composer's own score. Not on anything new or kept, whose notes it never read. */
    studyMarks,
    map,
    roles: map?.roles ?? [],
    tracks,
    setTrack: (line: string, instrument: string) => setTracks((now) => ({ ...now, [line]: instrument })),
    answered,
    answer: (question: number, text: string) => setAnswered((now) => ({ ...now, [question]: text })),
    placed,
    options,
    trying,
    setTrying,
    off,
    togglePart,
    offBars,
    newHere,
    offHere,
    /** Leave out what's new in the bars on the page, or put it back. */
    toggleHere: () => setOffBars((now) => (offHere ? now.filter((bar) => !newHere.includes(bar)) : [...new Set([...now, ...newHere])])),
    putBackBars: () => setOffBars([]),
    /** An option as it stands, less whatever's been left out of it. */
    remaining: (check: OptionCheck) => withoutParts(check, off, offBars),
    /** Tracks that play chords, which can be split before anything is read. */
    chords: sketch?.chords ?? [],
    splitting,
    toggleSplit: (line: string) => {
      dropAsked();
      setSplitting((now) => (now.includes(line) ? now.filter((l) => l !== line) : [...now, line]));
    },
    splitAll: () => {
      dropAsked();
      setSplitting(sketch?.chords.map((c) => c.line) ?? []);
    },
    /** Every part there is to keep or delete, and which are gone. */
    allParts: (kept ?? source)?.score.parts.map((p) => ({ id: p.id, name: p.name })) ?? [],
    gone,
    toggleGone,
    handOrder,
    setHandOrder,
    bars: piece.status === "ready" ? piece.written.map((w) => w.bar) : [],
    cues,
    setCues,
    markerNote,
    importMarkers,
    /** Where each moment falls on the page as it is now. */
    moments: base ? placeCues(cues, (shown ?? base).score) : [],
    /** The score the moments are checked against. */
    standing: base?.score ?? null,
    structures,
    orders,
    fitting,
    askFit,
    shown,
    page,
    overview,
    sections,
    view,
    /** Show the notation for the stretch around a bar. */
    select: (bar: string) => setSelected(stretchAround(bar)),
    selectRange: (from: string, to: string) => setSelected({ from, to }),
    focus,
    setFocus,
    solo,
    toggleSolo: (label: string) => setSolo((now) => (now.includes(label) ? now.filter((l) => l !== label) : [...now, label])),
    instrumentOf: (label: string) => tracks[label] ?? "",
    kept: !!kept,
    askPiece,
    askPlaced,
    splitPlaced,
    askOptions,
    askNotes,
    setChords,
    lastAsk: moodKey,
    recompose,
    recomposed,
    askRecompose,
    writeRecomposed,
    motifFound: recomposed && options.status === "ready" && options.notes[0]?.status === "ready" ? motifSightings(options.notes[0].check, recomposed.heights) : null,
    openingFound: recomposed && options.status === "ready" && options.notes[0]?.status === "ready" ? motifSightings(options.notes[0].check, recomposed.opening) : null,
    fixing,
    askFix,
    freedomOf: recompose.status === "ready" ? recompose.input.freedom : undefined,
    keep,
    startAgain: clear,
    download,
    reachesEnd: !!mine && span.to >= mine.measures.length - 1,
    /** Past this, a whole-score reading doesn't happen, and only one line is read. */
    wholeScore: !!base && !!wholeScoreParts(base.score),
  };
}

export type Arranged = ReturnType<typeof useArrange>;
