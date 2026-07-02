import "server-only";

/**
 * Trust-budget autopilot runner (2026-07-01, BEACON 500 item 1).
 *
 * The nightly pass. Loads the tenant's armed budget, computes per-lever
 * verdict history from the proof ledger, gathers the changes that are
 * already QA-approved + CMS-pushable, asks the pure policy which ones ship,
 * and ships them through the EXISTING push path only:
 *
 *   executePush (Ritz hard-refuse, daily cap, pre-push snapshot, field-merge,
 *   non-destructive guard) -> markRecommendedEditPushResult -> the same
 *   shipped-change proof record every manual ship creates, with the receipt
 *   line in its notes (visible on /proof).
 *
 * Safety posture:
 *   - Disabled config = instant no-op (default OFF, armed per tenant).
 *   - One-click publishing must be armed for the site (the same operator
 *     consent the armed accept path requires) or the pass no-ops.
 *   - Idempotent per day: a Pacific-day marker in the store guards double
 *     runs; executePush's daily cap backstops it structurally.
 *   - Tenant-explicit where possible; ambient-tenant stores are guarded by
 *     an ambient-vs-requested tenant check so a cron fan-out can never read
 *     or write another tenant's data.
 *   - Never mutates measurement history: every write is a new record
 *     (push ledger row, snapshot, proof record, receipt).
 *
 * Pinned by tests/domains/autopilot/run-autopilot.test.ts.
 */

import { log } from "@/lib/logger";
import {
  AUTOPILOT_RITZ_TENANT_ID,
  computeLeverRecords,
  decideAutopilotShips,
  type AutopilotCandidate,
  type AutopilotPick,
  type LeverVerdictInput,
} from "./autopilot-policy";
import {
  appendAutopilotReceipt,
  countAutoShippedInLastDays,
  getAutopilotState,
  markAutopilotRunDay,
  type AutopilotState,
} from "./autopilot-store";

export type AutopilotPassResult = {
  tenantId: string;
  /** True when the pass got past the guards and made a decision. */
  ran: boolean;
  /** Why the pass stopped (or "completed"). */
  reason: string;
  considered: number;
  picked: number;
  shipped: number;
  failed: number;
  /** The operator-visible receipt lines written this run. */
  receiptLines: string[];
};

export type AutopilotRunDeps = {
  ambientTenantId: () => Promise<string>;
  getState: () => Promise<AutopilotState>;
  markRunDay: (day: string) => Promise<AutopilotState>;
  appendReceipt: typeof appendAutopilotReceipt;
  getPublishingModeName: () => Promise<string>;
  getPublishTarget: (tenantId: string) => Promise<string | null>;
  /** Proof-ledger verdict history for the tenant (persisted verdicts only). */
  loadLeverHistory: (tenantId: string) => Promise<LeverVerdictInput[]>;
  /** Ready-to-ship candidates, best first. */
  loadCandidates: (tenantId: string) => Promise<AutopilotCandidate[]>;
  /** Ship ONE pick through the existing push path. */
  shipPick: (
    tenantId: string,
    pick: AutopilotPick,
  ) => Promise<{ ok: boolean; detail: string }>;
  /** Pacific date for the daily marker. */
  today: (now: Date) => string;
};

async function defaultAmbientTenantId(): Promise<string> {
  const { currentTenantId } = await import("@/lib/tenant-context");
  return await currentTenantId();
}

async function defaultGetPublishingModeName(): Promise<string> {
  const { getPublishingMode } = await import("@/domains/push/publishing-mode-store");
  return (await getPublishingMode()).mode;
}

async function defaultGetPublishTarget(tenantId: string): Promise<string | null> {
  try {
    const { getTenant } = await import("@/domains/tenants/store");
    return (await getTenant(tenantId))?.publish_target ?? null;
  } catch {
    return null;
  }
}

async function defaultLoadLeverHistory(): Promise<LeverVerdictInput[]> {
  // Persisted verdicts only (no re-measure on this path; the nightly
  // measure-due cron keeps them fresh). Ambient-tenant store, guarded above.
  const { loadShippedChanges } = await import("@/domains/proof-gsc/shipped-change-store");
  const records = await loadShippedChanges().catch(() => []);
  return records.map((r) => ({ actionType: r.actionType, verdict: r.verdict }));
}

/**
 * Ready-to-ship = the same bar the armed one-click accept enforces:
 * QA approved + paste_ready push readiness + a live absolute URL + an
 * open (new or accepted, not dismissed/deferred/shipped) row whose edit is
 * in a pushable lifecycle status. Row order preserves the queue's rank.
 */
