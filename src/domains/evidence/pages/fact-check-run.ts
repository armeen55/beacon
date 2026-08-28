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
import { recordFactChecks, recordOwedClaims, reopenObsoleteChecks, supersedeStaleFacts, statementKeyOf,
  VERIFICATION_RULES_VERSION, citationOfQuote, glossCarriedBy, unauthorizedReason, type FactCheck, type InventoryCoverage, type SourceKind } from "./fact-checks";

const EMPTY_ROW = { proposed: null, literal: null, usage: null, sources: [], agreement: "none_found" as const,
  confidence: "unsupported" as const, verdict: "undecidable" as const, alsoAt: [], note: "", sourceReadAt: null,
  rulesVersion: VERIFICATION_RULES_VERSION };

/** How many candidate sources one claim weighs, and how many it will actually fetch. */
const CANDIDATES = 6, FETCH_PER_CLAIM = 2;
/** A call is only started when this much of the deadline remains, so its result can always be persisted. */
const RESERVE_MS = 8_000;
/** One extraction reads this much of the stored body. NEVER the definition of the page: coverage is persisted
 *  and a page is complete only when every stored section was inventoried (Codex, 2026-08-18). */
/** A SECTION SMALL ENOUGH THAT ONE EXTRACTION CAN READ IT WHOLE. At 12,000 a dense list page handed the reader
 *  its entire body at once and the forty-statement schema cap silently decided what was inventoried: 194 name
 *  entries went in and 33 came out, with the page then marked complete. Smaller sections cost one cheap
 *  extraction each and are resumable by the coverage cursor, so a long page is READ rather than sampled. */
export const EXTRACT_CHUNK = 3_000;
/** The most statements one extraction may return (`FactClaimExtractionSchema`). Read here so the cursor can tell a chunk that was READ from one that merely filled up. */
const CLAIM_CAP = 40;
/** CLAIM ATTEMPTS one pass may make, GLOBAL across every page it touches, counting successes, failures and
 *  waits alike: the old per-page nesting advertised four and allowed twelve (Codex, 2026-08-18). */
export const ATTEMPTS_PER_PASS = 4;
/** About ONE CLAIM, not the account: set aside, carry on. */ const PER_CLAIM = new Set(["fetch_refused", "fetch_unavailable", "search_refused", "search_unavailable", "source_quality_unresolved"]);

const SCHOLARLY = /(^|\.)(iranicaonline\.org|dsal\.uchicago\.edu|jstor\.org|academia\.edu|brill\.com|oup\.com|cambridge\.org|nih\.gov|who\.int)$|\.(edu|gov|ac\.[a-z]{2})$/i;
const DICTIONARY = /(^|\.)(wiktionary\.org|merriam-webster\.com|oed\.com|dehkhoda\.ut\.ac\.ir|vajehyab\.com|abadis\.ir|collinsdictionary\.com)$/i;
const ENCYCLOPEDIA = /(^|\.)(wikipedia\.org|britannica\.com|encyclopedia\.com)$/i;
const REFERENCE = /(^|\.)(behindthename\.com|nameberry\.com|ethnologue\.com|statista\.com|census\.gov)$/i;
const BABYNAME = /(baby|names?)[-.]?(names?|meaning|central|nology)|(^|\.)(momjunction|pampers|thebump|babycenter|parents)\./i;
/** USER-GENERATED AND VIDEO, named explicitly. This is the reject list; everything not on it is a publisher. */
const COMMUNITY = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|reddit\.com|quora\.com|pinterest\.com|medium\.com|substack\.com|tumblr\.com|blogspot\.com|wordpress\.com|linkedin\.com|vimeo\.com|dailymotion\.com|answers\.com|stackexchange\.com|stackoverflow\.com|fandom\.com|wikihow\.com)$/i;
/** CREDIBLE JOURNALISTIC PUBLISHERS. Two independent ones may support a confirmation; one supports `likely`. */
const NEWS = /(^|\.)(washingtonpost|nytimes|wsj|bbc|cnn|cnbc|reuters|apnews|theguardian|guardian|aljazeera|newarab|alaraby|npr|time|forbes|wired|axios|bloomberg|ft|economist|independent|telegraph|dw|france24|euronews|abcnews|nbcnews|cbsnews|usatoday|latimes|newsweek|mashable|globalcitizen|scientificamerican|nationalgeographic|livescience|weather|accuweather|smithsonianmag|phys)\.(com|org|net|co\.uk|uk|de|fr|qa)$/i;

