import { describe, it, expect } from "vitest";

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "../recommended-edits-persistence";
import {
  computeAcceptedAtMs,
  computeReconciliationFlips,
} from "./reconcile";

const TENANT = "tenant-test";

function makeEdit(
  id: string,
  recId: string,
  status?: RecommendedEditRow["implementation_status"],
  updatedAt = "2026-04-27T00:00:00.000Z",
): RecommendedEditRow {
  return {
    id,
    tenant_id: TENANT,
    rec_id: recId,
    action_type: "edit_title",
    target_url: "https://example.com/x",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "x",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: "deterministic",
    evidence_hash: "h",
    model: null,
    cost_usd: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    implementation_status: status,
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
  };
}

function makeResponse(
  recId: string,
  status: RecommendationResponse["status"],
  respondedAt: string,
): RecommendationResponse {
  return {
    recId,
    status,
    respondedAt,
    deferUntil: null,
  };
}

function makeChangelog(
  id: string,
  sourceRecId: string | undefined,
  timestamp: string,
): ChangelogEntry {
  return {
    id,
    tenant_id: TENANT,
    timestamp,
    signal_type: "content",
    asset_type: "service_page",
    url: "https://example.com/x",
    asset_name: "x",
    change_description: "x",
    topic_targeted: "x",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
    source_rec_id: sourceRecId,
  };
}

describe("computeReconciliationFlips", () => {
  it("flips edits whose rec has an accepted recommendation_response", () => {
    const ids = computeReconciliationFlips({
      edits: [
        makeEdit("e1", "rec-A", "recommended"),
        makeEdit("e2", "rec-A", "recommended"),
        makeEdit("e3", "rec-B", "recommended"),
      ],
      responses: [makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z")],
      changelog: [],
    });
    expect(ids.sort()).toEqual(["e1", "e2"]);
  });

  it("flips edits whose rec has a changelog entry with source_rec_id", () => {
    const ids = computeReconciliationFlips({
      edits: [makeEdit("e1", "rec-A", "recommended")],
      responses: [],
      changelog: [makeChangelog("cl1", "rec-A", "2026-04-27T00:00:00Z")],
    });
    expect(ids).toEqual(["e1"]);
  });

  it("flips edits with EITHER source (response OR changelog) — union semantics", () => {
    const ids = computeReconciliationFlips({
      edits: [
        makeEdit("e1", "rec-A", "recommended"),
        makeEdit("e2", "rec-B", "recommended"),
      ],
      responses: [makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z")],
      changelog: [makeChangelog("cl1", "rec-B", "2026-04-27T00:00:00Z")],
    });
    expect(ids.sort()).toEqual(["e1", "e2"]);
  });

  it("does NOT flip edits already in accepted / verified_live / dismissed", () => {
    const ids = computeReconciliationFlips({
      edits: [
        makeEdit("e1", "rec-A", "accepted"),
        makeEdit("e2", "rec-A", "verified_live"),
        makeEdit("e3", "rec-A", "dismissed"),
        makeEdit("e4", "rec-A", "needs_review"),
        makeEdit("e5", "rec-A", "wrong_page"),
      ],
      responses: [makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z")],
      changelog: [],
    });
    expect(ids).toEqual([]);
  });

  it("treats undefined implementation_status (legacy file rows) as 'recommended'", () => {
    const ids = computeReconciliationFlips({
      edits: [makeEdit("e1", "rec-A", undefined)],
      responses: [makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z")],
      changelog: [],
    });
    expect(ids).toEqual(["e1"]);
  });

  it("ignores deferred / dismissed responses (only 'accepted' counts)", () => {
    const ids = computeReconciliationFlips({
      edits: [
        makeEdit("e1", "rec-A", "recommended"),
        makeEdit("e2", "rec-B", "recommended"),
      ],
      responses: [
        makeResponse("rec-A", "deferred", "2026-04-27T00:00:00Z"),
        makeResponse("rec-B", "dismissed", "2026-04-27T00:00:00Z"),
      ],
      changelog: [],
    });
    expect(ids).toEqual([]);
  });

  it("ignores changelog entries whose source_rec_id is null/empty", () => {
    const ids = computeReconciliationFlips({
      edits: [makeEdit("e1", "rec-A", "recommended")],
      responses: [],
      changelog: [
        makeChangelog("cl1", undefined, "2026-04-27T00:00:00Z"),
        makeChangelog("cl2", "", "2026-04-27T00:00:00Z"),
      ],
    });
    expect(ids).toEqual([]);
  });

  it("idempotent — re-running on a fully-consistent set returns []", () => {
    // After the first reconciliation pass, all eligible edits would be
    // marked accepted — running again should return nothing.
    const ids = computeReconciliationFlips({
      edits: [
        makeEdit("e1", "rec-A", "accepted"),
        makeEdit("e2", "rec-B", "accepted"),
      ],
      responses: [
        makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z"),
        makeResponse("rec-B", "accepted", "2026-04-27T00:00:00Z"),
      ],
      changelog: [],
    });
    expect(ids).toEqual([]);
  });

  it("does not mutate input arrays", () => {
    const edits = [makeEdit("e1", "rec-A", "recommended")];
    const responses = [makeResponse("rec-A", "accepted", "2026-04-27T00:00:00Z")];
    const changelog: ChangelogEntry[] = [];
    Object.freeze(edits);
    Object.freeze(responses);
    Object.freeze(changelog);
    expect(() =>
      computeReconciliationFlips({ edits, responses, changelog }),
    ).not.toThrow();
  });
});

describe("computeAcceptedAtMs", () => {
  it("uses earliest changelog timestamp when present", () => {
    const edit = makeEdit("e1", "rec-A");
    const responses = [
      makeResponse("rec-A", "accepted", "2026-04-26T12:00:00Z"),
    ];
    const changelog = [
      makeChangelog("cl1", "rec-A", "2026-04-25T10:00:00Z"),
      makeChangelog("cl2", "rec-A", "2026-04-25T08:00:00Z"), // earlier
      makeChangelog("cl3", "rec-A", "2026-04-25T11:00:00Z"),
    ];
    expect(computeAcceptedAtMs(edit, responses, changelog)).toBe(
      Date.parse("2026-04-25T08:00:00Z"),
    );
  });

  it("falls back to recommendation_response.respondedAt when no changelog", () => {
    const edit = makeEdit("e1", "rec-A");
    const responses = [
      makeResponse("rec-A", "accepted", "2026-04-26T12:00:00Z"),
    ];
    expect(computeAcceptedAtMs(edit, responses, [])).toBe(
      Date.parse("2026-04-26T12:00:00Z"),
    );
  });

  it("falls back to edit.updated_at as last resort", () => {
    const edit = makeEdit(
      "e1",
      "rec-A",
      "accepted",
      "2026-04-20T00:00:00Z",
    );
    expect(computeAcceptedAtMs(edit, [], [])).toBe(
      Date.parse("2026-04-20T00:00:00Z"),
    );
  });

  it("ignores changelog entries whose source_rec_id doesn't match", () => {
    const edit = makeEdit("e1", "rec-A", "accepted", "2026-04-27T00:00:00Z");
    const changelog = [
      makeChangelog("cl1", "rec-OTHER", "2026-04-20T00:00:00Z"),
    ];
    expect(computeAcceptedAtMs(edit, [], changelog)).toBe(
      Date.parse("2026-04-27T00:00:00Z"),
    );
  });
});
