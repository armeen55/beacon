/**
 * 2026-05-20 — Slice 4.5.B.α₀ + α₁ + α₂ + α₂.1 + α₂.2 +
 * Slice 4.5.C.α₀ + α₁ + α₂ + α₃a + α₃b — recommendation-trigger
 * loader.
 *
 * Server-side tenant-scoped loader. Reads `PageSnapshot[]` via
 * the repository pattern (`getRepository().forTenant(tenantId)
 * .getPageSnapshots()`), invokes the 11 α-family + 4 Tier-1
 * indexability + 2 Tier-2 sensitive indexability predicates,
 * applies the minimal queue-rules gate, and returns a
 * discriminated result for the operator-only diagnostic page.
 *
 * Slice 4.5.C.α₂ extension (2026-05-20): the 2 Tier-2 sensitive
 * predicates (`noindex-on-indexable-page`, `robots-blocks-ai-bots`)
 * emit at `confidence: "low"` so `applyQueueRules` routes their
 * candidates to `diagnostic_only` (NOT the customer queue).
 * Operator validates on the diagnostic page; promotion to
 * `candidates` (and ultimately the customer queue in Slice
 * 4.5.D) is deferred until false-positive rate is calibrated.
 *
 * Slice 4.5.C.α₁ extension (2026-05-20): the 4 Tier-1 indexability
 * predicates need `OwnedUrlIndexability` as a passed-in pure
 * input (predicate purity invariant forbids `@/lib/connectors/*`,
 * `@/lib/persistence/*`, and `next/cache` inside `triggers/`).
 * The loader pre-loads the per-tenant indexability map via the
 * new `loadIndexabilityBatchForTenant` helper — ONE substrate
 * pass producing a `Map<canonicalUrl, OwnedUrlIndexability>` —
 * then threads the per-snapshot verdict into each Tier-1
 * predicate. When the batch load throws, the 4 indexability
 * predicates skip silently and the loader returns
 * `status: "indexability_unavailable"`; the existing 7 α-family
 * predicates still run.
 *
 * Slice 4.5.B.α₂.1 fix (2026-05-19): swapped the snapshot source
 * from the file-backed boundary `@/domains/pages/snapshot-store::
 * getPageSnapshots()` to the repository pattern. On Vercel the
 * `.data/page-snapshots.json` file is never deployed (gitignored
 * + read-only lambda FS) so the file boundary returned `[]`
 * silently, producing the misleading "Owned snapshots: 0 / No
 * candidate rows produced" state operator-observed on
 * /diagnostics/recommendation-triggers. The repository pattern
 * routes to Supabase under `DATA_SOURCE=supabase`, matching the
 * customer Recommendations pipeline (`load-queue.ts:287`).
 *
 * Predicate invocation pattern (locked):
 *   1. Cross-snapshot duplicate predicates run ONCE over the full
 *      tenant-filtered list BEFORE the per-snapshot loop
 *      (`duplicate-title`, `duplicate-meta`).
 *   2. Per-snapshot predicates run INSIDE the loop, once per
 *      snapshot (`missing-title`, `missing-meta`, `missing-h1`,
 *      `weak-h1`, `title-h1-mismatch`).
 *   3. Per-snapshot indexability predicates (Tier-1: 4.5.C.α₁)
 *      run INSIDE the loop, consuming the pre-loaded
 *      `OwnedUrlIndexability` from the batch map as a pure
 *      input (`sitemap-missing`, `robots-blocks-googlebot`,
 *      `bad-http-status`, `canonical-mismatch`).
 *
 * Hard contracts: no write to `recommended_edits`; no connector /
 * LLM / Supabase mutation on render; no `unstable_cache` at the
 * loader's own boundary (operator wants freshest signal output
 * every load). The batch indexability helper does its own
 * tenant-scoped substrate reads without any caching layer.
 *
 * `weak-h1` consumes `BusinessConfig` (resolved at the loader
 * entry); the 4 Tier-1 indexability predicates ALSO consume the
 * config (for `classifyPageType` applicability gating). The
 * remaining 6 predicates are config-independent.
 */

import "server-only";

import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";
import type { BusinessConfig } from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";
import { loadIndexabilityBatchForTenant } from "@/domains/indexability/batch-load-indexability";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { buildChromeDetector } from "@/domains/recommendation-intelligence/draft-enrichment";
import { getRepository } from "@/lib/persistence/repositories";

