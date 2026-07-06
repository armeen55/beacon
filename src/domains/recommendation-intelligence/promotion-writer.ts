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

import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";
import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import {
  persistRecommendedEditsLocal,
  dropLifecycleLockedRewrites,
} from "@/domains/recommendations/recommended-edits-persistence";
import { validateDeterministicDraftSafety } from "@/domains/recommendations/specific-edit-validator";
import { getRecommendationResponses } from "@/domains/product/recommendation-response-store";

import {
  classifyPageType,
  type PageType,
} from "@/domains/recommendation-intelligence/page-classifier";
import {
  applyEditFeedbackToRow,
  computeEditFeedback,
} from "@/domains/recommendation-intelligence/edit-feedback";
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

/**
 * SAFETY #273 (2026-06-14) — public-copy safety gate at the deterministic
 * draft → customer-approvable seam.
 *
 * Runs `validateDeterministicDraftSafety` on the enriched row's customer-
 * facing copy (`proposed_text` + `display_label`). When the draft is safe,
 * the row is returned UNCHANGED. When it trips a public-copy rule (a brand
 * claim the tenant hasn't authorized, a placeholder phrase, a leading
 * superlative, an em dash, a bare brand short form), the function ABSTAINS:
 * it strips the draft fields back to the safe pre-enrichment state — a "go
 * look at this page" card — so an UNSAFE `proposed_text` is never surfaced
 * as publishable. The row itself survives (the operator still sees the
 * issue / page), only the unsafe draft is held back.
 *
 * SAFETY #273 follow-up (2026-06-15): the action type is threaded through so
 * the gate applies the PUBLISHED-PROSE style rules (em dash / leading
 * superlative / bare brand short form) ONLY to publishable-copy drafts
 * (edit_title / edit_meta / change_h1). DIRECTIVE drafts (fix_*, add_schema,
 * add_proof_section, add_answer_block, add_internal_link, fix_page_experience)
 * carry an operator INSTRUCTION in `proposed_text` — never published verbatim
 * — so those style rules don't apply; only the correctness gates (placeholder,
 * unsupported brand claim) run for them.
 *
 * Rows with no `proposed_text` (enrichment already abstained, or the action
 * type has no deterministic draft) pass through untouched — there is no
 * customer-visible draft to validate.
 *
 * Pure except for the log.warn breadcrumb. Never throws — a validation
 * failure means "don't offer this draft", not "break the queue".
 */
