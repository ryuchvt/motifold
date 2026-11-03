import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ArrangeInput, PieceReading } from "../server/shapes";
import { checkWords, placedWords, planGaps, sentences } from "./arrange";
import { cueHits, cueWords, orderHits, parseTime, placeCues } from "./cues";
import { inScoreOrder, instrumentFromName, PICKABLE, TEMPLATES, TRACK_CHOICES } from "./orchestra";
import { StudyMap, StudyWords } from "./ScoreStudy";
import type { Arranged, Stretch } from "./useArrange";
import type { Attention } from "./attention";
import { playhead } from "./playhead";
import { Orders } from "./PieceView";
import type { Selection } from "./selection";

const orderWords = (order: Stretch[]) => order.map((o, k) => (k ? barsWords(o.from, o.to).toLowerCase() : barsWords(o.from, o.to))).join(", then ");
const barsWords = (from: string, to: string) => (from === to ? `Bar ${from}` : `Bars ${from} to ${to}`);
const STEPS = ["Study", "Setup", "Pick", "Write", "Export"];

/** Detail that's there when it's wanted and quiet when it isn't. */
function More({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="arrange-more" open={open}>
      <summary>{title}</summary>
      <div className="arrange-more-body">{children}</div>
    </details>
  );
}

/** A question from Muse Spark: its choices, and a box for an answer it didn't think of. */
function Question({ question, count, of, onAnswer, onSkip, onShow }: { question: PieceReading["questions"][number]; count: number; of: number; onAnswer: (text: string) => void; onSkip: () => void; onShow?: (from: string, to: string) => void }) {
  const [own, setOwn] = useState<string | null>(null);
  return (
    <div className="arrange-question">
      <button className="arrange-bars" disabled={!onShow} onClick={() => onShow?.(question.from, question.to)}>
        {barsWords(question.from, question.to)}, question {count} of {of}
      </button>
      <h2 className="arrange-title">{question.ask}</h2>
      <span className="arrange-chips" role="group" aria-label={question.ask}>
        {question.choices.map((c) => (
          <button key={c.label} className="chip-button" onClick={() => onAnswer(c.label)}>
            {c.label[0]?.toUpperCase()}
            {c.label.slice(1)}
          </button>
        ))}
        <button className={`chip-button${own !== null ? " on" : ""}`} aria-pressed={own !== null} onClick={() => setOwn(own ?? "")}>
          Other
        </button>
      </span>
      {own !== null && (
        <form
          className="arrange-own"
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim()) onAnswer(own.trim());
          }}
        >
          <input autoFocus maxLength={300} aria-label="Your own answer" value={own} onChange={(e) => setOwn(e.target.value)} />
          <button className="button small">Answer</button>
        </form>
      )}
      <button className="arrange-quiet" onClick={onSkip}>
        Skip this
      </button>
    </div>
  );
}

const OTHER = "other";

