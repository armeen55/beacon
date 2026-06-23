import { describe, it, expect } from "vitest";
import { runInProcessColdStartScan } from "@/domains/scanning/in-process-scan";
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";

/**
 * In-process cold-start crawler — Vercel-safe launch fallback.
 * All deps injected; no network, no .data, no Supabase.
 */

const SITEMAP = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://acme.test/</loc></url>
  <url><loc>https://acme.test/pricing</loc></url>
  <url><loc>https://acme.test/pricing/</loc></url>
</urlset>`;

const HTML = (title: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<meta name="description" content="d"></head><body><h1>${title}</h1><p>hello world body</p></body></html>`;

/** Build a fetch mock from a url→{status,body} table; robots.txt always allows. */
function mockFetch(table: Record<string, { status: number; body: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/robots.txt")) {
      return { ok: true, status: 200, text: async () => "" } as Response;
    }
    const hit = table[url];
    if (!hit) return { ok: false, status: 404, text: async () => "" } as Response;
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      text: async () => hit.body,
    } as Response;
  }) as unknown as typeof fetch;
}

function capture() {
  const pages: PageEntity[][] = [];
  const snaps: PageSnapshot[][] = [];
  return {
    pages,
    snaps,
    syncPagesImpl: async (rows: PageEntity[]) => {
      pages.push(rows);
    },
    syncPageSnapshotsImpl: async (rows: PageSnapshot[]) => {
      snaps.push(rows);
    },
  };
}

describe("runInProcessColdStartScan", () => {
  it("crawls sitemap pages and dual-writes pages + snapshots with a matching join key", async () => {
    const cap = capture();
    const res = await runInProcessColdStartScan({
      tenantId: "tenant-acme",
      domain: "acme.test",
      deps: {
        fetchImpl: mockFetch({
          "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP },
          "https://acme.test/": { status: 200, body: HTML("Home") },
          "https://acme.test/pricing": { status: 200, body: HTML("Pricing") },
        }),
        now: () => 1_000_000,
        syncPagesImpl: cap.syncPagesImpl,
        syncPageSnapshotsImpl: cap.syncPageSnapshotsImpl,
      },
    });

    expect(res.status).toBe("scanned");
    expect(res.source).toBe("sitemap");
    // "/pricing" and "/pricing/" dedupe to one canonical key → 2 distinct pages.
    expect(res.pagesDiscovered).toBe(2);
    expect(res.snapshotsWritten).toBe(2);

    const writtenPages = cap.pages[0];
    const writtenSnaps = cap.snaps[0];
    expect(writtenPages).toHaveLength(2);
    expect(writtenSnaps).toHaveLength(2);

    // The read-path join: every snapshot.page_id must equal a page.id.
    const pageIds = new Set(writtenPages.map((p) => p.id));
    for (const s of writtenSnaps) expect(pageIds.has(s.page_id)).toBe(true);

    // Ids are deterministic (stable across re-runs) and tenant-stamped.
    expect(writtenPages.every((p) => p.id.startsWith("page-"))).toBe(true);
    expect(writtenPages.every((p) => p.tenant_id === "tenant-acme")).toBe(true);
    expect(writtenPages.every((p) => p.is_owned)).toBe(true);
    expect(writtenPages.find((p) => p.path === "/")?.page_type).toBe("homepage");
  });

  it("is deterministic: a second run produces the identical page ids (idempotent upsert)", async () => {
    const mk = () =>
      runInProcessColdStartScan({
        tenantId: "tenant-acme",
        domain: "https://acme.test",
        deps: {
          fetchImpl: mockFetch({
            "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP },
            "https://acme.test/": { status: 200, body: HTML("Home") },
            "https://acme.test/pricing": { status: 200, body: HTML("Pricing") },
          }),
          now: () => 2_000_000,
          syncPagesImpl: async () => {},
          syncPageSnapshotsImpl: async () => {},
        },
      });
    const a = capture();
    const b = capture();
    await runInProcessColdStartScan({ tenantId: "t", domain: "acme.test", deps: { fetchImpl: mockFetch({ "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP }, "https://acme.test/": { status: 200, body: HTML("H") }, "https://acme.test/pricing": { status: 200, body: HTML("P") } }), now: () => 1, syncPagesImpl: a.syncPagesImpl, syncPageSnapshotsImpl: a.syncPageSnapshotsImpl } });
    await runInProcessColdStartScan({ tenantId: "t", domain: "acme.test", deps: { fetchImpl: mockFetch({ "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP }, "https://acme.test/": { status: 200, body: HTML("H2") }, "https://acme.test/pricing": { status: 200, body: HTML("P2") } }), now: () => 99, syncPagesImpl: b.syncPagesImpl, syncPageSnapshotsImpl: b.syncPageSnapshotsImpl } });
    expect(a.pages[0].map((p) => p.id).sort()).toEqual(b.pages[0].map((p) => p.id).sort());
    void mk;
  });

  it("falls back to the homepage seed when no sitemap exists", async () => {
    const cap = capture();
    const res = await runInProcessColdStartScan({
      tenantId: "t",
      domain: "acme.test",
      deps: {
        fetchImpl: mockFetch({ "https://acme.test/": { status: 200, body: HTML("Home") } }),
        now: () => 1,
        syncPagesImpl: cap.syncPagesImpl,
        syncPageSnapshotsImpl: cap.syncPageSnapshotsImpl,
      },
    });
    expect(res.status).toBe("scanned");
    expect(res.source).toBe("homepage");
    expect(res.snapshotsWritten).toBe(1);
  });

  it("returns no_domain for empty/unusable domain and never throws", async () => {
    const res = await runInProcessColdStartScan({ tenantId: "t", domain: "" });
    expect(res.status).toBe("no_domain");
  });

  it("is failure-soft: a syncPages throw does not prevent snapshot write or throw", async () => {
    const snaps: PageSnapshot[][] = [];
    const res = await runInProcessColdStartScan({
      tenantId: "t",
      domain: "acme.test",
      deps: {
        fetchImpl: mockFetch({
          "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP },
          "https://acme.test/": { status: 200, body: HTML("Home") },
          "https://acme.test/pricing": { status: 200, body: HTML("Pricing") },
        }),
        now: () => 1,
        syncPagesImpl: async () => {
          throw new Error("supabase down");
        },
        syncPageSnapshotsImpl: async (rows) => {
          snaps.push(rows);
        },
      },
    });
    expect(res.status).toBe("scanned");
    expect(res.snapshotsWritten).toBe(2);
    expect(snaps[0]).toHaveLength(2);
  });

  it("stops crawling once the time budget is exceeded", async () => {
    let t = 0;
    const cap = capture();
    const res = await runInProcessColdStartScan({
      tenantId: "t",
      domain: "acme.test",
      deps: {
        fetchImpl: mockFetch({
          "https://acme.test/sitemap.xml": { status: 200, body: SITEMAP },
          "https://acme.test/": { status: 200, body: HTML("Home") },
          "https://acme.test/pricing": { status: 200, body: HTML("Pricing") },
        }),
        // Clock jumps past the budget after the first page fetch.
        now: () => {
          t += 30_000;
          return t;
        },
        totalBudgetMs: 10_000,
        syncPagesImpl: cap.syncPagesImpl,
        syncPageSnapshotsImpl: cap.syncPageSnapshotsImpl,
      },
    });
    // Budget tripped before any page crawled → no fetchable pages.
    expect(res.status).toBe("no_pages");
    expect(res.pagesCrawled).toBe(0);
  });
});
