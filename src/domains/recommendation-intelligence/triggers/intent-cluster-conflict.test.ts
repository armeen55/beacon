/**
 * intent-cluster-conflict.test.ts (BEACON_500 item N7).
 *
 * Pins: the pure predicate's candidate-row SHAPE (merge_pages action,
 * anchored on the cluster's best-ranking own page, evidence naming the real
 * queries/URLs, customer copy with no em/en dashes and no forbidden vocab),
 * the biggest-cluster-first ranking, the maxCandidates cap, the non-conflict
 * skip, and the empty-input abstention. No I/O, this file never touches
 * Supabase.
 */
import { describe, it, expect } from "vitest";

import { intentClusterConflict } from "./intent-cluster-conflict";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

function cluster(overrides: Partial<IntentCluster> = {}): IntentCluster {
  return {
    clusterId: "intent_cluster_1",
    queries: ["what is nowruz", "nowruz meaning"],
    sharedUrls: ["https://en.wikipedia.org/wiki/Nowruz", "https://a.com/1", "https://a.com/2", "https://a.com/3"],
    ownPagesInCluster: [
      { url: "https://iranopedia.com/nowruz-guide", bestRank: 3, queries: ["what is nowruz"] },
      { url: "https://iranopedia.com/nowruz-meaning", bestRank: 5, queries: ["nowruz meaning"] },
    ],
    conflict: true,
    ...overrides,
  };
}

describe("intentClusterConflict (pure predicate)", () => {
  it("abstains when there are no clusters", () => {
    expect(intentClusterConflict({ tenantId: "t1", clusters: [], signalAt: "2026-07-02T05:00:00.000Z" })).toEqual([]);
  });

  it("skips a cluster with conflict:false", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster({ conflict: false, ownPagesInCluster: [{ url: "https://iranopedia.com/a", bestRank: 2, queries: ["q1"] }] })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows).toEqual([]);
  });

  it("skips a cluster flagged conflict:true but with fewer than 2 own pages (defensive; should not happen upstream)", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster({ conflict: true, ownPagesInCluster: [{ url: "https://iranopedia.com/a", bestRank: 2, queries: ["q1"] }] })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows).toEqual([]);
  });

  it("emits a merge_pages candidate anchored on the best-ranking own page", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action_type).toBe("merge_pages");
    expect(row.target_url).toBe("https://iranopedia.com/nowruz-guide"); // bestRank 3 < 5
    expect(row.trigger_signal).toBe("intent_cluster_conflict");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.confidence).toBe("medium");
    expect(row.safety_flags).toEqual([]);
  });

  it("evidence names the real queries and own-page URLs", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    const detail = rows[0]!.evidence[0]!.detail!;
    expect(detail).toContain("what is nowruz");
    expect(detail).toContain("nowruz meaning");
    expect(detail).toContain("https://iranopedia.com/nowruz-guide");
    expect(detail).toContain("https://iranopedia.com/nowruz-meaning");
  });

  it("operator_evidence names which page to keep and which to fold in", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows[0]!.operator_evidence).toContain("keep=https://iranopedia.com/nowruz-guide");
    expect(rows[0]!.operator_evidence).toContain("fold_in=https://iranopedia.com/nowruz-meaning");
  });

  it("customer copy names the real query count and page count, no dashes, no forbidden vocab", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("2");
    expect(copy.toLowerCase()).toContain("google shows the same results");
    expect(copy).not.toMatch(/[--]/); // no em/en dashes
    expect(copy).not.toMatch(/\$/);
    expect(copy.toLowerCase()).not.toContain("revenue");
  });

  it("marks high impact for a 3+ query cluster, medium otherwise", () => {
    const big = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster({ queries: ["q1", "q2", "q3"] })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(big[0]!.impact_estimate).toBe("high");

    const small = intentClusterConflict({
      tenantId: "t1",
      clusters: [cluster({ queries: ["q1", "q2"] })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(small[0]!.impact_estimate).toBe("medium");
  });

  it("ranks the biggest cluster (most entangled queries) first and respects maxCandidates", () => {
    const rows = intentClusterConflict({
      tenantId: "t1",
      clusters: [
        cluster({ clusterId: "small", queries: ["q1", "q2"] }),
        cluster({ clusterId: "big", queries: ["q1", "q2", "q3", "q4"] }),
        cluster({ clusterId: "mid", queries: ["q1", "q2", "q3"] }),
      ],
      signalAt: "2026-07-02T05:00:00.000Z",
      maxCandidates: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.topic_cluster_label).toContain("big");
    expect(rows[1]!.topic_cluster_label).toContain("mid");
  });

  it("dedupe_key and cooldown_key are deterministic for the same tenant/cluster", () => {
    const rows1 = intentClusterConflict({ tenantId: "t1", clusters: [cluster()], signalAt: "2026-07-02T05:00:00.000Z" });
    const rows2 = intentClusterConflict({ tenantId: "t1", clusters: [cluster()], signalAt: "2026-07-03T05:00:00.000Z" });
    expect(rows1[0]!.dedupe_key).toBe(rows2[0]!.dedupe_key);
    expect(rows1[0]!.cooldown_key).toBe(rows2[0]!.cooldown_key);
  });
});
