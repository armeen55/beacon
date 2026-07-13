import { describe, expect, it } from "vitest";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";

const change = {
  id: "change-relative",
  tenant_id: "tenant-fixture",
  timestamp: "2026-07-12T00:00:00.000Z",
  signal_type: "content",
  asset_type: "service_page",
  url: "/history/construction",
  asset_name: "Construction history",
  change_description: "Published a new topic page",
  topic_targeted: "construction history",
  city_targeted: null,
  hypothesis: null,
  expected_impact_window: null,
  brief_id: null,
  opportunity_id: null,
  notes: null,
  created_at: "2026-07-12T00:00:00.000Z",
  updated_at: "2026-07-12T00:00:00.000Z",
} as ChangelogEntry;

describe("evidence tier site identity is explicit", () => {
  it("is stable across A → B → A and fails closed without a domain", () => {
    const a1 = classifyEvidenceTier(change, undefined, "ritzbuilders.com");
    const b = classifyEvidenceTier(change, undefined, "iranopedia.com");
    const noContext = classifyEvidenceTier(change);
    const a2 = classifyEvidenceTier(change, undefined, "ritzbuilders.com");

    expect(a1.has_structural_url).toBe(true);
    expect(b.has_structural_url).toBe(true);
    expect(noContext.has_structural_url).toBe(false);
    expect(noContext.flags).toContain("opaque_url");
    expect(a2).toEqual(a1);
  });
});
