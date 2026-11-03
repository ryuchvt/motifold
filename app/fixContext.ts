import type { WriteAnswer } from "../server/shapes";

/** Exact selected-bar notes and expression, bounded for the rewrite request. */
export function fixCurrent(adds: WriteAnswer["adds"], bars: readonly string[]): string {
  const selected = new Set(bars);
  return adds.filter((add) => selected.has(add.bar)).map((add) =>
    `${add.part}, bar ${add.bar}: ${add.events} ${JSON.stringify({ dyn: add.dyn ?? null, role: add.role ?? null, art: add.art ?? null })}`
  ).join(" / ").slice(0, 8000) || "nothing yet";
}
