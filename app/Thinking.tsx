import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { replay, skipReplay } from "./demo";
import { onSpark, resetSparkActivity, type RecordedTiming, type SparkEvent } from "./spark";
import "./thinking-workspace.css";

const STAGES: Record<string, { what: string; chip: string; usually: string }> = {
  read_bars: { what: "Finding the bars from your notes", chip: "FINDING THE BARS", usually: "about a minute" },
  read_piece: { what: "Reading who has the tune and what's missing", chip: "READING YOUR SCORE", usually: "about a minute" },
  study_score: { what: "Studying the form and the harmony", chip: "STUDYING THE FORM", usually: "a minute or two" },
  distribute: { what: "Laying your notes on the instruments", chip: "LAYING OUT YOUR NOTES", usually: "about a minute" },
  plan_options: { what: "Choosing chords and form, bar by bar", chip: "PLANNING TWO WAYS", usually: "about two minutes" },
  plan_recompose: { what: "Composing a new piece from your motif", chip: "COMPOSING FROM YOUR MOTIF", usually: "about two minutes" },
  write_theme: { what: "Writing the new tune", chip: "WRITING THE TUNE", usually: "about two minutes" },
  arrange: { what: "Writing the notes", chip: "WRITING", usually: "a minute or two a section" },
  fit_form: { what: "Fitting your bars to the moments", chip: "FITTING TO PICTURE", usually: "about a minute" },
};

// The clock ticks twice a second, so a call that started since the last tick reads 0:00, never less.
const clock = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;

interface Running {
  callId: string;
  shape: string;
  label: string;
  bars: string | null;
  started: number;
  updated: number;
  lines: string[];
  timing?: RecordedTiming;
}
interface Finished {
  callId: string;
  label: string;
  ok: boolean;
  ms: number;
  timing?: RecordedTiming;
  lines: string[];
}

/**
 * What Muse Spark is doing, from the calls' own events only: what started, what it has said, what came back. Calls can run side by side, like
 * the study after the reading, so each keeps its own label, clock and thinking (review F6). Nothing here is estimated or made up.
 */
let running: Running[] = [];
let finished: Finished[] = [];
let snapshot = { running, finished };
const listeners = new Set<() => void>();
const changed = () => {
  snapshot = { running, finished };
  for (const l of listeners) l();
};
let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  onSpark((event: SparkEvent) => {
    if (event.kind === "start") {
      const input = event.input as { window?: { from: string; to: string }; chosen?: { name?: string } } | null;
      const window = input?.window;
      const name = input?.chosen?.name;
      const plan = typeof name === "string" ? name : null;
      const stage = STAGES[event.shape];
      const bars = window ? (window.from === window.to ? `bar ${window.from}` : `bars ${window.from} to ${window.to}`) : null;
      const now = Date.now();
      running = [...running, { callId: event.callId, shape: event.shape, label: [stage?.what ?? "Thinking", plan, bars].filter(Boolean).join(" · "), bars, started: now, updated: now, lines: [] }];
    } else if (event.kind === "recorded") {
      if (!running.some((r) => r.callId === event.callId)) return;
      running = running.map((r) => r.callId === event.callId ? { ...r, timing: event.timing } : r);
    } else if (event.kind === "thinking") {
      const at = running.findIndex((r) => r.callId === event.callId);
      if (at < 0) return;
      running = running.map((r, k) => (k === at ? { ...r, updated: Date.now(), lines: [...r.lines.slice(-24), event.text] } : r));
    } else {
      const at = running.findIndex((r) => r.callId === event.callId);
      if (at < 0) return;
      const ended = running[at]!;
      finished = [...finished.slice(-7), { callId: ended.callId, label: ended.label, ok: event.ok, ms: Date.now() - ended.started, timing: ended.timing, lines: ended.lines }];
      running = running.filter((_, k) => k !== at);
    }
    changed();
  });
}
const subscribeMuse = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const getMuse = () => snapshot;
function useMuse() {
  watch();
  return useSyncExternalStore(subscribeMuse, getMuse, getMuse);
}
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** The panel's open or shut, shared by the chip and the panel. */
const panelListeners = new Set<() => void>();
let panel = { opened: true };
const setPanel = (opened: boolean) => {
  panel = { opened };
  for (const l of panelListeners) l();
};
const subscribePanel = (listener: () => void) => {
  panelListeners.add(listener);
  return () => void panelListeners.delete(listener);
};
const getPanel = () => panel;
/** A different piece starts a different activity history. Late events from the old calls are ignored. */
export function resetMuseActivity() {
  resetSparkActivity();
  running = [];
  finished = [];
  changed();
  setPanel(true);
}
function usePanel() {
  return useSyncExternalStore(subscribePanel, getPanel, getPanel);
}

