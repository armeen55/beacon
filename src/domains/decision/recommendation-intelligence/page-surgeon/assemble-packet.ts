/**
 * Page Surgeon — assemble a real EvidencePacket for a page from the ACTUAL
 * signal loaders (GSC, Clarity, GA4) + the page snapshot crawl. Pure I/O
 * orchestration; never fabricates a metric (absent source → omitted, and
 * recorded under sourcesConnectedButEmpty). Server-only.
 */

import "server-only";

import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { getTenant } from "@/domains/account/tenants/store";
import { canonicalizeCitationUrl } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { inferBrandSuffix } from "./brand-heuristics";
import { loadGscPageSignalsForTenant } from "@/domains/evidence/readers/gsc-page-signals";
import { loadClarityPageSignalsForTenant } from "@/domains/evidence/readers/clarity-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/evidence/readers/ga4-page-values";
import type { PageSnapshot } from "@/domains/evidence/pages/types";

import type { EvidencePacket } from "./contract";
import { expectedCtrForPosition as expectedCtr } from "./expected-ctr";

export type PageSurgeonContext = {
  tenantId: string;
  brand: { separator: string; suffix: string } | null;
  boilerplateTerms: string[];
  publishChannel: "wix_cms" | "git_pr" | "dev_note" | "none";
  /** canonical url → … */
  snapshotByCanon: Map<string, PageSnapshot>;
  gscByUrl: Awaited<ReturnType<typeof loadGscPageSignalsForTenant>>;
  clarityByUrl: Awaited<ReturnType<typeof loadClarityPageSignalsForTenant>>;
  ga4ByUrl: Awaited<ReturnType<typeof loadGa4PageValuesForTenant>>;
  /** Organic competitor domains for the site (market rivals), best first. */
  competitorDomains: string[];
};

/** Boilerplate = title tokens repeated across ≥40% of the fleet's pages
 *  (chrome / collection tails), derived from the tenant's OWN titles. */
function deriveBoilerplate(snapshots: PageSnapshot[]): string[] {
  const df = new Map<string, number>();
  let n = 0;
  for (const s of snapshots) {
    const title = s.title?.trim();
    if (!title) continue;
    n += 1;
    const seen = new Set<string>();
    for (const raw of title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
      if (raw.length <= 2 || seen.has(raw)) continue;
      seen.add(raw);
      df.set(raw, (df.get(raw) ?? 0) + 1);
    }
  }
  if (n < 5) return []; // too few pages to judge boilerplate reliably
  const out: string[] = [];
  for (const [tok, c] of df) if (c / n >= 0.4) out.push(tok);
  return out;
}

// The full context (every snapshot + every per-tenant signal map) is the heavy
// read in the surgeon path — re-pulling it on each review interaction is the
// egress class the /today timeout taught us to respect. With crons off the data
// only moves on an explicit refresh, so a short in-process TTL is safe and large.
const CONTEXT_TTL_MS = 60_000;
const LARGE_SNAPSHOT_READ = 2000;
const contextCache = new Map<string, { ctx: PageSurgeonContext; expiresAt: number }>();

/** Cached loader. Pass { force: true } to bypass (e.g. an explicit refresh). */
export async function loadPageSurgeonContext(
  tenantId: string,
  opts: { force?: boolean } = {},
): Promise<PageSurgeonContext> {
  const now = Date.now();
  if (!opts.force) {
    const hit = contextCache.get(tenantId);
    if (hit && hit.expiresAt > now) return hit.ctx;
  }
  const ctx = await loadPageSurgeonContextUncached(tenantId);
  contextCache.set(tenantId, { ctx, expiresAt: now + CONTEXT_TTL_MS });
  return ctx;
}

async function loadPageSurgeonContextUncached(
  tenantId: string,
): Promise<PageSurgeonContext> {
  const repo = getRepository().forTenant(tenantId);
  const [snapshots, gscByUrl, clarityByUrl, ga4ByUrl, tenant] =
    await Promise.all([
      repo.getPageSnapshots().catch(() => [] as PageSnapshot[]),
      loadGscPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadClarityPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadGa4PageValuesForTenant(tenantId).catch(() => new Map()),
      getTenant(tenantId).catch(() => null),
    ]);

  const snapshotByCanon = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const c = canonicalizeCitationUrl(s.url) ?? s.url;
    if (!snapshotByCanon.has(c)) snapshotByCanon.set(c, s);
  }

  // Competitor domains (market rivals): DataForSEO SERP winners are the market
  // layer (wired separately). Empty here until that layer feeds this context.
  const competitorDomains: string[] = [];

  // Meter the read so a large egress pull is visible, not silent.
  const meter = {
    tenantId,
    snapshots: snapshots.length,
    gsc: gscByUrl.size,
    clarity: clarityByUrl.size,
    ga4: ga4ByUrl.size,
  };
  (snapshots.length >= LARGE_SNAPSHOT_READ ? log.warn : log.info)(
    "[page-surgeon] context loaded (uncached)",
    meter,
  );

  return {
    tenantId,
    brand: inferBrandSuffix(snapshots.values()),
    boilerplateTerms: deriveBoilerplate(snapshots),
    // Publishing is manual in the MVP (Product Truth: autonomy and approval).
    // The legacy per-tenant publish_target channel is retired; every pack is
    // prepared for manual implementation.
    publishChannel: "none",
    snapshotByCanon,
    gscByUrl,
    clarityByUrl,
    ga4ByUrl,
    competitorDomains,
  };
}

