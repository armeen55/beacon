import "server-only";

/** evidence/pages/fact-check-run - ONE CLAIM, RESEARCHED PROPERLY, PER RENEWED LEASE. The first live runs
 *  proved four ways a unit can look like research without being it (Codex, 2026-08-18): a query built from the
 *  SUBJECT alone researched "Ahvaz definition" for a heat-record claim; sources found but unreadable were
 *  banked as checked, permanently clearing work nobody did; a truncated 12,000-character sample was called the
 *  whole page; and two encyclopedia pages counted as agreement because they ranked first.
 *
 *  WHAT IT IS NOW. The persisted inventory is the cursor and coverage is persisted with it, so a page is only
 *  complete when every stored section was inventoried AND every claim is current. Acquisition searches the
 *  WHOLE PROPOSITION, never the subject alone. Every failure is TYPED and leaves the claim owed; only a
 *  readable world may settle one. `confirmed` requires a quote inside a fetched authoritative passage. */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { recordFactChecks, recordOwedClaims, supersedeStaleFacts, statementKeyOf,
  type FactCheck, type InventoryCoverage, type SourceKind } from "./fact-checks";

const EMPTY_ROW = { proposed: null, literal: null, usage: null, sources: [], agreement: "none_found" as const,
  confidence: "unsupported" as const, verdict: "undecidable" as const, alsoAt: [], note: "", sourceReadAt: null };

/** How many candidate sources one claim weighs, and how many it will actually fetch. */
const CANDIDATES = 6, FETCH_PER_CLAIM = 2;
/** A call is only started when this much of the deadline remains, so its result can always be persisted. */
const RESERVE_MS = 8_000;
/** One extraction reads this much of the stored body. NEVER the definition of the page: coverage is persisted
 *  and a page is complete only when every stored section was inventoried (Codex, 2026-08-18). */
export const EXTRACT_CHUNK = 12_000;
/** CLAIM ATTEMPTS one pass may make, GLOBAL across every page it touches, counting successes, failures and
 *  waits alike: the old per-page nesting advertised four and allowed twelve (Codex, 2026-08-18). */
export const ATTEMPTS_PER_PASS = 4;

const SCHOLARLY = /(^|\.)(iranicaonline\.org|dsal\.uchicago\.edu|jstor\.org|academia\.edu|brill\.com|oup\.com|cambridge\.org|nih\.gov|who\.int)$|\.(edu|gov|ac\.[a-z]{2})$/i;
const DICTIONARY = /(^|\.)(wiktionary\.org|merriam-webster\.com|oed\.com|dehkhoda\.ut\.ac\.ir|vajehyab\.com|abadis\.ir|collinsdictionary\.com)$/i;
const ENCYCLOPEDIA = /(^|\.)(wikipedia\.org|britannica\.com|encyclopedia\.com)$/i;
const REFERENCE = /(^|\.)(behindthename\.com|nameberry\.com|ethnologue\.com|statista\.com|census\.gov)$/i;
const BABYNAME = /(baby|names?)[-.]?(names?|meaning|central|nology)|(^|\.)(momjunction|pampers|thebump|babycenter|parents)\./i;

function sourceClassOf(domain: string): SourceKind {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (SCHOLARLY.test(d)) return "scholarly";
  if (DICTIONARY.test(d)) return "dictionary";
  if (ENCYCLOPEDIA.test(d)) return "encyclopedia";
  if (REFERENCE.test(d)) return "reference";
  if (BABYNAME.test(d)) return "babyname";
  return "community";
}
const AUTHORITATIVE = new Set<SourceKind>(["scholarly", "dictionary", "encyclopedia"]);

export const pageHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);

/** WHAT KIND OF CLAIM THIS IS, which SHAPES how you look for a source but never erases what is being verified.
 *  Deterministic and total: an unrecognised claim is a plain definition, which searches plainly. */
export type ClaimType = "word_meaning" | "date_or_event" | "quantity" | "definition" | "specification" | "entity_fact" | "geography";

