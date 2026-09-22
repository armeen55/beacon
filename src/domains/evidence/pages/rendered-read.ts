import "server-only";
import { log } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { isCurrent, freshnessMsFor } from "@/domains/evidence/freshness";
import { interp, resolveDeps, sha16, type FunnelDeps, type Interp, type ResolvedDeps } from "@/domains/evidence/funnel/shared";
import type { BusinessProfile } from "@/domains/account";
import { extractPageSnapshot } from "./extractor";
import { selectPageVersion } from "./page-version";
import type { CachedCallResult } from "@/domains/evidence/dataforseo/funnel-boundary";
import type { PageSnapshot } from "./types";

/** Bulk crawl recovery and exact page-source debt share the same rendered acquisition and snapshot writer. */
const RENDERED_READS_PER_PASS = 60, SNAPSHOT_SCAN = 2000;
async function unreadOwnedPages(tenantId: string, d: ResolvedDeps, cap: number): Promise<string[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("page_snapshots")
    .select("url, word_count, http_status, content_hash, extraction_certainty, fetched_at, structural_warnings, capture_complete:content_capture->complete").eq("tenant_id", tenantId)
    .order("fetched_at", { ascending: false }).limit(SNAPSHOT_SCAN);
  if (error) throw error;
  type Row = { url: string; word_count: number; http_status: number; content_hash: string; extraction_certainty: string; fetched_at: string; structural_warnings: string[]; capture_complete: boolean | null };
  const grouped = new Map<string, Row[]>(), held = new Set<string>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const key = canonicalUrlKey(row.url);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
    if (Array.isArray(row.structural_warnings) && row.structural_warnings.some((w: string) => w.startsWith("rendered_read"))
      && isCurrent("owned_page", row.fetched_at, d.now())) held.add(key);
  }
  // Metadata only selects candidates; the canonical reader below makes the acquisition decision.
  const targets = [...grouped].flatMap(([key, rows]) => {
    const v = selectPageVersion(rows, (r) => ({ fetchedAt: r.fetched_at, words: r.word_count, bodyHeld: true, certainty: r.extraction_certainty, contentIdentity: r.content_hash })), row = rows[0]!;
    return held.has(key) || row.http_status !== 200 || (v.state === "current" && row.capture_complete === true && row.extraction_certainty === "confirmed" && isCurrent("owned_page", row.fetched_at, d.now())) ? [] : [row.url];
  });
  if (!targets.length) return [];
  const since = new Date(d.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data: demand } = await sb.from("gsc_daily_page_totals")
    .select("page, impressions").eq("tenant_id", tenantId).gte("date", since)
    .in("page", targets.flatMap((url) => [url, url.replace("://www.", "://"), url.replace("://", "://www.")]));
  const impressions = new Map<string, number>();
  for (const row of demand ?? []) {
    const key = canonicalUrlKey(row.page);
    impressions.set(key, (impressions.get(key) ?? 0) + (row.impressions ?? 0));
  }
  const candidates = targets.sort((a, b) => (impressions.get(canonicalUrlKey(b)) ?? 0) - (impressions.get(canonicalUrlKey(a)) ?? 0)).slice(0, cap);
  const bodies = await d.readOwnedBodies(tenantId, candidates);
  return candidates.filter((url) => { const body = bodies.get(canonicalUrlKey(url)); return !(body?.version === "current" && body.completeness === "complete" && body.contentHash && isCurrent("owned_page", body.fetchedAt, d.now())); });
}

/** A provider DOM is evidence only after canonical extraction and durable readback. No text-to-HTML fabrication. */
export async function renderUnreadOwnedPages(tenantId: string, cap = RENDERED_READS_PER_PASS, options: {
  url?: string; deps?: FunnelDeps; profile?: BusinessProfile | null; deadline?: number; bustedAt?: string | null;
  rawSnapshot?: PageSnapshot; onRead?: (result: Interp, raw: CachedCallResult) => void;
} = {}): Promise<number> {
  if (cap <= 0) return 0;
  const d = resolveDeps(options.deps ?? {}), deadline = options.deadline ?? d.now() + 90_000;
  const targets = (options.url ? [options.url] : await unreadOwnedPages(tenantId, d, cap)).slice(0, cap);
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
      const raw = await d.fetchPage(url, new Map(), { timeoutMs: Math.max(1, Math.min(10_000, (deadline - d.now()) / 2)) });
      if (!raw.ok || (raw.finalUrl && canonicalUrlKey(raw.finalUrl) !== key)) continue;
      rawSnapshot = extractPageSnapshot(raw.html, url, pageIdFor(key), tenantId, raw.status, profile ?? undefined, raw.finalUrl);
    }
    if (deadline - d.now() < 50_000) break;
    const revision = sha16(JSON.stringify([options.bustedAt ?? null, rawSnapshot.content_hash, rawSnapshot.title, rawSnapshot.meta_description, rawSnapshot.h1, rawSnapshot.content_capture?.mainHtml, rawSnapshot.content_capture?.jsonLd]));
    const raw = await d.callProvider("onpage_rendered_html", { url, revision }, { tenantId, unitKey: `rendered:${key}` }), r = interp(raw);
    options.onRead?.(r, raw);
    if (r.kind !== "evidence") break;
    const got = d.parse("onpage_rendered_html", r.payload as never);
    if (!got || canonicalUrlKey(got.url) !== key || got.httpStatus !== 200 || !isCurrent("owned_page", got.capturedAt, d.now(), options.bustedAt)) break;
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
    await d.writeOwnedPage(snap, tenantId);
    const after = (await d.readOwnedBodies(tenantId, [url])).get(key);
    if (after?.version === "current" && after.completeness === "complete" && after.contentHash === snap.content_hash) landed += 1;
    else break;
    log.info("[rendered-read] requested page capture qualified", { tenantId, url });
  }
  return landed;
}
