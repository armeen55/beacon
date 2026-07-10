/**
 * 2026-05-17 A.3.b1.beta — /diagnostics/indexability GSC column tests.
 *
 * Sibling to `indexability-page.test.tsx`; covers ONLY the
 * GSC-specific column + summary tile that A.3.b1.beta adds. Existing
 * page test continues to validate the pre-beta surface.
 *
 * Pins:
 *   • Page passes `enableGsc: true` to loadIndexabilityForUrl.
 *   • GSC summary tile renders BEACON_GSC_SITE_URL value + fresh-
 *     inspection counter.
 *   • Per-row GSC badge renders four states (indexed / not_indexed /
 *     ambiguous / unchecked).
 *   • `not_indexed_in_gsc` reason copy carries the indexing_state.
 *   • No real Google API calls.
 *
 * Operator-only diagnostic surface — operator vocabulary only.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
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

vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => true,
}));

const TENANT = "tenant-a";
const _loaderCallLog: Array<Record<string, unknown>> = [];
let _recommendedEdits: ReadonlyArray<{ target_url: string | null }> = [];
let _indexabilityResults: Record<
  string,
  import("@/domains/indexability/types").OwnedUrlIndexability
> = {};

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => TENANT,
}));

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({
    name: "Test Co",
    domain: "example.com",
    industry: "",
    phone: "",
    address: "",
    yelpBusinessId: "",
    locations: [],
    services: [],
    primaryCompetitors: [],
    keyPages: [],
    locationTerms: [],
    serviceTerms: [],
    directoryDomains: [],
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    scanSettings: { preferredHour: 0, timezone: "UTC" },
  }),
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({
      getRecommendedEdits: async () => _recommendedEdits,
      getPageSnapshots: async () => [],
      getSitemapReconciliation: async () => null,
      getRobotsState: async () => null,
      setRobotsState: async () => {},
      setSitemapReconciliation: async () => {},
    }),
  }),
}));

vi.mock("@/domains/pages/robots-parser", async () => {
  const actual = await vi.importActual<
    typeof import("@/domains/pages/robots-parser")
  >("@/domains/pages/robots-parser");
  return {
    ...actual,
    readRobotsState: async () => null,
  };
});

vi.mock("@/domains/indexability/load-indexability", () => ({
  loadIndexabilityForUrl: async (opts: Record<string, unknown>) => {
    _loaderCallLog.push(opts);
    return _indexabilityResults[opts.url as string] ?? null;
  },
  GSC_INSPECT_PER_RENDER_LIMIT: 5,
}));

vi.mock("@/domains/indexability/load-gsc-signal", () => ({
  GSC_INSPECT_PER_RENDER_LIMIT: 5,
}));

import OperatorIndexabilityDiagnosticsPage from "@/app/(shell)/diagnostics/indexability/page";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function rowWithGsc(args: {
  url: string;
  verdict: OwnedUrlIndexability["composite_verdict"];
  gsc: OwnedUrlIndexability["signals"]["gsc"];
}): OwnedUrlIndexability {
  return {
    url: args.url,
    composite_verdict: args.verdict,
    signals: {
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status: 200,
        canonical_url: args.url,
        has_canonical_mismatch: false,
        robots_meta: "index, follow",
        noindex_detected: false,
        fetched_at: "2026-05-16T08:00:00.000Z",
        extraction_certainty: "confirmed",
      },
      gsc: args.gsc,
    },
    last_computed_at: "2026-05-17T12:00:00.000Z",
    evidence_freshness_days: 1,
  };
}

function seedRow(opts: {
  url: string;
  verdict: OwnedUrlIndexability["composite_verdict"];
  gsc: OwnedUrlIndexability["signals"]["gsc"];
}): void {
  _recommendedEdits = [{ target_url: opts.url }];
  _indexabilityResults[opts.url] = rowWithGsc(opts);
}

beforeEach(() => {
  _loaderCallLog.length = 0;
  _recommendedEdits = [];
  _indexabilityResults = {};
  vi.stubEnv("BEACON_GSC_SITE_URL", "sc-domain:example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("/diagnostics/indexability — GSC opt-in (A.3.b1.beta)", () => {
  it("page passes enableGsc=true + gscBudget to loadIndexabilityForUrl", async () => {
    seedRow({
      url: "https://example.com/a",
      verdict: "ok",
      gsc: null,
    });
    await OperatorIndexabilityDiagnosticsPage({});
    expect(_loaderCallLog.length).toBeGreaterThanOrEqual(1);
    for (const call of _loaderCallLog) {
      expect(call.enableGsc).toBe(true);
      expect(call.gscBudget).toBeDefined();
    }
  });
});

describe("/diagnostics/indexability — GSC summary tile", () => {
  it("renders BEACON_GSC_SITE_URL value for the tenant it was set for (P2-1 gate)", async () => {
    // P2-1: the page only prints the env property string when
    // BEACON_TENANT_ID matches the rendering tenant (the mocked "tenant-a").
    vi.stubEnv("BEACON_TENANT_ID", TENANT);
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("GSC site URL");
    expect(html).toContain("sc-domain:example.com");
  });

  it("P2-1 isolation: a DIFFERENT tenant never sees another tenant's property string", async () => {
    // Same BEACON_GSC_SITE_URL, but the env was set for some other tenant:
    // this tenant's diagnostics must render the honest "(unset)", never leak
    // the foreign property string.
    vi.stubEnv("BEACON_TENANT_ID", "tenant-someone-else");
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("(unset)");
    expect(html).not.toContain("sc-domain:example.com");
  });

  it("renders '(unset)' when BEACON_GSC_SITE_URL is empty", async () => {
    vi.stubEnv("BEACON_GSC_SITE_URL", "");
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("(unset)");
  });

  it("renders fresh-inspection counter referencing the cap (5)", async () => {
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("/ 5 cap");
  });
});

describe("/diagnostics/indexability — per-row GSC badge", () => {
  it("renders 'indexed' badge for gsc.indexed=true", async () => {
    seedRow({
      url: "https://example.com/a",
      verdict: "ok",
      gsc: {
        indexed: true,
        indexing_state: "INDEXING_ALLOWED",
        coverage_state: "Submitted and indexed",
        last_crawl_time: "2026-05-15T07:00:00.000Z",
        last_checked_at: "2026-05-17T11:00:00.000Z",
      },
    });
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-row-gsc-state="indexed"');
    expect(html).toContain("INDEXING_ALLOWED");
  });

  it("renders 'not_indexed' badge for gsc.indexed=false", async () => {
    seedRow({
      url: "https://example.com/b",
      verdict: "not_indexed_in_gsc",
      gsc: {
        indexed: false,
        indexing_state: "BLOCKED_BY_NOINDEX",
        coverage_state: "Excluded by 'noindex' tag",
        last_crawl_time: null,
        last_checked_at: "2026-05-17T11:00:00.000Z",
      },
    });
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-row-gsc-state="not_indexed"');
    expect(html).toContain("BLOCKED_BY_NOINDEX");
    // Reason carries the indexing_state.
    expect(html).toContain("GSC reports not indexed");
  });

  it("renders 'unchecked' badge for gsc=null", async () => {
    seedRow({
      url: "https://example.com/c",
      verdict: "ok",
      gsc: null,
    });
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-row-gsc-state="unchecked"');
  });

  it("renders 'ambiguous' badge for gsc.indexed=null", async () => {
    seedRow({
      url: "https://example.com/d",
      verdict: "ok",
      gsc: {
        indexed: null,
        indexing_state: "SOME_UNKNOWN_STATE",
        coverage_state: null,
        last_crawl_time: null,
        last_checked_at: "2026-05-17T11:00:00.000Z",
      },
    });
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('data-row-gsc-state="ambiguous"');
  });
});

describe("/diagnostics/indexability — GSC column headers", () => {
  it("renders GSC, GSC state, GSC checked column headers", async () => {
    seedRow({
      url: "https://example.com/a",
      verdict: "ok",
      gsc: null,
    });
    const tree = await OperatorIndexabilityDiagnosticsPage({});
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(">GSC<");
    expect(html).toContain("GSC state");
    expect(html).toContain("GSC checked");
  });
});
