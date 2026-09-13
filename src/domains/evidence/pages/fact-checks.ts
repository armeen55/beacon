import "server-only";

/** Canonical tenant-scoped, row-wise factual evidence for owned pages and prospective topics.
 * Corrections bind to observed page versions; prospective propositions have no live body hash.
 * Sources and claim-support receipts survive independently of draft and runtime state. */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { asksAQuestion, AUTHORITATIVE_KIND, GLOSS_STOP, supportShortfall } from "./claim-support";
import type { ClaimSupport } from "./claim-support";
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

/** WHICH RULES PRODUCED A VERDICT, AND THERE ARE TWO SETS OF THEM. Version 1 searched the SUBJECT alone and banked `checked` on sources nobody read; version 2 searches the whole proposition; version 4 asks what the source was ABOUT, because versions 1 to 3 proved a quote was really in the passage they read and never once asked whether that passage was about the same subject, which live banked Cambridge on the English word "alluring", the OED on "dream" and Wikipedia's Slavic "Daria" as the meanings of Persian names, and version 4 also requires that the words a correction proposes are carried by a passage somebody actually read. A verdict from an earlier version is an unasked question rather than a finding: Decision may not act on it and the engine owes the claim again (Codex, 2026-08-18). Null reads as 1.
 *  AND A QUESTION THE PAGE DOES NOT ANSWER IS JUDGED UNDER RULES OF ITS OWN (reviewer, 2026-09-02). Version 5 was the prompt that names the page's own subject and the door that authorizes such a row on `page_correct` alone; before it, "are there cobras in iran" banked "Iran has AH-1 Cobra attack helicopters." as confirmed and the door let it through. IT DOES NOT MOVE FOR A REPAIR THAT ONLY ADDS ANSWERS (operator, 19:12 PDT): moving it withdrew every confirmed version-5 fact mid drive, the cobra demand row fell back from a draft to an evidence obligation and the jersey card's own cited fact would have been retired, so a repair reopens the exact rows it fixes and nothing else. Moving the one version would have owed all 974 checked rows on the account a paid unit each, so the rules a row is judged under follow its SHAPE: a question with no current wording is judged under 5, every other row under 4, unchanged. This is the one function that says which, asked wherever a version is stamped or compared. */
export const VERIFICATION_RULES_VERSION = 4, MISSING_ANSWER_RULES_VERSION = 5,
  rulesVersionFor = (c: { subject: string; current: string }): number =>
    c.current.trim() === "" && asksAQuestion(c.subject) ? MISSING_ANSWER_RULES_VERSION : VERIFICATION_RULES_VERSION;

