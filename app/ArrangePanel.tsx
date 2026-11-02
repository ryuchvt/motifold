import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ArrangeInput, PieceReading } from "../server/shapes";
import { checkWords, placedWords, planGaps, sentences } from "./arrange";
import { cueHits, cueWords, orderHits, parseTime, placeCues } from "./cues";
import { inScoreOrder, instrumentFromName, PICKABLE, TEMPLATES, TRACK_CHOICES } from "./orchestra";
import type { Arranged, Stretch } from "./useArrange";

const orderWords = (order: Stretch[]) => order.map((o, k) => (k ? barsWords(o.from, o.to).toLowerCase() : barsWords(o.from, o.to))).join(", then ");
const barsWords = (from: string, to: string) => (from === to ? `Bar ${from}` : `Bars ${from} to ${to}`);
const STEPS = ["Tracks", "Questions", "Players", "Direction", "Form"];

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

/** Moods to start from. Words of their own go in the box beside these. */
const MOODS = ["Sad", "Tender", "Hopeful", "Dreamy", "Pastoral", "Wonder", "Storybook", "Playful", "Heroic", "Epic", "Pulse", "Action", "Tense", "Dark"];

/** Whether a saved answer happens to be for the instruments the composer picked. */
const sameChoice = (placed: { instruments: string[]; chosen: string[] }) => [...placed.instruments].sort().join("|") === [...placed.chosen].sort().join("|");

