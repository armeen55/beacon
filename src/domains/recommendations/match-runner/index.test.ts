import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { RecommendedEditRow } from "../recommended-edits-persistence";

// ── Mocks ────────────────────────────────────────────────────────────────

const flagMocks = vi.hoisted(() => ({
  isLifecycleEnabled: vi.fn<() => boolean>(),
}));
vi.mock("@/lib/flags", () => ({
  isLifecycleEnabled: flagMocks.isLifecycleEnabled,
  // Other flags consumed indirectly — provide stubs
  isEventTruthPreviewEnabled: () => false,
  isSchemaAutoPromoteEnabled: () => false,
  isFindingAutoLinkEnabled: () => false,
}));

const repoData = vi.hoisted(() => ({
  edits: [] as RecommendedEditRow[],
  responses: [] as RecommendationResponse[],
  changelog: [] as ChangelogEntry[],
  pageSnapshots: [] as PageSnapshot[],
  inventory: [] as PageElementInventoryRow[],
}));

const repoMocks = vi.hoisted(() => ({
  getRecommendedEdits: vi.fn<() => Promise<RecommendedEditRow[]>>(),
  getRecommendationResponses: vi.fn<() => Promise<RecommendationResponse[]>>(),
  getChangelogEntries: vi.fn<() => Promise<ChangelogEntry[]>>(),
  getPageSnapshots: vi.fn<() => Promise<PageSnapshot[]>>(),
  getPageElementInventory: vi.fn<() => Promise<PageElementInventoryRow[]>>(),
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => repoMocks,
  }),
}));

const persistMocks = vi.hoisted(() => ({
  persistLifecycleUpdates: vi.fn<
    (rows: ReadonlyArray<RecommendedEditRow>, tenantId: string) => Promise<void>
  >(),
  persistChangelogLiveAt: vi.fn<
    (
      updates: ReadonlyArray<{ changelogId: string; liveAt: string }>,
      changelog: ReadonlyArray<ChangelogEntry>,
      tenantId: string,
    ) => Promise<number>
  >(),
}));

vi.mock("./persist", () => ({
  persistLifecycleUpdates: persistMocks.persistLifecycleUpdates,
  persistChangelogLiveAt: persistMocks.persistChangelogLiveAt,
}));

const markAcceptedMock = vi.hoisted(() => ({
  fn: vi.fn<
    (args: {
      editIds: ReadonlyArray<string>;
      tenantId: string;
      now?: Date;
    }) => Promise<{ flipped: number; skipped: number }>
  >(),
}));

vi.mock("../recommended-edits-persistence", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    markRecommendedEditsAccepted: markAcceptedMock.fn,
  };
});

// Import AFTER mocks.
import { runLifecycleMatchAgainstScan } from "./index";

// ── Fixture helpers ──────────────────────────────────────────────────────

const TENANT = "tenant-test";
const TARGET_URL = "https://example.com/services/braces";
const NOW = new Date("2026-04-27T12:00:00.000Z");

function makeEdit(over: Partial<RecommendedEditRow> & { id: string; rec_id: string }): RecommendedEditRow {
  return {
    tenant_id: TENANT,
    action_type: "edit_title",
    target_url: TARGET_URL,
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: "Hello",
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
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:00:00.000Z",
    implementation_status: "accepted",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  };
}

function makeInv(over: {
  element_type: PageElementInventoryRow["element_type"];
  element_key: string;
  element_text: string | null;
  url?: string;
  snapshot_id?: string;
}): PageElementInventoryRow {
  return {
    id: `${over.snapshot_id ?? "snap-1"}__${over.element_key}`,
    tenant_id: TENANT,
    page_id: "p",
    url: over.url ?? TARGET_URL,
    element_type: over.element_type,
    element_key: over.element_key,
    display_label: over.element_key,
    element_text: over.element_text,
    element_metadata: {},
    extractor_version: 1,
    observed_at: NOW.toISOString(),
    source_snapshot_id: over.snapshot_id ?? "snap-1",
  };
}

function makeSnap(url: string, id: string, fetchedAt: string): PageSnapshot {
  return {
    id,
    page_id: "p",
    url,
    canonical_url: null,
    fetched_at: fetchedAt,
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
    observation_run_id: "obs-1",
    tenant_id: TENANT,
  };
}