import { applyQueueRules } from "./emitter/apply-queue-rules";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";
// demand-graph engine source (2026-06-24) — wired in behind BEACON_DEMAND_GRAPH_RECS.
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { demandGraphToCandidateRows } from "@/domains/demand-graph/to-candidate-rows";
import { isDemandGraphEnabledForTenant } from "@/domains/demand-graph/flag";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import { badHttpStatus } from "./triggers/bad-http-status";
import { canonicalMismatch } from "./triggers/canonical-mismatch";
import { duplicateMeta } from "./triggers/duplicate-meta";
import { duplicateTitle } from "./triggers/duplicate-title";
import { thinContentOverlap } from "./triggers/thin-content-overlap";
import { staleContent, normalizeStaleUrl } from "./triggers/stale-content";
import { missingH1 } from "./triggers/missing-h1";
import { missingMeta } from "./triggers/missing-meta";
import { gscLowCtr, gscStrikingDistance } from "./triggers/gsc-low-ctr";
import { answerBlockReadiness } from "./triggers/answer-block-readiness";
import { clarityFriction } from "./triggers/clarity-friction";
import { loadClarityPageSignalsForTenant } from "./clarity-page-signals";
import { gscDecay } from "./triggers/gsc-decay";
import { profoundAeoGap } from "./triggers/profound-aeo-gap";
// AEO defense pack (BEACON 500 P8, 2026-07-03): three deterministic $0
// detectors over ALREADY-PERSISTED Profound rows (never a live API call).
import { aeoZeroSourceOpening } from "./triggers/aeo-zero-source-opening";
import { aeoDefendCitedQuery } from "./triggers/aeo-defend-cited-query";
import { aeoBrandDescriptionCheck } from "./triggers/aeo-brand-description-check";
import { loadAeoDefenseSignalsForTenant } from "@/domains/aeo/load-defense-signals";
import type { AeoDefenseSignals } from "@/domains/aeo/defense-types";
import { sovDropAlert } from "./triggers/sov-drop-alert";
import { displacementCheckAlert } from "./triggers/displacement-check-alert";
import { citationLossAlert } from "./triggers/citation-loss-alert";
import { connectorFailureStreak } from "./triggers/connector-failure-streak";
import { deviceCtrGap } from "./triggers/device-ctr-gap";
import { loadGscDeviceCtrGapSignal } from "@/domains/gsc/load-weekly-dimensions";
import type { DeviceCtrGapSignal } from "@/domains/gsc/weekly-dimensions";
import { intentClusterConflict } from "./triggers/intent-cluster-conflict";
import { claimTriggerSlot } from "@/domains/provenance/stale-fact-trigger";
import { loadClaimGraphForTenant } from "@/domains/provenance/claim-graph-loader";
import { loadIntentClustersForTenant } from "@/domains/serp/intent-clusters-loader";
import type { IntentCluster } from "@/domains/serp/intent-clusters";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { registryGscConflictsAsClusters } from "@/domains/ownership/registry";
import {
  buildOwnAliasSet,
  loadProfoundTopicSignalsForTenant,
  type ProfoundTopicSignal,
} from "./profound-topic-signals";
import { loadSovWeeklyForTenant, type SovDropAlert } from "@/domains/ai-visibility/sov-weekly";
import {
  loadDisplacementVerdictsForTenant,
  type DisplacementVerdict,
} from "@/domains/serp/displacement-check";
import { loadCitationLossesForTenant, type CitationLossFinding } from "@/domains/ai-visibility/citation-loss";
import { listRecentCronRuns } from "@/domains/ops/cron-runs-store";
import { deriveProviderStreaks, streaksAtOrAboveThreshold, type ProviderStreak } from "@/domains/ops/cron-streak";
import {
  loadGscDecaySignalsForTenant,
  loadGscPageSignalsForTenant,
  type GscDecaySignal,
  type GscPageSignal,
} from "./gsc-page-signals";
import { invalidSchema } from "./triggers/invalid-schema";
import { missingSchema } from "./triggers/missing-schema";
import { missingTitle } from "./triggers/missing-title";
import {
  snippetPromiseCandidates,
  hasSnippetPromise,
  MIN_IMPRESSIONS_FOR_PROMISE_AUDIT,
} from "@/domains/recommendations/snippet-promise";
import { findSnippetCaptures, snippetCaptureCandidates } from "@/domains/serp/snippet-capture";
import { featureStealHistoryRows, loadBrokenCompetitorFindings, loadSerpFeatureChanges } from "@/domains/serp/serp-history";
import { brokenCompetitorAlert } from "./triggers/broken-competitor-alert";
import { serpFeatureChangeAlert } from "./triggers/serp-feature-change-alert";
import { loadStealBriefsForTenant } from "@/domains/serp/serp-steal-lane";
import { loadEarlyBodyTextForUrls } from "./early-body-text";
import { noindexOnIndexablePage } from "./triggers/noindex-on-indexable-page";
import { orphanPage } from "./triggers/orphan-page";
import { internalLinkOpportunity } from "./triggers/internal-link-opportunity";
// R18 / N23 + P7 (2026-07-03) — internal-authority + entity-interlink +
// term-coverage triggers (the internal PageRank / click-depth engine, the
// entity auto-interlink cards, and the expand-coverage directive).
import { buriedPage } from "./triggers/buried-page";
import { entityInterlink } from "./triggers/entity-interlink";
import { termCoverageGap } from "./triggers/term-coverage-gap";
import { buildInternalPageRankForTenant } from "@/domains/linkgraph/internal-pagerank-loader";
import {
  buildEntityInterlinkCandidates,
  buildTermCoverageItems,
} from "@/domains/linkgraph/load-linkgraph-triggers";
// R19 / N24 + N22 + N21 (2026-07-03) - content-lifecycle engine (prune / merge /
// retire), JS-shell dual-fetch heuristic, and demand-first technical crawl
// signals. All three read ALREADY-LOADED signals ($0), are pure over
// pre-assembled inputs, and dedupe against existing merge / technical triggers by
// cooldown_key. Empty inputs -> byte-identical to before this family existed.
import { classifyContentLifecycle } from "@/domains/lifecycle/content-lifecycle";
import { classifyJsShell } from "@/domains/lifecycle/js-shell";
import { classifyTechnicalDemand } from "@/domains/lifecycle/technical-demand";
import { assembleLifecycleInputs } from "@/domains/lifecycle/load-lifecycle-inputs";
import { contentLifecycle } from "./triggers/content-lifecycle";
import { jsShellContent } from "./triggers/js-shell-content";
import { technicalDemand } from "./triggers/technical-demand";
// P11 (2026-07-03) - technical-SEO pack: dead-URL-with-demand recovery,
// broken-link fixer + link liveness, redirect-chain + soft-404 hygiene. All read
// ALREADY-LOADED signals (snapshots + GSC + the URL-inspection cache) at $0; the
// optional live-liveness pass is polite + capped + fail-soft. Pure over
// pre-assembled inputs, deduped against the status/link triggers by cooldown_key.
// Empty inputs -> byte-identical to before this family existed.
import { classifyDeadUrl } from "@/domains/technical-seo/dead-url-recovery";
import {
  classifyBrokenLinks,
  type TargetLiveness,
} from "@/domains/technical-seo/broken-links";
import { classifyRedirectHygiene } from "@/domains/technical-seo/redirect-hygiene";
import {
  assembleTechnicalInputs,
  statusToLiveness,
} from "@/domains/technical-seo/load-technical-inputs";
import { loadInspectionsForTenant } from "@/domains/technical-seo/load-inspections";
import { probeLivenessBatch } from "@/domains/technical-seo/link-liveness";
import { deadUrlRecovery } from "./triggers/dead-url-recovery";
import { brokenLinks } from "./triggers/broken-links";
import { redirectHygiene } from "./triggers/redirect-hygiene";
import { uncitedContent } from "./triggers/uncited-content";
// P24 (2026-07-03) - image-SEO lane: alt-text gap on real-demand pages. Reads
// the `images` field the scanner now captures on each snapshot ($0, no new
// crawl), joins the GSC demand already loaded, and deterministically drafts a
// description for each picture missing alt text. Pure over pre-assembled inputs,
// deduped against any prior card by cooldown_key. Empty inputs -> byte-identical.
import { classifyAltTextGap } from "@/domains/image-seo/classify";
import { addImageAltText } from "./triggers/add-image-alt-text";
// P10 (2026-07-03) - entity + author (E-E-A-T) pack: sitewide entity + sameAs,
// author/reviewer Person byline, and a connector-free brand Knowledge-Graph
// presence check. All read ALREADY-LOADED signals (snapshots + the SHIPPED
// Wikidata QID cache) at $0; NEVER call Wikidata or an LLM. Pure over pre-
// assembled inputs, deduped against any prior schema card by cooldown_key.
// Empty inputs -> byte-identical to before this family existed.
import { loadEeatSignalsForTenant } from "@/domains/entity/load-eeat-signals";
import {
  entityLinkGap,
  authorBylineGap,
  brandPresenceGap,
} from "./triggers/entity-eeat";
import { robotsBlocksAiBots } from "./triggers/robots-blocks-ai-bots";
import { robotsBlocksGooglebot } from "./triggers/robots-blocks-googlebot";
import { sitemapMissing } from "./triggers/sitemap-missing";
import { titleH1Mismatch } from "./triggers/title-h1-mismatch";
import { weakH1 } from "./triggers/weak-h1";
import { weakH2 } from "./triggers/weak-h2";
// P20 (2026-07-03) - spelling / transliteration demand: consolidate demand
// across a tenant's declared spelling groups onto the canonical term and emit a
// create_page Move to own all of them at once. GENERIC + language-agnostic;
// reads the tenant config + the ALREADY-LOADED GSC signals ($0). With no
// configured groups the loader adds nothing -> byte-identical to before P20.
import { spellingDemandMove } from "./triggers/spelling-demand-move";
import { loadSpellingDemandMoveItems } from "@/domains/spelling-demand/load-spelling-demand";
// RANK-4 (2026-07-06) - AI-crawler-skip Move: turn Profound's previously
// read-only AI-crawler feed (profound_bot_rows) into an actionable Move. A
// high-value owned page (real GSC demand) that AI crawlers SKIP while crawling
// the rest of the site earns an add_internal_link card ("AI can't recommend a
// page it never read"). Reads ALREADY-SYNCED bot rows + GSC demand ($0), pure
// over the pre-assembled gaps, deduped against the other link cards by
// cooldown_key. Empty crawler feed -> no gaps -> byte-identical to before.
import { aiCrawlerSkip } from "./triggers/ai-crawler-skip";
import { loadCrawlerSkipGapsForTenant } from "@/domains/aeo-traffic/load-crawler-skip-gaps";

export type TriggerCandidatesLoadStatus =
  | "ok"
  | "snapshots_unavailable"
  | "config_unavailable"
  /**
   * Slice 4.5.C.α₁ (2026-05-20). Surfaced when
   * `loadIndexabilityBatchForTenant` throws (substrate-read
   * failure: sitemap reconciliation / robots state / repository).
   * The 7 α-family predicates still run; only the 4 Tier-1
   * indexability predicates skip. The diagnostic page can branch
   * on this status to render a partial-result banner.
   */
  | "indexability_unavailable";

export type TriggerCandidatesLoadResult = {
  status: TriggerCandidatesLoadStatus;
  candidates: RecommendationCandidateRow[];
  diagnostic_only: RecommendationCandidateRow[];
  meta: {
    tenant_id: string;
    snapshot_count: number;
    predicates_run: number;
    candidate_count: number;
    diagnostic_only_count: number;
  };
};

// 30 predicates + P10 entity + author pack's 3 (entity_link_gap,
// author_byline_gap, brand_presence_gap) = 33, + P20 spelling_demand_move = 34,
// + RANK-4 ai_crawler_skip = 35.
const PREDICATE_COUNT = 35;

function emptyResult(
  status: TriggerCandidatesLoadStatus,
  tenantId: string,
  snapshotCount: number,
): TriggerCandidatesLoadResult {
  return {
    status,
    candidates: [],
    diagnostic_only: [],
    meta: {
      tenant_id: tenantId,
      snapshot_count: snapshotCount,
      predicates_run: PREDICATE_COUNT,
      candidate_count: 0,
      diagnostic_only_count: 0,
    },
  };
}

function dedupeByKey(
  rows: ReadonlyArray<RecommendationCandidateRow>,
): RecommendationCandidateRow[] {
  const seen = new Set<string>();
  const out: RecommendationCandidateRow[] = [];
  for (const row of rows) {
    if (seen.has(row.dedupe_key)) continue;
    seen.add(row.dedupe_key);
    out.push(row);
  }
  return out;
}

