import { describe, it, expect } from "vitest";

import {
  selectExperimentBatch,
  type BatchPageRow,
} from "@/domains/insight/select-experiment-batch";
import type { LeverKey } from "@/domains/insight/workbench-matrix";
import type {
  OptimizerBuckets,
  OptimizerCandidate,
} from "@/domains/insight/workbench-optimizer";
import type { OpportunityItem } from "@/domains/insight/opportunity";

function cand(lever: LeverKey, over: Partial<OptimizerCandidate> = {}): OptimizerCandidate {
  return {
    lever,
    label: lever,
    draft: `draft for ${lever}`,
    draftSource: "deterministic",
    evidence: `${lever} underperforms`,
    estClicksAtStake: 100,
    upsideConfidence: "medium",
    risk: "low",
    measurementMetric: "Page CTR",
    rollbackType: lever === "title" || lever === "meta" || lever === "h1" ? "exact_prior_value" : "reversible_add",
    wixPushMethod: "wix_cms_field",
    canAutoApply: true,
    serpGuardLabel: null,
    verdict: "Ship this now",
    safeNow: true,
    blockedBy: null,
    speed: lever === "title" || lever === "meta" ? "ctr_days" : "rank_weeks",
    leverageScore: 100,
    reason: "ready",
    ...over,
  };
}

/** Buckets where the same candidate is best/safest/fastest (the common case). */
function buckets(best: OptimizerCandidate | null, over: Partial<OptimizerBuckets> = {}): OptimizerBuckets {
  return {
    bestNextMove: best,
    safestChange: best,
    highestUpside: best,
    fastestMeasurable: best && (best.lever === "title" || best.lever === "meta") ? best : null,
    biggerSwingLater: null,
    holdDoNotTouch: [],
    ...over,
  };
}

