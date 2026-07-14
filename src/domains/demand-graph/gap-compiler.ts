/**
 * gap-compiler (2026-06-24, Step 4) — the I/O loader that turns the demand graph
 * Moves into inspectable EvidencePackets: fuse each Move with its top competitor's
 * Step-3 teardown + the tenant's own page snapshot, then run the pure
 * `buildEvidencePacket`. Deterministic; no LLM, no paid SERP.
 */

import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";

import { loadDemandGraphForTenantCached } from "./load-graph";
import { getCompetitorAuditsForTenant } from "./competitor-page-audit";
import {
  buildEvidencePacket,
  type DemandQuerySignal,
  type EvidencePacket,
  type PageStructureFacts,
} from "./evidence-packet";
import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

function stripWww(h: string): string {
  return h.replace(/^www\./i, "").toLowerCase();
}

function pathKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return url.toLowerCase();
  }
}

function brandFromDomain(domain: string): string {
  const base = stripWww(domain).split(".")[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function snapshotToFacts(s: PageSnapshot): PageStructureFacts {
  const schemaTypes = s.schema_types ?? [];
  return {
    title: s.title ?? null,
    metaDescription: s.meta_description ?? null,
    h1: s.h1 ?? null,
    h2Count: s.h2_list?.length ?? 0,
    outline: s.h2_list ?? [],
    schemaTypes,
    hasFaq: (s.faqs?.length ?? 0) > 0 || schemaTypes.includes("FAQPage"),
    // Owned snapshots carry no explicit answer-block flag — left false; the
    // answer_block gap is driven by the Move type, not this field.
    hasAnswerBlock: false,
    wordCount: s.word_count ?? 0,
  };
}

export type LoadChangePacksResult = {
  packets: EvidencePacket[];
  coverage: {
    moves: number;
    withCompetitorTeardown: number;
    withOwnedSnapshot: number;
    ownedSnapshots: number;
    competitorAudits: number;
  };
};

export async function loadChangePacksForTenant(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<LoadChangePacksResult> {
  const limit = opts.limit ?? 25;

  const [{ graph }, audits, snapshots, gscSignals] = await Promise.all([
    loadDemandGraphForTenantCached(tenantId),
    getCompetitorAuditsForTenant().catch(() => new Map()),
    getRepository()
      .forTenant(tenantId)
      .getPageSnapshots()
      .catch(() => [] as PageSnapshot[]),
    loadGscPageSignalsForTenant(tenantId, new Date()).catch((): Map<string, GscPageSignal> => new Map()),
  ]);

  // GSC per-page signal indexed for robust owned-URL matching (canonical + path).
  const gscByCanon = new Map<string, GscPageSignal>();
  const gscByPath = new Map<string, GscPageSignal>();
  for (const [u, sig] of gscSignals) {
    if (!u) continue;
    gscByCanon.set(canonicalizeCitationUrl(u) || u, sig);
    gscByPath.set(pathKey(u), sig);
  }

  // owned page facts indexed by canonical url + by pathname (robust matching)
  const ownedByCanon = new Map<string, PageSnapshot>();
  const ownedByPath = new Map<string, PageSnapshot>();
  for (const s of snapshots) {
    const u = s.url ?? "";
    if (!u) continue;
    ownedByCanon.set(canonicalizeCitationUrl(u) || u, s);
    ownedByPath.set(pathKey(u), s);
  }

  // owned domain (for brand) from the most common GSC/owned host
  const hostCount = new Map<string, number>();
  for (const m of graph.moves) {
    if (m.ownedUrl) {
      try {
        const h = stripWww(new URL(m.ownedUrl).hostname);
        hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
      } catch {
        /* skip */
      }
    }
  }
  const ownedDomain = [...hostCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const brand = ownedDomain ? brandFromDomain(ownedDomain) : "Your site";
  const graphQueriesByKey = new Map(
    graph.demandNodes.map((node) => [node.key, node.queries] as const),
  );

  const actionable = graph.moves.filter((m) => m.gap !== "low_demand" && m.gap !== "healthy");
  const top = actionable.slice(0, limit);

  let withTeardown = 0;
  let withSnapshot = 0;
  const packets: EvidencePacket[] = top.map((move) => {
    // top competitor audit
    const topCompUrl = move.competitorUrls[0] ?? null;
    const audit = topCompUrl ? audits.get(canonicalizeCitationUrl(topCompUrl) || topCompUrl) : undefined;
    const competitor = audit
      ? { url: audit.url, domain: audit.domain, fetchStatus: audit.fetchStatus, facts: audit.facts }
      : topCompUrl
        ? { url: topCompUrl, domain: stripWww((() => { try { return new URL(topCompUrl.startsWith("http") ? topCompUrl : `https://${topCompUrl}`).hostname; } catch { return topCompUrl; } })()), fetchStatus: "not_audited", facts: null }
        : null;
    if (audit?.facts) withTeardown += 1;

    // owned page facts
    let ownedSnap: PageSnapshot | undefined;
    if (move.ownedUrl) {
      ownedSnap =
        ownedByCanon.get(canonicalizeCitationUrl(move.ownedUrl) || move.ownedUrl) ??
        ownedByPath.get(pathKey(move.ownedUrl));
    }
    const ownedFacts = ownedSnap ? snapshotToFacts(ownedSnap) : null;
    if (ownedFacts) withSnapshot += 1;

    // Real GSC signal for the owned page → powers the CTR-gap upside + the
    // "ranks #N, under-clicked" gap detail (was always null before).
    let ownedGsc: EvidencePacket["yourPage"]["gsc"] = null;
    let demandQueries: DemandQuerySignal[] = (graphQueriesByKey.get(move.demandKey) ?? []).map((query) => ({
      query,
      impressions: 1,
      source: "graph",
    }));
    if (move.ownedUrl) {
      const sig =
        gscByCanon.get(canonicalizeCitationUrl(move.ownedUrl) || move.ownedUrl) ??
        gscByPath.get(pathKey(move.ownedUrl));
      if (sig) {
        ownedGsc = { clicks: sig.clicks90d, impressions: sig.impressions90d, ctr: sig.ctr90d, position: sig.position90d };
        demandQueries = sig.topQueries.map((query) => ({
          query: query.query,
          impressions: query.impressions,
          source: "gsc",
        }));
      }
    }

    return buildEvidencePacket({
      move,
      brand,
      ownedFacts,
      ownedGsc,
      competitor,
      fanoutSeeds: move.fanoutSeeds,
      demandQueries,
    });
  });

  return {
    packets,
    coverage: {
      moves: actionable.length,
      withCompetitorTeardown: withTeardown,
      withOwnedSnapshot: withSnapshot,
      ownedSnapshots: snapshots.length,
      competitorAudits: audits.size,
    },
  };
}
