import { useEffect, useRef, useState } from "react";
import { replay, skipReplay } from "./demo";
import { onSpark, type SparkEvent } from "./spark";

const STAGES: Record<string, { what: string; usually: string }> = {
  read_bars: { what: "Finding the bars from your notes", usually: "about a minute" },
  read_piece: { what: "Reading who has the tune and what's missing", usually: "about a minute" },
  study_score: { what: "Studying the form and the harmony", usually: "a minute or two" },
  distribute: { what: "Laying your notes on the instruments", usually: "about a minute" },
  plan_options: { what: "Choosing chords and form, bar by bar", usually: "about two minutes" },
  plan_recompose: { what: "Composing a new piece from your motif", usually: "about two minutes" },
  arrange: { what: "Writing the notes", usually: "a minute or two a section" },
  fit_form: { what: "Fitting your bars to the moments", usually: "about a minute" },
};

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** The wait, shown for what it is: which stage this is, the model's own thinking as it comes, and how long it's taken. On a replay it says it's a replay. */
export function Thinking() {
  const [current, setCurrent] = useState<{ shape: string; label: string; started: number } | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const unsubscribe = onSpark((event: SparkEvent) => {
      if (event.kind === "start") {
        const window = (event.input as { window?: { from: string; to: string } }).window;
        const stage = STAGES[event.shape];
        const label = `${stage?.what ?? "Thinking"}${window ? `: bars ${window.from} to ${window.to}` : ""}`;
        setCurrent({ shape: event.shape, label, started: Date.now() });
        setLines([]);
      } else if (event.kind === "thinking") {
        setLines((all) => [...all.slice(-24), event.text]);
      } else {
        setCurrent((was) => {
          if (was && event.ok) setDone((all) => [...all.slice(-5), was.label]);
          return null;
        });
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines]);
  useEffect(() => {
    if (!current) {
      const fade = setTimeout(() => setDone([]), 4000);
      return () => clearTimeout(fade);
    }
    return undefined;
  }, [current]);

  if (!current) return null;
  const stage = STAGES[current.shape];
  return (
    <aside className="thinking" role="status" aria-live="polite">
      <header>
        <span className="signal" aria-hidden />
        <strong>{current.label}</strong>
        <span className="thinking-clock">{clock(now - current.started)}</span>
      </header>
      <ol className="thinking-done">
        {done.map((label, k) => (
          <li key={`${label}-${k}`}>{label}</li>
        ))}
      </ol>
      <ol className="thinking-lines" ref={list}>
        {lines.map((line, k) => (
          <li key={k}>{line}</li>
        ))}
        {lines.length === 0 && <li className="quiet">Muse Spark is starting on this.</li>}
      </ol>
      <footer>
        {replay.active ? (
          <>
            <span>A replay of the real run, recorded {replay.recorded}. This step took {clock(replay.realMs)} live.</span>
            <button className="thinking-skip" onClick={skipReplay}>
              Skip
            </button>
          </>
        ) : (
          <span>Live on Muse Spark. This usually takes {stage?.usually ?? "a minute or two"}.</span>
        )}
      </footer>
    </aside>
  );
}
