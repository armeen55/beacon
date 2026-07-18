import { describe, expect, it } from "vitest";

import type { BlindHoldoutCaseReceipt, BlindHoldoutReceipt } from "./blind-holdout-contract";
import {
  blindHoldoutStatusLine,
  buildBlindHoldoutReleaseStatus,
  parseBlindHoldoutReceipt,
  type StoredBlindHoldoutReceipt,
} from "./blind-holdout-store";

const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const archetypes = ["edit", "new_page", "zero_click_trap", "declining_page", "do_nothing"] as const;

function receipt(candidateSha = SHA): BlindHoldoutReceipt {
  const cases: BlindHoldoutCaseReceipt[] = archetypes.map((archetype, index) => ({
    id: `fresh-${index}`,
    archetype,
    preregisteredAt: "2026-07-17T20:00:00.000Z",
    predictionRecordedAt: "2026-07-17T20:05:00.000Z",
    expertLabelRevealedAt: "2026-07-17T20:10:00.000Z",
    passed: true,
    codeChangedInResponse: false,
  }));
  return { candidateSha, cases };
}

function stored(value: BlindHoldoutReceipt, recordedAt: string): StoredBlindHoldoutReceipt {
  return { id: `${value.candidateSha}-${recordedAt}`, recordedAt, receipt: value };
}

describe("blind holdout receipt boundary", () => {
  it("strictly parses the fields used by the acceptance contract", () => {
    expect(parseBlindHoldoutReceipt(receipt())).toEqual(receipt());
    expect(() => parseBlindHoldoutReceipt({ candidateSha: SHA, cases: [{ id: "x" }] })).toThrow(
      "invalid archetype",
    );
    expect(() => parseBlindHoldoutReceipt({ candidateSha: SHA, cases: "not-an-array" })).toThrow(
      "cases array",
    );
  });

  it("never lets a valid old-SHA receipt certify the current release", () => {
    const status = buildBlindHoldoutReleaseStatus(
      [stored(receipt(OLD_SHA), "2026-07-17T21:00:00.000Z")],
      SHA,
    );
    expect(status.state).toBe("stale");
    expect(status.validation).toBeNull();
    expect(blindHoldoutStatusLine(status)).toContain("does not certify this release");
  });

  it("fails closed when build identity is unavailable", () => {
    const status = buildBlindHoldoutReleaseStatus(
      [stored(receipt(), "2026-07-17T21:00:00.000Z")],
      null,
    );
    expect(status.state).toBe("missing_build");
    expect(status.validation).toBeNull();
  });

  it("revalidates the exact current receipt and exposes eligibility only after all five pass", () => {
    const eligible = buildBlindHoldoutReleaseStatus(
      [stored(receipt(), "2026-07-17T21:00:00.000Z")],
      SHA,
    );
    expect(eligible.state).toBe("eligible");
    expect(eligible.validation).toMatchObject({ releaseEligible: true, countedCases: 5 });

    const validReceipt = receipt();
    const failedReceipt: BlindHoldoutReceipt = {
      ...validReceipt,
      cases: validReceipt.cases.map((row, index) =>
        index === 0 ? { ...row, passed: false } : row,
      ),
    };
    const failed = buildBlindHoldoutReleaseStatus(
      [stored(failedReceipt, "2026-07-17T22:00:00.000Z")],
      SHA,
    );
    expect(failed.state).toBe("failed");
    expect(failed.validation?.releaseEligible).toBe(false);
    expect(blindHoldoutStatusLine(failed)).toContain("did not pass");
  });
});