function makeChangelog(over: {
  id: string;
  source_rec_id?: string;
  target_element_key?: string;
  timestamp?: string;
  live_at?: string | null;
}): ChangelogEntry {
  return {
    id: over.id,
    tenant_id: TENANT,
    timestamp: over.timestamp ?? "2026-04-20T00:00:00.000Z",
    signal_type: "content",
    asset_type: "service_page",
    url: TARGET_URL,
    asset_name: "x",
    change_description: "x",
    topic_targeted: "x",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:00:00.000Z",
    source_rec_id: over.source_rec_id,
    target_element_key: over.target_element_key,
    live_at: over.live_at ?? null,
  };
}

function setRepoData() {
  repoMocks.getRecommendedEdits.mockResolvedValue([...repoData.edits]);
  repoMocks.getRecommendationResponses.mockResolvedValue([...repoData.responses]);
  repoMocks.getChangelogEntries.mockResolvedValue([...repoData.changelog]);
  repoMocks.getPageSnapshots.mockResolvedValue([...repoData.pageSnapshots]);
  repoMocks.getPageElementInventory.mockResolvedValue([...repoData.inventory]);
}

beforeEach(() => {
  flagMocks.isLifecycleEnabled.mockReset();
  flagMocks.isLifecycleEnabled.mockReturnValue(true);
  for (const k of ["edits", "responses", "changelog", "pageSnapshots", "inventory"] as const) {
    repoData[k] = [] as never;
  }
  for (const m of Object.values(repoMocks)) m.mockReset();
  setRepoData();
  persistMocks.persistLifecycleUpdates.mockReset();
  persistMocks.persistLifecycleUpdates.mockResolvedValue(undefined);
  persistMocks.persistChangelogLiveAt.mockReset();
  persistMocks.persistChangelogLiveAt.mockResolvedValue(0);
  markAcceptedMock.fn.mockReset();
  markAcceptedMock.fn.mockResolvedValue({ flipped: 0, skipped: 0 });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("runLifecycleMatchAgainstScan — flag gating", () => {
  it("flag OFF → byte-identical no-op (no repo reads, no writes)", async () => {
    flagMocks.isLifecycleEnabled.mockReturnValue(false);
    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.ranSuccessfully).toBe(false);
    expect(result.skippedReason).toBe("flag_disabled");
    expect(repoMocks.getRecommendedEdits).not.toHaveBeenCalled();
    expect(repoMocks.getPageSnapshots).not.toHaveBeenCalled();
    expect(persistMocks.persistLifecycleUpdates).not.toHaveBeenCalled();
    expect(persistMocks.persistChangelogLiveAt).not.toHaveBeenCalled();
    expect(markAcceptedMock.fn).not.toHaveBeenCalled();
  });

  it("flag ON + no edits → early-exit no-op", async () => {
    setRepoData(); // empty
    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.ranSuccessfully).toBe(true);
    expect(result.skippedReason).toBe("no_edits");
    expect(persistMocks.persistLifecycleUpdates).not.toHaveBeenCalled();
  });
});

describe("runLifecycleMatchAgainstScan — reconciliation pre-pass", () => {
  it("flips recommended → accepted when recommendation_response is accepted", async () => {
    repoData.edits = [
      makeEdit({ id: "e1", rec_id: "rec-A", implementation_status: "recommended" }),
    ];
    repoData.responses = [
      { recId: "rec-A", status: "accepted", respondedAt: NOW.toISOString(), deferUntil: null },
    ];
    setRepoData();
    await runLifecycleMatchAgainstScan({ tenantId: TENANT, now: NOW });
    expect(markAcceptedMock.fn).toHaveBeenCalledTimes(1);
    expect(markAcceptedMock.fn.mock.calls[0]![0].editIds).toEqual(["e1"]);
  });

  it("flips recommended → accepted when changelog entry has source_rec_id", async () => {
    repoData.edits = [
      makeEdit({ id: "e1", rec_id: "rec-A", implementation_status: "recommended" }),
    ];
    repoData.changelog = [
      makeChangelog({ id: "cl1", source_rec_id: "rec-A" }),
    ];
    setRepoData();
    await runLifecycleMatchAgainstScan({ tenantId: TENANT, now: NOW });
    expect(markAcceptedMock.fn).toHaveBeenCalledTimes(1);
    expect(markAcceptedMock.fn.mock.calls[0]![0].editIds).toEqual(["e1"]);
  });

  it("does NOT call markRecommendedEditsAccepted when nothing to reconcile", async () => {
    repoData.edits = [
      makeEdit({ id: "e1", rec_id: "rec-A", implementation_status: "accepted" }),
    ];
    setRepoData();
    await runLifecycleMatchAgainstScan({ tenantId: TENANT, now: NOW });
    expect(markAcceptedMock.fn).not.toHaveBeenCalled();
  });
});

