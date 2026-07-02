import "server-only";

/**
 * stage-change (BEACON_500 item 15, 2026-07-02) - the SINGLE staging entry
 * point behind every "Stage in Wix" click (daily card + worklist MoveCard).
 *
 * COMPOSITION, NOT NEW PUSH LOGIC: this module resolves a daily-plan pick or a
 * worklist move to its pushable edit and hands it to the EXISTING executePush,
 * which remains the sole write authority (Ritz hard-refuse, daily cap
 * reserve-before-write, fail-closed pre-push snapshot, field-merge only,
 * non-destructive patch, mapping required, 1MB ceiling). Every gate here can
 * only be MORE conservative than executePush; any uncertainty fails closed to
 * a paste instruction, never to a live write.
 *
 * Gates, in order (most conservative wins):
 *   1. Tenant from trusted server context only (never client input).
 *   2. Ritz (advise mode) refuses before anything else runs.
 *   3. Publish permission (operator OR owner/admin/founder of THIS tenant).
 *   4. The site must be EXPLICITLY ARMED (staged default -> paste, with a
 *      pointer at the publishing settings).
 *   5. The publish target must be wix_cms (a live write must be possible).
 *   6. The change must map to an existing push route (title/meta/h1 field,
 *      schema, additive body section). No route -> paste.
 *   7. For a worklist move: the deterministic QA verdict must not have
 *      downgraded it (same backstop the armed one-click accept uses).
 *   8. executePush runs every structural rail and does the write.
 *
 * Receipt contract: { staged, receiptLine, reason? }. receiptLine is always
 * renderable operator copy (staged receipt OR the paste instruction) and is
 * dash-stripped at this chokepoint.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getPublishingMode } from "./publishing-mode-store";
import { getTenant } from "@/domains/tenants/store";
import {
  executePush,
  probeLiveText,
  RITZ_TENANT_ID,
  type PushDeps,
} from "./push-service";
import {
  pasteFallbackLine,
  stagedReceiptLine,
  stageRouteForActionType,
  stageRouteForLever,
  STAGING_OFF,
  type StagingAvailability,
} from "./stage-route";
import { getPlan } from "@/domains/experiments/daily-experiment-plan-store";
import {
  itemStatus,
  LEVER_TO_ACTION_TYPE,
} from "@/domains/experiments/execution-state";
import type {
  DailyExperimentPlanRecord,
  PlannedExperimentRecord,
} from "@/domains/experiments/daily-plan-types";
import { getRepository } from "@/lib/persistence/repositories";
import {
  markRecommendedEditPushResult,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import { scheduleIndexNowPing } from "@/lib/connectors/indexnow/ping-on-verify";

export type { StagingAvailability } from "./stage-route";

export type StageChangeInput =
  | {
      kind: "daily_pick";
      planId: string;
      experimentId: string;
      /** The operator's inline tweak (D-3); staged text must match what they
       *  actually approved on the card. Text levers only. */
      editedText?: string;
    }
  | {
      kind: "move";
      /** The MoveCard id (rec_id, falling back to the edit id). */
      moveId: string;
    };

export type StageChangeReceipt = {
  staged: boolean;
  /** Always renderable operator copy: the staged receipt, or the paste instruction. */
  receiptLine: string;
  reason?: string;
};

/** Test seam: the push deps plus an injectable fetch for the live probe.
 *  Production callers pass nothing; tests must never reach Wix or the network. */
export type StageDeps = PushDeps & { fetchImpl?: typeof fetch };

/** Daily-pick item states a stage click is allowed from. Anything already
 *  live/tracking (or skipped) refuses; a second push would muddy the proof. */
const DAILY_STAGEABLE_STATUSES = new Set(["ready_to_apply", "verification_failed"]);

function notStaged(reason: string): StageChangeReceipt {
  return {
    staged: false,
    receiptLine: pasteFallbackLine(reason),
    reason: stripBannedDashes(reason),
  };
}

/**
 * Can this tenant one-click stage anything right now? Read-side helper for the
 * card loaders. Fails to OFF on ANY uncertainty (no tenant context, ambient
 * mismatch, read error) - the fail-safe direction is always "show paste".
 */
