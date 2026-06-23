"use server";

/**
 * GSC Proof ledger — server actions (Phase 5, Path B). Operator-gated.
 *
 * recordShippedChangeAction: the manual "Record shipped change" path. Captures a
 * GSC baseline + control set for an approved/reviewed page and starts measuring.
 * Works even when Wix publishing is manual (it's the operator confirming they
 * shipped it). Never publishes anything.
 *
 * recomputeProofLedgerAction: re-measure + persist every recorded change's
 * 7/14/28-day outcome from fresh GSC (on-demand; no cron).
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofPlan } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import {
  loadPageSurgeonContext,
  topPagesByDemand,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  recordShippedChange,
  captureChangeMeta,
  measureRecord,
  defaultPacificShipDate,
} from "@/domains/proof-gsc/run-measurement";
import {
  loadShippedChanges,
  upsertShippedChange,
} from "@/domains/proof-gsc/shipped-change-store";

export type ProofLedgerActionResponse = { success: boolean; error?: string };

/** Change types that describe a "no-edit" decision — no before/after needed. */
const NO_EDIT_CHANGE_TYPES = new Set(["keep_current", "monitor"]);

/** Minimum comparable control pages needed for an observational diff-in-diff. */
const MIN_CONTROLS = 2;

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

/** Split a raw textarea/CSV blob into trimmed, de-duped target queries. */
function parseTargetQueries(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const q = part.trim();
    if (q && !seen.has(q.toLowerCase())) {
      seen.add(q.toLowerCase());
      out.push(q);
    }
  }
  return out;
}

/** Normalize a datetime-local / date input to an ISO timestamp; undefined ⇒ now. */
function normalizeShippedAt(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  // datetime-local has no zone; treat as the operator's local time and convert.
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return v; // already ISO / date-only; recordShippedChange handles dateOnly
}

export async function recordShippedChangeAction(args: {
  pageUrl: string;
  changeType?: string;
  before?: string;
  after?: string;
  shippedAt?: string;
  notes?: string;
  targetQueries?: string;
  verifiedLive?: boolean;
  liveSourceUrl?: string;
}): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  const pageUrl = args?.pageUrl?.trim();
  if (!pageUrl) return { success: false, error: "Enter the page path or URL." };

  try {
    const tenantId = await currentTenantId();
    const plan = await loadProofPlan(tenantId).catch(() => []);
    const row = plan.find((r) => r.pageUrl === pageUrl) ?? null;

    const meta = await captureChangeMeta(tenantId, pageUrl);

    // The treated page must resolve to an absolute URL. GSC windows are keyed by
    // canonical full URLs, so a bare/unresolved path silently reads zero clicks
    // and produces a misleading verdict. Refuse rather than measure garbage.
    if (!/^https?:\/\//i.test(meta.canonPage)) {
      return {
        success: false,
        error:
          "Couldn't match this page to Search data. Paste the full https:// URL, or connect GSC so Beacon can resolve the path.",
      };
    }

    // Change type: explicit wins, else the Change Pack headline, else generic.
    const changeType =
      args.changeType?.trim() || meta.headlineAction || row?.headlineAction || "change";

    // Before/after: explicit operator copy wins, else the Change Pack draft.
    const before = (args.before?.trim() || meta.before || "").trim() || null;
    const after = (args.after?.trim() || meta.after || "").trim() || null;

    // A real edit must record what changed; "keep_current"/"monitor" need not.
    if (!NO_EDIT_CHANGE_TYPES.has(changeType) && (!before || !after)) {
      return {
        success: false,
        error:
          "Add the before and after text for this change (only Keep current / Monitor can skip it).",
      };
    }

    const origin = (() => {
      try {
        return new URL(meta.canonPage).origin;
      } catch {
        return "";
      }
    })();
    // Load the ledger ONCE: used to (a) exclude any page that is ITSELF treated
    // from the control set — a treated page is not a clean comparator, its own
    // change contaminates the diff-in-diff and biases the treated page's verdict
    // — and (b) dedup below.
    const existing = await loadShippedChanges();
    const normPath = (p: string): string => p.replace(/\/+$/, "") || "/";
    const treatedPaths = new Set(existing.map((r) => normPath(r.path)));
    const isUntreated = (u: string): boolean => {
      try {
        return !treatedPaths.has(normPath(new URL(u).pathname));
      } catch {
        return true;
      }
    };

    // Proof-plan controls are PATHS; resolve to canonical URLs on the same host.
    let controlPages = (row?.controlPaths ?? [])
      .map((p) => canonicalizeCitationUrl(origin + p) ?? `${origin}${p}`)
      .filter((u) => u && u !== meta.canonPage && isUntreated(u));

    // No proof-plan row (e.g. a page that was never review-approved) ⇒ derive
    // controls the same way the proof plan does: top same-site pages by GSC demand,
    // excluding the treated page AND any page that is itself mid-experiment. Pull
    // a wider candidate pool (12) so enough untreated pages remain to fill 3.
    if (controlPages.length === 0) {
      try {
        const ctx = await loadPageSurgeonContext(tenantId);
        controlPages = topPagesByDemand(ctx, 12)
          .map((u) => canonicalizeCitationUrl(u) ?? u)
          .filter((u) => u && u !== meta.canonPage && isUntreated(u))
          .slice(0, 3);
      } catch {
        controlPages = [];
      }
    }

    // Fail gracefully: without ≥2 comparable untreated pages there's no honest
    // diff-in-diff. Don't record a measurement we can't stand behind.
    if (controlPages.length < MIN_CONTROLS) {
      return {
        success: false,
        error: `Not enough comparable pages to measure this honestly (found ${controlPages.length}, need ${MIN_CONTROLS}). Connect GSC for more pages, or wait for more search data on this site.`,
      };
    }

    const shippedAt = normalizeShippedAt(args.shippedAt);
    // audit-4: default to the PACIFIC day (GSC's zone) so the dedup-clash check
    // matches the same default recordShippedChange stores (was UTC → off-by-one
    // for evening-Pacific ships). See defaultPacificShipDate.
    const shipDate = dateOnly(shippedAt ?? defaultPacificShipDate());

    // Dedup: reject a second proof record for the same page + ship date. The
    // ledger PK is (page-path, ship-date), so a duplicate would silently
    // overwrite the live measurement. Name the existing change type when it
    // differs so the operator understands the collision. (`existing` was loaded
    // above for the treated-page control exclusion.)
    const clash = existing.find(
      (r) => r.path === meta.path && dateOnly(r.shippedAt) === shipDate,
    );
    if (clash) {
      const sameType = clash.actionType === changeType;
      return {
        success: false,
        error: sameType
          ? "This change is already recorded for this page and ship date."
          : `A "${clash.actionType.replace(/_/g, " ")}" change is already recorded for this page on ${shipDate}. Use a different ship date or recompute the existing record.`,
      };
    }

    const targetQueries = (() => {
      const explicit = parseTargetQueries(args.targetQueries);
      return explicit.length > 0 ? explicit : meta.targetQueries;
    })();

    const record = await recordShippedChange({
      tenantId,
      page: meta.canonPage,
      path: meta.path,
      actionType: changeType,
      before,
      after,
      targetQueries,
      controlPages,
      shippedAt,
      notes: args.notes?.trim() || null,
      verifiedLive: args.verifiedLive ?? false,
      liveSourceUrl: args.liveSourceUrl?.trim() || null,
    });
    await upsertShippedChange(record);

    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record the shipped change.",
    };
  }
}

