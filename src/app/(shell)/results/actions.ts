"use server";

import { revalidatePath } from "next/cache";
import { after as afterResponse } from "next/server";

import { log } from "@/lib/logger";
import { isAccountOwner } from "@/lib/auth/can-publish";
import { currentTenantId } from "@/lib/tenant-context";
import { getTenant } from "@/domains/account";
import { captureChangeMeta, loadProofLedger, recordShipment, upsertShippedChange, verifyShipmentNow, type ShippedChangeRecord } from "@/domains/measurement";
import { writeResultsSurface } from "./results-surface-store";
import { presentShipments } from "./results-ledger-data";

type ProofLedgerActionResponse = { success: boolean; error?: string };

const FLAT_EDITS = new Set(["edit_title", "edit_meta", "change_h1"]);

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

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS: Record<string, string> = { edit_title: "title", edit_meta: "meta", change_h1: "h1" };
function qualifiedInstant(raw: string, zone: string, offsetMinutes: number): string | null {
  const date = new Date(raw);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw) || !Number.isFinite(date.getTime()) || date.toISOString() !== raw || !Number.isInteger(offsetMinutes)) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return (local - date.getTime() + date.getUTCMilliseconds()) / 60_000 === offsetMinutes ? raw : null;
  } catch { return null; }
}

export async function recordShippedChangeAction(args: {
  pageUrl: string;
  eventId: string;
  changeType?: string;
  before?: string;
  after?: string;
  shippedAt: string;
  timeZone: string;
  offsetMinutes: number;
  notes?: string;
  targetQueries?: string;
}): Promise<ProofLedgerActionResponse> {
  if (!(await isAccountOwner())) return { success: false, error: "Only this account's owner can change measurement records." };
  const pageUrl = args?.pageUrl?.trim();
  if (!pageUrl) return { success: false, error: "Enter the page path or URL." };
  if (!EVENT_ID.test(args.eventId ?? "")) return { success: false, error: "This edit needs its own recording identity. Open the form again." };
  const shippedAt = qualifiedInstant(args.shippedAt, args.timeZone, args.offsetMinutes);
  if (!shippedAt) return { success: false, error: "Choose a real local date and time for when you applied this edit." };

  try {
    const tenantId = await currentTenantId();
    const site = (await getTenant(tenantId))?.domain?.toLowerCase().replace(/^www\./, "");
    if (!site) return { success: false, error: "Your website address is unavailable. Try again in a moment." };
    if (!pageUrl.startsWith("/") || pageUrl.startsWith("//")) {
      let entered: URL;
      try { entered = new URL(pageUrl); } catch { return { success: false, error: "Paste the full https:// address of this page on your site." }; }
      if (entered.protocol !== "https:" || entered.hostname.toLowerCase().replace(/^www\./, "") !== site || entered.search || entered.hash)
        return { success: false, error: "Use the plain https:// address of a page on your own site." };
    }
    const meta = await captureChangeMeta(tenantId, pageUrl);
    let page: URL;
    try { page = new URL(meta.canonPage); } catch { return { success: false, error: "Paste the full https:// address of this page on your site." }; }
    if (page.protocol !== "https:" || page.hostname.toLowerCase().replace(/^www\./, "") !== site || page.search || page.hash)
      return { success: false, error: "Use the plain https:// address of a page on your own site." };
    const changeType = args.changeType?.trim() || "";
    if (!FLAT_EDITS.has(changeType)) return { success: false, error: "Choose a title, meta description, or main-heading edit. Use Changes for sections, links, schema, or complete pages." };
    const before = args.before?.trim() || null;
    const after = args.after?.trim() || null;
    if (!before || !after) {
      return { success: false, error: "Add the actual before and after copy for this edit." };
    }
    const explicit = parseTargetQueries(args.targetQueries);
    const recorded = await recordShipment({
      tenantId, externalEvent: true, proposalId: `external::${args.eventId}`, proposalVersion: "manual-v1",
      page: meta.canonPage, path: meta.path, actionType: changeType, before, after,
      targetQueries: explicit, basis: null, caseId: null,
      bundleHypothesis: args.notes?.trim() || "Operator-recorded change made outside Beacon's queue.",
      componentsApplied: [{ id: args.eventId, kind: KINDS[changeType] ?? changeType, label: changeType.replace(/_/g, " "), before, after, page: meta.canonPage, where: null }],
      implementedAt: shippedAt, preChangeContentHash: null, preChangeHashUnavailable: true,
      operatorNote: args.notes?.trim() || null, judgedMetric: "clicks",
    });
    afterResponse(() => verifyShipmentNow(tenantId, recorded.shipmentId, { readSerp: async () => null }).catch(() => 0));
    revalidatePath("/results");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === "This event ID already records different implementation facts")
      return { success: false, error: "These details changed after your first recording attempt. The first record was kept; reload Results to start a separate edit." };
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