function item(path: string, over: Partial<OpportunityItem> = {}): OpportunityItem {
  return {
    canonUrl: `https://iranopedia.com${path}`,
    path,
    kinds: ["ctr_leak"],
    kind: "ctr_leak",
    title: path.replace(/\//g, " ").trim(),
    why: "demand with a click gap",
    evidenceBySource: [{ source: "gsc", line: "1,000 impressions, 0.5% CTR" }],
    expectedLever: "title",
    estClicksAtStake: 100,
    importance: 1,
    hasChangePack: false,
    packAction: null,
    estWindow: "90d",
    estConfidence: "medium",
    serpStatus: "unknown",
    serpGuardLabel: null,
    score: 100,
    ...over,
  };
}

function row(path: string, best: OptimizerCandidate | null, over: Partial<BatchPageRow> = {}): BatchPageRow {
  return {
    item: item(path),
    optimizer: buckets(best),
    measuringActions: [],
    current: { title: `Old title for ${path}`, meta: `Old meta for ${path}`, h1: null },
    topQueries: ["query one", "query two"],
    ...over,
  };
}

describe("selectExperimentBatch (TASK 4)", () => {
  it("excludes a measuring lever and a SERP-owned title/meta", () => {
    const cards = selectExperimentBatch([
      row("/a", cand("meta", { blockedBy: "measuring" })),
      row("/b", cand("title", { blockedBy: "serp" })),
      row("/c", cand("schema", { rollbackType: "reversible_add" })),
    ]);
    expect(cards.map((c) => c.page)).toEqual(["/c"]);
    expect(cards[0]!.lever).toBe("schema");
  });

  it("excludes a lever with too little volume to measure (except a net-new page)", () => {
    const cards = selectExperimentBatch([
      row("/tiny", cand("meta", { estClicksAtStake: 2 })),
      row("/newpage", cand("new_page", { estClicksAtStake: 0, risk: "high", draftSource: "needs_endpoint", draft: null })),
    ]);
    expect(cards.map((c) => c.lever)).toEqual(["new_page"]); // tiny meta dropped, new_page kept
  });

  it("keeps only one experiment per page (highest score wins)", () => {
    const both = buckets(cand("title", { estClicksAtStake: 50 }), {
      highestUpside: cand("h2_sections", { estClicksAtStake: 500, speed: "rank_weeks" }),
    });
    const cards = selectExperimentBatch([{ ...row("/p", null), optimizer: both }]);
    const forPage = cards.filter((c) => c.page === "/p");
    expect(forPage).toHaveLength(1);
  });

  it("enforces diversity: caps repeated action types (no batch of ten metas)", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(`/meta-${i}`, cand("meta", { estClicksAtStake: 100 - i })),
    );
    const cards = selectExperimentBatch(rows);
    const metas = cards.filter((c) => c.actionType === "meta");
    expect(metas.length).toBeLessThanOrEqual(3); // PER_ACTION_CAP
  });

  it("includes at least one of each available family + an optional bigger swing", () => {
    const cards = selectExperimentBatch([
      row("/ctr", cand("meta", { estClicksAtStake: 300 })),
      row("/answer", cand("answer_block", { estClicksAtStake: 200, speed: "rank_weeks", wixPushMethod: "no_write_path" })),
      row("/content", cand("h2_sections", { estClicksAtStake: 150, speed: "rank_weeks", wixPushMethod: "no_write_path" })),
      row("/structure", cand("schema", { estClicksAtStake: 80, speed: "structural", rollbackType: "reversible_add" })),
      row("/swing", cand("new_page", { estClicksAtStake: 0, risk: "high", draftSource: "needs_endpoint", draft: null })),
    ]);
    const families = new Set(cards.map((c) => c.family));
    expect(families.has("ctr")).toBe(true);
    expect(families.has("answer")).toBe(true);
    expect(families.has("content")).toBe(true);
    expect(families.has("structure")).toBe(true);
    expect(cards.some((c) => c.isOptionalSwing)).toBe(true);
  });

  it("returns at most 10 cards", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`/p-${i}`, cand(i % 2 ? "answer_block" : "schema", { estClicksAtStake: 100 - i, wixPushMethod: "no_write_path", rollbackType: "reversible_add" })),
    );
    expect(selectExperimentBatch(rows).length).toBeLessThanOrEqual(10);
  });

  it("builds a complete card: before/rollback for CTR levers, target queries, proof + indexing instructions, no em dashes", () => {
    const [c] = selectExperimentBatch([row("/cities", cand("title", { draft: "New title for cities" }))]);
    expect(c).toBeTruthy();
    expect(c!.before).toBe("Old title for /cities");
    expect(c!.rollbackCopy).toBe("Old title for /cities"); // exact_prior_value
    expect(c!.draft).toBe("New title for cities");
    expect(c!.targetQueries).toEqual(["query one", "query two"]);
    expect(c!.status).toBe("ready_now");
    expect(c!.proofInstructions).toMatch(/mark it shipped/i);
    expect(c!.gscIndexingInstruction).toContain("Request Indexing");
    expect(c!.workbenchHref).toBe("/workbench/cities");
    const blob = JSON.stringify(c);
    expect(blob).not.toContain("—"); // em dash
    expect(blob).not.toContain("–"); // en dash
  });

  it("marks a non-drafted lever needs_drafting (never fakes copy)", () => {
    const [c] = selectExperimentBatch([
      row("/x", cand("answer_block", { draft: null, draftSource: "needs_endpoint", safeNow: false, wixPushMethod: "no_write_path" })),
    ]);
    expect(c!.status).toBe("needs_drafting");
    expect(c!.draft).toBeNull();
  });

  it("marks a blocked-by-wix lever needs_wix_mapping", () => {
    const [c] = selectExperimentBatch([
      row("/x", cand("schema", { blockedBy: "wix", wixPushMethod: "blocked_no_mapping", safeNow: false, rollbackType: "reversible_add" })),
    ]);
    expect(c!.status).toBe("needs_wix_mapping");
  });
});
