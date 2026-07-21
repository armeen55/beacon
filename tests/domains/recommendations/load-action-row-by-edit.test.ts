/**
 * Pins the push-gate QA lookup (load-action-row-by-edit.ts) after the CORE
 * 100K collapse (2026-07-21): it no longer rebuilds the deleted
 * /recommendations table, it computes the deterministic QA verdict directly
 * for the ONE persisted edit the push gate asks about, returning the same
 * `{ detail: { qaVerdict } }` shape stage-change.ts reads (approve +
 * pushReadiness are the publish gate's only inputs).
 *
 * Null parity contract: the lookup returns null exactly where the old table
 * emitted no row (unknown edit, dismissed rec, deferred-active rec, dismissed
 * edit, answer-side FAQ edit, orphan FAQ question), which keeps the push
 * gate's lenient fallback behavior unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type QueueItem = {
  rec: Record<string, unknown>;
  response: Record<string, unknown> | null;
  edits: Array<Record<string, unknown>>;
};

let _queue: QueueItem[] = [];
vi.mock("@/domains/recommendations/load-queue", () => ({
  loadPersistedRecommendationQueueForPage: async () => ({ queue: _queue }),
}));
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: async () => ({
    name: "Iranopedia",
    locations: ["Tehran", "Kashan"],
    services: [],
  }),
}));

import { loadActionRowByEditId } from "@/domains/recommendations/load-action-row-by-edit";

const PAGE_URL = "https://www.iranopedia.com/kashan-travel-guide";

/** A scored, on-topic generation-time fit (the QA's preferred authority). */
const TOPIC_FIT = {
  pageTopic: "kashan travel guide",
  queryIntent: "plan a visit to kashan",
  intentClass: "informational",
  topicMatchScore: 82,
  intentMatchScore: 78,
  matchExplanation: "The page covers the query topic directly.",
  mismatchRisks: [],
  shouldUseQueryForOptimization: true,
};

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stableKey: "rec-1",
    evidence: {
      observationCount: 0,
      promptCount: 0,
      brandPrimaryPromptCount: 0,
      primaryCompetitors: [],
      dominantCompetitors: [],
    },
    gscSignal: {
      page: PAGE_URL,
      clicks90d: 120,
      impressions90d: 5000,
      ctr90d: 0.024,
      position90d: 6.2,
      topQueries: [],
    },
    claritySignal: null,
    resolution: {
      targetUrl: PAGE_URL,
      motive: "capture_absent_cluster",
      topicFit: TOPIC_FIT,
      evidenceRefs: [],
    },
    ...over,
  };
}

function edit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "edit-1",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: PAGE_URL,
    target_element_key: "title[0]:abc",
    proposed_text:
      "Kashan Travel Guide: Historic Houses, Bazaars and Day Trips",
    current_text: "Kashan",
    why: "The page shows up 5,000 times in 90 days but the title is thin.",
    measurement_plan: "Watch clicks for 30 days.",
    evidence: [],
    implementation_status: "recommended",
    ...over,
  };
}

function item(over: Partial<QueueItem> = {}): QueueItem {
  return { rec: rec(), response: null, edits: [edit()], ...over };
}

beforeEach(() => {
  _queue = [];
});

describe("loadActionRowByEditId", () => {
  it("returns the QA verdict for a persisted paste-ready edit", async () => {
    _queue = [item()];
    const out = await loadActionRowByEditId("iranopedia", "edit-1");
    expect(out).not.toBeNull();
    const qa = out!.detail.qaVerdict;
    // Strong fit (82/78) + real Google demand (5,000 impressions clears the
    // 200 floor) + clean copy: approved and one-tap publishable.
    expect(qa.approve).toBe(true);
    expect(qa.pushReadiness).toBe("paste_ready");
    expect(qa.confidence).toBe("high");
    expect(qa.copySafe).toBe(true);
  });

  it("classifies a directive edit as review_only (never one-tap pushable)", async () => {
    _queue = [
      item({
        edits: [
          edit({
            action_type: "fix_robots",
            target_element_key: null,
            proposed_text: "Unblock /kashan-travel-guide in robots.txt.",
          }),
        ],
      }),
    ];
    const out = await loadActionRowByEditId("iranopedia", "edit-1");
    expect(out!.detail.qaVerdict.pushReadiness).toBe("review_only");
  });

  it("caps the verdict at needs-more-evidence when no core evidence family is present", async () => {
    _queue = [item({ rec: rec({ gscSignal: null }) })];
    const out = await loadActionRowByEditId("iranopedia", "edit-1");
    const qa = out!.detail.qaVerdict;
    expect(qa.approve).toBe(false);
    expect(qa.confidence).toBe("needs_more_evidence");
  });

  it("returns null for an unknown edit id", async () => {
    _queue = [item()];
    expect(await loadActionRowByEditId("iranopedia", "nope")).toBeNull();
  });

  it("returns null when the rec was dismissed", async () => {
    _queue = [item({ response: { status: "dismissed" } })];
    expect(await loadActionRowByEditId("iranopedia", "edit-1")).toBeNull();
  });

  it("returns null while the rec is deferred into the future", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    _queue = [item({ response: { status: "deferred", deferUntil: future } })];
    expect(await loadActionRowByEditId("iranopedia", "edit-1")).toBeNull();
  });

  it("resolves normally once a deferral has expired", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    _queue = [item({ response: { status: "deferred", deferUntil: past } })];
    const out = await loadActionRowByEditId("iranopedia", "edit-1");
    expect(out!.detail.qaVerdict.pushReadiness).toBe("paste_ready");
  });

  it("returns null for a dismissed edit", async () => {
    _queue = [item({ edits: [edit({ implementation_status: "dismissed" })] })];
    expect(await loadActionRowByEditId("iranopedia", "edit-1")).toBeNull();
  });

  it("returns null for an answer-side FAQ edit (the pair is keyed by the question)", async () => {
    _queue = [
      item({
        edits: [
          edit({
            action_type: "add_faq",
            target_element_key: "faq_answer[new]:h1",
          }),
        ],
      }),
    ];
    expect(await loadActionRowByEditId("iranopedia", "edit-1")).toBeNull();
  });

  it("returns null for an orphan FAQ question, and a verdict once its answer is present", async () => {
    const question = edit({
      id: "edit-q",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:h1",
      proposed_text: "What is Kashan known for?",
      measurement_plan: null,
    });
    _queue = [item({ edits: [question] })];
    expect(await loadActionRowByEditId("iranopedia", "edit-q")).toBeNull();

    const answer = edit({
      id: "edit-a",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:h1",
      proposed_text:
        "Kashan is known for its historic houses, rosewater, and the Fin Garden.",
      measurement_plan: "Watch the FAQ's search clicks for 30 days.",
    });
    _queue = [item({ edits: [question, answer] })];
    const out = await loadActionRowByEditId("iranopedia", "edit-q");
    expect(out).not.toBeNull();
    expect(out!.detail.qaVerdict.pushReadiness).toBe("paste_ready");
  });
});
