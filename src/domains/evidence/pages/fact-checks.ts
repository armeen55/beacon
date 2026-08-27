import "server-only";

/** evidence/pages/fact-checks - STATEMENTS A PAGE MAKES, CHECKED AGAINST SOURCES OUTSIDE IT, ONE ROW PER
 *  STATEMENT. THE PAGE'S OWN WORDS ARE EVIDENCE OF WHAT IT SAYS, NEVER PROOF THAT IT IS TRUE (operator,
 *  2026-08-17), so a correction is only ever as strong as the independent source under it.
 *
 *  ROW-WISE ON PURPOSE. The first version banked an array in one JSON blob, which failed three ways at once
 *  (Codex, 2026-08-18): the blob store was not mirrored to Supabase so production held nothing, a failed read
 *  degraded to `[]` and the next write would have erased every other page's facts, and two pages checked at
 *  once lost each other. A natural key of (tenant, page, statement) makes every write idempotent and
 *  independent, and a read that fails THROWS, because an empty list would say this account's pages check out.
 *
 *  CONFIDENCE IS PART OF THE FACT. Only `confirmed` may authorize replacing published words; `likely` and
 *  `disputed` stay in review; `unsupported` names the missing source and proposes NOTHING. THE PAGE AS IT READ
 *  IS PART OF THE FACT TOO: `pageContentHash` is what tells a corrected statement from an untouched one. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const TABLE = "page_source_facts";

/** WHAT KIND OF PUBLISHER A SOURCE IS. `news` is a credible journalistic publisher, `publisher` an ordinary
 *  one nobody has vouched for, and `community` is user-generated: social, forums, video, baby-name mills.
 *  UNKNOWN IS NOT COMMUNITY (Codex, 2026-08-19): defaulting every unfamiliar domain to community rejected the
 *  Washington Post, CNBC and four more on a results page plainly about the claim. */
export type SourceKind = "scholarly" | "dictionary" | "encyclopedia" | "reference" | "news" | "publisher" | "community" | "babyname";

/** THE CLAIM'S OWN LIFECYCLE, which is also the resume cursor. `owed` = the page makes it and nobody checked
 *  it yet. `checked` = researched at this version. `superseded` = history, kept, never deleted, never work. */
type ClaimState = "owed" | "checked" | "superseded";

/** WHICH RULES PRODUCED A VERDICT. Version 1 is everything researched before 2026-08-18: it searched the
 *  SUBJECT alone, and it banked `checked` on sources it never managed to read. Version 2 searches the whole
 *  proposition and leaves an unread source owed. A row from an older version is not current evidence, so
 *  Decision may not act on it and the engine owes the claim again (Codex, 2026-08-18). Null reads as 1.
 *  VERSION 4 ASKS WHAT THE SOURCE WAS ABOUT. Versions 1 to 3 proved a quote was really in the passage they read
 *  and never once asked whether that passage was about the same subject, so a quote proving the source SAID it
 *  was taken as proof it said it about THIS name. Live, that banked Cambridge's thesaurus entry for the English
 *  word "alluring" as confirmation of a Persian name, the OED on "dream" and on "reliable" for two more,
 *  Wikipedia's Slavic "Daria" as the meaning of Persian darya, and one page cited as its own source. Version 4
 *  also requires that the words a correction proposes are carried by a passage somebody actually read. So every
 *  verdict from an earlier version is an unasked question rather than a finding, and its claim is owed again. */
export const VERIFICATION_RULES_VERSION = 4;

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
  /** Where on the page the statement sits: part of its identity, so two claims about one subject coexist. */
  pageLocator: string | null;
  /** When the SOURCE ITSELF was fetched and read. Null = nobody opened it, which may never authorize copy. */
  sourceReadAt: string | null;
  /** Where this claim is in its own life. Only `checked` may ever become customer work; see ClaimState. */
  state: ClaimState;
  /** The verification rules that produced this verdict. Older than current = not current evidence. */
  rulesVersion: number;
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
  pageLocator: (r.page_locator as string | null) ?? null,
  sourceReadAt: (r.source_read_at as string | null) ?? null,
  state: (r.claim_state as ClaimState) ?? "checked",
  rulesVersion: typeof r.rules_version === "number" ? r.rules_version : 1,
  evidenceBasis: (r.evidence_basis as string | null) ?? null,
  checkedAt: String(r.checked_at ?? ""),
});

