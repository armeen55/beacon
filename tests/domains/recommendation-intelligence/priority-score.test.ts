/**
 * 2026-05-20 — Slice 4.5.D.α₀a — priority-score tests.
 *
 * Component-level + composite truth tables. Verifies the locked
 * hard rule: indexability blockers (fix_*) with confidence ≥
 * medium outrank content polish at the same page-importance.
 */

import { describe, it, expect } from "vitest";

import {
  EFFORT_BY_ACTION_TYPE,
  FUSION_BONUS_NON_BLOCKER_HEADROOM,
  MAX_FUSION_CORROBORATION_BONUS,
  PAGE_IMPORTANCE_BY_PAGE_TYPE,
  SEVERITY_BY_TRIGGER_SIGNAL,
  confidenceMultiplier,
  fusionCorroborationBonus,
  priorityScore,
} from "@/domains/recommendation-intelligence/priority-score";

describe("priority-score / component tables", () => {
  it("SEVERITY table caps at 30 (missing_title + bad_http_status)", () => {
    expect(SEVERITY_BY_TRIGGER_SIGNAL.missing_title).toBe(30);
    expect(SEVERITY_BY_TRIGGER_SIGNAL.bad_http_status).toBe(30);
  });

  it("SEVERITY table floors at 10 (sensitive families)", () => {
    expect(SEVERITY_BY_TRIGGER_SIGNAL.missing_schema).toBe(10);
    expect(SEVERITY_BY_TRIGGER_SIGNAL.noindex_on_indexable_page).toBe(10);
    expect(SEVERITY_BY_TRIGGER_SIGNAL.robots_blocks_ai_bots).toBe(10);
  });

  it("PAGE_IMPORTANCE table caps at 15 (homepage)", () => {
    expect(PAGE_IMPORTANCE_BY_PAGE_TYPE.homepage).toBe(15);
  });

  it("PAGE_IMPORTANCE table floors at 3 (utility / technical_asset / other)", () => {
    expect(PAGE_IMPORTANCE_BY_PAGE_TYPE.utility).toBe(3);
    expect(PAGE_IMPORTANCE_BY_PAGE_TYPE.technical_asset).toBe(3);
    expect(PAGE_IMPORTANCE_BY_PAGE_TYPE.other).toBe(3);
  });

  it("EFFORT table values are within [1.0, 1.5]", () => {
    for (const v of Object.values(EFFORT_BY_ACTION_TYPE)) {
      expect(v).toBeGreaterThanOrEqual(1.0);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("priority-score / confidenceMultiplier", () => {
  it("high → 1.0", () => {
    expect(confidenceMultiplier("high")).toBe(1.0);
  });
  it("medium → 0.75", () => {
    expect(confidenceMultiplier("medium")).toBe(0.75);
  });
  it("low → 0.5", () => {
    expect(confidenceMultiplier("low")).toBe(0.5);
  });
});

describe("priority-score / formula", () => {
  it("computes a missing_title on the homepage at high confidence", () => {
    // (30 + 0 + 15) * 1.0 * 1 * 1 / 1.0 = 45
    const score = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(score).toBe(45);
  });

  it("computes a sitemap_missing on the homepage at high confidence with INDEX_BLOCKER bonus", () => {
    // (20 + 25 + 15) * 1.0 * 1 * 1 / 1.0 = 60
    const score = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(score).toBe(60);
  });

  it("HARD RULE: indexability blocker outranks content polish on the same hub page", () => {
    // missing_title on hub: (30 + 0 + 8) * 1.0 / 1.0 = 38
    const content = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // sitemap_missing on hub: (20 + 25 + 8) * 1.0 / 1.0 = 53
    const indexability = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(indexability).toBeGreaterThan(content);
  });

  it("HARD RULE holds at medium confidence too", () => {
    const content = priorityScore({
      trigger_signal: "missing_meta",
      action_type: "edit_meta",
      target_page_type: "city",
      confidence: "medium",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    const indexability = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "city",
      confidence: "medium",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(indexability).toBeGreaterThan(content);
  });

  it("INDEX_BLOCKER bonus is NOT applied at confidence: low", () => {
    // Even if a fix_* row somehow had confidence: low (won't happen
    // because the eligibility tier table routes those to diagnostic-only),
    // the formula must not give it the +25 indexability bonus.
    const score = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "hub",
      confidence: "low",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // (20 + 0 + 8) * 0.5 / 1.0 = 14
    expect(score).toBe(14);
  });

  it("returns 0 when prerequisite is not resolved", () => {
    const score = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: false,
      safety_flags: [],
    });
    expect(score).toBe(0);
  });

  it("returns 0 when any safety flag is set", () => {
    const score = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: ["unsupported_claim_risk"],
    });
    expect(score).toBe(0);
  });

  it("applies the EFFORT divisor — change_h1 (1.2) is lower than edit_title (1.0) at same severity / page", () => {
    // Note: trigger_signal severity differs, but EFFORT divides
    // the total. Use the same severity to isolate the EFFORT
    // effect.
    const t = priorityScore({
      trigger_signal: "missing_title",
      action_type: "edit_title",
      target_page_type: "service",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // missing_title severity is 30; EFFORT for change_h1 is 1.2;
    // page_importance for service is 12; so (30 + 0 + 12)/1.2 = 35.
    // For edit_title (1.0 effort): (30 + 0 + 12)/1.0 = 42.
    const h1Effort = priorityScore({
      trigger_signal: "missing_title", // same severity
      action_type: "change_h1", // different effort
      target_page_type: "service",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(t).toBeGreaterThan(h1Effort);
  });

  it("unknown trigger_signal contributes 0 severity (defensive default)", () => {
    const score = priorityScore({
      trigger_signal: "unknown_signal_xyz",
      action_type: "edit_title",
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // (0 + 0 + 15) * 1.0 / 1.0 = 15
    expect(score).toBe(15);
  });

  it("score is always a non-negative integer", () => {
    const cases = [
      {
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_page_type: "homepage",
        confidence: "high",
        prerequisite_resolved: true,
        safety_flags: [],
      },
      {
        trigger_signal: "missing_schema",
        action_type: "add_schema",
        target_page_type: "other",
        confidence: "low",
        prerequisite_resolved: false,
        safety_flags: ["unsupported_claim_risk"],
      },
    ] as const;
    for (const c of cases) {
      const s = priorityScore(c);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  it("bounded above by 70 (severity 30 + index 25 + page 15)", () => {
    const max = priorityScore({
      trigger_signal: "bad_http_status",
      action_type: "fix_status_code", // effort 1.0
      target_page_type: "homepage",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    expect(max).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Fusion corroboration bonus (FUSION_ROADMAP item #3, 2026-06-14)
// ---------------------------------------------------------------------------

describe("priority-score / fusionCorroborationBonus (component)", () => {
  it("0 / 1 / absent classes → 0 bonus", () => {
    expect(fusionCorroborationBonus(undefined)).toBe(0);
    expect(fusionCorroborationBonus(0)).toBe(0);
    expect(fusionCorroborationBonus(1)).toBe(0);
  });

  it("2 classes → 2; 3 classes → 3 (the cap)", () => {
    expect(fusionCorroborationBonus(2)).toBe(2);
    expect(fusionCorroborationBonus(3)).toBe(MAX_FUSION_CORROBORATION_BONUS);
    expect(fusionCorroborationBonus(3)).toBe(3);
  });

  it("never exceeds the cap, even for an out-of-range count", () => {
    expect(fusionCorroborationBonus(99)).toBe(MAX_FUSION_CORROBORATION_BONUS);
  });

  it("the bonus is monotonic non-decreasing in the class count", () => {
    expect(fusionCorroborationBonus(3)).toBeGreaterThanOrEqual(
      fusionCorroborationBonus(2),
    );
  });
});

describe("priority-score / fusion corroboration in the score", () => {
  const baseContent = {
    trigger_signal: "gsc_low_ctr",
    action_type: "edit_title" as const,
    target_page_type: "service" as const,
    confidence: "high" as const,
    prerequisite_resolved: true,
    safety_flags: [] as ReadonlyArray<never>,
  };

  it("1 signal class → score byte-identical to today (no fusion term)", () => {
    const today = priorityScore(baseContent);
    const oneClass = priorityScore({ ...baseContent, signal_class_count: 1 });
    const zeroClass = priorityScore({ ...baseContent, signal_class_count: 0 });
    expect(oneClass).toBe(today);
    expect(zeroClass).toBe(today);
  });

  it("2 distinct classes → a bounded positive nudge over the single-signal score", () => {
    const single = priorityScore({ ...baseContent, signal_class_count: 1 });
    const fused = priorityScore({ ...baseContent, signal_class_count: 2 });
    expect(fused).toBeGreaterThan(single);
    // The nudge is small (clamped to the non-blocker headroom) — never a
    // dominant term.
    expect(fused - single).toBeLessThanOrEqual(MAX_FUSION_CORROBORATION_BONUS);
  });

  it("3 classes ≥ 2 classes (and both are bounded)", () => {
    const two = priorityScore({ ...baseContent, signal_class_count: 2 });
    const three = priorityScore({ ...baseContent, signal_class_count: 3 });
    expect(three).toBeGreaterThanOrEqual(two);
  });

  it("the bonus NEVER reduces a score (monotone vs. the no-fusion baseline)", () => {
    const baseline = priorityScore(baseContent);
    for (const n of [0, 1, 2, 3, 5, 99]) {
      expect(
        priorityScore({ ...baseContent, signal_class_count: n }),
        `class count ${n} must not reduce the score`,
      ).toBeGreaterThanOrEqual(baseline);
    }
  });

  it("HARD CEILING: a corroborated non-blocker NEVER reaches a comparable index blocker on the same page", () => {
    // Worst case: the highest-severity GSC-demand content signal
    // (gsc_low_ctr = 28) with the FULL upside cap AND 3 corroborating
    // classes, on the same page/confidence as the lowest-severity index
    // blocker (sitemap_missing = 20, +25 bonus).
    const pageTypes = [
      "homepage",
      "city",
      "service",
      "project",
      "content",
      "hub",
      "utility",
      "other",
    ] as const;
    for (const pt of pageTypes) {
      const corroboratedContent = priorityScore({
        trigger_signal: "gsc_low_ctr", // 28 — the max corroboration-eligible content severity
        action_type: "edit_title", // NOT fix_* → no index-blocker bonus
        target_page_type: pt,
        confidence: "high",
        prerequisite_resolved: true,
        safety_flags: [],
        upside_clicks_90d: 1e9, // saturates upsideBonus at +15
        signal_class_count: 3, // max corroboration
        page_value_weight: 1.5, // max value weight (applies to both rows equally on the same page)
      });
      const indexBlocker = priorityScore({
        trigger_signal: "sitemap_missing", // 20 — the min index-blocker severity
        action_type: "fix_sitemap",
        target_page_type: pt,
        confidence: "high",
        prerequisite_resolved: true,
        safety_flags: [],
        page_value_weight: 1.5,
        // No corroboration on the blocker — the harder case for the bound.
      });
      expect(
        corroboratedContent,
        `corroborated content must stay below the index blocker at page_type=${pt}: ${corroboratedContent} vs ${indexBlocker}`,
      ).toBeLessThan(indexBlocker);
    }
  });

  it("the non-blocker headroom is non-negative and ≤ the bonus cap", () => {
    expect(FUSION_BONUS_NON_BLOCKER_HEADROOM).toBeGreaterThanOrEqual(0);
    expect(FUSION_BONUS_NON_BLOCKER_HEADROOM).toBeLessThanOrEqual(
      MAX_FUSION_CORROBORATION_BONUS,
    );
  });

  it("an index blocker takes the FULL corroboration bonus (corroboration only lifts a blocker)", () => {
    const blockerNoFusion = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    const blockerFused = priorityScore({
      trigger_signal: "sitemap_missing",
      action_type: "fix_sitemap",
      target_page_type: "hub",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
      signal_class_count: 3,
    });
    // (20 + 25 + 8) * 1 = 53 base; + full +3 corroboration = 56.
    expect(blockerNoFusion).toBe(53);
    expect(blockerFused).toBe(56);
  });
});