export async function loadTriggerCandidatesForTenant(options: {
  tenantId: string;
}): Promise<TriggerCandidatesLoadResult> {
  const { tenantId } = options;

  // Slice 4.5.B.α₂.1 — snapshots come through the repository
  // pattern, which routes to Supabase under DATA_SOURCE=supabase
  // (production) or the file backend (dev). `.forTenant(tenantId)`
  // already filters by tenant_id, so the defensive null filter
  // below is the only post-fetch reshape we apply.
  let snapshots: PageSnapshot[];
  try {
    const repo = getRepository().forTenant(tenantId);
    // audit #12 (2026-06-14): the GENERATION path must see EVERY page, not
    // the 500-most-recent rows the egress-pinned web reader returns. A
    // single large-tenant scan already exceeds the cap, so the un-capped,
    // fully-paginated generation read keeps later pages from silently
    // vanishing from every trigger. Fall back to the capped read for
    // backends / test fakes that don't implement it.
    const all = repo.getAllPageSnapshotsForGeneration
      ? await repo.getAllPageSnapshotsForGeneration()
      : await repo.getPageSnapshots();
    snapshots = Array.isArray(all) ? all.filter((s) => s != null) : [];
    // Link-graph feed (2026-06-12 night shift): the egress-lean
    // snapshot projection deliberately omits internal_links, which
    // starved the cross-page link triggers on hosted/cron — their
    // emptiness guards silently emitted 0 (orphan_page since the
    // EGRESS-P0 incident; internal_link_opportunity from birth).
    // Merge the scoped link-graph read in; fail-soft keeps the
    // honest guards if the read breaks.
    try {
      const graphs = await repo.getPageSnapshotLinkGraphs();
      const byPage = new Map(graphs.map((g) => [g.page_id, g.internal_links]));
      for (const s of snapshots) {
        if (s.internal_links == null || s.internal_links.length === 0) {
          const links = byPage.get(s.page_id);
          if (links) s.internal_links = links;
        }
      }
    } catch {
      /* triggers keep their emptiness guards */
    }
  } catch (err) {
    // Night-shift observability (2026-06-11): the nightly job diagnosed
    // blind without these — log WHY before degrading.
    console.error(
      `[trigger-loader] snapshots unavailable for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyResult("snapshots_unavailable", tenantId, 0);
  }

  // α₁: `weak-h1` requires the resolved BusinessConfig. Soft-fail
  // the whole loader to `config_unavailable` rather than partial-
  // running predicates with an unknown config shape.
  let businessConfig: BusinessConfig;
  try {
    // CRITICAL (audit #2, 2026-06-14): the SYNC getBusinessConfig never
    // consults Supabase, so on Vercel (no .data files) a self-served
    // tenant resolves to the neutral placeholder — contentSiteMode is
    // absent → page-classifier returns "other" → Gate 9 suppresses every
    // content-edit candidate → Iranopedia gets ZERO recommendations.
    // Hydrate from the durable per-tenant Supabase row first (it runs the
    // env/file sync chain internally, preserving priority), falling back
    // to the sync placeholder only when there's no row.
    businessConfig =
      (await hydrateBusinessConfigFromSupabase(tenantId)) ??
      getBusinessConfig(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] business config unavailable for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return emptyResult("config_unavailable", tenantId, snapshots.length);
  }

  // Slice 4.5.C.α₁ — pre-load the per-tenant indexability batch
  // map. ONE substrate pass producing
  // `Map<canonicalUrl, OwnedUrlIndexability>`. When this throws,
  // the 4 Tier-1 indexability predicates skip silently; the 7
  // α-family predicates still run. The status flips to
  // `indexability_unavailable` so the diagnostic page can render
  // a partial-result banner. We pass the already-loaded snapshot
  // array so the batch helper skips its own `getPageSnapshots()`
  // round-trip.
  let indexabilityMap: Map<string, OwnedUrlIndexability> | null = null;
  let indexabilityFailed = false;
  try {
    indexabilityMap = await loadIndexabilityBatchForTenant({
      tenantId,
      snapshots,
    });
  } catch (err) {
    console.error(
      `[trigger-loader] indexability batch failed for ${tenantId} (Tier-1 predicates skip): ${err instanceof Error ? err.message : String(err)}`,
    );
    indexabilityFailed = true;
  }

  // Insight Graph slice 1 (2026-06-12): pre-load the per-tenant GSC
  // Search Analytics page signals (28-day aggregates). Soft-fail to
  // an empty map — no GSC connection (or no synced rows yet) simply
  // means the gsc_low_ctr predicate never fires.
  // audit #17 (2026-06-14): GSC and Clarity are INDEPENDENT connectors —
  // give each its own try/catch (matching the decay/semrush blocks below).
  // Previously both ran in one try, so a GSC throw skipped the Clarity load
  // entirely: every clarity_friction rec silently vanished on a GSC hiccup,
  // and the lone error message named only GSC so the Clarity outage was
  // invisible. One connector failing must not be collateral damage for the
  // other.
  let gscSignals: Map<string, GscPageSignal> = new Map();
  let claritySignals: Map<string, import("./clarity-page-signals").ClarityPageSignal> = new Map();
  try {
    gscSignals = await loadGscPageSignalsForTenant(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] gsc page-signals load failed for ${tenantId} (gsc predicates skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    claritySignals = await loadClarityPageSignalsForTenant(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] clarity page-signals load failed for ${tenantId} (clarity_friction skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Decay slice (2026-06-12): two consecutive 28d windows per page.
  let gscDecaySignals: Map<string, GscDecaySignal> = new Map();
  try {
    gscDecaySignals = await loadGscDecaySignalsForTenant(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] gsc decay-signals load failed for ${tenantId} (decay predicate skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Profound AEO-gap (2026-06-14): pre-load per-topic answer-engine
  // signals from the ALREADY-SYNCED profound_visibility_rows (this reads
  // synced Supabase rows — it NEVER calls the Profound API). The tenant's
  // own brand is identified by the config-driven owned-alias set (brand
  // name + first word + domain host). Soft-empty when Profound isn't
  // connected / no rows — the predicate then never fires.
  let profoundTopicSignals: ProfoundTopicSignal[] = [];
  try {
    const ownAliases = buildOwnAliasSet({
      brandName: businessConfig.name,
      domain: businessConfig.domain,
    });
    if (ownAliases.size > 0) {
      const sigMap = await loadProfoundTopicSignalsForTenant(
        tenantId,
        ownAliases,
      );
      profoundTopicSignals = Array.from(sigMap.values());
    }
  } catch (err) {
    console.error(
      `[trigger-loader] profound topic-signals load failed for ${tenantId} (profound_aeo_gap skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // AEO defense pack (BEACON 500 P8, 2026-07-03): pre-load the three
  // deterministic AEO-defense signals from ALREADY-PERSISTED Profound rows
  // (profound_citation_rows for the zero-source opening + the 2-capture
  // defend-a-cited-query delta; profound_answer_rows for the brand-description
  // accuracy check). This reads synced Supabase rows only, NEVER the Profound
  // API. Soft-empty when Profound is not connected / no rows / no mismatch -
  // the three predicates then abstain (self-hiding).
  let aeoDefense: AeoDefenseSignals = {
    zeroSourceOpenings: [],
    defendCitedQueries: [],
    brandDescriptionMismatches: [],
  };
  try {
    aeoDefense = await loadAeoDefenseSignalsForTenant(tenantId, {
      domain: businessConfig.domain,
      industry: businessConfig.industry,
      locations: businessConfig.locations,
      services: businessConfig.services,
      profound: businessConfig.profound,
    });
  } catch (err) {
    console.error(
      `[trigger-loader] aeo-defense load failed for ${tenantId} (aeo_zero_source_opening / aeo_defend_cited_query / aeo_brand_description_check skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // SoV drop alert (BEACON 500 item 79, 2026-07-02): pre-load the cross-
  // engine weekly share-of-the-answers table (native poll + Profound +
  // llm-mentions cache, merged honestly in sov-weekly.ts) and pull out any
  // week-over-week drop alerts. Soft-empty when the native poll has no
  // history yet — the predicate then never fires (never alert off nothing).
  let sovDropAlerts: SovDropAlert[] = [];
  try {
    const ownAliases = buildOwnAliasSet({
      brandName: businessConfig.name,
      domain: businessConfig.domain,
    });
    if (ownAliases.size > 0) {
      const sovResult = await loadSovWeeklyForTenant(tenantId, ownAliases);
      sovDropAlerts = sovResult.dropAlerts;
    }
  } catch (err) {
    console.error(
      `[trigger-loader] sov-weekly load failed for ${tenantId} (sov_drop_alert skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Displacement check (BEACON 500 item 82, 2026-07-02): pre-load the
  // ALREADY-PERSISTED displacement verdicts (move_drafts, kind
  // displacement_check) the nightly precompute step writes — this NEVER
  // spends a paid SERP call itself, it only reads what the runner already
  // checked. Soft-empty when nothing has been checked yet.
  let displacementVerdicts: DisplacementVerdict[] = [];
  try {
    displacementVerdicts = await loadDisplacementVerdictsForTenant(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] displacement-check load failed for ${tenantId} (displacement_check skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Citation loss (BEACON 500 item 83, 2026-07-02): pre-load the diffed
  // Profound citation stream (profound_answer_rows) — week-over-week, per
  // prompt, "used to be cited, now is not" findings. Reads ALREADY-SYNCED
  // rows only; never calls the Profound API. Coverage losses (the prompt
  // simply stopped being polled) are filtered out HERE, at the loader
  // boundary, so the trigger predicate never has a chance to misfire one as
  // a real loss. Soft-empty when Profound prompt intelligence hasn't synced
  // for this tenant yet.
  let citationLossFindings: CitationLossFinding[] = [];
  try {
    const result = await loadCitationLossesForTenant(tenantId, {
      ownedDomain: businessConfig.domain,
    });
    citationLossFindings = result.findings.filter(
      (f): f is CitationLossFinding => f.kind === "citation_loss",
    );
    if (result.syncStale) {
      // Honesty over silence (item 83): a stale Profound sync compares two
      // sub-windows of one old batch, not a real week over week. Findings
      // still emit (they may still be true), but this is logged plainly so
      // an operator reading the trigger loader's logs isn't misled into
      // thinking the data is current.
      console.warn(
        `[trigger-loader] citation-loss sync looks stale for ${tenantId} (latestRowDate=${result.latestRowDate}) - findings are as of the last sync, not necessarily this week`,
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] citation-loss load failed for ${tenantId} (citation_loss_alert skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Connector failure streak (BEACON_500 item 84, 2026-07-03): pre-load the
  // cron_runs ledger's sync-connectors run history and derive consecutive
  // failure streaks per (tenant, provider). Reads ALREADY-PERSISTED nightly
  // run results only, never touches a connector API itself. Soft-empty when
  // the ledger has no history yet (pre-migration window, or a brand-new
  // tenant), the predicate then never fires.
  let connectorStreaks: ProviderStreak[] = [];
  try {
    const runs = await listRecentCronRuns("sync-connectors", 14);
    connectorStreaks = streaksAtOrAboveThreshold(deriveProviderStreaks(runs));
  } catch (err) {
    console.error(
      `[trigger-loader] cron-runs ledger load failed for ${tenantId} (connector_failure_streak skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Competitor watch pack (BEACON_500 P9, 2026-07-03): two deterministic $0
  // reads over the ALREADY-PERSISTED dataforseo_serp_history rows (both diff
  // captures the paid SERP writer already stored; NEITHER spends a live call):
  //   • broken_competitor - a rival that held a Google top spot for a tracked
  //     query earlier and is gone from the latest capture (an opening).
  //   • serp_feature_change - a winnable Google feature (answer box / People
  //     Also Ask / image row) that just appeared for a tracked query.
  // Both fail soft to empty (no history / no diff-able captures / read error)
  // so the predicates then never fire. Byte-identical to before when empty.
  let brokenCompetitorFindings: Awaited<ReturnType<typeof loadBrokenCompetitorFindings>> = [];
  try {
    brokenCompetitorFindings = await loadBrokenCompetitorFindings(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] broken-competitor load failed for ${tenantId} (broken_competitor skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let serpFeatureChanges: Awaited<ReturnType<typeof loadSerpFeatureChanges>> = [];
  try {
    serpFeatureChanges = await loadSerpFeatureChanges(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] serp-feature-change load failed for ${tenantId} (serp_feature_change skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Device click gap (BEACON_500 R17b, v1 item 268): pre-load the newest
  // weekly device snapshot's pure signal (the weekly GSC dimensions pass
  // writes it; this reads the store at $0, never the GSC API). Soft-null when
  // the weekly pass has not run yet - the predicate then abstains.
  let deviceGapSignal: DeviceCtrGapSignal | null = null;
  try {
    deviceGapSignal = await loadGscDeviceCtrGapSignal(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] weekly device signal load failed for ${tenantId} (gsc_device_ctr_gap skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Intent cluster conflict (BEACON_500 item N7, 2026-07-02): pre-load SERP
  // overlap clusters from ALREADY-STORED dataforseo_serp_history rows, $0,
  // no new paid SERP pulls. Reuses the gscSignals map already loaded above
  // (item N7 draws its tracked-query universe from the same GSC topQueries
  // the other triggers already consume). Soft-empty when GSC isn't
  // connected or no SERP history exists yet for those queries.
  let intentClusters: IntentCluster[] = [];
  try {
    const clusterResult = await loadIntentClustersForTenant({
      tenantId,
      gscSignals,
      ownDomain: businessConfig.domain ?? null,
    });
    intentClusters = clusterResult.clusters;
  } catch (err) {
    console.error(
      `[trigger-loader] intent-cluster load failed for ${tenantId} (intent_cluster_conflict skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // N2 (2026-07-02) - the ownership registry's OWN conflict surface (item 3): a
  // gsc_ranks-basis conflict (2+ owned pages splitting one query's Google
  // impressions - gsc-cannibalization.ts, a signal intent-clusters.ts never
  // reads) converted into the SAME IntentCluster shape and folded into the
  // list `intentClusterConflict` below already consumes. ONE emission code
  // path -> one merge_pages card per real conflict, never a duplicate from a
  // second trigger. Reuses the SAME registry loader other N2 choke points call
  // (per-request cached), so this adds no new I/O beyond what N2 already pays
  // for elsewhere this render. Fail-soft -> intentClusters alone.
  try {
    const registry = await loadOwnershipRegistryForTenant(tenantId, { gscSignals, ownDomain: businessConfig.domain ?? null });
    const gscConflictClusters = registryGscConflictsAsClusters(registry);
    if (gscConflictClusters.length > 0) intentClusters = [...intentClusters, ...gscConflictClusters];
  } catch (err) {
    console.error(
      `[trigger-loader] ownership-registry conflict load failed for ${tenantId} (registry gsc_ranks conflicts skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Night-shift #44 (2026-06-11): pre-load the per-tenant sitemap
  // lastmod map for the stale-content predicate. Soft-fail to an
  // empty map — unknown age is never evidence of staleness.
  const lastmodByUrl = new Map<string, string>();
  try {
    const recon = await getRepository().forTenant(tenantId).getSitemapReconciliation();
    for (const page of recon?.canonical_pages ?? []) {
      if (page.sitemap_lastmod) {
        lastmodByUrl.set(normalizeStaleUrl(page.url), page.sitemap_lastmod);
      }
    }
  } catch (err) {
    console.error(
      `[trigger-loader] sitemap reconciliation unavailable for ${tenantId} (stale-content skips): ${err instanceof Error ? err.message : String(err)}`,
    );
    /* empty map — predicate skips */
  }

  // Root-cause-#3 gap (2026-06-16): build the site-wide chrome detector ONCE
  // from the same snapshot set the draft-enrichment context uses, and thread
  // it into the missing-meta trigger so the trigger's `selectMetaSource`
  // "can composeMeta auto-draft this?" check matches the ENRICHMENT
  // composeMeta call exactly — no divergence between the trigger that picks
  // edit_meta-vs-improve_meta and the enrichment that drafts it.
  const snapshotByUrl = new Map<string, PageSnapshot>(
    snapshots.map((s) => [s.url, s]),
  );
  const chromeDetector = buildChromeDetector(snapshotByUrl);

  const all: RecommendationCandidateRow[] = [];
  // Slice 4.5.B.α₂ — cross-snapshot duplicate predicates run ONCE
  // over the full tenant-filtered list, BEFORE the per-snapshot
  // loop. They aggregate across pages and emit per-occurrence-past-
  // anchor candidates; running them inside the per-snapshot loop
  // would re-aggregate redundantly.
  all.push(...duplicateTitle({ tenantId, snapshots }));
  // Night-shift #43 (2026-06-11): cross-snapshot thin-overlap detector —
  // emits at confidence "low" → diagnostic_only (operator calibrates).
  all.push(...thinContentOverlap({ tenantId, snapshots }));
  // Night-shift #44: sitemap-lastmod staleness — confidence "low" →
  // diagnostic_only (operator calibrates).
  all.push(...staleContent({ tenantId, snapshots, lastmodByUrl, now: new Date() }));
  all.push(...duplicateMeta({ tenantId, snapshots }));
  // Slice 4.5.C.α₃a — `orphan-page` is also a cross-snapshot
  // predicate. It aggregates each snapshot's `internal_links`
  // array to build a Map<canonicalUrl, inbound_source_set> and
  // emits one candidate per owned page with zero inbound. Same
  // before-the-loop invocation pattern as α₂'s duplicates.
  // Includes a global emptiness guard: if no snapshot has any
  // usable `internal_links` data, ALL orphan emissions are
  // suppressed (data unavailable; not "every page is an orphan").
  all.push(...orphanPage({ tenantId, snapshots, businessConfig }));
  // Internal-link brain (2026-06-12): contextual topic-cluster link
  // opportunities from the same snapshot link graph.
  all.push(...internalLinkOpportunity({ tenantId, snapshots }));
  // Internal-authority snapshot, built ONCE and shared by both the R18 link
  // family below and the R19 content-lifecycle family further down (so the
  // link-graph read happens exactly once per run). Fail-soft to null.
  const sharedAuthoritySnapshot = await buildInternalPageRankForTenant(tenantId).catch(() => null);

  // ── R18 / N23 + P7 (2026-07-03): internal-authority + entity-interlink +
  //    term-coverage. All three read ALREADY-STORED data ($0), are pure
  //    predicates over pre-assembled inputs, and dedupe against the existing
  //    link triggers by cooldown_key so no page ever emits two link cards.
  //    Fail-soft as one isolated block: any failure skips this family, never the
  //    loader. Empty inputs -> byte-identical to before this family existed.
  try {
    const nowIso = new Date().toISOString();
    // The set of (tenant, action, url) triples the existing link triggers
    // already claimed this run - the cross-source dedup base.
    const claimedLinkCooldowns = new Set(
      all
        .filter((r) => r.trigger_signal === "orphan_page" || r.trigger_signal === "internal_link_opportunity")
        .map((r) => r.cooldown_key),
    );

    // (1) Buried page (N23): internal PageRank + click-depth over the link graph
    // in `snapshots` (already merged above). Demand comes from gscSignals.
    const authority = sharedAuthoritySnapshot ?? { pages: [] };
    if (authority.pages.length > 0) {
      const impressionsByUrl = new Map<string, number>();
      for (const p of authority.pages) {
        const sig = gscSignals.get(canonicalizeCitationUrl(p.url) ?? p.url);
        if (sig) impressionsByUrl.set(p.url, sig.impressions90d);
      }
      const buried = buriedPage({
        tenantId,
        authorities: authority.pages,
        impressionsByUrl,
        signalAt: nowIso,
      }).filter((r) => !claimedLinkCooldowns.has(r.cooldown_key));
      for (const r of buried) claimedLinkCooldowns.add(r.cooldown_key);
      all.push(...buried);
    }

    // (2) Entity auto-interlink (P7): body-grounded, ownership-aware contextual
    // links to the OWNER page. Reuses the per-request-cached ownership registry
    // + the link graph carried on `snapshots`.
    try {
      const registry = await loadOwnershipRegistryForTenant(tenantId, {
        gscSignals,
        ownDomain: businessConfig.domain ?? null,
      });
      if (registry.byQuery.size > 0) {
        const graphs = snapshots
          .filter((s) => Array.isArray(s.internal_links) && s.internal_links.length > 0)
          .map((s) => ({
            page_id: s.page_id,
            url: s.url,
            fetched_at: s.fetched_at,
            tenant_id: tenantId,
            internal_links: s.internal_links!,
          }));
        const interlinkCandidates = await buildEntityInterlinkCandidates(tenantId, registry, graphs);
        const interlink = entityInterlink({
          tenantId,
          candidates: interlinkCandidates,
          signalAt: nowIso,
        }).filter((r) => !claimedLinkCooldowns.has(r.cooldown_key));
        for (const r of interlink) claimedLinkCooldowns.add(r.cooldown_key);
        all.push(...interlink);
      }
    } catch (err) {
      console.error(
        `[trigger-loader] entity-interlink failed for ${tenantId} (entity_interlink skips): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // (3) Term-coverage gap (P7): expand-coverage directive for pages ranking
    // just off the top that miss the winners' consensus subtopics + demand
    // questions. Its own action type (add_h2_section) never collides with the
    // link cards above.
    try {
      const coverageItems = await buildTermCoverageItems(tenantId, gscSignals);
      all.push(...termCoverageGap({ tenantId, items: coverageItems, signalAt: nowIso }));
    } catch (err) {
      console.error(
        `[trigger-loader] term-coverage-gap failed for ${tenantId} (term_coverage_gap skips): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] internal-authority family failed for ${tenantId} (buried_page / entity_interlink / term_coverage_gap skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // ── P20 (2026-07-03): spelling / transliteration demand. GENERIC +
  //    language-agnostic. Reads the tenant's declared spelling groups (config)
  //    + the ALREADY-LOADED GSC signals ($0), consolidates demand across
  //    spellings onto the canonical term, and emits a create_page Move when the
  //    combined demand clears the floor AND no owned page already captures the
  //    variants. With NO configured groups loadSpellingDemandMoveItems returns
  //    [] immediately -> the loader adds nothing -> byte-identical to before
  //    P20. Fail-soft as its own block; any failure skips only this Move.
  try {
    const spellingItems = await loadSpellingDemandMoveItems({ tenantId, gscSignals });
    if (spellingItems.length > 0) {
      const rootDomain = businessConfig.domain
        ?.trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      all.push(
        ...spellingDemandMove({
          tenantId,
          items: spellingItems,
          siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
          signalAt: new Date().toISOString(),
        }),
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] spelling-demand-move failed for ${tenantId} (spelling_demand_move skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // (SEMrush cannibalization + keyword-gap triggers removed Phase F.1 — SEMrush
  // deleted caller-first. GSC-native cannibalization detection serves /opportunities;
  // wiring it as a queue trigger is tracked as a follow-up.)
  // Profound AEO-gap (2026-06-14): the FIRST trigger to consume Profound —
  // the pivot's sole AEO source. Tenant-level (the gap topic is the unit),
  // so it runs ONCE before the per-snapshot loop. Anchored on the site root
  // (queue rules require a URL); the owner places the answer block. Pure
  // predicate over the pre-loaded synced signals.
  {
    const rootDomain = businessConfig.domain
      ?.trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    all.push(
      ...profoundAeoGap({
        tenantId,
        signals: profoundTopicSignals,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // AEO defense pack (BEACON 500 P8): same site-root anchoring - each is a
    // topic-level / brand-level AEO signal, not a page-level edit. Pure
    // predicates over the pre-loaded, already-detected signals; no Profound
    // API call happens here or in the loader above.
    all.push(
      ...aeoZeroSourceOpening({
        tenantId,
        openings: aeoDefense.zeroSourceOpenings,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    all.push(
      ...aeoDefendCitedQuery({
        tenantId,
        findings: aeoDefense.defendCitedQueries,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    all.push(
      ...aeoBrandDescriptionCheck({
        tenantId,
        mismatches: aeoDefense.brandDescriptionMismatches,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // SoV drop alert (BEACON 500 item 79): same site-root anchoring
    // convention as profound-aeo-gap — the alert is topic-level, not
    // page-level. Pure predicate over the pre-loaded drop alerts.
    all.push(
      ...sovDropAlert({
        tenantId,
        alerts: sovDropAlerts,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // Citation loss (BEACON 500 item 83): same site-root anchoring — a
    // Profound-citation diff is topic-level, not page-level. Passes this
    // week's sovDropAlerts alongside the findings so the predicate can skip
    // any topic sov_drop_alert already covers this week (dedupe, not a
    // second math pass). Pure predicate over pre-loaded inputs.
    all.push(
      ...citationLossAlert({
        tenantId,
        findings: citationLossFindings,
        sovDropAlertsThisWeek: sovDropAlerts,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // Connector failure streak (BEACON_500 item 84): same site-root anchoring,
    // a sync failure streak is tenant-level, not page-level. Pure predicate
    // over the pre-loaded, already-derived streaks (cron-streak.ts).
    all.push(
      ...connectorFailureStreak({
        tenantId,
        streaks: connectorStreaks,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // Device click gap (BEACON_500 R17b, v1 item 268): same site-root
    // anchoring - the mobile-vs-desktop click split is property-level, not
    // page-level. Pure predicate over the pre-loaded weekly device signal;
    // structurally capped at 1 (one weekly aggregate in, at most one card out).
    all.push(
      ...deviceCtrGap({
        tenantId,
        signal: deviceGapSignal,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // Broken-competitor opportunity (BEACON_500 P9 v1 250+259): same site-root
    // anchoring - a vacated Google spot is a query/topic-level opening, not a
    // page-level edit. Pure predicate over the pre-loaded, already-diffed
    // findings; no paid SERP call happens here or in the loader above.
    all.push(
      ...brokenCompetitorAlert({
        tenantId,
        findings: brokenCompetitorFindings,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
    // Google-results feature-change (BEACON_500 P9 v1 251): same site-root
    // anchoring - a feature appearing is a query/topic-level opening. Only the
    // "appeared" changes become Moves (the predicate filters internally). Pure
    // predicate over the pre-loaded, already-diffed changes; no paid call here.
    all.push(
      ...serpFeatureChangeAlert({
        tenantId,
        changes: serpFeatureChanges,
        siteRootUrl: rootDomain ? "https://" + rootDomain + "/" : null,
        signalAt: new Date().toISOString(),
      }),
    );
  }
  // Displacement check (BEACON 500 item 82): anchored on the affected page
  // itself (the verdict already carries the owned URL GSC attributes the
  // money query to) — no site-root fallback needed. Pure predicate over the
  // pre-loaded, already-persisted verdicts; the paid SERP check already ran
  // in the nightly precompute step, never here.
  all.push(
    ...displacementCheckAlert({
      tenantId,
      verdicts: displacementVerdicts,
      signalAt: new Date().toISOString(),
    }),
  );
  // Intent cluster conflict (BEACON_500 item N7): anchored on the cluster's
  // own best-ranking page (no site-root fallback needed). Pure predicate
  // over the pre-loaded, already-computed SERP-overlap clusters; no paid
  // SERP call happens here or in the loader above.
  all.push(...intentClusterConflict({ tenantId, clusters: intentClusters, signalAt: new Date().toISOString() }));
  // Claim triggers (BEACON_500 R13 / N3 + R13b / N25, 2026-07-03): the ONE
  // shared cap-3 slot for the claim family. Conflicts (two owned pages
  // carrying MATERIALLY different values for the same fact - numbers more
  // than 5 percent apart, or differing dates, never punctuation) outrank
  // stale checks (a fact past its volatility class's freshness deadline)
  // when both exist. Pure over the nightly-persisted claim graph ($0 store
  // read); an empty or missing graph contributes nothing - byte-identical.
  // Fail-soft: a read failure skips this family (claim_conflict and
  // stale_fact skip), never the loader.
  try {
    const claimRecords = await loadClaimGraphForTenant(tenantId);
    if (claimRecords.length > 0) {
      all.push(
        ...claimTriggerSlot({
          tenantId,
          records: claimRecords,
          nowIso: new Date().toISOString(),
          signalAt: new Date().toISOString(),
          trafficFor: (url) =>
            gscSignals.get(canonicalizeCitationUrl(url) ?? url)?.impressions90d ?? 0,
        }),
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] claim trigger check failed for ${tenantId} (claim_conflict and stale_fact skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Snippet-promise audit (BEACON_500 R8 / N18, 2026-07-03): does each page
  // deliver, in its first 200 words, what its title/meta promised the search
  // snippet? Cross-snapshot (capped at 5, highest impressions first), pure
  // over the snapshots + GSC signals loaded above. The egress-lean snapshot
  // projections omit body text, so a bounded, scoped merge read (same pattern
  // as the link-graph read) fetches early body text ONLY for the pages whose
  // title/meta actually makes a checkable promise and that clear the
  // impressions floor. A page with no stored body text is honestly skipped,
  // never flagged off missing data.
  try {
    const impressionsFor = (url: string) =>
      gscSignals.get(canonicalizeCitationUrl(url) ?? url)?.impressions90d ?? 0;
    const needsBodyText = snapshots
      .filter(
        (s) =>
          (s.body_paragraph_sample?.length ?? 0) === 0 &&
          s.http_status < 400 &&
          impressionsFor(s.url) >= MIN_IMPRESSIONS_FOR_PROMISE_AUDIT &&
          hasSnippetPromise(s.title, s.meta_description),
      )
      .map((s) => s.url);
    const earlyTextByUrl = await loadEarlyBodyTextForUrls(tenantId, needsBodyText);
    all.push(
      ...snippetPromiseCandidates({
        tenantId,
        pages: snapshots.map((s) => {
          const inline = (s.body_paragraph_sample ?? []).join(" ");
          return {
            url: s.url,
            title: s.title,
            metaDescription: s.meta_description,
            earlyText: inline.trim() ? inline : (earlyTextByUrl.get(s.url) ?? null),
            impressions: impressionsFor(s.url),
            httpStatus: s.http_status,
            fetchedAt: s.fetched_at,
          };
        }),
        signalAt: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error(
      `[trigger-loader] snippet-promise audit failed for ${tenantId} (snippet_promise_gap skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Featured-snippet capture (BEACON_500 R11 / N29, 2026-07-03): where a
  // captured Google reading shows the answer box owned by someone else and we
  // rank 2-10, emit a FORMAT-MATCHED steal candidate ("Google shows a numbered
  // list; your page answers in prose. Match the list format."). Reads the same
  // already-paid-for dataforseo_serp_history rows the feature-steal columns
  // use ($0, no live call), dedupes against the existing steal-lane cards by
  // query, and pulls stored early body text ONLY for the few capture targets
  // (bounded, same scoped-read pattern as the snippet-promise audit above).
  // Tenants with no captured readings contribute nothing - byte-identical.
  try {
    const [captureRows, stealBriefs] = await Promise.all([
      featureStealHistoryRows(tenantId).catch(() => []),
      loadStealBriefsForTenant(tenantId).catch(() => []),
    ]);
    if (captureRows.length > 0) {
      const tenantDomain =
        businessConfig.domain
          ?.trim()
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "") ?? null;
      const stealLaneQueries = new Set(stealBriefs.map((b) => b.keyword.trim().toLowerCase()).filter(Boolean));
      // Pass 1 (no own-page text): find the qualifying targets.
      const prelim = findSnippetCaptures(captureRows, tenantDomain, { stealLaneQueries });
      if (prelim.length > 0) {
        // Bounded, scoped early-text read for JUST the capture targets, so the
        // directive can honestly say how the page currently answers. Inline
        // snapshot body first; the merge read only for the rest.
        const canonOf = (u: string) => (canonicalizeCitationUrl(u) ?? u).toLowerCase();
        const inlineByCanon = new Map<string, string>();
        for (const s of snapshots) {
          const inline = (s.body_paragraph_sample ?? []).join(" ").trim();
          if (inline) inlineByCanon.set(canonOf(s.url), inline);
        }
        const missing = prelim.filter((o) => !inlineByCanon.has(canonOf(o.ownUrl))).map((o) => o.ownUrl);
        const fetched = missing.length > 0 ? await loadEarlyBodyTextForUrls(tenantId, missing) : new Map<string, string>();
        const earlyTextByUrl = new Map<string, string | null>();
        for (const o of prelim) {
          const inline = inlineByCanon.get(canonOf(o.ownUrl));
          earlyTextByUrl.set(o.ownUrl.toLowerCase(), inline ?? fetched.get(o.ownUrl) ?? null);
        }
        // Pass 2: format-matched opportunities -> candidate rows (capped at 5).
        const opportunities = findSnippetCaptures(captureRows, tenantDomain, { stealLaneQueries, earlyTextByUrl });
        all.push(
          ...snippetCaptureCandidates({
            tenantId,
            opportunities,
            signalAt: new Date().toISOString(),
          }),
        );
      }
    }
  } catch (err) {
    console.error(
      `[trigger-loader] featured-snippet capture failed for ${tenantId} (featured_snippet_capture skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const snapshot of snapshots) {
    all.push(...missingTitle({ tenantId, snapshot }));
    all.push(...missingMeta({ tenantId, snapshot, chromeDetector }));
    all.push(...missingH1({ tenantId, snapshot }));
    all.push(...weakH1({ tenantId, snapshot, businessConfig }));
    // Source-ledger slice (2026-06-12): substantive content pages with
    // zero external references earn an add-sources card.
    all.push(...uncitedContent({ tenantId, snapshot, businessConfig }));
    // Slice 4.5.E.α₁a (2026-05-21) — `weak-h2` mirrors `weak-h1`
    // detection on city/service pages but emits `rewrite_h2` at
    // `confidence: "low"` (diagnostic_only routing). Pure
    // detection layer; no LLM call. Gateway invocation deferred
    // to α₁b's operator-only env-gated server action.
    all.push(...weakH2({ tenantId, snapshot, businessConfig }));
    // α₂.2: title-h1-mismatch requires businessConfig for the
    // shared page-classifier (homepage / city / service
    // allowlist).
    all.push(...titleH1Mismatch({ tenantId, snapshot, businessConfig }));
    // Slice 4.5.C.α₃b — `missing-schema` reuses the existing
    // pure `diffSchemaCoverage()` + `EXPECTED_SCHEMA_BY_ASSET_TYPE`
    // substrate and emits at `confidence: "low"` so candidates
    // route to `diagnostic_only` (NOT customer queue). Tier-2
    // sensitive — current expectation map is local-service-tuned
    // so operator validates per-tenant before any future
    // promotion.
    all.push(...missingSchema({ tenantId, snapshot, businessConfig }));
    // fix_schema slice (2026-06-12) — `invalid-schema` consumes the
    // scanner's own per-page validator output
    // (snapshot.schema_validation_warnings; restored to the Supabase
    // projection in this slice) and emits `fix_schema` repair
    // candidates at medium confidence. Universal: the evidence is the
    // validator's exact failing type+property for THIS page — no
    // industry-tuned expectations involved.
    all.push(...invalidSchema({ tenantId, snapshot, businessConfig }));
    // Insight Graph slice 1 (2026-06-12) — the first FUSED predicate:
    // the tenant's own Search Console numbers drive a title rewrite.
    // The per-page signal is a pre-loaded pure input (soft-empty when
    // GSC isn't connected).
    all.push(
      ...gscLowCtr({
        tenantId,
        snapshot,
        signal: gscSignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
      }),
    );
    // Decay slice (2026-06-12) — fading pages -> refresh.
    // Per-query grounding (2026-06-16): pass the page's top GSC search terms
    // (already loaded in gscSignals; absent when the heavy read timed out) so
    // the refresh directive can name the exact terms the page is known for.
    const decayCanonUrl = canonicalizeCitationUrl(snapshot.url) ?? snapshot.url;
    all.push(
      ...gscDecay({
        tenantId,
        snapshot,
        signal: gscDecaySignals.get(decayCanonUrl),
        topQueries: gscSignals
          .get(decayCanonUrl)
          ?.topQueries?.map((q) => q.query),
      }),
    );
    // Rule B (2026-06-12) — first-party striking distance.
    all.push(
      ...gscStrikingDistance({
        tenantId,
        snapshot,
        signal: gscSignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
      }),
    );
    // AEO answer-block readiness (2026-06-12) — question-shaped pages
    // lacking an early direct answer. Uses GSC question queries where
    // connected; falls back to a question-shaped title/H1 (fires
    // crawl-only, before GSC connects).
    all.push(
      ...answerBlockReadiness({
        tenantId,
        snapshot,
        signal: gscSignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
      }),
    );
    // Clarity fuse (2026-06-13): per-URL friction (script errors /
    // rage clicks) → a page-experience review card.
    all.push(
      ...clarityFriction({
        tenantId,
        snapshot,
        signal: claritySignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
      }),
    );
    // (SEMrush striking-distance removed Phase F.1 — superseded by the first-party
    // gscStrikingDistance trigger already wired below/above. No signal lost.)

    // Slice 4.5.C.α₁ — Tier-1 indexability predicates. Each
    // receives the pre-resolved `OwnedUrlIndexability` as a pure
    // input. The map is keyed by the citation-lifecycle
    // canonicalized URL — same canonicalization the batch helper
    // uses internally. When `indexabilityMap` is null (substrate
    // failure) or the per-snapshot canonical URL has no entry
    // (canonicalization dropped it), the 4 predicates skip.
    if (indexabilityMap != null) {
      const canonicalUrl = canonicalizeCitationUrl(snapshot.url);
      const indexability =
        canonicalUrl == null ? null : indexabilityMap.get(canonicalUrl);
      if (indexability != null) {
        all.push(
          ...sitemapMissing({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
        all.push(
          ...robotsBlocksGooglebot({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
        all.push(
          ...badHttpStatus({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
        all.push(
          ...canonicalMismatch({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
        // Slice 4.5.C.α₂ — Tier-2 sensitive indexability
        // predicates. Both emit at `confidence: "low"` so
        // `applyQueueRules` routes their candidates to
        // `diagnostic_only` (NOT the customer queue). Same
        // batch-map / indexability_unavailable soft-fail
        // contract as the Tier-1 predicates.
        all.push(
          ...noindexOnIndexablePage({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
        all.push(
          ...robotsBlocksAiBots({
            tenantId,
            snapshot,
            indexability,
            businessConfig,
          }),
        );
      }
    }
  }

  // ── R19 / N24 + N22 + N21 (2026-07-03): content-lifecycle engine ──
  // Runs LAST among the deterministic triggers so its cross-source cooldown
  // dedupe sees every merge / technical card the earlier triggers already
  // claimed. Three engines, one fail-soft block:
  //   • N24 content-lifecycle (prune / merge-and-redirect / retire) - one card
  //     per page, merge_pages action (generatorActive:false + no eligibility +
  //     confidence low = triple-locked to diagnostic_only, never auto-executed).
  //   • N22 JS-shell dual-fetch heuristic - a demand page whose source HTML is
  //     nearly empty behind a client app (content is JS-injected).
  //   • N21 demand-first technical crawl - noindex / broken status / canonical
  //     elsewhere on a page Google actually sends searches to.
  // All pure over ALREADY-LOADED signals ($0). Empty inputs -> byte-identical.
  try {
    const nowIso = new Date().toISOString();
    // Reuse the SAME authority snapshot the internal-authority family already
    // built this run (no second link-graph read) + the per-request-cached
    // ownership registry the N2 choke points already loaded.
    const lifecycleRegistry = await loadOwnershipRegistryForTenant(tenantId, {
      gscSignals,
      ownDomain: businessConfig.domain ?? null,
    }).catch(() => null);

    const assembled = assembleLifecycleInputs({
      snapshots,
      gscSignals,
      gscDecaySignals,
      authorities: sharedAuthoritySnapshot?.pages ?? [],
      lastmodByUrl,
      registry: lifecycleRegistry,
    });

    // The (tenant, action, url) triples the existing merge + technical triggers
    // already claimed this run - the cross-source dedup base. A lifecycle merge
    // card reuses merge_pages (same key as thin_content_overlap /
    // intent_cluster_conflict); the demand-first technical cards reuse
    // fix_status_code / fix_noindex / fix_canonical (same key as the page-type
    // triggers). Anything already claimed defers; this engine adds only the
    // pages those triggers skipped.
    const claimedCooldowns = new Set(all.map((r) => r.cooldown_key));

    // N24: content-lifecycle verdicts -> capped, demand-ranked cards.
    const lifecycleResult = classifyContentLifecycle({
      pages: assembled.lifecyclePages,
      mergeConflicts: assembled.mergeConflicts,
      now: new Date(),
    });
    const lifecycleRows = contentLifecycle({
      tenantId,
      verdicts: lifecycleResult.verdicts,
      impressionsByUrl: assembled.impressionsByUrl,
      signalAt: nowIso,
    }).filter((r) => !claimedCooldowns.has(r.cooldown_key));
    for (const r of lifecycleRows) claimedCooldowns.add(r.cooldown_key);
    all.push(...lifecycleRows);

    // N22: JS-shell findings -> capped, demand-ranked cards.
    const jsShellFindings = assembled.jsShellPages
      .map((p) => classifyJsShell(p))
      .filter((f): f is NonNullable<typeof f> => f != null);
    const jsShellRows = jsShellContent({
      tenantId,
      findings: jsShellFindings,
      impressionsByUrl: assembled.impressionsByUrl,
      signalAt: nowIso,
    }).filter((r) => !claimedCooldowns.has(r.cooldown_key));
    for (const r of jsShellRows) claimedCooldowns.add(r.cooldown_key);
    all.push(...jsShellRows);

    // N21: demand-first technical findings -> capped, demand-ranked cards.
    const technicalFindings = assembled.technicalPages.flatMap((p) =>
      classifyTechnicalDemand(p),
    );
    const technicalRows = technicalDemand({
      tenantId,
      findings: technicalFindings,
      impressionsByUrl: assembled.impressionsByUrl,
      signalAt: nowIso,
    }).filter((r) => !claimedCooldowns.has(r.cooldown_key));
    for (const r of technicalRows) claimedCooldowns.add(r.cooldown_key);
    all.push(...technicalRows);
  } catch (err) {
    console.error(
      `[trigger-loader] content-lifecycle family failed for ${tenantId} (lifecycle / js_shell / technical_demand skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── P11 (2026-07-03): technical-SEO pack ──────────────────────────────────
  // Runs after the R19 family so its cross-source cooldown dedupe sees every
  // status / link card the earlier triggers already claimed. Three engines, one
  // fail-soft block:
  //   1. Dead-URL-with-demand recovery - a page Google still sends searches to
  //      that now 404/410s or that Google's index has dropped. fix_status_code,
  //      confidence medium (customer-queue eligible). Names the recovery play.
  //   2. Broken internal links - a page linking at targets that are dead. Owned
  //      targets' own snapshot statuses give liveness at $0; an optional polite +
  //      capped + fail-soft live pass resolves a few external / unsnapshotted
  //      targets. add_internal_link, one card per source page.
  //   3. Redirect-chain + soft-404 hygiene - multi-hop chains (from the live
  //      pass) + soft-404s (from Google's own coverage verdict). fix_status_code.
  // Cross-source cooldown dedupe: dead-URL runs FIRST so it wins the recovery
  // framing over the R19 bad_status card; redirect-hygiene defers to whatever a
  // status trigger already claimed. Empty inputs -> byte-identical.
  try {
    const nowIso = new Date().toISOString();
    // Read the ALREADY-SYNCED URL-inspection coverage verdicts ($0, never the
    // URL Inspection API). Fail-soft to empty -> the coverage-verdict legs
    // abstain (dead-URL still fires off snapshot 404s).
    const inspectionByUrl = await loadInspectionsForTenant(tenantId).catch(
      () => new Map(),
    );

    const tech = assembleTechnicalInputs({
      snapshots,
      gscSignals,
      inspectionByUrl,
    });

    // Cross-source dedup base: the (tenant, action, url) triples earlier triggers
    // already claimed this run.
    const claimedTech = new Set(all.map((r) => r.cooldown_key));

    // (1) Dead-URL-with-demand recovery.
    const deadFindings = tech.deadUrlPages
      .map((p) => classifyDeadUrl(p))
      .filter((f): f is NonNullable<typeof f> => f != null);
    const deadRows = deadUrlRecovery({
      tenantId,
      findings: deadFindings,
      signalAt: nowIso,
    }).filter((r) => !claimedTech.has(r.cooldown_key));
    for (const r of deadRows) claimedTech.add(r.cooldown_key);
    all.push(...deadRows);

    // Optional live-liveness pass (broken links + redirect chains). Probe (a) the
    // external / not-yet-snapshotted link targets we have NO owned status for and
    // (b) the demand-carrying owned pages whose snapshot is a redirect (to resolve
    // the chain length). Capped + polite + fail-soft. On Vercel a network fetch is
    // fine here (generation path, not the customer render). A failure leaves those
    // targets "unknown" (never guessed dead) and redirect chains unresolved.
    const probeTargets = [
      ...new Set([...tech.unknownLinkTargets, ...tech.redirectingOwnedUrls]),
    ];
    const liveResults =
      probeTargets.length > 0
        ? await probeLivenessBatch(probeTargets).catch(
            () => new Map<string, import("@/domains/technical-seo/link-liveness").LivenessResult>(),
          )
        : new Map<string, import("@/domains/technical-seo/link-liveness").LivenessResult>();

    // (2) Broken internal links. livenessOf prefers an owned snapshot's own
    // status (statusByUrl), then the live probe, then "unknown".
    const livenessOf = (target: string): TargetLiveness => {
      const owned = tech.statusByUrl.get(target);
      if (owned != null && owned !== 0) return statusToLiveness(owned);
      return liveResults.get(target)?.liveness ?? "unknown";
    };
    const brokenFindings = tech.brokenLinkPages
      .map((p) => classifyBrokenLinks(p, livenessOf))
      .filter((f): f is NonNullable<typeof f> => f != null);
    const brokenRows = brokenLinks({
      tenantId,
      findings: brokenFindings,
      hasLinkData: tech.brokenLinkPages.length > 0,
      signalAt: nowIso,
    }).filter((r) => !claimedTech.has(r.cooldown_key));
    for (const r of brokenRows) claimedTech.add(r.cooldown_key);
    all.push(...brokenRows);

    // (3) Redirect-chain + soft-404 hygiene. The redirect chain for an owned page
    // comes from probing the page's OWN URL (a redirect-status snapshot means the
    // page itself redirects); soft-404 comes from Google's coverage verdict with
    // no fetch at all. Attach any probed chain for the page's own URL.
    const redirectPagesWithChains = tech.redirectPages.map((p) => {
      const probed = liveResults.get(p.url);
      return probed && probed.redirectChain.length > 0
        ? { ...p, redirectChain: probed.redirectChain }
        : p;
    });
    const redirectFindings = redirectPagesWithChains.flatMap((p) =>
      classifyRedirectHygiene(p),
    );
    const redirectRows = redirectHygiene({
      tenantId,
      findings: redirectFindings,
      impressionsByUrl: tech.impressionsByUrl,
      signalAt: nowIso,
    }).filter((r) => !claimedTech.has(r.cooldown_key));
    for (const r of redirectRows) claimedTech.add(r.cooldown_key);
    all.push(...redirectRows);
  } catch (err) {
    console.error(
      `[trigger-loader] technical-seo pack failed for ${tenantId} (dead_url_recovery / broken_internal_links / redirect_hygiene skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── P24 (2026-07-03): image-SEO lane (alt-text gap) ───────────────────────
  // Runs after the technical-SEO pack so its cross-source cooldown dedupe sees
  // every card already claimed this run. Reads the `images` field the scanner
  // now captures on each snapshot ($0, no new crawl), joins the GSC demand
  // already loaded, and per page composes the alt-audit coverage math with the
  // deterministic alt-text drafter. Only EXISTING pictures are touched (never
  // proposes a NEW image, so N5's gate is not involved). Fail-soft as one
  // isolated block. Empty inputs (old snapshots with no images, all-alt-present
  // pages, no-demand pages) -> byte-identical to before this lane existed.
  try {
    const nowIso = new Date().toISOString();
    const claimedAlt = new Set(all.map((r) => r.cooldown_key));
    const altFindings = snapshots
      .map((s) => {
        const sig = gscSignals.get(canonicalizeCitationUrl(s.url) ?? s.url);
        return classifyAltTextGap({
          url: s.url,
          images: s.images,
          h1: s.h1,
          pageTitle: s.title,
          topQuery: sig?.topQueries?.[0]?.query ?? null,
          impressions90d: sig?.impressions90d ?? 0,
        });
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
    const altRows = addImageAltText({
      tenantId,
      findings: altFindings,
      signalAt: nowIso,
    }).filter((r) => !claimedAlt.has(r.cooldown_key));
    all.push(...altRows);
  } catch (err) {
    console.error(
      `[trigger-loader] image-seo alt-text lane failed for ${tenantId} (add_image_alt_text skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── P10 (2026-07-03): entity + author (E-E-A-T) pack ──────────────────────
  // Runs after the image-SEO lane so its cross-source cooldown dedupe sees every
  // schema card already claimed this run. Three engines, one fail-soft block,
  // all pure over ALREADY-LOADED signals ($0):
  //   1. entity_link_gap - a content page names a Knowledge-Graph entity Beacon
  //      already resolved to a Wikidata QID (the SHIPPED biography-QID cache) but
  //      does not link it. add_schema, one card per page, ready-to-paste sameAs.
  //   2. author_byline_gap - a guide-shaped content page with no named author.
  //      add_answer_block DIRECTIVE (Beacon never invents a person's name).
  //   3. brand_presence_gap - a connector-free, cold-start-safe check that the
  //      site root establishes the brand as an entity (Organization + sameAs).
  //      At most one add_schema card for the whole tenant, site-root anchored.
  // The entity/brand cards reuse add_schema, whose cooldown key collides with
  // the generic missing_schema / invalid_schema cards on the SAME URL. Rather
  // than blindly defer, the P10 schema cards are the stronger, customer-facing
  // framing of "add schema here" (medium confidence, names the exact people and
  // things the page is about), so they SUPERSEDE a prior LOW-confidence
  // (diagnostic-only) generic schema card on the same cooldown key, while still
  // deferring to a medium/high schema card already queued for a real edit.
  // Empty inputs -> byte-identical to before this family existed.
  try {
    const nowIso = new Date().toISOString();
    const eeat = await loadEeatSignalsForTenant({
      tenantId,
      snapshots,
      businessConfig,
    });

    // A cooldown key is "claimed hard" only by a medium/high card; a prior
    // low-confidence card is superseded (removed) when a P10 schema card lands
    // on the same key.
    const hardClaimed = new Set(
      all.filter((r) => r.confidence !== "low").map((r) => r.cooldown_key),
    );
    const supersededKeys = new Set<string>();

    const schemaRows = [
      ...entityLinkGap({ tenantId, gaps: eeat.entityLinkGaps, signalAt: nowIso }),
      ...brandPresenceGap({ tenantId, gap: eeat.brandPresenceGap, signalAt: nowIso }),
    ].filter((r) => !hardClaimed.has(r.cooldown_key));
    for (const r of schemaRows) {
      hardClaimed.add(r.cooldown_key);
      supersededKeys.add(r.cooldown_key);
    }

    // Author byline uses add_answer_block, whose COARSE cooldown key (tenant +
    // action + url) collides with answer-block-readiness on the same page even
    // though they are distinct intents (answer the question vs credit the
    // author). Dedup by the FINER dedupe_key (which includes the "Author trust"
    // topic) so an author-trust directive can coexist with an answer-block
    // directive on one page, while a true duplicate author card is still
    // dropped by the final dedupeByKey pass.
    const authorClaimed = new Set(all.map((r) => r.dedupe_key));
    const authorRows = authorBylineGap({
      tenantId,
      gaps: eeat.authorGaps,
      signalAt: nowIso,
    }).filter((r) => !authorClaimed.has(r.dedupe_key));

    // Drop any prior LOW-confidence schema card the P10 schema cards supersede,
    // then append the stronger P10 cards + the author directives.
    if (supersededKeys.size > 0) {
      for (let i = all.length - 1; i >= 0; i--) {
        const r = all[i]!;
        if (
          r.confidence === "low" &&
          r.action_type === "add_schema" &&
          supersededKeys.has(r.cooldown_key)
        ) {
          all.splice(i, 1);
        }
      }
    }
    all.push(...schemaRows, ...authorRows);
  } catch (err) {
    console.error(
      `[trigger-loader] entity + author pack failed for ${tenantId} (entity_link_gap / author_byline_gap / brand_presence_gap skip): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── RANK-4 (2026-07-06): AI-crawler-skip Move ─────────────────────────────
  // Runs after the link families so its cross-source cooldown dedupe sees every
  // add_internal_link card the earlier triggers (buried_page, orphan_page,
  // internal_link_opportunity, broken_links) already claimed this run. The
  // loader pre-reads the ALREADY-SYNCED Profound AI-crawler feed
  // (profound_bot_rows, via the shared react.cache bot loader - no new read) +
  // the GSC demand already loaded, and returns the high-demand pages AI crawlers
  // SKIP while crawling the rest of the site. A gap is only ever produced when
  // the crawler feed is REPORTING (fail closed - "AI skips this" is provable
  // only once we can see AI crawling at all), so a tenant with no Agent
  // Analytics data emits nothing. Pure predicate over the pre-assembled gaps;
  // NEVER a live Profound / GSC call here. Empty inputs -> byte-identical.
  try {
    const skipGaps = await loadCrawlerSkipGapsForTenant(tenantId);
    if (skipGaps.length > 0) {
      const claimedLinkKeys = new Set(all.map((r) => r.cooldown_key));
      const crawlerRows = aiCrawlerSkip({
        tenantId,
        gaps: skipGaps,
        signalAt: new Date().toISOString(),
      }).filter((r) => !claimedLinkKeys.has(r.cooldown_key));
      all.push(...crawlerRows);
    }
  } catch (err) {
    console.error(
      `[trigger-loader] ai-crawler-skip failed for ${tenantId} (ai_crawler_skip skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── demand-graph engine source (2026-06-24, BEACON_DEMAND_GRAPH_RECS) ──
  // OFF by default — TENANT-SCOPED: set BEACON_DEMAND_GRAPH_RECS=tenant-iranopedia
  // to enable Iranopedia ONLY (="true" = all tenants; unset/"false" = none). The
  // operator's validated call; flipping the engine into the live customer queue
  // is a customer-surface change. When on, the Rank-&-Revenue engine's ranked Moves
  // (answer_block / edit / fix) flow into the SAME queue as the deterministic
  // predicates — the plan's intended convergence ("output stays
  // RecommendationCandidateRow, consumed by this loader"). Routed by
  // applyQueueRules + cross-source deduped (below). PERF: this loader runs during
  // GENERATION (promotion-writer) + the operator diagnostic, NOT on the customer
  // render path. Fail-soft: a load error never breaks the pipeline.
  if (isDemandGraphEnabledForTenant(tenantId)) {
    try {
      const { graph } = await loadDemandGraphForTenant(tenantId);
      const packetList: EvidencePacket[] = await loadChangePacksForTenant(tenantId, { limit: 25 })
        .then((r) => r.packets)
        .catch(() => []);
      const packetsByKey = new Map(packetList.map((p) => [p.move.key, p]));
      const engineRows = demandGraphToCandidateRows({
        tenantId,
        graph,
        packetsByKey,
        limit: 25,
        nowIso: new Date().toISOString(),
      });
      // Cross-source dedup: never duplicate a (tenant, action, url) an existing
      // predicate already covers (cooldown_key is exactly that triple). The
      // engine ADDS its UNIQUE Moves (AI-citation answer-blocks, friction fixes
      // the predicates don't produce); overlapping edits defer to the predicate.
      const existingCooldownKeys = new Set(all.map((r) => r.cooldown_key));
      all.push(...engineRows.filter((r) => !existingCooldownKeys.has(r.cooldown_key)));
    } catch {
      // demand-graph load failure must never break the live recommendation pipeline
    }
  }

  const { candidates, diagnostic_only } = applyQueueRules(all);
  const dedupedC = dedupeByKey(candidates);
  const dedupedD = dedupeByKey(diagnostic_only);

  return {
    status: indexabilityFailed ? "indexability_unavailable" : "ok",
    candidates: dedupedC,
    diagnostic_only: dedupedD,
    meta: {
      tenant_id: tenantId,
      snapshot_count: snapshots.length,
      predicates_run: PREDICATE_COUNT,
      candidate_count: dedupedC.length,
      diagnostic_only_count: dedupedD.length,
    },
  };
}
