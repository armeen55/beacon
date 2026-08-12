/** decision/implemented-repair: THE IMPOSSIBLE STATE, REPAIRED HONESTLY, ON EVERY RELEASE BUILD.
 *
 *  A change reads "done" only because a Shipment was written for it FIRST, so a row marked done that no Shipment points at is a state this product cannot legitimately
 *  produce: it can only come from a bare status flip, which is exactly what closing that bypass removed. Such a row is NEVER left silently done, because the operator
 *  would wait forever for a reading nobody is taking, and a Shipment is NEVER invented for it, because a made-up starting point is a made-up result. It goes back to the
 *  review stage carrying the one sentence that says what happened, so it returns to the queue as work they can close for real. server-only. */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { deserializeChangeProposal, serializeChangeProposal } from "./contracts";
import { PROPOSAL_TABLE } from "./proposal-store";

/** THE ONE SENTENCE, plain and dated, ending in the one thing the operator can actually do. The marker keeps a second pass from stacking it. */
const LOST_RECORD = /lost its record/;
const lostItsRecord = (at: unknown): string => {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  const day = Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "an earlier day";
  return `A change marked done on ${day} lost its record; mark it done again when you confirm it is live.`;
};

/** Revert every change this account holds as done that the ledger holds no record for, and hand back the sentences stored. `shipped` is every proposal id the ledger
 *  genuinely has a record for, and THE CALLER READS THE LEDGER: a ledger it could not read must never be passed here as an empty set, because a list nobody could read
 *  is not proof a change has no record. Bounded, and fail-soft per row. */
export async function reconcileImplementedWithoutShipment(tenantId: string, shipped: ReadonlySet<string>, limit = 50): Promise<string[]> {
  if (!tenantId) return [];
  const said: string[] = [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from(PROPOSAL_TABLE).select("id, status, payload, updated_at")
      .eq("tenant_id", tenantId).eq("status", "implemented_pending_verification").is("terminal_disposition", null).limit(limit);
    if (error || !data) {
      log.error("[implemented-repair] the done rows could not be read, so nothing was reverted", { tenantId, error: error?.message ?? "no rows" });
      return said;
    }
    for (const row of data as Array<{ id: string; payload: unknown; updated_at?: unknown }>) {
      const proposal = shipped.has(row.id) ? null : deserializeChangeProposal(JSON.stringify(row.payload));
      if (!proposal) continue;
      const sentence = lostItsRecord(row.updated_at);
      const payload = JSON.parse(serializeChangeProposal({ ...proposal, status: "needs_review",
        limitations: [sentence, ...proposal.limitations.filter((l) => !LOST_RECORD.test(l))] })) as unknown;
      // The stage it is LEAVING is part of the WHERE, so a press that landed a moment ago is never overwritten by this pass. The ranking stamp clears with it: a
      // reverted row has to earn its position in the queue again.
      const { data: hit, error: wErr } = await sb.from(PROPOSAL_TABLE)
        .update({ status: "needs_review", payload, queue_lane: null, queue_rank: null, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", row.id).eq("status", "implemented_pending_verification").select("id");
      if (wErr || !hit || hit.length === 0) {
        log.error("[implemented-repair] a change marked done with no record could not be reverted", { tenantId, id: row.id, error: wErr?.message ?? "no row" });
        continue;
      }
      log.warn("[implemented-repair] a change marked done carried no record, so it went back to the queue", { tenantId, id: row.id });
      said.push(sentence);
    }
  } catch (e) {
    log.error("[implemented-repair] the done-without-a-record sweep threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  return said;
}