/** The status in the top bar, always there: READY, or what it's doing and for how long. Pressing it opens or shuts the panel. */
export function MuseChip() {
  watch();
  const { running: now } = useMuse();
  const state = usePanel();
  const clockNow = useNow(now.length > 0);
  const current = now[now.length - 1];
  const words = current ? `${STAGES[current.shape]?.chip ?? "THINKING"}${current.shape === "arrange" && current.bars ? ` ${current.bars.replace("bars ", "").replace(" to ", "–").toUpperCase()}` : ""}` : "READY";
  const showing = state.opened;
  return (
    <button className={`muse-chip${current ? " on" : ""}`} aria-expanded={showing} aria-label={`Muse Spark, ${current ? STAGES[current.shape]?.what ?? "thinking" : "ready"}. ${showing ? "Hide" : "Show"} what it's doing.`} onClick={() => setPanel(!showing)}>
      <span className={`signal${current ? " on" : ""}`} aria-hidden />
      <span>MUSE SPARK · {words}</span>
      {current && <span className="muse-chip-clock">{clock(clockNow - current.started)}</span>}
      {now.length > 1 && <span className="muse-chip-more">+{now.length - 1}</span>}
    </button>
  );
}

/** The wait, shown for what it is: which stage this is, the model's own thinking as it comes, what's finished, and how long it's taken. On a replay it says it's a replay. */
export function Thinking({ sample = false }: { sample?: boolean }) {
  const { running: now, finished: done } = useMuse();
  const state = usePanel();
  const [reasoning, setReasoning] = useState(true);
  const clockNow = useNow(now.length > 0);
  const list = useRef<HTMLOListElement>(null);
  const current = now[now.length - 1] ?? null;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [current?.callId, current?.lines.length]);
  const stage = current ? STAGES[current.shape] : null;
  const recorded = replay.active || ("enabled" in replay && replay.enabled === true);
  const elapsed = (ms: number, timing?: RecordedTiming) => timing ? `Replay ${clock(ms)} / recorded live ${clock(timing.realMs)}` : `${sample ? "Sample" : recorded ? "Replay" : "Live"} ${clock(ms)}`;
  return (
    <aside className={`thinking muse-dock${state.opened ? "" : " is-minimized"}`} aria-label="What Muse Spark is doing">
      <header role={current ? "status" : undefined}>
        <span className={`signal${current ? " on" : ""}`} aria-hidden />
        <strong>{current ? current.label : "Muse Spark is ready"}</strong>
        {current && <span className="thinking-clock">{elapsed(clockNow - current.started, current.timing)}</span>}
        <button className="thinking-hide" aria-label={state.opened ? "Minimize activity" : "Expand activity"} aria-expanded={state.opened} onClick={() => setPanel(!state.opened)}>
          {state.opened ? "−" : "+"}
        </button>
      </header>
      {state.opened && <div className="muse-dock-content">
      {now.length > 1 && (
        <ol className="thinking-also">
          {now.slice(0, -1).map((r) => (
            <li key={r.callId}>
              Also working: {r.label} · {elapsed(clockNow - r.started, r.timing)}
            </li>
          ))}
        </ol>
      )}
      {done.length > 0 && (
        <ol className="thinking-done">
          {done.map((d) => (
            <li key={d.callId} className={d.ok ? undefined : "failed"}>
              {d.label} · {elapsed(d.ms, d.timing)}
              {d.ok ? "" : " · didn't come back"}
              {d.lines.length > 0 && <details><summary>View its reasoning</summary><ol>{d.lines.map((line, index) => <li key={index}>{line}</li>)}</ol></details>}
            </li>
          ))}
        </ol>
      )}
      {current && (
        <>
          <button className="thinking-toggle" aria-expanded={reasoning} onClick={() => setReasoning(!reasoning)}>
            {reasoning ? "Hide its reasoning" : "Show its reasoning, as it comes"}
            {current.lines.length > 0 && <span> · last word {clock(Math.max(0, clockNow - current.updated))} ago</span>}
          </button>
          {reasoning && (
            <ol className="thinking-lines" ref={list}>
              {current.lines.map((line, k) => (
                <li key={k}>{line}</li>
              ))}
              {current.lines.length === 0 && <li className="quiet">Muse Spark is starting on this.</li>}
            </ol>
          )}
        </>
      )}
      </div>}
      <footer>
        {sample ? (
          <span>Local sample answers. No model call.</span>
        ) : recorded ? (
          <>
            <span>{current?.timing ? `Recorded ${current.timing.recorded} on ${current.timing.model}. No model call.` : replay.active ? `A replay of the real run, recorded ${replay.recorded}. This step took ${clock(replay.realMs)} live.` : `Recorded replay${replay.recorded ? ` from ${replay.recorded}` : ""}. ${current ? "Loading a saved answer. No model call." : "No model call is running."}`}</span>
            {replay.active && <button className="thinking-skip" onClick={skipReplay}>
              Skip
            </button>}
          </>
        ) : current ? (
          <span>Live on Muse Spark. This usually takes {stage?.usually ?? "a minute or two"}.</span>
        ) : (
          <span>Nothing is running. What it did last is above.</span>
        )}
      </footer>
    </aside>
  );
}
