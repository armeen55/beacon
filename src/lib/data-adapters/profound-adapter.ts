/**
 * Profound Data Adapter — current implementation backed by imported data.
 *
 * This is the default adapter that reads from existing stores (json-store,
 * cold-store, repository). A future native adapter would implement the
 * same interfaces from answer snapshots + native citation data.
 *
 * Routes should prefer using `getAdapters()` from `./index.ts` rather
 * than importing this directly — that's the swap point.
 */

import "server-only";

import {
  results,
  changelogEntries,
  opportunities,
  competitors,
} from "@/lib/seed-data.server";
import { citationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
// Sprint 7 Phase 7.5c/3 (2026-04-25): page-store no longer exports a
// module-level `allPages` const (multi-tenant correctness). The Profound
// import pipeline (`getAdapters()` singleton at src/lib/data-adapters/index.ts)
// is sync and threading async page fetch through it cascades widely. Since
// Profound import is legacy (Beacon pivoted to native polling per the
// 2026-04-22 phase v4 cutover) and getGeoCov is called inside the pipeline
// only, we accept an empty page array here as a documented partial fix.
// Multi-tenant geo coverage in the Profound pipeline degrades to empty
// until a follow-up commit wires `await getOwnedPages()` through.
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
const allPages: PageEntity[] = [];
import { getSiteConfig } from "@/lib/site-config";
import { PLATFORM_LABELS, type Platform } from "@/lib/constants";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts, promptLibrary } from "@/domains/prompts/prompt-library";
import { computeJourneyCoverage } from "@/domains/prompts/journey-coverage";
import { computeBeaconScore } from "@/domains/product/beacon-score";
import { computeCitationDecay, getDecayAlerts as getDecayAlertsRaw } from "@/domains/attribution/citation-decay";
import { getCachedCoMentionMatrix, computeCoMentionMatrix, persistCoMentionMatrix } from "@/domains/competitors/co-mention";
import { computeSourceTrustIndex } from "@/domains/competitors/source-trust";
import { computeBattlecards } from "@/domains/competitors/battlecards";
import { extractEntities } from "@/domains/entity/entity-extract";
import { detectDiscrepancies } from "@/domains/entity/discrepancy-detect";
import { computeOutcomeSummary, outcomeRecords } from "@/domains/product/outcome-store";
import { analyzeAllExtractability } from "@/domains/pages/extractability";
import { computeSnippetIntelligence } from "@/domains/competitors/snippet-intel";
import { computePulse } from "@/domains/product/pulse";
import { answerSnapshots } from "@/domains/answer-snapshots/store";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { computeMarketBenchmark } from "@/domains/pages/builder-benchmark";
import { pageIssues } from "@/domains/pages/issues";
import type {
  VisibilityAdapter,
  GeoAdapter,
  JourneyAdapter,
  ScoreAdapter,
  CompetitiveAdapter,
  EntityAdapter,
  AttributionAdapter,
  OutcomeAdapter,
  SnippetAdapter,
  PulseAdapter,
  BeaconDataAdapters,
} from "./types";

