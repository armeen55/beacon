/**
 * serp-feature-change-alert.test.ts (BEACON_500 P9 v1 251).
 *
 * Pins the pure predicate's candidate-row SHAPE (add_answer_block action,
 * site-root anchor, dash-free customer copy that says "Google" not "SERP"),
 * that ONLY "appeared" changes become Moves, the cap, and the empty/no-root
 * abstentions. No I/O.
 */
import { describe, it, expect } from "vitest";

import { serpFeatureChangeAlert } from "./serp-feature-change-alert";
import type { SerpFeatureChange } from "@/domains/serp/serp-feature-change";

const SIGNAL_AT = "2026-07-03T05:00:00.000Z";
const ROOT = "https://iranopedia.com/";

function change(overrides: Partial<SerpFeatureChange> = {}): SerpFeatureChange {
  return {
    query: "farsi numbers",
    feature: "answer_box",
    direction: "appeared",
    ownRank: 4,
    fromAt: "2026-06-25T00:00:00.000Z",
    toAt: "2026-07-02T00:00:00.000Z",
    sentence: "Google just added an answer box ...",
    ...overrides,
  };
}

describe("serpFeatureChangeAlert (pure predicate)", () => {
  it("abstains when there are no changes", () => {
    expect(serpFeatureChangeAlert({ tenantId: "t1", changes: [], siteRootUrl: ROOT, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("abstains when there is no site root", () => {
    expect(serpFeatureChangeAlert({ tenantId: "t1", changes: [change()], siteRootUrl: null, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("emits ONLY for 'appeared' changes, never 'disappeared'", () => {
    const rows = serpFeatureChangeAlert({
      tenantId: "t1",
      changes: [change({ direction: "disappeared" })],
      siteRootUrl: ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toEqual([]);
  });

  it("emits an add_answer_block candidate anchored on the site root", () => {
    const rows = serpFeatureChangeAlert({ tenantId: "t1", changes: [change()], siteRootUrl: ROOT, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action_type).toBe("add_answer_block");
    expect(row.target_url).toBe(ROOT);
    expect(row.trigger_signal).toBe("serp_feature_change");
    expect(row.confidence).toBe("medium");
    expect(row.evidence[0]!.detail).toContain("feature=answer_box");
    expect(row.evidence[0]!.detail).toContain("direction=appeared");
    expect(row.customer_copy).toContain("Google just added an answer box");
    expect(row.customer_copy).toContain("farsi numbers");
    // Voice: never "SERP" on customer copy, no dashes.
    expect(row.customer_copy).not.toContain("SERP");
    expect(row.customer_copy).not.toMatch(/[—–]/);
    // Answer box where the tenant ranks in the top 10 -> high impact.
    expect(row.impact_estimate).toBe("high");
  });

  it("carries the plain feature label for each winnable feature", () => {
    const rows = serpFeatureChangeAlert({
      tenantId: "t1",
      changes: [
        change({ query: "a", feature: "people_also_ask" }),
        change({ query: "b", feature: "image_row", ownRank: null }),
      ],
      siteRootUrl: ROOT,
      signalAt: SIGNAL_AT,
    });
    const byQuery = new Map(rows.map((r) => [r.topic_cluster_label, r.customer_copy]));
    expect(byQuery.get("serp_feature_change:a:people_also_ask")).toContain("a People Also Ask block");
    expect(byQuery.get("serp_feature_change:b:image_row")).toContain("an image row");
  });

  it("respects the maxCandidates cap", () => {
    const changes = ["a", "b", "c", "d"].map((q) => change({ query: q }));
    const rows = serpFeatureChangeAlert({ tenantId: "t1", changes, siteRootUrl: ROOT, signalAt: SIGNAL_AT, maxCandidates: 2 });
    expect(rows).toHaveLength(2);
  });
});
