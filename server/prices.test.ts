import { describe, expect, it } from "vitest";
import { CONTEXT_WINDOW, costMicros, reservationMicros, usd } from "./prices";

describe("prices", () => {
  it("prices a choose_next-sized call the way the notes worked it out", () => {
    // 3k input and 1.2k output: about $0.009 uncached (META-API-NOTES §2).
    expect(usd(costMicros({ inputTokens: 3000, cachedTokens: 0, outputTokens: 1200 }, 0))).toBe("$0.0089");
    // The same with 2.5k of it cached.
    expect(costMicros({ inputTokens: 3000, cachedTokens: 2500, outputTokens: 1200 }, 0)).toBe(6100);
  });

  it("charges each search, and never more cached tokens than were sent", () => {
    expect(costMicros({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, 3)).toBe(7500);
    expect(costMicros({ inputTokens: 100, cachedTokens: 500, outputTokens: 0 }, 0)).toBe(15);
  });

  it("reserves the whole context window uncached, plus every output token (recheck L1)", () => {
    const worst = costMicros({ inputTokens: CONTEXT_WINDOW.tokens, cachedTokens: 0, outputTokens: 512 }, 0);
    expect(reservationMicros(512)).toBeGreaterThanOrEqual(worst);
    // Codex's worked figure for the 512-token cap.
    expect(reservationMicros(512)).toBe(1_312_896);
  });
});