function buildCitMap(): Map<string, number> {
  const citMap = new Map<string, number>();
  if (citationEvidenceIndex) {
    for (const r of citationEvidenceIndex.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }
  return citMap;
}

export function createProfoundAdapters(): BeaconDataAdapters {
  const { siteDomain } = getSiteConfig();
  const citIndex = citationEvidenceIndex;

  // Shared lazy computations
  let _citMap: Map<string, number> | null = null;
  function getCitMap() { return _citMap ??= buildCitMap(); }

  let _geoCoverage: ReturnType<typeof computeGeoCoverage> | null = null;
  function getGeoCov() {
    return _geoCoverage ??= computeGeoCoverage(
      allPages,
      citIndex?.by_page_and_topic ?? [],
      getActivePrompts(),
    );
  }

  let _journeyCoverage: ReturnType<typeof computeJourneyCoverage> | null = null;
  function getJourneyCov() {
    return _journeyCoverage ??= computeJourneyCoverage(promptLibrary);
  }

  let _decayResults: ReturnType<typeof computeCitationDecay> | null = null;
  function getDecay() {
    return _decayResults ??= computeCitationDecay(siteDomain);
  }

  let _entityIndex: ReturnType<typeof extractEntities> | null = null;
  let _entitySnapSig = "";
  function getEntityIdx() {
    // Phase 7.8b-1 (2026-04-25): profound-adapter is the legacy
    // Profound import pipeline (phased out 2026-04-22 per native-poll
    // cutover). Sprint 7 Phase 7.5c/3 already replaced `allPages` with
    // an empty-array fallback for the same reason. Now `getPageSnapshots`
    // is async and this synchronous adapter can't await; keep an
    // empty-fallback to compile cleanly without cascading async into
    // a phased-out caller. Production routes don't invoke getAdapters().
    const snaps: PageSnapshot[] = [];
    const sig = `${snaps.length}:${snaps[0]?.content_hash ?? ""}`;
    if (_entityIndex && sig === _entitySnapSig) return _entityIndex;
    _entitySnapSig = sig;
    _entityIndex = extractEntities(snaps);
    return _entityIndex;
  }

  let _discReport: ReturnType<typeof detectDiscrepancies> | null = null;
  function getDiscReport() {
    return _discReport ??= detectDiscrepancies(getEntityIdx());
  }

  // Phase 7.8b-1 (2026-04-25): same phased-out-adapter rationale as
  // `getEntityIdx` above. `loadCompetitorUniverseRuntime` is async; the
  // sync adapter gets an empty universe rather than cascading async.
  const universeDomains: Set<string> = new Set();

  let _coMention: ReturnType<typeof computeCoMentionMatrix> | null = null;
  function getCoMention() {
    if (_coMention) return _coMention;
    _coMention = getCachedCoMentionMatrix();
    if (!_coMention) {
      _coMention = computeCoMentionMatrix(siteDomain, universeDomains);
      if (_coMention.entries.length > 0) persistCoMentionMatrix(_coMention).catch(() => {});
    }
    return _coMention;
  }

  let _trustIndex: ReturnType<typeof computeSourceTrustIndex> | null = null;
  function getTrust() {
    return _trustIndex ??= computeSourceTrustIndex(siteDomain, universeDomains);
  }

  // Visibility adapter
  const visibility: VisibilityAdapter = {
    getTotalCitations() {
      return results.reduce((s, r) => s + r.citation_count, 0);
    },
    getTotalMentions() {
      return results.reduce((s, r) => s + r.mention_count, 0);
    },
    getTrendPct() {
      const dates = results.map((r) => r.snapshot_date).sort();
      if (dates.length < 20) return null;
      const mid = new Date((new Date(dates[0]).getTime() + new Date(dates[dates.length - 1]).getTime()) / 2).toISOString().slice(0, 10);
      const first = results.filter((r) => r.snapshot_date <= mid).reduce((s, r) => s + r.citation_count, 0);
      const second = results.filter((r) => r.snapshot_date > mid).reduce((s, r) => s + r.citation_count, 0);
      return first > 0 ? Math.round(((second - first) / first) * 100) : null;
    },
    getPlatformBreakdown() {
      const counts = new Map<string, { citations: number; mentions: number }>();
      for (const r of results) {
        if (r.platform === "all") continue;
        const p = counts.get(r.platform) ?? { citations: 0, mentions: 0 };
        p.citations += r.citation_count;
        p.mentions += r.mention_count;
        counts.set(r.platform, p);
      }
      return [...counts.entries()]
        .map(([platform, c]) => ({
          platform,
          label: PLATFORM_LABELS[platform as Platform] ?? platform,
          citations: c.citations,
          mentions: c.mentions,
        }))
        .sort((a, b) => b.citations - a.citations);
    },
    getDateRange() {
      const dates = results.map((r) => r.snapshot_date).sort();
      if (dates.length === 0) return null;
      return { from: dates[0], to: dates[dates.length - 1] };
    },
    getResultCount() { return results.length; },
    getCitationIndex() { return citIndex; },
    getCitationRollups() { return citIndex?.by_page_and_topic ?? []; },
  };

  // Geo adapter
  const geo: GeoAdapter = {
    getCoverage() { return getGeoCov(); },
  };

  // Journey adapter
  const journey: JourneyAdapter = {
    getCoverage() { return getJourneyCov(); },
  };

  // Score adapter
  const score: ScoreAdapter = {
    getScore() {
      const geoCov = getGeoCov();
      const geoSummary = {
        strong: geoCov.cities.filter((c) => c.coverage_status === "strong").length,
        moderate: geoCov.cities.filter((c) => c.coverage_status === "moderate").length,
        weak: geoCov.cities.filter((c) => c.coverage_status === "weak").length,
      };
      const journeyCov = getJourneyCov();
      const decayRes = getDecay();
      const decayStable = decayRes.filter((d) => d.status === "stable").length;
      const decayDeclining = decayRes.filter((d) => d.status === "meaningful_decline" || d.status === "soft_decline").length;
      const decayTotal = decayRes.filter((d) => d.status !== "insufficient_history").length;
      const discReport = getDiscReport();
      const benchmark = citIndex ? computeMarketBenchmark(citIndex, pageIssues) : null;
      const totalOwnedCit = citIndex?.by_page_and_topic.filter((r) => r.is_owned).reduce((s, r) => s + r.total_citations, 0) ?? 0;

      return computeBeaconScore({
        totalOwnedCitations: totalOwnedCit,
        totalOwnedMentions: 0,
        topicsCovered: citIndex?.by_topic.filter((t) => t.owned_citations > 0).length ?? 0,
        citiesCovered: geoSummary.strong + geoSummary.moderate,
        journeyStagesCovered: journeyCov.stages.filter((s) => s.active_prompt_count > 0).length,
        totalJourneyStages: 4,
        decayStableCount: decayStable,
        decayDecliningCount: decayDeclining,
        decayTotal,
        ownedSharePct: benchmark?.ownedAppearanceRate ?? null,
        competitorCount: benchmark?.topCompetitors.length ?? 0,
        discrepancyCount: discReport.discrepancies.length,
        discrepancyNotableCount: discReport.discrepancies.filter((d) => d.severity === "notable").length,
        totalAnswersChecked: discReport.total_answers_checked,
        geoGapCount: geoCov.gaps.length,
        geoCitiesWithPresence: geoSummary.strong + geoSummary.moderate + geoSummary.weak,
        geoTotalCities: geoCov.total_cities,
      });
    },
  };

  // Competitive adapter
  const competitive: CompetitiveAdapter = {
    getCoMentionMatrix() { return getCoMention(); },
    getSourceTrustIndex() { return getTrust(); },
    getBattlecards() {
      if (!citIndex) return null;
      // Phase 7.8b-1 (2026-04-25): empty universe per the
      // adapter-level stub above; phased-out path.
      const compNames = new Map<string, string>();
      for (const c of competitors) {
        const d = c.domain.replace(/^www\./, "").toLowerCase();
        if (!compNames.has(d)) compNames.set(d, c.name);
      }
      return computeBattlecards({
        citationIndex: citIndex,
        coMentionMatrix: getCoMention(),
        trustIndex: getTrust(),
        geoCoverage: getGeoCov(),
        ownedDomain: siteDomain,
        competitorNames: compNames,
      });
    },
  };

  // Entity adapter
  const entity: EntityAdapter = {
    getEntityIndex() { return getEntityIdx(); },
    getDiscrepancyReport() { return getDiscReport(); },
  };

  // Attribution adapter
  const attribution: AttributionAdapter = {
    getDecayResults() { return getDecay(); },
    getDecayAlerts() { return getDecayAlertsRaw(getDecay()); },
  };

  // Outcome adapter
  const outcome: OutcomeAdapter = {
    getSummary() {
      return outcomeRecords.length > 0 ? computeOutcomeSummary() : null;
    },
  };

  // Snippet adapter
  const snippet: SnippetAdapter = {
    getSnippetIntelligence() {
      if (!citIndex) return null;
      // Phase 7.8b-1 (2026-04-25): same empty-snapshots stub as
      // `getEntityIdx`; phased-out adapter path.
      const emptySnaps: PageSnapshot[] = [];
      const extractResults = analyzeAllExtractability(emptySnaps, getCitMap());
      return computeSnippetIntelligence({
        ownedExtractability: extractResults,
        citationIndex: citIndex,
        snapshots: emptySnaps,
        ownedDomain: siteDomain,
      });
    },
  };

  // Pulse adapter
  const pulse: PulseAdapter = {
    getPulse() {
      const latestSnap = answerSnapshots.length > 0
        ? answerSnapshots.reduce((a, b) => a.sampled_at > b.sampled_at ? a : b).sampled_at
        : null;
      return computePulse({
        decayAlerts: attribution.getDecayAlerts(),
        discrepancyReport: getDiscReport(),
        geoCoverage: getGeoCov(),
        journeyCoverage: getJourneyCov(),
        snippetIntel: snippet.getSnippetIntelligence(),
        lastSamplingDate: latestSnap,
      });
    },
  };

  return { visibility, geo, journey, score, competitive, entity, attribution, outcome, snippet, pulse };
}