function sourceClassOf(domain: string): SourceKind {
  const d = domain.replace(/^www\./, "").toLowerCase();
  if (SCHOLARLY.test(d)) return "scholarly";
  if (DICTIONARY.test(d)) return "dictionary";
  if (ENCYCLOPEDIA.test(d)) return "encyclopedia";
  if (REFERENCE.test(d)) return "reference";
  if (BABYNAME.test(d)) return "babyname";
  if (COMMUNITY.test(d)) return "community";
  if (NEWS.test(d)) return "news";
  return "publisher"; // unknown, ordinary: worth reading, never enough on its own
}
/** One of these alone may carry a confirmation. */
const AUTHORITATIVE = new Set<SourceKind>(["scholarly", "dictionary", "encyclopedia"]);
/** How much of a proposed replacement its sources must carry before it may replace published words. */ const SUPPORTED_SHARE = 0.6;
const FILLER = new Set(["that", "this", "with", "from", "have", "which", "meaning", "means", "name", "also", "used", "word", "these", "their", "them", "when", "such", "into", "than", "then", "they", "were", "been", "being", "there", "where", "what", "would", "about"]);
/** TWO INDEPENDENT ones may carry a confirmation between them; one carries `likely` and no more. */
const CREDIBLE = new Set<SourceKind>(["news"]);
/** Never read at all: user-generated, video and baby-name mills. */
const REJECTED = new Set<SourceKind>(["community", "babyname"]);

export const pageHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);

/** WHAT KIND OF CLAIM THIS IS, which SHAPES how you look for a source but never erases what is being verified.
 *  Deterministic and total: an unrecognised claim is a plain definition, which searches plainly. */
type ClaimType = "word_meaning" | "date_or_event" | "quantity" | "definition" | "specification" | "entity_fact" | "geography";

export function claimTypeOf(subject: string, current: string): ClaimType {
  const t = `${subject} ${current}`.toLowerCase();
  if (/\b(means?|meaning|derives?|derived|etymolog|origin of the name|name meaning|translat)/.test(t)) return "word_meaning";
  if (/\b(1[0-9]{3}|20[0-9]{2}|bce?\b|ad\b|century|founded|born|died|dynasty|war|revolution|treaty)\b/.test(t)) return "date_or_event";
  // Records and measurements are quantities: "hottest day at 54 °C" is not a definition (Codex, 2026-08-18).
  if (/\b(\d[\d,.]*\s*(percent|%|million|billion|thousand|km|miles|kg|people|residents|users)|population|average|median|rate|record|hottest|coldest|largest|smallest|tallest|longest|highest|lowest|temperature|degrees)\b|°/.test(t)) return "quantity";
  if (/\b(located|capital|province|region|city of|river|mountain|border)\b/.test(t)) return "geography";
  if (/\b(model|version|specification|dimensions|weight|material|capacity|voltage)\b/.test(t)) return "specification";
  if (/\b(is a|was a|founder|ceo|author|invented|composer|poet|king|shah)\b/.test(t)) return "entity_fact";
  return "definition";}

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
    if (toks.length >= 14) break;}
  const hint = type === "word_meaning" ? " meaning etymology" : type === "date_or_event" ? " history" : "";
  return `${toks.join(" ")}${hint}`.trim();
}

/** A STATEMENT'S IDENTITY is the normalized claim plus where it sits, never the subject alone: a page can say
 *  two different things about one subject and both are real (Codex, 2026-08-18). */
export function claimIdentity(subject: string, current: string, locator?: string | null): string {
  const norm = `${subject}|${current}|${locator ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return `${statementKeyOf(subject)}#${createHash("sha256").update(norm).digest("hex").slice(0, 10)}`;
}

/** THE CLAIM'S CONTENT-TOKEN FINGERPRINT: subject + wording reduced to its content words, sorted. Two
 *  statements with the SAME content words in any order are one proposition reworded, and the second is
 *  superseded free instead of researched twice. Deliberately NOT semantic: a reformulation that swaps in
 *  different words is a different fingerprint and is researched on its own (Codex, 2026-08-18). */
export function tokenFingerprintOf(subject: string, current: string): string {
  const toks = `${subject} ${current}`.toLowerCase().replace(/[^\p{L}\p{N}° ]+/gu, " ").split(/\s+/)
    .filter((t) => t.length > 0 && (/[\d°]/.test(t) || (t.length >= 4 && !STOP.has(t))));
  return [...new Set(toks)].sort().join(" ");}

const CLAIM_SYSTEM = 'You read one web page and list the statements on it that an outside source could confirm or contradict. '
  + 'Return ONLY {"statements":[{"subject","current","locator"}]}: `subject` is what the statement is about as the page writes it; '
  + '`current` is the page\'s own wording, quoted exactly; `locator` is where it sits (the heading or section it is under). '
  + 'Only statements of FACT about the world. Never marketing copy, navigation, or anything about the page itself. At most 40.';

const JUDGE_SYSTEM = 'You compare ONE statement a web page makes against PASSAGES QUOTED FROM SOURCES THAT WERE ACTUALLY FETCHED. '
  + 'Return ONLY {"verdict","proposed","literal","usage","confidence","supporting","note"}. '
  + 'verdict: page_correct | page_wrong | page_imprecise | undecidable. confidence: confirmed | likely | disputed | unsupported. '
  + '`supporting` is one entry PER SOURCE that actually supports your answer: {"url": the source URL exactly as given, "quote": a sentence copied VERBATIM from THAT source\'s own passage}. '
  + 'Never repeat one sentence across sources, and never list a source you cannot quote. If you can quote none, answer unsupported and propose nothing. '
  + 'Distinguish literal etymology from modern usage: a page recording a live usage is not automatically wrong. Never invent a replacement. '
  + '`subjects` is one entry PER SOURCE you quoted: {"url", "sameEntity", "language", "script", "why"}. sameEntity is TRUE only when the passage is about the SAME name, word or entity the page is talking about, in the SAME language. '
  + 'A source that merely SPELLS the name the same way, or lists it as a variant of a different language\'s name, is a DIFFERENT subject and sameEntity is false. '
  + '`language` is the language the passage says the subject belongs to. `script` is the subject written in its own script when the passage gives it, else null.';