describe("runLifecycleMatchAgainstScan — match → status update + live_at", () => {
  it("accepted edit + exact H2 match → verified_live + live_at + live_snapshot_id + changelog live_at", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "add_h2_section",
        target_element_key: "h2[new]:h",
        proposed_text: "Why hire a Palo Alto custom home builder",
        implementation_status: "accepted",
      }),
    ];
    repoData.changelog = [
      makeChangelog({
        id: "cl-e1",
        source_rec_id: "rec-A",
        target_element_key: "h2[new]:h",
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "h2",
        element_key: "h2[0]:e1",
        element_text: "Why hire a Palo Alto custom home builder",
      }),
    ];
    setRepoData();
    persistMocks.persistChangelogLiveAt.mockResolvedValue(1);

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });

    expect(result.ranSuccessfully).toBe(true);
    expect(result.evaluated).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.liveAtStamped).toBe(1);

    const writtenRows = persistMocks.persistLifecycleUpdates.mock.calls[0]![0];
    expect(writtenRows.length).toBe(1);
    expect(writtenRows[0]!.implementation_status).toBe("verified_live");
    expect(writtenRows[0]!.live_at).toBe(NOW.toISOString());
    expect(writtenRows[0]!.live_snapshot_id).toBe("snap-1");

    const liveAtCall = persistMocks.persistChangelogLiveAt.mock.calls[0]!;
    expect(liveAtCall[0]).toEqual([
      { changelogId: "cl-e1", liveAt: NOW.toISOString() },
    ]);
  });

  it("modified H2 match → verified_live_modified", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "add_h2_section",
        proposed_text: "Why hire a Palo Alto custom home builder",
        implementation_status: "accepted",
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "h2",
        element_key: "h2[0]:e1",
        element_text: "Why work with a Palo Alto custom home builder",
      }),
    ];
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(1);
    expect(
      persistMocks.persistLifecycleUpdates.mock.calls[0]![0][0]!.implementation_status,
    ).toBe("verified_live_modified");
  });

  it("wrong-page match → wrong_page status (does NOT stamp live_at)", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "add_h2_section",
        target_url: TARGET_URL,
        proposed_text: "Why hire a Palo Alto custom home builder",
        implementation_status: "accepted",
      }),
    ];
    repoData.pageSnapshots = [
      makeSnap(TARGET_URL, "snap-target", NOW.toISOString()),
      makeSnap(
        "https://example.com/locations/palo-alto",
        "snap-other",
        NOW.toISOString(),
      ),
    ];
    repoData.inventory = [
      makeInv({
        element_type: "h2",
        element_key: "h2[0]:on",
        element_text: "Different content",
        url: TARGET_URL,
        snapshot_id: "snap-target",
      }),
      makeInv({
        element_type: "h2",
        element_key: "h2[0]:off",
        element_text: "Why hire a Palo Alto custom home builder",
        url: "https://example.com/locations/palo-alto",
        snapshot_id: "snap-other",
      }),
    ];
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(1);
    const updated = persistMocks.persistLifecycleUpdates.mock.calls[0]![0][0]!;
    expect(updated.implementation_status).toBe("wrong_page");
    expect(persistMocks.persistChangelogLiveAt).not.toHaveBeenCalled();
  });

  it("FAQ Q+A both exact → both legs verified_live (separate edits, two live_at stamps)", async () => {
    const Q = "What permits are needed for a custom home in Palo Alto?";
    const A = "You need building, electrical, plumbing, grading permits.";
    repoData.edits = [
      makeEdit({
        id: "eQ",
        rec_id: "rec-A",
        action_type: "add_faq",
        target_element_key: "faq_question[new]:q",
        proposed_text: Q,
        implementation_status: "accepted",
      }),
      makeEdit({
        id: "eA",
        rec_id: "rec-A",
        action_type: "add_faq",
        target_element_key: "faq_answer[new]:a",
        proposed_text: A,
        implementation_status: "accepted",
      }),
    ];
    repoData.changelog = [
      makeChangelog({
        id: "cl-Q",
        source_rec_id: "rec-A",
        target_element_key: "faq_question[new]:q",
      }),
      makeChangelog({
        id: "cl-A",
        source_rec_id: "rec-A",
        target_element_key: "faq_answer[new]:a",
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "faq_question",
        element_key: "faq_question[0]:e",
        element_text: Q,
      }),
      makeInv({
        element_type: "faq_answer",
        element_key: "faq_answer[0]:e",
        element_text: A,
      }),
    ];
    setRepoData();
    persistMocks.persistChangelogLiveAt.mockResolvedValue(2);

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(2);
    const allUpdated = persistMocks.persistLifecycleUpdates.mock.calls[0]![0];
    expect(
      allUpdated.every((r) => r.implementation_status === "verified_live"),
    ).toBe(true);
  });

  it("not_found at age 6d → stays accepted, no write", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        proposed_text: "Hello",
        implementation_status: "accepted",
        updated_at: new Date(NOW.getTime() - 6 * 86400 * 1000).toISOString(),
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = []; // no candidates → not_found
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(0);
    expect(persistMocks.persistLifecycleUpdates).not.toHaveBeenCalled();
  });

  it("not_found at age 8d → flips to not_found_after_7d", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        proposed_text: "Hello",
        implementation_status: "accepted",
        updated_at: new Date(NOW.getTime() - 8 * 86400 * 1000).toISOString(),
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [];
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(1);
    expect(
      persistMocks.persistLifecycleUpdates.mock.calls[0]![0][0]!.implementation_status,
    ).toBe("not_found_after_7d");
  });

  it("idempotent: re-run on a verified_live row + still-matching inventory → no-op", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        proposed_text: "Hello",
        implementation_status: "verified_live",
        live_at: "2026-04-20T00:00:00Z",
        live_snapshot_id: "snap-prior",
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "title",
        element_key: "title[0]:e",
        element_text: "Hello",
      }),
    ];
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.evaluated).toBe(1);
    expect(result.updated).toBe(0);
    expect(persistMocks.persistLifecycleUpdates).not.toHaveBeenCalled();
  });

  it("higher confidence promotes needs_review → verified_live", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        proposed_text: "Hello",
        implementation_status: "needs_review",
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "title",
        element_key: "title[0]:e",
        element_text: "Hello",
      }),
    ];
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(1);
    expect(
      persistMocks.persistLifecycleUpdates.mock.calls[0]![0][0]!.implementation_status,
    ).toBe("verified_live");
  });

  it("never downgrades verified_live → not_found when inventory loses the element", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        proposed_text: "Hello",
        implementation_status: "verified_live",
        live_at: "2026-04-20T00:00:00Z",
        updated_at: new Date(NOW.getTime() - 30 * 86400 * 1000).toISOString(),
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = []; // would produce not_found
    setRepoData();

    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.updated).toBe(0);
    expect(persistMocks.persistLifecycleUpdates).not.toHaveBeenCalled();
  });

  it("does NOT stamp live_at on a changelog entry that already has one (idempotent)", async () => {
    repoData.edits = [
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        target_element_key: "title[0]:e",
        proposed_text: "Hello",
        implementation_status: "accepted",
      }),
    ];
    repoData.changelog = [
      makeChangelog({
        id: "cl-1",
        source_rec_id: "rec-A",
        target_element_key: "title[0]:e",
        live_at: "2026-04-20T00:00:00Z", // already stamped
      }),
    ];
    repoData.pageSnapshots = [makeSnap(TARGET_URL, "snap-1", NOW.toISOString())];
    repoData.inventory = [
      makeInv({
        element_type: "title",
        element_key: "title[0]:e",
        element_text: "Hello",
      }),
    ];
    setRepoData();

    await runLifecycleMatchAgainstScan({ tenantId: TENANT, now: NOW });
    expect(persistMocks.persistChangelogLiveAt).not.toHaveBeenCalled();
  });

  it("runner failure (repo throws) → returns ranSuccessfully:false with skippedReason='error', does not throw upward", async () => {
    repoMocks.getRecommendedEdits.mockRejectedValueOnce(new Error("db down"));
    const result = await runLifecycleMatchAgainstScan({
      tenantId: TENANT,
      now: NOW,
    });
    expect(result.ranSuccessfully).toBe(false);
    expect(result.skippedReason).toBe("error");
    expect(result.error).toMatch(/db down/);
  });
});