async function defaultLoadCandidates(tenantId: string): Promise<AutopilotCandidate[]> {
  const { loadPersistedRecommendationQueueForPage } = await import(
    "@/domains/recommendations/load-queue"
  );
  const { buildRecommendationActionRows } = await import(
    "@/domains/recommendations/recommendation-action-rows"
  );
  const { getRepository } = await import("@/lib/persistence/repositories");

  const persisted = await loadPersistedRecommendationQueueForPage({ tenantId });

  let knownCities: string[] | undefined;
  let knownServices: string[] | undefined;
  let brandName: string | undefined;
  try {
    const { getBusinessConfigForCurrentTenant } = await import("@/lib/business-config");
    const cfg = await getBusinessConfigForCurrentTenant();
    knownCities = cfg.locations;
    knownServices = cfg.services;
    brandName = cfg.name?.trim() || undefined;
  } catch {
    // Best-effort context; the QA verdict fields the gate reads are unaffected.
  }

  const rows = buildRecommendationActionRows({
    queue: persisted.queue,
    promptTextById: {},
    knownCities,
    knownServices,
    brandName,
  });

  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const editById = new Map(edits.map((e) => [e.id, e]));

  const out: AutopilotCandidate[] = [];
  for (const row of rows) {
    if (row.sourceEditId == null) continue;
    const qa = row.detail.qaVerdict;
    if (qa == null || qa.approve !== true || qa.pushReadiness !== "paste_ready") continue;
    if (row.status !== "new" && row.status !== "accepted") continue;
    if (row.responseStatus === "dismissed" || row.responseStatus === "deferred") continue;
    const url = (row.targetUrl ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const edit = editById.get(row.sourceEditId);
    if (edit == null) continue;
    const lifecycle = edit.implementation_status ?? "recommended";
    // push_failed is deliberately excluded: it failed once and deserves a
    // human look before anything ships it again unattended.
    if (lifecycle !== "recommended" && lifecycle !== "accepted") continue;
    if ((edit.proposed_text ?? "").trim() === "") continue;
    out.push({
      editId: edit.id,
      recId: row.sourceRecommendationId ?? null,
      url,
      actionType: edit.action_type,
      title: row.title,
    });
  }
  return out;
}

/**
 * Ship one pick end to end, mirroring the armed one-click accept path:
 * acceptance record -> executePush (every structural rail) -> lifecycle
 * flip -> live probe -> shipped-change proof record carrying the receipt
 * line in its notes. Fail-soft on the bookkeeping, fail-closed on the push.
 */
async function defaultShipPick(
  tenantId: string,
  pick: AutopilotPick,
): Promise<{ ok: boolean; detail: string }> {
  const { getRepository } = await import("@/lib/persistence/repositories");
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const edit = edits.find((e) => e.id === pick.candidate.editId);
  if (edit == null) return { ok: false, detail: "the change no longer exists" };

  // Acceptance record first (mirrors acceptAndPublishRecommendation), so the
  // card leaves the open list on every surface. Non-blocking bookkeeping.
  if (pick.candidate.recId != null) {
    try {
      const { ensureRecommendationResponsesSeeded, recordResponse, persistResponses } =
        await import("@/domains/product/recommendation-response-store");
      await ensureRecommendationResponsesSeeded();
      await recordResponse(pick.candidate.recId, "accepted", {
        targetPageUrl: pick.candidate.url,
      });
      await persistResponses(tenantId);
    } catch (e) {
      log.warn("[autopilot] acceptance record failed (non-blocking)", {
        tenantId,
        recId: pick.candidate.recId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { executePush, probeLiveText } = await import("@/domains/push/push-service");
  const result = await executePush({ tenantId, edit });

  if (result.kind === "refused") return { ok: false, detail: result.reason };
  if (result.kind === "dev_note") {
    // Advise-mode tenant (Ritz or no write target): nothing went live.
    return { ok: false, detail: result.reason };
  }
  if (result.kind !== "pushed") return { ok: false, detail: "no live write happened" };

  let verified = false;
  try {
    const probe = await probeLiveText({
      url: edit.target_url,
      proposedText: edit.proposed_text ?? "",
    });
    verified = probe.kind === "found";
  } catch {
    verified = false;
  }

  try {
    const { markRecommendedEditPushResult } = await import(
      "@/domains/recommendations/recommended-edits-persistence"
    );
    await markRecommendedEditPushResult({
      editId: edit.id,
      tenantId,
      result: "pushed",
      verifiedByProbe: verified,
    });
  } catch (e) {
    log.warn("[autopilot] lifecycle flip failed (non-blocking)", {
      tenantId,
      editId: edit.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // The receipt: the same proof-ledger record every ship creates, with the
  // receipt line in notes so the operator can read it on /proof.
  try {
    const { autoRecordShippedChangeForRec } = await import(
      "@/domains/proof-gsc/auto-record-on-ship"
    );
    await autoRecordShippedChangeForRec({
      tenantId,
      pageUrl: edit.target_url,
      actionType: edit.action_type,
      verifiedLive: verified,
      notes: pick.receiptLine,
    });
  } catch (e) {
    log.warn("[autopilot] proof record failed (non-blocking)", {
      tenantId,
      editId: edit.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { ok: true, detail: result.detail };
}

function defaultToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

const defaultDeps: AutopilotRunDeps = {
  ambientTenantId: defaultAmbientTenantId,
  getState: getAutopilotState,
  markRunDay: markAutopilotRunDay,
  appendReceipt: appendAutopilotReceipt,
  getPublishingModeName: defaultGetPublishingModeName,
  getPublishTarget: defaultGetPublishTarget,
  loadLeverHistory: defaultLoadLeverHistory,
  loadCandidates: defaultLoadCandidates,
  shipPick: defaultShipPick,
  today: defaultToday,
};

export async function runAutopilotPass(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<AutopilotRunDeps> = {},
): Promise<AutopilotPassResult> {
  const deps: AutopilotRunDeps = { ...defaultDeps, ...depsOverride };
  const base: AutopilotPassResult = {
    tenantId,
    ran: false,
    reason: "",
    considered: 0,
    picked: 0,
    shipped: 0,
    failed: 0,
    receiptLines: [],
  };

  // Ritz never auto-publishes, full stop (executePush backstops this).
  if (tenantId === AUTOPILOT_RITZ_TENANT_ID) {
    return { ...base, reason: "this site is advise-only and never publishes automatically" };
  }

  // Ambient guard: several substrate stores (publishing mode, proof ledger,
  // responses) route by the AMBIENT tenant. If the ambient context is not
  // this tenant, running would read/write someone else's data - skip.
  let ambient: string | null = null;
  try {
    ambient = await deps.ambientTenantId();
  } catch {
    ambient = null;
  }
  if (ambient !== tenantId) {
    return { ...base, reason: "tenant context unavailable for this tenant - skipped" };
  }

  const state = await deps.getState();
  if (!state.config.enabled) {
    return { ...base, reason: "autopilot is off for this site" };
  }

  const day = deps.today(now);
  if (state.lastRunDay === day) {
    return { ...base, reason: "already ran today" };
  }

  // The same operator consent the armed one-click accept requires.
  const mode = await deps.getPublishingModeName();
  if (mode !== "armed") {
    return { ...base, reason: "one-click publishing is off, so nothing ships on its own" };
  }

  const target = await deps.getPublishTarget(tenantId);
  if (target !== "wix_cms") {
    return { ...base, reason: "this site has no live publishing connection" };
  }

  // Stamp the day BEFORE shipping: a crash mid-run can only mean FEWER ships
  // today, never more (and executePush's daily cap backstops the rest).
  await deps.markRunDay(day);

  const [history, candidates] = await Promise.all([
    deps.loadLeverHistory(tenantId),
    deps.loadCandidates(tenantId),
  ]);

  const decision = decideAutopilotShips({
    tenantId,
    config: state.config,
    leverRecords: computeLeverRecords(history),
    autoShippedThisWeek: countAutoShippedInLastDays(state, now),
    candidates,
  });

  const result: AutopilotPassResult = {
    ...base,
    ran: true,
    reason: "completed",
    considered: candidates.length,
    picked: decision.picks.length,
  };

  for (const pick of decision.picks) {
    let outcome: { ok: boolean; detail: string };
    try {
      outcome = await deps.shipPick(tenantId, pick);
    } catch (e) {
      outcome = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }

    if (outcome.ok) {
      result.shipped += 1;
      result.receiptLines.push(pick.receiptLine);
    } else {
      result.failed += 1;
    }

    try {
      await deps.appendReceipt({
        id: `apr-${Date.now()}-${pick.candidate.editId.slice(0, 8)}`,
        editId: pick.candidate.editId,
        url: pick.candidate.url,
        actionType: pick.candidate.actionType,
        shippedAt: new Date().toISOString(),
        result: outcome.ok ? "pushed" : "failed",
        receiptLine: outcome.ok
          ? pick.receiptLine
          : `I tried to ship this automatically but stopped: ${outcome.detail}`,
        detail: outcome.detail,
      });
    } catch (e) {
      log.warn("[autopilot] receipt write failed (non-blocking)", {
        tenantId,
        editId: pick.candidate.editId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    log.info("[autopilot] pick processed", {
      tenantId,
      editId: pick.candidate.editId,
      url: pick.candidate.url,
      ok: outcome.ok,
      detail: outcome.detail.slice(0, 200),
    });
  }

  return result;
}
