/**
 * Page Surgeon — assemble a real EvidencePacket for a page from the ACTUAL
 * signal loaders (GSC, Clarity, GA4, SEMrush) + the page snapshot crawl. Pure
 * I/O orchestration; never fabricates a metric (absent source → omitted, and
 * recorded under sourcesConnectedButEmpty). Server-only.
 */

import "server-only";

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { getTenant } from "@/domains/tenants/store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { inferBrandSuffix } from "@/domains/recommendation-intelligence/draft-enrichment";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import {
  loadSemrushKeywordExpansionsForTenant,
  loadSemrushPageSignalsForTenant,
} from "@/domains/recommendation-intelligence/semrush-page-signals";
import { getBusinessConfig } from "@/lib/business-config";
import { loadSemrushDomainMetrics } from "@/lib/connectors/semrush/persist-domain-metrics";
import type { PageSnapshot } from "@/domains/pages/types";

import type { EvidencePacket } from "./contract";
import type { BrandConfig } from "./title-candidates";
import { DECISION_SCHEMA_VERSION } from "./page-decision";
import { expectedCtrForPosition as expectedCtr } from "./expected-ctr";

export type PageSurgeonContext = {
  tenantId: string;
  brand: BrandConfig;
  boilerplateTerms: string[];
  publishChannel: "wix_cms" | "git_pr" | "dev_note" | "none";
  /** canonical url → … */
  snapshotByCanon: Map<string, PageSnapshot>;
  gscByUrl: Awaited<ReturnType<typeof loadGscPageSignalsForTenant>>;
  clarityByUrl: Awaited<ReturnType<typeof loadClarityPageSignalsForTenant>>;
  ga4ByUrl: Awaited<ReturnType<typeof loadGa4PageValuesForTenant>>;
  semrushByUrl: Awaited<ReturnType<typeof loadSemrushPageSignalsForTenant>>;
  semrushExpansionsByUrl: Awaited<ReturnType<typeof loadSemrushKeywordExpansionsForTenant>>;
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
  const [snapshots, gscByUrl, clarityByUrl, ga4ByUrl, semrushByUrl, semrushExpansionsByUrl, tenant] =
    await Promise.all([
      repo.getPageSnapshots().catch(() => [] as PageSnapshot[]),
      loadGscPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadClarityPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadGa4PageValuesForTenant(tenantId).catch(() => new Map()),
      loadSemrushPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadSemrushKeywordExpansionsForTenant(tenantId).catch(() => new Map()),
      getTenant(tenantId).catch(() => null),
    ]);

  const snapshotByCanon = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const c = canonicalizeCitationUrl(s.url) ?? s.url;
    if (!snapshotByCanon.has(c)) snapshotByCanon.set(c, s);
  }

  // Competitor domains (market rivals) from the cached domain-metrics snapshot.
  // Resolve the domain from business config, falling back to the snapshots'
  // own hostname so a Supabase-hydrated tenant without a sync config still maps.
  const domain =
    normalizeDomain(getBusinessConfig(tenantId).domain) ||
    deriveDomainFromSnapshots(snapshots);
  let competitorDomains: string[] = [];
  if (domain) {
    try {
      const metrics = await loadSemrushDomainMetrics(tenantId, domain);
      competitorDomains = (metrics?.organic_competitors ?? [])
        .map((c) => (c?.domain ?? "").trim())
        .filter((d) => d.length > 0)
        .slice(0, 8);
    } catch {
      competitorDomains = [];
    }
  }

  // Meter the read so a large egress pull is visible, not silent.
  const meter = {
    tenantId,
    snapshots: snapshots.length,
    gsc: gscByUrl.size,
    clarity: clarityByUrl.size,
    ga4: ga4ByUrl.size,
    semrush: semrushByUrl.size,
  };
  (snapshots.length >= LARGE_SNAPSHOT_READ ? log.warn : log.info)(
    "[page-surgeon] context loaded (uncached)",
    meter,
  );

  return {
    tenantId,
    brand: inferBrandSuffix(snapshots.values()),
    boilerplateTerms: deriveBoilerplate(snapshots),
    publishChannel:
      (tenant?.publish_target as PageSurgeonContext["publishChannel"]) ?? "none",
    snapshotByCanon,
    gscByUrl,
    clarityByUrl,
    ga4ByUrl,
    semrushByUrl,
    semrushExpansionsByUrl,
    competitorDomains,
  };
}