export function claimTypeOf(subject: string, current: string): ClaimType {
  const t = `${subject} ${current}`.toLowerCase();
  if (/\b(means?|meaning|derives?|derived|etymolog|origin of the name|name meaning|translat)/.test(t)) return "word_meaning";
  if (/\b(1[0-9]{3}|20[0-9]{2}|bce?\b|ad\b|century|founded|born|died|dynasty|war|revolution|treaty)\b/.test(t)) return "date_or_event";
  // Records and measurements are quantities: "hottest day at 54 °C" is not a definition (Codex, 2026-08-18).
  if (/\b(\d[\d,.]*\s*(percent|%|million|billion|thousand|km|miles|kg|people|residents|users)|population|average|median|rate|record|hottest|coldest|largest|smallest|tallest|longest|highest|lowest|temperature|degrees)\b|°/.test(t)) return "quantity";
  if (/\b(located|capital|province|region|city of|river|mountain|border)\b/.test(t)) return "geography";
  if (/\b(model|version|specification|dimensions|weight|material|capacity|voltage)\b/.test(t)) return "specification";
  if (/\b(is a|was a|founder|ceo|author|invented|composer|poet|king|shah)\b/.test(t)) return "entity_fact";
  return "definition";
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "its", "are", "was", "were", "has",
  "have", "had", "holds", "hold", "held", "also", "ever", "been", "not", "which", "their", "there", "into", "over"]);

/** THE SEARCH IS THE PROPOSITION. The subject alone researched "Ahvaz, Iran definition reference" for the
 *  claim that Ahvaz holds Asia's 54 degree heat record (Codex, 2026-08-18): the claim type may shape the
 *  query, but it may never erase the date, number, relationship or assertion being verified. */
