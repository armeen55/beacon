import { describe, it, expect } from "vitest";

import { buildOptimizer } from "@/domains/insight/workbench-optimizer";
import type {
  LeverKey,
  WorkbenchLeverRow,
  WorkbenchMatrix,
} from "@/domains/insight/workbench-matrix";
import type { ProofPlanRow } from "@/domains/recommendation-intelligence/page-surgeon/proof-plan";
import type { SerpHypothesis } from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";

/** A clean, shippable lever by default; override per test. */
function row(lever: LeverKey, over: Partial<WorkbenchLeverRow> = {}): WorkbenchLeverRow {
  return {
    lever,
    label: lever,
    needed: true,
    whyNeeded: `${lever} underperforms`,
    status: "attention",
    current: "before",
    proposed: "after",
    proposedSource: "deterministic",
    benefit: { estClicksAtStake: 100, window: "90d", confidence: "medium", serpGuardLabel: null },
    serpGuardLabel: null,
    risk: "low",
    pushMethod: "wix_cms_field",
    pushReason: "mapped",
    canAutoApply: true,
    rollbackReady: true,
    ...over,
  };
}

function matrix(rows: WorkbenchLeverRow[]): WorkbenchMatrix {
  return { rows };
}

function proofFor(headlineAction: string): ProofPlanRow {
  return {
    pageUrl: "https://iranopedia.com/cities",
    verdict: "approve",
    headlineAction,
    decidedAt: "2026-06-01T00:00:00.000Z",
    windows: { decidedAt: "2026-06-01T00:00:00.000Z", checkIn7: "2026-06-08", checkIn14: "2026-06-15", checkIn28: "2026-06-29" },
    metricsToCheck: [],
    controlPaths: [],
    measurementPlan: null,
    note: null,
  };
}

function serpOwned(): SerpHypothesis {
  return {
    source: "synthetic",
    serpStatus: "suspected",
    featureLikelyOwnsAnswer: true,
    summary: "Image pack likely owns the answer.",
    queries: [
      {
        query: "iran flag",
        likelyFeatures: ["image_pack"],
        featureLikelyOwnsAnswer: true,
        clickLossCause: "image pack sits above the first organic link",
        confidence: "medium",
        rationale: "flag query",
        recommendedCheck: "search incognito",
      },
    ],
    generatedAt: null,
  };
}

