import "server-only";

/** decision/ai-case-store - WHERE EVERY SEARCH THE ASSISTANTS RAN ENDED UP, written down durably.
 *
 *  The resolver is pure and both sides can call it, which is necessary and was not sufficient: Decision knows
 *  things the screen does not (which pages exist, which have been read, whether any job fits), so the verdict
 *  is PERSISTED once and both surfaces READ it. The first cut kept it in a whole-account json blob behind a
 *  process cache, and that failed three ways at once on a hosted instance: a read error came back as an empty
 *  file, a write failure was swallowed while the pass reported itself durably filed, and two cold instances
 *  merged by overwriting each other (reviewer, 2026-08-20). It is a TABLE now, one row per (tenant, case),
 *  written through one SQL function whose per-row upsert refuses to let an older pass overwrite a newer
 *  verdict, so concurrent passes merge by row and nothing is ever erased by a lambda that woke up late.
 *
 *  Decision is the only writer. Nothing here is a second canonical record of the evidence: it is the verdict
 *  about the evidence, carrying the moment it was reached so a stale verdict is legible. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** Seven ways a search ends, and every material one ends in exactly one of them. `monitoring` belongs to
 *  one-off noise alone. `held` is honest: the page that would answer it has never been read, so the next work
 *  is a reading and not a change. `covered` is the vocabulary that was missing: a tracked question already
 *  asks this search, or a change minted this pass already targets it, so it is deliberately not its own case,
 *  which is a decision and never "not judged yet". */
export type AiCaseState = "already_credited" | "actionable" | "no_page" | "unreported" | "monitoring" | "held" | "covered";

export type AiCaseDisposition = {
  /** "fanout:<canonical key>" or "prompt:<id>". The ONE identity every surface joins on. */
  caseKey: string;
  state: AiCaseState;
  /** The words the assistants actually used, for a screen that has to name the search. */
  query: string;
  /** Set only where the case reached a page: the address the card landed on, or would land on. */
  pageUrl?: string;
  /** The AI stage the case was in when it was decided, where one applies. */
  stage?: string;
  /** The proposal this became, when it became one. */
  proposalId?: string;
  /** Why, in the words both the screen and the card print. */
  reason: string;
  /** Recurrence as it stood when this was decided, so a stale verdict is legible rather than invisible. */
  days: number; engines: number; parents: number; executions: number;
  decidedAt: string;
};

const TABLE = "ai_case_dispositions";
/** One bounded read, most material first. Beyond it the least recurring rows wait for the next page nobody
 *  has needed yet; nothing is deleted to make this true. */
const READ_LIMIT = 400;

/** WHAT DECISION CONCLUDED, for a surface to render. Never recomputed here: read only.
 *  A READ THAT FAILED IS NOT AN ACCOUNT WITH NO VERDICTS. Swallowing the failure into an empty list made an
 *  outage indistinguishable from a queue that had never judged anything, and the screen then told the operator
 *  "the queue has not judged this one yet" about a search it had refused a week ago. The two states are
 *  different and both are said out loud. */
export type AiCaseFile = { state: "read"; rows: AiCaseDisposition[] } | { state: "unavailable" };

export async function readAiCaseDispositions(tenantId: string): Promise<AiCaseFile> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE)
      .select("case_key,state,query,page_url,stage,proposal_id,reason,days,engines,parents,executions,decided_at")
      .eq("tenant_id", tenantId)
      .order("days", { ascending: false }).order("engines", { ascending: false }).order("executions", { ascending: false })
      .limit(READ_LIMIT);
    if (error != null) throw new Error(error.message);
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      caseKey: String(r.case_key), state: r.state as AiCaseState, query: String(r.query),
      ...(r.page_url ? { pageUrl: String(r.page_url) } : {}), ...(r.stage ? { stage: String(r.stage) } : {}),
      ...(r.proposal_id ? { proposalId: String(r.proposal_id) } : {}), reason: String(r.reason),
      days: Number(r.days) || 0, engines: Number(r.engines) || 0, parents: Number(r.parents) || 0,
      executions: Number(r.executions) || 0, decidedAt: String(r.decided_at),
    }));
    return { state: "read", rows };
  } catch (error) {
    log.warn("[ai-case-store] the filed verdicts could not be read, so no surface claims to know them", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    return { state: "unavailable" };
  }
}

