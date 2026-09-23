import "server-only";
import { log } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { isCurrent, freshnessMsFor } from "@/domains/evidence/freshness";
import { interp, resolveDeps, sha16, type FunnelDeps, type Interp, type ResolvedDeps } from "@/domains/evidence/funnel/shared";
import type { BusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "./extractor";
import type { CachedCallResult } from "@/domains/evidence/dataforseo/funnel-boundary";
import type { PageSnapshot } from "./types";

/** Bulk crawl recovery and exact page-source debt share the same rendered acquisition and snapshot writer. */
const RENDERED_READS_PER_PASS = 60, INVENTORY_PAGE = 100, RETRY_MS = 86_400_000;
async function holdUnresolved(tenantId: string, url: string, now: number): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from("owned_pages").update({ blocked_until: new Date(now + RETRY_MS).toISOString(), updated_at: new Date(now).toISOString() })
    .eq("tenant_id", tenantId).eq("url", url).select("url");
  if (error || data?.length !== 1) throw new Error(`rendered recovery retry could not be stored: ${error?.message ?? "inventory row changed"}`);
}
async function unreadOwnedPages(tenantId: string, d: ResolvedDeps, cap: number): Promise<string[]> {
  const sb = getSupabaseAdmin();
  const picked: string[] = [], seen = new Set<string>();
  for (let offset = 0; picked.length < cap; offset += INVENTORY_PAGE) {
    const { data, error } = await sb.from("owned_pages").select("url").eq("tenant_id", tenantId)
      .eq("crawl_state", "crawled").eq("http_status", 200).eq("is_canonical_target", true)
      .or(`blocked_until.is.null,blocked_until.lte."${new Date(d.now()).toISOString()}"`)
      .order("blocked_until", { ascending: true, nullsFirst: true })
      .order("last_crawled_at", { ascending: true }).order("url", { ascending: true })
      .range(offset, offset + INVENTORY_PAGE - 1);
    if (error || !Array.isArray(data)) throw error ?? new Error("owned-page inventory read was incomplete");
    const urls = data.map((row) => String(row.url ?? "")).filter(Boolean);
    const misses = new Map<string, "no_capture" | "read_failed">(), bodies = await d.readOwnedBodies(tenantId, urls, misses);
    for (const url of urls) {
      const key = canonicalUrlKey(url), body = bodies.get(key), miss = misses.get(key);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (miss === "read_failed" || (!body && miss !== "no_capture")) throw new Error("owned-page body read was incomplete");
      if (!(body?.version === "current" && body.completeness === "complete" && body.contentHash
        && isCurrent("owned_page", body.fetchedAt, d.now()))) picked.push(url);
      if (picked.length >= cap) break;
    }
    if (data.length < INVENTORY_PAGE) break;
  }
  return picked;
}

/** A provider DOM is evidence only after canonical extraction and durable readback. No text-to-HTML fabrication. */
export async function renderUnreadOwnedPages(tenantId: string, cap = RENDERED_READS_PER_PASS, options: {
  url?: string; deps?: FunnelDeps; profile?: BusinessProfile | null; deadline?: number; bustedAt?: string | null;
  rawSnapshot?: PageSnapshot; onRead?: (result: Interp, raw: CachedCallResult) => void;
} = {}): Promise<number> {
  if (cap <= 0) return 0;
  const d = resolveDeps(options.deps ?? {}), deadline = options.deadline ?? d.now() + 90_000;
  const targets = (options.url ? [options.url] : await unreadOwnedPages(tenantId, d, cap)).slice(0, cap);
  // Exact-page acquisition persists its own retry in the winning-page state.
  // Bulk recovery needs an inventory hold so the next pass reaches later URLs.
  const hold = async (url: string) => { if (!options.url) await holdUnresolved(tenantId, url, d.now()); };
  const profile = options.profile ?? await d.loadProfile(tenantId).catch(() => null);
  let landed = 0;
  for (const url of targets) {
    if (deadline - d.now() < 50_000) break;
    const key = canonicalUrlKey(url), before = (await d.readOwnedBodies(tenantId, [url])).get(key);
    if (before?.version === "current" && before.completeness === "complete" && before.contentHash
      && isCurrent("owned_page", before.fetchedAt, d.now(), options.bustedAt)) continue;
    // Bulk recovery must also honor current robots; exact debt already performed this permitted raw read.
    let rawSnapshot = options.rawSnapshot;
    if (!rawSnapshot) {
      const raw = await d.fetchPage(url, new Map(), { timeoutMs: Math.max(1, Math.min(10_000, (deadline - d.now()) / 2)) })
        .catch(() => null);
      if (!raw) { await hold(url); continue; }
      if (!raw.ok || (raw.finalUrl && canonicalUrlKey(raw.finalUrl) !== key)) { await hold(url); continue; }
      rawSnapshot = extractPageSnapshot(raw.html, url, pageIdFor(key), tenantId, raw.status, profile ?? undefined, raw.finalUrl);
    }
    if (deadline - d.now() < 50_000) break;
    const revision = sha16(JSON.stringify([options.bustedAt ?? null, rawSnapshot.content_hash, rawSnapshot.title, rawSnapshot.meta_description, rawSnapshot.h1, rawSnapshot.content_capture?.mainHtml, rawSnapshot.content_capture?.jsonLd]));
    const raw = await d.callProvider("onpage_rendered_html", { url, revision }, { tenantId, unitKey: `rendered:${key}` }), r = interp(raw);
    options.onRead?.(r, raw);
    if (r.kind !== "evidence") { await hold(url); break; }
    const got = d.parse("onpage_rendered_html", r.payload as never);
    if (!got || canonicalUrlKey(got.url) !== key || got.httpStatus !== 200 || !isCurrent("owned_page", got.capturedAt, d.now(), options.bustedAt)) { await hold(url); break; }
    const snap = extractPageSnapshot(got.html, url, pageIdFor(key), tenantId, got.httpStatus, profile ?? undefined, got.url);
    snap.id = `snap-${pageIdFor(key)}-rendered-${Date.parse(got.capturedAt)}`;
    snap.fetched_at = got.capturedAt;
    const priorWords = before?.vocabulary.trim().split(/\s+/).filter(Boolean).length ?? 0;
    const collapsed = priorWords >= 100 && snap.word_count * 5 < priorWords * 3;
    const latest = before?.captureStates?.find((row) => row.id === before.latestCaptureId);
    const unresolvedHash = typeof latest?.content_hash === "string" ? latest.content_hash : before?.version === "current" && before.completeness === "partial" ? before.contentHash : null;
    const unchangedPartial = (before?.version === "stale_known_good" || before?.completeness === "partial") && snap.content_hash === unresolvedHash;
    if ((collapsed || unchangedPartial) && snap.content_capture) { snap.content_capture.complete = false; snap.extraction_certainty = "uncertain"; }
    snap.structural_warnings = [...(snap.structural_warnings ?? []), `rendered_read: post-JavaScript DOM captured; retry after ${new Date(Date.parse(got.capturedAt) + freshnessMsFor("owned_page")).toISOString()}`];
    try { await d.writeOwnedPage(snap, tenantId); } catch (e) { await hold(url); throw e; }
    const after = (await d.readOwnedBodies(tenantId, [url])).get(key);
    if (after?.version === "current" && after.completeness === "complete" && after.contentHash === snap.content_hash) landed += 1;
    else { await hold(url); break; }
    log.info("[rendered-read] requested page capture qualified", { tenantId, url });
  }
  return landed;
}