export function ArrangePanel({ arranged, busy, demo = false, prepared = [] }: { arranged: Arranged; busy: boolean; demo?: boolean; prepared?: { key: string; mode: "arrange" | "recompose"; mood: string }[] }) {
  const { piece, chords, splitting, toggleSplit, splitAll, tracks, setTrack, answered, answer, placed, options, trying, setTrying, off, togglePart, offBars, putBackBars, remaining, allParts, gone, toggleGone, handOrder, setHandOrder, bars, cues, roles, standing, structures, fitting, askFit, kept, askPiece, askPlaced, splitPlaced, askOptions, askNotes, keep, startAgain, download, reachesEnd, wholeScore, selectRange } = arranged;
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [template, setTemplate] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ownInstrument, setOwnInstrument] = useState("");
  const [placeWords, setPlaceWords] = useState("");
  const [writeWords, setWriteWords] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  /** Stay with the composer's melody, or take it as a motif (Ryu, 11-02). */
  const [mode, setMode] = useState<"arrange" | "recompose">("arrange");
  const [length, setLength] = useState(32);
  const [autoWrite, setAutoWrite] = useState(false);
  const [fixWords, setFixWords] = useState("");
  // One press goes all the way from a mood to notes, so a plan doesn't wait for a second press.
  useEffect(() => {
    if (!autoWrite) return;
    if (arranged.options.status === "ready" && !arranged.options.notes[0]) {
      setAutoWrite(false);
      void arranged.askNotes(0);
    } else if (arranged.recompose.status === "ready" && !arranged.recomposed) {
      setAutoWrite(false);
      void arranged.writeRecomposed(0);
    } else if (arranged.options.status === "unavailable" || arranged.recompose.status === "unavailable") setAutoWrite(false);
  }, [autoWrite, arranged.options.status, arranged.recompose.status]);
  const moodsHere = demo ? MOODS.filter((m) => prepared.some((p) => p.mode === mode && p.mood === m.toLowerCase())) : MOODS;
  const askedWords = () => [mood ? `The mood I want: ${mood.toLowerCase()}.` : "", writeWords.trim()].filter(Boolean).join(" ");
  const generate = () => {
    setAutoWrite(true);
    if (mode === "arrange") void askOptions(askedWords(), moreBars, where);
    else void arranged.askRecompose(askedWords(), length, chosen.length ? chosen : TEMPLATES.find((t) => t.name === "Full orchestra")!.instruments);
  };  const [fitWords, setFitWords] = useState("");
  const [moreBars, setMoreBars] = useState(8);
  const [where, setWhere] = useState<ArrangeInput["where"]>("both");

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
        <button className="button small primary" onClick={keep}>
          Keep it
        </button>
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
  const footer = (
    <footer className="arrange-foot">
      <span className="arrange-actions">
        <button className="button small" onClick={download}>
          Download MIDI
        </button>
        {kept && (
          <button className="button small" onClick={startAgain}>
            Back to my score
          </button>
        )}
      </span>
    </footer>
  );

  if (piece.status === "none") {
    return (
      <div className="reading arrange">
        {kept && <p className="arrange-said">That's your score now.</p>}
        <button
          className="button primary arrange-go"
          disabled={busy}
          onClick={() => {
            setStep(1);
            void askPiece();
          }}
        >
          {kept ? "Read it again" : "Read my score"}
        </button>
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
        {kept && footer}
      </div>
    );
  }
  if (piece.status === "asking") return <p className="arrange-said">Reading every part. This takes about a minute.</p>;
  if (piece.status === "unavailable")
    return (
      <div className="reading arrange">
        <p className="arrange-said">Muse Spark can't answer here.</p>
        <button className="button small" disabled={busy} onClick={() => void askPiece()}>
          Try again
        </button>
      </div>
    );

  const { answer: reading, lines, saved } = piece;
  const guessOf = (line: string) => reading.tracks?.find((t) => t.line === line);
  const chosen = inScoreOrder(picked);
  const questions = reading.questions ?? [];
  const nextQuestion = questions.findIndex((_, k) => !answered[k]?.trim() && !skipped.includes(k));
  const current = step || 1;
  const timed = cues.some((c) => c.beats !== undefined || parseTime(c.time) !== null);

  return (
    <div className="reading arrange">
      <ol className="arrange-steps" aria-label="Steps">
        {STEPS.map((name, k) => (
          <li key={name}>
            <button className={current === k + 1 ? "on" : undefined} aria-current={current === k + 1 ? "step" : undefined} onClick={() => setStep(k + 1)}>
              {name}
            </button>
          </li>
        ))}
      </ol>

      {current === 1 && (
        <>
          <h2 className="arrange-title">What is each track?</h2>
          <ul className="arrange-tracks">
            {lines.map((line) => {
              const guess = guessOf(line);
              return <TrackChoice key={line} line={line} value={tracks[line] ?? ""} doubt={!instrumentFromName(line) && !!guess && !guess.sure} why={guess?.why} onChange={(value) => setTrack(line, value)} />;
            })}
          </ul>
          <p className="spark-note">These are guesses. The orange ones it isn't sure of.</p>
          <button className="button primary arrange-go" onClick={() => setStep(2)}>
            Looks right
          </button>
        </>
      )}

      {current === 2 &&
        (nextQuestion >= 0 ? (
          <Question key={nextQuestion} question={questions[nextQuestion]!} count={nextQuestion + 1} of={questions.length} onAnswer={(text) => answer(nextQuestion, text)} onSkip={() => setSkipped([...skipped, nextQuestion])} onShow={onShow} />
        ) : (
          <>
            <h2 className="arrange-title">What's missing</h2>
            <p className="arrange-said">{reading.summary}</p>
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
            <button className="button primary arrange-go" onClick={() => setStep(3)}>
              Who plays it?
            </button>
          </>
        ))}

      {current === 3 && (
        <>
          <h2 className="arrange-title">Who plays it?</h2>
          <span className="arrange-chips" role="group" aria-label="Templates">
            {TEMPLATES.filter((t) => !demo || t.name === "Full orchestra").map((t) => (
              <button
                key={t.name}
                className={`chip-button${template === t.name ? " on" : ""}`}
                aria-pressed={template === t.name}
                onClick={() => {
                  setTemplate(t.name);
                  setPicked(t.instruments);
                }}
              >
                {t.name}
              </button>
            ))}
          </span>
          {demo && <p className="spark-note">This demo was prepared for a full orchestra. Any other players run live with your own key.</p>}
          {!demo && <More title="Pick my own">
            <span className="arrange-chips" role="group" aria-label="Your instruments">
              {inScoreOrder([...new Set([...PICKABLE, ...picked])]).map((name) => (
                <button
                  key={name}
                  className={`chip-button small${picked.includes(name) ? " on" : ""}`}
                  aria-pressed={picked.includes(name)}
                  onClick={() => {
                    setTemplate(null);
                    setPicked((now) => (now.includes(name) ? now.filter((p) => p !== name) : [...now, name]));
                  }}
                >
                  {name}
                </button>
              ))}
            </span>
            <form
              className="arrange-own"
              onSubmit={(e) => {
                e.preventDefault();
                const name = ownInstrument.trim();
                if (name && !picked.includes(name)) setPicked((now) => [...now, name]);
                setOwnInstrument("");
              }}
            >
              <input maxLength={40} aria-label="Another instrument" placeholder="Another instrument" value={ownInstrument} onChange={(e) => setOwnInstrument(e.target.value)} />
              <button className="button small">Add</button>
            </form>
          </More>}
          <More title="Say how">
            <textarea className="arrange-box" rows={2} maxLength={400} aria-label="How you want it laid out" value={placeWords} placeholder="Violas have the tune first, and hold the violins back." onChange={(e) => setPlaceWords(e.target.value)} />
          </More>
          {placed.status === "asking" ? (
            <p className="arrange-said">Choosing who plays what. This takes a minute or two.</p>
          ) : (
            <>
              <button className={`button arrange-go${placed.status === "ready" ? "" : " primary"}`} disabled={busy || chosen.length === 0} onClick={() => void askPlaced(chosen, placeWords)}>
                {placed.status === "ready" ? "Lay it out again" : "Put my notes on these"}
              </button>
              {placed.status !== "ready" && (
                <button className="arrange-quiet" onClick={() => setStep(4)}>
                  Keep my tracks as they are
                </button>
              )}
            </>
          )}
          {placed.status === "unavailable" && <p className="arrange-said">Muse Spark can't answer here, so your notes haven't moved.</p>}
          {placed.status === "ready" && (
            <>
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
              <button className="button primary arrange-go" onClick={() => setStep(4)}>
                Next
              </button>
            </>
          )}
        </>
      )}

      {current === 4 && (
        <>
          <h2 className="arrange-title">Where should it go?</h2>
          {arranged.recomposed && (
            <button className="button small" onClick={startAgain}>
              Back to my sketch
            </button>
          )}
          <div className="arrange-modes" role="group" aria-label="How free">
            <button className={`arrange-mode${mode === "arrange" ? " on" : ""}`} aria-pressed={mode === "arrange"} onClick={() => setMode("arrange")}>
              <strong>Arrange</strong>
              Keep my melody as it is. Expand it, add countermelodies and find what's missing.
            </button>
            <button className={`arrange-mode${mode === "recompose" ? " on" : ""}`} aria-pressed={mode === "recompose"} onClick={() => setMode("recompose")}>
              <strong>Recompose</strong>
              Take my melody as a motif and write a new piece from it, with its own key, metre and form.
            </button>
          </div>
          {mode === "recompose" ? (
            <label className="arrange-inline">
              Bars
              <input type="number" min={8} max={64} value={length} onChange={(e) => setLength(Math.max(8, Math.min(64, Math.round(Number(e.target.value)) || 8)))} />
            </label>
          ) : (
          <span className="arrange-chips" role="group" aria-label="What to write">
            {(
              [
                ["inside", "Over what's there"],
                ["after", "After the end"],
                ["both", "Both"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} className={`chip-button${where === value ? " on" : ""}`} aria-pressed={where === value} onClick={() => setWhere(value)}>
                {label}
              </button>
            ))}
          </span>
          )}
          {mode === "arrange" && reachesEnd && where !== "inside" && (
            <label className="arrange-inline">
              New bars
              <input type="number" min={1} max={32} value={moreBars} onChange={(e) => setMoreBars(Math.max(1, Math.min(32, Math.round(Number(e.target.value)) || 1)))} />
            </label>
          )}
          <More title="Timing, for picture" open={cues.length > 0}>
            <Moments arranged={arranged} />
          </More>
          <div className="arrange-moods">
            <p className="spark-note">{demo ? "The moods prepared for this demo. Any other mood, or your own words, runs live with your own key." : "The mood, if you have one. Words of your own go in the box below."}</p>
            <span className="arrange-chips" role="group" aria-label="Mood">
              {moodsHere.map((m) => (
                <button key={m} className={`chip-button${mood === m ? " on" : ""}`} aria-pressed={mood === m} onClick={() => setMood(mood === m ? null : m)}>
                  {m}
                </button>
              ))}
            </span>
          </div>
          <More title="Say what you want, or what inspired it">
            <textarea className="arrange-box" rows={2} maxLength={360} aria-label="What you want, or what inspired it" value={writeWords} placeholder="Rain on an empty street. Strings enter at bar 17, and end on E minor." onChange={(e) => setWriteWords(e.target.value)} />
          </More>
          {options.status === "asking" ? (
            <p className="arrange-said">Thinking of two ways to go. This takes a minute or two.</p>
          ) : (
            <>
              <button className="button primary arrange-go" disabled={busy || (demo && !mood)} onClick={generate}>
                Generate
              </button>
              <button className="arrange-quiet" onClick={() => setStep(5)}>
                Skip to the form
              </button>
            </>
          )}
          {(options.status === "unavailable" || arranged.recompose.status === "unavailable") && <p className="arrange-said">{demo ? "That one isn't prepared. It runs live with your own key." : "Muse Spark can't answer right now. Today's shared credit may have run out, and your own key will still work."}</p>}
          {arranged.recompose.status === "ready" && !arranged.recomposed && (
            <ul className="arrange-list">
              {arranged.recompose.plans.map((plan, index) => (
                <li key={plan.name}>
                  <strong>{plan.name}</strong>
                  <span className="card-text">{sentences(plan.idea)} {plan.time}, {plan.qpm} a minute.</span>
                  <span className="spark-note">Motif from bars {plan.motif.from} to {plan.motif.to}: {plan.motif.what}</span>
                  <button className="button small primary arrange-pick" disabled={busy} onClick={() => void arranged.writeRecomposed(index)}>
                    Write this one
                  </button>
                </li>
              ))}
            </ul>
          )}
          {arranged.recomposed && (
            <p className="spark-note">
              Motif from your bars {arranged.recomposed.plan.motif.from} to {arranged.recomposed.plan.motif.to}: {arranged.recomposed.plan.motif.what}
              {arranged.motifFound && ` Measured in what's written, its shape comes back ${arranged.motifFound.same} times as it was, ${arranged.motifFound.inverted} upside down and ${arranged.motifFound.backwards} backwards.`}
            </p>
          )}
          {options.status === "ready" && options.notes[0]?.status === "ready" && !options.notes[0].writing && arranged.view && (
            <More title={`Fix bars ${arranged.view.from} to ${arranged.view.to}`}>
              <p className="spark-note">Drag across the picture to choose bars. Taking out a part or some bars is free, and rewriting them is one more call.</p>
              <textarea className="arrange-box" rows={2} maxLength={400} aria-label="What to change in these bars" value={fixWords} placeholder="Thinner here, and let the horns answer the tune." onChange={(e) => setFixWords(e.target.value)} />
              <button className="button small" disabled={busy || !fixWords.trim()} onClick={() => void arranged.askFix(0, arranged.view!.from, arranged.view!.to, fixWords.trim())}>
                Rewrite these bars
              </button>
              {arranged.fixing === "unavailable" && <p className="arrange-said">That didn't come back, so these bars are as they were.</p>}
            </More>
          )}
          {options.status === "ready" && (
            <ul className="arrange-list">
              {options.plans.map((o, index) => {
                const notes = options.notes[index];
                const onPage = trying?.kind === "option" && trying.index === index;
                const left = notes?.status === "ready" && onPage ? remaining(notes.check) : notes?.status === "ready" ? notes.check : null;
                return (
                  <li key={o.name} className={onPage ? "on" : undefined}>
                    <strong>{o.name}</strong>
                    <span className="card-text">{sentences(o.idea)}</span>
                    <More title="Why">
                      <ul className="arrange-lines">
                        {o.why.map((w) => (
                          <li key={`${w.from}-${w.what}`}>
                            {place(w.from, w.to, sentences(w.what), w.principle)}
                            {(w.chords || w.dynamics) && <span className="arrange-chords">{[w.chords, w.dynamics].filter(Boolean).join(" · ")}</span>}
                          </li>
                        ))}
                      </ul>
                    </More>
                    {notes?.status === "asking" && <span className="arrange-said">Writing the notes. This takes a minute or two.</span>}
                    {notes?.status === "unfinished" && <span className="arrange-said">It didn't finish this one. Try again, or use fewer instruments or fewer new bars.</span>}
                    {notes?.status === "unavailable" && <span className="arrange-said">Muse Spark can't answer here.</span>}
                    {notes?.status !== "asking" && notes?.status !== "ready" && (
                      <button className="button small primary arrange-pick" disabled={busy} onClick={() => void askNotes(index)}>
                        Write this one
                      </button>
                    )}
                    {notes?.status === "ready" && notes.writing && <span className="arrange-said">Writing {barsWords(notes.writing.from, notes.writing.to).toLowerCase()}, section {notes.writing.done + 1} of {notes.writing.of}.</span>}
                    {notes?.status === "ready" && !notes.writing && !!notes.missing?.length && (
                      <>
                        <span className="arrange-hit">{notes.missing.map((m) => barsWords(m.from, m.to)).join(", ")} didn't finish.</span>
                        <button className="button small" disabled={busy} onClick={() => void askNotes(index)}>
                          Write what's missing
                        </button>
                      </>
                    )}
                    {notes?.status === "ready" && left && (
                      <>
                        {onScore("option", index)}
                        <span className="spark-note">{notes.check.notes && !left.notes ? "All of it is left out." : checkWords(left)[0]}</span>
                        {planGaps(o.why, notes.check, options.input).map((gap) => (
                          <span key={gap.from} className="arrange-hit">
                            No new notes came back for {barsWords(gap.from, gap.to).toLowerCase()}. If the plan wanted something there, ask again or say what you want.
                          </span>
                        ))}
                        {onPage && offBars.length > 0 && (
                          <button className="arrange-quiet" onClick={putBackBars}>
                            Put back all {offBars.length} {offBars.length === 1 ? "bar" : "bars"} left out
                          </button>
                        )}
                        {cueHits(standing ? placeCues(cues, standing) : [], left).map((sentence) => (
                          <span key={sentence} className="arrange-hit">
                            {sentence}
                          </span>
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
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {current === 5 && (
        <>
          <h2 className="arrange-title">Change the order?</h2>
          {timed &&
            (fitting === "asking" ? (
              <p className="arrange-said">Fitting your bars to the timing. This takes about a minute.</p>
            ) : (
              <>
                <button className="button primary arrange-go" disabled={busy} onClick={() => void askFit(fitWords)}>
                  Fit my bars to the timing
                </button>
                <More title="Say what you want">
                  <textarea className="arrange-box" rows={2} maxLength={400} aria-label="Anything else about the timing" value={fitWords} onChange={(e) => setFitWords(e.target.value)} />
                </More>
                {fitting === "unavailable" && <p className="arrange-said">Muse Spark can't answer here.</p>}
              </>
            ))}
          <ul className="arrange-list">
            {structures.map((s, index) => (
              <li key={`${s.name}-${index}`} className={trying?.kind === "structure" && trying.index === index ? "on" : undefined}>
                <strong>{s.name}</strong>
                <span className="card-text">{orderWords(s.order)}.</span>
                {standing &&
                  orderHits(cues, standing, s.order, roles).map((sentence) => (
                    <span key={sentence} className="arrange-hit">
                      {sentence}
                    </span>
                  ))}
                {onScore("structure", index)}
              </li>
            ))}
          </ul>
          <More title="Put my own together" open={handOrder.length > 0}>
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
              Add a stretch
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
        </>
      )}

      {footer}
      <p className="spark-note">{saved || (options.status === "ready" && options.saved) ? "A saved answer from Muse Spark, made before you asked, so your words and moments aren't in it." : "A draft from Muse Spark."} Check it by ear.</p>
    </div>
  );
}
