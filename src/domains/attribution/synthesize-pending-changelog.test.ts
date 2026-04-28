import { describe, expect, it } from "vitest";

import {
  buildSyntheticPendingRows,
  LIFECYCLE_PENDING_SOURCE_SYSTEM,
  synthesizePendingChangelog,
} from "./synthesize-pending-changelog";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-ritz-founder";
const REC_ID = "create_cluster_page:geo:Los Altos";

function editStub(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: `${REC_ID}__add_h2_section__h2[new]:c75a1120a6aa`,
    tenant_id: TENANT,
    rec_id: REC_ID,
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/locations/los-altos",
    target_element_key: "h2[new]:c75a1120a6aa",
    display_label:
      'H2 heading (new): "Why teams choose us over De Mattei Construction"',
    current_text: null,
    proposed_text:
      "Why teams choose us over De Mattei Construction\nAn architect-led design-build approach keeps design, budget, and construction tightly coordinated…",
    why: "Establishes a clear positioning vs. competitors",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-04-25T19:15:18.778Z",
    updated_at: "2026-04-27T09:42:58.574Z",
    implementation_status: "accepted",
    live_at: null,
    not_found_reason: null,
    ...overrides,
  };
}

describe("synthesizePendingChangelog", () => {
  it("produces a ChangelogEntry-shaped record with the edit's deterministic id", () => {
    const edit = editStub();
    const synth = synthesizePendingChangelog(edit);
    expect(synth.id).toBe(edit.id);
    expect(synth.timestamp).toBe(edit.updated_at);
    expect(synth.url).toBe(edit.target_url);
    expect(synth.tenant_id).toBe(edit.tenant_id);
    expect(synth.live_at).toBeNull();
    expect(synth.archived).toBe(false);
  });

  it("uses display_label for asset_name when present, action_type fallback otherwise", () => {
    expect(
      synthesizePendingChangelog(editStub({ display_label: "Custom label" })).asset_name,
    ).toBe("Custom label");
    expect(
      synthesizePendingChangelog(editStub({ display_label: null })).asset_name,
    ).toBe("add_h2_section");
  });

  it("change_description is the proposed_text snippet (≤240 chars)", () => {
    const edit = editStub({ proposed_text: "x".repeat(500) });
    const synth = synthesizePendingChangelog(edit);
    expect(synth.change_description.length).toBeLessThanOrEqual(240);
  });

  it("change_description falls back to action_type when proposed_text is null", () => {
    const synth = synthesizePendingChangelog(
      editStub({ proposed_text: null, action_type: "add_h2_section" }),
    );
    expect(synth.change_description).toBe("add_h2_section");
  });

  it("source_system is the lifecycle_pending sentinel", () => {
    expect(synthesizePendingChangelog(editStub()).source_system).toBe(
      LIFECYCLE_PENDING_SOURCE_SYSTEM,
    );
  });

  it("source_rec_id + action_type + target_element_key match the edit (so the classifier join key resolves)", () => {
    const edit = editStub();
    const synth = synthesizePendingChangelog(edit);
    expect(synth.source_rec_id).toBe(edit.rec_id);
    expect(synth.action_type).toBe(edit.action_type);
    expect(synth.target_element_key).toBe(edit.target_element_key);
  });

  it("Los Altos H2 fixture produces a stable synthetic id", () => {
    const synth = synthesizePendingChangelog(editStub());
    expect(synth.id).toBe(
      `${REC_ID}__add_h2_section__h2[new]:c75a1120a6aa`,
    );
  });
});

describe("buildSyntheticPendingRows", () => {
  it("returns empty array when no pending edits", () => {
    const result = buildSyntheticPendingRows({
      changelogEntries: [],
      pendingEdits: [],
    });
    expect(result).toEqual([]);
  });

  it("returns one synthetic row for an edit with no matching changelog row", () => {
    const result = buildSyntheticPendingRows({
      changelogEntries: [],
      pendingEdits: [editStub({ id: "e1" })],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    expect(result[0].source_system).toBe(LIFECYCLE_PENDING_SOURCE_SYSTEM);
  });

  it("skips edits that already have a matching changelog row by id", () => {
    const existingChangelog: ChangelogEntry = {
      id: "e1",
      timestamp: "2026-04-27T00:00:00Z",
      signal_type: "content",
      asset_type: "service_page",
      url: "x",
      asset_name: "x",
      change_description: "x",
      topic_targeted: "x",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "x",
      updated_at: "x",
      tenant_id: TENANT,
    };
    const result = buildSyntheticPendingRows({
      changelogEntries: [existingChangelog],
      pendingEdits: [editStub({ id: "e1" })],
    });
    expect(result).toEqual([]);
  });

  it("skips edits that match by join key (rec_id + action_type + target_element_key)", () => {
    const existingChangelog: ChangelogEntry = {
      id: "different-id-but-same-join-key",
      timestamp: "2026-04-27T00:00:00Z",
      signal_type: "content",
      asset_type: "service_page",
      url: "x",
      asset_name: "x",
      change_description: "x",
      topic_targeted: "x",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "x",
      updated_at: "x",
      tenant_id: TENANT,
      source_rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:c75a1120a6aa",
    };
    const result = buildSyntheticPendingRows({
      changelogEntries: [existingChangelog],
      pendingEdits: [editStub({ id: "e1" })],
    });
    expect(result).toEqual([]);
  });

  it("Los Altos production scenario: 5 pending edits, 0 changelog rows → 5 synthetic", () => {
    const losAltosEdits: RecommendedEditRow[] = [
      editStub({ id: "h2", action_type: "add_h2_section", target_element_key: "h2[new]:c75" }),
      editStub({ id: "fq1", action_type: "add_faq", target_element_key: "faq_question[new]:d1" }),
      editStub({ id: "fq2", action_type: "add_faq", target_element_key: "faq_question[new]:f2" }),
      editStub({ id: "fq3", action_type: "add_faq", target_element_key: "faq_question[new]:93" }),
      editStub({ id: "fq4", action_type: "add_faq", target_element_key: "faq_question[new]:ff" }),
    ];
    const result = buildSyntheticPendingRows({
      changelogEntries: [],
      pendingEdits: losAltosEdits,
    });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.id)).toEqual(["h2", "fq1", "fq2", "fq3", "fq4"]);
  });

  it("Whole Home Remodel mixed scenario: 3 edits, 3 changelog rows → 0 synthetic", () => {
    const whrEdits: RecommendedEditRow[] = [
      editStub({
        id: "h2",
        rec_id:
          "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)",
        action_type: "add_h2_section",
        target_element_key: "h2[new]:abc",
      }),
    ];
    const existingChangelog: ChangelogEntry = {
      id: "h2",
      timestamp: "2026-04-27T00:00:00Z",
      signal_type: "content",
      asset_type: "service_page",
      url: "x",
      asset_name: "x",
      change_description: "x",
      topic_targeted: "x",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "x",
      updated_at: "x",
      tenant_id: TENANT,
    };
    const result = buildSyntheticPendingRows({
      changelogEntries: [existingChangelog],
      pendingEdits: whrEdits,
    });
    expect(result).toEqual([]);
  });

  it("idempotent: same inputs produce same output ids in same order", () => {
    const inputs = {
      changelogEntries: [],
      pendingEdits: [
        editStub({ id: "a", target_element_key: "a" }),
        editStub({ id: "b", target_element_key: "b" }),
      ],
    };
    const r1 = buildSyntheticPendingRows(inputs);
    const r2 = buildSyntheticPendingRows(inputs);
    expect(r1.map((r) => r.id)).toEqual(r2.map((r) => r.id));
  });
});
