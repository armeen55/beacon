/**
 * 2026-06-09 — Competitor-intel refresh pipeline tests: robots parsing/
 * verdicts, polite fetch (injected fetchImpl, no network), store dedupe
 * + caps (json-store mocked), and the full refresh orchestration
 * (collaborators mocked; HTML extraction runs REAL cheerio on tiny
 * fixtures so the snapshot mapping is exercised end-to-end).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── json-store mock (in-memory) ───────────────────────────────────────
const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));

// ── competitor-monitoring collaborators ───────────────────────────────
let _monitoringState: {
  lastCrawlAt: string | null;
  snapshots: unknown[];
  recentChanges: unknown[];
} = { lastCrawlAt: null, snapshots: [], recentChanges: [] };
const saveCompetitorMonitoringState = vi.fn(async (s: typeof _monitoringState) => {
  _monitoringState = s;
});
vi.mock("@/domains/competitor-monitoring/store", () => ({
  getCompetitorMonitoringState: async () => _monitoringState,
  saveCompetitorMonitoringState: (s: typeof _monitoringState) =>
    saveCompetitorMonitoringState(s),
}));

let _crawlResult: unknown[] = [];
vi.mock("@/domains/competitor-monitoring/sitemap-crawler", () => ({
  crawlAllCompetitors: async () => _crawlResult,
}));

let _detectedChanges: unknown[] = [];
vi.mock("@/domains/competitor-monitoring/detect-changes", () => ({
  detectCompetitorChanges: () => _detectedChanges,
}));

// ── universe + evidence + snapshot store ──────────────────────────────
let _universeEntries: Array<{ domain: string; display_name: string }> = [
  { domain: "supplehomesinc.com", display_name: "Supple Homes" },
];
vi.mock("@/domains/competitors/universe-read", () => ({
  loadCompetitorUniverseRuntime: async () => ({
    origin: "configured_file",
    entries: _universeEntries.map((e, i) => ({
      id: `c${i}`,
      status: "active",
      ...e,
    })),
    domainToLabel: {},
    pin: { universe_version: 1, universe_fingerprint: "f", legacy_unversioned_file: false },
  }),
}));

let _evidence: Array<{ pageUrl: string; domain: string; citationCount: number }> = [];
vi.mock("@/domains/pages/competitor-evidence", () => ({
  getCompetitorPages: async () => _evidence,
}));

const _storedSnapshots = new Map<string, unknown>();
const persistCompetitorPageSnapshots = vi.fn(async (rows: Array<{ url: string }>) => {
  for (const r of rows) _storedSnapshots.set(r.url, r);
});
vi.mock("@/domains/pages/competitor-page-snapshots", async () => {
  const real = await vi.importActual<
    typeof import("@/domains/pages/competitor-page-snapshots")
  >("@/domains/pages/competitor-page-snapshots");
  return {
    ...real,
    getCompetitorPageSnapshotsByUrl: async () => new Map(_storedSnapshots),
    persistCompetitorPageSnapshots: (rows: Array<{ url: string }>) =>
      persistCompetitorPageSnapshots(rows),
  };
});

import {
  parseRobotsDisallows,
  isPathAllowed,
  robotsVerdictFor,
  fetchPageHtml,
} from "@/domains/competitor-intel/polite-fetch";
import {
  appendCompetitorStructuralChanges,
  getCompetitorStructuralChanges,
} from "@/domains/competitor-intel/structural-changes-store";
import {
  appendCompetitorSitemapChanges,
  getCompetitorSitemapChangeHistory,
} from "@/domains/competitor-intel/sitemap-changes-store";
import { refreshCompetitorIntel } from "@/domains/competitor-intel/refresh-intel";
import type { CompetitorStructuralChange } from "@/domains/competitor-intel/types";

beforeEach(() => {
  _stores.clear();
  _storedSnapshots.clear();
  _monitoringState = { lastCrawlAt: null, snapshots: [], recentChanges: [] };
  _crawlResult = [];
  _detectedChanges = [];
  _evidence = [];
  _universeEntries = [{ domain: "supplehomesinc.com", display_name: "Supple Homes" }];
  saveCompetitorMonitoringState.mockClear();
  persistCompetitorPageSnapshots.mockClear();
});

describe("polite-fetch — robots", () => {
  it("parses Disallow under * and BeaconBot groups only", () => {
    const rules = parseRobotsDisallows(
      [
        "User-agent: googlebot",
        "Disallow: /google-only",
        "User-agent: *",
        "Disallow: /private",
        "Disallow:",
        "User-agent: BeaconBot",
        "Disallow: /no-bots",
        "# comment",
      ].join("\n"),
    );
    expect(rules).toEqual(["/private", "/no-bots"]);
    expect(isPathAllowed("/public", rules)).toBe(true);
    expect(isPathAllowed("/private/page", rules)).toBe(false);
  });

  it("Disallow: / blocks everything; verdict caches robots per origin", async () => {
    let robotsFetches = 0;
    const fetchImpl = (async (u: string) => {
      robotsFetches++;
      expect(u).toBe("https://x.com/robots.txt");
      return { ok: true, text: async () => "User-agent: *\nDisallow: /" } as Response;
    }) as unknown as typeof fetch;
    const cache = new Map<string, string[]>();
    expect(await robotsVerdictFor("https://x.com/a", cache, { fetchImpl })).toBe("blocked");
    expect(await robotsVerdictFor("https://x.com/b", cache, { fetchImpl })).toBe("blocked");
    expect(robotsFetches).toBe(1);
  });

  it("robots fetch failure → permissive; malformed URL → blocked", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const cache = new Map<string, string[]>();
    expect(await robotsVerdictFor("https://y.com/a", cache, { fetchImpl })).toBe("allowed");
    expect(await robotsVerdictFor("not a url", cache, { fetchImpl })).toBe("blocked");
  });

  it("fetchPageHtml: blocked → no page fetch; non-2xx + throw → fetch_failed", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: string) => {
      calls.push(u);
      if (u.endsWith("robots.txt")) {
        return { ok: true, text: async () => "User-agent: *\nDisallow: /" } as Response;
      }
      throw new Error("should not fetch page");
    }) as unknown as typeof fetch;
    const blocked = await fetchPageHtml("https://z.com/page", new Map(), { fetchImpl });
    expect(blocked).toEqual({ ok: false, reason: "robots_blocked" });
    expect(calls).toEqual(["https://z.com/robots.txt"]);

    const non2xx = (async (u: string) =>
      u.endsWith("robots.txt")
        ? ({ ok: true, text: async () => "" } as Response)
        : ({ ok: false, status: 404 } as Response)) as unknown as typeof fetch;
    const failed = await fetchPageHtml("https://z.com/page", new Map(), { fetchImpl: non2xx });
    expect(failed).toEqual({ ok: false, reason: "fetch_failed", detail: "http_404" });
  });
});

function structChange(over: Partial<CompetitorStructuralChange> = {}): CompetitorStructuralChange {
  return {
    url: "https://supplehomesinc.com/adu",
    domain: "supplehomesinc.com",
    displayName: "Supple Homes",
    kind: "faq_added",
    detail: "added an FAQ (3 questions)",
    capturedAt: "2026-06-09T10:00:00Z",
    ...over,
  };
}

describe("intel stores — dedupe", () => {
  it("structural changes dedupe on url+kind+detail+day", async () => {
    expect(await appendCompetitorStructuralChanges([structChange()])).toBe(1);
    expect(
      await appendCompetitorStructuralChanges([
        structChange({ capturedAt: "2026-06-09T18:00:00Z" }), // same day → dupe
        structChange({ kind: "section_added", detail: "added new section: “X”" }),
      ]),
    ).toBe(1);
    expect(await getCompetitorStructuralChanges()).toHaveLength(2);
  });

  it("sitemap history dedupes + skips removed", async () => {
    const change = {
      domain: "supplehomesinc.com",
      displayName: "Supple Homes",
      type: "added" as const,
      url: "https://supplehomesinc.com/adu-cost",
      path: "/adu-cost",
      lastmod: "2026-06-02",
      previousLastmod: null,
      detectedAt: "2026-06-03T08:00:00Z",
    };
    expect(
      await appendCompetitorSitemapChanges([change, { ...change, type: "removed" }]),
    ).toBe(1);
    expect(await appendCompetitorSitemapChanges([change])).toBe(0);
    expect(await getCompetitorSitemapChangeHistory()).toHaveLength(1);
  });
});

const SUPPLE_HTML = `<!doctype html><html><head>
<title>ADU Cost Guide</title>
<meta name="description" content="Real ADU costs.">
</head><body>
<h1>ADU Cost Guide</h1>
<h2>ADU Cost Breakdown</h2>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
 {"@type":"Question","name":"How much does an ADU cost?",
  "acceptedAnswer":{"@type":"Answer","text":"It depends."}}]}
</script>
</body></html>`;

describe("refreshCompetitorIntel — orchestration", () => {
  it("crawls, saves state, records history, fetches top-cited pages, persists snapshots", async () => {
    _evidence = [
      { pageUrl: "https://supplehomesinc.com/adu-cost", domain: "supplehomesinc.com", citationCount: 9 },
      { pageUrl: "https://untracked.com/x", domain: "untracked.com", citationCount: 99 }, // not in universe
    ];
    const fetched: string[] = [];
    const fetchImpl = (async (u: string) => {
      fetched.push(u);
      if (u.endsWith("robots.txt")) return { ok: true, text: async () => "" } as Response;
      return { ok: true, status: 200, text: async () => SUPPLE_HTML } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await refreshCompetitorIntel({ fetchImpl, now: new Date("2026-06-09T12:00:00Z") });
    expect(r.ok).toBe(true);
    expect(r.competitorsCrawled).toBe(1);
    expect(saveCompetitorMonitoringState).toHaveBeenCalledTimes(1);
    // untracked.com never fetched
    expect(fetched.some((u) => u.includes("untracked.com"))).toBe(false);
    expect(r.urlsFetched).toBe(1);
    expect(persistCompetitorPageSnapshots).toHaveBeenCalledTimes(1);
    const [rows] = persistCompetitorPageSnapshots.mock.calls[0] as [
      Array<{ url: string; title: string | null; faq_questions: string[] }>,
    ];
    expect(rows[0]!.title).toBe("ADU Cost Guide");
    expect(rows[0]!.faq_questions).toEqual(["How much does an ADU cost?"]);
    // first fetch of this URL → no prior snapshot → no structural changes
    expect(r.structuralChangesDetected).toBe(0);
  });

  it("diffs against the stored snapshot and records structural changes", async () => {
    _evidence = [
      { pageUrl: "https://supplehomesinc.com/adu-cost", domain: "supplehomesinc.com", citationCount: 9 },
    ];
    _storedSnapshots.set("https://supplehomesinc.com/adu-cost", {
      id: "comp-snap-tenant-test-x",
      tenant_id: "tenant-test",
      url: "https://supplehomesinc.com/adu-cost",
      canonical_url: null,
      fetched_at: "2026-05-20T00:00:00Z",
      http_status: 200,
      title: "ADU Cost Guide",
      meta_description: null,
      h1: "ADU Cost Guide",
      h2_list: [],
      faq_questions: [],
      extraction_certainty: "confirmed",
    });
    const fetchImpl = (async (u: string) =>
      u.endsWith("robots.txt")
        ? ({ ok: true, text: async () => "" } as Response)
        : ({ ok: true, status: 200, text: async () => SUPPLE_HTML } as unknown as Response)) as unknown as typeof fetch;

    const r = await refreshCompetitorIntel({ fetchImpl, now: new Date("2026-06-09T12:00:00Z") });
    // fresh page has FAQ (added), new H2 section, meta added vs stored
    expect(r.structuralChangesDetected).toBe(3);
    const stored = await getCompetitorStructuralChanges();
    expect(stored.map((c) => c.kind).sort()).toEqual([
      "faq_added",
      "meta_added",
      "section_added",
    ]);
  });

  it("robots-blocked URLs are counted and never fetched; sitemap changes flow to history", async () => {
    _evidence = [
      { pageUrl: "https://supplehomesinc.com/adu-cost", domain: "supplehomesinc.com", citationCount: 9 },
    ];
    _detectedChanges = [
      {
        domain: "supplehomesinc.com",
        displayName: "Supple Homes",
        type: "added",
        url: "https://supplehomesinc.com/new-page",
        path: "/new-page",
        lastmod: "2026-06-08",
        previousLastmod: null,
        detectedAt: "2026-06-09T08:00:00Z",
      },
    ];
    const pageFetches: string[] = [];
    const fetchImpl = (async (u: string) => {
      if (u.endsWith("robots.txt")) {
        return { ok: true, text: async () => "User-agent: *\nDisallow: /" } as Response;
      }
      pageFetches.push(u);
      return { ok: true, status: 200, text: async () => SUPPLE_HTML } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await refreshCompetitorIntel({ fetchImpl, now: new Date("2026-06-09T12:00:00Z") });
    expect(r.sitemapChangesDetected).toBe(1);
    expect(r.sitemapChangesRecorded).toBe(1);
    expect(await getCompetitorSitemapChangeHistory()).toHaveLength(1);
    expect(pageFetches).toEqual([]); // everything robots-blocked
    expect(r.urlsBlocked).toBe(2); // top-cited + just-changed
    expect(r.urlsFetched).toBe(0);
  });
});
