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
import { getRepository } from "@/lib/persistence/repositories";

import { applyQueueRules } from "./emitter/apply-queue-rules";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";
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
import { semrushStrikingDistance } from "./triggers/semrush-striking-distance";
import { semrushCannibalization } from "./triggers/semrush-cannibalization";
import { semrushKeywordGap } from "./triggers/semrush-keyword-gap";
import {
  detectCannibalization,
  loadSemrushCannibalRowsForTenant,
  loadSemrushKeywordGapsForTenant,
  loadSemrushPageSignalsForTenant,
  type SemrushPageSignal,
} from "./semrush-page-signals";
import {
  loadGscDecaySignalsForTenant,
  loadGscPageSignalsForTenant,
  type GscDecaySignal,
  type GscPageSignal,
} from "./gsc-page-signals";
import { invalidSchema } from "./triggers/invalid-schema";
import { missingSchema } from "./triggers/missing-schema";
import { missingTitle } from "./triggers/missing-title";
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

const PREDICATE_COUNT = 16;

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

  // Insight Graph slice 2 (2026-06-12): pre-load SEMrush per-page
  // keyword signals. Soft-empty when no key / no rows.
  let semrushSignals: Map<string, SemrushPageSignal> = new Map();
  try {
    semrushSignals = await loadSemrushPageSignalsForTenant(tenantId);
  } catch (err) {
    console.error(
      `[trigger-loader] semrush page-signals load failed for ${tenantId} (semrush predicates skip): ${err instanceof Error ? err.message : String(err)}`,
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
  // Cannibalization slice (2026-06-12): cross-page, runs once before
  // the per-snapshot loop (the duplicate-title pattern). Soft-empty
  // until SEMrush rows exist.
  try {
    const cannibalRows = await loadSemrushCannibalRowsForTenant(tenantId);
    if (cannibalRows.length > 0) {
      all.push(
        ...semrushCannibalization({
          tenantId,
          cases: detectCannibalization(cannibalRows),
          signalAt: new Date().toISOString(),
        }),
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] semrush cannibalization load failed for ${tenantId} (predicate skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Keyword-gap slice (2026-06-12): "Missing" keywords -> new-content
  // briefs (operator-review). Soft-empty until the weekly gap sync
  // has rows.
  try {
    const gaps = await loadSemrushKeywordGapsForTenant(tenantId);
    const rootDomain = businessConfig.domain
      ?.trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    if (gaps.length > 0 && rootDomain) {
      all.push(
        ...semrushKeywordGap({
          tenantId,
          gaps,
          siteRootUrl: "https://" + rootDomain + "/",
          signalAt: new Date().toISOString(),
          // Originality guard (audit #13): topical duplicates flip the
          // play from create_page to expanding the matched page.
          existingPages: snapshots.map((s) => ({
            url: s.url,
            title: s.title,
            h1: s.h1,
          })),
        }),
      );
    }
  } catch (err) {
    console.error(
      `[trigger-loader] semrush keyword-gap load failed for ${tenantId} (predicate skips): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const snapshot of snapshots) {
    all.push(...missingTitle({ tenantId, snapshot }));
    all.push(...missingMeta({ tenantId, snapshot }));
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
    all.push(
      ...gscDecay({
        tenantId,
        snapshot,
        signal: gscDecaySignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
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
    // Insight Graph slice 2 (2026-06-12) — striking-distance keywords.
    all.push(
      ...semrushStrikingDistance({
        tenantId,
        snapshot,
        signal: semrushSignals.get(
          canonicalizeCitationUrl(snapshot.url) ?? snapshot.url,
        ),
      }),
    );

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
