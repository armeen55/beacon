import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 12 — behavioral test for acceptRecommendation's
// per-edit fan-out path. We mock the repository read + the dual-write
// helper so the test stays hermetic. Assertions:
//   - When N edits exist for the rec, N changelog entries are pushed.
//   - Each entry carries action_type + target_element_key + source_rec_id.
//   - syncChangelogEntries called with the exact N entries.
//   - When edits is empty, the legacy single-entry path runs and the
//     fan-out helper is NOT invoked.
//   - Read failure gracefully degrades to single-entry fallback.
// ---------------------------------------------------------------------------

// Hoisted mock state.
const mocks = vi.hoisted(() => {
  return {
    editsToReturn: [] as RecommendedEditRow[],
    editsRepoShouldThrow: false,
    syncChangelogEntries: vi.fn<(rows: unknown[]) => Promise<void>>(),
    writeStore: vi.fn(async () => undefined),
    changelogEntriesArr: [] as Record<string, unknown>[],
    persistResponses: vi.fn(async () => undefined),
    recordResponse: vi.fn(),
    ensureRecommendationResponsesSeeded: vi.fn(async () => undefined),
    revalidatePath: vi.fn(),
    syncRecommendationResponses: vi.fn(async () => undefined),
    createChangelogEntry: vi.fn(async () => ({
      success: true,
      changeId: "cl-legacy-1",
    })),
    updateChangelogHypothesis: vi.fn(async () => undefined),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    getRecommendedEdits: async () => {
      if (mocks.editsRepoShouldThrow) {
        throw new Error("simulated repo failure");
      }
      return mocks.editsToReturn;
    },
  }),
}));

vi.mock("@/lib/persistence/dual-write", async () => {
  return {
    syncChangelogEntries: mocks.syncChangelogEntries,
    syncRecommendationResponses: mocks.syncRecommendationResponses,
    isDualWriteEnabled: () => false,
  };
});

vi.mock("@/lib/persistence/json-store", () => ({
  writeStore: mocks.writeStore,
  readStore: () => [],
}));

vi.mock("@/lib/seed-data.server", () => ({
  changelogEntries: mocks.changelogEntriesArr,
  briefs: [],
  opportunities: [],
}));

vi.mock("@/domains/product/recommendation-response-store", () => ({
  recommendationResponses: [],
  recordResponse: mocks.recordResponse,
  persistResponses: mocks.persistResponses,
  ensureRecommendationResponsesSeeded: mocks.ensureRecommendationResponsesSeeded,
}));

vi.mock("@/domains/changelog/actions", () => ({
  createChangelogEntry: mocks.createChangelogEntry,
  updateChangelogHypothesis: mocks.updateChangelogHypothesis,
}));

// `generateId` is small + deterministic-ish; mock for stable ids.
let idCounter = 0;
vi.mock("@/lib/actions", () => ({
  generateId: (prefix: string) => `${prefix}-test-${++idCounter}`,
  now: () => "2026-04-24T12:00:00.000Z",
}));

import { acceptRecommendation } from "./actions";
import type { RecommendationActionPayload } from "./actions";

const STABLE_KEY = "rec-2026-04-24-1";
const URL_BRACES = "https://example.com/services/braces";

function makeEdit(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: `${STABLE_KEY}__edit_title__title[0]:hash-aaa`,
    tenant_id: "tenant-test",
    rec_id: STABLE_KEY,
    action_type: "edit_title",
    target_url: URL_BRACES,
    target_element_key: "title[0]:hash-aaa",
    display_label: "Title tag",
    current_text: "Braces · Acme",
    proposed_text: "Teen Braces · Acme",
    why: "Title missing cluster keywords.",
    evidence: [{ type: "prompt", promptId: "p-1" }],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: "deterministic",
    evidence_hash: "evhash-test-1234",
    model: null,
    cost_usd: null,
    created_at: "2026-04-24T10:00:00Z",
    updated_at: "2026-04-24T10:00:00Z",
    ...overrides,
  };
}

function basePayload(): RecommendationActionPayload {
  return {
    stableKey: STABLE_KEY,
    type: "strengthen_page_copy",
    title: "Strengthen Braces page",
    description: "Strengthen the Braces page with cluster keywords.",
    clusterLabel: "teen braces",
    clusterKind: "topic",
    resolution: {
      action: "strengthen_existing_page",
      motive: "improve_close_prompt",
      targetUrl: URL_BRACES,
      reasoning: "Brand absent on cluster prompts.",
      confidence: "medium",
    },
  };
}