/** WHAT A SURFACE SHOWS FOR ONE SEARCH, decided in ONE place so two screens cannot answer it differently.
 *  Order matters and it is the whole point: the change on file wins, because a card is the strongest thing
 *  that can be true about a search; then the verdict Decision filed, because that pass held the landing
 *  evidence; and only a search nothing has judged yet falls through to what the evidence alone can say, where
 *  it offers NO action, because an action nobody has stood behind is how "Open Changes" appeared under a case
 *  that had already been refused for want of a page. PURE. */
export function dispositionOf(
  evidence: { caseKey: string; state: AiCaseState; reason: string },
  filed: AiCaseFile,
  held?: { id: string; researchOnly?: boolean; pagePath?: string | null; missing?: string | null } | null,
): { state: AiCaseState | "change" | "research" | "unavailable"; line: string; href: string | null } {
  if (held) return held.researchOnly === true
    ? { state: "research", href: `/changes/${encodeURIComponent(held.id)}`,
      line: `A research card is open for this on ${held.pagePath ?? "a page of yours"}: ${held.missing ?? "the wording is still owed"}.` }
    : { state: "change", href: `/changes/${encodeURIComponent(held.id)}`,
      line: `A change is open for this on ${held.pagePath ?? "a page of yours"}. Open it to finish or ship it.` };
  // AN UNREADABLE FILE CLAIMS NOTHING. Falling through to the evidence here would present an outage as a
  // verdict, which is the same lie in the other direction.
  if (filed.state === "unavailable") return { state: "unavailable", href: null,
    line: "What was decided about this search could not be read just now, so nothing here is a verdict. Open it again in a moment." };
  const onFile = filed.rows.find((d) => d.caseKey === evidence.caseKey);
  if (onFile) return { state: onFile.state, line: onFile.reason,
    href: onFile.state === "actionable" && onFile.pageUrl ? "/changes" : null };
  return { state: evidence.state, href: null,
    line: evidence.state === "actionable"
      ? `${evidence.reason} The queue has not judged this one yet, so there is no page named for it here.`
      : evidence.reason };
}

/** What the writer answers with, so a pass can never claim durability it did not get. `filed` means THIS
 *  PASS'S WHOLE DECISION SET IS CANONICAL: every row it sent is what the table now holds. A stale pass whose
 *  rows lost to newer verdicts gets `superseded`, which is not a failure and is not this pass's success
 *  either, and above all it is not a license to sweep: the sweep behind a filing retires cards on the claim
 *  that this pass's conclusions are the standing record, and for a superseded pass they are not. */
export type AiCaseWrite = { filed: true; landed: number } | { filed: false; reason: "unwritable" | "superseded"; landed?: number };

/** THE ONE WRITER. Called once per producer pass with every case that pass decided. Per-row atomic through
 *  the SQL function, stale-writer-guarded by decided_at, and a failure is a failure: the caller must not
 *  report this family durably rewritten when nothing can read these conclusions back. */
export async function recordAiCaseDispositions(tenantId: string, decided: readonly AiCaseDisposition[]): Promise<AiCaseWrite> {
  if (decided.length === 0) return { filed: true, landed: 0 };
  try {
    const { data, error } = await getSupabaseAdmin().rpc("upsert_ai_case_dispositions", {
      p_tenant_id: tenantId, p_rows: decided as unknown as Record<string, unknown>[],
    });
    if (error != null) throw new Error(error.message);
    const landed = Number(data) || 0;
    // THE DATABASE'S COUNT IS THE VERDICT ON THIS PASS, not the RPC's success. "The call worked" with rows
    // lost to newer writers still authorized the sweep off conclusions that never became canonical.
    if (landed < decided.length) {
      log.info("[ai-case-store] a newer pass already answered some of these searches, so this one does not claim the family", { tenantId, decided: decided.length, landed });
      return { filed: false, reason: "superseded", landed };
    }
    return { filed: true, landed };
  } catch (error) {
    log.warn("[ai-case-store] the searches this pass decided could not be filed, so the last conclusions stand and this family is not swept", { tenantId, decided: decided.length, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    return { filed: false, reason: "unwritable" };
  }
}
