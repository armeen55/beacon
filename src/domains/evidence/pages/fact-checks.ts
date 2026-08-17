import "server-only";

/** evidence/pages/fact-checks - STATEMENTS A PAGE MAKES, CHECKED AGAINST SOURCES OUTSIDE IT, ONE ROW PER
 *  STATEMENT. THE PAGE'S OWN WORDS ARE EVIDENCE OF WHAT IT SAYS, NEVER PROOF THAT IT IS TRUE (operator,
 *  2026-08-17), so a correction is only ever as strong as the independent source under it, and this is where
 *  that source lives durably.
 *
 *  ROW-WISE ON PURPOSE. The first version banked a whole array in one JSON blob, which failed three ways at
 *  once (Codex, 2026-08-18): the blob store was not even mirrored to Supabase so production held nothing, a
 *  failed read degraded to `[]` and the next write would have erased every other page's facts, and two pages
 *  checked at the same time would lose each other. A natural key of (tenant, page, statement) makes every
 *  write idempotent and independent, and a read that fails THROWS, because an empty list would say this
 *  account's pages check out, which is a different and false claim.
 *
 *  CONFIDENCE IS PART OF THE FACT. Only `confirmed` may ever authorize replacing published words; `likely`
 *  and `disputed` are real findings that stay in review; `unsupported` names the missing source and proposes
 *  NOTHING. THE PAGE AS IT READ IS PART OF THE FACT TOO: `pageContentHash` is what lets a later pass tell a
 *  statement somebody has since corrected from one nobody has touched. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const TABLE = "page_source_facts";

export type SourceKind = "scholarly" | "dictionary" | "encyclopedia" | "reference" | "community" | "babyname";

export type FactCheck = {
  page: string;
  /** The subject this statement is about, canonicalized: the row's identity within its page. */
  statementKey: string;
  subject: string;
  current: string;
  proposed: string | null;
  literal: string | null;
  usage: string | null;
  sources: Array<{ url: string; kind: SourceKind; says: string }>;
  agreement: "multiple_agree" | "single_source" | "sources_conflict" | "none_found";
  confidence: "confirmed" | "likely" | "disputed" | "unsupported";
  verdict: "page_correct" | "page_wrong" | "page_imprecise" | "undecidable";
  alsoAt: string[];
  note: string;
  /** The page as it read when this was checked. A different hash means the statement owes a recheck. */
  pageContentHash: string | null;
  evidenceBasis: string | null;
  checkedAt: string;
};

export const statementKeyOf = (subject: string): string => subject.trim().toLowerCase().replace(/\s+/g, " ");

type Row = Record<string, unknown>;

const decode = (r: Row): FactCheck => ({
  page: String(r.page_key ?? ""), statementKey: String(r.statement_key ?? ""), subject: String(r.subject ?? ""),
  current: String(r.current_wording ?? ""), proposed: (r.proposed as string | null) ?? null,
  literal: (r.literal as string | null) ?? null, usage: (r.usage as string | null) ?? null,
  sources: Array.isArray(r.sources) ? (r.sources as FactCheck["sources"]) : [],
  agreement: (r.agreement as FactCheck["agreement"]) ?? "none_found",
  confidence: (r.confidence as FactCheck["confidence"]) ?? "unsupported",
  verdict: (r.verdict as FactCheck["verdict"]) ?? "undecidable",
  alsoAt: Array.isArray(r.also_at) ? (r.also_at as string[]) : [],
  note: String(r.note ?? ""), pageContentHash: (r.page_content_hash as string | null) ?? null,
  evidenceBasis: (r.evidence_basis as string | null) ?? null,
  checkedAt: String(r.checked_at ?? ""),
});

