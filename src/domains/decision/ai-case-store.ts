import "server-only";

/** decision/ai-case-store - WHERE EVERY SEARCH THE ASSISTANTS RAN ENDED UP, written down durably. Decision knows what the screen does not (which pages exist, which were read, whether any job fits), so the verdict is PERSISTED once and both surfaces READ it. A json blob behind a process cache failed three ways on a hosted instance (read error = empty file; swallowed write reported filed; cold instances overwrote each other; reviewer 2026-08-20), so it is a TABLE: one row per (tenant, case), one SQL writer whose per-row upsert refuses stale overwrites, merging concurrent passes by row. Decision is the only writer; this is the verdict about the evidence, never a second record of it, stamped so a stale verdict is legible. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

/** THE PRE-WRITING DIAGNOSIS CONTRACT. Bump whenever the reader's question, packet shape or validation changes:
 *  a verdict taken under the old contract is then re-earned, never served on. */
export const DIAGNOSIS_CONTRACT = 4; // v4: captured main-content scope and freshness travel with the packet; owned and credited IDs retain separate authority.
/** What the evidence proves about the PAGE, decided before any writer is hired. Deliberately separate from the observation stage: "retrieved and not cited" is what the assistant DID; these name what the page LACKS, if anything. `unknown` is a real verdict (the reader ran and the material does not say why) and authorizes no body treatment; a reader that never ran leaves no diagnosis at all. */
type AeoGapKind = "already_answered" | "scattered_answer" | "missing_information" | "extraction_or_structure_gap"
  | "authority_or_source_gap" | "freshness_gap" | "reachability_gap" | "unknown";
export type AeoGapDiagnosis = {
  kind: AeoGapKind;
  /** The one treatment this diagnosis supports, or null when no content change is authorized. */
  treatment: "rewrite_existing_section" | "add_answer_section" | null;
  /** One plain sentence for the operator. */ explanation: string;
  /** The exact owned passage ids the reading stood on, and the exact credited or observation evidence ids. */
  ownedIds: readonly string[]; evidenceIds: readonly string[];
  /** The specifically missing proposition or the named structural defect, when one exists. */ missing?: string; /** The stated limit when causation stays unknown. */ limitation?: string; /** THE BINDING: the owned content version and completeness the reading was made against, and every observation id it weighed. A page change or a new observation makes this stale, never silently reused. */
  /** THE BINDING, EXACT: one canonical identity over everything the reading was made from (tenant, case, question, stage, page, content hash, completeness, the sorted observation set and the credited passages). Equality is the whole test, so adding OR removing an observation, editing a credited passage, moving the page body or bumping the contract all make it stale. */
  packet: string;
  contentHash: string; completeness: string; observationIds: readonly string[];
  version: number; decidedAt: string;
};
/** THE ONE LAW BINDING A DIAGNOSIS TO THE WORK IT MAY ORDER, written once and read by the producer that
 *  constructs a diagnosis AND the decoder that reads one back. Two copies of this drift, and a drifted copy is
 *  how a persisted row pairing `unknown` with a rewrite reaches the hiring branch. `missing_information` maps to
 *  an answer section and STILL never hires: the gate holds it acquisition-first, because nothing on file binds
 *  the proposition to the facts that support it. */
export const TREATMENT_FOR_KIND: Record<AeoGapKind, "rewrite_existing_section" | "add_answer_section" | null> = {
  scattered_answer: "rewrite_existing_section", extraction_or_structure_gap: "rewrite_existing_section",
  missing_information: "add_answer_section", already_answered: null, authority_or_source_gap: null,
  freshness_gap: null, reachability_gap: null, unknown: null };
/** PERSISTED JSON IS UNTRUSTED. A row written by an older contract, half-written, or carrying a shape nobody recognises decodes to null: no usable diagnosis, which authorizes nothing and crashes nothing. Never repaired into something valid-looking, because a repaired verdict is a verdict nobody made. */
export function decodeDiagnosis(raw: unknown): AeoGapDiagnosis | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const ids = (v: unknown): string[] | null => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0) ? (new Set(v as string[]).size === v.length ? v as string[] : null) : null;
  const owned = ids(d.ownedIds), evidence = ids(d.evidenceIds), obs = ids(d.observationIds);
  // THE PAIR IS THE CHECK, not two enums that happen to be legal apart: `unknown` carrying a rewrite is a row
  // that would hire a writer off a verdict which authorized nothing.
  if (typeof d.kind !== "string" || !(d.kind in TREATMENT_FOR_KIND)) return null;
  const treatment = TREATMENT_FOR_KIND[d.kind as AeoGapKind];
  if ((d.treatment ?? null) !== treatment) return null;
  if (owned == null || evidence == null || obs == null) return null;
  if (typeof d.explanation !== "string" || !d.explanation.trim()) return null;
  if (typeof d.packet !== "string" || !d.packet || typeof d.contentHash !== "string") return null;
  if (typeof d.completeness !== "string" || typeof d.decidedAt !== "string") return null;
  if (d.version !== DIAGNOSIS_CONTRACT) return null; // an older contract is re-earned, never served on
  return { kind: d.kind as AeoGapKind, treatment, explanation: d.explanation,
    ownedIds: owned, evidenceIds: evidence, ...(typeof d.missing === "string" && d.missing ? { missing: d.missing } : {}),
    ...(typeof d.limitation === "string" && d.limitation ? { limitation: d.limitation } : {}),
    packet: d.packet, contentHash: d.contentHash, completeness: d.completeness, observationIds: obs, version: DIAGNOSIS_CONTRACT, decidedAt: d.decidedAt };
}
/** Is this banked reading about EXACTLY the packet in hand? One equality, no subset: a reading made from more
 *  observations than the current packet holds is as stale as one made from fewer. */