/** Every source-checked statement on file for this account. THROWS on a failed read. */
export async function readFactChecks(tenantId: string, page?: string): Promise<FactCheck[]> {
  let q = getSupabaseAdmin().from(TABLE).select("*").eq("tenant_id", tenantId);
  if (page) q = q.eq("page_key", page);
  const { data, error } = await q.order("statement_key", { ascending: true }).limit(5000);
  if (error) throw new Error(`[fact-checks] read failed: ${error.message}`);
  // Rows under a reserved '#' key are bookkeeping (inventory coverage), never statements.
  return ((data ?? []) as Row[]).map(decode).filter((f) => !!f.page && !!f.statementKey && !f.statementKey.startsWith("#"));
}

/** HOW MUCH OF THE STORED BODY HAS BEEN INVENTORIED for a page version. Its own row under a reserved key:
 *  `owed` while incomplete so the scheduler keeps the page due, `superseded` once every section was read. A
 *  truncated first section may never be called the whole page (Codex, 2026-08-18). */
export type InventoryCoverage = { pageContentHash: string; coveredChars: number; totalChars: number };

export async function readInventoryCoverage(tenantId: string, page: string): Promise<InventoryCoverage | null> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select("page_content_hash,current_wording")
    .eq("tenant_id", tenantId).eq("page_key", page).eq("statement_key", "#coverage").maybeSingle();
  if (error) throw new Error(`[fact-checks] coverage read failed: ${error.message}`);
  if (!data?.page_content_hash) return null;
  const [c, t] = String(data.current_wording ?? "").split("/").map(Number);
  return Number.isFinite(c) && Number.isFinite(t)
    ? { pageContentHash: String(data.page_content_hash), coveredChars: c!, totalChars: t! } : null;
}

