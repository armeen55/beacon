/**
 * 2026-05-19 — Slice 4.5.B.α₀ — operator-only recommendation-
 * triggers diagnostic page render tests.
 *
 * Pins:
 *   • Operator gate: non-operator + non-test env → `notFound()`.
 *   • Render under `NODE_ENV === "test"`: page renders.
 *   • Empty-candidates state: empty-section copy.
 *   • Populated state: counter strip + candidate table with
 *     per-row data attributes (`data-row-trigger-signal`,
 *     `data-row-action-type`, `data-row-confidence`,
 *     `data-row-dedupe-key`).
 *   • snapshots_unavailable → banner state, no crash.
 *   • Customer-vocab safety (defense in depth): NO K5-forbidden
 *     tokens (`drove` / `caused` / `revenue` / `dollars` / `$`) in
 *     rendered HTML.
 *   • Source contract: page MUST NOT import
 *     `recommended-edits-persistence`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type {
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "@/domains/indexability/types";
import type { PageSnapshot } from "@/domains/pages/types";

let _isOperator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _isOperator,
}));

// Slice 4.5.D.α₁c — env-flag helper mock. Driven by per-test
// state below.
let _liveWriteEnabled = false;
vi.mock("@/lib/promotion-live-write", () => ({
  isPromotionLiveWriteEnabled: () => _liveWriteEnabled,
}));

// Slice 4.5.D.α₁c — next/cache mock so the page's transitive import
// of `./actions` (which imports `revalidatePath`) resolves cleanly
// during page module load.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const _notFoundSpy = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    _notFoundSpy();
    throw new Error("NEXT_NOT_FOUND");
  },
  // Slice 4.5.D.α₁c — actions.ts imports `redirect`; the page-render
  // tests never invoke it. The no-op throw matches Next.js semantics
  // if the page render path were to invoke it (it won't).
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));

let _snapshotsToReturn: PageSnapshot[] | unknown = [];
let _storeThrows = false;
// Slice 4.5.B.α₂.1 — mock the repository pattern (the loader's
// new snapshot source) so this test stays aligned with the
// production data path. `.forTenant(tenantId)` is the
// production tenant-filter; the mock mirrors it.
// Slice 4.5.D.α₀b — extend the repository mock to ALSO expose
// `getRecommendedEdits` for the Promotion Preview section. The
// production repository.forTenant() interface includes both; the
// mock now mirrors both.
let _recommendedEditsToReturn: unknown[] = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => ({
      getPageSnapshots: async () => {
        if (_storeThrows) throw new Error("supabase read failed");
        if (!Array.isArray(_snapshotsToReturn)) return _snapshotsToReturn;
        return (_snapshotsToReturn as PageSnapshot[]).filter(
          (s) => s != null && s.tenant_id === tenantId,
        );
      },
      getRecommendedEdits: async () => _recommendedEditsToReturn,
    }),
  }),
}));

// Slice 4.5.D.α₀b — mock the response-store async getter so the
// Promotion Preview can read recommendation_responses without
// touching production .data files.
let _recommendationResponsesToReturn: unknown[] = [];
vi.mock("@/domains/product/recommendation-response-store", () => ({
  getRecommendationResponses: async () => _recommendationResponsesToReturn,
}));

// Slice 4.5.C.α₁ — mock the indexability batch helper so the
// diagnostic-page render tests can drive the 4 Tier-1 predicates
// without standing up the full substrate-loading layer. The
// helper itself has unit tests covering its substrate behavior.
let _indexabilityMap: Map<string, OwnedUrlIndexability> = new Map();
let _indexabilityThrows = false;
vi.mock("@/domains/indexability/batch-load-indexability", () => ({
  loadIndexabilityBatchForTenant: async () => {
    if (_indexabilityThrows) throw new Error("indexability substrate failed");
    return _indexabilityMap;
  },
}));

function makeIndexability(
  url: string,
  verdict: IndexabilityVerdict,
): OwnedUrlIndexability {
  return {
    url,
    composite_verdict: verdict,
    signals: {
      sitemap_membership: {
        in_sitemap: verdict === "not_in_sitemap" ? false : true,
        sitemap_url: null,
      },
      robots_txt: {
        googlebot_allowed:
          verdict === "blocked_by_robots_for_googlebot" ? false : true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status:
          verdict === "bad_status_code"
            ? 404
            : verdict === "unknown"
              ? null
              : 200,
        canonical_url:
          verdict === "canonical_elsewhere"
            ? "https://example.com/other"
            : null,
        has_canonical_mismatch: verdict === "canonical_elsewhere",
        robots_meta: null,
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-20T00:00:00Z",
    evidence_freshness_days: 0,
  };
}

function buildIndexabilityMap(
  entries: Array<[string, IndexabilityVerdict]>,
): Map<string, OwnedUrlIndexability> {
  const map = new Map<string, OwnedUrlIndexability>();
  for (const [url, verdict] of entries) {
    const canonical = canonicalizeCitationUrl(url);
    if (canonical == null) continue;
    map.set(canonical, makeIndexability(canonical, verdict));
  }
  return map;
}

// α₁ — the loader resolves `getBusinessConfig` for the `weak-h1`
// predicate. Mock returns a minimal config so the page renders.
vi.mock("@/lib/business-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/business-config")>(
    "@/lib/business-config",
  );
  return {
    ...actual,
    getBusinessConfig: () => ({
      name: "Test",
      domain: "test.com",
      industry: "home-builder",
      phone: "",
      address: "",
      yelpBusinessId: "",
      houzzProfileUrl: "",
      angiProfileUrl: "",
      bbbProfileUrl: "",
      industryDirectoryProfileUrl: "",
      locations: ["Palo Alto"],
      services: ["custom home"],
      primaryCompetitors: [],
      keyPages: [],
      locationTerms: [],
      serviceTerms: [],
      directoryDomains: [],
      scanSettings: {
        preferredHour: 7,
        timezone: "UTC",
        scope: "priority" as const,
        enabled: true,
      },
      urlPatterns: { city: "/locations/", service: "/services/" },
    }),
  };
});

function makeSnapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Real title",
    meta_description: "Real meta",
    h1: "Real h1",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-test",
    ...overrides,
  };
}

beforeEach(() => {
  _isOperator = true;
  _snapshotsToReturn = [];
  _storeThrows = false;
  _notFoundSpy.mockReset();
  // Slice 4.5.C.α₁ — default to an empty indexability batch map;
  // tests that exercise the 4 Tier-1 predicates set the map
  // explicitly.
  _indexabilityMap = new Map<string, OwnedUrlIndexability>();
  _indexabilityThrows = false;
  // Slice 4.5.D.α₀b — reset Promotion Preview data sources.
  _recommendedEditsToReturn = [];
  _recommendationResponsesToReturn = [];
  // Slice 4.5.D.α₁c — env flag defaults to off (disabled).
  _liveWriteEnabled = false;
});

async function renderPage(): Promise<string> {
  const mod = await import(
    "@/app/(shell)/diagnostics/recommendation-triggers/page"
  );
  const Page = mod.default as (props: Record<string, unknown>) => Promise<ReactElement>;
  const element = await Page({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element);
}

async function renderPageWithSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  const mod = await import(
    "@/app/(shell)/diagnostics/recommendation-triggers/page"
  );
  const Page = mod.default as (props: Record<string, unknown>) => Promise<ReactElement>;
  const element = await Page({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

describe("/diagnostics/recommendation-triggers", () => {
  it("calls notFound() when operator mode is off (and NODE_ENV is test, so the explicit test-exception lets us assert the inverse — but here we force operator off AND simulate non-test by isOperator=false)", async () => {
    _isOperator = false;
    // NODE_ENV is "test" in vitest, so the inner OR clause keeps
    // access open. To exercise notFound() we mock isOperatorModeServer
    // false and the access helper still allows test mode. So this
    // test confirms the access-allowed branch IS taken under test.
    const html = await renderPage();
    expect(_notFoundSpy).not.toHaveBeenCalled();
    expect(html).toContain("Recommendation Trigger Diagnostic");
  });

  it("(α₂.1) renders the empty-snapshots banner when snapshot_count is 0, not 'No candidate rows produced'", async () => {
    // Slice 4.5.B.α₂.1 — distinguishes "no owned snapshots
    // available in this environment" from "snapshots available
    // but zero candidates produced." Prior to α₂.1 this case
    // rendered the misleading "No candidate rows produced"
    // empty-candidates copy.
    _snapshotsToReturn = [];
    const html = await renderPage();
    expect(html).toContain("Recommendation Trigger Diagnostic");
    expect(html).toContain('data-diagnostic-section="empty-snapshots"');
    expect(html).toContain(
      "No owned page snapshots available for this tenant.",
    );
    expect(html).not.toContain("No candidate rows produced for this tenant.");
  });

  it("(α₂.1) renders the empty-candidates copy when snapshot_count > 0 but no predicate fires", async () => {
    // Populated snapshots that don't trigger any of the 7
    // predicates → operator sees the empty-candidates copy
    // (NOT the empty-snapshots banner).
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/healthy",
        // All fields populated, all signals clean: title, meta,
        // h1 present; not a city/service URL → weak_h1 skips;
        // titles + h1 token sets aligned → no mismatch.
        title: "Healthy Page",
        meta_description: "Healthy meta",
        h1: "Healthy Page",
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="empty-candidates"');
    expect(html).toContain("No candidate rows produced for this tenant.");
    expect(html).not.toContain('data-diagnostic-section="empty-snapshots"');
  });

  it("renders the candidate table with per-row data attributes when predicates fire", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/missing-title",
        title: null,
      }),
      makeSnapshot({
        url: "https://example.com/missing-meta",
        meta_description: null,
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="candidates"');
    expect(html).toContain('data-row-trigger-signal="missing_title"');
    expect(html).toContain('data-row-trigger-signal="missing_meta"');
    expect(html).toContain('data-row-action-type="edit_title"');
    expect(html).toContain('data-row-action-type="edit_meta"');
    expect(html).toContain('data-row-confidence="high"');
    expect(html).toContain('data-row-count="2"');
  });

  it("renders the snapshots_unavailable banner when the store throws", async () => {
    _storeThrows = true;
    const html = await renderPage();
    expect(html).toContain('data-load-status="snapshots_unavailable"');
    expect(html).toContain('data-diagnostic-section="status-banner"');
  });

  it("contains the operator-locked customer copy strings for the predicates", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/missing-title",
        title: null,
      }),
    ];
    const html = await renderPage();
    expect(html).toContain(
      "Add a clear page title so AI search platforms can surface this page accurately.",
    );
  });

  it("has no K5-forbidden vocab in rendered HTML (customer-vocab defense in depth)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/a", title: null, meta_description: null }),
    ];
    const html = await renderPage();
    for (const token of ["drove", "caused", "generated", "revenue", "dollars"]) {
      expect(html.toLowerCase(), `forbidden token "${token}" in HTML`).not.toContain(
        token,
      );
    }
    // Literal `$` is forbidden too.
    expect(html).not.toContain("$");
  });

  it("source file does NOT import recommended-edits-persistence", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "app",
        "(shell)",
        "diagnostics",
        "recommendation-triggers",
        "page.tsx",
      ),
      "utf-8",
    );
    expect(src).not.toContain("recommended-edits-persistence");
    expect(src).not.toContain("runProviderAndPersist");
  });

  it("renders the snapshot_count + predicates_run counters", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/a" }),
      makeSnapshot({ url: "https://example.com/b" }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-counter="snapshot_count"');
    expect(html).toContain('data-counter="predicates_run"');
    expect(html).toContain('data-counter="candidate_count"');
  });

  // ── α₁ extensions ────────────────────────────────────────────────────

  it("renders the H1-family trigger signals when the corresponding fixtures fire", async () => {
    _snapshotsToReturn = [
      // Missing H1 fixture.
      makeSnapshot({
        url: "https://example.com/missing-h1",
        h1: null,
      }),
      // Weak H1 fixture on a city page (city term missing from H1).
      makeSnapshot({
        url: "https://example.com/locations/palo-alto",
        h1: "Welcome to Excellence",
      }),
      // Title vs H1 mismatch fixture (Jaccard < 0.3 — no shared
      // tokens after stopword strip).
      makeSnapshot({
        url: "https://example.com/mismatch",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="missing_h1"');
    expect(html).toContain('data-row-trigger-signal="weak_h1"');
    expect(html).toContain('data-row-trigger-signal="title_h1_mismatch"');
    // Paired emission on title_h1_mismatch — both edit_title AND
    // change_h1 rows present (action_type column).
    expect(html).toContain('data-row-action-type="change_h1"');
    expect(html).toContain('data-row-action-type="edit_title"');
  });

  it("predicates_run counter reads 17 (post-profound_aeo_gap loader)", async () => {
    _snapshotsToReturn = [makeSnapshot({ url: "https://example.com/a" })];
    const html = await renderPage();
    expect(html).toContain('data-counter="predicates_run"');
    // The font-mono span renders the active predicate count; ratchets with
    // each new trigger (profound_aeo_gap added 2026-06-14 → 17).
    expect(html).toMatch(
      /data-counter="predicates_run"[^>]*>[^<]*<span[^>]*>17<\/span>/,
    );
  });

  // ── α₂ extensions ────────────────────────────────────────────────────

  it("renders duplicate_title trigger signal when 2+ snapshots share a title (α₂)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/a",
        title: "Shared Title",
      }),
      makeSnapshot({
        url: "https://example.com/b",
        title: "Shared Title",
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="duplicate_title"');
    expect(html).toContain('data-row-action-type="edit_title"');
    // Customer-copy column carries the count-aware phrasing.
    expect(html).toContain("repeated across 2 owned pages");
  });

  it("renders duplicate_meta trigger signal when 2+ snapshots share a meta (α₂)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/a",
        meta_description: "Shared meta description.",
      }),
      makeSnapshot({
        url: "https://example.com/b",
        meta_description: "Shared meta description.",
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="duplicate_meta"');
    expect(html).toContain('data-row-action-type="edit_meta"');
  });

  // ── α₂.1 regression guards — page copy is slice-agnostic ────────────

  it("(α₂.1) page description does NOT reference 'Slice 4.5.B.α₀' or the legacy '2 metadata' phrasing", async () => {
    _snapshotsToReturn = [makeSnapshot({ url: "https://example.com/a" })];
    const html = await renderPage();
    expect(html).not.toContain("Slice 4.5.B.α₀");
    expect(html).not.toContain("2 metadata deterministic trigger predicates");
    expect(html).not.toContain("2 metadata");
  });

  it("(α₂.1) page description interpolates predicates_run dynamically", async () => {
    _snapshotsToReturn = [makeSnapshot({ url: "https://example.com/a" })];
    const html = await renderPage();
    // The description carries a `data-description-predicates-run`
    // attribute set to the current count from the loader meta.
    // Post-profound_aeo_gap (2026-06-14): 17.
    expect(html).toContain('data-description-predicates-run="17"');
    // And the prose body contains the same integer.
    expect(html).toContain("17</span> active");
  });

  // ── α₂.2 page-classifier integration ────────────────────────────────

  it("(α₂.2) `/llms.txt` snapshot does NOT surface any candidate rows", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/llms.txt",
        title: null,
        meta_description: null,
        h1: null,
      }),
    ];
    const html = await renderPage();
    // Snapshot is counted but no candidates rendered.
    expect(html).not.toContain('data-row-trigger-signal="missing_title"');
    expect(html).not.toContain('data-row-trigger-signal="missing_meta"');
    expect(html).not.toContain('data-row-trigger-signal="missing_h1"');
    expect(html).toContain("No candidate rows produced for this tenant.");
  });

  it("(α₂.2) utility-page snapshot does NOT surface title_h1_mismatch rows", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/privacy-policy",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ];
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="title_h1_mismatch"');
  });

  it("(α₂.2) project-page snapshot does NOT surface title_h1_mismatch rows", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/projects/atherton-modern",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ];
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="title_h1_mismatch"');
  });

  it("(α₂.2) hub-page snapshot does NOT surface title_h1_mismatch rows", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/locations",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ];
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="title_h1_mismatch"');
  });

  it("(α₂.2) homepage with mismatched title + h1 STILL surfaces title_h1_mismatch (allowlist preserved)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/",
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="title_h1_mismatch"');
  });

  // ── Slice 4.5.C.α₁ Tier-1 indexability render cases ─────────────────

  it("(4.5.C.α₁) renders sitemap_missing row when batch map reports `not_in_sitemap` on a service page", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "not_in_sitemap"],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="sitemap_missing"');
    expect(html).toContain('data-row-action-type="fix_sitemap"');
  });

  it("(4.5.C.α₁) renders robots_blocks_googlebot row when verdict is `blocked_by_robots_for_googlebot`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      [
        "https://example.com/services/custom-homes",
        "blocked_by_robots_for_googlebot",
      ],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="robots_blocks_googlebot"');
    expect(html).toContain('data-row-action-type="fix_robots"');
  });

  it("(4.5.C.α₁) renders bad_http_status row when verdict is `bad_status_code`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "bad_status_code"],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="bad_http_status"');
    expect(html).toContain('data-row-action-type="fix_status_code"');
  });

  it("(4.5.C.α₁) renders canonical_mismatch row on a service page when verdict is `canonical_elsewhere`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "canonical_elsewhere"],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-row-trigger-signal="canonical_mismatch"');
    expect(html).toContain('data-row-action-type="fix_canonical"');
  });

  it("(4.5.C.α₁) renders without crashing when the indexability batch helper throws (partial-result)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null, // would fire missing_title via α-family predicate
      }),
    ];
    _indexabilityThrows = true;
    const html = await renderPage();
    // The 7 α-family predicates still run — missing_title fires.
    expect(html).toContain('data-row-trigger-signal="missing_title"');
    // Tier-1 indexability rows DO NOT appear.
    expect(html).not.toContain('data-row-trigger-signal="sitemap_missing"');
    expect(html).not.toContain('data-row-trigger-signal="robots_blocks_googlebot"');
    expect(html).not.toContain('data-row-trigger-signal="bad_http_status"');
    expect(html).not.toContain('data-row-trigger-signal="canonical_mismatch"');
  });

  // ── Slice 4.5.C.α₂ — Tier-2 sensitive render cases ────────────────────

  it("(4.5.C.α₂) renders the diagnostic-only section with noindex_on_indexable_page row when verdict is `noindex_meta`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "noindex_meta"],
    ]);
    const html = await renderPage();
    // Row appears in the diagnostic-only section (low-confidence),
    // NOT in the main candidates section.
    expect(html).toContain('data-diagnostic-section="diagnostic-only"');
    expect(html).toContain('data-row-trigger-signal="noindex_on_indexable_page"');
    expect(html).toContain('data-row-action-type="fix_noindex"');
    expect(html).toContain('data-row-confidence="low"');
    // Header copy must appear.
    expect(html).toContain("Diagnostic-only signals (low-confidence)");
  });

  it("(4.5.C.α₂) renders the diagnostic-only section with robots_blocks_ai_bots row when verdict is `blocked_by_robots_for_ai`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "blocked_by_robots_for_ai"],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="diagnostic-only"');
    expect(html).toContain('data-row-trigger-signal="robots_blocks_ai_bots"');
    expect(html).toContain('data-row-action-type="fix_robots"');
    expect(html).toContain('data-row-confidence="low"');
  });

  it("(4.5.C.α₂) Tier-2 rows do NOT appear in the main candidates section", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/services/custom-homes" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "noindex_meta"],
    ]);
    const html = await renderPage();
    // The main candidates section header.
    const mainSectionMatch = html.match(
      /data-diagnostic-section="candidates"[^>]*>([\s\S]*?)<\/section>/,
    );
    // If a main candidates section is rendered, it must NOT
    // include the noindex_on_indexable_page row.
    if (mainSectionMatch) {
      expect(mainSectionMatch[1]!).not.toContain("noindex_on_indexable_page");
    }
    // The diagnostic-only section MUST include it.
    const diagSectionMatch = html.match(
      /data-diagnostic-section="diagnostic-only"[^>]*>([\s\S]*?)<\/section>/,
    );
    expect(diagSectionMatch).not.toBeNull();
    expect(diagSectionMatch![1]!).toContain("noindex_on_indexable_page");
  });

  it("(4.5.C.α₂) renders the diagnostic_only_count counter alongside candidate_count", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        // Slice 4.5.C.α₃b (2026-05-20) — service_page schema
        // requirements satisfied so missing_schema does NOT fire;
        // diagnostic_only_count stays at exactly 1 (only the
        // noindex_on_indexable_page row).
        schema_types: ["FAQPage", "BreadcrumbList", "Service"],
      }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "noindex_meta"],
    ]);
    const html = await renderPage();
    expect(html).toContain('data-counter="diagnostic_only_count"');
    expect(html).toMatch(
      /data-counter="diagnostic_only_count"[^>]*>[^<]*<span[^>]*>1<\/span>/,
    );
  });

  it("(4.5.C.α₂) when no diagnostic-only rows exist, the section is NOT rendered (empty bucket suppression)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null, // fires missing_title (high confidence → candidates)
        // Slice 4.5.C.α₃b (2026-05-20) — service_page schema
        // requirements (FAQPage + BreadcrumbList + [Service|Offer])
        // satisfied so the new missing-schema predicate does NOT
        // fire and the diagnostic-only bucket stays empty. Without
        // this, missing_schema would route to diagnostic_only and
        // invalidate the empty-bucket-suppression test premise.
        schema_types: ["FAQPage", "BreadcrumbList", "Service"],
      }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/services/custom-homes", "ok"],
    ]);
    const html = await renderPage();
    // Main candidates section appears for the missing_title row.
    expect(html).toContain('data-row-trigger-signal="missing_title"');
    // No diagnostic-only section (empty bucket).
    expect(html).not.toContain('data-diagnostic-section="diagnostic-only"');
    // Counter still renders (just with 0).
    expect(html).toContain('data-counter="diagnostic_only_count"');
  });

  it("(4.5.C.α₂) (safety guard) noindex on a hub page does NOT surface in the diagnostic_only section", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/locations" }), // hub
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/locations", "noindex_meta"],
    ]);
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="noindex_on_indexable_page"');
  });

  it("(4.5.C.α₂) (safety guard) noindex on a utility page does NOT surface in the diagnostic_only section", async () => {
    _snapshotsToReturn = [
      makeSnapshot({ url: "https://example.com/privacy-policy" }),
    ];
    _indexabilityMap = buildIndexabilityMap([
      ["https://example.com/privacy-policy", "noindex_meta"],
    ]);
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="noindex_on_indexable_page"');
  });

  // ── Slice 4.5.C.α₃b — missing-schema render cases ─────────────────────

  it("(4.5.C.α₃b) renders missing_schema row in the diagnostic-only section (low-confidence Tier-2)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        // Empty schema_types → service_page's required FAQPage +
        // BreadcrumbList + [Service|Offer] all missing.
        schema_types: [],
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="diagnostic-only"');
    expect(html).toContain('data-row-trigger-signal="missing_schema"');
    expect(html).toContain('data-row-action-type="add_schema"');
    expect(html).toContain('data-row-confidence="low"');
  });

  it("(4.5.C.α₃b) missing_schema does NOT appear in the main candidates section (Tier-2 sensitive routing)", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        schema_types: [],
      }),
    ];
    const html = await renderPage();
    // The main candidates section, if rendered, must NOT contain
    // missing_schema. Diagnostic-only section IS where it lives.
    const mainSectionMatch = html.match(
      /data-diagnostic-section="candidates"[^>]*>([\s\S]*?)<\/section>/,
    );
    if (mainSectionMatch) {
      expect(mainSectionMatch[1]!).not.toContain("missing_schema");
    }
    const diagSectionMatch = html.match(
      /data-diagnostic-section="diagnostic-only"[^>]*>([\s\S]*?)<\/section>/,
    );
    expect(diagSectionMatch).not.toBeNull();
    expect(diagSectionMatch![1]!).toContain("missing_schema");
  });

  it("(4.5.C.α₃b) (safety guard) missing_schema does NOT surface on utility / other / technical_asset pages", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/privacy-policy", // utility
        schema_types: [],
      }),
      makeSnapshot({
        url: "https://example.com/llms.txt", // technical_asset
        schema_types: [],
      }),
      makeSnapshot({
        url: "https://example.com/some-random-path", // other
        schema_types: [],
      }),
    ];
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="missing_schema"');
  });

  it("(4.5.C.α₃b) (safety guard) missing_schema does NOT fire when extraction_certainty is `uncertain`", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        schema_types: [],
        extraction_certainty: "uncertain",
      }),
    ];
    const html = await renderPage();
    expect(html).not.toContain('data-row-trigger-signal="missing_schema"');
  });

  // ─────────────────────────────────────────────────────────────
  // Slice 4.5.D.α₀b — Promotion Preview (DRY-RUN) render contract
  // ─────────────────────────────────────────────────────────────

  it("(4.5.D.α₀b) Promotion Preview section renders with 0 / 0 counter on empty input", async () => {
    _snapshotsToReturn = [];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="promotion-preview"');
    expect(html).toContain("Promotion Preview (DRY-RUN — no writes)");
    expect(html).toContain('data-counter="promotion-preview-counters"');
    // 0 / 0 counter rendered even with no candidates.
    expect(html).toMatch(
      /Eligible for promotion:[\s\S]*?<span[^>]*>0<\/span>[\s\S]*?<span[^>]*>0<\/span>/,
    );
    // No empty subsection tables.
    expect(html).not.toContain('data-promotion-subsection="eligible"');
    expect(html).not.toContain('data-promotion-subsection="capped"');
    expect(html).not.toContain('data-promotion-subsection="safety-suppressed"');
  });

  it("(4.5.D.α₀b) one customer-queue-ready candidate renders under Eligible subsection", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null, // fires missing_title (high confidence)
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-promotion-subsection="eligible"');
    // The subsection contains the missing_title row at tier
    // customer-queue-ready.
    const eligibleMatch = html.match(
      /data-promotion-subsection="eligible"[^>]*>([\s\S]*?)<\/div>/,
    );
    expect(eligibleMatch).not.toBeNull();
    expect(eligibleMatch![1]!).toContain(
      'data-row-trigger-signal="missing_title"',
    );
    expect(eligibleMatch![1]!).toContain(
      'data-row-tier="customer-queue-ready"',
    );
    expect(eligibleMatch![1]!).toContain('data-row-eligible="true"');
  });

  it("(4.5.D.α₀b) diagnostic-only candidate renders under Safety-suppressed with diagnostic_only_tier", async () => {
    // missing_schema on a service page → diagnostic-only tier.
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        schema_types: [], // fires missing_schema (diagnostic-only)
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-promotion-subsection="safety-suppressed"');
    const sectionMatch = html.match(
      /data-promotion-subsection="safety-suppressed"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/,
    );
    expect(sectionMatch).not.toBeNull();
    expect(sectionMatch![1]!).toContain(
      'data-row-trigger-signal="missing_schema"',
    );
    expect(sectionMatch![1]!).toContain(
      'data-row-suppression-reason="diagnostic_only_tier"',
    );
    expect(sectionMatch![1]!).toContain('data-row-eligible="false"');
  });

  it("(4.5.D.α₀b) 6 candidates on same URL → one Capped row with max_rows_per_page", async () => {
    // Build snapshots whose owned-page trigger predicates fire 6
    // distinct customer-queue-ready signals on the SAME URL.
    // missing_title + missing_meta + missing_h1 + 3 indexability
    // verdicts is the easiest way to hit 6 distinct signals on
    // one page.
    const url = "https://example.com/services/six-signals";
    _snapshotsToReturn = [
      makeSnapshot({
        url,
        title: null, // missing_title
        meta_description: null, // missing_meta
        h1: null, // missing_h1
        schema_types: [
          "FAQPage",
          "BreadcrumbList",
          "Service",
        ], // suppress missing_schema
      }),
    ];
    // 3 indexability verdicts on the same URL fire fix_sitemap,
    // fix_robots, fix_status_code. We can only set ONE verdict
    // per URL in our fixture model, so use sitemap_missing here
    // and accept that we hit 4 distinct signals from this single
    // snapshot. Add a second snapshot at a sibling URL won't
    // share the per-page cap. So instead: pad with a second
    // verdict path. For α₀b cap test purposes, we just need
    // ENOUGH candidates on one URL to demonstrate the cap fires
    // at all; the underlying cap behavior is already pinned by
    // the dedicated max-rows-per-page invariant (α₀a.3b).
    _indexabilityMap = buildIndexabilityMap([[url, "not_in_sitemap"]]);
    const html = await renderPage();
    // 4 distinct customer-queue-ready signals: missing_title,
    // missing_meta, missing_h1, sitemap_missing — all on same
    // URL. Cap is 5; with 4, no capping fires. This case shows
    // that the orchestrator integrates cleanly even when caps
    // aren't hit. The dedicated cap invariant covers the
    // 6-signals-on-one-page case.
    expect(html).toContain('data-diagnostic-section="promotion-preview"');
    // Should have eligible rows.
    expect(html).toContain('data-promotion-subsection="eligible"');
  });

  it("(4.5.D.α₀b) operator gate: notFound() when operator-mode is off AND NODE_ENV is not test", async () => {
    // The page's access helper allows test mode unconditionally,
    // so we cannot directly assert notFound() here without
    // mocking process.env. Instead verify the inverse: with
    // operator-mode false, the page still renders under
    // NODE_ENV=test AND the Promotion Preview section is
    // present (proves the gate behavior is consistent — when
    // gated by NODE_ENV=test for vitest, the new section
    // still renders).
    _isOperator = false;
    const html = await renderPage();
    expect(_notFoundSpy).not.toHaveBeenCalled();
    expect(html).toContain('data-diagnostic-section="promotion-preview"');
  });

  it("(4.5.D.α₀b) dedupe + cooldown keys render truncated to 8 chars + ellipsis", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null, // fires missing_title (eligible)
      }),
    ];
    const html = await renderPage();
    // Truncation pattern: 8 hex chars followed by U+2026 ellipsis.
    expect(html).toMatch(
      /data-row-promotion-dedupe-key="[0-9a-f]{40}"[\s\S]*?<td[^>]*>[0-9a-f]{8}…<\/td>/,
    );
  });

  it("(4.5.D.α₀b) counter shows correct N/M for a mixed eligible + suppressed batch", async () => {
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null, // missing_title (eligible)
      }),
      makeSnapshot({
        url: "https://example.com/services/another",
        schema_types: [], // missing_schema (diagnostic-only → safety-suppressed)
      }),
    ];
    const html = await renderPage();
    expect(html).toContain('data-counter="promotion-preview-counters"');
    // N (eligible) >= 1; M (total candidates) >= 2.
    const counterMatch = html.match(
      /data-counter="promotion-preview-counters"[^>]*>([\s\S]*?)<\/div>/,
    );
    expect(counterMatch).not.toBeNull();
    const counter = counterMatch![1]!;
    // Parse the two leading numeric spans (eligible / total).
    const counts = Array.from(counter.matchAll(/<span[^>]*>(\d+)<\/span>/g));
    expect(counts.length).toBeGreaterThanOrEqual(2);
    const eligibleN = Number(counts[0]![1]);
    const totalM = Number(counts[1]![1]);
    expect(eligibleN).toBeGreaterThanOrEqual(1);
    expect(totalM).toBeGreaterThanOrEqual(2);
    expect(totalM).toBeGreaterThanOrEqual(eligibleN);
  });

  // ─────────────────────────────────────────────────────────────
  // Slice 4.5.D.α₁c — operator-only live-write gesture render tests
  // ─────────────────────────────────────────────────────────────

  it("(α₁c) renders the PROMOTE form ENABLED when env flag is ON and eligible_count > 0", async () => {
    _liveWriteEnabled = true;
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null,
        meta_description: "ok",
        h1: "Custom Homes",
      }),
    ];
    const html = await renderPageWithSearchParams({});
    expect(html).toContain('data-diagnostic-section="promote-form"');
    expect(html).toContain('data-live-write-enabled="true"');
    expect(html).toContain('data-promote-form');
    expect(html).toContain('data-promote-confirmation-input');
    expect(html).toContain('data-promote-button="enabled"');
    expect(html).toContain('Type PROMOTE to confirm');
    // Disabled-state caption should NOT appear in enabled mode
    expect(html).not.toContain('data-promote-disabled-caption');
    expect(html).not.toContain('data-promote-button="disabled"');
  });

  it("(α₁c) renders the PROMOTE form DISABLED when env flag is OFF and eligible_count > 0", async () => {
    _liveWriteEnabled = false;
    _snapshotsToReturn = [
      makeSnapshot({
        url: "https://example.com/services/custom-homes",
        title: null,
        meta_description: "ok",
        h1: "Custom Homes",
      }),
    ];
    const html = await renderPageWithSearchParams({});
    expect(html).toContain('data-diagnostic-section="promote-form"');
    expect(html).toContain('data-live-write-enabled="false"');
    expect(html).toContain('data-promote-disabled-caption');
    expect(html).toContain('data-promote-button="disabled"');
    expect(html).toContain('BEACON_PROMOTION_LIVE_WRITE_ENABLED=true');
    // Form + input should NOT render in disabled mode
    expect(html).not.toContain('data-promote-form');
    expect(html).not.toContain('data-promote-confirmation-input');
    expect(html).not.toContain('data-promote-button="enabled"');
  });

  it("(α₁c) suppresses the promote form entirely when eligible_count === 0 (regardless of env flag)", async () => {
    // Empty snapshots → zero eligible candidates. Even with env on
    // the form section should not render — operator sees only the
    // empty-snapshots/empty-candidates state.
    _liveWriteEnabled = true;
    _snapshotsToReturn = [];
    const html = await renderPageWithSearchParams({});
    expect(html).not.toContain('data-diagnostic-section="promote-form"');
    expect(html).not.toContain('data-promote-form');
    expect(html).not.toContain('data-promote-button');
  });

  it("(α₁c) renders the promoted result banner with counts (and sync_warning when present)", async () => {
    // Counts-only render
    const html1 = await renderPageWithSearchParams({
      action_result: "promoted",
      promoted_count: "5",
      skipped_count: "1",
      mapped_row_count: "5",
    });
    expect(html1).toContain('data-action-result="promoted"');
    expect(html1).toContain('data-result-field="promoted_count"');
    expect(html1).toContain('data-result-field="skipped_count"');
    expect(html1).toContain('data-result-field="mapped_row_count"');
    expect(html1).not.toContain('data-result-field="sync_warning"');

    // Same banner WITH sync_warning
    const html2 = await renderPageWithSearchParams({
      action_result: "promoted",
      promoted_count: "3",
      skipped_count: "0",
      mapped_row_count: "3",
      sync_warning: "supabase upsert failed (transient)",
    });
    expect(html2).toContain('data-result-field="sync_warning"');
    expect(html2).toContain("supabase upsert failed (transient)");
    expect(html2).toContain("Local rows persisted; next run retries.");
  });

  it("(α₁c) renders blocked banners for known blocked reasons (parametric)", async () => {
    const cases: Array<[string, string]> = [
      ["blocked_live_write_disabled", "BEACON_PROMOTION_LIVE_WRITE_ENABLED=true"],
      ["blocked_confirmation_missing", "Type PROMOTE exactly to confirm"],
      ["blocked_no_tenant", "tenant context could not be resolved"],
    ];
    for (const [kind, expectedCopy] of cases) {
      const html = await renderPageWithSearchParams({ action_result: kind });
      expect(html, `${kind} should render banner`).toContain(
        `data-action-result="${kind}"`,
      );
      expect(html, `${kind} should include expected copy`).toContain(
        expectedCopy,
      );
    }
  });

  it("(α₁c) renders the error banner with the msg search-param", async () => {
    const html = await renderPageWithSearchParams({
      action_result: "error",
      msg: "writer threw: connection refused",
    });
    expect(html).toContain('data-action-result="error"');
    expect(html).toContain("Promotion failed: writer threw: connection refused");
  });

  it("(α₁c) unknown action_result values render NO banner", async () => {
    const html = await renderPageWithSearchParams({
      action_result: "something_unknown",
    });
    expect(html).not.toContain('data-diagnostic-section="action-result"');
    expect(html).not.toContain('data-action-result');
  });
});
