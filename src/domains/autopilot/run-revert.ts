import "server-only";

/**
 * Revert executor + nightly revert pass (2026-07-02, BEACON 500 item 11).
 *
 * A losing change should not sit live until a human notices. This module:
 *
 *   runRevertForProofRecord - restore the old version for ONE proof row:
 *     shipped-change record -> the pushed edit -> its pre-push snapshot ->
 *     buildRevertEdit -> executePush (Ritz hard-refuse, daily cap, snapshot,
 *     ledger ALL inherited) -> additive "old version restored" note on the
 *     original row (measurement history is never mutated) -> the revert is
 *     recorded as its own shipped change with the lesson line as notes ->
 *     autopilot receipt (kind "revert").
 *
 *   runNightlyRevertPass - the bounded cron pass (max 2 reverts per night),
 *     called by run-autopilot AFTER its ship pass, behind the same guards
 *     (armed publishing + wix target + per-day marker). Only settled-negative,
 *     clean-attribution readings whose lever is inside the armed autopilot
 *     policy auto-revert (revert-policy.ts decides; this module executes).
 *
 * Idempotent: a row whose notes carry REVERTED_NOTE_MARKER, or that already
 * has a revert record in the ledger, is never reverted twice. Fail-soft on
 * bookkeeping, fail-closed on the push.
 *
 * Pinned by tests/domains/autopilot/run-revert.test.ts.
 */

import { log } from "@/lib/logger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type {
  PushSnapshotRow,
  BuildRevertResult,
} from "@/domains/push/push-snapshots";
import type { PushResult } from "@/domains/push/push-service";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  type MeasurementPresentation,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { pickProofMetric } from "@/domains/proof-gsc/measure";
import { AUTOPILOT_RITZ_TENANT_ID, type AutopilotConfig } from "./autopilot-policy";
import { decideRevert, plainLiftLabel, type RevertDecision } from "./revert-policy";
import type { AutopilotReceipt } from "./autopilot-store";

/** The nightly pass never applies more than this many automatic reverts. */
export const MAX_AUTO_REVERTS_PER_NIGHT = 2;
/** Bound on how many negative candidates get the (I/O) snapshot lookup per night. */
const MAX_CANDIDATES_EVALUATED = 6;
/** Bound on how many same-page edits get a snapshot lookup when resolving. */
const MAX_EDIT_LOOKUPS = 6;
/** A snapshot with no action-type match must be captured within this of the ship. */
const SNAPSHOT_SHIP_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The additive note stamped on the ORIGINAL proof row after a restore. Also
 * the idempotency marker: a row whose notes contain this is never reverted
 * again (and the /proof surface hides the restore button).
 */
export const REVERTED_NOTE_MARKER = "I put the old version back on";
/** Revert records carry the original lever behind this prefix (revert_edit_title). */
export const REVERT_ACTION_PREFIX = "revert_";

const normPath = (p: string): string => (p || "/").replace(/\/+$/, "") || "/";

function pathOfUrl(url: string): string {
  try {
    return normPath(new URL(url).pathname);
  } catch {
    return normPath(url);
  }
}

/** True once the original row carries the restored-version note. Pure. */
export function hasRevertNote(record: Pick<ShippedChangeRecord, "notes">): boolean {
  return (record.notes ?? "").includes(REVERTED_NOTE_MARKER);
}

/** True for the ledger record OF a revert itself (never re-revert a revert). Pure. */
export function isRevertRecord(record: Pick<ShippedChangeRecord, "actionType">): boolean {
  return (record.actionType ?? "").startsWith(REVERT_ACTION_PREFIX);
}