export type FactCheck = {
  page: string;
  /** The subject this statement is about, canonicalized: the row's identity within its page. */
  statementKey: string;
  subject: string;
  current: string;
  proposed: string | null;
  literal: string | null;
  usage: string | null;
  /** `support` is this source's own ruling on THIS claim; `titleContext` is a heading from the SAME fetch,
   *  never a SERP title or a URL slug, which are discovery hints and prove nothing about a passage. */
  sources: Array<{ url: string; kind: SourceKind; says: string; groups?: string[]; groupExcerpts?: { heading: string; says: string }[]; sectionsRead?: boolean;
    titleContext?: string; titleContextFrom?: "fetched_document"; support?: ClaimSupport }>;
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

/** WHAT A CHECK ACTUALLY PROPOSES, and never a wording that only names the subject again (measured 2026-09-05 over all 972 checked statements on the account: FIFTEEN of the 490 carrying a proposal propose their own subject back, seven byte for byte and eight differing only in case, seven of them `confirmed`, and ONE of the fifteen is admitted as correction work by `authorizedCorrections` today). A correction is a wording a page can be MADE to read, and "Caspian Red Deer" proposed for the subject "Caspian Red Deer" is not one: where the page already says exactly that, acting on it changes nothing, and where the current line carries more ("Mashhad (3 million)", "Meaning:Water lily, pure and serene.") acting on it DELETES what the page says and explains nothing. Canonicalized by `statementKeyOf`, which is already the identity of a subject here, so spacing and case decide nothing. Asked at the reader so the fifteen on file propose nothing today at $0 and no write, and at the bank so none is ever written again, off ONE predicate so the two doors cannot disagree. Nothing else about the row moves: its sources, its agreement, its confidence and its verdict are what the reading found. */
const proposalOf = (subject: string, proposed: string | null): string | null =>
  proposed != null && statementKeyOf(proposed) === statementKeyOf(subject) ? null : proposed;

const decode = (r: Row): FactCheck => ({
  page: String(r.page_key ?? ""), statementKey: String(r.statement_key ?? ""), subject: String(r.subject ?? ""),
  current: String(r.current_wording ?? ""), proposed: proposalOf(String(r.subject ?? ""), (r.proposed as string | null) ?? null),
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
    proposed: c.confidence === "unsupported" ? null : proposalOf(c.subject.trim(), c.proposed),
    literal: c.literal, usage: c.usage,
    source_url: c.sources[0]?.url ?? null, source_quote: c.sources[0]?.says ?? null, source_class: c.sources[0]?.kind ?? null,
    sources: c.sources, agreement: c.agreement, confidence: c.confidence, verdict: c.verdict,
    also_at: c.alsoAt, note: c.note.slice(0, 800), evidence_basis: c.evidenceBasis,
    page_locator: c.pageLocator, source_read_at: c.sourceReadAt, claim_state: c.state ?? "checked", superseded_at: null,
    rules_version: c.rulesVersion ?? rulesVersionFor(c),
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
  pageContentHash: string | null, evidenceBasis: string | null): Promise<number> {
  const rows = claims.filter((c) => c.subject.trim() && c.statementKey).map((c) => ({
    tenant_id: tenantId, page_key: page, statement_key: c.statementKey, page_content_hash: pageContentHash,
    subject: c.subject.trim(), current_wording: c.current, page_locator: c.locator,
    sources: [], agreement: "none_found", confidence: "unsupported", verdict: "undecidable",
    also_at: [], note: "Owed: this page version makes this claim and no source has been read for it yet.",
    evidence_basis: evidenceBasis, claim_state: "owed", rules_version: rulesVersionFor(c),
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
export async function reopenObsoleteChecks(tenantId: string, page: string, stale: readonly FactCheck[], why?: string): Promise<number> {
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
      source_read_at: null, evidence_basis: g.evidenceBasis, rules_version: rulesVersionFor(g),
      note: why ?? "Owed again: the rules that produced the earlier verdict were replaced.", // the caller names the rule that sent it back when the replaced rules are not the reason
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

/** THE WORDS OF A SHORT FACTUAL CORRECTION MUST COME FROM THE QUOTE ITS RECEIPT WILL SHOW. Live, "Mountain
 *  Rampart" was confirmed because those words appear in the fetched page one sentence PAST the banked quote
 *  ("derived from Hara Barazaiti..."), so the customer receipt could not support the published claim; and the
 *  model's `literal` field held the page's own wrong line on both defective rows, so nothing model-produced
 *  may vouch for itself. THIS IS A PROVENANCE TEST, NOT ENTAILMENT: it proves the gloss's words were taken
 *  from the quote, never that the quote asserts the proposition (words from inside a quote can still be
 *  reassembled into a wrong meaning, which the paid reviewer remains the residual defense against, by
 *  explicit decision). Matching is whole-token with digit de-grouping and plain inflection stems; nothing
 *  guesses synonyms, translation or semantic equivalence, and these rules apply ONLY to the correction shape
 *  (a row correcting current wording), never to any other proposal family. */
const foldText = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/(\d),(?=\d)/g, "$1");
const allTokens = (t: string): string[] => foldText(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const contentTokens = (t: string): string[] => allTokens(t).filter((w) => w.length >= 4 && !GLOSS_STOP.has(w));
/** One word's plain stems: -ies to -y, then one -ing/-es/-ed/-s/-d strip. Never shorter than three letters. */
const stems = (w: string): string[] => { const a = w.replace(/ies$/u, "y"), b = w.replace(/(?:ing|es|ed|s|d)$/u, "");
  return [w, ...(a !== w && a.length >= 3 ? [a] : []), ...(b !== w && b.length >= 3 ? [b] : [])]; };
/** Every content word of the short gloss appears AS A WORD in the quotes (raw substring authorized "Light"
 *  off "delight" and "Seas" off "search"); a gloss with no content-sized word (the real Darya gloss "Sea", a
 *  bare figure) must appear whole rather than passing vacuously. */
export function glossCarriedBy(proposed: string, quotes: readonly string[]): boolean {
  const said = new Set(allTokens(quotes.join(" ")).flatMap(stems));
  const hit = (w: string): boolean => stems(w).some((v) => said.has(v));
  const tokens = contentTokens(proposed);
  if (tokens.length > 0) return tokens.every(hit);
  const small = allTokens(proposed).filter((w) => !GLOSS_STOP.has(w));
  return small.length > 0 && small.every(hit);
}
/** A PROPOSAL THAT IS THE QUOTE IS A CITATION, NOT A GLOSS: the Jasmine card offered Wikipedia's own
 *  derivation sentence as the page's "Meaning:" line, narration standing where every sibling entry holds a
 *  compact phrase. A compact gloss is SUPPOSED to appear inside its quote; a long lift of the quote means no
 *  meaning was ever extracted. The live quote inserts "romanized" mid-lift, so the test is an ORDERED token
 *  subsequence rather than a contiguous run, and forty bare characters is where a carried phrase ends and a
 *  copied sentence begins. */
const bareAll = (t: string): string => foldText(t).replace(/[^\p{L}\p{N}]+/gu, "");
const tokensOf = (t: string): string[] => foldText(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function citationOfQuote(proposed: string, quotes: readonly string[], current = ""): boolean {
  // The register is set by the slot: a statement-sized correction may legitimately match its quote (the Ahvaz
  // heat record replaces one full statement with another), so the refusal also requires the proposal to
  // OUTGROW the wording it replaces. Narration standing in a compact line fails both ways at once.
  const p = bareAll(proposed);
  if (p.length < 40 || p.length <= 1.5 * bareAll(current).length) return false;
  const pt = tokensOf(proposed);
  return quotes.some((q) => { const qt = tokensOf(q); let i = 0;
    for (const w of qt) if (w === pt[i]) { i += 1; if (i === pt.length) return true; }
    return false; });
}
/** THE CORRECTION AS BOTH ENDS SEE IT: the evidence run judges a candidate before banking it and the card door
 *  judges the banked row, through the ONE rule below, so a row can never be banked `confirmed` and then be
 *  refused at the door for ever, reopened, re-researched and refused again. `FactCheck` satisfies this. */
type CorrectionCandidate = { subject: string; current: string; proposed: string | null; verdict?: string;
  /** `support` is this source's own artifact ruling on THIS claim, absent where none was ever derived. */
  sources: readonly { kind: SourceKind; says: string; groups?: string[]; support?: ClaimSupport }[] };

/** WHY A CORRECTION MAY NOT BE PUBLISHED, in one typed sentence, or null. THE ONE AUTHORIZATION RULE, asked by
 *  the evidence run before it banks and by the card door before it offers, so a refusal, a withdrawal and a
 *  confidence can never drift apart.
 *
 *  EVERY MATERIAL WORD COMES FROM THE AUTHORITATIVE SET, NOT MERELY ONE OF THEM. Authority and wording were
 *  asked independently, then bound only by "an authoritative source contributed something", which live left
 *  Parisa publishing "beautiful like a fairy" while its encyclopedia said only "fairy-like" and "beautiful"
 *  came from a baby-name publisher alone. An ordinary source may CORROBORATE wording the authoritative quotes
 *  already carry; it may never supply a word of it. That is the whole boundary: it decides which sources may
 *  speak, never what their words mean, and semantic reassembly stays the paid reviewer's residual. */
export function unauthorizedReason(c: CorrectionCandidate): string | null {
  const qualified = c.sources.filter((s) => s.says.trim() !== "" && !HEDGED.test(s.says) && !definesOtherName(s.says, c.subject)), additive = c.current.trim() === "";
  /* AND THE AUTHORITY IT OWES IS PROPORTIONAL TO WHAT IT RISKS (operator, 2026-09-01, stated for sections at decision/completeness's `openHold`: an addition owes ONE publisher, a replacement owes two). A CORRECTION replaces words the page publishes, so every material word of it may be supplied only by an authoritative KIND, which is the Parisa boundary above. A MISSING ANSWER adds a sentence the page does not carry and a reader undoes by deleting it, so it also stands on a publisher that was READ and whose own stored passage is shown to entail this exact claim, which is the strongest thing this codebase can know about a source and is stronger than its kind. Measured on the acceptance account (2026-09-05): the pre-1979 flag answer is quote-bound to a publisher that was fetched, while the encyclopedia beside it banked an empty passage, so the kind test alone refused a reading nothing else was wrong with. No publisher list lives here or anywhere: a host earns this by having been read and by carrying the claim. */ const authoritative = qualified.filter((s) => AUTHORITATIVE_KIND.has(s.kind) || (additive && s.support?.supported === true));
  if (authoritative.length === 0) return additive ? "no publisher that was read carries a passage of its own standing behind this answer" : "no authoritative source that was read, is unhedged and is about this subject stands behind it";
  // A ROW WITH NO CURRENT WORDING IS TESTED BY ITS VERDICT, AND HERE BY NOTHING ELSE (reviewer, 2026-09-02): it proposes what the page LACKS, so there is no quotation to grade, and the only thing that says the researched statement answers the question this page's own subject was researched for is `page_correct`. Live at 17:03 PDT on /iran-animals/persian-cobra: the sources were about AH-1 Cobra attack helicopters, the judge said exactly that and answered `undecidable`, and this door read the confirmed reading alone and authorized "Iran has AH-1 Cobra attack helicopters." as the missing fact for a page about a snake. AND THE REFUSAL NAMES WHICH FAILURE IT IS: under `page_wrong` or `page_imprecise` the judge DID answer and returned a correction verdict for a question the page does not answer, so the sentence about a different subject is false there, and three live rows on /persian-female-first-names carry exactly that shape.
  if (c.current.trim() === "" || !c.proposed?.trim()) return c.current.trim() === "" && c.verdict !== "page_correct" ? (c.verdict === "page_wrong" || c.verdict === "page_imprecise" ? "the judge returned a correction verdict for a question the page does not answer, so no statement is authorized" : "the judge did not answer the question about this page's own subject, so the statement proposed is about something else") : null;
  const quotes = authoritative.map((s) => s.says);
  if (!glossCarriedBy(c.proposed, quotes)) return "the authoritative quotes do not carry every word of the proposal, so part of the wording stands only on an ordinary source";
  if (citationOfQuote(c.proposed, quotes, c.current)) return "the proposal restates the source's own sentence instead of giving the page's line a meaning";
  return null;
}

export function authorizedCorrections(checks: readonly FactCheck[],
  current: { pageContentHash: string | null; evidenceBasis?: string | null } | undefined,
  tenantId: string): FactCheck[] {
  return checks.filter((c) => (c.state === "checked"
    && c.rulesVersion === rulesVersionFor(c)
    && c.agreement !== "sources_conflict"
    // THE GRADE IT OWES IS THE GRADE ITS TREATMENT RISKS, NOT ONE GRADE FOR EVERYTHING (operator's proportional rule, 2026-09-01; measured 2026-09-05). `confirmed` is what two independent sources earn between them, and it is right for a CORRECTION, which replaces published words and whose mistake survives until somebody notices it. An ADDITIVE answer states what the page never said, and a reader undoes it by deleting the sentence, so the operator's own section rule already asks one publisher for it. Held to `confirmed`, the account's whole missing-answer lane was dead: the money was spent every drive, the reading landed with its sources against the right page version, and the row owed the identical purchase again for ever. `likely` is a reading two ordinary sources or one authoritative one carried; `disputed` and `unsupported` are refused here as they always were, and the authority, subject-identity and quote-binding rule below is asked of an addition exactly as hard.
    && (c.current.trim() === "" ? c.confidence === "confirmed" || c.confidence === "likely" : c.confidence === "confirmed")
    // A CORRECTION corrects wording the page carries, so only a wrong or imprecise verdict authorizes one. A row
    // with NO current wording is the other authorized shape: information the page LACKS, researched by the
    // missing-information loop, and ITS verdict is the test too, asked once by the one rule below, which
    // authorizes such a row on `page_correct` alone: the answer has to be about this page's own subject.
    && (c.verdict === "page_wrong" || c.verdict === "page_imprecise" || c.current.trim() === "")
    && !!c.proposed?.trim()
    && !!c.sourceReadAt
    // AUTHORITY, SUBJECT IDENTITY AND QUOTE-BOUND WORDING, asked once, by the one rule above.
    && unauthorizedReason(c) == null
    // AND THE SOURCE'S OWN PASSAGE MUST SUPPORT THE EXACT CLAIM (claim-support, 2026-08-29): a correction may
    // stand only on a source whose current artifact carries this proposal, so a passage that merely discusses
    // the subject authorizes nothing. Missing-information rows keep their own contract inside the shortfall.
    && supportShortfall(c, tenantId) == null
    && (!current || (c.pageContentHash != null && c.pageContentHash === current.pageContentHash
      && (current.evidenceBasis === undefined || (c.evidenceBasis ?? null) === (current.evidenceBasis ?? null))))));
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
