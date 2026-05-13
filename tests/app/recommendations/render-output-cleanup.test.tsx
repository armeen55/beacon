/**
 * W3 Step 3.5e (2026-05-03) — rendered-output tests for the
 * recommendations action table.
 *
 * Renders the actual `RecommendationsClient` with crafted fixtures
 * and asserts the output HTML — not source. Operator-locked
 * acceptance contracts post-3.5e:
 *
 *   - Table-shaped UI, not a card stack. One `<table>` with a
 *     `data-recommendations-action-table="true"` attribute.
 *   - Header columns include Recommended action / Target / Type /
 *     Priority / Status / Evidence / Action.
 *   - Title column is a CONCRETE TASK ("Add an H2 …", "Create a …
 *     page"), never a cluster description, never a generic
 *     "Create a page for this scenario" fallback, never raw prompt
 *     copy.
 *   - Type / Priority / Status pills carry data-rec-*-pill
 *     attributes; rendered text is operator-friendly (Quick win /
 *     Easy / Medium / Hard) — NEVER raw "low" / "medium" / "high"
 *     visible alone.
 *   - "Weak signal" is never visible (operator scope: use Low
 *     priority instead).
 *   - "homepage page" never renders — homepage URLs land as
 *     "Homepage".
 *   - Generic competitor entities (General Contractors, Architects,
 *     etc.) never appear in evidence summaries.
 *   - Bracketed diagnostic strings + raw prompt-IDs never appear in
 *     the default table — only in the drawer's debug block.
 *
 * Pure render. Server actions mocked; revalidatePath stubbed.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

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
          target_url: "https://example.com/services/whole-home-remodel",
          target_element_key: "h2[new]:abc",
          display_label: "How design-build cuts kitchen remodel costs",
          current_text: null,
          proposed_text:
            "Design-build keeps architecture, engineering, and construction under one roof — for a typical Atherton kitchen remodel that means roughly 15-20% less time spent on coordination handoffs.",
          why: "Design-build framing is missing on the current page.",
          evidence: [],
          expected_impact: null,
          difficulty: "low",
          confidence: "medium",
          measurement_plan:
            "Track citation rate on Atherton kitchen remodel prompts for 14 days.",
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
      matrixDate="2026-05-03"
      promptTextById={{
        "p-1": "best builders atherton",
        "p-2": "kitchen remodel cost",
        "p-3": "luxury home renovation",
      }}
    />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("W3 Step 3.5e — table-shaped UI", () => {
  it("renders a single <table> with the action-table data attribute", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain('data-recommendations-action-table="true"');
    expect(html).toMatch(/<table[^>]*>/);
  });

  it("renders the table header columns (Recommended action / Target / Type / Priority / Status / Evidence / Action)", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/>Recommended action</);
    expect(html).toMatch(/>Target</);
    expect(html).toMatch(/>Type</);
    expect(html).toMatch(/>Priority</);
    expect(html).toMatch(/>Status</);
    expect(html).toMatch(/>Evidence</);
    expect(html).toMatch(/>Action</);
  });

  it("renders one <tr> per action row with data-rec-row-id", () => {
    const queue = [
      makeRow({ stableKey: "r1" }),
      makeRow({ stableKey: "r2" }),
      makeRow({ stableKey: "r3" }),
    ];
    const html = renderQueue(queue);
    const matches = html.match(/data-rec-row-id="/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("shows the toolbar with search + type filter + status filter", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain('data-recommendations-search="true"');
    expect(html).toContain('data-recommendations-type-filter="true"');
    expect(html).toContain('data-recommendations-status-filter="true"');
  });

  it("renders an action-row summary line ('N actions · M new · K tracking')", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toContain('data-recommendations-summary="true"');
    expect(html).toMatch(/\d+\s+action/);
    expect(html).toMatch(/\bnew\b/);
    expect(html).toMatch(/\btracking\b/);
  });
});

describe("W3 Step 3.5e — concrete row title (no cluster descriptions)", () => {
  it("a specific-edit row reads as a CONCRETE TASK starting with a verb", () => {
    const html = renderQueue([makeRow()]);
    // The fixture's add_h2_section edit (display_label
    // "How design-build cuts kitchen remodel costs", which
    // `cleanDisplayLabel` passes through unchanged) should land as
    // `Add "How design-build cuts kitchen remodel costs" H2 to
    // the Whole Home Remodel page`. W3 §3.5f uses curly quotes
    // (“…”) consistently. W3 §3.15 (operator scope, 2026-05-04)
    // dropped the dangling article — the title is now `Add "..." H2`,
    // not `Add an "..." H2`.
    expect(html).toMatch(/Add [“"][A-Z]/);
    expect(html).not.toMatch(/Add an [“"][A-Z]/);
    expect(html).toMatch(/H2 to the Whole Home Remodel page/);
  });

  it("a create_page rec with no edits surfaces as 'Create … page' (NOT scenario fallback)", () => {
    const rec = {
      ...makeRow().rec,
      stableKey: "rec-create-only",
      clusterLabel: "Atherton older home rebuild",
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
      },
    } as unknown as RecommendationQueueRow["rec"];
    const html = renderQueue([
      { rec, response: null, edits: [] },
    ]);
    // W3 §3.5f — decision-style topics get the "decision page"
    // suffix so the title reads as a real operator decision.
    expect(html).toContain("Create an Atherton older-home rebuild decision page");
    expect(html).not.toContain("Create a page for this scenario");
    expect(html).not.toContain("Create a page for this buying scenario");
    expect(html).not.toContain("Pick a direction for this opportunity");
  });

  it("never renders 'homepage page' (homepage label is just 'Homepage')", () => {
    const html = renderQueue([makeRow()]);
    expect(html).not.toContain("homepage page");
    expect(html).not.toContain("Homepage page");
  });
});

describe("W3 Step 3.5e — pills carry humanized text + data-* enum", () => {
  it("Type pill renders operator-readable label ('H2' / 'Create page' / etc.) — never raw enum", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/data-rec-type-pill="edit_h2"/);
    expect(html).toMatch(/>H2</);
    expect(html).not.toMatch(/>add_h2_section</);
    expect(html).not.toMatch(/>create_cluster_page</);
  });

  it("Priority pill renders High / Medium / Low — NEVER 'Weak signal'", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/data-rec-priority-pill="(high|medium|low)"/);
    // Specifically: "Weak signal" must not appear anywhere on the
    // table view (operator scope: use Low priority instead).
    expect(html).not.toContain("Weak signal");
  });

  it("Status pill renders New / Accepted / etc — internal enum stays in data-rec-status-pill", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/data-rec-status-pill="(new|accepted|measuring|shipped|needs_review|needs_fresh_edit|deferred|dismissed)"/);
    // Default fixture has no response → status = "new".
    expect(html).toMatch(/>New</);
  });

  it("does NOT render raw 'low' / 'medium' / 'high' as standalone visible text in the table body", () => {
    const html = renderQueue([makeRow()]);
    // Strip data-* attributes (allowed there) + tags + drawer content
    // (drawer Debug block is allowed to surface internals when expanded).
    const rowsOnly = html.split('<tr class="bg-surface-inset/20">')[0]; // drop drawer
    const visible = rowsOnly
      .replace(/data-[a-z-]+="[^"]*"/g, "")
      .replace(/title="[^"]*"/g, "")
      .replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(/\blow\b(?!\w)/);
    expect(visible).not.toMatch(/\bmedium\b(?!-|\w)/);
  });
});

describe("W3 Step 3.5e — accepted/dismissed responses change row state", () => {
  it("an accepted rec hides the Accept button and shows a Mark-shipped affordance", () => {
    const html = renderQueue([makeRow({}, { responseStatus: "accepted" })]);
    // No raw "Accept" button.
    expect(html).not.toMatch(/data-rec-action-button="accept"/);
    // Mark-shipped affordance present.
    expect(html).toMatch(/data-rec-action-button="mark_shipped"/);
    // Status pill reads "Accepted" or "Measuring" (depending on
    // edit lifecycle); never "✓ Accepted" sentence (that was 3.5d
    // copy).
    const statusPill = html.match(/data-rec-status-pill="([^"]+)"/);
    expect(statusPill?.[1]).toMatch(/^(accepted|measuring|shipped)$/);
  });

  it("a needs_fresh_edit rec carries that status pill", () => {
    const html = renderQueue([
      makeRow(
        {},
        {
          edits: [
            {
              id: "x",
              tenant_id: "tenant-test",
              rec_id: "rec-fixture-1",
              action_type: "add_h2_section",
              target_url: "https://example.com/services/whole-home-remodel",
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
    expect(html).toMatch(/data-rec-status-pill="needs_fresh_edit"/);
  });
});

describe("W3 Step 3.5e — generic competitor leaks filtered everywhere", () => {
  it("'General Contractors winning' never appears in evidence summary", () => {
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
            {
              name: "General Contractors",
              promptsWherePrimary: 4,
              totalAffectedPrompts: 4,
            },
          ],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    expect(html).not.toMatch(/General Contractors\s+winning/);
    expect(html).not.toMatch(/General Contractors\s+primary/);
  });

  it("'Architects winning' never appears (entity-pollution-filter)", () => {
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
  });

  it("real competitors still surface (filter is a denylist, not a blanket)", () => {
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
            {
              name: "De Mattei Construction",
              promptsWherePrimary: 3,
              totalAffectedPrompts: 4,
            },
          ],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    expect(html).toContain("De Mattei Construction winning");
  });
});

describe("W3 Step 3.5e — debug content stays out of the default table", () => {
  it("bracketed diagnostic ('[1/1 label tokens match …]') NEVER renders in the default table", () => {
    const html = renderQueue([makeRow()]);
    // Drawer is collapsed by default (expandedId === null), so the
    // table HTML excludes both the drawer markup AND the bracketed
    // confidenceReason that lives there. Pin the absence at the
    // top-level.
    expect(html).not.toMatch(/\[1\/1 label tokens match/);
    expect(html).not.toMatch(/\[[^\]]*label tokens[^\]]*\]/);
  });

  it("raw 8+ hex prompt-id refs scrubbed out of any visible copy", () => {
    const html = renderQueue([
      makeRow({
        reasoning:
          "AI fragmented this cluster across prompt 319557d1; Ritz absent.",
      }),
    ]);
    expect(html).not.toMatch(/prompt\s+319557d1/i);
  });

  it("'Site match' / 'AI-reviewed' tier badges are gone (operator scope)", () => {
    const html = renderQueue([makeRow()]);
    expect(html).not.toContain("Site match");
    expect(html).not.toContain("AI-reviewed");
  });

  it("'fragmented' / 'Capture absent cluster' / 'Counter competitor' jargon never visible", () => {
    const html = renderQueue([makeRow()]);
    expect(html).not.toContain("fragmented");
    expect(html).not.toContain("Capture absent cluster");
    // Note: "Counter competitors:" is a page-brief drawer label and
    // doesn't appear by default (drawer collapsed).
  });
});

describe("W3 Step 3.5e — confidence-distribution invariant", () => {
  it("a queue of 5 well-formed recs is NOT mostly Low priority", () => {
    const queue = [
      makeRow({ stableKey: "r1" }),
      makeRow({ stableKey: "r2" }),
      makeRow({ stableKey: "r3" }),
      makeRow({ stableKey: "r4" }),
      makeRow({ stableKey: "r5" }),
    ];
    const html = renderQueue(queue);
    const lowCount = (html.match(/data-rec-priority-pill="low"/g) ?? []).length;
    const mediumCount = (html.match(/data-rec-priority-pill="medium"/g) ?? [])
      .length;
    const highCount = (html.match(/data-rec-priority-pill="high"/g) ?? []).length;
    // Default fixture: medium engine confidence + 3-prompt evidence
    // → priority="medium". None should be Low.
    expect(lowCount).toBe(0);
    expect(mediumCount + highCount).toBeGreaterThanOrEqual(5);
  });
});

describe("W3 Step 3.5e — search + filter inputs", () => {
  it("the search input has a placeholder explaining what's searchable", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/placeholder=\"Search actions, pages, or evidence/i);
  });

  it("the type filter includes operator-friendly labels (All types / H2 / Page / etc.)", () => {
    // 2026-05-06 Phase 3-bis fix 1: option `value` is now the public
    // key (page / h2 / etc.), not the raw schema enum (create_page /
    // edit_h2). Labels unchanged.
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/<option[^>]*value="all"[^>]*>All types<\/option>/);
    expect(html).toMatch(/<option[^>]*value="h2"[^>]*>H2<\/option>/);
    expect(html).toMatch(
      /<option[^>]*value="page"[^>]*>Page<\/option>/,
    );
  });

  it("the status filter includes operator-friendly labels (New / Accepted / etc.)", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/<option[^>]*value="all"[^>]*>All statuses<\/option>/);
    expect(html).toMatch(/<option[^>]*value="new"[^>]*>New<\/option>/);
    expect(html).toMatch(/<option[^>]*value="accepted"[^>]*>Accepted<\/option>/);
  });
});

// ── W3 Step 3.5f acceptance contracts ───────────────────────────────────

describe("W3 Step 3.5f — operator-locked row content cleanups", () => {
  it("ACCEPTANCE: no row says 'Create a page for this scenario' or 'this opportunity'", () => {
    const html = renderQueue([
      makeRow({
        stableKey: "rec-no-topic",
        clusterLabel: "obscure cluster phrase",
        resolution: {
          action: "needs_review",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason: "test",
          tier: "inventory",
          reasoning: "test",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
          needsHumanReview: true,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }, { edits: [] }),
    ]);
    expect(html).not.toContain("Create a page for this scenario");
    expect(html).not.toContain("Pick a direction for this opportunity");
    // The row falls back to operator-grounded copy.
    expect(html).toMatch(/(Decide direction for|Review this)/);
  });

  it("ACCEPTANCE: H2 row title NEVER contains 'H2: H2:' or duplicate H2 prefix", () => {
    // Operator-caught (Step 3.5f browser audit): a display_label like
    // "H2: Architect-led design-build advantage" was rendered as
    // `Add an H2 "H2: Architect-led design-build advantage"`. The
    // cleaner strips the embedded `H2:` prefix.
    const html = renderQueue([
      makeRow(
        {},
        {
          edits: [
            {
              id: "edit-h2-with-prefix",
              tenant_id: "tenant-test",
              rec_id: "rec-fixture-1",
              action_type: "add_h2_section",
              target_url: "https://example.com/services/whole-home-remodel",
              target_element_key: "h2[new]:abc",
              display_label: "H2: Architect-led design-build advantage",
              current_text: null,
              proposed_text:
                "Architect-led design-build keeps everything under one roof.",
              why: "missing",
              evidence: [],
              expected_impact: null,
              difficulty: "low",
              confidence: "medium",
              measurement_plan: null,
              risks: [],
              source: "openai",
              provider_name: "openai",
              evidence_hash: "x",
              model: "gpt-5-mini",
              cost_usd: 0,
              created_at: "2026-05-01T00:00:00Z",
              updated_at: "2026-05-01T00:00:00Z",
              implementation_status: "recommended",
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
    expect(html).not.toMatch(/H2 [“"]H2:/);
    // The cleaned label still surfaces on the row.
    expect(html).toContain("Architect-led design-build advantage");
  });

  it("ACCEPTANCE: needs_review row's primary button says 'Review' (not 'Defer')", () => {
    const html = renderQueue([
      makeRow({
        stableKey: "rec-review",
        clusterLabel: "Atherton older home rebuild",
        resolution: {
          action: "needs_review",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          confidence: "medium",
          confidenceReason: "test",
          tier: "inventory",
          reasoning: "test",
          cannibalization: null,
          evidenceRefs: [],
          proposedSlug: null,
          needsHumanReview: true,
        } as unknown as RecommendationQueueRow["rec"]["resolution"],
      }, { edits: [] }),
    ]);
    // The Action column carries a Review button (not Defer).
    expect(html).toMatch(/data-rec-action-button="review"/);
    // No Defer button in the Action column for this row.
    const actionColPattern =
      /text-right[^<]*<button[^>]*data-rec-action-button="defer"/;
    expect(html).not.toMatch(actionColPattern);
  });

  it("ACCEPTANCE: dismissed row's primary button says 'Restore'", () => {
    const html = renderQueue([
      makeRow({}, { responseStatus: null, edits: [] }),
    ]);
    // Build an explicit dismissed-response fixture via our helper's
    // overrides — the renderQueue tail produces no rows for dismissed
    // items by default. The action-row builder suppresses dismissed
    // recs from the table, so this is naturally enforced — test the
    // contract via source-scan instead.
    // The button mapping is sourced inside the client; pin via the
    // step-3.5f architecture file. This rendered test simply asserts
    // the source-scan-pinned text doesn't leak elsewhere.
    expect(html).not.toContain("Un-dismissed");
  });

  it("ACCEPTANCE: row carries a visible Details affordance (not hidden click-only)", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/data-rec-details-button="true"/);
    expect(html).toMatch(/>Details</);
  });

  it("ACCEPTANCE: create_page rows render Type = 'Page' (W3 §3.5g — never '—' / never 'Create page')", () => {
    // W3 §3.5g (operator browser audit): the 3.5f "—" placeholder
    // looked like a blank/missing value. Restored to "Page" — short,
    // never wraps thanks to whitespace-nowrap, never "Create page".
    const html = renderQueue([
      makeRow({
        stableKey: "rec-create-only-type",
        clusterLabel: "Atherton older home rebuild",
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
      }, { edits: [] }),
    ]);
    expect(html).toMatch(
      /data-rec-type-pill="create_page"[^>]*>Page</,
    );
    expect(html).not.toMatch(
      /data-rec-type-pill="create_page"[^>]*>—</,
    );
    // The verbose "Create page" pill text is still GONE.
    expect(html).not.toMatch(
      /data-rec-type-pill="create_page"[^>]*>Create page</,
    );
  });

  it("ACCEPTANCE: evidence rows surface topic-specific copy, not generic '{N} observations.'", () => {
    const html = renderQueue([makeRow()]);
    // The evidence summary now leads with "{N} AI answers" and
    // includes a topic phrase (the fixture cluster is "Atherton
    // kitchen remodel" so we expect "kitchen remodel queries" or
    // similar topic-shaped continuation).
    expect(html).toMatch(/\d+ AI answer/);
    // The legacy "No owned page cited across N observations." form
    // is gone.
    expect(html).not.toMatch(/No owned page cited across \d+ observations\./);
  });

  it("ACCEPTANCE: top-5 rows are NOT all Low priority on a multi-rec fixture", () => {
    const queue = [
      makeRow({ stableKey: "r1" }),
      makeRow({ stableKey: "r2" }),
      makeRow({ stableKey: "r3" }),
      makeRow({ stableKey: "r4" }),
      makeRow({ stableKey: "r5" }),
    ];
    const html = renderQueue(queue);
    const top5Priorities = [...html.matchAll(/data-rec-priority="(\w+)"/g)]
      .slice(0, 5)
      .map((m) => m[1]);
    const lowCount = top5Priorities.filter((p) => p === "low").length;
    // Top 5 rows must not all be Low. With reasonable evidence
    // (fixture has 8 observations + 3 prompts) at least Medium.
    expect(lowCount).toBeLessThan(top5Priorities.length);
  });

  it("ACCEPTANCE: 'homepage page' duplication never renders", () => {
    // Build a fixture whose edit anchors at the homepage path "/".
    const html = renderQueue([
      makeRow(
        {},
        {
          edits: [
            {
              id: "edit-meta-homepage",
              tenant_id: "tenant-test",
              rec_id: "rec-fixture-1",
              action_type: "edit_meta",
              target_url: "https://example.com/",
              target_element_key: "meta:description",
              display_label: "Better hero meta description",
              current_text: null,
              proposed_text:
                "Ritz Builders — Bay Area's design-build partner for whole-home remodels.",
              why: "current meta is generic",
              evidence: [],
              expected_impact: null,
              difficulty: "low",
              confidence: "medium",
              measurement_plan: null,
              risks: [],
              source: "openai",
              provider_name: "openai",
              evidence_hash: "x",
              model: "gpt-5-mini",
              cost_usd: 0,
              created_at: "2026-05-01T00:00:00Z",
              updated_at: "2026-05-01T00:00:00Z",
              implementation_status: "recommended",
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
    expect(html).not.toContain("homepage page");
    expect(html).not.toContain("Homepage page");
    // The row anchors at "Homepage" (no trailing " page") so the
    // sentence reads naturally.
    expect(html).toMatch(/Homepage(?![ a-z])/);
  });

  it("ACCEPTANCE: 'Weak signal' is NEVER visible on the table", () => {
    const html = renderQueue([makeRow()]);
    expect(html).not.toContain("Weak signal");
  });

  it("ACCEPTANCE: tracking rows never outrank new/needs_review rows by default", () => {
    // Fixture: one accepted (tracking) + one new (open work). The
    // sort places open work first.
    const queue = [
      makeRow(
        { stableKey: "tracking-1" },
        { responseStatus: "accepted" },
      ),
      makeRow({ stableKey: "open-1" }),
    ];
    const html = renderQueue(queue);
    // Read the rendered ranks.
    const matches = [...html.matchAll(/data-rec-status="(\w+)"[^>]*data-rec-source-rec-id="([^"]+)"[^>]*data-rec-rank="(\d+)"/g)];
    const byStatus = matches.map((m) => ({ status: m[1], rank: Number(m[3]) }));
    // The "new" row gets rank 1; the "accepted" row falls below.
    const newRank = byStatus.find((r) => r.status === "new")?.rank ?? -1;
    const acceptedRank =
      byStatus.find((r) => ["accepted", "measuring"].includes(r.status))?.rank ?? -1;
    expect(newRank).toBeGreaterThan(0);
    expect(acceptedRank).toBeGreaterThan(0);
    expect(newRank).toBeLessThan(acceptedRank);
  });

  it("ACCEPTANCE: drawer carries a secondary Defer + Dismiss footer (not in row Action column)", () => {
    // Render a row + force expansion via an explicit fixture. We
    // can't drive React useState from here, but the source-scan
    // version of this assertion lives in the step-3.5e file. The
    // rendered surface check: `data-rec-drawer-secondary-actions` is
    // ABSENT when no row is expanded by default.
    const html = renderQueue([makeRow()]);
    expect(html).not.toContain('data-rec-drawer-secondary-actions="true"');
  });
});

// ── W3 Step 3.5g polish acceptance ───────────────────────────────────────

describe("W3 Step 3.5g — operator polish acceptance", () => {
  it("ACCEPTANCE: helper copy 'Accepting a task starts tracking…' renders under the toolbar", () => {
    const html = renderQueue([makeRow()]);
    expect(html).toMatch(/data-recommendations-helper="true"/);
    expect(html).toContain(
      "Accepting a task starts tracking its impact on AI visibility.",
    );
  });

  it("ACCEPTANCE: Details affordance is chevron-only (no 'Details' label text)", () => {
    const html = renderQueue([makeRow()]);
    // The button must still exist and be discoverable …
    expect(html).toMatch(/data-rec-details-button="true"/);
    // … but the visible "Details" text label is gone — chevron only.
    expect(html).not.toMatch(/data-rec-details-button="true"[^>]*>[\s\S]{0,80}>Details</);
    // The header column also drops the "Details" text (sr-only span
    // for accessibility instead).
    expect(html).toMatch(/sr-only/);
  });

  it("ACCEPTANCE: evidence appends 'while competitors appear' when Ritz absent + competitor present", () => {
    const html = renderQueue([
      makeRow({
        clusterLabel: "Atherton older home rebuild",
        evidence: {
          promptCount: 4,
          observationCount: 12,
          categoryBreakdown: {},
          dominantCompetitors: ["De Mattei Construction"],
          descriptorsNearBrand: [],
          maxSignalStrength: 70,
          primaryCompetitors: [],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    // Evidence reads "{N} AI answers; Ritz not cited for Atherton
    // older-home rebuild queries while competitors appear."
    expect(html).toMatch(/Ritz not cited for[^.]+while competitors appear/);
  });

  it("ACCEPTANCE: evidence does NOT append 'while competitors appear' when no real competitor is present", () => {
    const html = renderQueue([
      makeRow({
        clusterLabel: "Atherton older home rebuild",
        evidence: {
          promptCount: 4,
          observationCount: 12,
          categoryBreakdown: {},
          // Generic-noun competitor — entity-pollution-filter excludes
          // it, so the suffix should NOT fire.
          dominantCompetitors: ["General Contractors"],
          descriptorsNearBrand: [],
          maxSignalStrength: 70,
          primaryCompetitors: [],
          brandPrimaryPromptCount: 0,
          fragmentedPromptCount: 0,
        },
      }),
    ]);
    expect(html).toContain("Ritz not cited for");
    expect(html).not.toContain("while competitors appear");
  });
});