/** What a track is: one of the usual instruments, or anything else in the composer's own words. */
function TrackChoice({ line, value, doubt, why, onChange }: { line: string; value: string; doubt: boolean; why?: string; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false);
  const listed = TRACK_CHOICES.flatMap((c) => c.names).find((name) => name.toLowerCase() === value.trim().toLowerCase());
  const other = typing || (!!value.trim() && !listed);
  return (
    <li className={doubt ? "unsure" : undefined}>
      <label title={why}>
        <span className="arrange-track">{line}</span>
        <select
          value={other ? OTHER : (listed ?? "")}
          onChange={(e) => {
            const chosen = e.target.value;
            setTyping(chosen === OTHER);
            onChange(chosen === OTHER ? "" : chosen);
          }}
        >
          <option value="">Not sure</option>
          {TRACK_CHOICES.map((c) => (
            <optgroup key={c.group} label={c.group}>
              {c.names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={OTHER}>Other</option>
        </select>
      </label>
      {other && <input className="arrange-track-own" autoFocus={typing} maxLength={40} aria-label={`What ${line} is`} placeholder="What is it?" value={value} onChange={(e) => onChange(e.target.value)} />}
    </li>
  );
}

/** Moments that can't move, for writing to picture, typed or read from a DAW's markers. */
function Moments({ arranged }: { arranged: Arranged }) {
  const { cues, setCues, markerNote, importMarkers, standing } = arranged;
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <ol className="arrange-cues">
        {cues.map((cue, k) => {
          const change = (next: Partial<typeof cue>) => setCues(cues.map((c, i) => (i === k ? { ...c, ...next } : c)));
          const where = standing && (cue.beats !== undefined || parseTime(cue.time) !== null) ? placeCues([cue], standing)[0] : null;
          const bad = cue.beats === undefined && !!cue.time.trim() && parseTime(cue.time) === null;
          return (
            <li key={k}>
              <span className="arrange-cue-row">
                <input aria-label={`Moment ${k + 1}, time`} maxLength={16} placeholder="1:09.5" value={cue.beats !== undefined ? "marker" : cue.time} disabled={cue.beats !== undefined} onChange={(e) => change({ time: e.target.value })} />
                <input aria-label={`Moment ${k + 1}, what happens`} maxLength={200} placeholder="The melody comes in" value={cue.what} onChange={(e) => change({ what: e.target.value })} />
                <button className="round small" aria-label={`Remove moment ${k + 1}`} onClick={() => setCues(cues.filter((_, i) => i !== k))}>
                  ×
                </button>
              </span>
              {where && <span className="spark-note">{cueWords(where)}</span>}
              {bad && <span className="spark-note">Write a time like 1:09.5, counted from bar 1.</span>}
            </li>
          );
        })}
      </ol>
      <span className="arrange-actions">
        <button className="button small" onClick={() => setCues([...cues, { time: "", what: "" }])}>
          Add a moment
        </button>
        <button className="button small" onClick={() => file.current?.click()}>
          Import markers
        </button>
        <input
          ref={file}
          type="file"
          accept=".mid,.midi"
          hidden
          aria-label="A MIDI file with markers"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void importMarkers(chosen);
            e.target.value = "";
          }}
        />
      </span>
      {markerNote && <p className="spark-note">{markerNote}</p>}
    </>
  );
}

/** The bars on the page, and the way to leave out what's new in them. */
export function StretchHead({ arranged }: { arranged: Arranged }) {
  const { view, sections, newHere, offHere, toggleHere } = arranged;
  if (!view) return null;
  const name = sections.find((s) => s.from === view.from && s.to === view.to)?.name;
  return (
    <p className="stage-under">
      {[name, `Bars ${view.from} to ${view.to}`].filter(Boolean).join(", ")}
      {newHere.length > 0 && (
        <button className="arrange-quiet" onClick={toggleHere}>
          {offHere ? "Put back what's new here" : "Leave out what's new here"}
        </button>
      )}
    </p>
  );
}

/** How far a recomposition may go, and what stays at each. */
const FREEDOMS: [string, string][] = [
  ["Close", "Your whole tune, in order, in its own key and metre. It can be decorated, and the chords are new."],
  ["Reshaped", "Your whole tune, in order, still easy to recognise. Its rhythm, major or minor, chords and metre can change."],
  ["Themes", "Your main phrases, clearly heard. Their order can change, with new connecting music and a contrasting section."],
  ["Motif", "Your opening bar or two drives the piece and is heard plainly at least once. A new melody grows from it."],
  ["Seed", "Only a small cell stays, and it may never be heard plainly. Everything else is new."],
];

/** Moods to start from. Words of their own go in the box beside these. */
const MOODS = ["Sad", "Tender", "Hopeful", "Dreamy", "Pastoral", "Wonder", "Storybook", "Playful", "Heroic", "Epic", "Pulse", "Action", "Tense", "Dark"];
/** The few shown at first. The rest are one press away. */
const SUGGESTED_MOODS = ["Hopeful", "Tender", "Sad", "Dreamy", "Heroic", "Tense"];

/** Whether a saved answer happens to be for the instruments the composer picked. */
const sameChoice = (placed: { instruments: string[]; chosen: string[] }) => [...placed.instruments].sort().join("|") === [...placed.chosen].sort().join("|");

export type WorkIntent = "arrange" | "expand" | "recompose";
export interface InitialSetup { ensemble?: string; mood?: string; moreBars?: number; intent?: WorkIntent; useMelodyOnly?: boolean }

export function ArrangePanel({ arranged, busy, demo = false, prepared = [], onStage, selection = null, attention = [], onPick, onMode, chosenPlan = null, onChoosePlan, navigationHost, actionHost, comparisonHosted = false, onNavigate, initialSetup }: { arranged: Arranged; busy: boolean; demo?: boolean; prepared?: { key: string; mode: "arrange" | "recompose"; mood: string }[]; onStage?: (name: string) => void; selection?: Selection | null; attention?: Attention[]; onPick?: (selection: Selection | null) => void; onMode?: (mode: WorkIntent) => void; chosenPlan?: number | null; onChoosePlan?: (index: number) => void; navigationHost?: HTMLElement | null; actionHost?: HTMLElement | null; comparisonHosted?: boolean; onNavigate?: () => void; initialSetup?: InitialSetup }) {
  const { piece, study, chords, splitting, toggleSplit, splitAll, tracks, setTrack, answered, answer, placed, options, trying, setTrying, off, togglePart, offBars, putBackBars, remaining, allParts, gone, toggleGone, handOrder, setHandOrder, bars, cues, roles, standing, structures, fitting, askFit, kept, askPiece, askPlaced, splitPlaced, askOptions, askNotes, keep, startAgain, download, reachesEnd, wholeScore, selectRange } = arranged;
  const action = (node: ReactNode) => actionHost ? createPortal(node, actionHost) : node;
  /** The step on screen, counted from Study. */
  const [step, setStep] = useState(1);
  /** The furthest step the composer has gone to. Steps past it are named but can't be opened yet. */
  const [reached, setReached] = useState(1);
  /** The plan being written, by its place in the list. */
  const [pick, setPick] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<number[]>([]);
  // A string orchestra suits most sketches, and the replay was made for a full one.
  const startWith = TEMPLATES.find((t) => t.name === (initialSetup?.ensemble ?? (demo ? "Full orchestra" : "String orchestra")));
  const [template, setTemplate] = useState<string | null>(startWith?.name ?? null);
  const [picked, setPicked] = useState<string[]>(startWith?.instruments ?? []);
  const [ownInstrument, setOwnInstrument] = useState("");
  const [placeWords, setPlaceWords] = useState("");
  const [writeWords, setWriteWords] = useState("");
  const [mood, setMood] = useState<string | null>(initialSetup?.mood ?? null);
  /** Stay with the composer's melody, or take it as a motif (Ryu, 11-02). */
  const [mode, setMode] = useState<WorkIntent>(initialSetup?.intent ?? "arrange");
  const [length, setLength] = useState(32);
  /** How far a recomposition may go from the tune. */
  const [freedom, setFreedom] = useState(3);
  /** Keep only the tune and write the rest new from the sketch, or keep every note on the instruments. */
  const [tuneOnly, setTuneOnly] = useState(initialSetup?.useMelodyOnly ?? false);
  const [forPlayers, setForPlayers] = useState(false);
  const [fixWords, setFixWords] = useState("");
  const [fitWords, setFitWords] = useState("");
  const [moreBars, setMoreBars] = useState(initialSetup?.moreBars ?? 8);
  const [where, setWhere] = useState<ArrangeInput["where"]>("both");

  /** Keep the composer's tracks as they are and only add new parts, with no layout first. */
  const [keepTracks, setKeepTracks] = useState(!initialSetup?.ensemble);
  /** Where Create has got to. It runs the layout, the two plans and their first sections one after another, each from the last one's result. */
  const [creating, setCreating] = useState<null | "layout" | "plan" | "preview">(null);
  /** Later stages use the recipe pressed, even if the composer edits the next setup while it runs. */
  const createRecipe = useRef<{
    words: string;
    moreBars: number;
    intent: "arrange" | "expand";
    where: ArrangeInput["where"];
    placedBefore: Arranged["placed"];
    optionsBefore: Arranged["options"];
    previewInput?: ArrangeInput;
  } | null>(null);
  useEffect(() => onMode?.(mode), [mode]);
  const go = (to: number) => {
    setStep(to);
    setReached((now) => Math.max(now, to));
  };
  const moodsHere = demo ? MOODS.filter((m) => prepared.some((p) => p.key === (mode === "recompose" ? `recompose-${freedom}-${m.toLowerCase()}` : `arrange-${m.toLowerCase()}`))) : MOODS;
  const askedWords = () => [mode !== "arrange" && mood ? `The mood I want: ${mood.toLowerCase()}.` : "", writeWords.trim()].filter(Boolean).join(" ");
  const chosen = inScoreOrder(picked);
  const generate = () => {
    if (mode !== "recompose") void askOptions(askedWords(), mode === "arrange" ? 0 : moreBars, mode === "arrange" ? "inside" : where, mode);
    else void arranged.askRecompose(askedWords(), length, chosen.length ? chosen : TEMPLATES.find((t) => t.name === "Full orchestra")!.instruments, freedom);
  };
  /** Everything chosen, so Muse Spark takes it from here and stops only where there's a choice to make. */
  const create = () => {
    go(3);
    const words = askedWords();
    if (mode === "recompose") {
      createRecipe.current = null;
      setCreating(null);
      void arranged.askRecompose(words, length, chosen.length ? chosen : TEMPLATES.find((t) => t.name === "Full orchestra")!.instruments, freedom);
      return;
    }
    const intent = mode as "arrange" | "expand";
    const count = intent === "arrange" ? 0 : moreBars;
    const location = intent === "arrange" ? "inside" : where;
    createRecipe.current = { words, moreBars: count, where: location, intent, placedBefore: placed, optionsBefore: options };
    if (keepTracks) {
      setCreating("plan");
      void askOptions(words, count, location, intent);
      return;
    }
    setCreating("layout");
    void askPlaced(chosen, [words, placeWords.trim()].filter(Boolean).join(" "), intent === "arrange" ? false : tuneOnly, intent);
  };
  // Each stage starts from what the last one left, after it's on the page, so the plans are made for the laid-out score.
  useEffect(() => {
    const recipe = createRecipe.current;
    if (!creating || !recipe) return;
    const finish = () => {
      createRecipe.current = null;
      setCreating(null);
    };
    if (piece.status !== "ready") return finish();
    if (creating === "layout") {
      if (placed === recipe.placedBefore) return;
      if (placed.status === "ready") {
        recipe.optionsBefore = options;
        setCreating("plan");
        void askOptions(recipe.words, recipe.moreBars, recipe.where, recipe.intent);
      } else if (placed.status === "unavailable") finish();
    } else if (creating === "plan") {
      if (options === recipe.optionsBefore) return;
      if (options.status === "ready") {
        // Local fallback answers already contain their saved notes. Recorded transports replay the real preview requests.
        if (options.saved) return finish();
        recipe.previewInput = options.input;
        setCreating("preview");
        options.plans.forEach((_, index) => void arranged.askPreview(index));
      } else if (options.status === "unavailable") finish();
    } else if (creating === "preview") {
      if (options.status !== "ready" || options.input !== recipe.previewInput || options.plans.every((_, index) => options.notes[index] && options.notes[index]!.status !== "asking")) finish();
    }
  }, [creating, placed, options, piece.status]);
  const stateOf = (status: string) => (status === "ready" ? "done" : status === "asking" ? "now" : status === "unavailable" ? "failed" : "waiting");
  const previewState = options.status !== "ready" ? "waiting" : creating === "preview" ? "now" : options.plans.some((_, index) => options.notes[index]?.status === "ready") ? "done" : "waiting";
  /** Writes the plan that was pressed, from the list it's in, whatever the other mode has left behind (review F1). */
  const write = (index: number, from: "arrange" | "recompose") => {
    setPick(index);
    onChoosePlan?.(index);
    go(4);
    void (from === "recompose" ? arranged.writeRecomposed(index) : askNotes(index));
  };

  // What's already there opens its step, so a composer who comes back finds it where they left it.
  const written = options.status === "ready" ? Object.entries(options.notes) : [];
  // A preview is still a choice being made, so only notes written in full open Write and Export.
  const full = written.filter(([, n]) => !(n.status === "ready" && n.preview) && !(n.status === "asking" && creating === "preview"));
  const floor = full.some(([, n]) => n.status === "ready" && !n.writing) ? 5 : full.length ? 4 : options.status !== "none" || arranged.recompose.status !== "none" || placed.status !== "none" ? 3 : 1;
  const open = Math.max(reached, floor);
  const current = step === 5 && standing ? 5 : Math.min(step, open);
  useEffect(() => onStage?.(STEPS[current - 1]!), [current]);
  const intentMatches = mode === "recompose" || options.status !== "ready" || !options.input.intent || options.input.intent === mode;
  const exportScore = arranged.shown?.score ?? standing;
  const hasExportNotes = !!exportScore?.parts.some(part => part.notes.some(note => !note.rest && !note.hidden && !note.cue && !note.grace && (note.soundingMidi !== null || note.unpitched)));
  const shownAt = arranged.recomposed ? 0 : ((comparisonHosted ? chosenPlan : null) ?? pick ?? (trying?.kind === "option" ? trying.index : written.length ? Number(written[0]![0]) : null));

  const onShow = trying?.kind === "structure" ? undefined : selectRange;
  const place = (from: string, to: string, text: string, why?: string) => (
    <button className="arrange-line" disabled={!onShow} title={why} onClick={() => onShow?.(from, to)}>
      <span className="arrange-bars">{barsWords(from, to)}</span>
      {text}
    </button>
  );
  const onScore = (kind: "option" | "structure", index: number) =>
    trying?.kind === kind && trying.index === index ? (
      <span className="arrange-actions">
        {kind === "structure" && (
          <button className="button small primary" onClick={keep}>
            Keep it
          </button>
        )}
        <button className="button small" onClick={() => setTrying(null)}>
          Take it off
        </button>
      </span>
    ) : (
      <span className="arrange-actions">
        <button className="button small" onClick={() => setTrying({ kind, index })}>
          Put it on the score
        </button>
      </span>
    );
  const stepsContent = (
    <ol className="arrange-steps" aria-label="Steps">
      <li>
        <span className="done">Open</span>
      </li>
      {STEPS.map((name, k) => (
        <li key={name}>
          <button className={current === k + 1 ? "on" : k + 1 < current ? "done" : undefined} aria-current={current === k + 1 ? "step" : undefined} disabled={k === 4 ? !standing : k + 1 > open || piece.status !== "ready"} onClick={() => { setStep(k + 1); onNavigate?.(); }}>
            {name}
          </button>
        </li>
      ))}
    </ol>
  );
  const steps = navigationHost ? createPortal(stepsContent, navigationHost) : stepsContent;
  const next = (to: number, disabled = false) => action(
    <button className="button primary arrange-go" disabled={disabled} onClick={() => go(to)}>
      Next: {STEPS[to - 1]}
    </button>
  );

  if (mode === "recompose" && current === 4 && !arranged.recomposed) {
    const hasPlans = arranged.recompose.status === "ready" || arranged.recompose.status === "asking";
    return <div className="reading arrange">{steps}
      <h2 className="arrange-title">Choose a recomposition first</h2>
      <p className="arrange-said">{hasPlans ? "Choose a plan in Pick to write a new piece." : "Create recomposition plans in Setup, then choose one in Pick."} Your previous arrangement is still available.</p>
      {action(<button className="button primary arrange-go" onClick={() => go(hasPlans ? 3 : 2)}>{hasPlans ? "Back to plans" : "Back to direction"}</button>)}
    </div>;
  }

  if (!intentMatches && (current === 3 || current === 4)) return <div className="reading arrange">{steps}<h2 className="arrange-title">Create a new {mode === 'arrange' ? 'arrangement' : 'expansion'}</h2><p className="arrange-said">The previous result uses a different direction. Your source and that result are still kept. Choose Create in Setup to make this version.</p>{action(<button className="button primary arrange-go" onClick={() => go(2)}>Back to direction</button>)}</div>;

  if (current === 5 && standing) return <div className="reading arrange">{steps}
    <h2 className="arrange-title">Take it to your DAW</h2>
    <p className="arrange-said">Download the complete score, including every bar and the changes you kept.</p>
    {!hasExportNotes && <p className="arrange-said" role="status">There are no sounding notes to export yet. Write a section or return to your sketch.</p>}
    <p className="spark-note">The ZIP contains MIDI, a MusicXML score, separate instrument tracks and your scene markers. Export works with your original sketch too.</p>
    {action(<button className="button primary arrange-go" disabled={!hasExportNotes} onClick={() => download(forPlayers)}>Download MIDI</button>)}
    <label className="arrange-check"><input type="checkbox" checked={forPlayers} onChange={(event) => setForPlayers(event.target.checked)}/>Also include a score transposed for the players</label>
    {trying?.kind === 'option' && <button className="arrange-quiet" onClick={() => { keep(); setPick(null); go(2); }}>Build on this arrangement</button>}
    {kept && <button className="arrange-quiet" onClick={startAgain}>Back to my score</button>}
  </div>;

  if (piece.status === "none") {
    return (
      <div className="reading arrange">
        {steps}
        {kept && <p className="arrange-said">That's your score now.</p>}
        {action(<button
          className="button primary arrange-go"
          disabled={busy}
          onClick={() => {
            setStep(1);
            void askPiece();
          }}
        >
          {kept ? "Read it again" : "Read my score"}
        </button>)}
        {!wholeScore && <p className="spark-note">One line will be read, because this has one part or more than 32 staves.</p>}
        {!kept && chords.length > 0 && (
          <More title="Split chords into single lines" open={splitting.length > 0}>
            <span className="arrange-chips" role="group" aria-label="Tracks to split">
              {chords.map((c) => (
                <button key={c.line} className={`chip-button small${splitting.includes(c.line) ? " on" : ""}`} aria-pressed={splitting.includes(c.line)} onClick={() => toggleSplit(c.line)}>
                  {c.line}, {c.most} lines
                </button>
              ))}
            </span>
            {chords.length > 1 && splitting.length < chords.length && (
              <button className="arrange-quiet" onClick={splitAll}>
                Split them all
              </button>
            )}
          </More>
        )}
      </div>
    );
  }
  if (piece.status === "asking")
    return (
      <div className="reading arrange">
        {steps}
        <p className="arrange-said">Reading every part. This takes about a minute.</p>
      </div>
    );
  if (piece.status === "unavailable")
    return (
      <div className="reading arrange">
        {steps}
        <p className="arrange-said">Muse Spark can't answer here.</p>
        <button className="button small" disabled={busy} onClick={() => void askPiece()}>
          Try again
        </button>
      </div>
    );

  const { answer: reading, lines, saved } = piece;
  const guessOf = (line: string) => reading.tracks?.find((t) => t.line === line);
  const questions = reading.questions ?? [];
  const nextQuestion = questions.findIndex((_, k) => !answered[k]?.trim() && !skipped.includes(k));
  const timed = cues.some((c) => c.beats !== undefined || parseTime(c.time) !== null);
  const o = shownAt !== null && options.status === "ready" ? options.plans[shownAt] : undefined;
  const notes = shownAt !== null && options.status === "ready" ? options.notes[shownAt] : undefined;
  const onPage = trying?.kind === "option" && trying.index === shownAt;
  const left = notes?.status === "ready" && onPage ? remaining(notes.check) : notes?.status === "ready" ? notes.check : null;
  const done = notes?.status === "ready" && !notes.writing;

  const barList = piece.written.map((w) => w.bar);
  const within = (from: string, to: string) => (x: { from: string; to: string }) => barList.indexOf(x.from) <= barList.indexOf(to) && barList.indexOf(x.to) >= barList.indexOf(from);
  const closeInspector = () => onPick?.(null);
  const inspectorHead = (kicker: string, title: string) => (
    <header className="inspector-head">
      <span className="inspector-kicker">{kicker}</span>
      <h2 className="arrange-title">{title}</h2>
      <button className="inspector-close" aria-label={`Back to ${STEPS[current - 1]}`} onClick={closeInspector}>
        ×
      </button>
    </header>
  );
  /** What's known about some bars, whichever way they were picked: their place in the form, their chords and who has the tune. */
  const barsFacts = (from: string, to: string) => {
    const study = arranged.study.status === "ready" ? arranged.study.answer : null;
    const form = study?.sections.filter(within(from, to)) ?? [];
    const chords = (study?.harmony.filter(within(from, to)) ?? []).map((h) => h.chord).filter((c) => c !== "pass" && c !== "?");
    const tune = arranged.roles.filter(within(from, to)).filter((r) => r.role === "melody" || r.role === "countermelody");
    const lines = [...new Set(tune.map((r) => `${r.role === "melody" ? "Tune" : "Countermelody"}: ${r.line}`))];
    const onScoreNow = trying?.kind === "option" && options.status === "ready" && options.notes[trying.index]?.status === "ready";
    return (
      <>
        {form.map((f) => (
          <p key={f.from} className="arrange-said">
            <span className="inspector-form">{f.form}</span> {f.name}, {f.mood}. {f.what}
          </p>
        ))}
        {chords.length > 0 && <p className="inspector-chords">{chords.slice(0, 16).join("  ·  ")}</p>}
        {lines.map((l) => (
          <p key={l} className="spark-note">
            {l}
          </p>
        ))}
        <span className="arrange-actions">
          <button className="button small" onClick={() => { const beat = arranged.overview?.bars.find((bar) => bar.number === from)?.start; if (beat !== undefined) playhead.seek(beat); playhead.play(); }}>
            Play from here
          </button>
          {onScoreNow && arranged.newInRange(from, to).length > 0 && (
            <button className="button small" onClick={() => arranged.toggleRange(from, to)}>
              {arranged.newInRange(from, to).every((bar) => arranged.offBars.includes(bar)) ? "Put back what's new here" : "Leave out what's new here"}
            </button>
          )}
        </span>
        {onScoreNow && !busy && (
          <More title="Rewrite these bars">
            <textarea className="arrange-box" rows={2} maxLength={400} aria-label="What to change in these bars" value={fixWords} placeholder="Thinner here, and let the horns answer the tune." onChange={(e) => setFixWords(e.target.value)} />
            <button className="button small" disabled={busy || !fixWords.trim()} onClick={() => void arranged.askFix(trying!.index, from, to, fixWords.trim())}>
              Rewrite {barsWords(from, to).toLowerCase()}
            </button>
            {arranged.fixing === "unavailable" && <p className="arrange-said">That didn't come back, so these bars are as they were.</p>}
          </More>
        )}
      </>
    );
  };
  const item = selection?.kind === "attention" ? attention.find((a) => a.id === selection.id) : undefined;
  const inspector = !selection ? null : (
    <div className="inspector">
      {selection.kind === "section" && (
        <>
          {inspectorHead("SECTION", `${arranged.sections.find((x) => x.from === selection.from)?.name || barsWords(selection.from, selection.to)}`)}
          <p className="spark-note">{barsWords(selection.from, selection.to)}</p>
          {barsFacts(selection.from, selection.to)}
        </>
      )}
      {selection.kind === "bars" && (
        <>
          {inspectorHead("BARS", barsWords(selection.from, selection.to))}
          {barsFacts(selection.from, selection.to)}
        </>
      )}
      {selection.kind === "lane" && (
        <>
          {inspectorHead("TRACK", selection.line)}
          {lines.includes(selection.line) && (
            <ul className="arrange-tracks">
              <TrackChoice line={selection.line} value={tracks[selection.line] ?? ""} doubt={!instrumentFromName(selection.line) && !!guessOf(selection.line) && !guessOf(selection.line)!.sure} why={guessOf(selection.line)?.why} onChange={(value) => setTrack(selection.line, value)} />
            </ul>
          )}
          {[...new Set(arranged.roles.filter((r) => r.line === selection.line).map((r) => `${barsWords(r.from, r.to)}: ${r.role}${r.of ? ` of ${r.of}` : ""}`))].slice(0, 6).map((l) => (
            <p key={l} className="spark-note">
              {l}
            </p>
          ))}
          <span className="arrange-actions">
            <button className="button small" onClick={() => arranged.toggleSolo(selection.line)}>
              {arranged.solo.includes(selection.line) ? "Hear everything" : "Hear only this"}
            </button>
          </span>
        </>
      )}
      {selection.kind === "attention" && !item && (
        <>
          {inspectorHead("TO CHECK", "Done")}
          <p className="spark-note">That's been dealt with.</p>
        </>
      )}
      {item?.kind === "track" && (
        <>
          {inspectorHead("TO CHECK", `What is ${item.line}?`)}
          {item.why && <p className="spark-note">{item.why}</p>}
          <ul className="arrange-tracks">
            <TrackChoice line={item.line!} value={tracks[item.line!] ?? ""} doubt why={item.why} onChange={(value) => setTrack(item.line!, value)} />
          </ul>
          {action(<button
            className="button primary arrange-go"
            onClick={() => {
              arranged.confirmTracks();
              closeInspector();
            }}
          >
            Confirm tracks
          </button>)}
        </>
      )}
      {item?.kind === "question" && (
        <>
          {inspectorHead("A QUESTION", barsWords(item.from, item.to))}
          <Question
            question={questions[item.index!]!}
            count={item.index! + 1}
            of={questions.length}
            onAnswer={(text) => {
              answer(item.index!, text);
              closeInspector();
            }}
            onSkip={() => {
              setSkipped([...skipped, item.index!]);
              closeInspector();
            }}
            onShow={onShow}
          />
        </>
      )}
      {item?.kind === "missing" && (
        <>
          {inspectorHead("COULD ADD", barsWords(item.from, item.to))}
          <p className="arrange-said">{sentences(item.detail)}</p>
          {item.why && <p className="spark-note">{sentences(item.why)}</p>}
          <span className="arrange-actions">
            <button
              className="button small"
              onClick={() => {
                setWriteWords((now) => [now.trim(), `${sentences(item.detail)} (${barsWords(item.from, item.to).toLowerCase()})`].filter(Boolean).join(" "));
                closeInspector();
              }}
            >
              Add this to my direction
            </button>
            <button className="button small" onClick={() => playhead.play()}>
              Play these bars
            </button>
          </span>
          <p className="spark-note">A suggestion from Muse Spark, not a mistake. Your direction is where it would be asked for.</p>
        </>
      )}
      {item?.kind === "unfinished" && (
        <>
          {inspectorHead("DIDN'T FINISH", barsWords(item.from, item.to))}
          <p className="arrange-said">{item.detail}</p>
          {action(<button className="button primary arrange-go" disabled={busy} onClick={() => write(item.index!, "arrange")}>
            Write what's missing
          </button>)}
        </>
      )}
    </div>
  );

  return (
    <div className="reading arrange">
      {steps}
      {inspector}

      {!inspector && current === 1 && !arranged.tracksConfirmed && (
        <>
          <h2 className="arrange-title">What is each track?</h2>
          <ul className="arrange-tracks">
            {lines.map((line) => {
              const guess = guessOf(line);
              return <TrackChoice key={line} line={line} value={tracks[line] ?? ""} doubt={!instrumentFromName(line) && !!guess && !guess.sure} why={guess?.why} onChange={(value) => setTrack(line, value)} />;
            })}
          </ul>
          <p className="spark-note">{lines.some((line) => !instrumentFromName(line) && !!guessOf(line) && !guessOf(line)!.sure) ? "Check the highlighted names. Muse Spark is unsure of those instruments." : "These names come from your score. Change any that are wrong."}</p>
          {action(<button className="button primary arrange-go" onClick={() => { arranged.confirmTracks(); onNavigate?.(); }}>
            Confirm tracks
          </button>)}
        </>
      )}

      {!inspector && current === 1 &&
        arranged.tracksConfirmed &&
        (nextQuestion >= 0 ? (
          <Question key={nextQuestion} question={questions[nextQuestion]!} count={nextQuestion + 1} of={questions.length} onAnswer={(text) => answer(nextQuestion, text)} onSkip={() => setSkipped([...skipped, nextQuestion])} onShow={onShow} />
        ) : (
          <>
            <h2 className="arrange-title">What I hear</h2>
            <p className="arrange-said">{reading.summary}</p>
            {study.status === "ready" ? (
              <>
                <StudyMap answer={study.answer} written={study.written} onBar={(bar) => arranged.select(bar)} />
                <More title="Phrases and harmonic details"><StudyWords answer={study.answer} written={study.written} /></More>
              </>
            ) : study.status === "asking" ? (
              <p className="spark-note">Studying the form and the harmony. This takes a minute or two, and it goes on the score when it's done.</p>
            ) : study.status === "unavailable" ? (
              <><p className="spark-note">The harmony analysis did not come back. Your score and answers are still here.</p><button className="button small" disabled={busy} onClick={() => void arranged.askStudy()}>Retry harmony analysis</button></>
            ) : null}
            {reading.missing.length > 0 && <p className="spark-note">Ideas you can develop</p>}
            <ul className="arrange-lines">
              {reading.missing.map((m) => (
                <li key={`${m.from}-${m.what}`}>{place(m.from, m.to, sentences(m.what), m.why)}</li>
              ))}
            </ul>
            {reading.thin.length > 0 && (
              <More title="Doublings you could drop">
                <ul className="arrange-lines">
                  {reading.thin.map((t) => (
                    <li key={`${t.line}-${t.from}`}>{place(t.from, t.to, sentences(t.line), t.why)}</li>
                  ))}
                </ul>
              </More>
            )}
            {structures.length > 0 && <p className="spark-note">You can also preview a different order of your sections below.</p>}
            <More title="Change the section order" open={handOrder.length > 0}>
              <p className="spark-note">A section is a group of bars, such as your opening or a returning tune. Try a different order without writing new notes. Preview it, then keep it or return to the original.</p>
              {arranged.orders.length > 1 && <Orders orders={arranged.orders} ordered={trying?.kind === "structure" ? trying.index : null} onOrder={(index) => setTrying(index === null ? null : { kind: "structure", index })} onKeep={keep} bare/>}
              <h3 className="setup-head">Choose your own sequence of bars</h3>
              {timed &&
                (fitting === "asking" ? (
                  <p className="arrange-said">Fitting your bars to the timing. This takes about a minute.</p>
                ) : (
                  <>
                    <button className="button small" disabled={busy} onClick={() => void askFit(fitWords)}>
                      Fit my bars to the timing
                    </button>
                    <textarea className="arrange-box" rows={2} maxLength={400} aria-label="Anything else about the timing" value={fitWords} onChange={(e) => setFitWords(e.target.value)} />
                    {fitting === "unavailable" && <p className="arrange-said">Muse Spark can't answer here.</p>}
                  </>
                ))}
              <ol className="arrange-order">
                {handOrder.map((stretch, k) => {
                  const change = (next: Partial<Stretch>) => setHandOrder(handOrder.map((s, i) => (i === k ? { ...s, ...next } : s)));
                  const swap = (j: number) => setHandOrder(handOrder.map((s, i) => (i === k ? handOrder[j]! : i === j ? stretch : s)));
                  return (
                    <li key={k}>
                      <label>
                        Bars
                        <input value={stretch.from} aria-label={`Stretch ${k + 1} from bar`} onChange={(e) => change({ from: e.target.value.trim() })} />
                      </label>
                      <label>
                        to
                        <input value={stretch.to} aria-label={`Stretch ${k + 1} to bar`} onChange={(e) => change({ to: e.target.value.trim() })} />
                      </label>
                      <button className="round small" aria-label={`Move stretch ${k + 1} up`} disabled={k === 0} onClick={() => swap(k - 1)}>
                        ↑
                      </button>
                      <button className="round small" aria-label={`Move stretch ${k + 1} down`} disabled={k === handOrder.length - 1} onClick={() => swap(k + 1)}>
                        ↓
                      </button>
                      <button className="round small" aria-label={`Remove stretch ${k + 1}`} onClick={() => setHandOrder(handOrder.filter((_, i) => i !== k))}>
                        ×
                      </button>
                    </li>
                  );
                })}
              </ol>
              <button className="button small" onClick={() => setHandOrder([...handOrder, { from: bars[0] ?? "1", to: bars[bars.length - 1] ?? "1" }])}>
                Add a bar range
              </button>
              {handOrder.length > 0 &&
                standing &&
                orderHits(cues, standing, handOrder, roles).map((sentence) => (
                  <p key={sentence} className="arrange-hit">
                    {sentence}
                  </p>
                ))}
              {handOrder.length > 0 && onScore("structure", -1)}
            </More>
            {next(2)}
          </>
        ))}

      {!inspector && current === 2 && (
        <>
          <h2 className="arrange-title">What should change?</h2>
          <p className="spark-note">Start with your piece as it is. Choose how far Motifold may go.</p>
          {arranged.recomposed && <button className="button small" onClick={startAgain}>Back to my sketch</button>}
          <div className="intent-choices" role="group" aria-label="Direction">
            {([
              ['arrange', 'Arrange', 'Keep this piece. Change its instruments or add a related counterline.'],
              ['expand', 'Expand', 'Develop this piece with connected new music and a longer ending.'],
              ['recompose', 'Recompose', 'Use my theme or motif to write a new piece.'],
            ] as const).map(([value, title, detail]) => <button key={value} className={`intent-choice${mode === value ? ' on' : ''}`} aria-pressed={mode === value} onClick={() => { setMode(value); if (value === 'arrange') setTuneOnly(false); }}><span className="intent-radio"/><span><strong>{title}</strong><small>{detail}</small></span></button>)}
          </div>
          {mode === 'arrange' && <div className="preserve-summary"><strong>Neutral. Keep my music as it is.</strong><span>Your notes, harmony, metre, timing and section order stay. Any counterline grows from your own musical material.</span></div>}
          {mode === 'recompose' && <More title="How much of my theme stays" open><div className="freedom" role="group" aria-label="How far from your tune"><span className="freedom-stops">{FREEDOMS.map(([name], index) => <button key={name} className={`freedom-stop${freedom === index + 1 ? ' on' : ''}`} aria-pressed={freedom === index + 1} onClick={() => setFreedom(index + 1)}>{name}</button>)}</span><p className="spark-note">{FREEDOMS[freedom - 1]![1]}</p></div></More>}
          <label className="setup-select"><span>Players</span><select aria-label="Ensemble" value={keepTracks && mode !== 'recompose' ? 'current' : template ?? 'custom'} onChange={(event) => { const value = event.target.value; setKeepTracks(value === 'current'); const selected = TEMPLATES.find((item) => item.name === value); if (selected) { setTemplate(selected.name); setPicked(selected.instruments); } else if (value === 'custom') setTemplate(null); }}>
            {mode !== 'recompose' && <option value="current">Keep my current instruments</option>}
            {TEMPLATES.filter((item) => !demo || item.name === 'Full orchestra').map((item) => <option key={item.name}>{item.name}</option>)}<option value="custom">Choose individual instruments</option>
          </select></label>
          {(template === null) && <More title="Choose individual instruments" open={template === null}><span className="arrange-chips" role="group" aria-label="Your instruments">{inScoreOrder([...new Set([...PICKABLE, ...picked])]).map((name) => <button key={name} className={`chip-button small${picked.includes(name) ? ' on' : ''}`} aria-pressed={picked.includes(name)} onClick={() => { setKeepTracks(false); setTemplate(null); setPicked((now) => now.includes(name) ? now.filter((item) => item !== name) : [...now, name]); }}>{name}</button>)}</span><form className="arrange-own" onSubmit={(event) => { event.preventDefault(); const name = ownInstrument.trim(); if (name && !picked.includes(name)) { setPicked((now) => [...now, name]); setKeepTracks(false); } setOwnInstrument(''); }}><input maxLength={40} aria-label="Another instrument" placeholder="Another instrument" value={ownInstrument} onChange={(event) => setOwnInstrument(event.target.value)}/><button className="button small">Add</button></form></More>}
          {mode !== 'arrange' && <More title="Mood" open><p className="spark-note">Neutral keeps the character of your source. A mood is an optional new direction.</p><span className="arrange-chips" role="group" aria-label="Mood"><button className={`chip-button${!mood ? ' on' : ''}`} aria-pressed={!mood} onClick={() => setMood(null)}>Neutral</button>{moodsHere.filter((item) => demo || SUGGESTED_MOODS.includes(item) || item === mood).map((item) => <button key={item} className={`chip-button${mood === item ? ' on' : ''}`} aria-pressed={mood === item} onClick={() => setMood(item)}>{item}</button>)}</span><More title="More moods"><span className="arrange-chips">{moodsHere.filter((item) => !SUGGESTED_MOODS.includes(item)).map((item) => <button key={item} className="chip-button small" onClick={() => setMood(item)}>{item}</button>)}</span></More></More>}
          <label className="setup-direction"><span>Your direction <small>optional</small></span><textarea className="arrange-box" rows={3} maxLength={360} aria-label="What you want, or what inspired it" value={writeWords} placeholder={mode === 'arrange' ? 'Let the viola answer the tune. Keep my harmony and the quiet character.' : 'Describe what should develop, what should stay, or the feeling you want.'} onChange={(event) => setWriteWords(event.target.value)}/></label>
          {mode !== 'arrange' && <More title={mode === 'recompose' ? 'Length of the new piece' : 'Where to expand'} open>{mode === 'recompose' ? <label className="arrange-inline">Total bars<input type="number" min={8} max={64} value={length} onChange={(event) => setLength(Math.max(8, Math.min(64, Math.round(Number(event.target.value)) || 8)))}/></label> : <><span className="arrange-chips" role="group" aria-label="What to write">{([['after','Continue after the ending'],['both','Develop the piece and continue'],['inside','Develop within existing bars']] as const).map(([value,label]) => <button key={value} className={`chip-button${where === value ? ' on' : ''}`} aria-pressed={where === value} onClick={() => setWhere(value)}>{label}</button>)}</span>{reachesEnd && where !== 'inside' && <label className="arrange-inline">Added bars<input type="number" min={1} max={32} value={moreBars} onChange={(event) => setMoreBars(Math.max(1, Math.min(32, Math.round(Number(event.target.value)) || 1)))}/></label>}</>}</More>}
          <More title="Advanced musical controls">
            {mode === 'expand' && <label className="arrange-check"><input type="checkbox" disabled={keepTracks} checked={tuneOnly} onChange={(event) => setTuneOnly(event.target.checked)}/>Use only my melody as the source and write its accompaniment again</label>}{mode === "expand" && keepTracks && <p className="spark-note">Choose a new ensemble above to rewrite the accompaniment. Keeping your current instruments preserves all of your tracks.</p>}
            {mode !== 'recompose' && <label className="arrange-check"><input type="checkbox" checked={keepTracks} onChange={(event) => setKeepTracks(event.target.checked)}/>Keep my own tracks as they are, and only add new parts</label>}
            <label className="setup-direction"><span>Instrument placement</span><textarea className="arrange-box" rows={2} maxLength={400} aria-label="How you want it laid out" value={placeWords} placeholder="Violas carry the tune first. Bring the violins in later." onChange={(event) => setPlaceWords(event.target.value)}/></label>
            <More title="Timing for a scene" open={cues.length > 0}><p className="spark-note">Add a moment the music should meet. A moment beyond your current ending needs Expand.</p><Moments arranged={arranged}/></More>
          </More>
          {action(<div><p className="action-summary">{mode === 'arrange' ? 'Arrange / Neutral / All source notes kept' : mode === 'expand' ? `Expand / ${mood ?? 'Neutral'}` : `Recompose / ${FREEDOMS[freedom - 1]![0]} / ${mood ?? 'Neutral'}`}<br/>{keepTracks && mode !== 'recompose' ? 'Current instruments' : template ?? `${chosen.length} players`}</p><button className="button primary arrange-go" disabled={busy || (mode !== 'recompose' && !keepTracks && chosen.length === 0)} onClick={create}>Create</button></div>)}
          <p className="spark-note">{mode === 'recompose' ? 'First compare two musical plans. Notes are written after you choose.' : 'Compare two plans and their first sections. Then choose which one to finish.'}</p>
        </>
      )}

      {!inspector && current === 3 && (
        <>
          <h2 className="arrange-title">{comparisonHosted && chosenPlan !== null ? (mode === "recompose" && arranged.recompose.status === "ready" ? arranged.recompose.plans[chosenPlan]?.name : options.status === "ready" ? options.plans[chosenPlan]?.name : null) ?? "Your choice" : mode === "recompose" ? "Two new pieces" : "Two ways to go"}</h2>
          <p className="spark-note">
            {mode === "recompose" ? `Recompose, ${FREEDOMS[freedom - 1]![0].toLowerCase()}` : mode === "expand" ? "Expand" : "Arrange"}
            {mode !== "arrange" && mood ? `, ${mood.toLowerCase()}` : mode === "arrange" ? ", neutral" : ""}
            {keepTracks && mode !== "recompose" ? ", current instruments" : template ? `, ${template.toLowerCase()}` : ""}
            {writeWords.trim() ? `: "${writeWords.trim().slice(0, 80)}${writeWords.trim().length > 80 ? "…" : ""}"` : ""}.{" "}
            <button className="arrange-quiet inline" onClick={() => setStep(2)}>
              Change the setup
            </button>
          </p>
          {mode !== "recompose" && (!comparisonHosted || options.status !== "ready") && (
            <ol className="create-steps" aria-label="What Create does">
              {!keepTracks && <li className={stateOf(placed.status)}>Lay your notes on the players</li>}
              <li className={stateOf(options.status)}>Plan two ways to go</li>
              {!demo && <li className={previewState}>Write the first section of both</li>}
            </ol>
          )}
          {mode === "recompose" && arranged.recompose.status === "asking" && <p className="arrange-said">Composing two new pieces from your motif. This takes a minute or two.</p>}
          {placed.status === "unavailable" && (
            <>
              <p className="arrange-said">Muse Spark couldn't lay out your notes this time, so they haven't moved.</p>
              <span className="arrange-actions">
                <button className="button small" disabled={busy} onClick={create}>
                  Try again
                </button>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => {
                    setKeepTracks(true);
                    createRecipe.current = { words: askedWords(), moreBars: mode === "arrange" ? 0 : moreBars, where: mode === "arrange" ? "inside" : where, intent: mode === "expand" ? "expand" : "arrange", placedBefore: placed, optionsBefore: options };
                    setCreating("plan");
                    void askOptions(askedWords(), mode === "arrange" ? 0 : moreBars, mode === "arrange" ? "inside" : where, mode === "expand" ? "expand" : "arrange");
                  }}
                >
                  Carry on with my tracks as they are
                </button>
              </span>
            </>
          )}
          {placed.status === "ready" && (
            <More title={`Laid out: ${placed.answer.idea.slice(0, 60)}${placed.answer.idea.length > 60 ? "…" : ""}`}>
              <p className="arrange-said">{sentences(placed.answer.idea)}</p>
              <p className="spark-note">{placedWords(placed.check, !placed.saved || sameChoice(placed))[0]}</p>
              {placed.saved && <p className="spark-note">{sameChoice(placed) ? "A saved answer, made for these instruments." : `A saved answer, made for ${placed.instruments.length} instruments of its own and not the ones you picked, because Muse Spark can't be asked from here.`}</p>}
              {placedWords(placed.check).length > 1 && (
                <More title="To check">
                  {placedWords(placed.check).slice(1).map((sentence) => (
                    <p key={sentence} className="spark-note">
                      {sentence}
                    </p>
                  ))}
                  {placed.check.together.length > 0 && (
                    <button className="button small" onClick={splitPlaced}>
                      Split those into single lines
                    </button>
                  )}
                </More>
              )}
              <More title="Delete a part">
                <span className="arrange-chips" role="group" aria-label="Parts on the score">
                  {allParts.map((p) => (
                    <button key={p.id} className={`chip-button small${gone.includes(p.id) ? "" : " on"}`} aria-pressed={!gone.includes(p.id)} onClick={() => toggleGone(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </span>
              </More>
            </More>
          )}
          {(options.status === "unavailable" || arranged.recompose.status === "unavailable") && (
            <>
              <p className="arrange-said">{demo ? "That one isn't prepared. It runs live with your own key." : "Muse Spark can't answer right now. Today's shared credit may have run out, and your own key will still work."}</p>
              <button className="button small" disabled={busy} onClick={generate}>
                Try again
              </button>
            </>
          )}
          {((mode === "recompose" && arranged.recompose.status === "ready") || (mode !== "recompose" && options.status === "ready")) && !arranged.recomposed && <p className="spark-note">Choose A or B above the score. Audition its first section, change its chords here, then write the rest.</p>}
          {mode === "recompose" && arranged.recompose.status === "ready" && !arranged.recomposed && (
            <ul className="arrange-list">
              {arranged.recompose.plans.map((plan, index) => comparisonHosted && chosenPlan !== index ? null : (
                <li key={plan.name} className={chosenPlan === index ? "on" : undefined}>
                  {!comparisonHosted && <strong>{plan.name}</strong>}
                  <span className="card-text">{sentences(plan.idea)} {plan.time}, {plan.qpm} a minute.</span>
                  <span className="spark-note">Motif from bars {plan.motif.from} to {plan.motif.to}: {plan.motif.what}</span>
                  {action(<button className="button small primary arrange-pick" disabled={busy} onClick={() => write(index, "recompose")}>
                    Write this one
                  </button>)}
                </li>
              ))}
            </ul>
          )}
          {mode !== "recompose" && options.status === "ready" && !arranged.recomposed && (
            <ul className="arrange-list">
              {options.plans.map((plan, index) => {
                if (comparisonHosted && chosenPlan !== index) return null;
                const these = options.notes[index];
                return (
                  <li key={plan.name} className={chosenPlan === index ? "on" : undefined}>
                    {!comparisonHosted && <strong>{plan.name}</strong>}
                    <span className="card-text">{sentences(plan.idea)}</span>
                    <More title="Why">
                      <ul className="arrange-lines">
                        {plan.why.map((w) => (
                          <li key={`${w.from}-${w.what}`}>
                            {place(w.from, w.to, sentences(w.what), w.principle)}
                            {(w.chords || w.dynamics) && <span className="arrange-chords">{[w.chords, w.dynamics].filter(Boolean).join(" · ")}</span>}
                          </li>
                        ))}
                      </ul>
                    </More>
                    {!demo && plan.why.some((w) => w.chords !== undefined) && (
                      <div className="arrange-chord-edit">
                        <span className="spark-note">The chords, bar by bar. Change any of them and the notes are written from yours.</span>
                        {plan.why.map((w, k) =>
                          w.chords === undefined ? null : (
                            <label key={`${w.from}-${k}`}>
                              <span>{barsWords(w.from, w.to)}</span>
                              <input value={w.chords} maxLength={400} spellCheck={false} disabled={busy || these?.status === "asking" || (these?.status === "ready" && !!these.writing)} aria-label={`Chords for ${barsWords(w.from, w.to).toLowerCase()}`} onChange={(e) => arranged.setChords(index, k, e.target.value)} />
                            </label>
                          ),
                        )}
                      </div>
                    )}
                    {these?.status === "ready" && these.preview && !these.changed && !these.writing ? (
                      <>{action(<button className="button small primary" disabled={busy} onClick={() => write(index, "arrange")}>
                        Write the rest of this one
                      </button>)}</>
                    ) : these?.status === "ready" && these.changed && !these.writing ? (
                      <>{action(<button className="button small primary" disabled={busy} onClick={() => write(index, "arrange")}>
                        Write again with these chords
                      </button>)}</>
                    ) : these?.status === "asking" ? (
                      <span className="arrange-said">Writing its first section.</span>
                    ) : these?.status === "ready" ? (
                      <>{action(<button
                        className="button small"
                        onClick={() => {
                          setPick(index);
                          if (these.status === "ready") setTrying({ kind: "option", index });
                          go(4);
                        }}
                      >
                        See what's written
                      </button>)}</>
                    ) : (
                      <>{action(<button className="button small primary arrange-pick" disabled={busy} onClick={() => write(index, "arrange")}>
                        Write this one
                      </button>)}</>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {((mode === "recompose" && arranged.recompose.status === "ready") || (mode !== "recompose" && options.status === "ready")) && !creating && (
            <button className="arrange-quiet" disabled={busy} onClick={generate}>
              Think of two more
            </button>
          )}
        </>
      )}

      {!inspector && current === 4 && o && (
        <>
          <h2 className="arrange-title">{o.name}</h2>
          <p className="card-text">{sentences(o.idea)}</p>
          {arranged.recomposed && (
            <p className="spark-note">
              Motif from your bars {arranged.recomposed.plan.motif.from} to {arranged.recomposed.plan.motif.to}: {arranged.recomposed.plan.motif.what}
              {arranged.recomposed.tuneBars > 0 && ` Its tune runs through ${arranged.recomposed.tuneBars} of ${arranged.recomposed.bars} bars.`}
              {arranged.motifFound && arranged.openingFound && ` Measured in what's written, the shape of your opening comes back ${arranged.openingFound.same} times as it was and ${arranged.openingFound.inverted} upside down, and the motif's ${arranged.motifFound.same} and ${arranged.motifFound.inverted}.`}
            </p>
          )}
          {(!notes || notes.status === "asking") && <p className="arrange-said">Writing the notes. This takes a minute or two.</p>}
          {notes?.status === "unfinished" && <p className="arrange-said">It didn't finish this one. Try again, or use fewer instruments or fewer new bars.</p>}
          {notes?.status === "unavailable" && <p className="arrange-said">Muse Spark can't answer here.</p>}
          {(notes?.status === "unfinished" || notes?.status === "unavailable") && (
            <button className="button small primary" disabled={busy} onClick={() => write(shownAt!, "arrange")}>
              Try again
            </button>
          )}
          {notes?.status === "ready" && notes.writing && <p className="arrange-said">Writing {barsWords(notes.writing.from, notes.writing.to).toLowerCase()}, section {notes.writing.done + 1} of {notes.writing.of}.</p>}
          {done && notes.preview && (
            <>
              <p className="arrange-said">A preview of the first section. The rest is written when you choose this plan.</p>
              {action(<button className="button primary arrange-go" disabled={busy} onClick={() => write(shownAt!, "arrange")}>
                Write the rest
              </button>)}
            </>
          )}
          {done && !notes.preview && !!notes.missing?.length && (
            <>
              <p className="arrange-hit">{notes.missing.map((m) => barsWords(m.from, m.to)).join(", ")} didn't finish.</p>
              <button className="button small" disabled={busy} onClick={() => write(shownAt!, "arrange")}>
                Write what's missing
              </button>
            </>
          )}
          {notes?.status === "ready" && left && (
            <>
              <p className="spark-note">{notes.check.notes && !left.notes ? "All of it is left out." : checkWords(left)[0]}</p>
              {options.status === "ready" &&
                planGaps(o.why, notes.check, options.input).map((gap) => (
                  <p key={gap.from} className="arrange-hit">
                    No new notes came back for {barsWords(gap.from, gap.to).toLowerCase()}. If the plan wanted something there, ask again or say what you want.
                  </p>
                ))}
              {onPage && offBars.length > 0 && (
                <button className="arrange-quiet" onClick={putBackBars}>
                  Put back all {offBars.length} {offBars.length === 1 ? "bar" : "bars"} left out
                </button>
              )}
              {cueHits(standing ? placeCues(cues, standing) : [], left).map((sentence) => (
                <p key={sentence} className="arrange-hit">
                  {sentence}
                </p>
              ))}
              {checkWords(left).length > 1 && (
                <More title="To check">
                  {checkWords(left).slice(1).map((sentence) => (
                    <p key={sentence} className="spark-note">
                      {sentence}
                    </p>
                  ))}
                </More>
              )}
              {onPage && (
                <More title="Leave out a part">
                  <span className="arrange-chips" role="group" aria-label="Which new parts to keep">
                    {[...new Set(notes.check.adds.map((a) => a.part))].map((name) => (
                      <button key={name} className={`chip-button small${off.includes(name) ? "" : " on"}`} aria-pressed={!off.includes(name)} onClick={() => togglePart(name)}>
                        {name}
                      </button>
                    ))}
                  </span>
                </More>
              )}
              {done && arranged.view && (
                <More title={`Fix bars ${arranged.view.from} to ${arranged.view.to}`}>
                  <p className="spark-note">Drag across the picture to choose bars. Taking out a part or some bars is free, and rewriting them is one more call.</p>
                  <textarea className="arrange-box" rows={2} maxLength={400} aria-label="What to change in these bars" value={fixWords} placeholder="Thinner here, and let the horns answer the tune." onChange={(e) => setFixWords(e.target.value)} />
                  <button className="button small" disabled={busy || !fixWords.trim()} onClick={() => void arranged.askFix(shownAt!, arranged.view!.from, arranged.view!.to, fixWords.trim())}>
                    Rewrite these bars
                  </button>
                  {arranged.fixing === "unavailable" && <p className="arrange-said">That didn't come back, so these bars are as they were.</p>}
                </More>
              )}
            </>
          )}
          {done && !notes.preview && next(5)}
          <button className="arrange-quiet" onClick={() => setStep(3)}>
            Choose another plan
          </button>
        </>
      )}

      <p className="spark-note">{saved || (options.status === "ready" && options.saved) ? "A saved answer from Muse Spark, made before you asked, so your words and moments aren't in it." : "A draft from Muse Spark."} Check it by ear.</p>
    </div>
  );
}
