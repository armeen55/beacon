import "server-only";

/**
 * Workbench data loader (operator-OS rebuild, Phase 2, v1).
 *
 * Composes EXISTING Page Surgeon / Opportunity / Change-Pack loaders into one
 * locked-page view. NO paid APIs, NO SERP API, NO LLM, NO publish. Cheap SERP
 * guard only ("SERP unknown" / "needs SERP check"). Fail-soft throughout: a
 * missing source degrades its section, never the page.
 *
 * One heavy read: loadPageSurgeonContext (60s in-process cache). loadPageSurgeonForUrl
 * reuses that same cache, so the pack lookup is a cache hit, not a second pull.
 */

import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
  type PageSurgeonContext,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import type { EvidencePacket } from "@/domains/recommendation-intelligence/page-surgeon/contract";
import {
  loadPageSurgeonForUrl,
  loadProofPlan,
} from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import type { AtomicChangePack } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ProofPlanRow } from "@/domains/recommendation-intelligence/page-surgeon/proof-plan";
import {
  buildOpportunity,
  type OpportunityKind,
} from "@/domains/insight/opportunity";
import {
  estClicksLabel,
  estimateConfidence,
} from "@/domains/insight/page-primary";
import { serpStatusChip, type SerpStatus } from "@/domains/insight/serp-guard";
import {
  buildDiagnosisMatrix,
  type DiagnosisRow,
} from "@/domains/insight/diagnosis-matrix";
import {
  loadGscCannibalizationForTenant,
  type GscCannibalizationCase,
} from "@/domains/recommendation-intelligence/gsc-cannibalization";
import {
  buildWorkbenchMatrix,
  type WorkbenchMatrix,
} from "@/domains/insight/workbench-matrix";
import {
  prioritizeWorkbench,
  type WorkbenchPicks,
} from "@/domains/insight/workbench-priority";
import {
  buildOptimizer,
  type OptimizerBuckets,
} from "@/domains/insight/workbench-optimizer";
import {
  loadShippedChanges,
  type ShippedChangeRecord,
} from "@/domains/proof-gsc/shipped-change-store";
import {
  loadTopQueriesForPages,
  isStrikingDistance,
} from "@/domains/recommendation-intelligence/gsc-page-queries";

/** Host-stripped path key — mirrors bridge.ts's private `toPath`. */
function toPath(u: string): string {
  return u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
}

/** The tenant's origin (scheme+host), read from any full-URL key in the Page
 *  Surgeon context. Lets us reconstruct a page URL from a bare path when the
 *  page itself isn't in the context (uncrawled but with raw GSC demand). */
function originFromContext(ctx: PageSurgeonContext): string | null {
  const maps = [ctx.snapshotByCanon, ctx.gscByUrl, ctx.semrushByUrl, ctx.clarityByUrl];
  for (const m of maps) {
    for (const k of m.keys()) {
      const match = /^https?:\/\/[^/]+/.exec(k);
      if (match) return match[0];
    }
  }
  return null;
}

/** Resolve a normalized page path → the context's canonical URL key. Mirrors
 *  bridge.ts's private `resolveCanon` path-match branch (we pass a bare path,
 *  so the canonicalize-first branch never applies). */
export function resolveCanonFromPath(ctx: PageSurgeonContext, path: string): string | null {
  for (const k of ctx.snapshotByCanon.keys()) if (toPath(k) === path) return k;
  for (const k of ctx.gscByUrl.keys()) if (toPath(k) === path) return k;
  for (const k of ctx.semrushByUrl.keys()) if (toPath(k) === path) return k;
  for (const k of ctx.clarityByUrl.keys()) if (toPath(k) === path) return k;
  return null;
}

// SEMrush striking-distance band (mirrors semrush-page-signals constants).
const STRIKING_MIN = 4;
const STRIKING_MAX = 20;
const STRIKING_MIN_VOLUME = 10;