type Extracted = { statements: { subject: string; current: string; locator?: string }[] };
type Judged = { verdict: FactCheck["verdict"]; proposed: string; literal: string; usage: string;
  confidence: FactCheck["confidence"]; supporting: { url: string; quote: string }[]; note: string;
  subjects?: { url: string; sameEntity: boolean; language: string; script: string | null; why: string }[] };

/** THE SCRIPT A LANGUAGE IS WRITTEN IN, for the one half of subject identity code can check without asking
 *  anybody: a passage claiming to define a Persian word, that contains no Perso-Arabic character anywhere, has
 *  not shown the word it is defining. Generic and open: a language absent here simply skips this test rather
 *  than failing it, so this is never a list of approved subjects. */
const SCRIPT_OF: Record<string, RegExp> = {
  persian: /[\u0600-\u06FF]/, farsi: /[\u0600-\u06FF]/, arabic: /[\u0600-\u06FF]/, urdu: /[\u0600-\u06FF]/,
  russian: /[\u0400-\u04FF]/, ukrainian: /[\u0400-\u04FF]/, bulgarian: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/, hebrew: /[\u0590-\u05FF]/, hindi: /[\u0900-\u097F]/, sanskrit: /[\u0900-\u097F]/,
  chinese: /[\u4E00-\u9FFF]/, japanese: /[\u3040-\u30FF\u4E00-\u9FFF]/, korean: /[\uAC00-\uD7AF]/,
  armenian: /[\u0530-\u058F]/, georgian: /[\u10A0-\u10FF]/, thai: /[\u0E00-\u0E7F]/,};

/** WHY A PAID DOOR GAVE NOTHING, carried end to end. `capped` = the budget refused it, `waiting` = a posted
 *  task has not answered, `refused` = it answered and the answer would not validate, `unavailable` = it could
 *  not be reached. Each is a different debt and each leaves the claim owed (Codex, 2026-08-18). */
type ProviderHold = "capped" | "waiting" | "refused" | "unavailable";

/** The one model call a unit may make. `kind` names the STRUCTURED OUTPUT SCHEMA the answer must satisfy, so
 *  a caller cannot quietly ask the editor judge for a claim list and read zero statements for ever. */
type StructuredRead = (input: { kind: "fact_claim_extraction" | "fact_claim_judgement";
  system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number })
  => Promise<{ value: Record<string, unknown> } | { hold: ProviderHold }>;

/** WHY A UNIT FAILED, as an identity a later reader can act on: a cap, a queue wait, a timeout and a schema
 *  refusal are different debts, and one generic sentence hid which of them repeated paid attempts were hitting
 *  (Codex, 2026-08-18). Every failure leaves the claim OWED. */
type UnitFailure = "no_page_body" | "lease_exhausted" | "inventory_write_failed" | "store_write_failed"
  | "lease_lost" | "source_quality_unresolved"
  | `extraction_${ProviderHold}` | `search_${ProviderHold}` | `fetch_${ProviderHold}` | `judge_${ProviderHold}`;

/** A search answer: readable results or a TYPED provider hold. Only the readable shape may settle a claim. */
type SearchAnswer = { organic: { domain: string; url: string; title: string | null }[] } | { hold: ProviderHold };
/** A source read: the page's words or a TYPED hold. A hold never clears the claim. */
type SourceAnswer = { text: string } | { hold: ProviderHold };

/** WHERE THE PAGE STANDS, read back from the persisted inventory rather than carried in a lease. */
type FactCheckCursor = {
  page: string; pageContentHash: string | null; evidenceBasis: string | null;
  /** How many of this page version's claims are researched, out of how many are inventoried SO FAR. */
  checked: number; total: number;
  /** True ONLY when every stored section was inventoried AND every claim is current. */
  pageComplete: boolean;};

type FactCheckUnitDeps = {
  read: StructuredRead;
  searchSources?: (query: string) => Promise<SearchAnswer>;
  /** THE SOURCE ITSELF: fetch and parse one URL. A hold means nothing may be confirmed and nothing is banked. */
  fetchSource?: (url: string) => Promise<SourceAnswer>;
  page: { url: string; path: string; body: string };
  /** Claims this pass already failed on: aside for the rest of it, never for ever. */ skip?: ReadonlySet<string>;
  tenantId: string; now: Date; basis: string | null;
  /** Checks already on file for this page, so a current one is skipped and a stale one is redone. */
  held?: readonly FactCheck[];
  /** HOW MUCH OF THE BODY HAS BEEN INVENTORIED, persisted: absent (tests) starts from zero each call. */
  readCoverage?: () => Promise<InventoryCoverage | null>;
  writeCoverage?: (cov: InventoryCoverage) => Promise<boolean>;
  /** The absolute instant this unit must be finished by. */
  deadlineAt: number;};