export async function recomputeProofLedgerAction(): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  try {
    const tenantId = await currentTenantId();
    const records = await loadShippedChanges();
    for (const r of records) {
      const measured = await measureRecord(tenantId, r);
      await upsertShippedChange(measured);
    }
    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to recompute.",
    };
  }
}

/**
 * Operator marks (or un-marks) that they manually requested a Google recrawl /
 * indexing in Search Console for a shipped change. Stamps recrawlRequestedAt;
 * does NOT call Google, publish, or change the measurement. Operator-only.
 */
export async function markRecrawlRequestedAction(args: {
  id: string;
  requested: boolean;
}): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  const id = args?.id?.trim();
  if (!id) return { success: false, error: "Missing record id." };
  try {
    const records = await loadShippedChanges();
    const rec = records.find((r) => r.id === id);
    if (!rec) return { success: false, error: "Proof record not found." };
    const now = new Date().toISOString();
    await upsertShippedChange({
      ...rec,
      recrawlRequestedAt: args.requested ? now : null,
      updatedAt: now,
    });
    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update.",
    };
  }
}

/**
 * Operator excludes (or re-includes) a shipped change from LEARNING by pinning
 * its verdict to "inconclusive". Use when a measured "won"/"lost" is
 * mis-attributed (control contamination / seasonal co-movement) and would
 * otherwise skew the per-action_type outcome prior that steers ranking. The
 * GSC numbers/windows still compute + display — only the learning verdict is
 * pinned (applied in measureRecord, so it survives re-measurement). Operator-only.
 */
export async function markVerdictInconclusiveAction(args: {
  id: string;
  excluded: boolean;
}): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  const id = args?.id?.trim();
  if (!id) return { success: false, error: "Missing record id." };
  try {
    const tenantId = await currentTenantId();
    const records = await loadShippedChanges();
    const rec = records.find((r) => r.id === id);
    if (!rec) return { success: false, error: "Proof record not found." };
    const now = new Date().toISOString();
    // Set the sticky override, then RE-MEASURE so the pinned verdict applies
    // immediately (and the per-action_type prior recomputes) rather than
    // waiting for the next read.
    const measured = await measureRecord(tenantId, {
      ...rec,
      operatorVerdictOverride: args.excluded ? "inconclusive" : null,
      updatedAt: now,
    });
    await upsertShippedChange(measured);
    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update.",
    };
  }
}
