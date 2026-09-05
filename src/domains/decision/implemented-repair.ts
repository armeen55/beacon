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
import { deliverableGaps } from "./completeness";
import { PROPOSAL_TABLE } from "./proposal-store";

/** THE ONE SENTENCE, plain and dated, ending in the one thing the operator can actually do. The marker keeps a second pass from stacking it. */
const LOST_RECORD = /lost its record|was never finished/;
const dayOf = (at: unknown): string => { const t = typeof at === "string" ? Date.parse(at) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "an earlier day"; };
const lostItsRecord = (at: unknown): string => `A change marked done on ${dayOf(at)} lost its record; mark it done again when you confirm it is live.`;
/** AND A ROW WHOSE DELIVERABLE WAS NEVER FINISHED IS NOT A SHIPMENT, WHATEVER THE LEDGER HOLDS (live, 2026-09-05). The ship door re-asks `deliverableGaps` before it will mark anything done, and it was added exactly because a population line whose number, year and source were still the generator's own capitalised slots went out, was verified on the page and was banked as a win that then taught the ranker. Two rows crossed before that door existed and still stand as done on one live account, each carrying that same template line and each being measured as a change: 108 rows read done there, 2 of them have a gap. A stamp is not a finished deliverable, so the same question the ship door asks is asked again of every row already wearing the stamp, and a row that fails it goes back to the queue saying what is missing instead of being counted as work that shipped. */
const notFinished = (at: unknown, gap: string): string => `A change marked done on ${dayOf(at)} was never finished: ${gap}. Write the exact copy, then mark it done again.`;

/** A FINISHED READING RETIRES THE ROW IT MEASURED. A change marked done stayed "pending verification" forever after its reading settled,
 *  so eight rows sat frozen: counted as in-flight on every lifecycle line, holding their pages against fresh work, waiting on nothing
 *  (audit, 2026-08-24). The verdict itself lives on the ledger and Results keeps showing it; this only closes the queue's side of the
 *  loop, with the receipt on the row saying what the reading said. */
const settledReceipt = (verdict: string): string =>
  `The reading finished and the result is on Results: ${verdict === "won" ? "this change won" : verdict === "lost" ? "this change lost" : "no clear winner"}.`;

/** Revert every change this account holds as done that the ledger holds no record for, and hand back the sentences stored. `shipped` is every proposal id the ledger
 *  genuinely has a record for, and THE CALLER READS THE LEDGER: a ledger it could not read must never be passed here as an empty set, because a list nobody could read
 *  is not proof a change has no record. `finished` maps proposal ids to the settled verdict their reading reached (won, lost, or
 *  inconclusive, the same terminal rule the measurement lifecycle uses); those rows are retired as settled instead. Bounded, and fail-soft per row. */
export async function reconcileImplementedWithoutShipment(tenantId: string, shipped: ReadonlySet<string>, limit = 50, finished?: ReadonlyMap<string, string>): Promise<string[]> {
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
      const proposal = deserializeChangeProposal(JSON.stringify(row.payload));
      const gap = proposal ? deliverableGaps(proposal)[0] : undefined; // an unfinished deliverable outranks the ledger: a stamp on copy nobody wrote is not a shipment, and a reading of it measures nothing
      if (gap == null && shipped.has(row.id)) {
        const verdict = finished?.get(row.id);
        if (!verdict) continue;
        // Compare-and-set on the exact state read above, so a concurrent write is never overwritten: a row that moved settles on the next release instead.
        const { data: done, error: sErr } = await sb.from(PROPOSAL_TABLE)
          .update({ terminal_disposition: "settled", withdrawn_reason: settledReceipt(verdict), updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("id", row.id).eq("status", "implemented_pending_verification").is("terminal_disposition", null).select("id");
        if (sErr || !done || done.length === 0) log.error("[implemented-repair] a finished reading could not retire its row", { tenantId, id: row.id, error: sErr?.message ?? "no row" });
        else log.info("[implemented-repair] a finished reading retired its row", { tenantId, id: row.id, verdict });
        continue;
      }
      if (!proposal) continue;
      const sentence = gap != null ? notFinished(row.updated_at, gap) : lostItsRecord(row.updated_at);
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
      log.warn("[implemented-repair] a change marked done went back to the queue", { tenantId, id: row.id, why: gap ?? "no record" });
      said.push(sentence);
    }
  } catch (e) {
    log.error("[implemented-repair] the done-without-a-record sweep threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  return said;
}
