/**
 * W3 Step 3.5b (2026-05-02) — rendered-output tests for /recommendations.
 *
 * The operator's browser audit on Step 3.5 caught problems source-scan
 * tests missed. This file renders the actual RecommendationsClient
 * with crafted fixtures and asserts the OUTPUT HTML — not the source.
 *
 * Operator-locked contracts (post-3.5b):
 *   - No raw enum tokens visible (low/medium/high/add_h2_section/etc.)
 *     in default rec card. Internal values stay in `data-*` attributes
 *     only.
 *   - "Motive: Capture absent cluster" jargon REPLACED with
 *     "Why this matters: AI is not citing Ritz for this topic yet."
 *   - Bracketed diagnostic strings (`[1/1 label tokens match …]`) do
 *     NOT appear in the default card body.
 *   - Prompt-shaped cluster labels (e.g., "If I buy a property…") do
 *     NOT produce ungrammatical "Create a If I…" titles.
 *   - The rendered queue is NOT all "Weak signal" — at least one rec
 *     reaches Review (MEDIUM) when its evidence is reasonable.
 *
 * Pure render. No server actions, no network. Server actions are
 * mocked; revalidatePath stubbed.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/cache must be stubbed BEFORE any module that calls
// revalidatePath at the top level.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Stub server actions used by client buttons. These are imported by
// recommendations-client.tsx but they only fire on click; the static
// render doesn't invoke them.
vi.mock("@/app/(shell)/recommendations/actions", () => ({
  acceptRecommendation: vi.fn(),
  deferRecommendation: vi.fn(),
  dismissRecommendation: vi.fn(),
  markRecommendationShipped: vi.fn(),
  undoRecommendationResponse: vi.fn(),
}));

import { RecommendationsClient } from "@/app/(shell)/recommendations/recommendations-client";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "@/app/(shell)/recommendations/page";

// ── Fixture builders ─────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<RecommendationQueueRow["rec"]> = {},
  options: { responseStatus?: "accepted" | null; edits?: unknown[] } = {},
): RecommendationQueueRow {
  // Cast through unknown so the test fixture can satisfy the
  // PrioritizedRecommendation shape without filling every legacy
  // field (the renderer only reads what it needs).
  const rec = {
    stableKey: "rec-fixture-1",
    type: "create_cluster_page",
    title: "fixture title",
    description: "fixture description",
    affectedPromptIds: ["p-1", "p-2", "p-3"],
    clusterLabel: "Atherton kitchen remodel",
    clusterKind: "geo",
    evidence: {
      promptCount: 3,
      observationCount: 8,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 70,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity: "medium",
    effort: "low",
    score: 7,
    tier: "now",
    rank: 1,
    reasoning:
      "AI is citing other builders for this cluster; Ritz has no dedicated page.",
    resolution: {
      action: "create_new_page",
      motive: "capture_absent_cluster",
      targetUrl: "needs_new_page",
      confidence: "medium",
      confidenceReason:
        "AI cites De Mattei on 4 of 7 observations (57%) [1/1 label tokens match page; geo cluster → location-route page].",
      tier: "inventory",
      reasoning: "test",
      cannibalization: null,
      evidenceRefs: [],
      proposedSlug: null,
    },
    engineConfidence: {
      confidence: "medium",
      reasons: ["adjudicated_or_inventory_tier"],
    },
    ...overrides,
  } as unknown as RecommendationQueueRow["rec"];

  return {
    rec,
    response:
      options.responseStatus === "accepted"
        ? {
            recId: rec.stableKey,
            status: "accepted",
            respondedAt: new Date().toISOString(),
            deferUntil: null,
          }
        : null,
    edits:
      (options.edits as RecommendationQueueRow["edits"]) ?? [
        {
          id: `${rec.stableKey}__add_h2_section__h2[new]:abc`,
          tenant_id: "tenant-test",
          rec_id: rec.stableKey,
          action_type: "add_h2_section",
          target_url: "https://example.com/services/braces",
          target_element_key: "h2[new]:abc",
          display_label: 'H2 (new): "How design-build cuts kitchen remodel costs"',
          current_text: null,
          proposed_text:
            "Design-build keeps architecture, engineering, and construction under one roof — for a typical Atherton kitchen remodel that means roughly 15-20% less time spent on coordination handoffs.",
          why: "Design-build framing is missing on the current page.",
          evidence: [],
          expected_impact: null,
          difficulty: "low",
          confidence: "medium",
          measurement_plan: null,
          risks: [],
          source: "openai",
          provider_name: "openai",
          evidence_hash: "deadbeef",
          model: "gpt-5-mini",
          cost_usd: 0.0025,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          implementation_status: "recommended",
          live_at: null,
          live_snapshot_id: null,
          live_match_confidence: null,
          live_match_kind: null,
          live_element_key: null,
          not_found_reason: null,
        },
      ],
  };
}

function renderQueue(rows: RecommendationQueueRow[]): string {
  return renderToStaticMarkup(
    <RecommendationsClient
      queue={rows}
      watchlist={[] as RecommendationWatchRow[]}
      matrixDate="2026-05-02"
      promptTextById={{
        "p-1": "best builders atherton",
        "p-2": "kitchen remodel cost",
        "p-3": "luxury home renovation",
      }}
    />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("W3 Step 3.5b — rendered-output cleanup", () => {
  it("default card does NOT show 'Motive:' jargon — uses 'Why this matters' instead", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain("Why this matters");
    expect(html).not.toMatch(/\bMotive:\s/);
    // The humanized motive copy lands.
    expect(html).toContain("AI is not citing Ritz for this topic yet");
    // Internal jargon must not appear.
    expect(html).not.toContain("Capture absent cluster");
    expect(html).not.toContain("capture_absent_cluster");
  });

  it("default card does NOT show bracketed diagnostic scoring strings", () => {
    const html = renderQueue([makeRow()]);
    // The fixture's confidenceReason carries the bracketed diagnostic
    // suffix; the helper strips it. The visible body should retain
    // the prose part.
    expect(html).toContain("AI cites De Mattei on 4 of 7 observations");
    expect(html).not.toMatch(/\[1\/1 label tokens match/);
    expect(html).not.toMatch(/\[[^\]]*label tokens[^\]]*\]/);
  });

  it("default card does NOT render raw 'low' / 'medium' / 'high' badge text", () => {
    const html = renderQueue([makeRow()]);
    // Strip ALL data-* attributes so the internal enum values
    // (allowed there) don't trip the body check.
    const bodyText = html
      .replace(/data-[a-z-]+="[^"]*"/g, "")
      .replace(/<[^>]+>/g, " ");
    // The visible label should never read just "low" / "medium" /
    // "high" as a standalone word inside the rec card.
    expect(bodyText).not.toMatch(/\blow\b(?!\w)/);
    expect(bodyText).not.toMatch(/\bmedium\b(?!-)/);
    // (medium-prefixed words like "medium-density" are fine; we only
    // ban the bare word.)
  });

  it("difficulty badge shows 'Easy' instead of raw 'low'", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain("Easy");
    // data-* attribute carries internal enum.
    expect(html).toContain('data-edit-difficulty="low"');
  });

  it("source badge shows 'AI-generated' instead of raw 'openai'", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain("AI-generated");
    expect(html).toContain('data-source="openai"');
    // The internal enum may appear in title attributes but not as
    // the bare visible label.
    const visible = html.replace(/title="[^"]*"/g, "").replace(/data-[a-z-]+="[^"]*"/g, "");
    expect(visible).not.toMatch(/>openai</);
  });

  it("renders the engineConfidence pill as 'Review' (medium → Review)", () => {
    const html = renderQueue([makeRow()]);
    // The pill should read "Review" for the medium-confidence fixture.
    expect(html).toContain("Review");
    expect(html).toContain('data-rec-confidence="medium"');
  });

  it("does NOT render the action_type as 'create_cluster_page' or any raw type token", () => {
    const html = renderQueue([makeRow()]);
    // The rec.type (create_cluster_page) MUST NOT appear in body
    // text — operator audit pinned this. Internal value passes
    // through data-* only.
    const bodyText = html
      .replace(/data-[a-z-]+="[^"]*"/g, "")
      .replace(/<[^>]+>/g, " ");
    expect(bodyText).not.toContain("create_cluster_page");
    expect(bodyText).not.toContain("add_h2_section");
  });

  it("INVARIANT: a queue with reasonable evidence is NOT all 'Weak signal'", () => {
    // Operator browser audit caught this: every card said "Weak
    // signal" because deterministic_only forced LOW. The rubric was
    // revised in 3.5b.B; this test pins the rendered consequence.
    const queue = [
      makeRow({ stableKey: "rec-1" }),
      makeRow({ stableKey: "rec-2" }),
      makeRow({ stableKey: "rec-3" }),
    ];
    const html = renderQueue(queue);
    // Every fixture has medium confidence → "Review", not "Weak signal".
    expect(html).toContain("Review");
    // "Weak signal" appears at most when a rec is genuinely thin.
    // Our fixtures are not thin.
    const weakCount = (html.match(/Weak signal/g) ?? []).length;
    expect(weakCount).toBe(0);
  });

  it("prompt-shaped cluster label produces 'Create a page for \"…\"' grammar (not broken inline)", () => {
    const html = renderQueue([
      makeRow({
        stableKey: "rec-prompt-shape",
        clusterLabel: "If I buy a property with an older house",
        title: "If I buy a property with an older house",
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason: "test",
          tier: "inventory",
          reasoning: "test",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }),
    ]);
    // Wrapped form ships. renderToStaticMarkup encodes `"` → `&quot;`,
    // so check for the encoded form OR (after a tag-strip pass) the
    // raw form.
    expect(html).toMatch(/Create a page for &quot;If I buy a property/);
    // Broken-grammar form does NOT ship.
    expect(html).not.toMatch(/Create a If I/);
  });
});
