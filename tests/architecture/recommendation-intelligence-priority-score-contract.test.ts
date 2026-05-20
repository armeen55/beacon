/**
 * Architecture invariant — Slice 4.5.D.α₀a.1 — priority-score
 * contract pin (2026-05-20).
 *
 * Behavioral pin of the three locked formula rules in
 * `src/domains/recommendation-intelligence/priority-score.ts`:
 *
 *   1. The +25 indexability-blocker bonus applies iff
 *      `action_type.startsWith("fix_")` AND confidence ≠ "low".
 *
 *   2. At the same page-importance, medium/high indexability
 *      blockers outrank content polish (because the
 *      INDEX_BLOCKER + content max severity 30 stack to 45 + 25
 *      = 70 max, but content alone caps at 45).
 *
 *   3. Low-confidence rows DO NOT receive the +25 indexability
 *      blocker bonus (defense-in-depth — today no
 *      customer-queue-ready emitter produces low, but the
 *      formula stays the canonical enforcement point).
 */

import { describe, it, expect } from "vitest";

import { priorityScore } from "@/domains/recommendation-intelligence/priority-score";

const BASE = {
  trigger_signal: "sitemap_missing",
  action_type: "fix_sitemap" as const,
  target_page_type: "hub" as const,
  confidence: "high" as const,
  prerequisite_resolved: true,
  safety_flags: [] as ReadonlyArray<never>,
};

describe("recommendation-intelligence-priority-score-contract", () => {
  // ── Rule 1: INDEX_BLOCKER +25 bonus ─────────────────────────
  it("Rule 1: fix_* at confidence: high receives the +25 indexability bonus", () => {
    // sitemap_missing severity = 20; PAGE_IMPORTANCE(hub) = 8;
    // bonus +25; EFFORT(fix_sitemap) = 1.0; CONFIDENCE = 1.0.
    // (20 + 25 + 8) * 1.0 / 1.0 = 53
    expect(priorityScore({ ...BASE })).toBe(53);
  });

  it("Rule 1: fix_* at confidence: medium also receives the +25 bonus", () => {
    // (20 + 25 + 8) * 0.75 / 1.0 = 39.75 → round → 40
    expect(priorityScore({ ...BASE, confidence: "medium" })).toBe(40);
  });

  it("Rule 1: non-fix_* action types do NOT receive the +25 bonus", () => {
    // missing_title (severity 30) + edit_title (NOT fix_*) +
    // PAGE_IMPORTANCE(hub) = 8; EFFORT(edit_title) = 1.0; high.
    // (30 + 0 + 8) * 1.0 / 1.0 = 38
    expect(
      priorityScore({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_page_type: "hub",
        confidence: "high",
        prerequisite_resolved: true,
        safety_flags: [],
      }),
    ).toBe(38);
  });

  // ── Rule 2: indexability outranks content polish ────────────
  it("Rule 2: medium-confidence indexability outranks high-confidence content polish at the same page", () => {
    const indexability = priorityScore({
      ...BASE,
      confidence: "medium",
    });
    const content = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // indexability medium: (20+25+8)*0.75 = 39.75 → 40
    // content high:        (30+0+8)*1.0 = 38
    expect(indexability).toBeGreaterThan(content);
  });

  it("Rule 2: high-confidence indexability outranks high-confidence content polish on every page type", () => {
    const pageTypes = ["homepage", "city", "service", "project", "hub"] as const;
    for (const pt of pageTypes) {
      const indexability = priorityScore({
        ...BASE,
        target_page_type: pt,
      });
      const content = priorityScore({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_page_type: pt,
        confidence: "high",
        prerequisite_resolved: true,
        safety_flags: [],
      });
      expect(
        indexability,
        `Indexability must outrank content polish at page_type=${pt}; got ${indexability} vs ${content}`,
      ).toBeGreaterThan(content);
    }
  });

  // ── Rule 3: low confidence does NOT get the bonus ───────────
  it("Rule 3: confidence: low DOES NOT receive the +25 indexability bonus", () => {
    // Even on a fix_* action_type, low must skip the bonus.
    // (20 + 0 + 8) * 0.5 / 1.0 = 14
    expect(priorityScore({ ...BASE, confidence: "low" })).toBe(14);
  });

  it("Rule 3: low-confidence indexability does NOT outrank high-confidence content polish", () => {
    const lowIndexability = priorityScore({ ...BASE, confidence: "low" });
    const highContent = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // lowIndexability 14 < highContent 38 → confidence gate honored.
    expect(lowIndexability).toBeLessThan(highContent);
  });
});
