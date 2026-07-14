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
import { buildResearchDossier } from "@/domains/research/research-dossier";
import { loadResearchCorpusForTenant } from "@/domains/research/research-dossier-loader";
import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import type { MoveCandidate } from "./build-graph";

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
  opts: { limit?: number; rankedEntries?: readonly RankedUnifiedEntry[] } = {},
): Promise<LoadChangePacksResult> {
  const limit = opts.limit ?? 25;

  const now = new Date();
  const [{ graph }, audits, snapshots, gscSignals, researchCorpus] = await Promise.all([
    loadDemandGraphForTenantCached(tenantId),
    getCompetitorAuditsForTenant().catch(() => new Map()),
    getRepository()
      .forTenant(tenantId)
      .getPageSnapshots()
      .catch(() => [] as PageSnapshot[]),
    loadGscPageSignalsForTenant(tenantId, now).catch((): Map<string, GscPageSignal> => new Map()),
    loadResearchCorpusForTenant(tenantId, now).catch(() => ({
      keywordLibrary: { rows: [], volumeCoverage: 0, total: 0, bySource: {} as never },
      serpPatterns: new Map(),
      cloneBriefs: [],
      questions: [],
    })),
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
  const graphPackets: EvidencePacket[] = top.map((move) => {
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

    const researchDossier = buildResearchDossier({
      tenantId,
      move,
      demandQueries,
      corpus: researchCorpus,
      nowIso: now.toISOString(),
    });

    return buildEvidencePacket({
      move,
      brand,
      ownedFacts,
      ownedGsc,
      competitor,
      fanoutSeeds: move.fanoutSeeds,
      demandQueries,
      researchDossier,
    });
  });

  const rankedEntries = opts.rankedEntries ?? [];
  const usedGraphPackets = new Set<number>();
  const packets: EvidencePacket[] = [];

  function findGraphPacket(entry: RankedUnifiedEntry): EvidencePacket | null {
    if (!entry.graphBacked) return null;
    const entryPath = entry.page ? pathKey(entry.page) : null;
    const query = entry.query.trim().toLocaleLowerCase("en-US");
    for (let index = 0; index < graphPackets.length; index += 1) {
      if (usedGraphPackets.has(index)) continue;
      const packet = graphPackets[index]!;
      const pageMatch = entryPath && packet.yourPage.url && pathKey(packet.yourPage.url) === entryPath;
      const queryMatch = packet.move.label.trim().toLocaleLowerCase("en-US") === query ||
        packet.demand.queries.some((row) => row.query.trim().toLocaleLowerCase("en-US") === query);
      if (pageMatch || queryMatch) {
        usedGraphPackets.add(index);
        return packet;
      }
    }
    return null;
  }

  function buildAllocatorPacket(entry: RankedUnifiedEntry): EvidencePacket {
    const exactKeyword = researchCorpus.keywordLibrary.rows.find(
      (row) => row.keyword.trim().toLocaleLowerCase("en-US") === entry.query.trim().toLocaleLowerCase("en-US"),
    );
    const measuredGsc = Math.max(entry.demandEvidence.gscMonthly ?? 0, exactKeyword?.timesShownPerMo ?? 0);
    const measuredVolume = Math.max(entry.demandEvidence.searchVolumeMonthly ?? 0, exactKeyword?.searchesPerMo ?? 0);
    const demand = Math.max(measuredGsc, measuredVolume, 1);
    const signals = new Set<string>();
    if (measuredGsc > 0) signals.add("GSC");
    if (measuredVolume > 0) signals.add("volume");
    if (entry.sources.includes("aeo_gap")) signals.add("AI");
    if (entry.sources.includes("serp_steal")) signals.add("SERP");
    if (entry.page) signals.add("owned-page");

    let ownedSnap: PageSnapshot | undefined;
    if (entry.page) {
      ownedSnap = ownedByCanon.get(canonicalizeCitationUrl(entry.page) || entry.page) ?? ownedByPath.get(pathKey(entry.page));
    }
    const ownedUrl = ownedSnap?.url ?? entry.page;
    const gap: MoveCandidate["gap"] = entry.kind === "create"
      ? "create_page"
      : entry.kind === "fix"
        ? "fix_experience"
        : entry.sources.includes("aeo_gap")
          ? "answer_block"
          : "edit_page";
    let move: MoveCandidate = {
      demandKey: `allocator:${entry.id}`,
      label: entry.query,
      gap,
      score: entry.allocatorScore,
      components: {
        demand,
        winnability: entry.confidence,
        dollarValue: 0,
        visibilityGap: entry.kind === "create" || entry.sources.includes("aeo_gap") ? 1 : 0.5,
        friction: entry.kind === "fix" ? 1 : 0,
      },
      confidence: entry.confidence >= 0.75 ? "high" : entry.confidence >= 0.5 ? "medium" : "low",
      signals: [...signals],
      ownedUrl,
      competitorUrls: entry.competitorUrls,
      fanoutSeeds: entry.fanoutSeeds,
      rationale: entry.exactWhat,
    };
    const demandQueries: DemandQuerySignal[] = [{
      query: entry.query,
      impressions: measuredGsc > 0 ? measuredGsc : 1,
      source: measuredGsc > 0 ? "gsc" : "graph",
    }];
    const researchDossier = buildResearchDossier({
      tenantId,
      move,
      demandQueries,
      corpus: researchCorpus,
      nowIso: now.toISOString(),
    });
    const dossierWinnerUrls = [
      ...researchDossier.cloneBriefs.map((brief) => brief.url),
      ...(researchDossier.ai?.topCitedPages ?? []).filter((page) => !page.isOwned).map((page) => page.url),
    ];
    move = { ...move, competitorUrls: [...new Set([...entry.competitorUrls, ...dossierWinnerUrls])].slice(0, 8) };

    const topCompUrl = move.competitorUrls[0] ?? null;
    const audit = topCompUrl ? audits.get(canonicalizeCitationUrl(topCompUrl) || topCompUrl) : undefined;
    const competitor = audit
      ? { url: audit.url, domain: audit.domain, fetchStatus: audit.fetchStatus, facts: audit.facts }
      : topCompUrl
        ? {
            url: topCompUrl,
            domain: stripWww((() => {
              try { return new URL(topCompUrl.startsWith("http") ? topCompUrl : `https://${topCompUrl}`).hostname; }
              catch { return topCompUrl; }
            })()),
            fetchStatus: "not_audited",
            facts: null,
          }
        : null;
    const ownedFacts = ownedSnap ? snapshotToFacts(ownedSnap) : null;
    let ownedGsc: EvidencePacket["yourPage"]["gsc"] = null;
    if (ownedUrl) {
      const sig = gscByCanon.get(canonicalizeCitationUrl(ownedUrl) || ownedUrl) ?? gscByPath.get(pathKey(ownedUrl));
      if (sig) ownedGsc = { clicks: sig.clicks90d, impressions: sig.impressions90d, ctr: sig.ctr90d, position: sig.position90d };
    }
    return buildEvidencePacket({
      move,
      brand,
      ownedFacts,
      ownedGsc,
      competitor,
      fanoutSeeds: move.fanoutSeeds,
      demandQueries,
      researchDossier,
    });
  }

  if (rankedEntries.length > 0) {
    for (const entry of rankedEntries.slice(0, limit)) {
      packets.push(findGraphPacket(entry) ?? buildAllocatorPacket(entry));
    }
    for (let index = 0; index < graphPackets.length; index += 1) {
      if (!usedGraphPackets.has(index)) packets.push(graphPackets[index]!);
    }
  } else {
    packets.push(...graphPackets);
  }

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