/** Pages ranked by real GSC demand (impressions) that also have a crawl. */
export function topPagesByDemand(ctx: PageSurgeonContext, limit: number): string[] {
  const rows: Array<{ url: string; impr: number }> = [];
  for (const [url, sig] of ctx.gscByUrl) {
    if (!ctx.snapshotByCanon.has(url)) continue;
    rows.push({ url, impr: sig.impressions90d });
  }
  rows.sort((a, b) => b.impr - a.impr);
  return rows.slice(0, limit).map((r) => r.url);
}

/** Assemble the EvidencePacket for one canonical page URL. */
export function assemblePacketForUrl(
  ctx: PageSurgeonContext,
  canonUrl: string,
): EvidencePacket {
  const snap = ctx.snapshotByCanon.get(canonUrl);
  const gsc = ctx.gscByUrl.get(canonUrl);
  const clarity = ctx.clarityByUrl.get(canonUrl);
  const ga4 = ctx.ga4ByUrl.get(canonUrl);

  // GA4 "present" must mean real traffic, not just a zero-metric row so a
  // 0-session page is honestly "connected but empty".
  const hasGa4 = !!ga4 && ga4.sessions28d > 0;

  const present: string[] = [];
  const empty: string[] = [];
  (gsc ? present : empty).push("gsc");
  (hasGa4 ? present : empty).push("ga4");
  (clarity ? present : empty).push("clarity");
  (snap ? present : empty).push("crawl");

  const packet: EvidencePacket = {
    current: {
      tenantId: ctx.tenantId,
      pageUrl: snap?.url ?? canonUrl,
      changeType: "title",
      elementKey: null,
      sectionLabel: null,
      currentText: snap?.title ?? null,
      cmsFieldMapped: ctx.publishChannel === "wix_cms",
      publishChannel: ctx.publishChannel,
    },
    sourcesPresent: present,
    sourcesConnectedButEmpty: empty,
    boilerplateTerms: ctx.boilerplateTerms,
  };

  if (gsc) {
    const exp = expectedCtr(gsc.position90d);
    packet.gsc = {
      windowStart: "",
      windowEnd: "",
      impressions: gsc.impressions90d,
      clicks: gsc.clicks90d,
      ctr: gsc.ctr90d,
      avgPosition: gsc.position90d,
      topQueries: gsc.topQueries.map((q) => ({
        query: q.query,
        impressions: q.impressions,
        clicks: q.clicks,
        ctr: q.ctr,
        position: q.position,
      })),
      expectedCtrForPosition: exp,
      ctrGap: Math.max(0, exp - gsc.ctr90d),
    };
  }
  if (hasGa4 && ga4) {
    packet.ga4 = {
      sessions: ga4.sessions28d,
      engagedSessions: ga4.engaged28d,
      engagementRate: ga4.sessions28d > 0 ? ga4.engaged28d / ga4.sessions28d : null,
      avgSessionDurationSec: null,
      keyEvents: ga4.conversions28d,
      sessionKeyEventRate: ga4.sessions28d > 0 ? ga4.conversions28d / ga4.sessions28d : null,
      revenue: null,
    };
  }
  if (clarity) {
    packet.clarity = {
      windowStart: "",
      windowEnd: "",
      scrollDepthMedian: null, // orphaned in the loader (Wave 0 follow-up)
      engagementTimeSec: null,
      deadClicks: clarity.deadClicks,
      rageClicks: clarity.rageClicks,
      quickbacks: clarity.quickbacks,
      scriptErrors: clarity.scriptErrors,
    };
  }
  if (snap) {
    packet.crawl = {
      title: snap.title ?? null,
      h1: snap.h1 ?? null,
      metaDescription: snap.meta_description ?? null,
      h2List: snap.h2_list ?? [],
      h3List: snap.h3_list ?? [],
      // Serialize crawl FAQs as readable "question: answer" text, not a raw JSON
      // blob (keys + source enum) — the judge reads this as its ground truth, so a
      // blob both wastes tokens and reads as noise instead of the actual Q&A.
      faqs: (snap.faqs ?? []).map((f) => {
        if (typeof f === "string") return f;
        const q = (f as { question?: string }).question ?? "";
        const a = (f as { answer?: string }).answer ?? "";
        return [q, a].filter(Boolean).join(": ").trim() || JSON.stringify(f);
      }),
      schemaTypes: snap.schema_types ?? [],
      wordCount: snap.word_count ?? null,
      internalLinkCount: snap.internal_link_count ?? null,
      cardTexts: snap.card_texts ?? [],
      fetchedAt: snap.fetched_at ?? null,
      extractionCertainty: snap.extraction_certainty ?? null,
    };
  }

  return packet;
}
