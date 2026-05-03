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
    // W3 Step 3.5d (2026-05-02) — confidenceReason moved into the
    // expansion drawer entirely. Default card no longer renders it.
    // To test "default card has no bracketed diagnostic," slice the
    // HTML at the expansion <details> boundary and assert against
    // the pre-expansion portion only. The full text (with brackets)
    // still lives inside the drawer for power users.
    const expansionStart = html.indexOf('data-rec-expansion="true"');
    expect(expansionStart).toBeGreaterThan(0);
    const defaultCardHtml = html.slice(0, expansionStart);
    // The default card must not carry the bracketed diagnostic.
    expect(defaultCardHtml).not.toMatch(/\[1\/1 label tokens match/);
    expect(defaultCardHtml).not.toMatch(/\[[^\]]*label tokens[^\]]*\]/);
    // The full rendered HTML still includes the prose (in the drawer).
    expect(html).toContain("AI cites De Mattei on 4 of 7 observations");
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
    // W3 Step 3.5d (2026-05-02) — operator browser re-audit again
    // failed the scenario-class form ("this buying scenario" / "this
    // rebuild scenario"). Replaced by a domain-specific topic-tag
    // humanizer (`extractTopicTag`) so the title surfaces concrete
    // operator language. "If I buy a property with an older house"
    // hits the older_home_rebuild trigger → "Create an older-home
    // rebuild page" (no geo because the cluster carries no city).
    expect(html).toContain("Create an older-home rebuild page");
    // Raw prompt quote no longer in the title.
    expect(html).not.toMatch(/Create a page for &quot;If I buy/);
    // Pre-3.5d scenario-class fallback no longer surfaces.
    expect(html).not.toContain("Create a page for this buying scenario");
    // Broken-grammar form still does NOT ship.
    expect(html).not.toMatch(/Create a If I/);
  });
});

// ── W3 Step 3.5c — operator product acceptance contracts ────────────────

