import type { Score } from "../score";
import type { DemoPlanHarmony } from "./demo";

/** Match whole authentic spans to printed bars. Free text says nothing about individual note/chord positions. */
export function passagePlanHarmony(score: Score, passage: { from: string; to: string }, spans: DemoPlanHarmony[]) {
  const labels = score.parts[0]?.measures.map(bar => bar.number) ?? [];
  const unaddressable = { spans: [] as DemoPlanHarmony[], unaddressable: true };
  if (!labels.length || new Set(labels).size !== labels.length || score.parts.some(part => part.measures.length !== labels.length || part.measures.some((bar, i) => bar.number !== labels[i]))) return unaddressable;
  const positions = new Map(labels.map((label, i) => [label, i]));
  const start = positions.get(passage.from), end = positions.get(passage.to);
  if (start === undefined || end === undefined || end < start) return unaddressable;
  let missing = false;
  const matching = spans.filter(span => {
    const from = positions.get(span.from), to = positions.get(span.to);
    if (from === undefined || to === undefined || to < from) { missing = true; return false; }
    return from <= end && start <= to;
  });
  return { spans: matching, unaddressable: !matching.length && missing };
}
