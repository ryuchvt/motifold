import { useEffect, useMemo, useRef, useState } from "react";
import type { ReadBarsAnswer, ReadBarsInput } from "../server/shapes";
import { askSpark } from "./spark";
import { attacksOf, barsInput, barsOf, mappedMidi, playedFromMidi, readWithinBars, type Attack, type Played, type Reading } from "./timing";
import { scoreOfReading } from "./timingScore";

type Ready = { status: "ready"; answer: ReadBarsAnswer; reading: Reading; saved: boolean; /** Reading it again didn't work, so this is still the last answer. */ stale?: boolean };
type State = { status: "none" } | { status: "asking" } | { status: "unavailable" } | Ready;

/** What the app keeps of a piece once its bars are settled, for the timing view. */
export interface FreePiece {
  played: Played;
  attacks: Attack[];
  reading: Reading;
  answer: ReadBarsAnswer;
  saved: boolean;
}

const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/** Its bars as the code reads them, or null when no path through the notes fits them, which is the same as having no answer. */
function settled(answer: ReadBarsAnswer, attacks: Attack[]): Reading | null {
  const reading = readWithinBars(attacks, answer.meter, answer.starts);
  return reading.place.every(Number.isFinite) ? reading : null;
}

/**
 * A file played without a click has notes and no bars that mean anything. This finds them before there's a score to read: Muse Spark says where they are from
 * what the code measured, and the composer decides. No note moves, in the score or in the MIDI that goes back.
 */
