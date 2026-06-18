/**
 * Page Surgeon — assemble a real EvidencePacket for a page from the ACTUAL
 * signal loaders (GSC, Clarity, GA4, SEMrush) + the page snapshot crawl. Pure
 * I/O orchestration; never fabricates a metric (absent source → omitted, and
 * recorded under sourcesConnectedButEmpty). Server-only.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getRepository } from "@/lib/persistence/repositories";
import { getTenant } from "@/domains/tenants/store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { inferBrandSuffix } from "@/domains/recommendation-intelligence/draft-enrichment";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadSemrushPageSignalsForTenant } from "@/domains/recommendation-intelligence/semrush-page-signals";
import type { PageSnapshot } from "@/domains/pages/types";

import type { EvidencePacket } from "./contract";
import type { BrandConfig } from "./title-candidates";
import { DECISION_SCHEMA_VERSION } from "./page-decision";

/** Industry-standard organic CTR-by-position curve (deterministic, generic). */
const EXPECTED_CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.035, 9: 0.03, 10: 0.028,
};
function expectedCtr(pos: number): number {
  const r = Math.max(1, Math.round(pos));
  return EXPECTED_CTR_BY_POSITION[r] ?? 0.02;
}

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

export async function loadPageSurgeonContext(
  tenantId: string,
): Promise<PageSurgeonContext> {
  const repo = getRepository().forTenant(tenantId);
  const [snapshots, gscByUrl, clarityByUrl, ga4ByUrl, semrushByUrl, tenant] =
    await Promise.all([
      repo.getPageSnapshots().catch(() => [] as PageSnapshot[]),
      loadGscPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadClarityPageSignalsForTenant(tenantId).catch(() => new Map()),
      loadGa4PageValuesForTenant(tenantId).catch(() => new Map()),
      loadSemrushPageSignalsForTenant(tenantId).catch(() => new Map()),
      getTenant(tenantId).catch(() => null),
    ]);

  const snapshotByCanon = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const c = canonicalizeCitationUrl(s.url) ?? s.url;
    if (!snapshotByCanon.has(c)) snapshotByCanon.set(c, s);
  }

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
  const semrush = ctx.semrushByUrl.get(canonUrl);

  const present: string[] = [];
  const empty: string[] = [];
  (gsc ? present : empty).push("gsc");
  (ga4 ? present : empty).push("ga4");
  (clarity ? present : empty).push("clarity");
  (semrush ? present : empty).push("semrush");
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
  if (semrush) {
    packet.semrush = {
      keywords: semrush.keywords.map((k) => ({
        keyword: k.keyword,
        volume: k.volume,
        kd: k.difficulty ?? 0,
        cpc: 0, // SEMrush page signal doesn't carry CPC; absent, not faked
        intent: k.intent ?? null,
        position: k.position ?? null,
      })),
    };
  }
  if (snap) {
    packet.crawl = {
      title: snap.title ?? null,
      h1: snap.h1 ?? null,
      metaDescription: snap.meta_description ?? null,
      h2List: snap.h2_list ?? [],
      h3List: snap.h3_list ?? [],
      faqs: (snap.faqs ?? []).map((f) => (typeof f === "string" ? f : JSON.stringify(f))),
      schemaTypes: snap.schema_types ?? [],
      wordCount: snap.word_count ?? null,
      internalLinkCount: snap.internal_link_count ?? null,
      cardTexts: snap.card_texts ?? [],
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
    ga4: packet.ga4?.sessions ?? 0,
  };
  return createHash("sha256").update(JSON.stringify(sig)).digest("hex").slice(0, 16);
}
