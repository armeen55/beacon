import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";
import {
  annotateCrawlStaleness,
  CRAWL_STALE_AFTER_DAYS,
} from "./crawl-staleness";

function snapshot(fetchedAt: string): PageSnapshot {
  return {
    id: "s",
    page_id: "p",
    url: "https://example.com/guide/",
    canonical_url: "https://www.example.com/guide",
    fetched_at: fetchedAt,
    tenant_id: "t",
  } as PageSnapshot;
}

function candidate(
  confidence: RecommendationCandidateRow["confidence"] = "high",
): RecommendationCandidateRow {
  return {
    tenant_id: "t",
    trigger_signal: "x",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: "https://example.com/guide",
    topic_cluster_label: "x",
    evidence: [{ kind: "page_snapshot", ref: "s" }],
    confidence,
    impact_estimate: "high",
    customer_copy: "Improve this title.",
    operator_evidence: "signal=x",
    dedupe_key: "d",
    cooldown_key: "c",
    created_from_signal_at: "2026-01-01T00:00:00Z",
    safety_flags: [],
  };
}

describe("annotateCrawlStaleness", () => {
  it("labels an old crawl and lowers high confidence without hiding the row", () => {
    const [row] = annotateCrawlStaleness({
      candidates: [candidate("high")],
      snapshots: [snapshot("2026-05-01T00:00:00Z")],
      now: new Date("2026-07-17T00:00:00Z"),
    });
    expect(row!.confidence).toBe("medium");
    expect(row!.customer_copy).toContain("77 days old");
    expect(row!.operator_evidence).toContain("crawl_age_days=77");
  });

  it("keeps medium visible and leaves fresh or unmatched rows byte-identical", () => {
    const medium = candidate("medium");
    expect(
      annotateCrawlStaleness({
        candidates: [medium],
        snapshots: [snapshot("2026-05-01T00:00:00Z")],
        now: new Date("2026-07-17T00:00:00Z"),
      })[0]!.confidence,
    ).toBe("medium");

    const fresh = candidate();
    expect(
      annotateCrawlStaleness({
        candidates: [fresh],
        snapshots: [snapshot("2026-07-01T00:00:00Z")],
        now: new Date("2026-07-17T00:00:00Z"),
      })[0],
    ).toBe(fresh);

    const unmatched = { ...candidate(), target_url: "https://example.com/other" };
    expect(
      annotateCrawlStaleness({
        candidates: [unmatched],
        snapshots: [snapshot("2026-05-01T00:00:00Z")],
        now: new Date("2026-07-17T00:00:00Z"),
      })[0],
    ).toBe(unmatched);
  });

  it("pins the generous staleness threshold", () => {
    expect(CRAWL_STALE_AFTER_DAYS).toBe(45);
  });
});