export function FreeBars(props: { auto?: boolean; fileName: string; bytes: Uint8Array; title: string; savedFile: string | null; onUse: (xmlText: string, piece: FreePiece) => void; onKeep: () => void }) {
  const { fileName, bytes, title, savedFile, onUse, onKeep } = props;
  const played = useMemo(() => playedFromMidi(bytes), [bytes]);
  const attacks = useMemo(() => attacksOf(played), [played]);
  /** Measured once, the first time it's asked for. */
  const measuredInput = useRef<ReadBarsInput | null>(null);
  const [measured, setMeasured] = useState<ReadBarsInput["readings"][number] | null>(null);
  const [state, setState] = useState<State>({ status: "none" });
  const [words, setWords] = useState("");
  const [question, setQuestion] = useState(0);
  const turn = useRef(0);
  useEffect(() => {
    turn.current++;
    measuredInput.current = null;
    setMeasured(null);
    setState({ status: "none" });
    setWords("");
    setQuestion(0);
  }, [bytes]);

  const ask = async (said: string | null) => {
    const now = ++turn.current;
    const before = state.status === "ready" ? state : null;
    setState({ status: "asking" });
    const input = (measuredInput.current ??= await barsInput(played, attacks));
    if (turn.current !== now) return;
    setMeasured(input.readings[0] ?? null);
    const asked = { ...input, ask: said };
    const reply = await askSpark("read_bars", asked);
    if (turn.current !== now) return;
    const ready = (answer: ReadBarsAnswer, saved: boolean): boolean => {
      const reading = settled(answer, attacks);
      if (reading) setState({ status: "ready", answer, reading, saved });
      return !!reading;
    };
    if (reply.status === "ok" && ready(reply.answer as ReadBarsAnswer, false)) return;
    let saved: { input?: Pick<ReadBarsInput, "attacks">; answer?: ReadBarsAnswer } | null = null;
    if (savedFile && reply.status !== "ok") {
      try {
        const res = await fetch(savedFile);
        if (res.ok) saved = await res.json();
      } catch {
        // Then there's nothing to show.
      }
      if (turn.current !== now) return;
    }
    // Only for the very notes it was made from.
    if (saved?.answer && JSON.stringify(saved.input?.attacks) === JSON.stringify(input.attacks) && ready(saved.answer, true)) return;
    // A failed second read doesn't take away the bars they already had.
    setState(before ? { ...before, stale: true } : { status: "unavailable" });
  };

  const download = (reading: Reading) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([mappedMidi(played, attacks, reading) as BlobPart], { type: "audio/midi" }));
    link.download = `${fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-")}-with-bars.mid`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Finding them needs no decision. Checking them does, and that's what this screen is for.
  useEffect(() => {
    if (props.auto && state.status === "none") void ask(null);
  }, []);

  const last = played.notes[played.notes.length - 1];
  const answer = state.status === "ready" ? state.answer : null;
  const open = answer?.questions[question];
  return (
    <main className="free-bars" aria-label="Finding the bars">
      <h2>This was played without a click</h2>
      <p>
        {played.notes.length} notes over {minutes(last?.end ?? 0)}. The file says {played.claimed.beats}/{played.claimed.beatType}
        {played.emptyBars ? `, with ${played.emptyBars.toLocaleString("en")} empty bars before the first note` : ""}, and none of that was played to.
      </p>
      {state.status === "none" && (
        <button className="button primary" onClick={() => void ask(null)}>
          Find the bars
        </button>
      )}
      {state.status === "asking" && <p className="spark-note">Muse Spark is finding the bars from the notes. This takes about a minute.</p>}
      {state.status === "unavailable" && (
        <>
          <p className="spark-note">Muse Spark can't answer here, so there are no bars to offer.</p>
          <button className="button primary" onClick={() => void ask(null)}>
            Try again
          </button>
        </>
      )}
      {state.status === "ready" && answer && (
        <>
          {state.stale && <p className="spark-note">Muse Spark couldn't read it again just now, so this is still its last answer.</p>}
          <p className="free-found">
            Muse Spark hears {answer.meter.beats}/{answer.meter.beatType}, {barsOf(attacks, state.reading).length} bars.
          </p>
          <p>{answer.why}</p>
          {measured && (
            <p className="spark-note">
              The measurements on their own would pick {measured.meter} with {measured.bars} bars{attacks.some((a) => a.notes.length > 1) ? ` and ${measured.bassOn} of ${measured.bassOf} bass notes on a downbeat` : ""}.
            </p>
          )}
          <ul className="free-phrases">
            {answer.phrases.map((p) => (
              <li key={`${p.fromBar}-${p.toBar}`}>
                <span className="free-where">
                  Bars {p.fromBar} to {p.toBar}
                </span>{" "}
                {p.what}
              </li>
            ))}
          </ul>
          {answer.slips.map((s) => (
            <p key={s.note} className="spark-note">
              Maybe a slip: {s.why}. It stays in the file.
            </p>
          ))}
          {open && (
            <div className="free-question">
              <p>{open.ask}</p>
              <span className="arrange-chips">
                {open.choices.map((choice) => (
                  <button key={choice} className="chip-button" onClick={() => {
                    setWords((now) => `${now} ${open.ask} ${choice}.`.trim());
                    setQuestion((q) => q + 1);
                  }}>
                    {choice}
                  </button>
                ))}
              </span>
            </div>
          )}
          <label className="free-words">
            Hear it another way? Say so and it reads the notes again.
            <textarea rows={2} value={words} maxLength={600} onChange={(e) => setWords(e.target.value)} />
          </label>
          <div className="free-actions">
            <button className="button primary" onClick={() => onUse(scoreOfReading(played, attacks, state.reading, title), { played, attacks, reading: state.reading, answer, saved: state.saved })}>
              Use these bars
            </button>
            <button className="button" disabled={!words.trim() || state.saved} onClick={() => void ask(words)}>
              Read it again
            </button>
            <button className="button" onClick={() => download(state.reading)}>
              Download the MIDI on these bars
            </button>
          </div>
          <p className="spark-note">{state.saved ? "A saved answer from Muse Spark, made for this playing." : "A draft from Muse Spark."} The MIDI on these bars keeps every note where you struck it. The score keeps the beats, and writes what's between them on the nearest place notation can show. Check the bars by ear.</p>
        </>
      )}
      <button className="button small" onClick={onKeep}>
        Keep the file's own bars
      </button>
    </main>
  );
}