/** WHAT ONE UNIT DID. `advanced` = durable progress was STORED (a claim banked, or the next section
 *  inventoried). `done` = this page version owes nothing at full coverage. `failed` = nothing advanced and the
 *  claim is still owed, which is not the same answer and must never move a run on to publishing. */
type FactCheckUnitResult = { status: "advanced" | "done" | "failed"; banked: number;
  cursor: FactCheckCursor | null; failure?: UnitFailure; reason?: string;
  /** WHICH CLAIM THIS UNIT TOOK ON, so a pass may set one aside and reach the next. */ attempted?: string };

const enough = (deadlineAt: number, need: number): boolean => Date.now() + need + RESERVE_MS <= deadlineAt;
const fail = (failure: UnitFailure, cursor: FactCheckCursor | null, reason: string, attempted?: string): FactCheckUnitResult =>
  ({ status: "failed", banked: 0, cursor, failure, reason, ...(attempted ? { attempted } : {}) });

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
  // A VERDICT FROM OBSOLETE RULES IS NOT CURRENT EVIDENCE (Codex, 2026-08-18): the one live checked row was
  // researched by a query built from the subject alone, and reading it as current would have made the engine
  // skip for ever the exact claim it was repaired to research. Its evidence is archived and the claim re-opens.
  // AND A CONFIRMED VERDICT THE QUOTE-BOUND CONTRACT NOW REFUSES IS A CLAIM STILL OWED, not a settled finding: withdrawing the card without reopening the claim would strand the exact live defects this contract was written about (Alborz, Jasmine) as permanent dead findings, because a checked row is never re-inventoried. TARGETED, never a blanket version bump: only the rows the new authorization refuses reopen, so the four sound live corrections keep their verdicts and cards. Loop-safe: generation now binds to quotes too, so a re-researched claim either banks a carried gloss or holds below confirmed, where unauthorizedReason is null.
  const obsolete = inventory.filter((h) => (h.state === "checked" && h.rulesVersion !== VERIFICATION_RULES_VERSION)
    || (h.state === "checked" && h.confidence === "confirmed" && unauthorizedReason(h) != null));
  if (obsolete.length > 0 && await reopenObsoleteChecks(tenantId, page.path, obsolete).catch(() => 0) > 0) {
    inventory = inventory.map((h) => (obsolete.includes(h) ? { ...h, state: "owed" as const, rulesVersion: VERIFICATION_RULES_VERSION } : h));}
  // THE SEEDED PROPOSITION IS RESEARCHED FIRST. A row whose locator is `missing` exists only because an acquisition
  // seeded it for a funded candidate that was refused for lacking exactly that fact, so it outranks rotation over the
  // page's own existing statements: without this the pass spent its budget re-checking claims the page already makes
  // and reported the reading as acquired, while the writer still had nothing new to cite.
  const seededFirst = (rows: typeof inventory) => [...rows].sort((a, b) => (b.pageLocator === "missing" ? 1 : 0) - (a.pageLocator === "missing" ? 1 : 0));
  let owed = seededFirst(inventory.filter((h) => h.state === "owed"));
  if (cov.coveredChars < cov.totalChars) {
    // EXTRACT THE NEXT SECTION, WHATEVER IS ALREADY OWED. Waiting for the owed queue to empty is a deadlock: a
    // another character. Live: rules v4 re-opened 21 claims, the queue stood at 33, and eighteen passes left
    // coverage at 0 of 11,589 while ~160 entries were neither owed nor checked. Extraction is what gives an
    // entry a disposition at all and costs about two cents a section, so it no longer queues behind research.
    if (!enough(d.deadlineAt, 20_000)) return fail("lease_exhausted", null, "not enough of this lease remains to read the page");
    const chunk = page.body.slice(cov.coveredChars, cov.coveredChars + EXTRACT_CHUNK);
    const answer = await d.read({ kind: "fact_claim_extraction", system: CLAIM_SYSTEM,
      user: `Page: ${page.url}\n\nIts stored words (section starting at character ${cov.coveredChars}):\n${chunk}\n\nReturn the JSON now.`,
      grounded: chunk, projectedCostUsd: 0.02, maxTokens: 3000 }).catch(() => ({ hold: "unavailable" as const }));
    if ("hold" in answer) return fail(`extraction_${answer.hold}`, null, `the page's checkable statements are ${answer.hold}, so nothing was inventoried`);
    const extracted = answer.value;
    const returned = ((extracted as unknown as Extracted).statements ?? [])
      .filter((s) => s.subject?.trim() && s.current?.trim()).map((s) => s.current.trim());
    const knownIds = new Set(inventory.map((h) => h.statementKey));
    const knownProps = new Set(inventory.map((h) => tokenFingerprintOf(h.subject, h.current)));
    const claims = ((extracted as unknown as Extracted).statements ?? [])
      .filter((s) => s.subject?.trim() && s.current?.trim())
      .map((s) => ({ subject: s.subject.trim(), current: s.current.trim(), locator: s.locator?.trim() || null }))
      .map((c) => ({ ...c, statementKey: claimIdentity(c.subject, c.current, c.locator), prop: tokenFingerprintOf(c.subject, c.current) }))
      // One row per identity AND one per proposition: reformulations of one fact are researched once.
      .filter((c, i, all) => all.findIndex((x) => x.statementKey === c.statementKey) === i)
      .filter((c, i, all) => all.findIndex((x) => x.prop === c.prop) === i)
      .filter((c) => !knownIds.has(c.statementKey) && !knownProps.has(c.prop));
    if (cov.coveredChars === 0) {
      // THE PAGE MOVED ON: whatever was held against an older version, or objects to wording this version no
      // longer carries, becomes history now rather than a second live instruction beside its own replacement.
      const body = page.body.toLowerCase();
      await supersedeStaleFacts(tenantId, page.path, hash, (current) => body.includes(current.trim().toLowerCase()))
        .catch((e) => { log.warn("[fact-check] stale claims could not be retired", { tenantId, page: page.path, error: String(e) }); return 0; });}
    // THE INVENTORY AND ITS COVERAGE ARE THE CURSOR, stored BEFORE one claim is researched. A write that did
    // not land is a failed unit: researching against an inventory nobody stored is how page two was lost.
    const wrote = claims.length === 0 ? 0 : await recordOwedClaims(tenantId, page.path, claims, hash, d.basis).catch(() => -1);
    if (wrote < 0) return fail("inventory_write_failed", null, "the page's claim inventory could not be stored, so nothing was researched");
    // A CAPPED EXTRACTION HAS NOT READ ITS CHUNK, IT HAS FILLED UP: one oversized chunk once swallowed a
    // cursor now advances only to the end of the last statement read, found by its own wording, and nothing is
    // re-banked because both filters above dedupe. MEASURED ON WHAT CAME BACK, never on what survived that
    // dedupe: a chunk returning exactly the cap and then losing rows read as "not capped".
    const last = returned.length >= CLAIM_CAP ? returned[returned.length - 1]! : null;
    const at = last ? chunk.toLowerCase().lastIndexOf(last.toLowerCase().slice(0, 60)) : -1;
    const read = at >= 0 ? Math.max(1, at + Math.min(last!.length, 60)) : chunk.length;
    cov = { pageContentHash: hash, coveredChars: Math.min(cov.coveredChars + read, page.body.length), totalChars: page.body.length };
    if (d.writeCoverage && !(await d.writeCoverage(cov).catch(() => false)))
      return fail("inventory_write_failed", null, "the section's coverage could not be stored, so it would be read and paid for again");
    inventory = [...inventory, ...claims.map((c) => ({ ...EMPTY_ROW, page: page.path, statementKey: c.statementKey,
      subject: c.subject, current: c.current, pageLocator: c.locator, pageContentHash: hash, evidenceBasis: d.basis,
      state: "owed" as const, checkedAt: now.toISOString() }))];
    owed = seededFirst(inventory.filter((h) => h.state === "owed")); // a freshly inventoried section may not bury it either
  }
  // 2. THE NEXT OWED CLAIM WHOSE PROPOSITION IS NOT ALREADY SETTLED. A duplicate of a checked fact is
  // superseded for free, never researched and paid for again.
  const settled = new Set(inventory.filter((h) => h.state === "checked").map((h) => tokenFingerprintOf(h.subject, h.current)));
  let next: FactCheck | null = null;
  for (const o of owed) {
    if (d.skip?.has(o.statementKey)) continue; // this pass already tried it and it did not resolve
    if (!settled.has(tokenFingerprintOf(o.subject, o.current))) { next = o; break; }
    const ok = await recordFactChecks(tenantId, page.path, [{ ...o, state: "superseded",
      note: "Duplicate of a proposition already checked at this page version." }]).catch(() => 0);
    if (ok > 0) owed = owed.filter((x) => x !== o);}
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
      : fail("store_write_failed", cursor, "the result could not be stored, so this claim is still owed");};
  const base = { page: page.path, statementKey: next.statementKey, state: "checked" as const, rulesVersion: VERIFICATION_RULES_VERSION, subject: claim.subject, current: claim.current,
    literal: null, usage: null, alsoAt: claim.locator ? [claim.locator] : [],
    pageContentHash: hash, pageLocator: claim.locator, sourceReadAt: null as string | null,
    evidenceBasis: d.basis, checkedAt: now.toISOString() };

  // 3. ACQUIRE candidates by searching THE PROPOSITION, shaped but never erased by the claim type.
  if (!d.searchSources || !enough(d.deadlineAt, 15_000)) return fail("lease_exhausted", cursor, "no lease left to look for sources");
  const found = await d.searchSources(sourceQueryFor(type, claim.subject, claim.current)).catch(() => ({ hold: "unavailable" as const }));
  // A PROVIDER THAT DID NOT ANSWER IS NOT A WORLD WITH NO SOURCES: capped, waiting, refused and unreachable
  // each leave the claim OWED under their own name, and only a readable answer with no qualifying source
  // banks `none_found`.
  if ("hold" in found) return fail(`search_${found.hold}`, cursor, `the source search is ${found.hold}, so this claim is still owed`, next.statementKey);
  // EXCLUSIONS COME BEFORE THE LIMIT, and ONE CANDIDATE PER PUBLISHER. Taking the first six raw results and
  // filtering afterwards threw away a whole results page: six credible outlets were cut before the policy ever
  // saw them, and the claim would have been buried as an empty world (Codex, 2026-08-19). The allowance counts
  // QUALIFYING candidates.
  const organic = found.organic ?? [];
  const seenDomains = new Set<string>();
  // A SITE MAY NOT VOUCH FOR ITSELF, and nothing enforced it: live, the Nazanin correction cited the very page
  // it was correcting, iranopedia.com/persian-female-first-names, and banked that as a source.
  const ownSite = (page.url ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const candidates = organic
    .map((o) => ({ url: o.url, domain: o.domain.replace(/^www\./, "").toLowerCase(), kind: sourceClassOf(o.domain), title: o.title ?? "" }))
    .filter((c) => !REJECTED.has(c.kind))
    .filter((c) => !ownSite || (c.domain !== ownSite && !c.domain.endsWith(`.${ownSite}`)))
    .filter((c) => !seenDomains.has(c.domain) && seenDomains.add(c.domain) !== undefined)
    .sort((a, b) => (AUTHORITATIVE.has(b.kind) ? 1 : 0) - (AUTHORITATIVE.has(a.kind) ? 1 : 0))
    .slice(0, CANDIDATES);
  // `none_found` IS A CLAIM ABOUT THE WORLD, and only an empty results page may make it. A page full of
  // results none of which clears the policy is an unresolved question, and the claim stays owed.
  if (organic.length === 0) {
    return bank({ ...base, proposed: null, sources: [], agreement: "none_found", confidence: "unsupported",
      verdict: "undecidable", note: "The search was readable and returned nothing at all for this claim, so nothing is proposed." });}
  if (candidates.length === 0) return fail("source_quality_unresolved", cursor,
    `the search returned ${organic.length} results and none clears the source policy, so this claim is still owed`, next.statementKey);
  // PUBLISHER-DIVERSE PICKS: the second fetch prefers a DIFFERENT source class, so two generic encyclopedia
  // pages are not taken merely because they rank first (Codex, 2026-08-18).
  const second = candidates.slice(1).find((c) => c.kind !== candidates[0]!.kind) ?? candidates[1];
  const picks = [candidates[0]!, ...(second ? [second] : [])].slice(0, FETCH_PER_CLAIM);

  // 4. READ THE SOURCES. A title is not a fact, and A SOURCE NOBODY READ NEVER CLEARS THE CLAIM: when every
  // fetch fails the claim stays OWED, because "the evidence disproved nothing" and "the infrastructure could
  // not read the evidence" are different answers (Codex, 2026-08-18).
  const passages: { url: string; kind: SourceKind; text: string; readAt: string }[] = [];
  let lastHold: ProviderHold = "unavailable";
  for (const c of picks) {
    if (!d.fetchSource || !enough(d.deadlineAt, 20_000)) break;
    const got = await d.fetchSource(c.url).catch(() => ({ hold: "unavailable" as const }));
    if ("hold" in got) { lastHold = got.hold; continue; }
    if (got.text.trim()) passages.push({ url: c.url, kind: c.kind, text: got.text.slice(0, 6_000), readAt: new Date().toISOString() });}
  if (passages.length === 0) return fail(`fetch_${lastHold}`, cursor, `sources were found and reading them is ${lastHold}, so this claim is still owed`, next.statementKey);

  // 5. JUDGE against the passages only.
  if (!enough(d.deadlineAt, 20_000)) return fail("lease_exhausted", cursor, "no lease left to judge this claim");
  const verdict = await d.read({ kind: "fact_claim_judgement", system: JUDGE_SYSTEM,
    // A MISSING PROPOSITION IS RESEARCHED, NOT COMPARED: an owed claim with no current wording is the page's
    // acknowledged gap (the missing-information loop seeds exactly these), so the judge is asked what the
    // passages establish about the subject rather than to grade an empty quotation. `proposed` then carries the
    // researched statement, which is what the writer's fact-* evidence renders.
    user: [`Claim type: ${type}`, `Subject: ${claim.subject}`,
      claim.current.trim() ? `The page says: "${claim.current}"` : "The page does not answer this yet. From the passages alone, state in `proposed` the accurate, source-supported statement of this subject; if the passages cannot support one, answer unsupported.",
      "Passages fetched from real sources:",
      ...passages.map((p) => `--- [${p.kind}] ${p.url}\n${p.text}`), "", "Return the JSON now."].join("\n"),
    grounded: passages.map((p) => p.text).join("\n"), projectedCostUsd: 0.02, maxTokens: 1500 }).catch(() => ({ hold: "unavailable" as const }));
  if ("hold" in verdict) return fail(`judge_${verdict.hold}`, cursor, `judging this claim is ${verdict.hold}, so it is still owed`);
  const v = verdict.value as unknown as Judged;
  // EVERY CLAIMED SUPPORT IS VERIFIED IN ITS OWN SOURCE. A quote is credited only to the passage that actually
  // contains it, so one sentence attributed to several publishers supports exactly the one it came from.
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
  const verified = new Map<string, string>(); // passage url -> its own verified quote
  const vouchedAs = new Map<string, string>(); // passage url -> the url the reader NAMED for it, so the subject it vouched for is found even when a quote resolves to a different passage than the one claimed
  for (const sup of v.supporting ?? []) {
    const quote = (sup.quote ?? "").trim();
    if (quote.length === 0) continue;
    const p = passages.find((x) => x.url === sup.url) ?? passages.find((x) => norm(x.text).includes(norm(quote)));
    if (p && norm(p.text).includes(norm(quote)) && !verified.has(p.url)) { verified.set(p.url, quote); vouchedAs.set(p.url, sup.url); }}
  // A QUOTE PROVES THE SOURCE SAID IT, NEVER THAT IT SAID IT ABOUT THIS SUBJECT: a passage has to be about the
  // SAME name in the SAME language. The reader names the subject it read and the code checks the half it can.
  // Live, Wikipedia's "Daria (given name)" is quotable and lists "Darya" as a variant, so it authorized a Slavic
  // name descended from Darius as the meaning of Persian دریا, sea. Every test the old chain ran was passing.
  const said = new Map((v.subjects ?? []).map((x) => [x.url, x]));
  const vouched = passages.filter((p) => {
    if (!verified.has(p.url)) return false;
    const about = said.get(p.url) ?? said.get(vouchedAs.get(p.url) ?? "");
    if (!about || !about.sameEntity) return false;  // unvouched, or a different name however alike it is spelled
    // A SCRIPT NAMED IS A SCRIPT THAT MUST BE THERE, and a language with one of its own has to carry it.
    const script = (about.script ?? "").trim();
    if (script && !p.text.includes(script)) return false;
    const of = SCRIPT_OF[about.language.trim().toLowerCase()];
    return !of || of.test(p.text); });
  const langOf = (p: { url: string }): string => (said.get(p.url) ?? said.get(vouchedAs.get(p.url) ?? ""))?.language.trim().toLowerCase() ?? "";
  // AND SUPPORTERS MAY NOT DISAGREE ABOUT WHOSE NAME IT IS: the account keeps the language its best source read.
  const lead = vouched.find((p) => AUTHORITATIVE.has(p.kind)) ?? vouched[0];
  const leadLang = lead ? langOf(lead) : "";
  const identified = vouched.filter((p) => langOf(p) === leadLang);
  const dropped = passages.filter((p) => verified.has(p.url) && !identified.includes(p));
  const supporters = identified;
  // AGREEMENT IS DISTINCT PUBLISHERS, counted, never accepted from the model.
  const agreement: FactCheck["agreement"] = supporters.length > 1 ? "multiple_agree"
    : supporters.length === 1 ? "single_source" : "none_found";
  // ONE AUTHORITY, OR TWO INDEPENDENT CREDIBLE PUBLISHERS. An ordinary publisher supports `likely` and never
  // authorizes replacing published words on its own (Codex, 2026-08-19).
  const confirmable = supporters.some((p) => AUTHORITATIVE.has(p.kind))
    || supporters.filter((p) => CREDIBLE.has(p.kind)).length >= 2;
  // AND A REPLACEMENT HAS TO BE FOUND IN THE QUOTE THE ROW WILL BANK, NOT MERELY SOMEWHERE ON THE PAGE: the full fetched text used to authorize here, and live it confirmed "Mountain Rampart" off a sentence one past the verified quote, so the customer receipt showed a quote that never carried the published words. The page may help LOCATE evidence; only the verified quotes authorize. A correction (current wording exists) needs every content word of its short gloss carried by those quotes and may not simply restate one of them as the page's line; a missing-information statement keeps the older share, now against quotes.
  const read = norm(supporters.map((p) => verified.get(p.url) ?? "").join(" "));
  const words = (v.proposed ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !FILLER.has(w));
  const share = words.length === 0 ? 1 : words.filter((w) => read.includes(w)).length / words.length;
  const isCorrection = claim.current.trim() !== "";
  const quotes = supporters.map((p) => verified.get(p.url) ?? "");
  const cites = isCorrection && citationOfQuote(v.proposed ?? "", quotes, claim.current);
  const carried = (isCorrection ? glossCarriedBy(v.proposed ?? "", quotes) : share >= SUPPORTED_SHARE) && !cites;
  const confidence: FactCheck["confidence"] = v.confidence === "confirmed" && confirmable && carried ? "confirmed"
    : v.confidence === "unsupported" ? "unsupported" : v.confidence === "disputed" ? "disputed" : "likely";
  return bank({ ...base,
    proposed: confidence === "unsupported" ? null : (v.proposed?.trim() || null),
    literal: v.literal?.trim() || null, usage: v.usage?.trim() || null,
    sources: passages.map((p) => ({ url: p.url, kind: p.kind, says: (verified.get(p.url) ?? "").slice(0, 600) })),
    sourceReadAt: supporters[0]?.readAt ?? null,
    agreement, confidence, verdict: v.verdict,
    note: `${v.note ?? ""}${supporters.length > 0 ? "" : " No fetched passage carries a quote it relied on, so this is held below confirmed."}${dropped.length > 0 ? ` ${dropped.length} quoted ${dropped.length === 1 ? "source was" : "sources were"} set aside for being about a different subject or language than this page's.` : ""}${carried || confidence === "unsupported" ? "" : cites ? " The proposal restates the source's own sentence instead of stating the page's line, so it is held below confirmed." : " The wording proposed here is not carried by the verified quote, so it is held below confirmed until a source says it."}`.trim() });
}

type FactCheckPassDeps = {
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
  searchSources: (query: string) => Promise<SearchAnswer>;
  fetchSource: (url: string) => Promise<SourceAnswer>;
  readCoverage: (page: string) => Promise<InventoryCoverage | null>;
  writeCoverage: (page: string, cov: InventoryCoverage) => Promise<boolean>;};

type FactCheckPassResult = { status: "advanced" | "done" | "failed"; banked: number;
  pagesComplete: number; attempts: number; failure?: UnitFailure; reason?: string };

/** ONE PASS: at most ATTEMPTS_PER_PASS claim attempts GLOBALLY, however many pages that spans. A failed unit
 *  ends the pass with its typed identity, because a cap or an outage repeats on the next attempt and burning
 *  the remaining allowance against it proves nothing. */
export async function runFactCheckPass(d: FactCheckPassDeps): Promise<FactCheckPassResult> {
  let banked = 0, pagesComplete = 0, attempts = 0, progressed = false, opened = 0;
  const setAside = new Set<string>(); let lastPerClaim: { failure: UnitFailure; reason: string } | null = null;
  let held = d.held;
  for (const page of d.pages) {
    if (attempts >= ATTEMPTS_PER_PASS || Date.now() >= d.deadlineAt) break;
    const body = await page.loadBody().catch(() => "");
    if (!body.trim()) continue; // never crawled: nothing is owed on words nobody has stored
    opened += 1;
    while (attempts < ATTEMPTS_PER_PASS && Date.now() < d.deadlineAt) {
      if (d.renew && !(await d.renew().catch(() => false)))
        return { status: banked > 0 ? "advanced" : "failed", banked, pagesComplete, attempts, failure: "lease_lost", reason: "the lease was lost, so nothing further was researched" };
      attempts += 1; // EVERY attempt counts: banked, failed and waiting alike.
      const out = await runFactCheckUnit({ tenantId: d.tenantId, now: new Date(), basis: d.basis, deadlineAt: d.deadlineAt,
        held: held.filter((h) => h.page === page.path), page: { url: page.url, path: page.path, body }, skip: setAside,
        read: d.read, searchSources: d.searchSources, fetchSource: d.fetchSource,
        readCoverage: () => d.readCoverage(page.path), writeCoverage: (cov) => d.writeCoverage(page.path, cov) });
      // A CLAIM THAT WILL NOT RESOLVE IS SET ASIDE, NOT THE WHOLE PASS. Ending on any failed unit is right for a
      // spent budget or an outage, which repeat; wrong for a per-claim failure, because the owed order is stable
      // so it returned to the head every pass. Live: `fetch_refused` at $0 on five passes while 167 others were
      // never reached once. Set aside for THIS pass only; it is owed again on the next.
      if (out.status === "failed" && out.attempted && PER_CLAIM.has(out.failure ?? "")) {
        setAside.add(out.attempted); lastPerClaim = { failure: out.failure!, reason: out.reason ?? "" }; continue; }
      if (out.status === "failed")
        return { status: banked > 0 ? "advanced" : "failed", banked, pagesComplete, attempts, failure: out.failure, reason: out.reason };
      if (out.status === "advanced") {
        progressed = true; banked += out.banked;
        const back = await d.refreshHeld(page.path).catch(() => null);
        if (back) held = [...held.filter((h) => h.page !== page.path), ...back];}
      if (out.status === "done" || out.cursor?.pageComplete) { pagesComplete += 1; break; }}}
  // AN ACCOUNT WITH NO STORED PAGE WORDS OWES NOTHING HERE. Reading that as a failure would pause a fresh
  // account at this phase for ever, now that it runs ahead of the crawl that fills the store.
  if (opened === 0) return { status: "done", banked: 0, pagesComplete: 0, attempts, reason: "no stored page words to check yet" };
  // A PASS THAT SET EVERY CLAIM ASIDE DID NOT RUN OUT OF LEASE, and saying so PAUSES the run: `lease_exhausted`
  // is a hard stop. The last real reason is carried out of the loop and reported as itself.
  return { status: progressed ? "advanced" : pagesComplete > 0 ? "done" : "failed", banked, pagesComplete, attempts,
    ...(progressed || pagesComplete > 0 ? {} : lastPerClaim
      ? { failure: lastPerClaim.failure, reason: lastPerClaim.reason }
      : { failure: "lease_exhausted" as const, reason: "no page could be worked this pass" }) };}
