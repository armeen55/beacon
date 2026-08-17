import "server-only";

/** evidence/pages/fact-checks - STATEMENTS A PAGE MAKES THAT INDEPENDENT SOURCES CONTRADICT, with the source
 *  and the confidence behind each one. THE PAGE'S OWN WORDS ARE EVIDENCE OF WHAT IT SAYS, NEVER PROOF THAT IT
 *  IS TRUE (operator, 2026-08-17), so a correction is only ever as strong as the independent source under it,
 *  and this is where that source lives durably. The decision kernel MINTS from these rows and never carries
 *  corrections of its own: a correction that cannot be re-derived from stored research is not a product
 *  output, it is a one-off somebody typed, and the pass that regenerates the queue will overwrite it.
 *
 *  CONFIDENCE IS PART OF THE FACT, not a presentation choice. Only `confirmed` may ever authorize replacing
 *  published words; `likely` and `disputed` are real findings that stay in review; `unsupported` names the
 *  missing source and proposes NOTHING, because inventing a replacement is the failure this store exists to
 *  prevent. */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

export const PAGE_FACT_CHECKS = "page-fact-checks";

/** How much authority one source carries. A community or baby-name page may notice a claim worth checking and
 *  may never authorize a replacement, which is enforced where confidence is decided, not here. */
export type SourceKind = "scholarly" | "dictionary" | "encyclopedia" | "reference" | "community" | "babyname";

export type FactCheck = {
  /** The page path this statement is on. */
  page: string;
  /** What the statement is ABOUT: the name, term or entity, exactly as the page writes it. */
  subject: string;
  /** The page's exact current wording for that subject, so a replacement can be matched to it. */
  current: string;
  /** The corrected wording, or null when nothing is supported: an unsupported check proposes nothing. */
  proposed: string | null;
  language: string | null;
  /** Literal etymology and modern usage kept apart, because a page recording a live poetic sense is not
   *  automatically wrong and grading it so would authorize a destructive edit on a defensible line. */
  literal: string | null;
  usage: string | null;
  sources: Array<{ url: string; kind: SourceKind; says: string }>;
  agreement: "multiple_agree" | "single_source" | "sources_conflict" | "none_found";
  confidence: "confirmed" | "likely" | "disputed" | "unsupported";
  verdict: "page_correct" | "page_wrong" | "page_imprecise" | "undecidable";
  /** Other places on the same page repeating or contradicting this statement (an FAQ answer, a summary). */
  alsoAt: string[];
  /** One sentence of context a reader needs, or "". */
  note: string;
  checkedAt: string;
};

/** Every fact check on file for this account. A failed read THROWS: an empty list would say this account's
 *  pages check out, which is a different and false claim. */
export async function readFactChecks(tenantId: string): Promise<FactCheck[]> {
  const rows = await readStore<FactCheck>(PAGE_FACT_CHECKS, [], { tenantId });
  return rows.filter((r) => !!r?.page && !!r?.subject);
}

/** Bank a completed check run for one page, replacing that page's rows and leaving every other page alone.
 *  Idempotent by (page, subject): re-checking a name overwrites its row rather than filing a second opinion. */
export async function recordFactChecks(tenantId: string, page: string, checks: readonly FactCheck[]): Promise<number> {
  try {
    const held = await readFactChecks(tenantId).catch(() => [] as FactCheck[]);
    const others = held.filter((h) => h.page !== page);
    const mine = new Map<string, FactCheck>();
    for (const c of checks) if (c.page === page && c.subject.trim()) mine.set(c.subject.trim().toLowerCase(), c);
    const next = [...others, ...mine.values()];
    await writeStore(PAGE_FACT_CHECKS, next, { tenantId });
    log.info("[fact-checks] banked", { tenantId, page, checks: mine.size, total: next.length });
    return mine.size;
  } catch (e) {
    log.warn("[fact-checks] the check run was not banked", { tenantId, page, error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/** PURE: the checks that may authorize replacing published words. Confirmed, contradicting the page, carrying
 *  a replacement AND at least one source of real authority. Everything else is a finding, not an instruction. */
export function authorizedCorrections(checks: readonly FactCheck[]): FactCheck[] {
  return checks.filter((c) => c.confidence === "confirmed"
    && (c.verdict === "page_wrong" || c.verdict === "page_imprecise")
    && !!c.proposed?.trim()
    && c.sources.some((s) => s.kind === "scholarly" || s.kind === "dictionary" || s.kind === "encyclopedia"));
}
