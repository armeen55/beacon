import { describe, it, expect } from "vitest";

import type { MatchResult } from "../match-engine";
import { computeLifecycleUpdate } from "./transitions";

const SCAN_FETCHED_AT = "2026-04-27T12:00:00.000Z";
const SCAN_SNAPSHOT_ID = "snap-current";
const NOW_MS = Date.parse(SCAN_FETCHED_AT);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

function liveMatch(): MatchResult {
  return {
    outcome: "verified_live",
    confidence: "high",
    kind: "exact",
    similarity: 1,
    matchedElementKey: "title[0]:abc",
    matchedElementText: "Hello",
  };
}

function modifiedMatch(): MatchResult {
  return {
    outcome: "verified_live_modified",
    confidence: "high",
    kind: "modified",
    similarity: 0.92,
    matchedElementKey: "h2[0]:e1",
  };
}

function needsReviewMatch(): MatchResult {
  return {
    outcome: "needs_review",
    confidence: "medium",
    kind: "text_only",
    similarity: 0.6,
    matchedElementKey: "h2[0]:e1",
  };
}

function notFoundMatch(): MatchResult {
  return {
    outcome: "not_found",
    confidence: "low",
    kind: "none",
    reason: "no candidate elements",
  };
}

function wrongPageMatch(): MatchResult {
  return {
    outcome: "wrong_page",
    confidence: "low",
    kind: "wrong_page",
    similarity: 1,
    matchedElementKey: "h2[0]:other",
    matchedUrl: "https://example.com/other-page",
    reason: "text matched on /other-page",
  };
}

function partialMatch(): MatchResult {
  return {
    outcome: "partially_implemented",
    confidence: "medium",
    kind: "structural_partial",
    similarity: 0.95,
    matchedElementKey: "faq_question[0]:e",
    reason: "FAQ Q live; A missing",
  };
}

const baseInputs = {
  ageMs: SIX_DAYS_MS,
  scanFetchedAt: SCAN_FETCHED_AT,
  scanSnapshotId: SCAN_SNAPSHOT_ID,
};

describe("computeLifecycleUpdate — terminal/initial states", () => {
  it("dismissed → never auto-mutated regardless of match outcome", () => {
    for (const m of [liveMatch(), modifiedMatch(), needsReviewMatch(), notFoundMatch(), wrongPageMatch(), partialMatch()]) {
      expect(
        computeLifecycleUpdate({ ...baseInputs, currentStatus: "dismissed", match: m }),
      ).toBeNull();
    }
  });

  it("recommended → no-op (reconciler is responsible for flipping first)", () => {
    expect(
      computeLifecycleUpdate({ ...baseInputs, currentStatus: "recommended", match: liveMatch() }),
    ).toBeNull();
  });
});

describe("computeLifecycleUpdate — verified_live promotion", () => {
  it("accepted + verified_live → flip + stamp live_at + snapshot id", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "accepted",
      match: liveMatch(),
    });
    expect(u).not.toBeNull();
    expect(u!.implementation_status).toBe("verified_live");
    expect(u!.live_at).toBe(SCAN_FETCHED_AT);
    expect(u!.live_snapshot_id).toBe(SCAN_SNAPSHOT_ID);
    expect(u!.live_match_confidence).toBe("high");
    expect(u!.live_match_kind).toBe("exact");
    expect(u!.live_element_key).toBe("title[0]:abc");
  });

  it("needs_review + verified_live → promote (forward progress)", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "needs_review",
      match: liveMatch(),
    });
    expect(u?.implementation_status).toBe("verified_live");
  });

  it("not_found_after_7d + verified_live → promote (late match)", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "not_found_after_7d",
      match: liveMatch(),
    });
    expect(u?.implementation_status).toBe("verified_live");
  });

  it("verified_live + verified_live → no-op (already at top)", () => {
    expect(
      computeLifecycleUpdate({ ...baseInputs, currentStatus: "verified_live", match: liveMatch() }),
    ).toBeNull();
  });

  it("verified_live + verified_live_modified → flip (text drift detected)", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "verified_live",
      match: modifiedMatch(),
    });
    expect(u?.implementation_status).toBe("verified_live_modified");
  });

  it("verified_live_modified + verified_live → flip (operator cleaned up)", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "verified_live_modified",
      match: liveMatch(),
    });
    expect(u?.implementation_status).toBe("verified_live");
  });
});