describe("Phase 6A.1.12 — acceptRecommendation per-edit fan-out", () => {
  beforeEach(() => {
    mocks.editsToReturn = [];
    mocks.editsRepoShouldThrow = false;
    mocks.syncChangelogEntries.mockReset();
    mocks.syncChangelogEntries.mockResolvedValue();
    mocks.writeStore.mockReset();
    mocks.writeStore.mockResolvedValue(undefined);
    mocks.changelogEntriesArr.length = 0;
    mocks.createChangelogEntry.mockReset();
    mocks.createChangelogEntry.mockResolvedValue({
      success: true,
      changeId: "cl-legacy-1",
    });
    mocks.updateChangelogHypothesis.mockReset();
    mocks.updateChangelogHypothesis.mockResolvedValue(undefined);
    mocks.recordResponse.mockReset();
    mocks.persistResponses.mockReset();
    mocks.persistResponses.mockResolvedValue(undefined);
    mocks.ensureRecommendationResponsesSeeded.mockReset();
    mocks.ensureRecommendationResponsesSeeded.mockResolvedValue(undefined);
    mocks.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates N changelog entries — one per edit — when edits exist", async () => {
    mocks.editsToReturn = [
      makeEdit({
        id: `${STABLE_KEY}__edit_title__title[0]:hash-aaa`,
        action_type: "edit_title",
        target_element_key: "title[0]:hash-aaa",
      }),
      makeEdit({
        id: `${STABLE_KEY}__add_h2_section__h2[new]:abc`,
        action_type: "add_h2_section",
        target_element_key: "h2[new]:abc",
        current_text: null,
        proposed_text: "Why teams choose us",
        display_label: 'H2 heading (new): "Why teams choose us"',
        why: "Top competitor not mentioned in any H2.",
      }),
      makeEdit({
        id: `${STABLE_KEY}__add_faq__faq_question[new]:def`,
        action_type: "add_faq",
        target_element_key: "faq_question[new]:def",
        current_text: null,
        proposed_text: "Q: How long do braces take?\n\nA: …",
        display_label: 'New FAQ: "How long do braces take?"',
        why: "Question pattern not covered by any FAQ.",
      }),
    ];
    const result = await acceptRecommendation(basePayload());
    expect(result.success).toBe(true);
    expect(result.changeIds).toHaveLength(3);
    expect(result.changeId).toBe(result.changeIds?.[0]);
    expect(mocks.changelogEntriesArr).toHaveLength(3);
    // Legacy createChangelogEntry must NOT have been called.
    expect(mocks.createChangelogEntry).not.toHaveBeenCalled();
    // Dual-write called with exactly the 3 entries.
    expect(mocks.syncChangelogEntries).toHaveBeenCalledTimes(1);
    const dualWriteArgs = (
      mocks.syncChangelogEntries.mock.calls[0] as unknown as [
        Record<string, unknown>[],
      ]
    )[0];
    expect(dualWriteArgs).toHaveLength(3);
  });

  it("each fan-out entry carries action_type + target_element_key + source_rec_id", async () => {
    mocks.editsToReturn = [
      makeEdit({ action_type: "edit_title", target_element_key: "title[0]:x" }),
      makeEdit({
        action_type: "add_h2_section",
        target_element_key: "h2[new]:y",
      }),
    ];
    await acceptRecommendation(basePayload());
    expect(mocks.changelogEntriesArr).toHaveLength(2);
    for (const entry of mocks.changelogEntriesArr) {
      expect(entry.source_rec_id).toBe(STABLE_KEY);
      expect(entry.action_type).toBeTruthy();
      expect(entry.target_element_key).toBeTruthy();
    }
    expect(mocks.changelogEntriesArr[0].action_type).toBe("edit_title");
    expect(mocks.changelogEntriesArr[0].target_element_key).toBe(
      "title[0]:x",
    );
    expect(mocks.changelogEntriesArr[1].action_type).toBe("add_h2_section");
    expect(mocks.changelogEntriesArr[1].target_element_key).toBe(
      "h2[new]:y",
    );
  });

  it("fan-out entries include current/proposed text in notes", async () => {
    mocks.editsToReturn = [makeEdit()];
    await acceptRecommendation(basePayload());
    const notes = mocks.changelogEntriesArr[0].notes as string;
    expect(notes).toContain("Current:");
    expect(notes).toContain("Braces · Acme");
    expect(notes).toContain("Proposed:");
    expect(notes).toContain("Teen Braces · Acme");
    expect(notes).toContain("Evidence:");
  });

  it("LEGACY path: when no edits exist, single-entry createChangelogEntry runs and fan-out helper is NOT invoked", async () => {
    mocks.editsToReturn = [];
    const result = await acceptRecommendation(basePayload());
    expect(result.success).toBe(true);
    expect(mocks.createChangelogEntry).toHaveBeenCalledTimes(1);
    // Fan-out push didn't happen.
    expect(mocks.changelogEntriesArr).toHaveLength(0);
    // syncChangelogEntries comes from createChangelogEntry's own dual-
    // write — but that's mocked away in this test, so we just assert
    // the call did not come from the fan-out path.
    expect(mocks.syncChangelogEntries).not.toHaveBeenCalled();
  });

  it("graceful degrade: if repo read throws, accept falls back to single-entry path", async () => {
    mocks.editsRepoShouldThrow = true;
    const result = await acceptRecommendation(basePayload());
    expect(result.success).toBe(true);
    // Fan-out NOT invoked.
    expect(mocks.changelogEntriesArr).toHaveLength(0);
    // Legacy createChangelogEntry IS invoked.
    expect(mocks.createChangelogEntry).toHaveBeenCalledTimes(1);
  });

  it("filters edits by rec_id — edits for OTHER recs are ignored", async () => {
    mocks.editsToReturn = [
      makeEdit({ rec_id: "rec-OTHER", id: "rec-OTHER__edit_title__x" }),
      makeEdit({ rec_id: "rec-OTHER", id: "rec-OTHER__add_faq__y" }),
    ];
    const result = await acceptRecommendation(basePayload());
    // No edits matched THIS rec → legacy single-entry path.
    expect(mocks.createChangelogEntry).toHaveBeenCalledTimes(1);
    expect(result.changeIds).toBeUndefined();
  });
});
