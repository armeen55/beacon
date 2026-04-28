import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_BAKE_DAYS,
  EVIDENCE_FRESHNESS_NULL_COPY,
  resolveAttributionCopy,
  type StoredOutcomeLike,
} from "./lifecycle-attribution-copy";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const REC_ID = "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)";
const TENANT = "tenant-ritz-founder";
const NOW = new Date("2026-04-28T12:00:00Z");

function entryStub(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    id: "cl-test",
    timestamp: "2026-04-27T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    asset_name: "Whole Home Remodel",
    change_description: "Test",
    topic_targeted: "whole-home",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-27T00:00:00Z",
    updated_at: "2026-04-27T00:00:00Z",
    tenant_id: TENANT,
    ...overrides,
  };
}

function editStub(overrides: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: `${REC_ID}__add_h2_section__h2[new]:abc`,
    tenant_id: TENANT,
    rec_id: REC_ID,
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    target_element_key: "h2[new]:abc",
    display_label: null,
    current_text: null,
    proposed_text: "Test",
    why: "Test",
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
    created_at: "2026-04-27T00:00:00Z",
    updated_at: "2026-04-27T00:00:00Z",
    implementation_status: "accepted",
    live_at: null,
    not_found_reason: null,
    ...overrides,
  };
}

describe("Rule 1: verified_live within bake window → too_early", () => {
  it("returns 'Too early — verdict pending' for verified_live with live_at < 7d", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: "2026-04-28T05:26:26Z" }),
      edit: editStub({
        implementation_status: "verified_live",
        live_at: "2026-04-28T05:26:26Z",
      }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("verified_live_too_early");
    expect(c.label).toBe("Too early — verdict pending");
    expect(c.tooltip).toContain("more post-change observations");
    expect(c.tone).toBe("accent");
  });

  it("treats verified_live_modified the same way", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: "2026-04-28T00:00:00Z" }),
      edit: editStub({
        implementation_status: "verified_live_modified",
        live_at: "2026-04-28T00:00:00Z",
      }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("verified_live_too_early");
  });

  it("Whole Home Remodel H2 production fixture → too_early", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({
        id: "cl-mogzw78nv8pu54",
        live_at: "2026-04-28T05:26:26.05+00:00",
      }),
      edit: editStub({
        implementation_status: "verified_live",
        live_at: "2026-04-28T05:26:26.05+00:00",
      }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.label).toBe("Too early — verdict pending");
  });
});

describe("Rule 2: verified_live past bake window AND verdict flag OFF → verdict_off", () => {
  it("returns 'Verdict tracking off' when live_at is ≥7d ago and flag disabled", () => {
    const longAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: longAgo }),
      edit: editStub({ implementation_status: "verified_live", live_at: longAgo }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("verified_live_verdict_off");
    expect(c.label).toBe("Verdict tracking off");
    expect(c.tooltip).toContain("BEACON_LIFECYCLE_VERDICT_ENABLED");
  });
});

describe("Rule 3: verified_live past bake window AND verdict flag ON → verdict_baked", () => {
  it("returns 'Verdict pending' when bake elapsed and flag is on", () => {
    const longAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: longAgo }),
      edit: editStub({ implementation_status: "verified_live", live_at: longAgo }),
      verdictFlagEnabled: true,
      now: NOW,
    });
    expect(c.branch).toBe("verified_live_baked");
    expect(c.label).toBe("Verdict pending");
  });
});

describe("Rule 4: accepted with no live_at → pending_implementation", () => {
  it("returns 'Waiting on implementation' for accepted edits", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: null }),
      edit: editStub({ implementation_status: "accepted", live_at: null }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("pending_implementation");
    expect(c.label).toBe("Waiting on implementation");
    expect(c.tooltip).toContain("Once it is added to the site");
  });
});

describe("Rule 5: not_found_after_7d → not_implemented", () => {
  it("returns 'Not implemented' for edits in not_found_after_7d", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: null }),
      edit: editStub({ implementation_status: "not_found_after_7d", live_at: null }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("not_implemented");
    expect(c.label).toBe("Not implemented");
  });
});

