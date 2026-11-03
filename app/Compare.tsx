import { useState } from "react";
import type { OptionPlan, RecomposePlan } from "../server/shapes";
import { barsWords } from "./attention";
import type { PieceData } from "./pieceData";
import { Orders, type OrderRow } from "./PieceView";

/**
 * Where alternatives are compared, between the overview and the score, and shut when there's nothing to compare. Nothing is drawn that doesn't
 * exist: a plan has no notes until it's written, so a plan is shown as what it really is, your own melody in orange, your sections, and the
 * chords and the idea it proposes for each stretch, bar by bar.
 */
export function Compare(props: {
  data: PieceData | null;
  sections: { from: string; to: string; name: string }[];
  orders: OrderRow[];
  ordered: number | null;
  onOrder: (index: number | null) => void;
  onKeepOrder: () => void;
  plans: OptionPlan[] | RecomposePlan[] | null;
  recompose: boolean;
  chosen: number | null;
  onChoose: (index: number) => void;
  /** Which plans have notes already, and which of those are only a first-section preview. */
  written: number[];
  previewed: number[];
  onPreview?: (index: number) => void;
  busy: boolean;
  onShowBars: (from: string, to: string) => void;
}) {
  const { data, sections, orders, ordered, onOrder, onKeepOrder, plans, recompose, chosen, onChoose, written, previewed, onPreview, busy, onShowBars } = props;
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const kind = plans && plans.length ? "plans" : orders.length > 1 ? "orders" : null;
  if (!kind) return null;
  // Orders are a side road, so they start shut. Plans are the decision of the step, so they start open.
  const isShut = shut[kind] ?? kind === "orders";
  const title = kind === "plans" ? `Compare ${plans!.length} ${recompose ? "new pieces" : "plans"}` : `Compare ${orders.length - 1} other orders of your bars`;
  return (
    <section className={`compare${isShut ? " shut" : ""}`} aria-label={title}>
      <button className="compare-head" aria-expanded={!isShut} onClick={() => setShut({ ...shut, [kind]: !isShut })}>
        <span className="compare-caret" aria-hidden>
          {isShut ? "▸" : "▾"}
        </span>
        <strong>{title}</strong>
        <span>{kind === "plans" ? (chosen === null ? "Choose one to write" : `${plans![chosen]?.name} chosen`) : ordered !== null ? "One is on the score" : "None of them adds a note"}</span>
      </button>
      {!isShut && kind === "orders" && <Orders orders={orders} ordered={ordered} onOrder={onOrder} onKeep={onKeepOrder} bare />}
      {!isShut && kind === "plans" && (
        <div className="compare-plans">
          {plans!.map((plan, index) => (
            <PlanCard key={plan.name} plan={plan} index={index} data={recompose ? null : data} sections={recompose ? [] : sections} chosen={chosen === index} written={written.includes(index)} previewed={previewed.includes(index)} onPreview={recompose || !onPreview ? undefined : () => onPreview(index)} busy={busy} onChoose={() => onChoose(index)} onShowBars={recompose ? undefined : onShowBars} recompose={recompose} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlanCard(props: { plan: OptionPlan | RecomposePlan; index: number; data: PieceData | null; sections: { from: string; to: string; name: string }[]; chosen: boolean; written: boolean; previewed: boolean; onPreview?: () => void; busy: boolean; onChoose: () => void; onShowBars?: (from: string, to: string) => void; recompose: boolean }) {
  const { plan, data, sections, chosen, written, previewed, onPreview, busy, onChoose, onShowBars, recompose } = props;
  // The composer's bars give the scale. A new piece has only its own, so its stretches set it.
  const numbers = data?.bars.map((b) => b.number) ?? [];
  const lastNew = Math.max(1, ...plan.why.map((w) => Number(w.to) || 0));
  const span = (from: string, to: string) => {
    if (data && numbers.includes(from)) {
      const bars = data.bars;
      const a = bars.find((b) => b.number === from)!;
      const z = bars.find((b) => b.number === to) ?? bars[bars.length - 1]!;
      return { left: (a.start / data.totalBeats) * 100, width: ((z.start + z.length - a.start) / data.totalBeats) * 100 };
    }
    // Bars past the end are new bars, after the composer's.
    const a = (Number(from) || 1) - 1;
    const z = Number(to) || a + 1;
    const total = data ? Math.max(numbers.length, lastNew) : lastNew;
    return { left: (a / total) * 100, width: ((z - a) / total) * 100 };
  };
  const melody = data ? data.rows.flatMap((r) => r.notes.filter((n) => n.kind === "melody")) : [];
  const [low, high] = melody.length ? [Math.min(...melody.map((n) => n.height)), Math.max(...melody.map((n) => n.height))] : [0, 1];
  const motif = (plan as RecomposePlan).motif;
  return (
    <article className={`plan-card${chosen ? " on" : ""}`}>
      <header>
        <strong>{plan.name}</strong>
        {written && <span className="plan-tag">{previewed ? "Preview" : "Written"}</span>}
        <button className={`button small${chosen ? " primary" : ""}`} aria-pressed={chosen} onClick={onChoose}>
          {chosen ? "Chosen" : "Choose"}
        </button>
      </header>
      <p className="plan-idea">{plan.idea}</p>
      {recompose && motif && (
        <p className="plan-motif">
          Motif from your bars {motif.from} to {motif.to}: {motif.what} {(plan as RecomposePlan).time}, {(plan as RecomposePlan).qpm} a minute.
        </p>
      )}
      <div className="plan-lanes">
        {sections.length > 0 && (
          <div className="plan-lane plan-sections" aria-label="Your sections">
            {sections.map((s) => {
              const at = span(s.from, s.to);
              return (
                <span key={s.from} className="plan-section" style={{ left: `${at.left}%`, width: `${at.width}%` }}>
                  {s.name}
                </span>
              );
            })}
          </div>
        )}
        {melody.length > 0 && (
          <div className="plan-lane plan-melody" aria-label="Your melody">
            {melody.map((n, k) => (
              <span key={k} style={{ left: `${(n.start / data!.totalBeats) * 100}%`, width: `${Math.max(0.3, (n.length / data!.totalBeats) * 100)}%`, top: `${(1 - (n.height - low) / Math.max(1, high - low)) * 26}px` }} />
            ))}
          </div>
        )}
        <div className="plan-lane plan-why" aria-label="What it proposes, bar by bar">
          {plan.why.map((w, k) => {
            const at = span(w.from, w.to);
            const words = [barsWords(w.from, w.to), w.what, w.principle, w.dynamics].filter(Boolean).join(". ");
            return (
              <button key={`${w.from}-${k}`} className={`plan-stretch${w.yours ? " yours" : ""}`} style={{ left: `${at.left}%`, width: `${at.width}%` }} title={words} aria-label={words} onClick={() => onShowBars?.(w.from, w.to)}>
                <span className="plan-chords">{w.chords ?? ""}</span>
                <span className="plan-what">{w.what}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="plan-note">
        {previewed ? "Its first section is written. Choose it to hear that on the score, then write the rest." : written ? "Its notes are written. Choose it to see them on the score." : "No notes yet: these are the plan's chords and ideas on your bars. Notes are written when you choose it."}
      </p>
      {!written && onPreview && (
        <button className="plan-preview" disabled={busy} onClick={onPreview}>
          Preview its first section · one call, a minute or two
        </button>
      )}
    </article>
  );
}