export function freshDiagnosis(d: AeoGapDiagnosis | undefined, packet: string): boolean {
  return !!d && d.version === DIAGNOSIS_CONTRACT && !!d.packet && d.packet === packet;
}

/** Eight ways a search ends. `monitoring` belongs to noise and single-dimension repetition; `held` means the landing page has never been read; `covered` means a tracked question or a change this pass already owns it, a decision and never "not judged yet". */
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
  /** The banked pre-writing diagnosis, where one has been earned. Absent rows on file keep theirs: the writer
   *  coalesces, so a pass that did not rule strips nothing. */
  diagnosis?: AeoGapDiagnosis;
};

const TABLE = "ai_case_dispositions";
/** One bounded read, most material first. Beyond it the least recurring rows wait for the next page nobody
 *  has needed yet; nothing is deleted to make this true. */
const READ_LIMIT = 400;

/** WHAT DECISION CONCLUDED, for a surface to render; read only. A READ THAT FAILED IS NOT AN ACCOUNT WITH NO VERDICTS: both states are said out loud, or an outage reads as a queue that never judged anything. */
export type AiCaseFile = { state: "read"; rows: AiCaseDisposition[] } | { state: "unavailable" };

export async function readAiCaseDispositions(tenantId: string): Promise<AiCaseFile> {
  try {
    const { data, error } = await getSupabaseAdmin().from(TABLE)
      .select("case_key,state,query,page_url,stage,proposal_id,reason,days,engines,parents,executions,decided_at,diagnosis")
      .eq("tenant_id", tenantId)
      // A TOTAL ORDER, OR EVERY BUILD SHUFFLES THE TIES. days/engines/executions leave dozens of rows equal, and Postgres returns equals in whatever heap order it likes, differently on every read: two back-to-back builds of an unchanged account swapped tied rows, the release material moved, and every operator press published a "new" release that said nothing new (three in three minutes, 15 rows rewritten each). The key also makes the READ_LIMIT cut stable, so which rows are read stops depending on tie luck.
      .order("days", { ascending: false }).order("engines", { ascending: false }).order("executions", { ascending: false })
      .order("case_key", { ascending: true })
      .limit(READ_LIMIT);
    if (error != null) throw new Error(error.message);
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      caseKey: String(r.case_key), state: r.state as AiCaseState, query: String(r.query),
      ...(r.page_url ? { pageUrl: String(r.page_url) } : {}), ...(r.stage ? { stage: String(r.stage) } : {}),
      ...(r.proposal_id ? { proposalId: String(r.proposal_id) } : {}), reason: String(r.reason),
      days: Number(r.days) || 0, engines: Number(r.engines) || 0, parents: Number(r.parents) || 0,
      executions: Number(r.executions) || 0, decidedAt: String(r.decided_at),
      ...((): { diagnosis?: AeoGapDiagnosis } => { const d = decodeDiagnosis(r.diagnosis); return d ? { diagnosis: d } : {}; })(),
    }));
    // Sorted here TOO, so the promise ("same account state, same rows, same order") holds whatever the
    // transport did, and holds in every test that fakes it.
    rows.sort((a, b) => b.days - a.days || b.engines - a.engines || b.executions - a.executions || a.caseKey.localeCompare(b.caseKey));
    return { state: "read", rows };
  } catch (error) {
    log.warn("[ai-case-store] the filed verdicts could not be read, so no surface claims to know them", { tenantId, error: error instanceof Error ? error.message.slice(0, 160) : String(error) });
    return { state: "unavailable" };
  }
}

/** WHAT A SURFACE SHOWS FOR ONE SEARCH, in ONE place. Order IS the point: the change on file wins, then Decision's filed verdict, and only an unjudged search falls through to the evidence, which offers NO action, because an action nobody stood behind put "Open Changes" under a refused case. PURE. */
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

/** What the writer answers with, so a pass can never claim durability it did not get. `filed` means THIS PASS'S WHOLE DECISION SET IS CANONICAL: every row it sent is what the table now holds. A stale pass whose rows lost to newer verdicts gets `superseded`, which is not a failure and is not this pass's success either, and above all it is not a license to sweep: the sweep behind a filing retires cards on the claim that this pass's conclusions are the standing record, and for a superseded pass they are not. */
type AiCaseWrite = { filed: true; landed: number } | { filed: false; reason: "unwritable" | "superseded"; landed?: number };

/** THE ONE WRITER, called once per pass with every decided case: per-row atomic, stale-writer-guarded, and a failure is a failure the caller must not paper over. */
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