describe("Rule 6: stored outcome routes through outcome-specific labels", () => {
  it("status=computed → 'Computed'", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      edit: null,
      outcome: { status: "computed" } satisfies StoredOutcomeLike,
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("outcome_computed");
    expect(c.label).toBe("Computed");
    expect(c.tone).toBe("success");
  });

  it("status=weak_estimate → 'Weak estimate'", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      edit: null,
      outcome: { status: "weak_estimate" },
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("outcome_weak_estimate");
  });

  it("status=insufficient_post_data → 'No post-window yet'", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      edit: null,
      outcome: { status: "insufficient_post_data" },
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.label).toBe("No post-window yet");
  });

  it("unknown status → 'Other'", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      edit: null,
      outcome: { status: "zero_signal" },
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("outcome_other");
  });

  it("verified-live row's bake-window status WINS over a stale outcome", () => {
    // A stale outcome from a prior pass must NOT override the
    // "Too early" treatment of a freshly verified-live row.
    const c = resolveAttributionCopy({
      entry: entryStub({ live_at: "2026-04-28T00:00:00Z" }),
      edit: editStub({
        implementation_status: "verified_live",
        live_at: "2026-04-28T00:00:00Z",
      }),
      outcome: { status: "computed" },
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("verified_live_too_early");
  });
});

describe("Rule 7: imported legacy (no outcome) → legacy fallback", () => {
  it("source_system=pdf_changelog_rebuild → imported_legacy", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ source_system: "pdf_changelog_rebuild" }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("imported_legacy");
    expect(c.label).toBe("Legacy — no eligible window");
  });

  it("source_system=import → imported_legacy", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ source_system: "import" }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("imported_legacy");
  });

  it("import_batch_id alone → imported_legacy", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ import_batch_id: "import-1776222344423" }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("imported_legacy");
  });

  it("classifier cls=imported_legacy alone (no source field) → imported_legacy", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      cls: "imported_legacy",
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("imported_legacy");
  });
});

describe("Rule 8: scan-confirmed (no outcome) → measuring", () => {
  it("source_system=scan_detection → scan_confirmed_measuring", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ source_system: "scan_detection" }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("scan_confirmed_measuring");
    expect(c.label).toBe("Scan-confirmed — measuring");
  });

  it("source_system=scan_promoted → scan_confirmed_measuring", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ source_system: "scan_promoted" }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("scan_confirmed_measuring");
  });

  it("classifier cls=scan_confirmed alone → scan_confirmed_measuring", () => {
    const c = resolveAttributionCopy({
      entry: entryStub(),
      cls: "scan_confirmed",
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("scan_confirmed_measuring");
  });
});

describe("Rule 9: fallback → verdict_pending", () => {
  it("rows with no edit, no outcome, no source class → verdict_pending", () => {
    const c = resolveAttributionCopy({
      entry: entryStub({ source_system: undefined, import_batch_id: undefined }),
      verdictFlagEnabled: false,
      now: NOW,
    });
    expect(c.branch).toBe("verdict_pending");
    expect(c.label).toBe("Verdict pending");
  });
});

describe("ATTRIBUTION_BAKE_DAYS constant", () => {
  it("is 7 days (matches engine's not_found_after_7d promotion window)", () => {
    expect(ATTRIBUTION_BAKE_DAYS).toBe(7);
  });
});

describe("EVIDENCE_FRESHNESS_NULL_COPY", () => {
  it("does not contain the retired 'no citation evidence has been built' phrase", () => {
    const all = `${EVIDENCE_FRESHNESS_NULL_COPY.label("test")} ${EVIDENCE_FRESHNESS_NULL_COPY.detail}`;
    expect(all).not.toContain("no citation evidence has been built yet");
    expect(all).not.toContain("wait for the first native-poll integration");
  });

  it("acknowledges native polling is alive (post-pivot honest framing)", () => {
    const detail = EVIDENCE_FRESHNESS_NULL_COPY.detail;
    expect(detail).toContain("native");
  });
});