/** Every source-checked statement on file for this account. THROWS on a failed read. */
export async function readFactChecks(tenantId: string, page?: string): Promise<FactCheck[]> {
  let q = getSupabaseAdmin().from(TABLE).select("*").eq("tenant_id", tenantId);
  if (page) q = q.eq("page_key", page);
  const { data, error } = await q.order("statement_key", { ascending: true }).limit(5000);
  if (error) throw new Error(`[fact-checks] read failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(decode).filter((f) => !!f.page && !!f.statementKey);
}

/** Bank one check run. ROW-WISE AND IDEMPOTENT: each statement upserts on its own key, so a rerun updates
 *  exactly what it rechecked, another page's facts are untouched, and two runs cannot lose each other. */
export async function recordFactChecks(tenantId: string, page: string, checks: readonly FactCheck[]): Promise<number> {
  const rows = checks.filter((c) => c.subject.trim().length > 0).map((c) => ({
    tenant_id: tenantId, page_key: page, statement_key: c.statementKey || statementKeyOf(c.subject),
    page_content_hash: c.pageContentHash, subject: c.subject.trim(), current_wording: c.current,
    proposed: c.confidence === "unsupported" ? null : c.proposed,
    literal: c.literal, usage: c.usage,
    source_url: c.sources[0]?.url ?? null, source_quote: c.sources[0]?.says ?? null, source_class: c.sources[0]?.kind ?? null,
    sources: c.sources, agreement: c.agreement, confidence: c.confidence, verdict: c.verdict,
    also_at: c.alsoAt, note: c.note.slice(0, 800), evidence_basis: c.evidenceBasis,
    checked_at: c.checkedAt || new Date().toISOString(), updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return 0;
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(rows, { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.error("[fact-checks] the check run did not land", { tenantId, page, error: error.message }); return 0; }
  log.info("[fact-checks] banked", { tenantId, page, checks: rows.length });
  return rows.length;
}

/** A statement the operator has since corrected: the page no longer carries the wording this row objected to.
 *  Retired rather than deleted, so the history of what was wrong survives the fix. */
export async function retireCorrectedFacts(tenantId: string, page: string, stillPresent: (current: string) => boolean,
  pageContentHash: string | null): Promise<number> {
  const held = await readFactChecks(tenantId, page);
  const gone = held.filter((h) => (h.verdict === "page_wrong" || h.verdict === "page_imprecise") && !stillPresent(h.current));
  if (gone.length === 0) return 0;
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(gone.map((g) => ({
    tenant_id: tenantId, page_key: page, statement_key: g.statementKey,
    subject: g.subject, current_wording: g.current, proposed: g.proposed,
    sources: g.sources, agreement: g.agreement, confidence: g.confidence,
    verdict: "page_correct", note: `${g.note} Corrected on the page: the wording this objected to is gone.`.trim(),
    page_content_hash: pageContentHash, checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })), { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.warn("[fact-checks] corrected statements were not retired", { tenantId, page, error: error.message }); return 0; }
  log.info("[fact-checks] corrected statements retired", { tenantId, page, retired: gone.length });
  return gone.length;
}

/** PURE: the checks that may authorize replacing published words. Confirmed, contradicting the page, carrying
 *  a replacement AND at least one source of real authority. Everything else is a finding, not an instruction. */
export function authorizedCorrections(checks: readonly FactCheck[]): FactCheck[] {
  return checks.filter((c) => c.confidence === "confirmed"
    && (c.verdict === "page_wrong" || c.verdict === "page_imprecise")
    && !!c.proposed?.trim()
    && c.sources.some((s) => s.kind === "scholarly" || s.kind === "dictionary" || s.kind === "encyclopedia"));
}

/** WHICH CORRECTION MATTERS MOST, so a bundle that cannot show everything shows the worst first and never an
 *  alphabetical accident: a wholly wrong statement outranks an imprecise one, two agreeing sources outrank
 *  one, a statement repeated elsewhere on the page outranks a single occurrence. PURE and total. */
export function correctionSeverity(c: FactCheck): number {
  return (c.verdict === "page_wrong" ? 100 : 50)
    + (c.agreement === "multiple_agree" ? 30 : 0)
    + (c.sources.some((s) => s.kind === "scholarly") ? 20 : 0)
    + Math.min(c.alsoAt.length, 3) * 10;
}