function normalizeDomain(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/** Most common hostname across the tenant's snapshots (fallback domain). */
function deriveDomainFromSnapshots(snapshots: PageSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    try {
      const host = new URL(s.url).hostname.replace(/^www\./, "");
      if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
    } catch {
      /* skip unparseable urls */
    }
  }
  let best = "";
  let bestN = 0;
  for (const [host, n] of counts) if (n > bestN) ((best = host), (bestN = n));
  return best;
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
  const semrush = ctx.semrushByUrl.get(canonUrl);
  const expansions = ctx.semrushExpansionsByUrl.get(canonUrl);
  // SEMrush counts as "used" for THIS page when it has page-level keyword data
  // (organic portfolio) or query expansions for it — not merely domain-level
  // competitors, which would be misleading per-page.
  const hasSemrush =
    Boolean(semrush) ||
    Boolean(
      expansions &&
        (expansions.relatedKeywords.length > 0 || expansions.questionKeywords.length > 0),
    );

  const present: string[] = [];
  const empty: string[] = [];
  (gsc ? present : empty).push("gsc");
  (ga4 ? present : empty).push("ga4");
  (clarity ? present : empty).push("clarity");
  (hasSemrush ? present : empty).push("semrush");
  (snap ? present : empty).push("crawl");
  empty.push("profound"); // not connected yet

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
  if (ga4) {
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
  if (hasSemrush) {
    packet.semrush = {
      // cap the per-page keyword portfolio so the packet stays bounded
      keywords: (semrush?.keywords ?? []).slice(0, 30).map((k) => ({
        keyword: k.keyword,
        volume: k.volume,
        // null (not 0) when not pulled — a 0 reads as "trivially easy / no
        // commercial value" and would fabricate a signal the data never gave.
        kd: k.difficulty ?? null,
        cpc: k.cpc ?? null,
        intent: k.intent ?? null,
        position: k.position ?? null,
      })),
    };
    if (expansions && expansions.relatedKeywords.length > 0) {
      packet.semrush.relatedKeywords = expansions.relatedKeywords
        .slice(0, 12)
        .map((k) => ({ keyword: k.keyword, volume: k.volume, intent: k.intent }));
    }
    if (expansions && expansions.questionKeywords.length > 0) {
      packet.semrush.questionKeywords = expansions.questionKeywords
        .slice(0, 12)
        .map((k) => ({ keyword: k.keyword, volume: k.volume, intent: k.intent }));
    }
    if (ctx.competitorDomains.length > 0) {
      packet.semrush.competitorDomains = ctx.competitorDomains;
    }
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

/** Stable hash of the DECISION-AFFECTING evidence, so a cached brief is reused
 *  when the inputs are unchanged (no OpenAI re-spend) and flagged stale when
 *  they move. */
export function evidenceHash(packet: EvidencePacket): string {
  const sig = {
    v: DECISION_SCHEMA_VERSION,
    title: packet.current.currentText,
    q: packet.gsc?.topQueries.slice(0, 5).map((t) => [t.query, t.impressions, t.clicks, Math.round(t.position)]),
    impr: packet.gsc?.impressions,
    clicks: packet.gsc?.clicks,
    pos: packet.gsc ? Math.round(packet.gsc.avgPosition * 10) : null,
    h1: packet.crawl?.h1,
    meta: packet.crawl?.metaDescription,
    h2: packet.crawl?.h2List?.length,
    clarity: packet.clarity ? [packet.clarity.deadClicks, packet.clarity.rageClicks] : null,
    semrush: packet.semrush?.keywords?.length ?? 0,
    semrushRelated: packet.semrush?.relatedKeywords?.length ?? 0,
    semrushQuestions: packet.semrush?.questionKeywords?.length ?? 0,
    semrushCompetitors: packet.semrush?.competitorDomains?.length ?? 0,
    ga4: packet.ga4?.sessions ?? 0,
  };
  return createHash("sha256").update(JSON.stringify(sig)).digest("hex").slice(0, 16);
}
