import { describe, expect, it, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { completenessOf } from "@/domains/evidence/scanning/crawl-frontier";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";

describe("rendered recovery follows unresolved page identities", () => {
  const tenant = "fixture-tenant", current = "2026-09-22T12:00:00.000Z", now = Date.parse(current);
  const recent = "https://fixture.example/recent", unread = "https://fixture.example/unread";
  const row = (id: string, page_id: string, url: string, fetched_at: string, words: number): Row => ({ id, page_id, url, tenant_id: tenant, fetched_at, word_count: words, http_status: 200,
    extraction_certainty: words ? "confirmed" : "uncertain", content_hash: `hash-${id}`, body_text: words ? "Qualified owned content." : "",
    content_capture: words ? { version: 1, complete: true, mainHtml: "<main><p>Qualified owned content.</p></main>", jsonLd: [] } : null, structural_warnings: [] });
  const inventory = [
    { tenant_id: tenant, url: recent, crawl_state: "crawled", http_status: 200, is_canonical_target: true, last_crawled_at: "2026-09-18T00:00:00.000Z" },
    { tenant_id: tenant, url: unread, crawl_state: "crawled", http_status: 200, is_canonical_target: true, last_crawled_at: "2026-09-19T00:00:00.000Z" },
  ];

  it("reaches structurally unresolved URL behind 2,001 newer snapshots and spends nothing on a qualified neighbor", async () => {
    const disputed = row("old", "page-z", unread, "2026-09-01T00:00:00.000Z", 3);
    disputed.body_text = "B"; disputed.content_capture = { version: 1, complete: true, mainHtml: "<main><p>A</p></main>", jsonLd: [] };
    const snapshots = [disputed,
      ...Array.from({ length: 2001 }, (_, i) => row(`new-${i}`, "page-a", recent, new Date(now - i * 1000).toISOString(), 3))];
    const tables: Record<string, Row[]> = { owned_pages: inventory, page_snapshots: snapshots };
    const selected: string[] = [], sb = supabaseFake({ rows: (name) => tables[name] ?? [], onSelect: (table, read) => { if (table === "page_snapshots") selected.push(read.cols); } });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb }));
    const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read");
    const { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context");
    const fetched: string[] = [], provider: string[] = [];
    const deps = { now: () => now, loadProfile: async () => null,
      readOwnedBodies: loadOwnedPageBodies,
      fetchPage: async (url: string) => { fetched.push(url); return { ok: false, reason: "robots_blocked" }; },
      callProvider: async (capability: string) => { provider.push(capability); throw new Error("no provider call was authorized"); },
    } as unknown as FunnelDeps;
    try {
      expect((await loadOwnedPageBodies(tenant, [unread])).get(canonicalUrlKey(unread))?.completeness).toBe("partial");
      expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).toBe(0);
      expect([fetched, provider, selected.length > 0]).toEqual([[unread], [], true]);
      fetched.length = 0;
      expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).toBe(0);
      expect([fetched, provider]).toEqual([[], []]);
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });

  it("marks a raw capture with incomplete canonical HTML as partial", () => {
    const snap = extractPageSnapshot("<main><h1>Page</h1><p>Readable words exist here.</p></main>", unread, "p", tenant);
    snap.content_capture!.complete = false;
    expect(completenessOf(snap)).toBe("partial");
    delete (snap as unknown as Record<string, unknown>).content_capture;
    expect(completenessOf(snap)).toBe("partial");
  });

  it("reaches URL 61 past 60 partial rendered failures, then reads back its hold without buying a provider call", async () => {
    const urls = Array.from({ length: 61 }, (_, i) => `https://fixture.example/page-${String(i).padStart(2, "0")}`);
    const rows: Row[] = urls.map((url) => ({ tenant_id: tenant, url, crawl_state: "crawled", http_status: 200,
      is_canonical_target: true, last_crawled_at: current, blocked_until: null }));
    const snaps = urls.slice(0, 60).map((url, i) => ({ ...row(`partial-${i}`, `page-${i}`, url, current, 3),
      content_capture: { version: 1, complete: false, mainHtml: "<main><p>Partial copy.</p></main>", jsonLd: [] }, structural_warnings: ["rendered_read: partial capture"] }));
    const sb = supabaseFake({ rows: (name) => name === "owned_pages" ? rows : name === "page_snapshots" ? snaps : [] });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb }));
    const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read");
    let clock = now;
    const fetch = vi.fn(async () => ({ ok: false, reason: "robots_blocked" }));
    const provider = vi.fn(async () => { throw new Error("provider must not run"); });
    const deps = { now: () => clock, loadProfile: async () => null, readOwnedBodies: async (_t: string, urls: string[], misses?: Map<string, string>) => { urls.forEach((url) => misses?.set(canonicalUrlKey(url), "no_capture")); return new Map(); },
      fetchPage: fetch, callProvider: provider } as unknown as FunnelDeps;
    try {
      expect(await renderUnreadOwnedPages(tenant, 60, { deps, deadline: clock + 90_000 })).toBe(0);
      expect(fetch.mock.calls.length).toBe(60);
      clock += 86_400_001;
      expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: clock + 90_000 })).toBe(0);
      expect(fetch).toHaveBeenCalledWith(urls[60], expect.any(Map), expect.any(Object));
      expect(rows[60]).toMatchObject({ crawl_state: "crawled", http_status: 200, blocked_until: new Date(clock + 86_400_000).toISOString() });
      expect([fetch.mock.calls.length, provider.mock.calls.length]).toEqual([61, 0]);
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });

  it("fails closed when a retry hold cannot be saved", async () => {
    let reject = true, vanish = false;
    const rows: Row[] = [{ ...inventory[1], blocked_until: null }], sb = supabaseFake({ rows: (name) => name === "owned_pages" ? rows : [],
      error: (table, op) => reject && table === "owned_pages" && op === "update" ? { message: "write rejected" } : null });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb }));
    const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read");
    const provider = vi.fn(), deps = { now: () => now, loadProfile: async () => null,
      readOwnedBodies: async (_t: string, urls: string[], misses?: Map<string, string>) => { urls.forEach((url) => misses?.set(canonicalUrlKey(url), "no_capture")); return new Map(); },
      fetchPage: async () => { if (vanish) rows.length = 0; return { ok: false, reason: "robots_blocked" }; }, callProvider: provider } as unknown as FunnelDeps;
    try {
      await expect(renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).rejects.toThrow("retry could not be stored");
      expect([rows[0]!.blocked_until, provider.mock.calls.length]).toEqual([null, 0]);
      reject = false; vanish = true;
      await expect(renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).rejects.toThrow("inventory row changed");
      expect(provider).not.toHaveBeenCalled();
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });
});
