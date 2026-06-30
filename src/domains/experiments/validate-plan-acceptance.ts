/**
 * validate-plan-acceptance (2026-06-30) — PURE. Re-validates a preview plan against the CURRENT
 * experiment topology before any reservation is written. All-or-none: if any check fails the whole
 * acceptance is rejected with explicit per-item reasons (the operator then re-plans / swaps a
 * backup / removes the item). This is the in-app pre-flight; the Postgres RPC re-asserts the same
 * invariants inside the atomic transaction so a concurrent change can't slip through.
 */

import { MIN_CONTROLS } from "./build-daily-candidates";
import { normalizePath, type DailyExperimentPlanRecord, type PlanAcceptanceFailureReason, type PlannedExperimentRecord } from "./daily-plan-types";

export type AcceptanceContext = {
  tenantId: string;
  now: Date;
  /** If provided, must equal plan.inputHash (the plan's inputs are unchanged since planning). */
  expectedInputHash?: string;
  activeTreatedPaths: Set<string>;
  activeControlPaths: Set<string>;
  /** controlPath → planId of the ACTIVE reservation holding it (any plan, incl. this one). */
  reservedControlPaths: Map<string, string>;
  /** Fresh current text per source path; when present, a hash mismatch = current_text_changed. */
  currentTextByPath?: Map<string, string>;
  /** Fresh source-page hash per path (evidence freshness); when present, mismatch = evidence_changed. */
  currentTextHashByPath?: Map<string, string>;
};

export type ExperimentFailure = { experimentId: string; url: string; reason: PlanAcceptanceFailureReason; detail?: string };
export type AcceptanceValidation =
  | { ok: true; reservationsToCreate: number }
  | { ok: false; planLevelReason?: PlanAcceptanceFailureReason; failures: ExperimentFailure[] };

function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function validateExperiment(plan: DailyExperimentPlanRecord, exp: PlannedExperimentRecord, ctx: AcceptanceContext): ExperimentFailure[] {
  const out: ExperimentFailure[] = [];
  const fail = (reason: PlanAcceptanceFailureReason, detail?: string) => out.push({ experimentId: exp.id, url: exp.url, reason, detail });
  const src = normalizePath(exp.url);

  // The source page itself must not have become an active treatment / control since planning.
  if (ctx.activeTreatedPaths.has(src) || ctx.activeControlPaths.has(src)) fail("candidate_no_longer_eligible", "source is now an active treatment/control");

  // Source text must be unchanged (the proposed change targets the exact text we snapshotted).
  const freshText = ctx.currentTextByPath?.get(src);
  if (freshText !== undefined && stableHash(freshText) !== exp.currentTextHash) fail("current_text_changed");
  const freshHash = ctx.currentTextHashByPath?.get(src);
  if (freshHash !== undefined && freshHash !== exp.currentTextHash) fail("evidence_changed");

  // Controls are diff-in-diff BASELINES (shared baselines are compatible). A control is unavailable
  // only if it is or would be a TREATMENT: an active treatment, an existing active control of
  // another experiment (kept clean for it), or a treated source in THIS plan. A control merely
  // reserved as a baseline by another plan is fine. insufficient if < MIN clean controls survived.
  const selectedSrc = new Set(plan.selected.map((e) => normalizePath(e.url)));
  if (exp.controls.length < MIN_CONTROLS) fail("insufficient_controls", `${exp.controls.length} < ${MIN_CONTROLS}`);
  for (const c of exp.controls) {
    const cp = normalizePath(c.controlPath || c.controlUrl);
    if (ctx.activeTreatedPaths.has(cp) || ctx.activeControlPaths.has(cp) || selectedSrc.has(cp)) fail("control_unavailable", cp);
  }

  // Influenced (internal-link destination) pages must stay conflict-free: not active, and not also a
  // treated source elsewhere in THIS plan.
  const selectedSources = new Set(plan.selected.map((e) => normalizePath(e.url)));
  for (const inf of exp.influencedUrls) {
    const ip = normalizePath(inf);
    if (ctx.activeTreatedPaths.has(ip) || ctx.activeControlPaths.has(ip)) fail("influenced_page_conflict", ip);
    else if (selectedSources.has(ip)) fail("influenced_page_conflict", `${ip} is also a treated source in this plan`);
  }
  return out;
}

export function validatePlanAcceptance(plan: DailyExperimentPlanRecord, ctx: AcceptanceContext): AcceptanceValidation {
  // Plan-level gates first (any one of these is a hard stop).
  if (plan.tenantId !== ctx.tenantId) return { ok: false, planLevelReason: "tenant_mismatch", failures: [] };
  if (plan.status === "abandoned") return { ok: false, planLevelReason: "plan_already_abandoned", failures: [] };
  if (plan.status === "accepted") return { ok: false, planLevelReason: "plan_already_accepted", failures: [] };
  if (ctx.now.getTime() > new Date(plan.expiresAt).getTime()) return { ok: false, planLevelReason: "plan_expired", failures: [] };
  if (ctx.expectedInputHash !== undefined && ctx.expectedInputHash !== plan.inputHash) return { ok: false, planLevelReason: "input_hash_changed", failures: [] };

  const failures = plan.selected.flatMap((exp) => validateExperiment(plan, exp, ctx));
  if (failures.length > 0) return { ok: false, failures };
  const reservationsToCreate = plan.selected.reduce((n, e) => n + e.controls.length, 0);
  return { ok: true, reservationsToCreate };
}