function holdUnsafeDraft(
  row: DeterministicPromotionEditRow,
  tenantId: string,
): DeterministicPromotionEditRow {
  if (row.proposed_text == null && row.display_label == null) return row;
  const verdict = validateDeterministicDraftSafety({
    tenantId,
    proposedText: row.proposed_text,
    displayLabel: row.display_label,
    // SAFETY #273 follow-up (2026-06-15): pass the action type so the gate
    // skips the PUBLISHED-PROSE style rules (em dash etc.) for DIRECTIVE
    // drafts — their proposed_text is an operator instruction, never copy
    // published to the live page. Without this, every answer-block / sources
    // / clarity / schema / robots directive (whose instruction text uses an
    // em dash) was blanked to a content-free "go look at this page" card on
    // every re-promote.
    actionType: row.action_type,
  });
  if (verdict.ok) return row;
  log.warn("[promoteEligibleCandidates] held unsafe deterministic draft", {
    tenantId,
    rowId: row.id,
    actionType: row.action_type,
    field: verdict.field,
    reason: verdict.reason,
  });
  // Abstain: revert the enriched draft to the safe pre-enrichment shape.
  // The row stays in the queue as a "go look at this page" directive; the
  // unsafe proposed_text / display_label is never surfaced as publishable.
  return {
    ...row,
    display_label: null,
    current_text: null,
    proposed_text: null,
    expected_impact: null,
    measurement_plan: null,
  };
}

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
    // audit #12 (2026-06-14): this builds snapshotByUrl for draft
    // enrichment — it must cover EVERY page, not the 500-most-recent the
    // egress-pinned web reader caps at, or large-tenant cards past the cap
    // get empty "go look at this page" directives. Use the un-capped
    // generation read (fallback keeps file/test backends working).
    (() => {
      const repo = getRepository().forTenant(input.tenantId);
      return repo.getAllPageSnapshotsForGeneration
        ? repo.getAllPageSnapshotsForGeneration()
        : repo.getPageSnapshots();
    })(),
  ]);

  // Latest snapshot per URL (P0 wall 3, 2026-06-10) — dedupe by
  // fetched_at so the enricher composes drafts from current page facts.
  const snapshotByUrl = new Map<string, PageSnapshot>();
  for (const snap of pageSnapshots) {
    const existing = snapshotByUrl.get(snap.url);
    if (!existing || snap.fetched_at > existing.fetched_at) {
      snapshotByUrl.set(snap.url, snap);
    }
  }

  // CRITICAL (audit #2, 2026-06-14): hydrate from the durable per-tenant
  // Supabase row so page-classification at promotion sees the tenant's real
  // contentSiteMode/urlPatterns on Vercel (where the sync chain finds no
  // .data files and returns the placeholder → all pages "other" → Gate 9
  // suppresses every content-edit card). Falls back to the sync config when
  // there's no Supabase row.
  const businessConfig =
    (await hydrateBusinessConfigFromSupabase(input.tenantId)) ??
    getBusinessConfig(input.tenantId);

  // Draft enrichment context (P0 wall 3, 2026-06-10): latest snapshot per
  // URL so the enricher can compose exact proposed copy / fix directives.
  // UX_TEARDOWN #252: thread the tenant's REAL configured business name so
  // schema drafts (author/publisher + breadcrumb root) and title/h1 brand
  // suffixes assert the tenant's actual Organization, not a guessed
  // title-tail. Empty/placeholder name → fail-soft to inference (the
  // enricher's resolveBrand handles the precedence + fallback).
  // RANK-5 (2026-07-06) - LOCAL SEO. Thread the tenant's configured local
  // business facts so an add_schema card on a city/service/homepage page drafts
  // LocalBusiness (+ Service) JSON-LD from the tenant's own name/address/phone/
  // service-area cities. Only wired when the tenant HAS a local identity (a
  // name plus at least one of address / phone / a served area) - a content
  // tenant with none stays null -> composeSchema is byte-identical to before.
  const configuredCities = (businessConfig.locations ?? []).filter((c) =>
    c.trim(),
  );
  const hasLocalIdentity =
    Boolean(businessConfig.name?.trim()) &&
    (Boolean(businessConfig.address?.trim()) ||
      Boolean(businessConfig.phone?.trim()) ||
      configuredCities.length > 0);
  const enrichmentCtx: DraftEnrichmentContext = {
    snapshotByUrl,
    businessName: businessConfig.name,
    localBusiness: hasLocalIdentity
      ? {
          name: businessConfig.name,
          address: businessConfig.address,
          phone: businessConfig.phone,
          domain: businessConfig.domain,
          areaServed: configuredCities,
        }
      : null,
  };

  // Fusion slice (2026-06-12): GA4 page-value weights, keyed by the
  // candidates' target_url form. Fail-soft to neutral.
  const ga4ValueWeightByUrl = new Map<string, number>();
  try {
    const { loadGa4PageValuesForTenant, ga4ValueWeight } = await import(
      "@/domains/recommendation-intelligence/ga4-page-values"
    );
    const values = await loadGa4PageValuesForTenant(input.tenantId);
    for (const [page, v] of values) {
      ga4ValueWeightByUrl.set(page, ga4ValueWeight(v));
    }
  } catch {
    // neutral weights
  }

  // Learning loop (#10, 2026-06-22): outcome priors from the proof ledger —
  // re-rank the next-best set toward action types that have WON in past shipped
  // experiments (and away from ones that lost). Fail-soft to neutral (no priors
  // ⇒ exact pre-learning ordering). Priority-only; QA/pushability unaffected.
  let outcomePriorByActionType = new Map<string, number>();
  let proofLedgerForGate: import("@/domains/proof-gsc/shipped-change-store").ShippedChangeRecord[] = [];
  try {
    const { loadProofLedger } = await import("@/domains/proof-gsc/load-ledger");
    const { computeOutcomePriors } = await import(
      "@/domains/recommendation-intelligence/outcome-prior"
    );
    proofLedgerForGate = await loadProofLedger(input.tenantId);
    outcomePriorByActionType = computeOutcomePriors(proofLedgerForGate);
  } catch {
    // neutral priors
  }

  let triggerCandidates = [
    ...triggerResult.candidates,
    ...triggerResult.diagnostic_only,
  ];

  // Shared experiment gate (2026-07-01): never PROMOTE a candidate for a page that is
  // mid-measurement (active treatment) or serving as an active control - the same pure
  // gate the daily planner uses. Before this, the legacy generation was the only rec
  // system with ZERO proof-ledger awareness, so a measuring page could quietly re-enter
  // the queue as a fresh recommendation. Fail-soft: a gate error never blocks promotion.
  try {
    const { deriveExperimentStates } = await import("@/domains/experiments/experiment-eligibility");
    const states = deriveExperimentStates(proofLedgerForGate, input.now ?? new Date());
    const activePaths = new Set<string>();
    for (const [path, st] of states) {
      if (st.activeTreatments.length > 0 || st.activeControlAssignments.length > 0) activePaths.add(path);
    }
    if (activePaths.size > 0) {
      const pathOf = (u: string): string =>
        ((u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
      const before = triggerCandidates.length;
      triggerCandidates = triggerCandidates.filter(
        (c) => !c.target_url || !activePaths.has(pathOf(c.target_url)),
      );
      if (before - triggerCandidates.length > 0) {
        log.warn("[promoteEligibleCandidates] experiment gate skipped mid-measurement pages", {
          tenantId: input.tenantId,
          skipped: before - triggerCandidates.length,
        });
      }
    }
  } catch {
    // gate unavailable -> promote as before (the guard must never fail the pipeline)
  }

  // Build pageTypeByUrl from candidate target_urls — same inline
  // pattern as the α₀b diagnostic page.
  const pageTypeByUrl = new Map<string, PageType>();
  for (const c of triggerCandidates) {
    if (c.target_url == null) continue;
    if (pageTypeByUrl.has(c.target_url)) continue;
    pageTypeByUrl.set(c.target_url, classifyPageType(c.target_url, businessConfig));
  }
  // RANK-5 (2026-07-06): expose the page-type map to the enricher so
  // composeSchema knows a city/service/homepage add_schema card should draft
  // LocalBusiness/Service JSON-LD. Attached here (after the map is built) rather
  // than at ctx creation because the map is derived from the trigger candidates.
  enrichmentCtx.pageTypeByUrl = pageTypeByUrl;

  // Stage 2: recompute the promotion engine. Do NOT trust any
  // preview cache.
  const promotion = selectPromotableCandidates({
    tenantId: input.tenantId,
    triggerCandidates,
    recommendedEdits,
    recommendationResponses,
    pageTypeByUrl,
    ga4ValueWeightByUrl,
    outcomePriorByActionType,
    now,
  });

  // Stage 3: map eligible results through α₁a, then fill deterministic
  // drafts (P0 wall 3) and apply the operator-edit learning signal
  // (P0 wall 7: action types the operator usually rewords get a
  // one-step confidence downgrade + a plain-English note). Both steps
  // are pure and never change the row id / element-key identity.
  const editFeedback = computeEditFeedback(recommendedEdits, now);
  const eligibleResults = promotion.filter((r) => r.eligible);
  const collectedRows: DeterministicPromotionEditRow[] = [];
  for (const result of eligibleResults) {
    const row = promotionResultToRecommendedEditRow(result, now);
    if (row != null) {
      // SAFETY #273 (2026-06-14): run the public-copy safety validator on
      // the enriched deterministic draft BEFORE it becomes a customer-
      // approvable / pushable row. The deterministic promotion path never
      // built an evidence packet, so `validateSpecificEdit` can't run here;
      // `holdUnsafeDraft` applies the packet-light public-copy subset
      // (placeholder / brand-claim / superlative / em-dash / brand-name)
      // and ABSTAINS — reverting the draft fields to the safe "go look at
      // this page" card — when the copy would be unsafe to publish. Never
      // crashes the queue: a failure means "don't offer this draft".
      const safeRow = holdUnsafeDraft(
        enrichPromotionRow(row, result.candidate, enrichmentCtx),
        input.tenantId,
      );
      collectedRows.push(applyEditFeedbackToRow(safeRow, editFeedback));
    }
  }
  // Dedup by row.id, keeping the FIRST (highest-priority) occurrence
  // (audit 2026-06-14). Several customer-queue-ready triggers can emit the
  // same action_type on the same page — e.g. gsc_low_ctr,
  // gsc_striking_distance, and semrush_striking_distance all emit `edit_title`
  // for one underperforming URL. Their dedupe_key differs (topic), but the
  // promotion id = `${cooldown_key.slice(0,16)}__${action_type}__null`
  // (cooldown_key has no topic) collides, AND the Supabase conflict key
  // (tenant_id, rec_id, action_type, target_element_key=NULL) collides. An
  // un-deduped upsert chunk then hits "ON CONFLICT DO UPDATE cannot affect
  // row a second time" and the WHOLE chunk is rejected → the operator clicks
  // Promote, gets a sync warning, and the customer queue silently fails to
  // refresh. eligibleResults is priority-DESC, so first = the strongest
  // signal (first-party gsc_low_ctr over the weaker striking/third-party one).
  const seenRowIds = new Set<string>();
  const mapped_rows: DeterministicPromotionEditRow[] = [];
  for (const row of collectedRows) {
    if (seenRowIds.has(row.id)) continue;
    seenRowIds.add(row.id);
    mapped_rows.push(row);
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

  // Forward-only guard (audit #3, 2026-06-14): a re-run re-stamps every
  // mapped row "recommended". `recommendedEdits` was read fresh at Stage 1
  // (Supabase on prod, where the local file write no-ops), so dropping
  // rewrites of lifecycle-locked rows here protects PROD from silently
  // un-accepting shipped work / corrupting proof-engine treatment dates.
  const writeRows = dropLifecycleLockedRewrites(mapped_rows, recommendedEdits);
  if (writeRows.length === 0) return baseResult;

  await persistRecommendedEditsLocal(writeRows);

  try {
    await syncRecommendedEdits(writeRows, input.tenantId);
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
