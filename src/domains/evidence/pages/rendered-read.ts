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
const RENDERED_READS_PER_PASS = 60; // the meter is effectively gone (operator, 2026-08-30): the provider gateway prices every read; 60 is a runaway stop
/** How far back demand counts when ordering the blind spots. */
const DEMAND_DAYS = 90;
const SNAPSHOT_SCAN = 2000; // newest snapshot rows scanned to find the latest-per-page blind reads. 400 was a hidden meter: with 233 pages crawling nightly, a page last crawled weeks ago fell outside the window and its blind capture could never earn its render (live: the kabob stubs, 2026-08-30)

const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Under this many raw words, a capture is IMPLAUSIBLY thin: a CMS body the raw fetch half-missed reads the
 *  same as a genuine stub, and only a rendered look can tell them apart. One render settles it either way:
 *  much more content replaces the capture, about the same confirms the stub. The demand floor that used to
 *  gate this is DELETED (operator, 2026-08-30): a seven word nav-crumb capture is blind whatever its
 *  audience, and it left the kabob pages undescribable because nothing real was ever stored to ground on.
 *  Each page still gets exactly ONE rendered look ever, so the whole site settles once and stays settled. */
const IMPLAUSIBLY_THIN_WORDS = 50;

/** The account's own pages whose NEWEST snapshot the raw fetch cannot be trusted on: a zero-word 200 (a
 *  javascript body, always eligible), or an implausibly thin capture on a page with real demand that has
 *  never had its one rendered look. A page whose newest row already came from a rendered read is settled. */
async function unreadOwnedPages(tenantId: string): Promise<{ url: string; impressions: number }[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("page_snapshots")
    .select("url, word_count, http_status, fetched_at, structural_warnings")
    .eq("tenant_id", tenantId).order("fetched_at", { ascending: false }).limit(SNAPSHOT_SCAN);
  if (error != null) return [];
  type Row = { url: string; word_count: number; http_status: number; structural_warnings: string[] | null };
  const newest = new Map<string, Row>();
  const everRendered = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    const k = canonicalUrlKey(r.url);
    if (!k) continue;
    if (!newest.has(k)) newest.set(k, r);
    if ((r.structural_warnings ?? []).some((w) => w.startsWith("rendered_read"))) everRendered.add(k);
  }
  const blank = [...newest.values()].filter((r) => {
    const k = canonicalUrlKey(r.url);
    if (r.http_status !== 200 || everRendered.has(k)) return false;
    return r.word_count === 0 || r.word_count < IMPLAUSIBLY_THIN_WORDS;
  });
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
    // Every blind capture earns its one look; the audience only decides who goes first.
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
    const body = (got?.mainText ?? "").trim();
    const words0 = body.split(/\s+/).filter(Boolean).length;
    if (!got || words0 < 20) {
      // A rendered read that still shows almost nothing settles a THIN page (the stub is real: store the
      // rendered confirmation so it is never re-bought) and proves nothing about a BLANK one.
      log.info("[rendered-read] the rendered body is still nearly empty", { tenantId, url: t.url, words: words0 });
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
