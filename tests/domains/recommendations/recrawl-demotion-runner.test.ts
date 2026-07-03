/**
 * N13 recrawl demotion runner (2026-07-03): the tenant I/O shell. Pins:
 *   • a resolved rec is marked `expired` with the honest note stamped on `why`;
 *   • a queue with nothing resolved makes ZERO writes (byte-identical);
 *   • a sync failure is captured, not thrown.
 */

import { describe, expect, it } from "vitest";

import { demoteResolvedForTenant } from "@/domains/recommendations/recrawl-demotion-runner";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PageSnapshot } from "@/domains/pages/types";

function row(o: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "t",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: "Persian Koobideh Kabob Recipe",
    why: "original why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    implementation_status: "recommended",
    ...o,
  };
}

function snap(o: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "p-1",
    url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    canonical_url: null,
    fetched_at: "2026-07-03T00:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "t",
    ...o,
  };
}

describe("demoteResolvedForTenant", () => {
  it("retires a resolved rec: expired + honest note on why", async () => {
    let persisted: RecommendedEditRow[] = [];
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row()],
      loadSnapshots: async () => [snap({ title: "Persian Koobideh Kabob Recipe" })],
      persistLocal: async (rows) => {
        persisted = rows;
      },
      syncRows: async () => {},
    });
    expect(r.retired).toBe(1);
    expect(r.sync_warning).toBeNull();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.implementation_status).toBe("expired");
    expect(persisted[0]!.why).toBe(
      'You already fixed this. I retired it. Your title now reads "Persian Koobideh Kabob Recipe".',
    );
  });

  it("makes zero writes when nothing is resolved (byte-identical)", async () => {
    let persistCalled = false;
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row()],
      loadSnapshots: async () => [snap({ title: "A completely different title" })],
      persistLocal: async () => {
        persistCalled = true;
      },
      syncRows: async () => {
        persistCalled = true;
      },
    });
    expect(r.retired).toBe(0);
    expect(persistCalled).toBe(false);
  });

  it("captures a sync failure instead of throwing", async () => {
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row()],
      loadSnapshots: async () => [snap({ title: "Persian Koobideh Kabob Recipe" })],
      persistLocal: async () => {},
      syncRows: async () => {
        throw new Error("supabase down");
      },
    });
    expect(r.retired).toBe(1);
    expect(r.sync_warning).toBe("supabase down");
  });
});
