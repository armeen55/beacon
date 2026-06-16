"use server";

/**
 * Slice 4.5.D.α₁c (2026-05-20) — operator-only live-write gesture.
 *
 * Wires the only UI-reachable code path to `promoteEligibleCandidates
 * ({ dryRun: false })`. Three independent gates in sequence:
 *   1. `isOperatorModeServer()` || `NODE_ENV === "test"` → else `notFound()`.
 *   2. `isPromotionLiveWriteEnabled()` → else redirect blocked_live_write_disabled.
 *   3. `formData.get("confirmation") === "PROMOTE"` (strict) → else redirect
 *      blocked_confirmation_missing.
 * On writer throw: redirect `error&msg=...` (200-char truncate). On success:
 * `revalidatePath` + redirect with promoted/skipped/mapped counts + optional
 * sync_warning (200-char truncate).
 *
 * Hard contract (pinned by `recommendation-intelligence-promotion-live-
 * write-guards` + `recommendation-intelligence-no-queue-write`):
 * imports `promoteEligibleCandidates` from the α₁b writer ONLY; NO
 * `recommended-edits-persistence` direct import; NO `runProviderAndPersist`;
 * NO Supabase write shape; this file is the SOLE caller of the writer with
 * `dryRun: false`.
 *
 * Slice 4.5.E.α₁b₂-A (2026-05-21) — adds `generateLlmDraftAction(formData)`,
 * the SOLE caller of `draftProposedTextForCandidate(...)` from any file
 * under `src/app/**`. Operator-only + env-flag-gated (no confirmation
 * phrase — this is LLM spend only, not a queue write). 11-step
 * fail-closed gate ladder before any LLM provider call. Defense-in-
 * depth pinned by `recommendation-intelligence-llm-draft-gateway-
 * render-isolation` (single-file allowlist + per-file source-text
 * contract). Hard contract (also pinned): NO `recommended-edits-
 * persistence` import · NO `runProviderAndPersist` · NO direct
 * Supabase `recommended_edits` write shape · NO direct
 * `openaiProvider` import (provider reached ONLY through the gateway).
 * Page UI consumer lands in α₁b₂-B; for now the action is reachable
 * only via hand-crafted POST (still operator + env-flag gated).
 */

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { log } from "@/lib/logger";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { isPromotionLiveWriteEnabled } from "@/lib/promotion-live-write";
import { isLlmDraftGatewayEnabled } from "@/lib/llm-draft-gateway-flag";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getBusinessConfig } from "@/lib/business-config";
import { promoteEligibleCandidates } from "@/domains/recommendation-intelligence/promotion-writer";
import { loadTriggerCandidatesForTenant } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import { buildThinPacketForCandidate } from "@/domains/recommendation-intelligence/build-thin-packet";
import { draftProposedTextForCandidate } from "@/domains/recommendation-intelligence/llm-draft-gateway";
import { getBrandAssertions } from "@/domains/recommendations/brand-assertions";