export async function getStagingAvailability(
  tenantId: string,
): Promise<StagingAvailability> {
  try {
    if (!tenantId || tenantId === RITZ_TENANT_ID) return STAGING_OFF;
    const ambient = await currentTenantId().catch(() => null);
    if (ambient !== tenantId) return STAGING_OFF;
    const [canPublish, modeState, tenant] = await Promise.all([
      canPublishForCurrentTenant().catch(() => false),
      getPublishingMode().catch(() => ({ mode: "staged" as const })),
      getTenant(tenantId).catch(() => null),
    ]);
    const wixTarget = tenant?.publish_target === "wix_cms";
    const armed = modeState.mode === "armed";
    return { enabled: canPublish && armed && wixTarget, armed, wixTarget };
  } catch {
    return STAGING_OFF;
  }
}

/**
 * Stage one change in Wix through the existing armed-publish rails.
 * Fail-closed to a paste instruction on every refusal path.
 */
export async function stageChangeForRecord(
  input: StageChangeInput,
  deps: StageDeps = {},
): Promise<StageChangeReceipt> {
  const now = deps.now ?? new Date();

  // Gate 1: tenant from trusted server context only.
  let tenantId: string;
  try {
    tenantId = await currentTenantId();
  } catch {
    return notStaged("I could not confirm which site this is for");
  }

  // Gate 2: Ritz never stages, full stop (executePush would also refuse; this
  // entry point refuses first so no cap slot, snapshot, or probe ever runs).
  if (tenantId === RITZ_TENANT_ID) {
    return notStaged(
      "this site is set to advise mode, so I never publish to it myself",
    );
  }

  // Gate 3: publish permission.
  if (!(await canPublishForCurrentTenant().catch(() => false))) {
    return notStaged("you do not have publishing permission for this site");
  }

  // Gate 4: the site must be explicitly armed.
  const modeState = await getPublishingMode().catch(
    () => ({ mode: "staged" as const }),
  );
  if (modeState.mode !== "armed") {
    return notStaged(
      "one-click publishing is not turned on for this site yet; turn it on in the publishing settings and this becomes one click",
    );
  }

  // Gate 5: a live Wix write must be possible.
  let publishTarget: string | null = null;
  try {
    publishTarget = (await getTenant(tenantId))?.publish_target ?? null;
  } catch {
    publishTarget = null;
  }
  if (publishTarget !== "wix_cms") {
    return notStaged("this site is not connected for live Wix publishing");
  }

  // Resolve the record to its pushable edit (fail-closed at every step).
  const resolved =
    input.kind === "daily_pick"
      ? await resolveDailyPick(tenantId, input, now)
      : await resolveMove(tenantId, input);
  if (!resolved.ok) return notStaged(resolved.reason);
  const { edit } = resolved;

  // Gate 8: the existing write authority. Caps, snapshot, merge, ledger, and
  // the Ritz/structural rails all live inside executePush - unchanged.
  const result = await executePush({ tenantId, edit }, { wix: deps.wix, now });

  if (result.kind === "refused") return notStaged(result.reason);
  if (result.kind === "dev_note") {
    // Advise mode / no write target: honest paste fallback, never a write.
    return notStaged(result.reason);
  }
  if (result.kind !== "pushed") {
    // dry_run can only appear if a caller ever passes dryRun (we do not).
    return notStaged("the publish path did not complete a live write");
  }

  // Verify rail (worklist moves): the same immediate probe + persisted status
  // flip the existing Approve & Push action performs. Best-effort - the write
  // already landed and is snapshot-protected; the scan cadence stays the
  // authoritative verifier.
  let probeSuffix = "";
  if (input.kind === "move") {
    try {
      const probe = await probeLiveText(
        { url: edit.target_url, proposedText: edit.proposed_text ?? "" },
        deps.fetchImpl ?? fetch,
      );
      const probeFound = probe.kind === "found";
      await markRecommendedEditPushResult({
        editId: edit.id,
        tenantId,
        result: "pushed",
        verifiedByProbe: probeFound,
      });
      if (probeFound) {
        probeSuffix = " I already see it on the live page.";
        // BEACON_500 item 75 - a live-confirmed change is exactly the moment
        // to tell Bing (and Yandex/Seznam via the same protocol) it changed.
        // Fire-and-forget + fail-soft: self-hides with no IndexNow key
        // configured, and never affects this already-succeeded stage.
        scheduleIndexNowPing({ tenantId, url: edit.target_url });
      }
    } catch {
      /* observability only - never fail a landed stage on the probe */
    }
  }

  return {
    staged: true,
    receiptLine: stripBannedDashes(`${stagedReceiptLine(now)}${probeSuffix}`),
  };
}

type Resolved =
  | { ok: true; edit: RecommendedEditRow }
  | { ok: false; reason: string };