export function sourceQueryFor(type: ClaimType, subject: string, current: string): string {
  const seen = new Set<string>(); const toks: string[] = [];
  for (const raw of `${subject} ${current}`.replace(/[()"]/g, " ").split(/\s+/)) {
    const t = raw.replace(/[.,;:!?]+$/g, "");
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    if (/[\d°]/.test(k) || (k.length >= 3 && !STOP.has(k))) { seen.add(k); toks.push(t); }
    if (toks.length >= 14) break;
  }
  const hint = type === "word_meaning" ? " meaning etymology" : type === "date_or_event" ? " history" : "";
  return `${toks.join(" ")}${hint}`.trim();
}

/** A STATEMENT'S IDENTITY is the normalized claim plus where it sits, never the subject alone: a page can say
 *  two different things about one subject and both are real (Codex, 2026-08-18). */
export function claimIdentity(subject: string, current: string, locator?: string | null): string {
  const norm = `${subject}|${current}|${locator ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return `${statementKeyOf(subject)}#${createHash("sha256").update(norm).digest("hex").slice(0, 10)}`;
}

/** THE PROPOSITION'S OWN FINGERPRINT: the sorted content tokens of subject + wording. Two reformulations of
 *  one fact (the live /ahvaz inventory carried the population and the heat record several ways each) share a
 *  key and are researched ONCE; the duplicates are superseded for free (Codex, 2026-08-18). */
export function dedupeKeyOf(subject: string, current: string): string {
  const toks = `${subject} ${current}`.toLowerCase().replace(/[^\p{L}\p{N}° ]+/gu, " ").split(/\s+/)
    .filter((t) => t.length > 0 && (/[\d°]/.test(t) || (t.length >= 4 && !STOP.has(t))));
  return [...new Set(toks)].sort().join(" ");
}

const CLAIM_SYSTEM = 'You read one web page and list the statements on it that an outside source could confirm or contradict. '
  + 'Return ONLY {"statements":[{"subject","current","locator"}]}: `subject` is what the statement is about as the page writes it; '
  + '`current` is the page\'s own wording, quoted exactly; `locator` is where it sits (the heading or section it is under). '
  + 'Only statements of FACT about the world. Never marketing copy, navigation, or anything about the page itself. At most 40.';

const JUDGE_SYSTEM = 'You compare ONE statement a web page makes against PASSAGES QUOTED FROM SOURCES THAT WERE ACTUALLY FETCHED. '
  + 'Return ONLY {"verdict","proposed","literal","usage","agreement","confidence","supportingQuote","note"}. '
  + 'verdict: page_correct | page_wrong | page_imprecise | undecidable. confidence: confirmed | likely | disputed | unsupported. '
  + 'You may answer "confirmed" ONLY when the passages you were given state the corrected fact plainly and at least one is from a scholarly, dictionary or encyclopedia source. '
  + '`supportingQuote` MUST be copied verbatim from one of the passages; if you cannot quote one, answer unsupported and propose nothing. '
  + 'Distinguish literal etymology from modern usage: a page recording a live usage is not automatically wrong. Never invent a replacement.';

type Extracted = { statements: { subject: string; current: string; locator?: string }[] };
type Judged = { verdict: FactCheck["verdict"]; proposed: string; literal: string; usage: string;
  agreement: FactCheck["agreement"]; confidence: FactCheck["confidence"]; supportingQuote: string; note: string };

/** The one model call a unit may make. `kind` names the STRUCTURED OUTPUT SCHEMA the answer must satisfy, so
 *  a caller cannot quietly ask the editor judge for a claim list and read zero statements for ever. */
export type StructuredRead = (input: { kind: "fact_claim_extraction" | "fact_claim_judgement";
  system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number })
  => Promise<Record<string, unknown> | null>;

/** WHY A UNIT FAILED, as an identity a later reader can act on: a cap, a queue wait, a timeout and a schema
 *  refusal are different debts, and one generic sentence hid which of them repeated paid attempts were hitting
 *  (Codex, 2026-08-18). Every failure leaves the claim OWED. */
type UnitFailure = "no_page_body" | "lease_exhausted" | "extraction_unavailable" | "inventory_write_failed"
  | "search_capped" | "search_waiting" | "search_unavailable" | "fetch_unavailable" | "judge_unavailable"
  | "store_write_failed" | "lease_lost";

/** A search answer: readable results, a TYPED provider hold, or null (transport failure). Only the readable
 *  shape may ever settle a claim. */
export type SearchAnswer = { organic: { domain: string; url: string; title: string | null }[] }
  | { hold: "capped" | "waiting" | "unavailable" };

/** WHERE THE PAGE STANDS, read back from the persisted inventory rather than carried in a lease. */
export type FactCheckCursor = {
  page: string; pageContentHash: string | null; evidenceBasis: string | null;
  /** How many of this page version's claims are researched, out of how many are inventoried SO FAR. */
  checked: number; total: number;
  /** True ONLY when every stored section was inventoried AND every claim is current. */
  pageComplete: boolean;
};

type FactCheckUnitDeps = {
  read: StructuredRead;
  searchSources?: (query: string) => Promise<SearchAnswer | null>;
  /** THE SOURCE ITSELF: fetch and parse one URL. Absent, or answering null, means nothing may be confirmed. */
  fetchSource?: (url: string) => Promise<{ text: string } | null>;
  page: { url: string; path: string; body: string };
  tenantId: string; now: Date; basis: string | null;
  /** Checks already on file for this page, so a current one is skipped and a stale one is redone. */
  held?: readonly FactCheck[];
  /** HOW MUCH OF THE BODY HAS BEEN INVENTORIED, persisted: absent (tests) starts from zero each call. */
  readCoverage?: () => Promise<InventoryCoverage | null>;
  writeCoverage?: (cov: InventoryCoverage) => Promise<boolean>;
  /** The absolute instant this unit must be finished by. */
  deadlineAt: number;
};

/** WHAT ONE UNIT DID. `advanced` = durable progress was STORED (a claim banked, or the next section
 *  inventoried). `done` = this page version owes nothing at full coverage. `failed` = nothing advanced and the
 *  claim is still owed, which is not the same answer and must never move a run on to publishing. */
export type FactCheckUnitResult = { status: "advanced" | "done" | "failed"; banked: number;
  cursor: FactCheckCursor | null; failure?: UnitFailure; reason?: string };

const enough = (deadlineAt: number, need: number): boolean => Date.now() + need + RESERVE_MS <= deadlineAt;
const fail = (failure: UnitFailure, cursor: FactCheckCursor | null, reason: string): FactCheckUnitResult =>
  ({ status: "failed", banked: 0, cursor, failure, reason });

/** ONE unit: at most one claim researched (or one section inventoried), everything durable before it returns. */
export async function runFactCheckUnit(d: FactCheckUnitDeps): Promise<FactCheckUnitResult> {
  const { tenantId, page, now } = d;
  if (!page.body.trim()) return fail("no_page_body", null, "no stored words for this page");
  const hash = pageHashOf(page.body);

  // 1. THE CLAIM INVENTORY FOR THIS PAGE VERSION AND ITS COVERAGE, READ BACK FROM THE STORE: a lease lost mid
  // page resumes where it stopped, and completeness outlives the pass. Coverage is what keeps a long page
  // honest: the first 12,000 characters are a SECTION, never the page (Codex, 2026-08-18).
  const mine = (d.held ?? []).filter((h) => h.page === page.path);
  let inventory = mine.filter((h) => h.pageContentHash === hash && h.state !== "superseded");
  const covRead = d.readCoverage ? await d.readCoverage().catch(() => null) : null;
  let cov: InventoryCoverage = covRead && covRead.pageContentHash === hash
    ? covRead : { pageContentHash: hash, coveredChars: 0, totalChars: page.body.length };

  let owed = inventory.filter((h) => h.state === "owed");
  if (owed.length === 0 && cov.coveredChars < cov.totalChars) {
    // EXTRACT THE NEXT SECTION. Only when nothing already inventoried is owed: research first, read on.
    if (!enough(d.deadlineAt, 20_000)) return fail("lease_exhausted", null, "not enough of this lease remains to read the page");
    const chunk = page.body.slice(cov.coveredChars, cov.coveredChars + EXTRACT_CHUNK);
    const extracted = await d.read({ kind: "fact_claim_extraction", system: CLAIM_SYSTEM,
      user: `Page: ${page.url}\n\nIts stored words (section starting at character ${cov.coveredChars}):\n${chunk}\n\nReturn the JSON now.`,
      grounded: chunk, projectedCostUsd: 0.02, maxTokens: 3000 }).catch(() => null);
    if (!extracted) return fail("extraction_unavailable", null, "the page's checkable statements could not be read");
    const knownIds = new Set(inventory.map((h) => h.statementKey));
    const knownProps = new Set(inventory.map((h) => dedupeKeyOf(h.subject, h.current)));
    const claims = ((extracted as unknown as Extracted).statements ?? [])
      .filter((s) => s.subject?.trim() && s.current?.trim())
      .map((s) => ({ subject: s.subject.trim(), current: s.current.trim(), locator: s.locator?.trim() || null }))
      .map((c) => ({ ...c, statementKey: claimIdentity(c.subject, c.current, c.locator), prop: dedupeKeyOf(c.subject, c.current) }))
      // One row per identity AND one per proposition: reformulations of one fact are researched once.
      .filter((c, i, all) => all.findIndex((x) => x.statementKey === c.statementKey) === i)
      .filter((c, i, all) => all.findIndex((x) => x.prop === c.prop) === i)
      .filter((c) => !knownIds.has(c.statementKey) && !knownProps.has(c.prop));
    if (cov.coveredChars === 0) {
      // THE PAGE MOVED ON: whatever was held against an older version, or objects to wording this version no
      // longer carries, becomes history now rather than a second live instruction beside its own replacement.
      const body = page.body.toLowerCase();
      await supersedeStaleFacts(tenantId, page.path, hash, (current) => body.includes(current.trim().toLowerCase()))
        .catch((e) => { log.warn("[fact-check] stale claims could not be retired", { tenantId, page: page.path, error: String(e) }); return 0; });
    }
    // THE INVENTORY AND ITS COVERAGE ARE THE CURSOR, stored BEFORE one claim is researched. A write that did
    // not land is a failed unit: researching against an inventory nobody stored is how page two was lost.
    const wrote = claims.length === 0 ? 0 : await recordOwedClaims(tenantId, page.path, claims, hash, d.basis).catch(() => -1);
    if (wrote < 0) return fail("inventory_write_failed", null, "the page's claim inventory could not be stored, so nothing was researched");
    cov = { pageContentHash: hash, coveredChars: Math.min(cov.coveredChars + chunk.length, page.body.length), totalChars: page.body.length };
    if (d.writeCoverage && !(await d.writeCoverage(cov).catch(() => false)))
      return fail("inventory_write_failed", null, "the section's coverage could not be stored, so it would be read and paid for again");
    inventory = [...inventory, ...claims.map((c) => ({ ...EMPTY_ROW, page: page.path, statementKey: c.statementKey,
      subject: c.subject, current: c.current, pageLocator: c.locator, pageContentHash: hash, evidenceBasis: d.basis,
      state: "owed" as const, checkedAt: now.toISOString() }))];
    owed = inventory.filter((h) => h.state === "owed");
  }

  // 2. THE NEXT OWED CLAIM WHOSE PROPOSITION IS NOT ALREADY SETTLED. A duplicate of a checked fact is
  // superseded for free, never researched and paid for again.
  const settled = new Set(inventory.filter((h) => h.state === "checked").map((h) => dedupeKeyOf(h.subject, h.current)));
  let next: FactCheck | null = null;
  for (const o of owed) {
    if (!settled.has(dedupeKeyOf(o.subject, o.current))) { next = o; break; }
    const ok = await recordFactChecks(tenantId, page.path, [{ ...o, state: "superseded",
      note: "Duplicate of a proposition already checked at this page version." }]).catch(() => 0);
    if (ok > 0) owed = owed.filter((x) => x !== o);
  }
  const progress = { page: page.path, pageContentHash: hash, evidenceBasis: d.basis,
    checked: inventory.length - owed.length, total: inventory.length };
  const covered = cov.coveredChars >= cov.totalChars;
  if (!next) {
    return covered
      ? { status: "done", banked: 0, cursor: { ...progress, pageComplete: true }, reason: "every claim on this page version is current and the whole stored body was inventoried" }
      : { status: "advanced", banked: 0, cursor: { ...progress, pageComplete: false }, reason: `inventoried through character ${cov.coveredChars} of ${cov.totalChars}; more of the page remains` };
  }
  const claim = { subject: next.subject, current: next.current, locator: next.pageLocator };
  const cursor: FactCheckCursor = { ...progress, pageComplete: false };
  const advance: FactCheckCursor = { ...progress, checked: progress.checked + 1, pageComplete: covered && owed.length === 1 };
  const type = claimTypeOf(claim.subject, claim.current);

  const bank = async (row: FactCheck): Promise<FactCheckUnitResult> => {
    const banked = await recordFactChecks(tenantId, page.path, [row]);
    log.info("[fact-check] one claim researched", { tenantId, page: page.path, subject: claim.subject, type, confidence: row.confidence, banked });
    // A WRITE THAT DID NOT LAND IS A FAILED UNIT: advancing past a claim nothing stored would skip it forever.
    return banked > 0 ? { status: "advanced", banked, cursor: advance }
      : fail("store_write_failed", cursor, "the result could not be stored, so this claim is still owed");
  };
  const base = { page: page.path, statementKey: next.statementKey, state: "checked" as const, subject: claim.subject, current: claim.current,
    literal: null, usage: null, alsoAt: claim.locator ? [claim.locator] : [],
    pageContentHash: hash, pageLocator: claim.locator, sourceReadAt: null as string | null,
    evidenceBasis: d.basis, checkedAt: now.toISOString() };

  // 3. ACQUIRE candidates by searching THE PROPOSITION, shaped but never erased by the claim type.
  if (!d.searchSources || !enough(d.deadlineAt, 15_000)) return fail("lease_exhausted", cursor, "no lease left to look for sources");
  const found = await d.searchSources(sourceQueryFor(type, claim.subject, claim.current)).catch(() => null);
  // A PROVIDER THAT DID NOT ANSWER IS NOT A WORLD WITH NO SOURCES: capped, waiting or failed leaves the claim
  // OWED under its own name, and only a readable answer with no qualifying source banks `none_found`.
  if (found == null) return fail("search_unavailable", cursor, "the source search did not answer, so this claim is still owed");
  if ("hold" in found) return fail(`search_${found.hold}`, cursor, `the source search is ${found.hold}, so this claim is still owed`);
  // ONE CANDIDATE PER PUBLISHER: agreement must mean independent publishers, never one site twice.
  const seenDomains = new Set<string>();
  const candidates = (found.organic ?? []).slice(0, CANDIDATES)
    .map((o) => ({ url: o.url, domain: o.domain.replace(/^www\./, "").toLowerCase(), kind: sourceClassOf(o.domain), title: o.title ?? "" }))
    .filter((c) => c.kind !== "community" && c.kind !== "babyname")
    .filter((c) => !seenDomains.has(c.domain) && seenDomains.add(c.domain) !== undefined)
    .sort((a, b) => (AUTHORITATIVE.has(b.kind) ? 1 : 0) - (AUTHORITATIVE.has(a.kind) ? 1 : 0));
  if (candidates.length === 0) {
    return bank({ ...base, proposed: null, sources: [], agreement: "none_found", confidence: "unsupported",
      verdict: "undecidable", note: "The search was readable and no source of any authority came back for this claim, so nothing is proposed." });
  }
  // PUBLISHER-DIVERSE PICKS: the second fetch prefers a DIFFERENT source class, so two generic encyclopedia
  // pages are not taken merely because they rank first (Codex, 2026-08-18).
  const second = candidates.slice(1).find((c) => c.kind !== candidates[0]!.kind) ?? candidates[1];
  const picks = [candidates[0]!, ...(second ? [second] : [])].slice(0, FETCH_PER_CLAIM);

  // 4. READ THE SOURCES. A title is not a fact, and A SOURCE NOBODY READ NEVER CLEARS THE CLAIM: when every
  // fetch fails the claim stays OWED, because "the evidence disproved nothing" and "the infrastructure could
  // not read the evidence" are different answers (Codex, 2026-08-18).
  const passages: { url: string; kind: SourceKind; text: string; readAt: string }[] = [];
  for (const c of picks) {
    if (!d.fetchSource || !enough(d.deadlineAt, 20_000)) break;
    const got = await d.fetchSource(c.url).catch(() => null);
    if (got?.text?.trim()) passages.push({ url: c.url, kind: c.kind, text: got.text.slice(0, 6_000), readAt: new Date().toISOString() });
  }
  if (passages.length === 0) return fail("fetch_unavailable", cursor, "sources were found but none could be read, so this claim is still owed");

  // 5. JUDGE against the passages only.
  if (!enough(d.deadlineAt, 20_000)) return fail("lease_exhausted", cursor, "no lease left to judge this claim");
  const judged = await d.read({ kind: "fact_claim_judgement", system: JUDGE_SYSTEM,
    user: [`Claim type: ${type}`, `Subject: ${claim.subject}`, `The page says: "${claim.current}"`,
      "Passages fetched from real sources:",
      ...passages.map((p) => `--- [${p.kind}] ${p.url}\n${p.text}`), "", "Return the JSON now."].join("\n"),
    grounded: passages.map((p) => p.text).join("\n"), projectedCostUsd: 0.02, maxTokens: 1500 }).catch(() => null);
  if (!judged) return fail("judge_unavailable", cursor, "the claim could not be judged this pass, so it is still owed");
  const v = judged as unknown as Judged;
  const quote = (v.supportingQuote ?? "").trim();
  // A QUOTE MAY NOT BORROW ANOTHER SOURCE'S AUTHORITY: the WHOLE normalized quote must appear in one passage
  // and is credited to THAT source alone (Codex, 2026-08-18).
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
  const owner = quote.length > 0 ? passages.find((p) => norm(p.text).includes(norm(quote))) ?? null : null;
  // AGREEMENT IS COUNTED, never accepted from the model: how many fetched publishers carry the supporting words.
  const carriers = quote.length > 0 ? passages.filter((p) => norm(p.text).includes(norm(quote))) : [];
  const agreement: FactCheck["agreement"] = carriers.length > 1 ? "multiple_agree"
    : carriers.length === 1 ? "single_source" : "none_found";
  const confirmable = owner != null && AUTHORITATIVE.has(owner.kind);
  const confidence: FactCheck["confidence"] = v.confidence === "confirmed" && confirmable ? "confirmed"
    : v.confidence === "unsupported" ? "unsupported" : v.confidence === "disputed" ? "disputed" : "likely";
  return bank({ ...base,
    proposed: confidence === "unsupported" ? null : (v.proposed?.trim() || null),
    literal: v.literal?.trim() || null, usage: v.usage?.trim() || null,
    // Only the source that actually carried the words is credited with them.
    sources: passages.map((p) => ({ url: p.url, kind: p.kind, says: carriers.includes(p) ? quote.slice(0, 600) : "" })),
    sourceReadAt: owner?.readAt ?? null,
    agreement, confidence, verdict: v.verdict,
    note: `${v.note ?? ""}${owner ? "" : " No fetched passage carries the quote it relied on, so this is held below confirmed."}`.trim() });
}

export type FactCheckPassDeps = {
  tenantId: string; basis: string | null; deadlineAt: number;
  /** Pages in the order they should be worked, bodies loaded lazily so an untouched page costs nothing. */
  pages: { url: string; path: string; loadBody: () => Promise<string> }[];
  /** Every row on file for this account (the store's own read, '#' rows excluded). */
  held: FactCheck[];
  /** Re-read one page's rows after a durable write, so the next unit sees what just landed. */
  refreshHeld: (page: string) => Promise<FactCheck[] | null>;
  /** The lease, re-earned before every attempt: money is about to be spent under it. */
  renew?: () => Promise<boolean>;
  read: StructuredRead;
  searchSources: (query: string) => Promise<SearchAnswer | null>;
  fetchSource: (url: string) => Promise<{ text: string } | null>;
  readCoverage: (page: string) => Promise<InventoryCoverage | null>;
  writeCoverage: (page: string, cov: InventoryCoverage) => Promise<boolean>;
};

export type FactCheckPassResult = { status: "advanced" | "done" | "failed"; banked: number;
  pagesComplete: number; attempts: number; failure?: UnitFailure; reason?: string };

/** ONE PASS: at most ATTEMPTS_PER_PASS claim attempts GLOBALLY, however many pages that spans. A failed unit
 *  ends the pass with its typed identity, because a cap or an outage repeats on the next attempt and burning
 *  the remaining allowance against it proves nothing. */
export async function runFactCheckPass(d: FactCheckPassDeps): Promise<FactCheckPassResult> {
  let banked = 0, pagesComplete = 0, attempts = 0, progressed = false;
  let held = d.held;
  for (const page of d.pages) {
    if (attempts >= ATTEMPTS_PER_PASS || Date.now() >= d.deadlineAt) break;
    const body = await page.loadBody().catch(() => "");
    if (!body.trim()) continue;
    while (attempts < ATTEMPTS_PER_PASS && Date.now() < d.deadlineAt) {
      if (d.renew && !(await d.renew().catch(() => false)))
        return { status: banked > 0 ? "advanced" : "failed", banked, pagesComplete, attempts, failure: "lease_lost", reason: "the lease was lost, so nothing further was researched" };
      attempts += 1; // EVERY attempt counts: banked, failed and waiting alike.
      const out = await runFactCheckUnit({ tenantId: d.tenantId, now: new Date(), basis: d.basis, deadlineAt: d.deadlineAt,
        held: held.filter((h) => h.page === page.path), page: { url: page.url, path: page.path, body },
        read: d.read, searchSources: d.searchSources, fetchSource: d.fetchSource,
        readCoverage: () => d.readCoverage(page.path), writeCoverage: (cov) => d.writeCoverage(page.path, cov) });
      if (out.status === "failed")
        return { status: banked > 0 ? "advanced" : "failed", banked, pagesComplete, attempts, failure: out.failure, reason: out.reason };
      if (out.status === "advanced") {
        progressed = true; banked += out.banked;
        const back = await d.refreshHeld(page.path).catch(() => null);
        if (back) held = [...held.filter((h) => h.page !== page.path), ...back];
      }
      if (out.status === "done" || out.cursor?.pageComplete) { pagesComplete += 1; break; }
    }
  }
  return { status: progressed ? "advanced" : pagesComplete > 0 ? "done" : "failed", banked, pagesComplete, attempts,
    ...(progressed || pagesComplete > 0 ? {} : { failure: "lease_exhausted" as const, reason: "no page could be worked this pass" }) };
}