export type WorkbenchTopQuery = {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
};

export type WorkbenchStrikingTerm = {
  keyword: string;
  volume: number;
  position: number;
};

export type WorkbenchCannibalCompetitor = {
  path: string;
  clicks: number;
  impressions: number;
  position: number;
  isThisPage: boolean;
  isLead: boolean;
};

export type WorkbenchCannibalization = {
  query: string;
  competitors: WorkbenchCannibalCompetitor[];
  totalClicks: number;
  totalImpressions: number;
  leadPath: string;
  thisPageIsLead: boolean;
};

export type WorkbenchOpportunity = {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number;
  estClicksAtStake: number;
  estWindow: "90d";
  estConfidence: "high" | "medium" | "low";
  serpStatus: SerpStatus;
  serpStatusChip: string;
  serpGuardLabel: string | null;
  estClicksLabel: string | null;
  kinds: OpportunityKind[];
};

export type WorkbenchData = {
  found: boolean;
  path: string;
  canonUrl: string | null;
  identity: {
    title: string | null;
    metaDescription: string | null;
    h1: string | null;
    crawlFetchedAt: string | null;
    crawlAgeDays: number | null;
    staleCrawl: boolean;
    extractionCertainty: "confirmed" | "uncertain" | null;
  };
  opportunity: WorkbenchOpportunity | null;
  topQueries: WorkbenchTopQuery[];
  strikingDistance: WorkbenchStrikingTerm[];
  /** Same-query competitions THIS page is part of (worst first). Empty if none. */
  cannibalization: WorkbenchCannibalization[];
  diagnosis: DiagnosisRow[];
  /** Deep Workbench Optimizer: per-lever SEO action matrix + ranked "do this
   *  first" picks. Pure projection over the packet/pack already loaded. */
  matrix: WorkbenchMatrix;
  picks: WorkbenchPicks;
  /** TASK 3: the six operator moves (best/safest/highest-upside/fastest/hold/
   *  bigger-later) scored over the matrix + proof ledger + SERP. Pure. */
  optimizer: OptimizerBuckets;
  packStatus: "pack" | "evidence_only" | "no_page";
  pack: AtomicChangePack | null;
  proof: ProofPlanRow | null;
  primaryCta: { label: string; kind: "review_pack" | "draft_pack" };
  sourcesPresent: string[];
  sourcesConnectedButEmpty: string[];
};

const STALE_CRAWL_DAYS = 30;

