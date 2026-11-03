// One pool per kind of caller. Every cap is a spend line Ryu approved. A pool without an approved line has a cap of zero, so it can't spend anything.
import type { Pool } from "./ledger";

export const POOLS: Pool[] = [
  // The local server only, which is what makes the prepared demo. 2026-11-02: Ryu approved $30, and $4 of it went on the tests before this ledger started.
  { id: "dev", capMicros: 26_000_000, dailyMicros: null, opensAt: null, closesAt: null, perVisitor: {} },
  // Everyone on the hosted site, judges included, because there's no private way to give them a link. The $100 Ryu kept for this on 2026-11-02, a limit a day so it lasts
  // past judging, and a limit for each visitor. When it's gone the site still has the free replay and a visitor's own key. Each visitor gets about a dollar a day (Ryu,
  // 11-03): one whole arrangement and one recomposition, at 11-03's costs of about 8 cents a section and 60 cents an arrangement.
  {
    id: "public",
    capMicros: 100_000_000,
    dailyMicros: 15_000_000,
    opensAt: null,
    closesAt: null,
    perVisitor: { read_bars: 2, read_piece: 2, study_score: 2, distribute: 2, plan_options: 2, plan_recompose: 1, write_theme: 1, arrange: 10, fit_form: 2 },
  },
  // A visitor's own Meta key, which is their money and never ours. Counted so the ledger works the same, with no real limit.
  { id: "own", capMicros: 100_000_000_000, dailyMicros: null, opensAt: null, closesAt: null, perVisitor: {} },
];

/** Calls that may be running at once before this kind of caller has to wait. A visitor's own key never waits. */
export const SLOTS: Record<string, number> = { dev: 2, public: 3, own: 50 };

/** What a visitor's own Meta key can look like. Anything else is refused, and never falls back to Ryu's key (review M1). */
export const OWN_KEY = /^[\x21-\x7e]{8,300}$/;
