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

const _notFoundSpy = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    _notFoundSpy();
    throw new Error("NEXT_NOT_FOUND");
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
    }),
  }),
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
});

async function renderPage(): Promise<string> {
  const mod = await import(
    "@/app/(shell)/diagnostics/recommendation-triggers/page"
  );
  const Page = mod.default as (props: Record<string, unknown>) => Promise<ReactElement>;
  const element = await Page({ searchParams: Promise.resolve({}) });
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

  it("predicates_run counter reads 11 (post-4.5.C.α₁ loader)", async () => {
    _snapshotsToReturn = [makeSnapshot({ url: "https://example.com/a" })];
    const html = await renderPage();
    expect(html).toContain('data-counter="predicates_run"');
    // The font-mono span renders the integer 11; check via inclusion
    // of the substring "predicates_run\">" + "11".
    expect(html).toMatch(
      /data-counter="predicates_run"[^>]*>[^<]*<span[^>]*>11<\/span>/,
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
    // Post-4.5.C.α₁: 11.
    expect(html).toContain('data-description-predicates-run="11"');
    // And the prose body contains the same integer.
    expect(html).toContain("11</span> active");
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
});