const DIAG_PATH = "/diagnostics/recommendation-triggers";
const PROPOSED_TEXT_MAX = 500;
const VALIDATION_ERRORS_MAX = 300;
const REASON_MAX = 200;
const MSG_MAX = 200;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function promoteEligibleCandidatesAction(
  formData: FormData,
): Promise<never> {
  // Gate 1: operator mode.
  if (!(isOperatorModeServer() || process.env.NODE_ENV === "test")) {
    notFound();
  }

  // Gate 2: env-flag live-write enable (defense in depth vs forged POST).
  if (!isPromotionLiveWriteEnabled()) {
    log.warn(
      "[promoteEligibleCandidatesAction] live-write disabled by env",
    );
    redirect(`${DIAG_PATH}?action_result=blocked_live_write_disabled`);
  }

  // Gate 3: confirmation phrase (strict uppercase exact match).
  const confirmation = formData.get("confirmation");
  if (typeof confirmation !== "string" || confirmation !== "PROMOTE") {
    redirect(`${DIAG_PATH}?action_result=blocked_confirmation_missing`);
  }

  // Tenant resolution.
  let tenantId: string;
  try {
    tenantId = await currentTenantId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[promoteEligibleCandidatesAction] tenant resolve failed", {
      error: msg,
    });
    redirect(`${DIAG_PATH}?action_result=blocked_no_tenant`);
  }

  // All gates passed — call the α₁b writer with `dryRun: false`.
  let result: Awaited<ReturnType<typeof promoteEligibleCandidates>>;
  try {
    result = await promoteEligibleCandidates({ tenantId, dryRun: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[promoteEligibleCandidatesAction] writer threw", {
      tenantId,
      error: msg,
    });
    const safeMsg = encodeURIComponent(truncate(msg, 200));
    redirect(`${DIAG_PATH}?action_result=error&msg=${safeMsg}`);
  }

  revalidatePath(DIAG_PATH);

  const params = new URLSearchParams({
    action_result: "promoted",
    promoted_count: String(result.promoted_count),
    skipped_count: String(result.skipped_count),
    mapped_row_count: String(result.mapped_rows.length),
  });
  if (result.sync_warning != null && result.sync_warning.length > 0) {
    params.set("sync_warning", truncate(result.sync_warning, 200));
  }
  redirect(`${DIAG_PATH}?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Slice 4.5.E.α₁b₂-A — generateLlmDraftAction
//
// SOLE caller of `draftProposedTextForCandidate(...)` from any file
// under `src/app/**`. Pinned by the evolved
// `recommendation-intelligence-llm-draft-gateway-render-isolation`
// invariant (single-file allowlist + source-text contract).
// ---------------------------------------------------------------------------

function llmRedirect(params: URLSearchParams): never {
  redirect(`${DIAG_PATH}?${params.toString()}`);
}

function invalidCandidate(reason: string): never {
  const p = new URLSearchParams({
    llm_draft_result: "invalid_candidate",
    reason,
  });
  llmRedirect(p);
}

function errorRedirect(msg: string): never {
  const p = new URLSearchParams({
    llm_draft_result: "error",
    msg: truncate(msg, MSG_MAX),
  });
  llmRedirect(p);
}

export async function generateLlmDraftAction(
  formData: FormData,
): Promise<never> {
  // Gate 1 — operator gate.
  if (!(isOperatorModeServer() || process.env.NODE_ENV === "test")) {
    notFound();
  }

  // Gate 2 — env-flag gate (defense in depth vs forged POST).
  if (!isLlmDraftGatewayEnabled()) {
    log.warn(
      "[generateLlmDraftAction] llm-draft gateway disabled by env",
    );
    llmRedirect(new URLSearchParams({ llm_draft_result: "blocked_env" }));
  }

  // Gate 3 — tenant resolution.
  let tenantId: string;
  try {
    tenantId = await currentTenantId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[generateLlmDraftAction] tenant resolve failed", {
      error: msg,
    });
    errorRedirect("tenant_resolve_failed");
  }

  // Gate 4 — FormData parse.
  const rawKey = formData.get("candidate_dedupe_key");
  if (typeof rawKey !== "string" || rawKey.length === 0) {
    invalidCandidate("missing_key");
  }
  const candidateDedupeKey = rawKey as string;

  // Gate 5 — fresh candidate load + diagnostic_only resolution.
  let loadResult: Awaited<ReturnType<typeof loadTriggerCandidatesForTenant>>;
  try {
    loadResult = await loadTriggerCandidatesForTenant({ tenantId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorRedirect(`load_candidates:${msg}`);
  }
  const diagMatch = loadResult.diagnostic_only.find(
    (r) => r.dedupe_key === candidateDedupeKey,
  );
  if (diagMatch == null) {
    const inMain = loadResult.candidates.find(
      (r) => r.dedupe_key === candidateDedupeKey,
    );
    if (inMain != null) {
      invalidCandidate("not_diagnostic_only");
    }
    llmRedirect(
      new URLSearchParams({ llm_draft_result: "candidate_not_found" }),
    );
  }
  const candidate = diagMatch;

  // Gate 6 — candidate shape validation.
  if (candidate.trigger_signal !== "weak_h2") {
    invalidCandidate("wrong_trigger");
  }
  if (candidate.action_type !== "rewrite_h2") {
    invalidCandidate("wrong_action");
  }
  if (candidate.generator_kind !== "llm_assisted") {
    invalidCandidate("wrong_kind");
  }
  if (candidate.confidence !== "low") {
    invalidCandidate("wrong_confidence");
  }
  if (
    candidate.target_url == null ||
    candidate.target_url === "needs_new_page" ||
    candidate.target_url.length === 0
  ) {
    invalidCandidate("invalid_target");
  }

  // Gate 7 — snapshot resolution (exact target_url match).
  let snapshots: Awaited<
    ReturnType<ReturnType<ReturnType<typeof getRepository>["forTenant"]>["getPageSnapshots"]>
  >;
  try {
    snapshots = await getRepository()
      .forTenant(tenantId)
      .getPageSnapshots();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorRedirect(`snapshots:${msg}`);
  }
  const snapshot = snapshots.find((s) => s.url === candidate.target_url);
  if (snapshot == null) {
    invalidCandidate("snapshot_missing");
  }

  // Gate 8 — business config.
  let businessConfig: ReturnType<typeof getBusinessConfig>;
  try {
    businessConfig = getBusinessConfig(tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorRedirect(`business_config:${msg}`);
  }

  // Gate 9 — brand assertions. Empty array is OK; the gateway's
  // downstream validator will return abstention_contract_no_grounding_
  // signals → gateway resolves to `validation_failed` (clean failure
  // path through the existing pipeline).
  const brandAssertions = getBrandAssertions(tenantId);

  // Gate 10 — build thin packet.
  let packet: ReturnType<typeof buildThinPacketForCandidate>;
  try {
    packet = buildThinPacketForCandidate({
      candidate,
      pageSnapshot: snapshot,
      businessConfig,
      brandAssertions,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[generateLlmDraftAction] builder threw", {
      tenantId,
      error: msg,
    });
    errorRedirect(`builder:${msg}`);
  }

  // Gate 11 — invoke gateway. Gateway already has its own internal
  // budget pre-check + post-call validator gate.
  let gatewayResult: Awaited<
    ReturnType<typeof draftProposedTextForCandidate>
  >;
  try {
    gatewayResult = await draftProposedTextForCandidate({ packet });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[generateLlmDraftAction] gateway threw", {
      tenantId,
      error: msg,
    });
    errorRedirect(`gateway:${msg}`);
  }

  // Revalidate the diagnostic path so subsequent reads reflect any
  // adjacent state change (none today; pinned forward-compat).
  revalidatePath(DIAG_PATH);

  // Map gateway result → redirect params.
  if (gatewayResult.status === "drafted") {
    const params = new URLSearchParams({
      llm_draft_result: "drafted",
      candidate_dedupe_key: candidateDedupeKey,
      cost_usd: gatewayResult.cost_usd.toFixed(6),
      bundle_size: String(gatewayResult.bundle_size),
    });
    const original = gatewayResult.proposed_text;
    const truncated = original.length > PROPOSED_TEXT_MAX;
    params.set(
      "proposed_text",
      truncated ? original.slice(0, PROPOSED_TEXT_MAX) : original,
    );
    if (truncated) {
      params.set("proposed_text_truncated", "true");
    }
    // Surface the LLM's grounded reasoning so the operator can judge
    // whether it reads like (better than) a professional SEO's analysis.
    const r = gatewayResult.reasoning;
    params.set("why", truncate(r.why, PROPOSED_TEXT_MAX));
    params.set("confidence", r.confidence);
    params.set("difficulty", r.difficulty);
    params.set("evidence_count", String(r.evidenceCount));
    if (r.model != null) params.set("model", r.model);
    if (r.expectedImpact != null) {
      params.set("expected_impact", truncate(r.expectedImpact, REASON_MAX));
    }
    if (r.measurementPlan != null) {
      params.set("measurement_plan", truncate(r.measurementPlan, REASON_MAX));
    }
    if (r.risks.length > 0) {
      params.set("risks", truncate(r.risks.join("; "), REASON_MAX));
    }
    llmRedirect(params);
  }
  if (gatewayResult.status === "abstained") {
    llmRedirect(
      new URLSearchParams({
        llm_draft_result: "abstained",
        abstention_reason: gatewayResult.abstention_reason,
        cost_usd: gatewayResult.cost_usd.toFixed(6),
      }),
    );
  }
  if (gatewayResult.status === "validation_failed") {
    llmRedirect(
      new URLSearchParams({
        llm_draft_result: "validation_failed",
        validation_errors: truncate(
          gatewayResult.validation_errors.join("; "),
          VALIDATION_ERRORS_MAX,
        ),
        cost_usd: gatewayResult.cost_usd.toFixed(6),
      }),
    );
  }
  // gatewayResult.status === "blocked_budget"
  llmRedirect(
    new URLSearchParams({
      llm_draft_result: "blocked_budget",
      reason: truncate(gatewayResult.reason, REASON_MAX),
    }),
  );
}