describe("buildOptimizer (TASK 3) — bucketing", () => {
  it("whole-page healthy (no needed levers) → single keep_current Hold, all picks null", () => {
    const b = buildOptimizer({
      matrix: matrix([row("title", { needed: false, status: "ok" }), row("meta", { needed: false, status: "ok" })]),
      proof: null,
      serp: null,
    });
    expect(b.bestNextMove).toBeNull();
    expect(b.safestChange).toBeNull();
    expect(b.fastestMeasurable).toBeNull();
    expect(b.holdDoNotTouch).toHaveLength(1);
    expect(b.holdDoNotTouch[0]!.lever).toBe("keep_current");
    expect(b.holdDoNotTouch[0]!.verdict).toBe("Do not touch");
  });

  it("a clean title lever is Best next move, safe now, and Fastest measurable", () => {
    const b = buildOptimizer({
      matrix: matrix([row("title", { benefit: { estClicksAtStake: 300, window: "90d", confidence: "high", serpGuardLabel: null } })]),
      proof: null,
      serp: null,
    });
    expect(b.bestNextMove?.lever).toBe("title");
    expect(b.bestNextMove?.safeNow).toBe(true);
    expect(b.fastestMeasurable?.lever).toBe("title");
    expect(b.bestNextMove?.draft).toBe("after");
  });

  it("SERP feature-owned (page-level guard) downgrades title → Hold, prefers answer block as Best next move", () => {
    const b = buildOptimizer({
      matrix: matrix([
        row("title", { serpGuardLabel: "SERP feature suspected", benefit: { estClicksAtStake: 500, window: "90d", confidence: "high", serpGuardLabel: "x" } }),
        row("answer_block", { pushMethod: "no_write_path", benefit: { estClicksAtStake: 200, window: "90d", confidence: "medium", serpGuardLabel: null } }),
      ]),
      proof: null,
      serp: null,
    });
    // title is blocked by serp → goes to hold, not best
    const titleHeld = b.holdDoNotTouch.find((c) => c.lever === "title");
    expect(titleHeld?.blockedBy).toBe("serp");
    expect(b.bestNextMove?.lever).not.toBe("title");
    expect(b.bestNextMove?.lever).toBe("answer_block");
  });

  it("SERP hypothesis featureOwns blocks title even without a page-level guard label, and enriches evidence", () => {
    const b = buildOptimizer({
      matrix: matrix([row("title")]),
      proof: null,
      serp: serpOwned(),
    });
    const t = b.holdDoNotTouch.find((c) => c.lever === "title");
    expect(t?.blockedBy).toBe("serp");
    expect(t?.evidence).toContain("SERP:");
    expect(b.bestNextMove).toBeNull(); // nothing eligible
  });

  it("already-measuring overlap → Hold with check-in; CTR sibling also held; non-overlapping lever stays eligible", () => {
    const b = buildOptimizer({
      matrix: matrix([row("title"), row("meta"), row("schema")]),
      proof: proofFor("title"),
      serp: null,
    });
    const t = b.holdDoNotTouch.find((c) => c.lever === "title");
    const m = b.holdDoNotTouch.find((c) => c.lever === "meta");
    expect(t?.blockedBy).toBe("measuring");
    expect(t?.reason).toContain("2026-06-29");
    expect(m?.blockedBy).toBe("measuring"); // CTR sibling
    // schema is not a CTR lever and does not overlap the title proof → still eligible
    expect(b.bestNextMove?.lever).toBe("schema");
  });

  it("Fastest measurable is a CTR lever only — a high-upside content lever never wins it", () => {
    const b = buildOptimizer({
      matrix: matrix([
        row("answer_block", { pushMethod: "no_write_path", benefit: { estClicksAtStake: 999, window: "90d", confidence: "high", serpGuardLabel: null } }),
        row("meta", { benefit: { estClicksAtStake: 50, window: "90d", confidence: "medium", serpGuardLabel: null } }),
      ]),
      proof: null,
      serp: null,
    });
    expect(b.fastestMeasurable?.lever).toBe("meta"); // not answer_block, despite far bigger upside
    expect(b.highestUpside?.lever).toBe("answer_block"); // upside still surfaces it
  });

  it("Safest change prefers low risk + exact-prior-value rollback", () => {
    const b = buildOptimizer({
      matrix: matrix([
        row("answer_block", { pushMethod: "no_write_path", risk: "medium", rollbackReady: true }),
        row("meta", { risk: "low", rollbackReady: true }), // CMS field → exact_prior_value rollback
      ]),
      proof: null,
      serp: null,
    });
    expect(b.safestChange?.lever).toBe("meta");
    expect(b.safestChange?.rollbackType).toBe("exact_prior_value");
  });

  it("new_page is Bigger swing later, never Best next move", () => {
    const b = buildOptimizer({
      matrix: matrix([
        row("new_page", { risk: "high", pushMethod: "manual_cms_edit", rollbackReady: false, benefit: { estClicksAtStake: 800, window: "90d", confidence: "low", serpGuardLabel: null } }),
        row("title", { benefit: { estClicksAtStake: 120, window: "90d", confidence: "medium", serpGuardLabel: null } }),
      ]),
      proof: null,
      serp: null,
    });
    expect(b.biggerSwingLater?.lever).toBe("new_page");
    expect(b.biggerSwingLater?.rollbackType).toBe("none");
    expect(b.bestNextMove?.lever).toBe("title"); // not new_page
  });

  it("blockedBy precedence: measuring outranks serp on the same lever", () => {
    const b = buildOptimizer({
      matrix: matrix([row("title", { serpGuardLabel: "SERP feature suspected" })]),
      proof: proofFor("title"),
      serp: serpOwned(),
    });
    const t = b.holdDoNotTouch.find((c) => c.lever === "title");
    expect(t?.blockedBy).toBe("measuring"); // measuring wins the precedence
  });

  it("needs_endpoint draft → blockedBy data, surfaced in Hold (never silently dropped)", () => {
    const b = buildOptimizer({
      matrix: matrix([row("answer_block", { proposedSource: "needs_endpoint", proposed: null, pushMethod: "no_write_path" })]),
      proof: null,
      serp: null,
    });
    const a = b.holdDoNotTouch.find((c) => c.lever === "answer_block");
    expect(a?.blockedBy).toBe("data");
    expect(a?.reason).toContain("analysis endpoint");
  });
});
