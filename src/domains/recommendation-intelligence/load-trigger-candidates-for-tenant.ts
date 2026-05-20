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

import { getBusinessConfig } from "@/lib/business-config";
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
import { missingH1 } from "./triggers/missing-h1";
import { missingMeta } from "./triggers/missing-meta";
import { missingSchema } from "./triggers/missing-schema";
import { missingTitle } from "./triggers/missing-title";
import { noindexOnIndexablePage } from "./triggers/noindex-on-indexable-page";
import { orphanPage } from "./triggers/orphan-page";
import { robotsBlocksAiBots } from "./triggers/robots-blocks-ai-bots";
import { robotsBlocksGooglebot } from "./triggers/robots-blocks-googlebot";
import { sitemapMissing } from "./triggers/sitemap-missing";
import { titleH1Mismatch } from "./triggers/title-h1-mismatch";
import { weakH1 } from "./triggers/weak-h1";

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

const PREDICATE_COUNT = 15;

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
    const all = await repo.getPageSnapshots();
    snapshots = Array.isArray(all) ? all.filter((s) => s != null) : [];
  } catch {
    return emptyResult("snapshots_unavailable", tenantId, 0);
  }

  // α₁: `weak-h1` requires the resolved BusinessConfig. Soft-fail
  // the whole loader to `config_unavailable` rather than partial-
  // running predicates with an unknown config shape.
  let businessConfig: BusinessConfig;
  try {
    businessConfig = getBusinessConfig();
  } catch {
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
  } catch {
    indexabilityFailed = true;
  }

  const all: RecommendationCandidateRow[] = [];
  // Slice 4.5.B.α₂ — cross-snapshot duplicate predicates run ONCE
  // over the full tenant-filtered list, BEFORE the per-snapshot
  // loop. They aggregate across pages and emit per-occurrence-past-
  // anchor candidates; running them inside the per-snapshot loop
  // would re-aggregate redundantly.
  all.push(...duplicateTitle({ tenantId, snapshots }));
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
  for (const snapshot of snapshots) {
    all.push(...missingTitle({ tenantId, snapshot }));
    all.push(...missingMeta({ tenantId, snapshot }));
    all.push(...missingH1({ tenantId, snapshot }));
    all.push(...weakH1({ tenantId, snapshot, businessConfig }));
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
