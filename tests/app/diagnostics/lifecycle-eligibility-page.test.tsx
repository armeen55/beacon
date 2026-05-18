/**
 * Phase A.2 Step 3d (2026-05-18) — operator-only
 * /diagnostics/lifecycle-eligibility page render contract.
 *
 * Pins:
 *   • Operator gate — page returns notFound() when neither
 *     BEACON_OPERATOR_MODE nor NODE_ENV === "test" is satisfied.
 *     (The page allows test mode for render coverage; production
 *     access requires the env var.)
 *   • Funnel counters tile renders with `data-counter` attributes for
 *     every locked counter (total_edits, edits_recommended, etc.).
 *   • Reason-distribution chips render with stable `data-reason-tally`
 *     attributes for every value in the 15-value enum.
 *   • Per-row table renders one `<tr data-diagnostics-row="true">` per
 *     edit row, with `data-row-edit-id`, `data-row-impl-status`,
 *     `data-row-eligibility-reason` attributes.
 *   • Row ordering by REASON_SEVERITY: most-actionable first
 *     (awaiting_operator_acceptance before cited_eligible).
 *   • Canonicalization warning surface appears when the corresponding
 *     counter is non-zero.
 *   • Operator surface — raw enum strings (e.g.,
 *     `awaiting_operator_acceptance`, `verified_live`) ARE rendered.
 *
 * Server-rendered via `renderToStaticMarkup`; the page is a server
 * component with no client-side interactivity in this slice.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  unstable_cache:
    <Args extends unknown[], Ret>(fn: (...args: Args) => Ret) =>
    (...args: Args) =>
      fn(...args),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

// Operator-mode gate stub. The page also accepts NODE_ENV === "test".
// Default test-mode runs under vitest so the gate passes naturally.
let _operatorModeEnabled = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operatorModeEnabled,
}));

const TENANT = "tenant-test";

// Repository stub. Page uses `getRecommendedEdits` + `getPageSnapshots`.
let _edits: ReadonlyArray<import("@/domains/recommendations/recommended-edits-persistence").RecommendedEditRow> = [];
let _snapshots: Array<{ url: string }> = [];

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => TENANT,
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({
      getRecommendedEdits: async () => _edits,
      getPageSnapshots: async () => _snapshots,
    }),
  }),
}));

// `getResponse(recId)` from the recommendation-response-store. The
// page calls this once per distinct rec_id and dedupes the result
// set. Stub via a per-test map keyed on recId.
let _responsesByRecId: Map<
  string,
  import("@/domains/product/recommendation-response-store").RecommendationResponse
> = new Map();
vi.mock("@/domains/product/recommendation-response-store", () => ({
  getResponse: async (recId: string) => _responsesByRecId.get(recId) ?? null,
}));

// Lifecycle load — page calls per-row. Stub by rec_id (proxy for
// recommended_edit identity in fixtures).
let _lifecycleByEditId: Map<
  string,
  import("@/domains/citation-lifecycle/load-lifecycle").LifecycleForEdit | null
> = new Map();
vi.mock("@/domains/citation-lifecycle/load-lifecycle", () => ({
  loadLifecycleForEdit: async (opts: {
    tenantId: string;
    recommendedEdit: { id: string };
  }) => {
    return _lifecycleByEditId.get(opts.recommendedEdit.id) ?? null;
  },
}));

import LifecycleEligibilityDiagnosticPage from "@/app/(shell)/diagnostics/lifecycle-eligibility/page";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { LifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import type {
  RecommendationResponse,
  RecommendationResponseStatus,
} from "@/domains/product/recommendation-response-store";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";

// ─────────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────────

function makeEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: over.id ?? "edit-1",
    tenant_id: TENANT,
    rec_id: over.rec_id ?? "rec-1",
    action_type: "add_h2_section",
    target_url: "https://example.com/services/x",
    target_element_key: "h2[new]:abc",
    display_label: null,
    current_text: null,
    proposed_text: "Some H2 text",
    why: "why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "specific-edit" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

function makeResponse(
  recId: string,
  status: RecommendationResponseStatus,
): RecommendationResponse {
  return {
    recId,
    status,
    respondedAt: "2026-05-01T00:00:00.000Z",
    deferUntil: null,
    targetPageUrl: null,
    patternId: null,
  };
}

function makeLifecycle(
  over: Partial<LifecycleForEdit["result"]> & {
    stage?: LifecycleForEdit["stage"];
  } = {},
): LifecycleForEdit {
  return {
    available: true,
    stage: over.stage ?? "cited_fast",
    copy: null,
    result: {
      eligible: true,
      eligibility_reason: "eligible_verified_live",
      first_citation_date_iso: over.first_citation_date_iso ?? "2026-05-02",
      days_to_first_citation: over.days_to_first_citation ?? 1,
      days_since_live: over.days_since_live ?? 2,
      per_platform_first_citation: {
        chatgpt: "2026-05-02",
        perplexity: null,
      },
      is_partial_live: false,
      was_cited_before_live: false,
    } as LifecycleForEdit["result"],
    threshold_decision: {
      source: "profound_default",
      thresholds: T2C_THRESHOLDS,
      sample_size: 0,
      excluded_count: 0,
      percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
    },
  };
}

async function renderPage(): Promise<string> {
  const node = await LifecycleEligibilityDiagnosticPage();
  return renderToStaticMarkup(node as React.ReactElement);
}

beforeEach(() => {
  _operatorModeEnabled = true;
  _edits = [];
  _snapshots = [];
  _responsesByRecId = new Map();
  _lifecycleByEditId = new Map();
});

// ─────────────────────────────────────────────────────────────────────
// Operator gate
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — operator gate", () => {
  it("renders without throwing when operator mode is enabled", async () => {
    _operatorModeEnabled = true;
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-page="lifecycle-eligibility"');
  });

  it("renders under test mode even when operator flag is off (NODE_ENV='test' branch)", async () => {
    // Mirrors the indexability-page operator-gate behavior: vitest
    // sets NODE_ENV='test' so the access check passes regardless of
    // the flag. Production access still requires the flag.
    _operatorModeEnabled = false;
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-page="lifecycle-eligibility"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Funnel counters tile
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — funnel counters tile", () => {
  it("renders the funnel counters section with all locked data-counter attributes", async () => {
    _edits = [
      makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "recommended" }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="funnel-counters"');
    expect(html).toContain('data-counter="total_edits"');
    expect(html).toContain('data-counter="edits_recommended"');
    expect(html).toContain('data-counter="edits_dismissed"');
    expect(html).toContain('data-counter="edits_accepted_not_live"');
    expect(html).toContain('data-counter="edits_with_live_at"');
    expect(html).toContain('data-counter="edits_verified_live"');
    expect(html).toContain('data-counter="edits_cited_post_ship"');
    expect(html).toContain('data-counter="edits_threshold_eligible"');
  });

  it("renders the responses-and-gate section with the threshold gate progress", async () => {
    _edits = [
      makeEdit({ id: "a", rec_id: "rec-a", implementation_status: "recommended" }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="responses-and-gate"');
    expect(html).toContain('data-counter="responses_total"');
    expect(html).toContain('data-counter="responses_accepted"');
    expect(html).toContain('data-counter="responses_dismissed"');
    expect(html).toContain('data-counter="responses_deferred"');
    expect(html).toContain('data-counter="edits_in_accepted_lineage"');
    expect(html).toContain('data-counter="threshold_gate_progress"');
    expect(html).toContain('data-counter="threshold_source"');
  });

  it("renders the URL coverage section", async () => {
    _edits = [
      makeEdit({ id: "a", rec_id: "rec-a", target_url: "https://example.com/a" }),
    ];
    _snapshots = [{ url: "https://example.com/a" }];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="url-coverage"');
    expect(html).toContain('data-counter="unique_target_urls"');
    expect(html).toContain('data-counter="urls_with_snapshot_coverage"');
    expect(html).toContain('data-counter="urls_without_snapshot_coverage"');
    expect(html).toContain('data-counter="urls_with_canonicalization_mismatch"');
  });

  it("renders the block classification section", async () => {
    _edits = [makeEdit({ id: "a", rec_id: "rec-a" })];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="block-classification"');
    expect(html).toContain('data-counter="edits_blocked_by_operator"');
    expect(html).toContain('data-counter="edits_blocked_by_system"');
    expect(html).toContain('data-counter="edits_terminal_or_in_flight"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reason-distribution chips
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — reason-distribution chips", () => {
  it("renders one chip per value in the 15-value reason taxonomy", async () => {
    _edits = [makeEdit({ id: "a", rec_id: "rec-a" })];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="reason-distribution"');

    const expectedReasons = [
      "awaiting_operator_acceptance",
      "accepted_not_live",
      "no_snapshot_for_target_url",
      "url_canonicalization_mismatch",
      "match_fields_missing",
      "missing_live_at",
      "missing_target_url",
      "wrong_page",
      "stuck_uncited",
      "verified_live_not_yet_cited",
      "needs_new_page_sentinel",
      "dismissed_at_response_level",
      "dismissed_at_edit_level",
      "cited_eligible",
      "unknown",
    ];
    for (const r of expectedReasons) {
      expect(html).toContain(`data-reason-tally="${r}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-row table
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — per-row table", () => {
  it("renders one row per recommended_edit with stable data-row attributes", async () => {
    _edits = [
      makeEdit({ id: "edit-a", rec_id: "rec-a", implementation_status: "recommended" }),
      makeEdit({
        id: "edit-b",
        rec_id: "rec-b",
        implementation_status: "dismissed",
      }),
    ];
    const html = await renderPage();
    const rowMatches = html.match(/data-diagnostics-row="true"/g);
    expect(rowMatches?.length).toBe(2);

    expect(html).toContain('data-row-edit-id="edit-a"');
    expect(html).toContain('data-row-edit-id="edit-b"');
    expect(html).toContain('data-row-impl-status="recommended"');
    expect(html).toContain('data-row-impl-status="dismissed"');
    expect(html).toContain('data-row-eligibility-reason="awaiting_operator_acceptance"');
    expect(html).toContain('data-row-eligibility-reason="dismissed_at_edit_level"');
  });

  it("renders the empty state when no recommended_edits exist", async () => {
    _edits = [];
    const html = await renderPage();
    expect(html).toContain("No recommended_edits rows for this tenant.");
    expect(html).not.toContain('data-diagnostics-row="true"');
  });

  it("orders rows by REASON_SEVERITY (most-actionable first)", async () => {
    _edits = [
      // 0: terminal (cited) — should sort LAST
      makeEdit({
        id: "edit-cited",
        rec_id: "rec-cited",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/cited",
      }),
      // 1: operator-blocked (awaiting) — should sort FIRST
      makeEdit({
        id: "edit-awaiting",
        rec_id: "rec-awaiting",
        implementation_status: "recommended",
        target_url: "https://example.com/awaiting",
      }),
    ];
    _snapshots = [{ url: "https://example.com/cited" }];
    _responsesByRecId.set("rec-cited", makeResponse("rec-cited", "accepted"));
    _lifecycleByEditId.set(
      "edit-cited",
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    );
    const html = await renderPage();

    const awaitingIdx = html.indexOf('data-row-edit-id="edit-awaiting"');
    const citedIdx = html.indexOf('data-row-edit-id="edit-cited"');
    expect(awaitingIdx).toBeGreaterThanOrEqual(0);
    expect(citedIdx).toBeGreaterThanOrEqual(0);
    expect(awaitingIdx).toBeLessThan(citedIdx);
  });

  it("renders the raw enum reason value on the row (operator surface)", async () => {
    _edits = [
      makeEdit({
        id: "edit-a",
        rec_id: "rec-a",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        live_match_kind: "exact",
      }),
    ];
    _snapshots = [{ url: "https://example.com/services/x" }];
    _responsesByRecId.set("rec-a", makeResponse("rec-a", "accepted"));
    _lifecycleByEditId.set(
      "edit-a",
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    );
    const html = await renderPage();
    expect(html).toContain('data-row-eligibility-reason="cited_eligible"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Canonicalization warning surface
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — canonicalization warning", () => {
  it("renders the warning section when urls_with_canonicalization_mismatch > 0", async () => {
    // Homepage trailing-slash case: target stores "/" but snapshot
    // stored without trailing slash.
    _edits = [
      makeEdit({
        id: "edit-home",
        rec_id: "rec-home",
        target_url: "https://example.com/",
      }),
    ];
    _snapshots = [{ url: "https://example.com" }];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-section="canonicalization-warning"');
  });

  it("hides the warning section when no canonicalization mismatch detected", async () => {
    _edits = [
      makeEdit({ id: "edit-a", rec_id: "rec-a", target_url: "https://example.com/a" }),
    ];
    _snapshots = [{ url: "https://example.com/a" }];
    const html = await renderPage();
    expect(html).not.toContain('data-diagnostics-section="canonicalization-warning"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ritz-shaped end-to-end story
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/lifecycle-eligibility — Ritz-shaped end-to-end", () => {
  it("renders 28 rows (20 awaiting + 7 dismissed + 1 cited) with correct counters", async () => {
    const edits: RecommendedEditRow[] = [];
    for (let i = 0; i < 20; i++) {
      edits.push(
        makeEdit({
          id: `op-${i}`,
          rec_id: `rec-op-${i}`,
          implementation_status: "recommended",
          target_url: `https://example.com/op/${i}`,
        }),
      );
    }
    for (let i = 0; i < 7; i++) {
      edits.push(
        makeEdit({
          id: `dis-${i}`,
          rec_id: `rec-dis-${i}`,
          implementation_status: "dismissed",
          target_url: `https://example.com/dis/${i}`,
          not_found_reason: "invalid_placeholder_pre_w3",
        }),
      );
    }
    edits.push(
      makeEdit({
        id: "cited-1",
        rec_id: "rec-cited-1",
        implementation_status: "verified_live",
        live_at: "2026-05-01T00:00:00.000Z",
        target_url: "https://example.com/cited/1",
        live_match_kind: "exact",
      }),
    );
    _edits = edits;
    _snapshots = edits
      .map((e) => ({ url: e.target_url as string }))
      .filter((s) => s.url != null);
    _responsesByRecId.set("rec-cited-1", makeResponse("rec-cited-1", "accepted"));
    _lifecycleByEditId.set(
      "cited-1",
      makeLifecycle({ stage: "cited_fast", days_to_first_citation: 1 }),
    );

    const html = await renderPage();

    const rowMatches = html.match(/data-diagnostics-row="true"/g);
    expect(rowMatches?.length).toBe(28);

    // 20 awaiting + 7 dismissed = 27 operator-blocked.
    expect(html).toMatch(/data-counter="edits_blocked_by_operator"[^>]*>[\s\S]*?>27</);
    expect(html).toMatch(/data-counter="edits_blocked_by_system"[^>]*>[\s\S]*?>0</);
    expect(html).toMatch(/data-counter="edits_terminal_or_in_flight"[^>]*>[\s\S]*?>1</);

    // Threshold gate not crossed (1/20).
    expect(html).toMatch(/data-counter="threshold_source"[^>]*>[\s\S]*?>profound_default</);
  });
});