export async function recordInventoryCoverage(tenantId: string, page: string, cov: InventoryCoverage): Promise<boolean> {
  const at = new Date().toISOString();
  const { error } = await getSupabaseAdmin().from(TABLE).upsert([{
    tenant_id: tenantId, page_key: page, statement_key: "#coverage", page_content_hash: cov.pageContentHash,
    subject: "#coverage", current_wording: `${cov.coveredChars}/${cov.totalChars}`,
    sources: [], agreement: "none_found", confidence: "unsupported", verdict: "undecidable", also_at: [],
    note: "How much of the stored body has been inventoried for this page version.",
    claim_state: cov.coveredChars >= cov.totalChars ? "superseded" : "owed",
    checked_at: at, updated_at: at,
  }], { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.warn("[fact-checks] coverage was not stored", { tenantId, page, error: error.message }); return false; }
  return true;
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
    page_locator: c.pageLocator, source_read_at: c.sourceReadAt, claim_state: c.state ?? "checked", superseded_at: null,
    rules_version: c.rulesVersion ?? VERIFICATION_RULES_VERSION,
    checked_at: c.checkedAt || new Date().toISOString(), updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return 0;
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(rows, { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.error("[fact-checks] the check run did not land", { tenantId, page, error: error.message }); return 0; }
  log.info("[fact-checks] banked", { tenantId, page, checks: rows.length });
  return rows.length;
}

/** HOW MANY CLAIMS THIS ACCOUNT STILL OWES A SOURCE CHECK, and whether THIS ENGINE has ever landed one. The
 *  scheduler reads it to decide a pass is owed: without it the phase was reachable only on a fresh daily cycle,
 *  so a page of forty statements would have taken forty days. `everChecked` counts `checked` rows and nothing
 *  else, because superseded history is exactly the state that must not read as work already done. Null = the
 *  read failed, which is never "nothing owed". */
export async function owedClaimDebt(tenantId: string): Promise<{ owed: number; everChecked: boolean } | null> {
  const count = async (state: ClaimState) => getSupabaseAdmin().from(TABLE)
    .select("statement_key", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("claim_state", state);
  const [owed, checked] = await Promise.all([count("owed"), count("checked")]);
  if (owed.error || checked.error) return null;
  return { owed: owed.count ?? 0, everChecked: (checked.count ?? 0) > 0 };
}

/** THE PAGE'S WHOLE CLAIM INVENTORY, banked as `owed` rows BEFORE one is researched: THIS IS THE RESUME CURSOR
 *  (Codex, 2026-08-18). Existing rows are untouched, so an inventory write cannot reset a researched claim. */
export async function recordOwedClaims(tenantId: string, page: string,
  claims: readonly { statementKey: string; subject: string; current: string; locator: string | null }[],
  pageContentHash: string, evidenceBasis: string | null): Promise<number> {
  const rows = claims.filter((c) => c.subject.trim() && c.statementKey).map((c) => ({
    tenant_id: tenantId, page_key: page, statement_key: c.statementKey, page_content_hash: pageContentHash,
    subject: c.subject.trim(), current_wording: c.current, page_locator: c.locator,
    sources: [], agreement: "none_found", confidence: "unsupported", verdict: "undecidable",
    also_at: [], note: "Owed: this page version makes this claim and no source has been read for it yet.",
    evidence_basis: evidenceBasis, claim_state: "owed", rules_version: VERIFICATION_RULES_VERSION,
    checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return 0;
  const { error } = await getSupabaseAdmin().from(TABLE)
    .upsert(rows, { onConflict: "tenant_id,page_key,statement_key", ignoreDuplicates: true });
  if (error) throw new Error(`[fact-checks] the claim inventory did not land: ${error.message}`);
  return rows.length;
}

/** THE PAGE MOVED ON. Every row held for another version, and every row whose objectionable wording is gone,
 *  becomes `superseded`: history, never a live instruction. Nothing is deleted and no wording is rewritten. */
export async function supersedeStaleFacts(tenantId: string, page: string, pageContentHash: string,
  stillPresent: (current: string) => boolean): Promise<number> {
  const held = await readFactChecks(tenantId, page);
  const stale = held.filter((h) => h.state !== "superseded"
    && (h.pageContentHash !== pageContentHash || !stillPresent(h.current)));
  if (stale.length === 0) return 0;
  const at = new Date().toISOString();
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(stale.map((g) => ({
    tenant_id: tenantId, page_key: page, statement_key: g.statementKey,
    subject: g.subject, current_wording: g.current, proposed: g.proposed, sources: g.sources,
    agreement: g.agreement, confidence: g.confidence, verdict: g.verdict, note: g.note,
    page_content_hash: g.pageContentHash, claim_state: "superseded", superseded_at: at, updated_at: at,
  })), { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.warn("[fact-checks] stale claims were not retired", { tenantId, page, error: error.message }); return 0; }
  log.info("[fact-checks] stale claims retired", { tenantId, page, superseded: stale.length });
  return stale.length;
}

/** A VERDICT FROM OBSOLETE RULES IS NOT CURRENT EVIDENCE. Each stale row is ARCHIVED under its own key with
 *  its evidence intact, then the live claim goes back to `owed` so the repaired engine researches it again.
 *  Returns how many were re-opened. Nothing is deleted and no wording is rewritten. */
export async function reopenObsoleteChecks(tenantId: string, page: string, stale: readonly FactCheck[]): Promise<number> {
  if (stale.length === 0) return 0;
  const at = new Date().toISOString();
  const rows = stale.flatMap((g) => [
    { tenant_id: tenantId, page_key: page, statement_key: `${g.statementKey}~rv${g.rulesVersion}`,
      subject: g.subject, current_wording: g.current, proposed: g.proposed, sources: g.sources,
      agreement: g.agreement, confidence: g.confidence, verdict: g.verdict, page_content_hash: g.pageContentHash,
      source_read_at: g.sourceReadAt, evidence_basis: g.evidenceBasis, rules_version: g.rulesVersion,
      note: `Checked under verification rules ${g.rulesVersion}, kept as history when those rules were replaced.`,
      claim_state: "superseded", superseded_at: at, checked_at: g.checkedAt || at, updated_at: at },
    { tenant_id: tenantId, page_key: page, statement_key: g.statementKey, subject: g.subject,
      current_wording: g.current, proposed: null, sources: [], agreement: "none_found", confidence: "unsupported",
      verdict: "undecidable", page_content_hash: g.pageContentHash, page_locator: g.pageLocator,
      source_read_at: null, evidence_basis: g.evidenceBasis, rules_version: VERIFICATION_RULES_VERSION,
      note: "Owed again: the rules that produced the earlier verdict were replaced.",
      claim_state: "owed", superseded_at: null, checked_at: at, updated_at: at },
  ]);
  const { error } = await getSupabaseAdmin().from(TABLE).upsert(rows, { onConflict: "tenant_id,page_key,statement_key" });
  if (error) { log.warn("[fact-checks] obsolete checks were not re-opened", { tenantId, page, error: error.message }); return 0; }
  log.info("[fact-checks] checks from obsolete rules re-opened", { tenantId, page, reopened: stale.length });
  return stale.length;
}

/** PURE: the checks that may authorize replacing published words./** PURE: the checks that may authorize replacing published words. Confirmed, contradicting the page, carrying
 *  a replacement, at least one source of real authority, AND A RECORD THAT THE SOURCE WAS ACTUALLY READ.
 *
 *  THE READ IS THE WHOLE POINT (Codex, 2026-08-18). Without `sourceReadAt` the row says an authority exists,
 *  not that anybody opened it, and the migration that created this table says in its own words that such a row
 *  may not authorize replacement. It was authorizing 40 of them into a live customer card. A row researched
 *  outside the runtime is real work and still cannot attest to itself here: it stays a finding until the
 *  engine reads its source and says so. `current` binds the row to the page version and basis it was checked
 *  against, so a stale fact can never sit beside its own replacement as a second live instruction. */
/** A QUOTE THAT ONLY HYPOTHESIZES DOES NOT AUTHORIZE A FLAT REPLACEMENT. Wikipedia's Maryam passage says the
 *  name "may have originated... possibly derivative of the root mr", and the flat "Beloved." shipped on it was
 *  really standing on one ordinary baby-name site: a hypothesis plus an ordinary publisher is a finding, never
 *  a confirmation. */
const HEDGED = /\b(?:may|might|possibly|perhaps|likely|uncertain|unclear|disputed|debated|suggest(?:s|ed|ion)?)\b/i;
/** A QUOTE THAT DEFINES A DIFFERENT NAME DEFINES A DIFFERENT SUBJECT, however alike the spelling: the passage
 *  crediting Persian Ariana with "most holy" was Wikipedia deriving it from "the Ancient Greek name Ariadne",
 *  which is the Daria-for-darya failure wearing a derivation. The verifier's own rule already says a variant of
 *  a different language's name is a different subject; this asks the same question of the banked quote itself,
 *  so one model lapse cannot ship a homograph. One edit of distance is a transliteration (Laila/Leila), never a
 *  different name. */
const editDistanceOver1 = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return true;
  let i = 0, j = a.length - 1, k = b.length - 1;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
  while (j >= i && k >= i && a[j] === b[k]) { j -= 1; k -= 1; }
  return j - i >= 1 || k - i >= 1;
};
const definesOtherName = (says: string, subject: string): boolean => {
  const bare = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
  const who = bare(subject);
  // "SOMETIMES USED AS a Welsh name" is a claim about a DIFFERENT use of the same spelling, never about this
  // name's own meaning: the quote crediting Persian Aryana with "silver" was Wikipedia describing the Welsh
  // elaboration of arian. A primary identity ("is a Persian feminine given name") carries no "used as".
  if (/\bused as an?\s+\p{Lu}[\p{L}]*(?:\s+\p{L}+){0,2}\s+name\b/u.test(says)) return true;
  return [...says.matchAll(/\bname\s+(\p{Lu}[\p{L}]+)/gu)].some((m) => editDistanceOver1(bare(m[1]!), who));
};

export function authorizedCorrections(checks: readonly FactCheck[],
  current?: { pageContentHash: string | null; evidenceBasis?: string | null }): FactCheck[] {
  return checks.filter((c) => c.state === "checked"
    && c.rulesVersion === VERIFICATION_RULES_VERSION
    && c.confidence === "confirmed"
    // A CORRECTION corrects wording the page carries, so only a wrong or imprecise verdict authorizes one. A row
    // with NO current wording is the other authorized shape: information the page LACKS, researched by the
    // missing-information loop; there is no quotation to grade, so the verdict is not the test, and the
    // authorization rests on the confirmed reading, the proposed statement, and the authoritative source below.
    && (c.verdict === "page_wrong" || c.verdict === "page_imprecise" || c.current.trim() === "")
    && !!c.proposed?.trim()
    && !!c.sourceReadAt
    // THE LOAD-BEARING AUTHORITY IS ONE WHOSE OWN QUOTE CAN CARRY THE WEIGHT: read, non-hedging, and about this
    // subject rather than a different name it derives from. Kind alone let a hypothesis and a homograph through.
    && c.sources.some((s) => (s.kind === "scholarly" || s.kind === "dictionary" || s.kind === "encyclopedia")
      && s.says.trim() !== "" && !HEDGED.test(s.says) && !definesOtherName(s.says, c.subject))
    && (!current || (c.pageContentHash != null && c.pageContentHash === current.pageContentHash
      && (current.evidenceBasis === undefined || (c.evidenceBasis ?? null) === (current.evidenceBasis ?? null)))));
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
