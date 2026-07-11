/**
 * proof-ledger-strip - review fix 11 (2026-07-11): the active card's schedule
 * clause. A quarantined row (uncalibrated won/lost, gated into the Measuring
 * stage) has all its checks run, so "All the result checks are done." next to a
 * "Measuring" label read as a direct contradiction. The clause is the approved
 * honest sentence for that row instead; a genuinely finished row keeps the
 * original claim.
 */
import { describe, expect, it } from "vitest";
import { allChecksDoneClause } from "./proof-ledger-strip";
import { UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE } from "@/domains/proof-gsc/verdict-calibration";

describe("allChecksDoneClause - review fix 11", () => {
  it("a quarantined row gets the approved honest sentence, never the all-done claim", () => {
    expect(allChecksDoneClause(true)).toBe(UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE);
    expect(allChecksDoneClause(true)).toBe(
      "No clear effect yet. Earlier reads used thresholds that failed Beacon's self-test.",
    );
  });

  it("a genuinely finished row keeps the original claim", () => {
    expect(allChecksDoneClause(false)).toBe("All the result checks are done.");
  });

  it("neither clause carries an em or en dash", () => {
    expect(`${allChecksDoneClause(true)}${allChecksDoneClause(false)}`).not.toMatch(/[‒–—―]/);
  });
});