/** An existing revert record for this original, if one is already in the ledger. Pure. */
export function findExistingRevertRecord(
  records: ReadonlyArray<Pick<ShippedChangeRecord, "id" | "path" | "actionType" | "shippedAt">>,
  original: Pick<ShippedChangeRecord, "id" | "path" | "actionType" | "shippedAt">,
): Pick<ShippedChangeRecord, "id" | "path" | "actionType" | "shippedAt"> | null {
  return (
    records.find(
      (r) =>
        r.id !== original.id &&
        r.actionType === `${REVERT_ACTION_PREFIX}${original.actionType}` &&
        normPath(r.path) === normPath(original.path) &&
        Date.parse(r.shippedAt) >= Date.parse(original.shippedAt),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Injectable deps (defaults lazy-import the real modules; tests inject)
// ---------------------------------------------------------------------------

export type RevertRunDeps = {
  loadShippedChanges: () => Promise<ShippedChangeRecord[]>;
  appendNote: (recordId: string, note: string) => Promise<void>;
  loadEdits: (tenantId: string) => Promise<RecommendedEditRow[]>;
  findSnapshot: (tenantId: string, editId: string) => Promise<PushSnapshotRow | null>;
  /** Optional override for buildRevertEdit (pure; defaults to the real one). */
  buildRevert?: (
    snapshot: PushSnapshotRow,
    original: RecommendedEditRow,
    now: Date,
  ) => BuildRevertResult;
  push: (args: {
    tenantId: string;
    edit: RecommendedEditRow;
    dryRun?: boolean;
  }) => Promise<PushResult>;
  probeLive: (args: { url: string; proposedText: string }) => Promise<{ kind: string }>;
  autoRecord: (args: {
    tenantId: string;
    pageUrl: string;
    actionType: string;
    targetQuery?: string | null;
    verifiedLive?: boolean;
    notes?: string;
  }) => Promise<{ recorded: boolean; reason: string }>;
  appendReceipt: (receipt: AutopilotReceipt) => Promise<void>;
  readLatestGscDate: (tenantId: string) => Promise<string | null>;
  now: () => Date;
};

const defaultDeps: RevertRunDeps = {
  loadShippedChanges: async () => {
    const { loadShippedChanges } = await import("@/domains/proof-gsc/shipped-change-store");
    return loadShippedChanges();
  },
  appendNote: async (recordId, note) => {
    const { appendShippedChangeNote } = await import(
      "@/domains/proof-gsc/shipped-change-store"
    );
    await appendShippedChangeNote(recordId, note);
  },
  loadEdits: async (tenantId) => {
    const { getRepository } = await import("@/lib/persistence/repositories");
    return getRepository().forTenant(tenantId).getRecommendedEdits();
  },
  findSnapshot: async (tenantId, editId) => {
    const { findLatestSnapshotForEdit } = await import("@/domains/push/push-snapshots");
    return findLatestSnapshotForEdit(tenantId, editId);
  },
  push: async (args) => {
    const { executePush } = await import("@/domains/push/push-service");
    return executePush(args);
  },
  probeLive: async (args) => {
    const { probeLiveText } = await import("@/domains/push/push-service");
    return probeLiveText(args);
  },
  autoRecord: async (args) => {
    const { autoRecordShippedChangeForRec } = await import(
      "@/domains/proof-gsc/auto-record-on-ship"
    );
    return autoRecordShippedChangeForRec(args);
  },
  appendReceipt: async (receipt) => {
    const { appendAutopilotReceipt } = await import("./autopilot-store");
    await appendAutopilotReceipt(receipt);
  },
  readLatestGscDate: async (tenantId) => {
    try {
      const { readLastFinalizedDate } = await import("@/domains/proof-gsc/gsc-window");
      return await readLastFinalizedDate(tenantId);
    } catch {
      return null;
    }
  },
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Resolve: proof record -> the pushed edit -> its pre-push snapshot
// ---------------------------------------------------------------------------

export type RevertSource = { edit: RecommendedEditRow; snapshot: PushSnapshotRow };

/**
 * Find the pushed edit + pre-push snapshot behind a proof record. The proof
 * ledger does not store the edit id, so we match by page path (exact
 * action-type matches first, then closest to the ship date) and accept a
 * snapshot when the action type matches OR it was captured within 3 days of
 * the ship. Empty previous values are unusable (restoring them would blank
 * the field); they are skipped here and refused again by buildRevertEdit.
 */
export async function resolveRevertSource(
  tenantId: string,
  record: Pick<ShippedChangeRecord, "path" | "actionType" | "shippedAt">,
  depsOverride: Partial<RevertRunDeps> = {},
): Promise<RevertSource | null> {
  const deps: RevertRunDeps = { ...defaultDeps, ...depsOverride };
  let edits: RecommendedEditRow[];
  try {
    edits = await deps.loadEdits(tenantId);
  } catch {
    return null;
  }
  const recPath = normPath(record.path);
  const shippedMs = Date.parse(record.shippedAt);
  const candidates = edits
    .filter((e) => pathOfUrl(e.target_url) === recPath)
    .sort((a, b) => {
      const aType = a.action_type === record.actionType ? 0 : 1;
      const bType = b.action_type === record.actionType ? 0 : 1;
      if (aType !== bType) return aType - bType;
      const aDist = Math.abs(Date.parse(a.updated_at) - shippedMs);
      const bDist = Math.abs(Date.parse(b.updated_at) - shippedMs);
      return aDist - bDist;
    })
    .slice(0, MAX_EDIT_LOOKUPS);

  for (const edit of candidates) {
    let snapshot: PushSnapshotRow | null = null;
    try {
      snapshot = await deps.findSnapshot(tenantId, edit.id);
    } catch {
      snapshot = null;
    }
    if (snapshot == null) continue;
    if (snapshot.previous_text.trim() === "") continue; // deletion-shaped, unusable
    const actionMatches = edit.action_type === record.actionType;
    const capturedNearShip =
      Number.isFinite(shippedMs) &&
      Math.abs(Date.parse(snapshot.captured_at) - shippedMs) <= SNAPSHOT_SHIP_TOLERANCE_MS;
    if (actionMatches || capturedNearShip) return { edit, snapshot };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The executor: restore the old version for ONE proof row
// ---------------------------------------------------------------------------

export type RunRevertArgs = {
  tenantId: string;
  /** The shipped-change proof record id (path::date). */
  recordId: string;
  /** The lesson sentence from decideRevert (recorded on the revert's record). */
  lessonLine: string;
  source: "operator" | "autopilot";
  /** Exercise every guard + resolution and stop before any side effect. */
  dryRun?: boolean;
};

export type RunRevertResult = {
  ok: boolean;
  code:
    | "reverted"
    | "dry_run"
    | "advise_only"
    | "record_not_found"
    | "already_reverted"
    | "no_snapshot"
    | "empty_previous"
    | "refused"
    | "no_live_write";
  /** Operator-readable outcome. */
  detail: string;
};

export async function runRevertForProofRecord(
  args: RunRevertArgs,
  depsOverride: Partial<RevertRunDeps> = {},
): Promise<RunRevertResult> {
  const deps: RevertRunDeps = { ...defaultDeps, ...depsOverride };

  // Ritz never publishes OR reverts, full stop (executePush backstops this).
  if (args.tenantId === AUTOPILOT_RITZ_TENANT_ID) {
    return {
      ok: false,
      code: "advise_only",
      detail: "this site is advise only and never publishes or restores automatically",
    };
  }

  const records = await deps.loadShippedChanges();
  const record = records.find((r) => r.id === args.recordId) ?? null;
  if (record == null) {
    return { ok: false, code: "record_not_found", detail: "I could not find that result row." };
  }

  // Idempotency, belt and braces: the note marker on the original row is the
  // primary guard; an existing revert record in the ledger is the backstop
  // (covers a prior run whose note write failed after a successful push).
  if (isRevertRecord(record)) {
    return { ok: false, code: "already_reverted", detail: "This row is itself a restore." };
  }
  if (hasRevertNote(record) || findExistingRevertRecord(records, record) != null) {
    return {
      ok: false,
      code: "already_reverted",
      detail: "I already put the old version back for this change.",
    };
  }

  const source = await resolveRevertSource(args.tenantId, record, depsOverride);
  if (source == null) {
    return {
      ok: false,
      code: "no_snapshot",
      detail:
        "I do not have a saved copy of the old version for this change. Use the before text to restore it by hand.",
    };
  }

  // buildRevertEdit ships the exact prior value through the SAME executePush,
  // so the Ritz refuse, the daily cap, the pre-push snapshot, and the ledger
  // all apply to the revert exactly as they do to any push.
  const now = deps.now();
  let built: BuildRevertResult;
  if (deps.buildRevert != null) {
    built = deps.buildRevert(source.snapshot, source.edit, now);
  } else {
    const { buildRevertEdit } = await import("@/domains/push/push-snapshots");
    built = buildRevertEdit(source.snapshot, source.edit, now);
  }
  if (!built.ok) {
    return {
      ok: false,
      code: "empty_previous",
      detail: "The saved old value is empty, so restoring it would blank the field. Do this one by hand.",
    };
  }

  const pushResult = await deps.push({
    tenantId: args.tenantId,
    edit: built.edit,
    dryRun: args.dryRun === true,
  });

  if (pushResult.kind === "dry_run") {
    return { ok: true, code: "dry_run", detail: pushResult.detail };
  }

  const failReceipt = async (detail: string): Promise<void> => {
    try {
      await deps.appendReceipt({
        id: `aprv-${Date.now()}-${built.edit.id.slice(0, 12)}`,
        editId: built.edit.id,
        url: source.edit.target_url,
        actionType: `${REVERT_ACTION_PREFIX}${record.actionType}`,
        shippedAt: new Date().toISOString(),
        result: "failed",
        receiptLine: `I tried to put the old version back but stopped: ${detail}`,
        detail,
        kind: "revert",
      });
    } catch (e) {
      log.warn("[revert] failure receipt write failed (non-blocking)", {
        tenantId: args.tenantId,
        recordId: args.recordId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (pushResult.kind === "refused") {
    await failReceipt(pushResult.reason);
    return { ok: false, code: "refused", detail: pushResult.reason };
  }
  if (pushResult.kind === "dev_note") {
    // Advise-mode tenant (Ritz or no write target): nothing went live.
    await failReceipt(pushResult.reason);
    return { ok: false, code: "advise_only", detail: pushResult.reason };
  }
  if (pushResult.kind !== "pushed") {
    await failReceipt("no live write happened");
    return { ok: false, code: "no_live_write", detail: "no live write happened" };
  }

  // Live write happened. Everything below is bookkeeping - fail-soft, logged.
  let verified = false;
  try {
    const probe = await deps.probeLive({
      url: source.edit.target_url,
      proposedText: built.edit.proposed_text ?? "",
    });
    verified = probe.kind === "found";
  } catch {
    verified = false;
  }

  const restoredDay = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  try {
    // ADDITIVE note only - the original row's windows/verdict are untouched.
    await deps.appendNote(
      record.id,
      `${REVERTED_NOTE_MARKER} ${restoredDay}. The restore is measuring as its own change now.`,
    );
  } catch (e) {
    log.warn("[revert] original-row note failed (non-blocking)", {
      tenantId: args.tenantId,
      recordId: record.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await deps.autoRecord({
      tenantId: args.tenantId,
      pageUrl: record.page,
      actionType: `${REVERT_ACTION_PREFIX}${record.actionType}`,
      targetQuery: record.targetQueries?.[0] ?? null,
      verifiedLive: verified,
      notes: args.lessonLine,
    });
  } catch (e) {
    log.warn("[revert] revert proof record failed (non-blocking)", {
      tenantId: args.tenantId,
      recordId: record.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await deps.appendReceipt({
      id: `aprv-${Date.now()}-${built.edit.id.slice(0, 12)}`,
      editId: built.edit.id,
      url: source.edit.target_url,
      actionType: `${REVERT_ACTION_PREFIX}${record.actionType}`,
      shippedAt: new Date().toISOString(),
      result: "pushed",
      receiptLine: args.lessonLine,
      detail: pushResult.detail,
      kind: "revert",
    });
  } catch (e) {
    log.warn("[revert] receipt write failed (non-blocking)", {
      tenantId: args.tenantId,
      recordId: record.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  log.info("[revert] old version restored", {
    tenantId: args.tenantId,
    recordId: record.id,
    source: args.source,
    verified,
  });
  return { ok: true, code: "reverted", detail: pushResult.detail };
}

// ---------------------------------------------------------------------------
// Shared decision assembly (the /proof action and the nightly pass use this)
// ---------------------------------------------------------------------------

function presentationFor(
  record: ShippedChangeRecord,
  overlap: OverlapContext | null,
  latestGscDate: string | null,
  now: Date,
): MeasurementPresentation {
  const basisWin = (record.windows ?? [])
    .filter((w) => w.ran)
    .sort((a, b) => b.day - a.day)[0];
  return buildMeasurementPresentation({
    shippedAt: record.shippedAt,
    now,
    latestGscDate,
    windows: (record.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
    verdict: record.verdict,
    controlsUsed: basisWin?.controlsUsed ?? 0,
    baselineImpressions: record.baseline?.impressions ?? 0,
    overlap,
    live: true,
  });
}

/** The basis window's lift on the record's judged metric, as a plain label. Pure. */
export function liftLabelFor(record: ShippedChangeRecord): string | null {
  const basis = (record.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
  if (basis == null) return null;
  const metric = pickProofMetric(record.actionType);
  const lift =
    metric === "ctr"
      ? basis.adjustedCtrLift
      : metric === "position"
        ? basis.adjustedPosLift
        : basis.adjustedLift;
  return plainLiftLabel(metric, lift);
}

export type EvaluatedRevert = {
  record: ShippedChangeRecord;
  presentation: MeasurementPresentation;
  decision: RevertDecision;
};

/**
 * Load everything needed and decide propose / auto_revert / none for one proof
 * row. Used by the /proof server action so eligibility is always re-derived
 * server side (the client is never trusted).
 */
export async function evaluateRevertDecisionForRecord(
  tenantId: string,
  recordId: string,
  config: AutopilotConfig | null,
  depsOverride: Partial<RevertRunDeps> = {},
): Promise<EvaluatedRevert | null> {
  const deps: RevertRunDeps = { ...defaultDeps, ...depsOverride };
  const records = await deps.loadShippedChanges();
  const record = records.find((r) => r.id === recordId) ?? null;
  if (record == null) return null;

  const now = deps.now();
  const latestGscDate = await deps.readLatestGscDate(tenantId).catch(() => null);
  const overlaps = detectMeasurementOverlaps(
    records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })),
  );
  const presentation = presentationFor(record, overlaps.get(record.id) ?? null, latestGscDate, now);

  const alreadyReverted =
    isRevertRecord(record) ||
    hasRevertNote(record) ||
    findExistingRevertRecord(records, record) != null;

  // Only pay for the snapshot lookup when the reading is actually negative.
  const snapshotAvailable =
    presentation.direction === "negative" && !alreadyReverted
      ? (await resolveRevertSource(tenantId, record, depsOverride)) != null
      : false;

  const decision = decideRevert({
    tenantId,
    direction: presentation.direction,
    windowDay: presentation.basisDay,
    attributionQuality: presentation.attributionQuality,
    lever: record.actionType,
    config,
    snapshotAvailable,
    alreadyReverted,
    now,
    liftLabel: liftLabelFor(record),
  });
  return { record, presentation, decision };
}

// ---------------------------------------------------------------------------
// The nightly pass (called by run-autopilot after its ship pass)
// ---------------------------------------------------------------------------

export type RevertPassSummary = {
  /** Negative candidates that got a full evaluation this night. */
  considered: number;
  /** Decisions that said auto_revert (whether or not the push then succeeded). */
  autoEligible: number;
  reverted: number;
  failed: number;
  /** Lesson lines for the reverts that landed. */
  receiptLines: string[];
};

/**
 * Evaluate settled-negative proof rows and apply pre-approved reverts, bounded
 * to MAX_AUTO_REVERTS_PER_NIGHT. The caller (run-autopilot) already enforced:
 * autopilot enabled, publishing armed, wix target, per-day idempotency, and
 * the Ritz refuse. decideRevert re-checks the policy per row regardless.
 */
export async function runNightlyRevertPass(
  tenantId: string,
  config: AutopilotConfig,
  now: Date = new Date(),
  depsOverride: Partial<RevertRunDeps> = {},
): Promise<RevertPassSummary> {
  const deps: RevertRunDeps = { ...defaultDeps, ...depsOverride, now: () => now };
  const summary: RevertPassSummary = {
    considered: 0,
    autoEligible: 0,
    reverted: 0,
    failed: 0,
    receiptLines: [],
  };

  const records = await deps.loadShippedChanges();
  if (records.length === 0) return summary;
  const latestGscDate = await deps.readLatestGscDate(tenantId).catch(() => null);
  const overlaps = detectMeasurementOverlaps(
    records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })),
  );

  // Cheap prefilter before any snapshot I/O: negative at >= 14 days, not a
  // revert itself, not already restored. Oldest ship first (longest-bleeding
  // page gets fixed first), bounded.
  const candidates = records
    .map((record) => ({
      record,
      presentation: presentationFor(record, overlaps.get(record.id) ?? null, latestGscDate, now),
    }))
    .filter(
      ({ record, presentation }) =>
        !isRevertRecord(record) &&
        !hasRevertNote(record) &&
        findExistingRevertRecord(records, record) == null &&
        presentation.direction === "negative" &&
        (presentation.basisDay ?? 0) >= 14,
    )
    .sort((a, b) => a.record.shippedAt.localeCompare(b.record.shippedAt))
    .slice(0, MAX_CANDIDATES_EVALUATED);

  for (const { record, presentation } of candidates) {
    if (summary.reverted >= MAX_AUTO_REVERTS_PER_NIGHT) break;
    summary.considered += 1;

    const source = await resolveRevertSource(tenantId, record, depsOverride);
    const decision = decideRevert({
      tenantId,
      direction: presentation.direction,
      windowDay: presentation.basisDay,
      attributionQuality: presentation.attributionQuality,
      lever: record.actionType,
      config,
      snapshotAvailable: source != null,
      alreadyReverted: false, // prefiltered above
      now,
      liftLabel: liftLabelFor(record),
    });
    if (decision.action !== "auto_revert") continue;
    summary.autoEligible += 1;

    let outcome: RunRevertResult;
    try {
      outcome = await runRevertForProofRecord(
        {
          tenantId,
          recordId: record.id,
          lessonLine: decision.lessonLine,
          source: "autopilot",
        },
        depsOverride,
      );
    } catch (e) {
      outcome = {
        ok: false,
        code: "no_live_write",
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    if (outcome.ok && outcome.code === "reverted") {
      summary.reverted += 1;
      summary.receiptLines.push(decision.lessonLine);
    } else {
      summary.failed += 1;
    }

    log.info("[revert] nightly candidate processed", {
      tenantId,
      recordId: record.id,
      ok: outcome.ok,
      code: outcome.code,
      detail: outcome.detail.slice(0, 200),
    });
  }

  return summary;
}
