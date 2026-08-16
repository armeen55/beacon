import "server-only";

/** pages/rendered-read - THE SECOND READ FOR PAGES THE RAW FETCH CANNOT SEE. A CMS repeater renders its rows
 *  with javascript, so the polite crawl stores a 200 with zero words while Google renders the full page and
 *  ranks it (the 500-surname page held 194,554 lifetime impressions as a blank record). This module finds the
 *  account's own pages whose newest snapshot is a zero-word 200, orders them by the demand at stake, and buys
 *  a BOUNDED number of rendered reads through the one provider gateway (enable_javascript already on the
 *  capability, cached, budgeted). The rendered body lands as a NEW snapshot row on the same store every other
 *  reader consults, stamped `rendered_read` in its structural warnings, so thin-page, coverage, drafting and
 *  grounding all see the real page without learning a second path. Fail-soft per page: a read that does not
 *  land leaves the blank snapshot and the honest `uncertain` certainty standing. */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { syncPageSnapshots } from "@/lib/persistence/dual-write";
import { providerCall, parseCapability } from "@/domains/evidence/dataforseo/capabilities";
import { interp } from "@/domains/evidence/funnel/shared";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import type { PageSnapshot } from "./types";

/** Rendered reads one pass may buy: the biggest blind spots first, never the whole site. */
const RENDERED_READS_PER_PASS = 5;
/** How far back demand counts when ordering the blind spots. */
const DEMAND_DAYS = 90;
const SNAPSHOT_SCAN = 400; // newest snapshot rows scanned to find the latest-per-page zero-word reads

const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** The account's own pages whose NEWEST snapshot is a zero-word 200, with the demand riding on each. */
export async function unreadOwnedPages(tenantId: string): Promise<{ url: string; impressions: number }[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("page_snapshots")
    .select("url, word_count, http_status, fetched_at")
    .eq("tenant_id", tenantId).order("fetched_at", { ascending: false }).limit(SNAPSHOT_SCAN);
  if (error != null) return [];
  const newest = new Map<string, { url: string; word_count: number; http_status: number }>();
  for (const r of (data ?? []) as { url: string; word_count: number; http_status: number }[]) {
    const k = canonicalUrlKey(r.url);
    if (k && !newest.has(k)) newest.set(k, r);
  }
  const blank = [...newest.values()].filter((r) => r.word_count === 0 && r.http_status === 200);
  if (blank.length === 0) return [];
  const since = new Date(Date.now() - DEMAND_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: demand } = await sb.from("gsc_daily_page_totals")
    .select("page, impressions").eq("tenant_id", tenantId).gte("date", since)
    .in("page", blank.flatMap((b) => [b.url, b.url.replace("://www.", "://"), b.url.replace("://", "://www.")]));
  const per = new Map<string, number>();
  for (const d of (demand ?? []) as { page: string; impressions: number }[]) {
    const k = canonicalUrlKey(d.page);
    per.set(k, (per.get(k) ?? 0) + (d.impressions ?? 0));
  }
  return blank.map((b) => ({ url: b.url, impressions: per.get(canonicalUrlKey(b.url)) ?? 0 }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** Buy up to `cap` rendered reads for the biggest unread pages and store each as a real snapshot row.
 *  Returns how many landed. Every read is a provider call through the one cached, budgeted gateway. */
export async function renderUnreadOwnedPages(tenantId: string, cap = RENDERED_READS_PER_PASS): Promise<number> {
  const targets = (await unreadOwnedPages(tenantId)).slice(0, Math.max(0, cap));
  let landed = 0;
  for (const t of targets) {
    const r = interp(await providerCall("onpage_content_parsing", { url: t.url }, { tenantId, unitKey: `rendered:${canonicalUrlKey(t.url)}` }));
    if (r.kind !== "evidence") {
      log.info("[rendered-read] no rendered body this pass", { tenantId, url: t.url, kind: r.kind });
      continue;
    }
    const got = parseCapability("onpage_content_parsing", r.payload as never);
    const body = (got?.bodyText ?? "").trim();
    if (!got || body.split(/\s+/).filter(Boolean).length < 20) {
      // A rendered read that still shows almost nothing proves nothing; the blank record stays honest.
      log.info("[rendered-read] the rendered body is still empty", { tenantId, url: t.url });
      continue;
    }
    const nowIso = new Date().toISOString();
    const words = body.split(/\s+/).filter(Boolean).length;
    const snap: PageSnapshot = {
      id: `snap-${pageIdFor(canonicalUrlKey(t.url))}-rendered-${Date.now()}`,
      page_id: pageIdFor(canonicalUrlKey(t.url)),
      url: t.url, canonical_url: null, fetched_at: nowIso, http_status: 200,
      title: got.title ?? null, meta_description: got.metaDescription ?? null, h1: got.h1 ?? null,
      h2_list: (got.headings ?? []).slice(0, 30), h3_count: 0, faqs: [], schema_types: [],
      location_terms: [], service_terms: [], internal_link_count: got.internalLinkCount ?? 0,
      external_link_count: got.externalLinkCount ?? 0, word_count: words, robots_meta: null,
      has_canonical_mismatch: false, content_hash: hash(body), headings_hash: hash((got.headings ?? []).join("|")),
      faq_hash: hash(""), schema_hash: hash(""), extraction_certainty: "confirmed",
      structural_warnings: ["rendered_read: body captured with javascript enabled through the rendering provider"],
      body_text: body,
      tenant_id: tenantId,
    } as PageSnapshot;
    await syncPageSnapshots([snap], tenantId);
    landed += 1;
    log.info("[rendered-read] rendered body stored", { tenantId, url: t.url, words });
  }
  return landed;
}
