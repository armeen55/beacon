"use server";

/** GSC Proof ledger server actions (Phase 5, Path B). Operator-gated. recordShippedChangeAction is the manual "Record shipped change" path:
 *  it captures a GSC baseline + the comparison set for a page and starts measuring, and since publishing is always manual this is the
 *  operator confirming they shipped it. It never publishes anything. recomputeProofLedgerAction re-measures and persists every recorded
 *  change's 7/14/28-day outcome from fresh GSC (on-demand; no cron). */

import { revalidatePath } from "next/cache";

import { log } from "@/lib/logger";
import { isAccountOwner } from "@/lib/auth/can-publish";
import { currentTenantId } from "@/lib/tenant-context";
import {
  recordShippedChange,
  captureChangeMeta,
  loadProofLedger,
  defaultPacificShipDate,
  selectControlPages,
  MIN_CONTROLS,
} from "@/domains/measurement";
import {
  loadShippedChanges,
  upsertShippedChange,
  type ShippedChangeRecord,
} from "@/domains/measurement";
import { writeResultsSurface } from "./results-surface-store";
import { presentShipments } from "./results-ledger-data";

type ProofLedgerActionResponse = { success: boolean; error?: string };

/** Change types that describe a "no-edit" decision — no before/after needed. */
// keep_current/monitor record no edit; new_page records a page that had no before copy at all, so the before/after gate cannot apply to it
// either.
const NO_EDIT_CHANGE_TYPES = new Set(["keep_current", "monitor", "new_page"]);

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
  if (!(await isAccountOwner())) return { success: false, error: "Only this account's owner can change measurement records." };
  const pageUrl = args?.pageUrl?.trim();
  if (!pageUrl) return { success: false, error: "Enter the page path or URL." };

  try {
    const tenantId = await currentTenantId();
    const meta = await captureChangeMeta(tenantId, pageUrl);

    // The treated page must resolve to an absolute URL. GSC windows are keyed by canonical full URLs, so a bare/unresolved path silently
    // reads zero clicks and produces a misleading verdict. Refuse rather than measure garbage.
    if (!/^https?:\/\//i.test(meta.canonPage)) {
      return {
        success: false,
        error:
          "Couldn't match this page to Search data. Paste the full https:// URL, or connect GSC so Beacon can resolve the path.",
      };
    }

    // Change type: explicit wins, else the recorded ledger headline, else generic.
    const changeType = args.changeType?.trim() || meta.headlineAction || "change";

    // Before/after: the operator's own copy, else what the ledger already holds.
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

    // The ledger, read once, for the dedup clash check below.
    const existing = await loadShippedChanges();

    // THE ONE COMPARISON-PAGE CHOOSER, shared with the shipment door so both refuse on the same evidence. Without MIN_CONTROLS untreated
    // same-site pages there is no honest difference to read, and a record I cannot stand behind is worse than no record. A READ THAT FAILED
    // IS NOT A SMALL SITE, and it gets its own sentence rather than a fix the operator already did.
    const controlPages = await selectControlPages(tenantId, meta.canonPage).catch(() => null);
    if (controlPages == null) {
      return { success: false, error: "Your other pages could not be read just now, so this is not recorded yet. Try it again in a moment." };
    }
    if (controlPages.length < MIN_CONTROLS) {
      return {
        success: false,
        error: `Only ${controlPages.length} page${controlPages.length === 1 ? "" : "s"} on your site can be fairly compared against this one, and ${MIN_CONTROLS} are needed. Connect Search Console, or wait a few more days of search data, then try it again.`,
      };
    }

    const shippedAt = normalizeShippedAt(args.shippedAt);
    // audit-4: default to the PACIFIC day (GSC's zone) so the dedup-clash check matches the same default recordShippedChange stores (was
    // UTC → off-by-one for evening-Pacific ships). See defaultPacificShipDate.
    const shipDate = dateOnly(shippedAt ?? defaultPacificShipDate());

    // Dedup: reject a second proof record for the same page + ship date. The ledger PK is (page-path, ship-date), so a duplicate would
    // silently overwrite the live measurement. Name the existing change type when it differs so the operator understands the collision.
    // (`existing` was loaded above for the treated-page control exclusion.)
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

    revalidatePath("/results");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    // THE RAW MESSAGE GOES TO THE LOG AND NOWHERE ELSE: a Supabase relation name is not an answer.
    log.error("recordShippedChange: failed", { pageUrl, error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "That change could not be recorded just now. Try it again in a moment." };
  }
}

export async function recomputeProofLedgerAction(): Promise<ProofLedgerActionResponse> {
  if (!(await isAccountOwner())) return { success: false, error: "Only this account's owner can change measurement records." };
  try {
    const tenantId = await currentTenantId();
    // THE ONE COMPARISON POLICY. This door used to call the engine with no exclusion argument at all,
    // so a recheck read every change against pages the other two doors would have refused. The ledger
    // re-measure applies the same policy they do, and nothing here decides it a third way.
    const measuredAll: ShippedChangeRecord[] = await loadProofLedger(tenantId);
    for (const measured of measuredAll) await upsertShippedChange(measured, undefined, { invalidate: false });
    const { invalidateResultsSurfaceSafe } = await import("@/domains/measurement/proof-gsc/shipped-change-store");
    if (measuredAll.length > 0) await invalidateResultsSurfaceSafe(); // once for the whole recompute
    // R4 (2026-07-03): each upsert above invalidated the /results SWR snapshot (shipped-change-store choke point). We JUST measured every
    // record, so persist the fresh snapshot now instead of making the very next render re-measure the whole ledger a second time.
    // Measurement history itself lives in the upserts.
    if (measuredAll.length > 0) {
      await writeResultsSurface(await presentShipments(tenantId, measuredAll), new Date().toISOString(), tenantId);
    }
    revalidatePath("/results");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    log.error("recomputeProofLedger: failed", { error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: "Your results could not be read again just now. Try it again in a moment." };
  }
}
