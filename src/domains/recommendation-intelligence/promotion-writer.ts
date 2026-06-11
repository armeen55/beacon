import "server-only";

/**
 * 2026-05-20 — Slice 4.5.D.α₁b — promotion writer + idempotent
 * persistence.
 *
 * First slice that actually crosses the customer-queue write
 * boundary. The α₀a pure decision engine + α₀b operator preview
 * + α₁a mapper all stayed write-free. THIS module is the single
 * allowlisted importer of `@/domains/recommendations/recommended-
 * edits-persistence` — pinned by the evolved
 * `recommendation-intelligence-no-queue-write` invariant.
 *
 * Default-safe contract
 * ---------------------
 * `promoteEligibleCandidates({ tenantId })` defaults to `dryRun:
 * true`. Live-write requires explicit `dryRun: false` — the
 * future α₁c UI form action will pass it explicitly on the
 * operator's button click.
 *
 * Recompute, don't trust
 * ----------------------
 * The writer ALWAYS recomputes `selectPromotableCandidates` at
 * write time. It does NOT consume the α₀b Promotion Preview
 * cache (which is a server-render snapshot at request time —
 * potentially stale when the operator clicks the button).
 *
 * Idempotency
 * -----------
 * Layered:
 *   1. α₁a mapper produces deterministic `rec_id =
 *      "promotion-${cooldown_key.slice(0, 16)}"`.
 *   2. Local `persistRecommendedEditsLocal` dedupes via
 *      `Map<row.id, row>`.
 *   3. Supabase `syncRecommendedEdits` upserts via unique index
 *      `(tenant_id, rec_id, action_type, target_element_key)`
 *      with NULLS NOT DISTINCT.
 *
 * Error handling
 * --------------
 * Mirrors `markRecommendedEditsAccepted` (lines 360–368):
 *   • Local write throws → propagate. Source-of-truth failure.
 *   • Supabase sync throws → catch + log.warn + carry
 *     `sync_warning` in the result. Operator can retry; next
 *     run picks up the local rows and re-syncs.
 *
 * No-queue-write allowlist contract
 * ---------------------------------
 * THIS FILE is the ONLY file under
 * `src/domains/recommendation-intelligence/**` permitted to
 * import `recommended-edits-persistence`. The invariant pins
 * this explicitly. Adding another importer fails CI.
 * `runProviderAndPersist` STAYS GLOBALLY FORBIDDEN — the writer
 * uses `persistRecommendedEditsLocal` + `syncRecommendedEdits`
 * directly, NOT the LLM-orchestrator path.
 */

import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import { persistRecommendedEditsLocal } from "@/domains/recommendations/recommended-edits-persistence";
import { getRecommendationResponses } from "@/domains/product/recommendation-response-store";

import {
  classifyPageType,
  type PageType,
} from "@/domains/recommendation-intelligence/page-classifier";
import {
  enrichPromotionRow,
  type DraftEnrichmentContext,
} from "@/domains/recommendation-intelligence/draft-enrichment";
import { loadTriggerCandidatesForTenant } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import { selectPromotableCandidates } from "@/domains/recommendation-intelligence/promote-to-queue";
import {
  promotionResultToRecommendedEditRow,
  type DeterministicPromotionEditRow,
} from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import type { PageSnapshot } from "@/domains/pages/types";

export type PromoteEligibleCandidatesInput = {
  tenantId: string;
  /** Default `true`. Live-write requires explicit `false`. */
  dryRun?: boolean;
  /** For test injection. Defaults to `new Date()`. */
  now?: Date;
};

export type PromoteEligibleCandidatesResult = {
  dryRun: boolean;
  /** Total trigger candidates evaluated (main + diagnostic_only). */
  candidate_count: number;
  /** Rows where `selectPromotableCandidates` returned `eligible: true`. */
  eligible_count: number;
  /** Rows the mapper produced (eligible AND passed all 5 mapper rejections). */
  promoted_count: number;
  /** Rows the mapper REJECTED out of the eligible set
   *  (`eligible_count - promoted_count`). Defense-in-depth catches. */
  skipped_count: number;
  /** Always returned — caller can inspect what WOULD or DID get written. */
  mapped_rows: DeterministicPromotionEditRow[];
  /** Populated when local write succeeded but Supabase sync failed.
   *  Local rows are persisted; sync will retry on the next run. */
  sync_warning: string | null;
};

