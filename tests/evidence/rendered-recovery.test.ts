import { describe, expect, it, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { completenessOf } from "@/domains/evidence/scanning/crawl-frontier";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
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

  it("replays a newer banked rendered task through an active source hold and clears it only after readback", async () => {
    const { winningPagesUnit } = await import("@/domains/evidence/funnel/winning-pages");
    const shell = "<main><h1>Comedians</h1><p>Loading names.</p></main>", full = `<main><h1>Comedians</h1><p>${"A named comedian appears with context. ".repeat(20)}</p></main>`, raw = extractPageSnapshot(shell, unread, "page", tenant), rendered = extractPageSnapshot(full, unread, "page", tenant);
    const held = { url: unread, state: "temporarily_unavailable", attemptedAt: new Date(now - 1000).toISOString(), retryAfter: new Date(now + 7 * 86_400_000).toISOString() }, state = { ownedReads: [held], ledger: { spentUsd: 0, cacheHits: 0 }, cycle: { runId: null, cycleKey: null, spentUsd: 0, cacheHits: 0 } } as never;
    let body = { version: "current", completeness: "partial", contentHash: raw.content_hash, vocabulary: "Loading names.", fetchedAt: current, captureStates: [{ ...raw, id: "raw" }], latestCaptureId: "raw" } as Record<string, unknown>, ready = false;
    const called: string[] = [], writes: string[] = [], fetched: string[] = [], deps = { now: () => now, loadState: async () => ({ state, rowVersion: 1 }), saveState: async () => 2, getAccount: async () => ({ domain: "fixture.example" }), loadProfile: async () => null,
      readOwnedBodies: async () => new Map([[canonicalUrlKey(unread), body]]), readIncompleteAttempt: async () => null, fetchPage: async (url: string) => { fetched.push(url); return { ok: true, html: shell, status: 200, finalUrl: unread }; },
      writeOwnedPage: async (snap: typeof raw) => { writes.push(snap.content_hash); body = { ...body, contentHash: snap.content_hash, completeness: snap.content_capture?.complete ? "complete" : "partial", fetchedAt: snap.fetched_at, captureStates: [{ ...snap }], latestCaptureId: snap.id }; },
      callProvider: async (_cap: string, _ask: unknown, ids: { bankedAfter?: string }) => { called.push(ids.bankedAfter ?? "none"); return ready ? { state: "hit", envelope: {}, cacheKey: "saved-task", costUsd: 0 } : { state: "capped", cacheKey: "saved-task", detail: "no newer receipt" }; },
      parse: () => ({ url: unread, html: full, httpStatus: 200, capturedAt: current }) } as unknown as FunnelDeps;
    const read = winningPagesUnit(deps, [], null, unread, null, null, true), cursor = { basis: "basis", runId: "run" };
    expect((await read(tenant, cursor, 90_000)).status).toBe("failed"); expect([called, (state as { ownedReads: unknown[] }).ownedReads]).toEqual([[held.attemptedAt], [held]]);
    ready = true; expect((await read(tenant, cursor, 90_000)).status).toBe("done");
    expect([called, fetched, (state as { ownedReads: unknown[] }).ownedReads, body.completeness, writes.includes(rendered.content_hash)]).toEqual([[held.attemptedAt, held.attemptedAt], [], [], "complete", true]);
  });

  it("stops an unchanged partial shell after cache expiry, reopens on an observed asset change, and holds a failed marker read", async () => {
    const url = unread, key = canonicalUrlKey(url), page = pageIdFor(key), shell = "<main><h1>Names</h1><p>Loading names.</p></main>", raw = (asset: string) => extractPageSnapshot(`<script src="/${asset}.js"></script>${shell}`, url, page, tenant), first = raw("v1"), changed = raw("v2"), stored: Row[] = [];
    let body = { version: "current", completeness: "partial", contentHash: first.content_hash, vocabulary: "Loading names.", fetchedAt: current, captureStates: [{ ...first }], latestCaptureId: first.id }, failed = false, calls = 0, clock = now;
    const sb = supabaseFake({ rows: (table) => table === "page_snapshots" ? stored : [], error: (table, op) => failed && table === "page_snapshots" && op === "select" ? { message: "read failed" } : null });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb })); const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read"), { winningPagesUnit } = await import("@/domains/evidence/funnel/winning-pages");
    const state = { ownedReads: [], ledger: { spentUsd: 0, cacheHits: 0 }, cycle: { runId: null, cycleKey: null, spentUsd: 0, cacheHits: 0 } } as never;
    const deps = { now: () => clock, loadState: async () => ({ state, rowVersion: 1 }), saveState: async () => 2, getAccount: async () => ({ domain: "fixture.example" }), loadProfile: async () => null,
      fetchPage: async () => ({ ok: true, html: `<script src="/v1.js"></script>${shell}`, status: 200, finalUrl: url }), readOwnedBodies: async () => new Map([[key, body]]), writeOwnedPage: async (snap: typeof first) => { stored.push(snap as Row); body = { ...body, contentHash: snap.content_hash, completeness: "partial", fetchedAt: snap.fetched_at, captureStates: [{ ...snap }], latestCaptureId: snap.id }; },
      callProvider: async () => ({ state: "ok", envelope: { tasks: [{ id: `task-${++calls}` }] }, cacheKey: `paid-${calls}`, costUsd: 0.02 }), parse: () => ({ url, html: shell, httpStatus: 200, capturedAt: new Date(clock).toISOString() }) } as unknown as FunnelDeps;
    try { let held = 0; const read = winningPagesUnit(deps, [], null, url, null, null, true), cursor = { basis: "basis", runId: "run" };
      const paid = await read(tenant, cursor, 90_000); expect([paid.status, paid.attempted, paid.progress.spendUsd, calls, stored[0]?.content_capture]).toEqual(["failed", undefined, 0.02, 1, expect.objectContaining({ renderedAttempt: expect.objectContaining({ taskId: "task-1", sourceRevision: first.content_capture?.sourceRevision }) })]);
      const replay = await read(tenant, cursor, 90_000); expect([replay.status, replay.attempted, replay.code, calls]).toEqual(["failed", false, "unchanged_incomplete", 1]);
      clock += 8 * 86_400_000; expect(await renderUnreadOwnedPages(tenant, 1, { url, rawSnapshot: first, deps, deadline: clock + 90_000, onUnchangedIncomplete: () => held++ })).toBe(0); expect([calls, held]).toEqual([1, 1]);
      failed = true; await expect(renderUnreadOwnedPages(tenant, 1, { url, rawSnapshot: first, deps, deadline: clock + 90_000 })).rejects.toThrow("receipt could not be read"); expect(calls).toBe(1);
      const bustedAt = new Date(clock).toISOString(); failed = false;
      expect(await renderUnreadOwnedPages(tenant, 1, { url, rawSnapshot: first, bustedAt, deps, deadline: clock + 90_000 })).toBe(0); expect(calls).toBe(2);
      expect(await renderUnreadOwnedPages(tenant, 1, { url, rawSnapshot: changed, bustedAt, deps, deadline: clock + 90_000 })).toBe(0);
      expect([calls, stored.at(-1)?.content_capture]).toEqual([3, expect.objectContaining({ renderedAttempt: expect.objectContaining({ taskId: "task-3", sourceRevision: changed.content_capture?.sourceRevision }) })]);
      const complete = { ...changed, id: "later-complete", fetched_at: new Date(clock + 1000).toISOString(), content_capture: { ...changed.content_capture!, complete: true } };
      stored.push(complete as Row); body = { ...body, completeness: "complete", fetchedAt: complete.fetched_at, captureStates: [complete], latestCaptureId: complete.id }; clock += 8 * 86_400_000;
      await renderUnreadOwnedPages(tenant, 1, { url, rawSnapshot: changed, bustedAt, deps, deadline: clock + 90_000 }); expect(calls).toBe(4);
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });

  it("reaches structurally unresolved URL behind 2,001 newer snapshots and spends nothing on a qualified neighbor", async () => {
    const disputed = row("old", "page-z", unread, "2026-09-01T00:00:00.000Z", 3); disputed.body_text = "B"; disputed.content_capture = { version: 1, complete: true, mainHtml: "<main><p>A</p></main>", jsonLd: [] };
    const snapshots = [disputed, ...Array.from({ length: 2001 }, (_, i) => row(`new-${i}`, "page-a", recent, new Date(now - i * 1000).toISOString(), 3))];
    const tables: Record<string, Row[]> = { owned_pages: inventory, page_snapshots: snapshots };
    let readError = false; const selected: string[] = [], sb = supabaseFake({ rows: (name) => tables[name] ?? [], error: (table, op) => readError && table === "page_snapshots" && op === "select" ? { message: "snapshot read failed" } : null, onSelect: (table, read) => { if (table === "page_snapshots") selected.push(read.cols); } });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb }));
    const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read"), { loadOwnedPageBodies } = await import("@/domains/evidence/pages/owned-context");
    const fetched: string[] = [], provider: string[] = [], deps = { now: () => now, loadProfile: async () => null, readOwnedBodies: loadOwnedPageBodies,
      fetchPage: async (url: string) => { fetched.push(url); return { ok: false, reason: "robots_blocked" }; }, callProvider: async (capability: string) => { provider.push(capability); throw new Error("no provider call was authorized"); } } as unknown as FunnelDeps;
    try { expect((await loadOwnedPageBodies(tenant, [unread])).get(canonicalUrlKey(unread))?.completeness).toBe("partial");
      expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).toBe(0); expect([fetched, provider, selected.length > 0]).toEqual([[unread], [], true]);
      fetched.length = 0; expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).toBe(0); expect([fetched, provider]).toEqual([[], []]);
      readError = true; await expect(renderUnreadOwnedPages(tenant, 1, { url: unread, deps, deadline: now + 90_000 })).rejects.toThrow("capture could not be read"); expect([fetched, provider]).toEqual([[], []]);
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });

  it("marks a raw capture with incomplete canonical HTML as partial", () => { const snap = extractPageSnapshot("<main><h1>Page</h1><p>Readable words exist here.</p></main>", unread, "p", tenant);
    snap.content_capture!.complete = false; expect(completenessOf(snap)).toBe("partial"); delete (snap as unknown as Record<string, unknown>).content_capture; expect(completenessOf(snap)).toBe("partial"); });

  it("reaches URL 61 past 60 partial rendered failures, then reads back its hold without buying a provider call", async () => {
    const urls = Array.from({ length: 61 }, (_, i) => `https://fixture.example/page-${String(i).padStart(2, "0")}`);
    const rows: Row[] = urls.map((url) => ({ tenant_id: tenant, url, crawl_state: "crawled", http_status: 200, is_canonical_target: true, last_crawled_at: current, blocked_until: null }));
    const snaps = urls.slice(0, 60).map((url, i) => ({ ...row(`partial-${i}`, `page-${i}`, url, current, 3), content_capture: { version: 1, complete: false, mainHtml: "<main><p>Partial copy.</p></main>", jsonLd: [] }, structural_warnings: ["rendered_read: partial capture"] }));
    const sb = supabaseFake({ rows: (name) => name === "owned_pages" ? rows : name === "page_snapshots" ? snaps : [] });
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => sb }));
    const { renderUnreadOwnedPages } = await import("@/domains/evidence/pages/rendered-read");
    let clock = now;
    const fetch = vi.fn(async () => ({ ok: false, reason: "robots_blocked" })), provider = vi.fn(async () => { throw new Error("provider must not run"); });
    const deps = { now: () => clock, loadProfile: async () => null, readOwnedBodies: async (_t: string, urls: string[], misses?: Map<string, string>) => { urls.forEach((url) => misses?.set(canonicalUrlKey(url), "no_capture")); return new Map(); },
      fetchPage: fetch, callProvider: provider } as unknown as FunnelDeps;
    try {
      expect(await renderUnreadOwnedPages(tenant, 60, { deps, deadline: clock + 90_000 })).toBe(0); expect(fetch.mock.calls.length).toBe(60);
      clock += 86_400_001; expect(await renderUnreadOwnedPages(tenant, 1, { deps, deadline: clock + 90_000 })).toBe(0);
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
      await expect(renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).rejects.toThrow("retry could not be stored"); expect([rows[0]!.blocked_until, provider.mock.calls.length]).toEqual([null, 0]);
      reject = false; vanish = true; await expect(renderUnreadOwnedPages(tenant, 1, { deps, deadline: now + 90_000 })).rejects.toThrow("inventory row changed"); expect(provider).not.toHaveBeenCalled();
    } finally { vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  });
});