describe("W3 Step 3.5c — product cleanup acceptance", () => {
  it("ACCEPTANCE: 'General Contractors primary' is NOT visible (entity-pollution-filter on EvidenceChips)", () => {
    const html = renderQueue([
      makeRow({
        evidence: {
          promptCount: 4,
          observationCount: 12,
          categoryBreakdown: {},
          dominantCompetitors: [],
          descriptorsNearBrand: [],
          maxSignalStrength: 70,
          primaryCompetitors: [
            // Generic noun should be filtered out.
            {
              name: "General Contractors",
              promptsWherePrimary: 4,
              totalAffectedPrompts: 4,
            },
            // Real competitor sneaks in second; should NOT auto-promote
            // (the chip only renders the FIRST eligible competitor with
            // ≥50% primary share).
            {
              name: "De Mattei Construction",
              promptsWherePrimary: 2,
              totalAffectedPrompts: 4,
            },
          ],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    // Generic noun must NOT appear as competitor copy.
    expect(html).not.toMatch(/General Contractors\s+winning/);
    expect(html).not.toMatch(/General Contractors\s+primary/);
    // The real competitor passes the filter.
    expect(html).toContain("De Mattei Construction winning");
  });

  it("ACCEPTANCE: 'Architects' / 'Home Builders' / 'Local Contractors' all filtered", () => {
    const html = renderQueue([
      makeRow({
        evidence: {
          promptCount: 3,
          observationCount: 8,
          categoryBreakdown: {},
          dominantCompetitors: [],
          descriptorsNearBrand: [],
          maxSignalStrength: 70,
          primaryCompetitors: [
            {
              name: "Architects",
              promptsWherePrimary: 3,
              totalAffectedPrompts: 3,
            },
          ],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    expect(html).not.toMatch(/Architects\s+winning/);
    expect(html).not.toMatch(/Architects\s+primary/);
  });

  it("ACCEPTANCE: 'fragmented' chip is NOT in default card", () => {
    const html = renderQueue([
      makeRow({
        evidence: {
          promptCount: 3,
          observationCount: 8,
          categoryBreakdown: {},
          dominantCompetitors: [],
          descriptorsNearBrand: [],
          maxSignalStrength: 70,
          primaryCompetitors: [],
          brandPrimaryPromptCount: 0,
          // Set high to force the old "{N} fragmented" chip path.
          fragmentedPromptCount: 4,
        },
      }),
    ]);
    expect(html).not.toMatch(/\bfragmented\b/);
  });

  it("ACCEPTANCE: 'Site match' / 'AI-reviewed' tier badges are NOT in default header", () => {
    const html = renderQueue([
      makeRow({
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason: "test",
          tier: "inventory", // would normally render "Site match" badge
          reasoning: "test",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }),
    ]);
    expect(html).not.toContain("Site match");
    expect(html).not.toContain("AI-reviewed");
  });

  it("ACCEPTANCE: raw prompt-id references scrubbed from operator copy", () => {
    const html = renderQueue([
      makeRow({
        reasoning:
          "AI fragmented this cluster across prompt 319557d1; Ritz absent.",
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason:
            "Drawn from prompt 319557d1abc and prompt: aabbccdd11223344.",
          tier: "inventory",
          reasoning: "test",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }),
    ]);
    // No bare 8+ hex prompt-id refs in any operator-visible copy.
    expect(html).not.toMatch(/prompt\s+319557d1/i);
    expect(html).not.toMatch(/prompt:\s*aabbccdd/i);
    // Replacement copy reads naturally.
    expect(html).toContain("an affected prompt");
  });

  it("ACCEPTANCE: full UUID prompt refs scrubbed (via resolution.reasoning)", () => {
    // resolution.reasoning is the field rendered as the visible
    // "reasoning" paragraph (line ~399 in client). Set the UUID
    // there so the scrubber's path is exercised.
    const html = renderQueue([
      makeRow({
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason: "test",
          tier: "inventory",
          reasoning:
            "Cluster spans prompt 319557d1-aaaa-bbbb-cccc-dddddddddddd.",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }),
    ]);
    expect(html).not.toMatch(/319557d1-aaaa-bbbb-cccc-dddddddddddd/);
    expect(html).toContain("an affected prompt");
  });

  it("ACCEPTANCE: accepted_tracking rec hides Accept/Defer/Dismiss surface", () => {
    const html = renderQueue([
      makeRow({}, { responseStatus: "accepted" }),
    ]);
    // Accept button must NOT render for an accepted rec.
    expect(html).not.toMatch(/>Accept(?:\s+—)?</);
    expect(html).not.toMatch(/>Accept \+ Track/);
    // W3 Step 3.5d (2026-05-02) — the "✓ Accepted" status copy
    // changed to "✓ Tracking" because the rec sits in the Tracking
    // lane and "Tracking" is more semantically accurate ("Beacon is
    // watching this") than "Accepted" (a past event). The contract
    // is unchanged: a status sentence is shown alongside Mark
    // shipped + Undo.
    expect(html).toContain("✓ Tracking");
    // The lane label (rendered both as the section heading and the
    // card's lane badge) confirms the rec landed in Tracking.
    expect(html).toContain("Tracking");
  });

  it("ACCEPTANCE: 'needs_fresh_edit' rec carries the chip + empty-state hint", () => {
    const html = renderQueue([
      makeRow(
        {},
        {
          // All edits dismissed → renderable empty, allEdits non-empty.
          edits: [
            {
              id: "x",
              tenant_id: "tenant-test",
              rec_id: "rec-fixture-1",
              action_type: "add_h2_section",
              target_url: "https://example.com/services/braces",
              target_element_key: "h2[new]:abc",
              display_label: "x",
              current_text: null,
              proposed_text: "x",
              why: "x",
              evidence: [],
              expected_impact: null,
              difficulty: "low",
              confidence: "high",
              measurement_plan: null,
              risks: [],
              source: "openai",
              provider_name: "openai",
              evidence_hash: "x",
              model: "gpt-5-mini",
              cost_usd: 0,
              created_at: "2026-05-01T00:00:00Z",
              updated_at: "2026-05-01T00:00:00Z",
              implementation_status: "dismissed",
              live_at: null,
              live_snapshot_id: null,
              live_match_confidence: null,
              live_match_kind: null,
              live_element_key: null,
              not_found_reason: null,
            },
          ],
        },
      ),
    ]);
    expect(html).toContain("Needs fresh edit");
    // Empty-state hint is the existing data-attribute from Step 3.5.
    expect(html).toContain('data-recommendations-edits-empty="true"');
  });

  it("ACCEPTANCE: queue with reasonable evidence is NOT mostly Weak signal", () => {
    // 5 well-formed recs with medium engineConfidence — none should
    // render as Weak signal.
    const queue = [
      makeRow({ stableKey: "r1" }),
      makeRow({ stableKey: "r2" }),
      makeRow({ stableKey: "r3" }),
      makeRow({ stableKey: "r4" }),
      makeRow({ stableKey: "r5" }),
    ];
    const html = renderQueue(queue);
    const weakCount = (html.match(/>Weak signal</g) ?? []).length;
    const reviewCount = (html.match(/>Review</g) ?? []).length;
    // Review dominates; Weak signal is exceptional, not the norm.
    expect(weakCount).toBe(0);
    expect(reviewCount).toBeGreaterThanOrEqual(5);
  });
});