/** A daily-plan pick -> a synthetic pushable edit row (the plan is the source
 *  of truth; nothing is persisted here - executePush owns ledger + snapshot). */
async function resolveDailyPick(
  tenantId: string,
  input: Extract<StageChangeInput, { kind: "daily_pick" }>,
  now: Date,
): Promise<Resolved> {
  let plan: DailyExperimentPlanRecord | null = null;
  try {
    plan = await getPlan(tenantId, input.planId);
  } catch {
    plan = null;
  }
  if (!plan) return { ok: false, reason: "I could not find today's approved plan" };
  if (plan.status !== "accepted") {
    return { ok: false, reason: "approve today's plan first, then I can stage its changes" };
  }
  const exp = plan.selected.find((e) => e.id === input.experimentId);
  if (!exp) return { ok: false, reason: "I could not find this change in today's plan" };

  const status = itemStatus(plan.execution, input.experimentId);
  if (!DAILY_STAGEABLE_STATUSES.has(status)) {
    return {
      ok: false,
      reason:
        status === "skipped"
          ? "this change was set aside, so I did not stage it"
          : "this change is already live and tracking, so I did not stage it again",
    };
  }

  if (stageRouteForLever(exp.lever) == null) {
    return {
      ok: false,
      reason: "this kind of change has no one-click path yet",
    };
  }

  return { ok: true, edit: editRowForDailyPick(tenantId, exp, input.editedText, now) };
}

/** Mirror of the apply action's D-3 rule: honor the operator's inline tweak for
 *  text levers so what stages is exactly what they approved on the card. */
function editRowForDailyPick(
  tenantId: string,
  exp: PlannedExperimentRecord,
  editedText: string | undefined,
  now: Date,
): RecommendedEditRow {
  const edited = (editedText ?? "").trim();
  const useEdited =
    edited.length > 0 && edited !== exp.proposedText && exp.lever !== "internal_link";
  return {
    id: `stage-${exp.id}`,
    tenant_id: tenantId,
    rec_id: exp.candidateId || exp.id,
    action_type: LEVER_TO_ACTION_TYPE[exp.lever] as RecommendedEditRow["action_type"],
    target_url: exp.canonicalUrl || exp.url,
    // No explicit element key: executePush derives the operator-mapped CMS
    // field (title/meta/h1) or routes an answer block to the mapped body
    // field - exactly the existing routes, nothing new.
    target_element_key: null,
    display_label: exp.pageLabel,
    current_text: exp.currentText ?? "",
    proposed_text: useEdited ? edited : exp.proposedText,
    why: exp.whyNow ?? "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: exp.evidenceHash ?? null,
    model: null,
    cost_usd: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    implementation_status: "accepted",
  } as RecommendedEditRow;
}

/** A worklist move -> its persisted recommended edit (by rec id or edit id),
 *  plus the same deterministic QA backstop the armed one-click accept uses. */
async function resolveMove(
  tenantId: string,
  input: Extract<StageChangeInput, { kind: "move" }>,
): Promise<Resolved> {
  let edits: RecommendedEditRow[] = [];
  try {
    edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  } catch {
    return { ok: false, reason: "I could not load this change right now" };
  }
  const candidates = edits.filter(
    (e) => e.id === input.moveId || e.rec_id === input.moveId,
  );
  const edit =
    candidates.find(
      (e) =>
        stageRouteForActionType(e.action_type, e.target_element_key) != null &&
        !!(e.proposed_text ?? "").trim(),
    ) ?? null;
  if (edit == null) {
    return {
      ok: false,
      reason:
        candidates.length > 0
          ? "this kind of change has no one-click path yet"
          : "I could not find this change in the queue",
    };
  }

  // QA backstop (same as approveAndPushRecommendedEdit): a since-downgraded /
  // rejected / not-paste-ready rec never goes live from a stale card. Lenient
  // only when the verdict cannot be loaded - executePush's structural rails
  // still protect the write.
  try {
    const { loadActionRowByEditId } = await import(
      "@/domains/recommendations/load-action-row-by-edit"
    );
    const qa = (await loadActionRowByEditId(tenantId, edit.id))?.detail.qaVerdict ?? null;
    if (qa && (qa.approve !== true || qa.pushReadiness !== "paste_ready")) {
      return {
        ok: false,
        reason: "the quality check has not cleared this change for a live push; open it to review first",
      };
    }
  } catch {
    /* lenient: the structural rails in executePush still apply */
  }

  return { ok: true, edit };
}