export async function promoteEligibleCandidates(
  input: PromoteEligibleCandidatesInput,
): Promise<PromoteEligibleCandidatesResult> {
  const dryRun = input.dryRun !== false; // default true
  const now = input.now ?? new Date();

  // Stage 1: load all recompute inputs in parallel. None of these
  // are writes — the writer recomputes from current state.
  const [
    triggerResult,
    recommendedEdits,
    recommendationResponses,
    pageSnapshots,
  ] = await Promise.all([
    loadTriggerCandidatesForTenant({ tenantId: input.tenantId }),
    getRepository().forTenant(input.tenantId).getRecommendedEdits(),
    getRecommendationResponses(),
    getRepository().forTenant(input.tenantId).getPageSnapshots(),
  ]);

  // Draft enrichment context (P0 wall 3, 2026-06-10): latest snapshot
  // per URL so the enricher can compose exact proposed copy / fix
  // directives instead of empty "go look at this page" cards.
  const snapshotByUrl = new Map<string, PageSnapshot>();
  for (const snap of pageSnapshots) {
    const existing = snapshotByUrl.get(snap.url);
    if (!existing || snap.fetched_at > existing.fetched_at) {
      snapshotByUrl.set(snap.url, snap);
    }
  }
  const enrichmentCtx: DraftEnrichmentContext = { snapshotByUrl };

  const businessConfig = getBusinessConfig(input.tenantId);
  const triggerCandidates = [
    ...triggerResult.candidates,
    ...triggerResult.diagnostic_only,
  ];

  // Build pageTypeByUrl from candidate target_urls — same inline
  // pattern as the α₀b diagnostic page.
  const pageTypeByUrl = new Map<string, PageType>();
  for (const c of triggerCandidates) {
    if (c.target_url == null) continue;
    if (pageTypeByUrl.has(c.target_url)) continue;
    pageTypeByUrl.set(c.target_url, classifyPageType(c.target_url, businessConfig));
  }

  // Stage 2: recompute the promotion engine. Do NOT trust any
  // preview cache.
  const promotion = selectPromotableCandidates({
    tenantId: input.tenantId,
    triggerCandidates,
    recommendedEdits,
    recommendationResponses,
    pageTypeByUrl,
    now,
  });

  // Stage 3: map eligible results through α₁a, then fill deterministic
  // drafts (P0 wall 3). Enrichment is pure, never changes the row id /
  // element-key identity, and leaves the row untouched when a correct
  // draft can't be computed from the snapshot.
  const eligibleResults = promotion.filter((r) => r.eligible);
  const mapped_rows: DeterministicPromotionEditRow[] = [];
  for (const result of eligibleResults) {
    const row = promotionResultToRecommendedEditRow(result, now);
    if (row != null) {
      mapped_rows.push(enrichPromotionRow(row, result.candidate, enrichmentCtx));
    }
  }

  const candidate_count = triggerCandidates.length;
  const eligible_count = eligibleResults.length;
  const promoted_count = mapped_rows.length;
  const skipped_count = eligible_count - promoted_count;

  const baseResult: PromoteEligibleCandidatesResult = {
    dryRun,
    candidate_count,
    eligible_count,
    promoted_count,
    skipped_count,
    mapped_rows,
    sync_warning: null,
  };

  // Stage 4: dry-run short-circuit. Return without persistence.
  if (dryRun) return baseResult;

  // Stage 5: live-write. Local first (fail-loud), then Supabase
  // sync (best-effort with log.warn). Pattern mirrors
  // `markRecommendedEditsAccepted` at lines 360–368.
  if (mapped_rows.length === 0) return baseResult;

  await persistRecommendedEditsLocal(mapped_rows);

  try {
    await syncRecommendedEdits(mapped_rows, input.tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[promoteEligibleCandidates] dual-write failed", {
      tenantId: input.tenantId,
      count: mapped_rows.length,
      error: msg,
    });
    return { ...baseResult, sync_warning: msg.slice(0, 500) };
  }

  return baseResult;
}
