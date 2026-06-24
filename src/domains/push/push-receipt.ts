import "server-only";

/**
 * Phase 5 — MAX_SEO_AEO audit P0 #5 (gaps #315/#316/#317/#329/#352/#367):
 * a FIRST-CLASS PUSH RECEIPT.
 *
 * One consolidated, READ-ONLY artifact per shipped change. Everything it
 * shows already existed — it was just scattered across three stores:
 *
 *   • the push LEDGER (caps.ts)          → result, pushed_at, detail, url
 *   • the pre-push SNAPSHOT (push-snapshots.ts) → the BEFORE value
 *   • the recommended EDIT (repository)  → the AFTER value, label, action
 *     type, lifecycle status (verify signal), and source evidence
 *
 * This module COMPOSES them into one `PushReceipt` shape. It adds NO new
 * push / verify / sync logic, runs NO migration, performs NO live writes,
 * and never calls `probeLiveText` at render — it reads the PERSISTED
 * verification status only (the heavyweight scan + the immediate probe
 * remain the authoritative writers of `verified_live`).
 *
 * Invariants:
 *   • Tenant-scoped: every store read is filtered by `tenantId`.
 *   • Soft-fail: any missing piece (no snapshot, no rec, store throw) →
 *     still return a coherent receipt with nulls; NEVER throw to the page.
 *   • Never-pushed → null: no ledger entry for the edit ⇒ no receipt.
 *   • Pure-ish: reads the three stores; no network, no clock branching.
 */

import { readPushLedgerForTenant, type PushLedgerEntry } from "./caps";
import { findLatestSnapshotForEdit } from "./push-snapshots";
import { getRepository } from "@/lib/persistence/repositories";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";
import { ACTION_TYPE_REGISTRY } from "@/domains/recommendations/action-types";
import { buildAeoEvidenceLines } from "@/domains/recommendation-intelligence/evidence-summary";

/** A revert push targets `<editId>__revert` and is itself never revertable. */
const REVERT_SUFFIX = "__revert";

/**
 * The consolidated, render-ready receipt for ONE shipped edit.
 *
 * Field provenance (which store gives which field):
 *   editId       — the edit id (input / ledger.edit_id)
 *   url          — ledger.target_url (falls back to rec.target_url)
 *   field        — snapshot.field (the CMS field written); null if no snapshot
 *   before       — snapshot.previous_text (the BEFORE value); null if no snapshot
 *   after        — rec.proposed_text (the AFTER value); null if no rec
 *   actionLabel  — rec.display_label, else humanized rec.action_type
 *   result       — ledger.result ("pushed" | "push_failed")
 *   pushedAt     — ledger.pushed_at (ISO)
 *   detail       — ledger.detail
 *   verifyStatus — derived from rec.implementation_status + ledger.result
 *   evidence     — short plain-English lines (rec evidence / why fallback)
 *   revertable   — result==="pushed" && before non-empty && not a __revert
 */
export type PushReceipt = {
  editId: string;
  url: string;
  field: string | null;
  before: string | null;
  after: string | null;
  actionLabel: string;
  result: "pushed" | "push_failed";
  pushedAt: string;
  detail: string | null;
  verifyStatus: "verified_live" | "pending" | "unverified" | "failed";
  evidence: string[];
  revertable: boolean;
};

/**
 * Map the persisted edit lifecycle status + the ledger result into the
 * four customer-facing verify states. The rule (forward-most signal wins):
 *
 *   • ledger.result === "push_failed"        → "failed"
 *     (a failed write never verifies; the rec status is irrelevant)
 *   • rec lifecycle is verified_live(_modified) → "verified_live"
 *     (the scan or the immediate probe confirmed it on the page)
 *   • rec lifecycle is "pushed"               → "pending"
 *     (the write returned 200 but no scan/probe has confirmed it live yet)
 *   • everything else (no rec, accepted, recommended, …)
 *     - if the push SUCCEEDED                 → "pending"
 *       (the ledger says it landed; the rec just hasn't caught up)
 *     - otherwise                             → "unverified"
 *
 * Pure: same inputs → same output. No I/O, no clock.
 */
export function deriveVerifyStatus(args: {
  result: "pushed" | "push_failed";
  lifecycleStatus: ImplementationStatus | null;
}): PushReceipt["verifyStatus"] {
  if (args.result === "push_failed") return "failed";
  const s = args.lifecycleStatus;
  if (s === "verified_live" || s === "verified_live_modified") {
    return "verified_live";
  }
  if (s === "pushed") return "pending";
  // The ledger says the write succeeded; the rec row hasn't been stamped
  // (or predates the column). Treat a successful push as pending until a
  // scan/probe confirms it — honest: we don't claim "live" we can't prove.
  return "pushed" === args.result ? "pending" : "unverified";
}

/** Humanize a rec into a single operator-facing action label. */
export function presentActionLabel(
  rec: Pick<RecommendedEditRow, "display_label" | "action_type"> | null,
): string {
  if (rec == null) return "Change";
  const label = (rec.display_label ?? "").trim();
  if (label.length > 0) return label;
  return ACTION_TYPE_REGISTRY[rec.action_type]?.operatorLabel ?? "Change";
}

