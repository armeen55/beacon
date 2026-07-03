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
import { sovDropAlert } from "./triggers/sov-drop-alert";
import { displacementCheckAlert } from "./triggers/displacement-check-alert";
import { citationLossAlert } from "./triggers/citation-loss-alert";
import { connectorFailureStreak } from "./triggers/connector-failure-streak";
import { intentClusterConflict } from "./triggers/intent-cluster-conflict";
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
import { featureStealHistoryRows } from "@/domains/serp/serp-history";
import { loadStealBriefsForTenant } from "@/domains/serp/serp-steal-lane";
import { loadEarlyBodyTextForUrls } from "./early-body-text";
import { noindexOnIndexablePage } from "./triggers/noindex-on-indexable-page";
import { orphanPage } from "./triggers/orphan-page";
import { internalLinkOpportunity } from "./triggers/internal-link-opportunity";
import { uncitedContent } from "./triggers/uncited-content";
import { robotsBlocksAiBots } from "./triggers/robots-blocks-ai-bots";
import { robotsBlocksGooglebot } from "./triggers/robots-blocks-googlebot";
import { sitemapMissing } from "./triggers/sitemap-missing";
import { titleH1Mismatch } from "./triggers/title-h1-mismatch";
import { weakH1 } from "./triggers/weak-h1";
import { weakH2 } from "./triggers/weak-h2";

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

const PREDICATE_COUNT = 18;

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