function crawlAgeDays(fetchedAt: string | null | undefined, now: Date): number | null {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

function buildOpportunitySummary(
  packet: EvidencePacket,
  canonUrl: string,
  path: string,
  hasPack: boolean,
): WorkbenchOpportunity | null {
  const gsc = packet.gsc;
  if (!gsc) return null;

  // Reuse the SAME pure classifier the Opportunity Map uses (GSC-only here; the
  // striking-distance terms get their own section) so the estimate + SERP guard
  // match the row the operator clicked. serpStatus "unknown" = broad-scan reality.
  const opp = buildOpportunity({
    canonUrl,
    path,
    gsc: {
      clicks90d: gsc.clicks,
      impressions90d: gsc.impressions,
      ctr90d: gsc.ctr,
      position90d: gsc.avgPosition,
      topQuery: gsc.topQueries[0]?.query,
    },
    hasChangePack: hasPack,
    serpStatus: "unknown",
  });

  const estClicksAtStake = opp?.estClicksAtStake ?? 0;
  const estConfidence = opp?.estConfidence ?? estimateConfidence(gsc.impressions);
  const serpStatus: SerpStatus = "unknown";
  const chip = serpStatusChip(serpStatus);

  return {
    impressions: gsc.impressions,
    clicks: gsc.clicks,
    ctr: gsc.ctr,
    avgPosition: gsc.avgPosition,
    estClicksAtStake,
    estWindow: "90d",
    estConfidence,
    serpStatus,
    serpStatusChip: chip,
    serpGuardLabel: opp?.serpGuardLabel ?? null,
    estClicksLabel: estClicksLabel({
      estClicksAtStake,
      window: "90d",
      confidence: estConfidence,
      serpStatusChip: chip,
    }),
    kinds: opp?.kinds ?? [],
  };
}

function emptyWorkbench(path: string, overrides: Partial<WorkbenchData> = {}): WorkbenchData {
  return {
    found: false,
    path,
    canonUrl: null,
    identity: {
      title: null,
      metaDescription: null,
      h1: null,
      crawlFetchedAt: null,
      crawlAgeDays: null,
      staleCrawl: false,
      extractionCertainty: null,
    },
    opportunity: null,
    topQueries: [],
    strikingDistance: [],
    cannibalization: [],
    diagnosis: [],
    matrix: { rows: [] },
    picks: {
      bestSingle: null,
      bestBigger: null,
      safest: null,
      fastestMeasurable: null,
      highestUpside: null,
    },
    optimizer: {
      bestNextMove: null,
      safestChange: null,
      highestUpside: null,
      fastestMeasurable: null,
      holdDoNotTouch: [],
      biggerSwingLater: null,
    },
    packStatus: "no_page",
    pack: null,
    proof: null,
    primaryCta: { label: "Run a website scan to add this page", kind: "draft_pack" },
    sourcesPresent: [],
    sourcesConnectedButEmpty: [],
    ...overrides,
  };
}

/**
 * Load the full Workbench view for one normalized page path. Fail-soft: any
 * loader error degrades to an empty/partial view rather than throwing.
 */
export async function loadWorkbench(
  tenantId: string,
  path: string,
  now: Date = new Date(),
): Promise<WorkbenchData> {
  let ctx: PageSurgeonContext;
  try {
    ctx = await loadPageSurgeonContext(tenantId);
  } catch {
    return emptyWorkbench(path);
  }

  const canon = resolveCanonFromPath(ctx, path);
  if (!canon) {
    // The page isn't in the Page Surgeon context (uncrawled), but the cockpit's
    // site-wide scans read `gsc_daily_rows` — a superset — so it may still have
    // real Google demand. Reconstruct the URL from the tenant origin + path and
    // hydrate a GSC-only Workbench (queries + striking) so a high-value "Act →"
    // lands populated, not on a dead "we haven't looked at this page" panel.
    const origin = originFromContext(ctx);
    if (origin) {
      // gsc_daily_rows stores raw page URLs with no canonicalization, so match on
      // several plausible forms (www on/off, trailing slash) rather than one.
      const bare = origin.replace(/^https?:\/\/(www\.)?/, "");
      const scheme = origin.startsWith("http://") ? "http://" : "https://";
      const hosts = [`${scheme}${bare}`, `${scheme}www.${bare}`];
      const candidates = hosts.flatMap((h) => [`${h}${path}`, `${h}${path}/`]);
      const fb = await loadTopQueriesForPages(tenantId, candidates).catch(
        () => new Map<string, Array<{ query: string; clicks: number; impressions: number; position: number }>>(),
      );
      // A page can be tracked under multiple host forms (www / non-www), splitting
      // its GSC rows. Merge per-query across every matched form so impressions sum
      // correctly (otherwise the split undercounts striking distance).
      const merged = new Map<string, { query: string; clicks: number; impressions: number; posWeighted: number }>();
      for (const v of fb.values()) {
        for (const q of v) {
          const a = merged.get(q.query) ?? { query: q.query, clicks: 0, impressions: 0, posWeighted: 0 };
          a.clicks += q.clicks;
          a.impressions += q.impressions;
          a.posWeighted += q.position * q.impressions;
          merged.set(q.query, a);
        }
      }
      const qs = [...merged.values()]
        .map((a) => ({
          query: a.query,
          clicks: a.clicks,
          impressions: a.impressions,
          position: a.impressions > 0 ? a.posWeighted / a.impressions : 0,
        }))
        .filter((q) => q.impressions > 0)
        .sort((x, y) => y.impressions - x.impressions)
        .slice(0, 12);
      // Prefer the www form for the "view page" link if it matched, else any.
      const matchedUrl =
        [...fb.keys()].find((k) => /:\/\/www\./.test(k)) ?? [...fb.keys()][0] ?? "";
      if (qs.length > 0) {
        const topQueries: WorkbenchTopQuery[] = qs.map((q) => ({
          query: q.query,
          impressions: q.impressions,
          clicks: q.clicks,
          ctr: q.impressions > 0 ? q.clicks / q.impressions : 0,
          position: q.position,
        }));
        const strikingDistance: WorkbenchStrikingTerm[] = qs
          .filter((q) => isStrikingDistance(q.position, q.impressions))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 8)
          .map((q) => ({ keyword: q.query, volume: q.impressions, position: q.position }));
        return emptyWorkbench(path, {
          found: true,
          canonUrl: matchedUrl,
          topQueries,
          strikingDistance,
          primaryCta: { label: "Draft Change Pack", kind: "draft_pack" },
        });
      }
    }
    return emptyWorkbench(path);
  }

  const packet = assemblePacketForUrl(ctx, canon);

  // Pack + proof + cannibalization + GSC proof ledger in parallel
  // (loadPageSurgeonForUrl reuses cache).
  const [psResult, proofRows, cannibalCases, shippedChanges] = await Promise.all([
    loadPageSurgeonForUrl(tenantId, canon, { history: true }).catch(
      () => ({ status: "no_page" as const }),
    ),
    loadProofPlan(tenantId).catch(() => [] as ProofPlanRow[]),
    loadGscCannibalizationForTenant(tenantId, now).catch(
      () => [] as GscCannibalizationCase[],
    ),
    loadShippedChanges().catch(() => [] as ShippedChangeRecord[]),
  ]);

  // Actions UNDER MEASUREMENT on this page (GSC proof ledger, verdict
  // "measuring") — the authoritative overlap guard so the optimizer never
  // recommends touching a lever whose proof window is still open.
  const measuringActions = shippedChanges
    .filter((s) => toPath(s.path) === path && s.verdict === "measuring")
    .map((s) => s.actionType);

  // Cannibalizations THIS page is part of (as lead OR as a competing duplicate).
  const cannibalization: WorkbenchCannibalization[] = cannibalCases
    .filter((c) => c.competingUrls.some((u) => u.url === canon))
    .map((c) => ({
      query: c.query,
      competitors: c.competingUrls.map((u) => ({
        path: toPath(u.url),
        clicks: u.clicks,
        impressions: u.impressions,
        position: u.position,
        isThisPage: u.url === canon,
        isLead: u.url === c.leadUrl,
      })),
      totalClicks: c.totalClicks,
      totalImpressions: c.totalImpressions,
      leadPath: toPath(c.leadUrl),
      thisPageIsLead: c.leadUrl === canon,
    }))
    .sort((a, b) => b.totalImpressions - a.totalImpressions);
  const worstCannibal = cannibalization[0]
    ? {
        query: cannibalization[0].query,
        urlCount: cannibalization[0].competitors.length,
        combinedImpressions: cannibalization[0].totalImpressions,
        combinedClicks: cannibalization[0].totalClicks,
        bestPosition: Math.min(
          ...cannibalization[0].competitors.map((u) => u.position),
        ),
      }
    : null;

  const packStatus = psResult.status;
  const pack = psResult.status === "pack" ? psResult.pack : null;
  const proof = proofRows.find((r) => toPath(r.pageUrl) === path) ?? null;

  const crawl = packet.crawl;
  const ageDays = crawlAgeDays(crawl?.fetchedAt ?? null, now);

  let strikingDistance: WorkbenchStrikingTerm[] = (packet.semrush?.keywords ?? [])
    .filter(
      (k) =>
        k.position != null &&
        k.position >= STRIKING_MIN &&
        k.position <= STRIKING_MAX &&
        k.volume >= STRIKING_MIN_VOLUME,
    )
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8)
    .map((k) => ({ keyword: k.keyword, volume: k.volume, position: k.position as number }));

  // Packet GSC topQueries (the Page Surgeon context's per-page GSC).
  let topQueries: WorkbenchTopQuery[] = (packet.gsc?.topQueries ?? []).map((q) => ({
    query: q.query,
    impressions: q.impressions,
    clicks: q.clicks,
    ctr: q.ctr,
    position: q.position,
  }));

  // RESILIENCE (2026-06-25): the cockpit's site-wide scans surface opportunities
  // from `gsc_daily_rows` for pages the Page Surgeon context's GSC set doesn't
  // cover (e.g. a crawled page with no per-query packet rows). Without this, a
  // high-value "Act →" lands on an EMPTY Workbench. When the packet yields no
  // queries, hydrate directly from the same bounded per-page GSC read the cockpit
  // uses — so every routed page shows its real queries + striking terms.
  if (topQueries.length === 0 && canon) {
    const fb = await loadTopQueriesForPages(tenantId, [canon]).catch(
      () => new Map<string, Array<{ query: string; clicks: number; impressions: number; position: number }>>(),
    );
    const qs = fb.get(canon) ?? [...fb.values()][0] ?? [];
    if (qs.length > 0) {
      topQueries = qs.map((q) => ({
        query: q.query,
        impressions: q.impressions,
        clicks: q.clicks,
        ctr: q.impressions > 0 ? q.clicks / q.impressions : 0,
        position: q.position,
      }));
      if (strikingDistance.length === 0) {
        strikingDistance = qs
          .filter((q) => isStrikingDistance(q.position, q.impressions))
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 8)
          .map((q) => ({ keyword: q.query, volume: q.impressions, position: q.position }));
      }
    }
  }

  // Deep Workbench Optimizer: project the packet + pack + worst cannibalization
  // into the per-lever action matrix + ranked picks. Pure, no new I/O.
  const matrix = buildWorkbenchMatrix(packet, pack, worstCannibal);
  const picks = prioritizeWorkbench(matrix.rows);
  // The optimizer folds the proof ledger (already-measuring) and SERP guard into
  // the matrix to produce the six operator moves. serp stays null here (the
  // page-level guard already rides on the matrix rows); the operator-resolved
  // SERP hypothesis upgrades it via resolve-serp.tsx, not on first render.
  const optimizer = buildOptimizer({ matrix, proof, measuringActions, serp: null });

  return {
    found: true,
    path,
    canonUrl: canon,
    identity: {
      title: crawl?.title ?? null,
      metaDescription: crawl?.metaDescription ?? null,
      h1: crawl?.h1 ?? null,
      crawlFetchedAt: crawl?.fetchedAt ?? null,
      crawlAgeDays: ageDays,
      staleCrawl: ageDays != null && ageDays > STALE_CRAWL_DAYS,
      extractionCertainty: crawl?.extractionCertainty ?? null,
    },
    opportunity: buildOpportunitySummary(packet, canon, path, packStatus === "pack"),
    topQueries,
    strikingDistance,
    cannibalization,
    diagnosis: buildDiagnosisMatrix(packet, worstCannibal),
    matrix,
    picks,
    optimizer,
    packStatus,
    pack,
    proof,
    primaryCta:
      packStatus === "pack"
        ? { label: "Review Change Pack", kind: "review_pack" }
        : { label: "Draft Change Pack", kind: "draft_pack" },
    sourcesPresent: packet.sourcesPresent ?? [],
    sourcesConnectedButEmpty: packet.sourcesConnectedButEmpty ?? [],
  };
}