describe("computeLifecycleUpdate — intermediate outcomes", () => {
  it("accepted + needs_review → flip", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "accepted",
      match: needsReviewMatch(),
    });
    expect(u?.implementation_status).toBe("needs_review");
    expect(u?.live_match_confidence).toBe("medium");
  });

  it("verified_live + needs_review → no-op (NEVER downgrade)", () => {
    expect(
      computeLifecycleUpdate({ ...baseInputs, currentStatus: "verified_live", match: needsReviewMatch() }),
    ).toBeNull();
  });

  it("verified_live_modified + wrong_page → no-op (NEVER downgrade)", () => {
    expect(
      computeLifecycleUpdate({
        ...baseInputs,
        currentStatus: "verified_live_modified",
        match: wrongPageMatch(),
      }),
    ).toBeNull();
  });

  it("accepted + wrong_page → flip", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "accepted",
      match: wrongPageMatch(),
    });
    expect(u?.implementation_status).toBe("wrong_page");
  });

  it("accepted + partially_implemented → flip", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      currentStatus: "accepted",
      match: partialMatch(),
    });
    expect(u?.implementation_status).toBe("partially_implemented");
  });

  it("needs_review + needs_review → no-op (already there)", () => {
    expect(
      computeLifecycleUpdate({ ...baseInputs, currentStatus: "needs_review", match: needsReviewMatch() }),
    ).toBeNull();
  });
});

describe("computeLifecycleUpdate — not_found + 7-day rule", () => {
  it("accepted + not_found at 6 days → no-op (stay accepted, retry next scan)", () => {
    expect(
      computeLifecycleUpdate({
        ...baseInputs,
        ageMs: SIX_DAYS_MS,
        currentStatus: "accepted",
        match: notFoundMatch(),
      }),
    ).toBeNull();
  });

  it("accepted + not_found at exactly 7 days → promote to not_found_after_7d", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      ageMs: SEVEN_DAYS_MS,
      currentStatus: "accepted",
      match: notFoundMatch(),
    });
    expect(u?.implementation_status).toBe("not_found_after_7d");
    expect(u?.not_found_reason).toBe("no candidate elements");
  });

  it("accepted + not_found at 30 days → promote", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      ageMs: 30 * 24 * 60 * 60 * 1000,
      currentStatus: "accepted",
      match: notFoundMatch(),
    });
    expect(u?.implementation_status).toBe("not_found_after_7d");
  });

  it("verified_live + not_found → no-op (NEVER downgrade)", () => {
    expect(
      computeLifecycleUpdate({
        ...baseInputs,
        ageMs: SEVEN_DAYS_MS,
        currentStatus: "verified_live",
        match: notFoundMatch(),
      }),
    ).toBeNull();
  });

  it("needs_review + not_found → no-op (sticky intermediate)", () => {
    expect(
      computeLifecycleUpdate({
        ...baseInputs,
        ageMs: SEVEN_DAYS_MS,
        currentStatus: "needs_review",
        match: notFoundMatch(),
      }),
    ).toBeNull();
  });

  it("not_found_after_7d + not_found → no-op", () => {
    expect(
      computeLifecycleUpdate({
        ...baseInputs,
        ageMs: 30 * 24 * 60 * 60 * 1000,
        currentStatus: "not_found_after_7d",
        match: notFoundMatch(),
      }),
    ).toBeNull();
  });
});

describe("computeLifecycleUpdate — purity", () => {
  it("does not mutate inputs", () => {
    const match = Object.freeze(liveMatch());
    const inputs = Object.freeze({
      ...baseInputs,
      currentStatus: "accepted" as const,
      match,
    });
    expect(() => computeLifecycleUpdate(inputs)).not.toThrow();
  });

  it("deterministic — identical inputs produce identical output", () => {
    const inputs = {
      ...baseInputs,
      currentStatus: "accepted" as const,
      match: liveMatch(),
    };
    expect(computeLifecycleUpdate(inputs)).toEqual(computeLifecycleUpdate(inputs));
  });

  it("uses current scan time fields when stamping live_at", () => {
    const u = computeLifecycleUpdate({
      ...baseInputs,
      scanFetchedAt: "2027-01-01T00:00:00.000Z",
      scanSnapshotId: "snap-future",
      currentStatus: "accepted",
      match: liveMatch(),
    });
    expect(u?.live_at).toBe("2027-01-01T00:00:00.000Z");
    expect(u?.live_snapshot_id).toBe("snap-future");
  });
});

// Suppress unused warning for NOW_MS when the test gets pruned.
void NOW_MS;