/**
 * Compose short, plain-English source-evidence lines from the edit. Reuses
 * the AEO evidence derivation (`buildAeoEvidenceLines` reads the edit's OWN
 * evidence array for the answer-engine gap) and falls back to the rec's
 * `why` / `expected_impact` prose. The persisted edit row does NOT carry
 * the per-page GSC/SEMrush/Clarity signals (those live on the render-path
 * `LiveRecQueueItem`, not the stored row), so we surface the durable
 * signals that travel with the edit. Returns [] when nothing is available.
 *
 * Pure: same edit → same lines. White-label (AEO helper never names the
 * vendor). At most a few short lines so the receipt stays scannable.
 */
export function composeReceiptEvidence(
  rec: RecommendedEditRow | null,
): string[] {
  if (rec == null) return [];
  const lines: string[] = [];

  // AEO answer-engine gap — derived from the edit's own evidence array.
  // Reuses the exact same helper the recommendation drawer uses, so the
  // receipt's "why" matches the rec's "why".
  for (const l of buildAeoEvidenceLines(rec.evidence)) {
    // label already reads as a plain-English clause ("12 AI answers cite a
    // rival, not you"); prefer it over the bold value token.
    const text = (l.label ?? "").trim();
    if (text.length > 0) lines.push(text);
  }

  // Prose fallback — the rec's own "why" (already UUID-scrubbed at save
  // time) is the most reliable durable evidence on every edit. Only add it
  // when we don't already have a structured AEO line, to keep the receipt
  // from repeating itself.
  if (lines.length === 0) {
    const why = (rec.why ?? "").trim();
    if (why.length > 0) lines.push(why);
  }

  // Expected impact, when present and not a duplicate — the "what this
  // should win" clause an owner cares about.
  const impact = (rec.expected_impact ?? "").trim();
  if (impact.length > 0 && !lines.includes(impact)) lines.push(impact);

  return lines;
}

/**
 * Build the consolidated receipt for ONE edit. Returns null when the edit
 * was never pushed (no ledger entry for `(tenantId, editId)`). Soft-fails
 * every store read: a missing snapshot/rec degrades to nulls but still
 * yields a coherent receipt from the ledger truth.
 *
 * Tenant-scoped: the ledger is filtered by `tenant_id`; the snapshot
 * reader is already tenant-scoped; the rec read goes through
 * `getRepository().forTenant(tenantId)`.
 */
export async function loadPushReceipt(
  tenantId: string,
  editId: string,
): Promise<PushReceipt | null> {
  // ── 1. Ledger (the gating truth: no entry ⇒ never pushed ⇒ no receipt).
  let ledgerEntry: PushLedgerEntry | null = null;
  try {
    const ledger = await readPushLedgerForTenant(tenantId);
    // Newest matching entry for THIS tenant + edit wins (a re-push or a
    // failed-then-succeeded sequence keeps history; the receipt shows the
    // latest outcome).
    const mine = ledger
      // Exclude interim `reserved` rows (reserve-before-write, #5) — a receipt
      // reflects a FINALIZED push outcome, never an in-flight reservation.
      .filter(
        (e) =>
          e.tenant_id === tenantId && e.edit_id === editId && e.result !== "reserved",
      )
      .sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));
    ledgerEntry = mine[0] ?? null;
  } catch {
    ledgerEntry = null;
  }
  if (ledgerEntry == null) return null;
  // Narrowing guard (the filter already excluded these): a receipt only exists
  // for a finalized outcome.
  if (ledgerEntry.result === "reserved") return null;
  const finalizedResult: "pushed" | "push_failed" = ledgerEntry.result;

  // ── 2. Snapshot (the BEFORE value + the field). Soft-fail → null.
  let before: string | null = null;
  let field: string | null = null;
  try {
    const snap = await findLatestSnapshotForEdit(tenantId, editId);
    if (snap != null) {
      before = snap.previous_text;
      field = snap.field;
    }
  } catch {
    before = null;
    field = null;
  }

  // ── 3. Recommended edit (the AFTER value + label + verify signal +
  // evidence). Tenant-scoped via the repository. Soft-fail → null.
  let rec: RecommendedEditRow | null = null;
  try {
    const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
    rec = edits.find((e) => e.id === editId) ?? null;
  } catch {
    rec = null;
  }

  const result = finalizedResult;
  const verifyStatus = deriveVerifyStatus({
    result,
    lifecycleStatus: rec?.implementation_status ?? null,
  });

  const beforeTrimmed = (before ?? "").trim();
  const revertable =
    result === "pushed" &&
    beforeTrimmed.length > 0 &&
    !editId.endsWith(REVERT_SUFFIX);

  return {
    editId,
    url: ledgerEntry.target_url || (rec?.target_url ?? ""),
    field,
    before,
    after: rec?.proposed_text ?? null,
    actionLabel: presentActionLabel(rec),
    result,
    pushedAt: ledgerEntry.pushed_at,
    detail: ledgerEntry.detail,
    verifyStatus,
    evidence: composeReceiptEvidence(rec),
    revertable,
  };
}
