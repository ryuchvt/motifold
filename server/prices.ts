// Meta's Standard prices for Muse Spark 1.3 (dev.meta.ai/docs/pricing-rate-limits, read 2026-10-26).
// Money is counted in micro-dollars: $1.25 per million tokens is 1.25 micro-dollars a token.

export const PRICES = {
  version: "meta-standard-2026-10-26",
  inputMicrosPerToken: 1.25,
  cachedMicrosPerToken: 0.15,
  /** Reasoning tokens are billed as output. */
  outputMicrosPerToken: 4.25,
  /** $2.50 per 1,000 web search queries. */
  searchMicrosPerQuery: 2500,
} as const;

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** What a finished call cost, rounded up. Every web search call Meta reports counts as a billed query. */
export function costMicros(usage: Usage, searches: number): number {
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  return Math.ceil(
    (usage.inputTokens - cached) * PRICES.inputMicrosPerToken +
      cached * PRICES.cachedMicrosPerToken +
      usage.outputTokens * PRICES.outputMicrosPerToken +
      searches * PRICES.searchMicrosPerQuery,
  );
}

/**
 * Web search stays off until its billing is qualified (review L1): one search action can carry
 * several queries, `max_tool_calls` caps actions, not queries, and the input a search adds has no
 * documented bound. No call with search is sent while this is false, and turning it on needs a
 * search bound in `reservationMicros` first.
 */
export const SEARCH_QUALIFIED = false;

/**
 * The model's whole context window (dev.meta.ai/docs/models, read 2026-10-28). Meta can't bill more
 * input than the model accepts, so this bounds the input of a call that sends one message, with no
 * tools and no earlier turns. Tied to the model: a different model needs its own window here.
 */
export const CONTEXT_WINDOW = { model: "muse-spark-1.3", tokens: 1_048_576 } as const;

/**
 * The most a call can cost, worked out before it is sent (R8B §4). Counting the prompt's bytes as
 * tokens wasn't a proven bound (review L1, recheck 10-28), so the reservation assumes the whole
 * context window at the uncached price, plus every output token. Deliberately loose: settlement
 * charges what Meta reports, so the pool gets the difference back.
 */
export function reservationMicros(maxOutputTokens: number): number {
  return Math.ceil(CONTEXT_WINDOW.tokens * PRICES.inputMicrosPerToken + maxOutputTokens * PRICES.outputMicrosPerToken);
}

/** "$0.0123" */
export function usd(micros: number): string {
  return `$${(micros / 1e6).toFixed(4)}`;
}
