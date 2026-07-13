import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import { computeAttribution } from "@/domains/attribution/compute";

const change = {
  id: "change-relative",
  tenant_id: "tenant-a",
  timestamp: "2026-07-01T00:00:00.000Z",
  signal_type: "content",
  asset_type: "service_page",
  url: "/topic",
  asset_name: "Topic",
  change_description: "Published topic page",
  topic_targeted: "topic",
  city_targeted: null,
  hypothesis: null,
  expected_impact_window: null,
  brief_id: null,
  opportunity_id: null,
  notes: null,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
} as ChangelogEntry;

const result = {
  id: "result-a",
  tenant_id: "tenant-a",
  snapshot_date: "2026-07-08",
  platform: "all",
  metric_type: "share_of_voice",
  metric_value: 1,
  previous_value: 0,
  delta: 1,
  delta_percentage: null,
  topic: "topic",
  city: null,
  url_measured: "https://tenant-a.example/topic",
  attributed_changelog_ids: ["change-relative"],
  notes: null,
  mention_count: 1,
  citation_count: 0,
  total_possible: 1,
  position: null,
  created_at: "2026-07-08T00:00:00.000Z",
} as Result;

describe("attribution site identity is explicit", () => {
  it("keeps A → B → A URL matching isolated in one process", () => {
    const a1 = computeAttribution(change, result, [], null, "tenant-a.example");
    const b = computeAttribution(change, result, [], null, "tenant-b.example");
    const none = computeAttribution(change, result, []);
    const a2 = computeAttribution(change, result, [], null, "tenant-a.example");

    expect(a1.matches.url).toBe("strong");
    expect(b.matches.url).toBe("none");
    expect(none.matches.url).toBe("unknown");
    expect(a2).toEqual(a1);
  });
});
