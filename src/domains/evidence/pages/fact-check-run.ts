import "server-only";

/** evidence/pages/fact-check-run - ONE CLAIM, RESEARCHED PROPERLY, PER RENEWED LEASE. The first live runs proved four ways a unit can look like research without being it (Codex, 2026-08-18): a query built from the SUBJECT alone researched "Ahvaz definition" for a heat-record claim; sources found but unreadable were banked as checked, permanently clearing work nobody did; a truncated 12,000-character sample was called the whole page; and two encyclopedia pages counted as agreement because they ranked first. WHAT IT IS NOW. The persisted inventory is the cursor and coverage is persisted with it, so a page is only complete when every stored section was inventoried AND every claim is current. Acquisition searches the WHOLE PROPOSITION, never the subject alone. Every failure is TYPED and leaves the claim owed; only a readable world may settle one. `confirmed` requires a quote inside a fetched authoritative passage. */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { recordFactChecks, recordOwedClaims, reopenObsoleteChecks, supersedeStaleFacts, statementKeyOf,
  MISSING_ANSWER_RULES_VERSION, rulesVersionFor, unauthorizedReason, type FactCheck, type InventoryCoverage, type SourceKind } from "./fact-checks";
import { SUPPORT_ARTIFACT_VERSION, supportIdentity, supportFailure, unsupportedArtifact, deriveSupport, claimTypeOf, AUTHORITATIVE_KIND as AUTHORITATIVE, type ClaimSupport, type ClaimType, type SupportContext } from "./claim-support";
export { claimTypeOf } from "./claim-support";

const EMPTY_ROW = { proposed: null, literal: null, usage: null, sources: [], agreement: "none_found" as const,
  confidence: "unsupported" as const, verdict: "undecidable" as const, alsoAt: [], note: "", sourceReadAt: null };

/** How many candidate sources one claim weighs, and how many it will actually fetch. */
const CANDIDATES = 6, FETCH_PER_CLAIM = 2;
/** A call is only started when this much of the deadline remains, so its result can always be persisted. */
const RESERVE_MS = 8_000;
/** One extraction reads this much of the stored body. NEVER the definition of the page: coverage is persisted and a page is complete only when every stored section was inventoried (Codex, 2026-08-18). A SECTION SMALL ENOUGH THAT ONE EXTRACTION CAN READ IT WHOLE: at 12,000 a dense list page handed the reader its entire body at once and the forty-statement schema cap silently decided what was inventoried (194 name entries went in and 33 came out, with the page then marked complete). Smaller sections cost one cheap extraction each and are resumable by the coverage cursor, so a long page is READ rather than sampled. */
export const EXTRACT_CHUNK = 3_000;
/** The most statements one extraction may return (`FactClaimExtractionSchema`). Read here so the cursor can tell a chunk that was READ from one that merely filled up. */
const CLAIM_CAP = 40;
/** CLAIM ATTEMPTS one pass may make, GLOBAL across every page it touches, counting successes, failures and waits alike (the old per-page nesting advertised four and allowed twelve, Codex 2026-08-18). A RUNAWAY STOP ONLY (operator, 2026-08-30, "i dont want any limits"): the deadline, the lease and the money doors are the bounds; at four, 283 owed claims took weeks while all three sat idle. */
export const ATTEMPTS_PER_PASS = 200;
/** About ONE CLAIM, not the account: set aside, carry on. `judge_refused` joined 2026-08-30: a judgement that fails validation fails on THIS claim's content (live: one stubborn claim ended three passes running while 18 others had just judged clean); `judge_capped` and `judge_unavailable` stay account-wide stops. */ const PER_CLAIM = new Set(["fetch_refused", "fetch_unavailable", "search_refused", "search_unavailable", "search_waiting", "source_quality_unresolved", "judge_refused"]);

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
/** How much of a proposed replacement its sources must carry before it may replace published words. */ const SUPPORTED_SHARE = 0.6;
const FILLER = new Set(["that", "this", "with", "from", "have", "which", "meaning", "means", "name", "also", "used", "word", "these", "their", "them", "when", "such", "into", "than", "then", "they", "were", "been", "being", "there", "where", "what", "would", "about"]);
/** TWO INDEPENDENT ones may carry a confirmation between them; one carries `likely` and no more. */
const CREDIBLE = new Set<SourceKind>(["news"]);
/** Never read at all: user-generated, video and baby-name mills. */
const REJECTED = new Set<SourceKind>(["community", "babyname"]);

export const pageHashOf = (body: string): string => createHash("sha256").update(body).digest("hex").slice(0, 16);

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "its", "are", "was", "were", "has",
  "have", "had", "holds", "hold", "held", "also", "ever", "been", "not", "which", "their", "there", "into", "over"]);

/** THE SEARCH IS THE PROPOSITION. The subject alone researched "Ahvaz, Iran definition reference" for the claim that Ahvaz holds Asia's 54 degree heat record (Codex, 2026-08-18): the claim type may shape the query, but it may never erase the date, number, relationship or assertion being verified. AND FOR A ROW WITH NO CURRENT WORDING THE SEARCH CARRIES THE PAGE'S OWN SUBJECT (reviewer, 2026-09-02): such a row's subject is the bare question, so "are there cobras in iran" searched the world at large and came back with Iran's army aviation, and the judge was then handed passages about AH-1 Cobra attack helicopters for a page about a snake. `about` is the page's title and h1 and leads the query; a correction has its own wording to search and never takes it. */
/** WHAT KIND OF SOURCE WOULD SETTLE THIS, one small hint per type. The claim itself is preserved whole below. */
const HINT_FOR: Record<ClaimType, string> = { word_meaning: " name meaning origin etymology",
  usage_or_register: " usage formal informal grammar", // a usage rule is settled by a grammar or instructional reference, never by a dictionary headword
  geography: " location region geography", date_or_event: " date period history",
  // A COUNT ASKS HOW MANY. The proposition already carries the figure and its subject; this is the one word that makes a reference answer with the count rather than with an essay about the thing being counted.
  quantity: " how many", definition: "", specification: "", entity_fact: "" };

export function sourceQueryFor(type: ClaimType, subject: string, current: string, about = ""): string {
  const seen = new Set<string>(); const toks: string[] = [];
  for (const raw of `${current.trim() ? "" : about} ${subject} ${current}`.replace(/[()"]/g, " ").split(/\s+/)) {
    const t = raw.replace(/[.,;:!?]+$/g, "");
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    if (/[\d°]/.test(k) || (k.length >= 3 && !STOP.has(k))) { seen.add(k); toks.push(t); }
    if (toks.length >= 14) break;}
  const hint = HINT_FOR[type]; // shaped by the proposition, never a synonym dump and never a second query builder
  return `${toks.join(" ")}${hint}`.trim();}

/** A STATEMENT'S IDENTITY is the normalized claim plus where it sits, never the subject alone: a page can say two different things about one subject and both are real (Codex, 2026-08-18). */
export function claimIdentity(subject: string, current: string, locator?: string | null): string {
  const norm = `${subject}|${current}|${locator ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return `${statementKeyOf(subject)}#${createHash("sha256").update(norm).digest("hex").slice(0, 10)}`;}

/** THE CLAIM'S CONTENT-TOKEN FINGERPRINT: subject + wording reduced to its content words, sorted. Two statements with the SAME content words in any order are one proposition reworded, and the second is superseded free instead of researched twice. Deliberately NOT semantic: a reformulation that swaps in different words is a different fingerprint and is researched on its own (Codex, 2026-08-18). */
export function tokenFingerprintOf(subject: string, current: string, role: ClaimType = "definition"): string {
  const toks = `${subject} ${current}`.toLowerCase().replace(/[^\p{L}\p{N}° ]+/gu, " ").split(/\s+/)
    .filter((t) => t.length > 0 && (/[\d°]/.test(t) || (t.length >= 4 && !STOP.has(t))));
  // THE NORMALIZED ROLE JOINS THE PROPOSITION, never the heading's prose: two headings that both mean "these are name meanings" stay ONE proposition, or every heading edit mints a new claim. Without it an owed claim was superseded as a duplicate WITHOUT being researched, so a checked title definition could settle a name-meaning claim for free.
  return `${role}:${[...new Set(toks)].sort().join(" ")}`;}

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
  + '`language` is the language the passage says the subject belongs to. `script` is the subject written in its own script when the passage gives it, else null. '
  + 'For page_imprecise, `proposed` is the page\'s own wording with ONLY the unsupported part removed or corrected: keep every supported word the page already carries, and never discard supported context for a rewrite. '
  + 'Include EVERY meaning your quoted passages support, never a silent subset. Write natural dictionary English with standard orthography (one word where English writes one, such as hailstone). '
  + 'A rewording that keeps the same meaning, such as swapping "Hand of God" for "God\'s hand", is page_correct, never a correction.';

type Extracted = { statements: { subject: string; current: string; locator?: string }[] };
type Judged = { verdict: FactCheck["verdict"]; proposed: string; literal: string; usage: string;
  confidence: FactCheck["confidence"]; note: string;
  supporting: { url: string; quote: string; supported?: boolean; supportSpan?: string; subjectSpan?: string;
    subjectFrom?: "quote" | "title"; relationSpan?: string; meaningSpans?: string[] }[];
  subjects?: { url: string; sameEntity: boolean; language: string; script: string | null; why: string }[] };

/** THE SCRIPT A LANGUAGE IS WRITTEN IN, for the one half of subject identity code can check without asking anybody: a passage claiming to define a Persian word, that contains no Perso-Arabic character anywhere, has not shown the word it is defining. Generic and open: a language absent here simply skips this test rather than failing it, so this is never a list of approved subjects. */
const SCRIPT_OF: Record<string, RegExp> = {
  persian: /[\u0600-\u06FF]/, farsi: /[\u0600-\u06FF]/, arabic: /[\u0600-\u06FF]/, urdu: /[\u0600-\u06FF]/,
  russian: /[\u0400-\u04FF]/, ukrainian: /[\u0400-\u04FF]/, bulgarian: /[\u0400-\u04FF]/,
  greek: /[\u0370-\u03FF]/, hebrew: /[\u0590-\u05FF]/, hindi: /[\u0900-\u097F]/, sanskrit: /[\u0900-\u097F]/,
  chinese: /[\u4E00-\u9FFF]/, japanese: /[\u3040-\u30FF\u4E00-\u9FFF]/, korean: /[\uAC00-\uD7AF]/,
  armenian: /[\u0530-\u058F]/, georgian: /[\u10A0-\u10FF]/, thai: /[\u0E00-\u0E7F]/,};

/** WHY A PAID DOOR GAVE NOTHING, carried end to end. `capped` = the budget refused it, `waiting` = a posted task has not answered, `refused` = it answered and the answer would not validate, `unavailable` = it could not be reached. Each is a different debt and each leaves the claim owed (Codex, 2026-08-18). */
type ProviderHold = "capped" | "waiting" | "refused" | "unavailable";

/** The one model call a unit may make. `kind` names the STRUCTURED OUTPUT SCHEMA the answer must satisfy, so a caller cannot quietly ask the editor judge for a claim list and read zero statements for ever. */
type StructuredRead = (input: { kind: "fact_claim_extraction" | "fact_claim_judgement";
  system: string; user: string; grounded: string; projectedCostUsd: number; maxTokens: number })
  => Promise<{ value: Record<string, unknown> } | { hold: ProviderHold }>;

/** WHY A UNIT FAILED, as an identity a later reader can act on: a cap, a queue wait, a timeout and a schema refusal are different debts, and one generic sentence hid which of them repeated paid attempts were hitting (Codex, 2026-08-18). Every failure leaves the claim OWED. */
type UnitFailure = "no_page_body" | "lease_exhausted" | "inventory_write_failed" | "store_write_failed"
  | "lease_lost" | "source_quality_unresolved"
  | `extraction_${ProviderHold}` | `search_${ProviderHold}` | `fetch_${ProviderHold}` | `judge_${ProviderHold}`;

/** A search answer: readable results or a TYPED provider hold. Only the readable shape may settle a claim. */
type SearchAnswer = { organic: { domain: string; url: string; title: string | null }[] } | { hold: ProviderHold };
/** A source read: the page's words or a TYPED hold. A hold never clears the claim. */
type SourceAnswer = { text: string; title?: string | null } | { hold: ProviderHold };

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
  /** POST THE SUCCESSOR CLAIM'S SEARCH WHILE THIS ONE SETTLES, fire and forget (operator, 2026-08-30: provider waits are pipelined where safe). The cache layer keys on the INPUT, so the successor's real search collects the very task this posted instead of buying twice; a successor never reached leaves a paid task the NEXT pass collects from cache at $0. */
  warmSearch?: (query: string) => void;
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

/** WHAT ONE UNIT DID. `advanced` = durable progress was STORED (a claim banked, or the next section inventoried). `done` = this page version owes nothing at full coverage. `failed` = nothing advanced and the claim is still owed, which must never move a run on to publishing. */
type FactCheckUnitResult = { status: "advanced" | "done" | "failed"; banked: number;
  cursor: FactCheckCursor | null; failure?: UnitFailure; reason?: string;
  /** WHICH CLAIM THIS UNIT TOOK ON, so a pass may set one aside and reach the next. */ attempted?: string };

const enough = (deadlineAt: number, need: number): boolean => Date.now() + need + RESERVE_MS <= deadlineAt;
/** PURE. THE PASSAGE AROUND THE SUBJECT, never simply the opening of the document (the entity-anchored window the claim-verification literature reads on). A long reference page's first 6,000 characters are its navigation and its introduction, so a subject discussed further down reached the judge in an excerpt that never named it. About 160 words either side of the first place the subject, or a number the claim itself carries, appears past the opening; the opening stands when the subject is absent or already inside it, and the 6,000-character cap still bounds everything sent. */
function subjectWindow(text: string, anchors: readonly string[], max = 6_000, words = 160): string {
  const hay = text.toLowerCase(), at = anchors.map((a) => hay.indexOf(a.trim().toLowerCase())).filter((i) => i > max / 2).sort((x, y) => x - y)[0];
  if (at == null) return askedWindow(text, anchors[0] ?? "", max);
  return `${text.slice(0, at).split(/\s+/).slice(-words).join(" ")} ${text.slice(at).split(/\s+/).slice(0, words * 2).join(" ")}`.slice(0, max);
}
/** PURE. AND WHEN THE ANCHOR IS NOWHERE, THE REGION THE SUBJECT'S OWN WORDS ARE DENSEST IN, never the document's opening (reviewer, 2026-09-02). A missing-information row's subject IS the question that was researched, "iran flag before 1979", which no source sentence contains, so the anchor above never fired and the judge read the first 6,000 characters of a reference article: on Flag_of_Iran that is the CURRENT flag, the pre-1979 flag sits under History past character 6,000, and the row banked a passage about the flag that REPLACED the one it was claiming. The window is the run of whole sentences, at most `max` characters, carrying the most DISTINCT words of the subject, counted distinctly so a long uniform lead repeating two of them never outvotes the one passage that carries them all; the earliest such run wins, and the opening stands when no word of the subject occurs anywhere. Verbatim: a slice of the fetched text, so the judge and the bank-time selection read one region and the selection can never see text the judge did not. */
function askedWindow(text: string, subject: string, max: number): string {
  const words = (t: string): string[] => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], want = new Set(words(subject).filter((w) => w.length >= 4 || /\d/.test(w)));
  const sents = text.match(/[^.!?\n]+[.!?]+["')\]]?|[^.!?\n]+$/g) ?? []; if (want.size === 0 || sents.length === 0) return text.slice(0, max);
  const at: number[] = []; let cut = 0; for (const x of sents) { const i = text.indexOf(x, cut); at.push(i < 0 ? cut : i); cut = (i < 0 ? cut : i) + x.length; }
  const said = sents.map((x) => [...new Set(words(x).filter((w) => want.has(w)))]), held = new Map<string, number>(); let from = 0, best = { at: 0, n: 0 };
  for (let i = 0; i < sents.length; i += 1) {
    for (const w of said[i]!) held.set(w, (held.get(w) ?? 0) + 1);
    while (at[i]! + sents[i]!.length - at[from]! > max && from < i) { for (const w of said[from]!) { const n = held.get(w)! - 1; if (n > 0) held.set(w, n); else held.delete(w); } from += 1; }
    if (held.size > best.n) best = { at: at[from]!, n: held.size }; }
  return best.n === 0 ? text.slice(0, max) : text.slice(best.at, best.at + max); }
const fail = (failure: UnitFailure, cursor: FactCheckCursor | null, reason: string, attempted?: string): FactCheckUnitResult =>
  ({ status: "failed", banked: 0, cursor, failure, reason, ...(attempted ? { attempted } : {}) });

/** ONE unit: at most one claim researched (or one section inventoried), everything durable before it returns. */
export async function runFactCheckUnit(d: FactCheckUnitDeps): Promise<FactCheckUnitResult> {
  const { tenantId, page, now } = d;
  if (!page.body.trim()) return fail("no_page_body", null, "no stored words for this page");
  const hash = pageHashOf(page.body), own = [...new Set(page.body.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 2))].join(" ").split(/\s+/).slice(0, 8).join(" "); // THE PAGE'S OWN SUBJECT: its title and its h1, which owned-context joins as the first two lines of the stored body, an identical pair counted once and eight words at most so a long title can never crowd the question out of the query. A row with no current wording is researched ABOUT THIS, never about its question alone.
  // 1. THE CLAIM INVENTORY FOR THIS PAGE VERSION AND ITS COVERAGE, READ BACK FROM THE STORE: a lease lost mid page resumes where it stopped, and completeness outlives the pass. Coverage is what keeps a long page
  // honest: the first 12,000 characters are a SECTION, never the page (Codex, 2026-08-18).
  const mine = (d.held ?? []).filter((h) => h.page === page.path);
  let inventory = mine.filter((h) => h.pageContentHash === hash && h.state !== "superseded");
  const covRead = d.readCoverage ? await d.readCoverage().catch(() => null) : null;
  let cov: InventoryCoverage = covRead && covRead.pageContentHash === hash
    ? covRead : { pageContentHash: hash, coveredChars: 0, totalChars: page.body.length };
  // A VERDICT FROM OBSOLETE RULES IS NOT CURRENT EVIDENCE (Codex, 2026-08-18): the one live checked row was
  // AND A CONFIRMED VERDICT THE QUOTE-BOUND CONTRACT NOW REFUSES IS A CLAIM STILL OWED, not a settled finding: withdrawing the card without reopening the claim would strand the exact live defects this contract was written about (Alborz, Jasmine) as permanent dead findings, because a checked row is never re-inventoried. TARGETED, never a blanket version bump: only the rows the new authorization refuses reopen, so the four sound live corrections keep their verdicts and cards. Loop-safe: generation now binds to quotes too, so a re-researched claim either banks a carried gloss or holds below confirmed, where unauthorizedReason is null.
  const obsolete = inventory.filter((h) => (h.state === "checked" && h.rulesVersion !== rulesVersionFor(h))
    || (h.state === "checked" && h.confidence === "confirmed" && unauthorizedReason(h) != null));
  if (obsolete.length > 0 && await reopenObsoleteChecks(tenantId, page.path, obsolete).catch(() => 0) > 0) {
    inventory = inventory.map((h) => (obsolete.includes(h) ? { ...h, state: "owed" as const, rulesVersion: rulesVersionFor(h) } : h));}
  // THE SEEDED PROPOSITION IS RESEARCHED FIRST. A row whose locator is `missing` exists only because an acquisition seeded it for a funded candidate that was refused for lacking exactly that fact, so it outranks
  // rotation over the page's own existing statements: without this the pass spent its budget re-checking claims the page already makes and reported the reading as acquired, while the writer had nothing new to cite.
  const waiting = (h: FactCheck): boolean => h.pageLocator === "missing" || rulesVersionFor(h) === MISSING_ANSWER_RULES_VERSION, seededFirst = (rows: typeof inventory) => [...rows].sort((a, b) => (waiting(b) ? 1 : 0) - (waiting(a) ? 1 : 0)); // and a question this page does not answer outranks its inventory whatever its locator says, because a reopened row keeps the locator it was banked with
  let owed = seededFirst(inventory.filter((h) => h.state === "owed"));
  if (cov.coveredChars < cov.totalChars) {
    // EXTRACT THE NEXT SECTION, WHATEVER IS ALREADY OWED. Waiting for the owed queue to empty is a deadlock: a another character. Live: rules v4 re-opened 21 claims, the queue stood at 33, and eighteen passes left coverage at 0 of 11,589 while ~160 entries were neither owed nor checked. Extraction is what gives an entry a disposition at all and costs about two cents a section, so it no longer queues behind research.
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
    const propOf = (x: { subject: string; current: string }, loc: string | null): string => tokenFingerprintOf(x.subject, x.current, claimTypeOf(x.subject, x.current, loc));
    const knownProps = new Set(inventory.map((h) => propOf(h, h.pageLocator)));
    const claims = ((extracted as unknown as Extracted).statements ?? []) .filter((s) => s.subject?.trim() && s.current?.trim())
      .map((s) => ({ subject: s.subject.trim(), current: s.current.trim(), locator: s.locator?.trim() || null }))
      .map((c) => ({ ...c, statementKey: claimIdentity(c.subject, c.current, c.locator), prop: propOf(c, c.locator) }))
      // One row per identity AND one per proposition: reformulations of one fact are researched once.
      .filter((c, i, all) => all.findIndex((x) => x.statementKey === c.statementKey) === i) .filter((c, i, all) => all.findIndex((x) => x.prop === c.prop) === i)
      .filter((c) => !knownIds.has(c.statementKey) && !knownProps.has(c.prop));
    if (cov.coveredChars === 0) {
      // THE PAGE MOVED ON: whatever was held against an older version, or objects to wording this version no
      // longer carries, becomes history now rather than a second live instruction beside its own replacement.
      const body = page.body.toLowerCase();
      await supersedeStaleFacts(tenantId, page.path, hash, (current) => body.includes(current.trim().toLowerCase()))
        .catch((e) => { log.warn("[fact-check] stale claims could not be retired", { tenantId, page: page.path, error: String(e) }); return 0; });}
    // THE INVENTORY AND ITS COVERAGE ARE THE CURSOR, stored BEFORE one claim is researched. A write that did not land is a failed unit: researching against an inventory nobody stored is how page two was lost.
    const wrote = claims.length === 0 ? 0 : await recordOwedClaims(tenantId, page.path, claims, hash, d.basis).catch(() => -1);
    if (wrote < 0) return fail("inventory_write_failed", null, "the page's claim inventory could not be stored, so nothing was researched");
    // A CAPPED EXTRACTION HAS NOT READ ITS CHUNK, IT HAS FILLED UP: one oversized chunk once swallowed a cursor now advances only to the end of the last statement read, found by its own wording, and nothing is re-banked because both filters above dedupe. MEASURED ON WHAT CAME BACK, never on what survived that dedupe: a chunk returning exactly the cap and then losing rows read as "not capped".
    const last = returned.length >= CLAIM_CAP ? returned[returned.length - 1]! : null;
    const at = last ? chunk.toLowerCase().lastIndexOf(last.toLowerCase().slice(0, 60)) : -1;
    const read = at >= 0 ? Math.max(1, at + Math.min(last!.length, 60)) : chunk.length;
    cov = { pageContentHash: hash, coveredChars: Math.min(cov.coveredChars + read, page.body.length), totalChars: page.body.length };
    if (d.writeCoverage && !(await d.writeCoverage(cov).catch(() => false)))
      return fail("inventory_write_failed", null, "the section's coverage could not be stored, so it would be read and paid for again");
    inventory = [...inventory, ...claims.map((c) => ({ ...EMPTY_ROW, page: page.path, statementKey: c.statementKey, rulesVersion: rulesVersionFor(c),
      subject: c.subject, current: c.current, pageLocator: c.locator, pageContentHash: hash, evidenceBasis: d.basis,
      state: "owed" as const, checkedAt: now.toISOString() }))];
    owed = seededFirst(inventory.filter((h) => h.state === "owed")); // a freshly inventoried section may not bury it either
  }
  // 2. THE NEXT OWED CLAIM WHOSE PROPOSITION IS NOT ALREADY SETTLED. A duplicate of a checked fact is superseded for free, never researched and paid for again.
  const propOf = (h: FactCheck): string => tokenFingerprintOf(h.subject, h.current, claimTypeOf(h.subject, h.current, h.pageLocator));
  const settled = new Set(inventory.filter((h) => h.state === "checked").map(propOf));
  let next: FactCheck | null = null;
  for (const o of owed) {
    if (d.skip?.has(o.statementKey)) continue; // this pass already tried it and it did not resolve
    if (!settled.has(propOf(o))) { next = o; break; }
    const ok = await recordFactChecks(tenantId, page.path, [{ ...o, state: "superseded",
      note: "Duplicate of a proposition already checked at this page version." }]).catch(() => 0);
    if (ok > 0) owed = owed.filter((x) => x !== o);}
  const progress = { page: page.path, pageContentHash: hash, evidenceBasis: d.basis,
    checked: inventory.length - owed.length, total: inventory.length };
  const covered = cov.coveredChars >= cov.totalChars;
  if (!next) {
    return covered
      ? { status: "done", banked: 0, cursor: { ...progress, pageComplete: true }, reason: "every claim on this page version is current and the whole stored body was inventoried" }
      : { status: "advanced", banked: 0, cursor: { ...progress, pageComplete: false }, reason: `inventoried through character ${cov.coveredChars} of ${cov.totalChars}; more of the page remains` };}
  const claim = { subject: next.subject, current: next.current, locator: next.pageLocator };
  const cursor: FactCheckCursor = { ...progress, pageComplete: false };
  const advance: FactCheckCursor = { ...progress, checked: progress.checked + 1, pageComplete: covered && owed.length === 1 };
  const type = claimTypeOf(claim.subject, claim.current, claim.locator);

  const bank = async (row: FactCheck): Promise<FactCheckUnitResult> => {
    const banked = await recordFactChecks(tenantId, page.path, [row]);
    log.info("[fact-check] one claim researched", { tenantId, page: page.path, subject: claim.subject, type, confidence: row.confidence, banked });
    // A WRITE THAT DID NOT LAND IS A FAILED UNIT: advancing past a claim nothing stored would skip it forever.
    return banked > 0 ? { status: "advanced", banked, cursor: advance }
      : fail("store_write_failed", cursor, "the result could not be stored, so this claim is still owed");};
  const base = { page: page.path, statementKey: next.statementKey, state: "checked" as const, rulesVersion: rulesVersionFor(claim), subject: claim.subject, current: claim.current,
    literal: null, usage: null, alsoAt: claim.locator ? [claim.locator] : [],
    pageContentHash: hash, pageLocator: claim.locator, sourceReadAt: null as string | null,
    evidenceBasis: d.basis, checkedAt: now.toISOString() };

  // 3. ACQUIRE candidates by searching THE PROPOSITION, shaped but never erased by the claim type.
  if (!d.searchSources || !enough(d.deadlineAt, 15_000)) return fail("lease_exhausted", cursor, "no lease left to look for sources");
  // THE SUCCESSOR'S SEARCH IS POSTED BEFORE THIS ONE IS AWAITED, so both tasks grind at the provider while this claim fetches and judges: the posted-SERP wait was the whole p95 tail (129s against a 20.6s median, live waves 2026-08-30).
  const succ = owed.find((o) => o !== next && !d.skip?.has(o.statementKey) && !settled.has(propOf(o)) && propOf(o) !== propOf(next!));
  if (succ) d.warmSearch?.(sourceQueryFor(claimTypeOf(succ.subject, succ.current, succ.pageLocator), succ.subject, succ.current, own));
  const found = await d.searchSources(sourceQueryFor(type, claim.subject, claim.current, own)).catch(() => ({ hold: "unavailable" as const }));
  // A PROVIDER THAT DID NOT ANSWER IS NOT A WORLD WITH NO SOURCES: capped, waiting, refused and unreachable each leave the claim OWED under their own name, and only a readable answer with no qualifying source banks `none_found`.
  if ("hold" in found) return fail(`search_${found.hold}`, cursor, `the source search is ${found.hold}, so this claim is still owed`, next.statementKey);
  // EXCLUSIONS COME BEFORE THE LIMIT, and ONE CANDIDATE PER PUBLISHER. Taking the first six raw results and filtering afterwards threw away a whole results page: six credible outlets were cut before the policy ever saw them, and the claim would have been buried as an empty world (Codex, 2026-08-19). The allowance counts QUALIFYING candidates.
  const organic = found.organic ?? [];
  const seenDomains = new Set<string>();
  // A SITE MAY NOT VOUCH FOR ITSELF, and nothing enforced it: live, the Nazanin correction cited the very page it was correcting, iranopedia.com/persian-female-first-names, and banked that as a source.
  const ownSite = (page.url ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const candidates = organic
    .map((o) => ({ url: o.url, domain: o.domain.replace(/^www\./, "").toLowerCase(), kind: sourceClassOf(o.domain), title: o.title ?? "" })) .filter((c) => !REJECTED.has(c.kind))
    .filter((c) => !ownSite || (c.domain !== ownSite && !c.domain.endsWith(`.${ownSite}`)))
    .filter((c) => !seenDomains.has(c.domain) && seenDomains.add(c.domain) !== undefined)
    .sort((a, b) => (AUTHORITATIVE.has(b.kind) ? 1 : 0) - (AUTHORITATIVE.has(a.kind) ? 1 : 0)) .slice(0, CANDIDATES);
  // `none_found` IS A CLAIM ABOUT THE WORLD, and only an empty results page may make it. A page full of results none of which clears the policy is an unresolved question, and the claim stays owed.
  if (organic.length === 0) {
    return bank({ ...base, proposed: null, sources: [], agreement: "none_found", confidence: "unsupported",
      verdict: "undecidable", note: "The search was readable and returned nothing at all for this claim, so nothing is proposed." });}
  if (candidates.length === 0) return fail("source_quality_unresolved", cursor,
    `the search returned ${organic.length} results and none clears the source policy, so this claim is still owed`, next.statementKey);
  // PUBLISHER-DIVERSE PICKS: the second fetch prefers a DIFFERENT source class, so two generic encyclopedia pages are not taken merely because they rank first (Codex, 2026-08-18).
  const second = candidates.slice(1).find((c) => c.kind !== candidates[0]!.kind) ?? candidates[1];
  const picks = [candidates[0]!, ...(second ? [second] : [])].slice(0, FETCH_PER_CLAIM);

  // 4. READ THE SOURCES, AROUND THE SUBJECT. A title is not a fact, and A SOURCE NOBODY READ NEVER CLEARS THE CLAIM: when every fetch fails the claim stays OWED, because "the evidence disproved nothing" and "the infrastructure could
  // not read the evidence" are different answers (Codex, 2026-08-18).
  const passages: { url: string; kind: SourceKind; text: string; title: string | null; readAt: string }[] = [];
  let lastHold: ProviderHold = "unavailable";
  for (const c of picks) {
    if (!d.fetchSource || !enough(d.deadlineAt, 20_000)) break;
    const got = await d.fetchSource(c.url).catch(() => ({ hold: "unavailable" as const }));
    if ("hold" in got) { lastHold = got.hold; continue; }
    if (got.text.trim()) passages.push({ url: c.url, kind: c.kind, title: got.title ?? null, readAt: new Date().toISOString(),
      text: subjectWindow(got.text, [claim.subject, ...(claim.current.match(/\b\d[\d,.]*\b/g) ?? [])]) });}
  if (passages.length === 0) return fail(`fetch_${lastHold}`, cursor, `sources were found and reading them is ${lastHold}, so this claim is still owed`, next.statementKey);

  // 5. JUDGE against the passages only.
  if (!enough(d.deadlineAt, 20_000)) return fail("lease_exhausted", cursor, "no lease left to judge this claim");
  const verdict = await d.read({ kind: "fact_claim_judgement", system: JUDGE_SYSTEM,
    // A MISSING PROPOSITION IS RESEARCHED, NOT COMPARED: an owed claim with no current wording is the page's acknowledged gap (the missing-information loop seeds exactly these), so the judge is asked what the passages establish about the subject rather than to grade an empty quotation. `proposed` then carries the researched statement, which is what the writer's fact-* evidence renders. AND IT ANSWERS THE QUESTION ABOUT THIS PAGE'S OWN SUBJECT OR IT PROPOSES NOTHING (reviewer, 2026-09-02): asked for "the accurate, source-supported statement of this subject" over passages about Iran's army aviation, the judge wrote "Iran has AH-1 Cobra attack helicopters." for the Persian cobra page and noted that the sources do not address snakes. The page's own subject is named, one sentence from one quotable passage is what may be proposed, and `page_correct` is what says both held.
    user: [`Claim type: ${type}`, `Subject: ${claim.subject}`,
      claim.current.trim() ? `The page says: "${claim.current}"` : `The page does not answer this yet. This page is about: ${own}. From the passages alone, state in \`proposed\` ONE sentence that answers this question ABOUT THAT SUBJECT, taken from a single passage you can quote from one source; verdict page_correct means that sentence answers the question and the passage you quote supports it. If no passage answers this question about that subject, propose nothing, answer unsupported, and return verdict undecidable.`,
      "Passages fetched from real sources:",
      ...passages.map((p) => `--- [${p.kind}] ${p.url}${p.title ? ` (document title: ${p.title})` : ""}\n${p.text}`), "", "Return the JSON now."].join("\n"),
    grounded: passages.map((p) => p.text).join("\n"), projectedCostUsd: 0.02, maxTokens: 1500 }).catch(() => ({ hold: "unavailable" as const }));
  if ("hold" in verdict) return fail(`judge_${verdict.hold}`, cursor, `judging this claim is ${verdict.hold}, so it is still owed`, next.statementKey); // the key rides along so a per-claim refusal is set aside instead of ending the pass
  const v = verdict.value as unknown as Judged;
  // EVERY CLAIMED SUPPORT IS VERIFIED IN ITS OWN SOURCE. A quote is credited only to the passage that actually
  // contains it, so one sentence attributed to several publishers supports exactly the one it came from.
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
  const proposedNow = (v.proposed ?? "").trim(), kind = claimTypeOf(claim.subject, claim.current || proposedNow, claim.locator); // ONE CLASSIFICATION, BOTH DOORS (reviewer, 2026-09-02). The kind above is read from the page's own wording, which a missing-information row does not have, while the authorization door rebuilds it from the wording OR the researched statement: the two disagreed, the identity never matched, the artifact read `stale` on every drive, and two live rows were handed back and re-bought for ever. What a row asserts is what classifies it at both doors.
  const ctxOf = (p: (typeof passages)[number], quote: string): SupportContext => ({ tenantId, page: page.path, statementKey: next!.statementKey, pageLocator: claim.locator, subject: claim.subject, claimKind: kind, current: claim.current, proposed: proposedNow, url: p.url, kind: p.kind, quote, titleContext: p.title ?? null });
  /** THE ONE TO THREE CONSECUTIVE SENTENCES OF THIS SOURCE'S OWN FETCHED TEXT THAT CARRY THE PROPOSAL, or null: a window of the text this fetch already read, in its own words and order, never assembled from pieces, at most 600 characters, accepted only when it clears the carriage bar, and the TIGHTEST window wins a tie so no sentence rides along that carries nothing. */
  const carrying = (p: (typeof passages)[number]): string | null => {
    const sents = (p.text.match(/[^.!?\n]+[.!?]+["')\]]?|[^.!?\n]+$/g) ?? []).map((x) => x.trim()).filter((x) => x.length > 2); let best: { window: string; carried: number } | null = null;
    for (let i = 0; i < sents.length; i += 1) for (let k = 1; k <= 3 && i + k <= sents.length; k += 1) {
      const window = sents.slice(i, i + k).join(" "); if (window.length > 600) break;
      const a = deriveSupport(ctxOf(p, window));
      if (a && (!best || a.meaningSpans.length > best.carried || (a.meaningSpans.length === best.carried && window.length < best.window.length))) best = { window, carried: a.meaningSpans.length }; }
    return best?.window ?? null; };
  const verified = new Map<string, string>(), vouchedAs = new Map<string, string>(); // passage url -> its own verified quote, and passage url -> the url the reader NAMED for it, so the subject it vouched for is found even when a quote resolves to a different passage than the one claimed
  for (const sup of v.supporting ?? []) {
    const quote = (sup.quote ?? "").trim();
    const p = quote.length === 0 ? undefined : passages.find((x) => x.url === sup.url) ?? passages.find((x) => norm(x.text).includes(norm(quote)));
    if (!p || verified.has(p.url)) continue;
    if (norm(p.text).includes(norm(quote))) { verified.set(p.url, quote); vouchedAs.set(p.url, sup.url); continue; }
    // AND A NAMED SOURCE WHOSE QUOTE IS NOT IN ITS OWN PASSAGE MAY STILL HOLD THE ANSWER (live 19:00 PDT on /iran-flags/iran-islamic-republic-flag-history): the judge answered the pre-1979 flag question correctly from the History passage and paraphrased it into `quote`, both named sources failed the verbatim test, nothing was verified, so nothing was selected and both banked says "" while the row stayed `likely`. For a row with no current wording the passage the judge READ is searched for the window that carries the proposal, exactly as a verified quote that falls short is; the window is the source's own words, so it verifies by construction. A correction is untouched: its failed quote still banks nothing.
    const rescued = claim.current.trim() === "" && proposedNow ? carrying(p) : null;
    if (rescued) { verified.set(p.url, rescued); vouchedAs.set(p.url, sup.url); }}
  // A QUOTE PROVES THE SOURCE SAID IT, NEVER THAT IT SAID IT ABOUT THIS SUBJECT: a passage has to be about the SAME name in the SAME language. The reader names the subject it read and the code checks the half it can. Live, Wikipedia's "Daria (given name)" is quotable and lists "Darya" as a variant, so it authorized a Slavic name descended from Darius as the meaning of Persian دریا, sea. Every test the old chain ran was passing.
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
  // EVERY SOURCE EARNS ITS OWN RULING, AND THE CODE ACCEPTS ONLY WHAT IT CAN VERIFY (claim-support, 2026-08-29). The model locates the supporting sentence and its spans; supportFailure accepts nothing it cannot find verbatim in the exact quote this row banks, localized to ONE sentence, whole words only, the subject named in that sentence or by this same fetch's own document title. What stood here was glossCarriedBy, a bag-of-words provenance test that let a passage about the man who held a title carry a name's meaning; provenance remains a refusal inside unauthorizedReason and authorizes nothing.
  const rulings = new Map((v.supporting ?? []).map((x) => [x.url, x] as const));
  const bankedSources = passages.map((p) => {
    let says = (verified.get(p.url) ?? "").slice(0, 600);
    // THE QUOTE A MISSING-INFORMATION ROW BANKS IS THE PASSAGE THAT CARRIES THE PROPOSITION, not whichever sentence the judge reached for first. Live on /iran-flags the judge quoted two sentences about the flag CHANGING in 1979 and wrote that the passages support the pre-1979 colours and emblem; they did, three sentences away, so the row banked `likely` and its demand row was refused for months. When the verified quote falls short, the one to three consecutive sentences of THIS source's own fetched text that carry the most of the proposal are banked instead: a window of the text this fetch already read, in its own words and order, never assembled from pieces, banked only when it clears the carriage bar, and the TIGHTEST window wins a tie so no sentence rides along that carries nothing.
    if (proposedNow && says && claim.current.trim() === "" && supporters.includes(p) && !deriveSupport(ctxOf(p, says))) says = carrying(p) ?? says;
    const stamp = { url: p.url, kind: p.kind, says, ...(p.title ? { titleContext: p.title, titleContextFrom: "fetched_document" as const } : {}) };
    if (!says || !proposedNow || !supporters.includes(p)) return stamp;
    const ctx = ctxOf(p, says);
    const r = rulings.get(p.url) ?? rulings.get(vouchedAs.get(p.url) ?? "");
    const candidate: ClaimSupport | null = r ? { version: SUPPORT_ARTIFACT_VERSION, identity: supportIdentity(ctx),
      supported: r.supported === true, supportSpan: r.supportSpan ?? "", subjectSpan: r.subjectSpan ?? "",
      subjectFrom: r.subjectFrom === "title" ? "title" : "quote", relationSpan: r.relationSpan ?? "",
      meaningSpans: r.meaningSpans ?? [] } : null;
    const failure = candidate ? supportFailure(candidate, ctx) : "meaning_absent" as const;
    // THE MODEL LOCATES, AND WHEN IT LOCATES BADLY THE CODE MAY LOCATE FOR ITSELF: live, the judge returned supported rulings whose subject span was EMPTY over a quote opening "The name Alborz is derived from", and a fail-closed net with no deterministic fallback starves the pipeline on model formatting rather than on evidence. deriveSupport accepts nothing supportFailure would not; it only finds it.
    return { ...stamp, support: failure == null ? candidate! : deriveSupport(ctx) ?? unsupportedArtifact(ctx, failure) };
  });
  // AGREEMENT IS SUPPORT, NOT INVENTORY: the sources whose own validated artifact carries this proposal. Without a proposal there is nothing to carry and the vouched readers count, exactly as before.
  const carriers = proposedNow
    ? bankedSources.filter((b) => "support" in b && b.support?.supported)
    : bankedSources.filter((b) => b.says.trim() !== "" && supporters.some((p) => p.url === b.url));
  const agreement: FactCheck["agreement"] = carriers.length > 1 ? "multiple_agree" : carriers.length === 1 ? "single_source" : "none_found";
  const readNotCarrying = carriers.length === 0 && supporters.length > 0;
  const confirmable = (supporters.some((p) => AUTHORITATIVE.has(p.kind))
    || supporters.filter((p) => CREDIBLE.has(p.kind)).length >= 2)
    && (!proposedNow || carriers.some((b) => AUTHORITATIVE.has(b.kind)));
  // AND A REPLACEMENT HAS TO BE FOUND IN THE QUOTE THE ROW WILL BANK, NOT MERELY SOMEWHERE ON THE PAGE: the full fetched text used to authorize here, and live it confirmed "Mountain Rampart" off a sentence one past the verified quote, so the customer receipt showed a quote that never carried the published words. The page may help LOCATE evidence; only the BANKED quotes authorize, which is why the share and the door below read what each source is about to store rather than what the judge first offered. A correction (current wording exists) needs every content word of its short gloss carried by those quotes and may not simply restate one of them as the page's line; a missing-information statement keeps the older share, now against quotes.
  const bankedSays = new Map(bankedSources.map((b) => [b.url, b.says] as const));
  const read = norm(supporters.map((p) => bankedSays.get(p.url) ?? "").join(" "));
  const words = (v.proposed ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !FILLER.has(w));
  const share = words.length === 0 ? 1 : words.filter((w) => read.includes(w)).length / words.length;
  // A CORRECTION IS JUDGED HERE BY THE RULE THE CARD DOOR WILL APPLY, so nothing is banked `confirmed` that the door then refuses for ever: such a row reopens, is re-researched, and is refused again. Below confirmed it stays an honest finding and never reopens. Missing information keeps its own share against the quotes.
  const blocked = unauthorizedReason({ subject: claim.subject, current: claim.current, proposed: v.proposed ?? null, verdict: v.verdict, // THE VERDICT RIDES INTO THE ONE RULE, so a row with no current wording is banked confirmed only where the judge answered the question about this page's own subject, which is the same test the card door asks
    sources: supporters.map((p) => ({ kind: p.kind, says: bankedSays.get(p.url) ?? "" })) });
  const carried = blocked == null && (claim.current.trim() !== "" || share >= SUPPORTED_SHARE);
  const confidence: FactCheck["confidence"] = v.confidence === "confirmed" && confirmable && carried ? "confirmed"
    : v.confidence === "unsupported" ? "unsupported" : v.confidence === "disputed" ? "disputed" : "likely";
  return bank({ ...base,
    proposed: confidence === "unsupported" || (claim.current.trim() === "" && v.verdict !== "page_correct") ? null : (v.proposed?.trim() || null), // A STATEMENT ABOUT THE WRONG SUBJECT IS NOT BANKED AT ALL: it would be re-read as the researched answer by every later pass, and the row would be handed back for research for ever
    literal: v.literal?.trim() || null, usage: v.usage?.trim() || null,
    sources: bankedSources,
    sourceReadAt: supporters[0]?.readAt ?? null,
    agreement, confidence, verdict: v.verdict,
    note: `${v.note ?? ""}${supporters.length > 0 ? "" : " No fetched passage carries a quote it relied on, so this is held below confirmed."}${readNotCarrying ? ` ${supporters.length} ${supporters.length === 1 ? "source was" : "sources were"} read and none of them carries the wording proposed here, so no source is named as standing behind it.` : ""}${dropped.length > 0 ? ` ${dropped.length} quoted ${dropped.length === 1 ? "source was" : "sources were"} set aside for being about a different subject or language than this page's.` : ""}${carried || confidence === "unsupported" ? "" : blocked ? ` Held below confirmed: ${blocked}.` : " The wording proposed here is not carried by the verified quote, so it is held below confirmed until a source says it."}`.trim() });
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
  searchSources: (query: string) => Promise<SearchAnswer>; warmSearch?: (query: string) => void;
  fetchSource: (url: string) => Promise<SourceAnswer>;
  readCoverage: (page: string) => Promise<InventoryCoverage | null>;
  writeCoverage: (page: string, cov: InventoryCoverage) => Promise<boolean>;};

type FactCheckPassResult = { status: "advanced" | "done" | "failed"; banked: number;
  pagesComplete: number; attempts: number; failure?: UnitFailure; reason?: string };

/** ONE PASS: at most ATTEMPTS_PER_PASS claim attempts GLOBALLY, however many pages that spans. A failed unit ends the pass with its typed identity, because a cap or an outage repeats on the next attempt and burning the remaining allowance against it proves nothing. */
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
        read: d.read, searchSources: d.searchSources, warmSearch: d.warmSearch, fetchSource: d.fetchSource,
        readCoverage: () => d.readCoverage(page.path), writeCoverage: (cov) => d.writeCoverage(page.path, cov) });
      // A CLAIM THAT WILL NOT RESOLVE IS SET ASIDE, NOT THE WHOLE PASS. Ending on any failed unit is right for a spent budget or an outage, which repeat; wrong for a per-claim failure, because the owed order is stable so it returned to the head every pass. Live: `fetch_refused` at $0 on five passes while 167 others were never reached once. Set aside for THIS pass only; it is owed again on the next.
      if (out.status === "failed" && out.attempted && PER_CLAIM.has(out.failure ?? "")) {
        setAside.add(out.attempted); lastPerClaim = { failure: out.failure!, reason: out.reason ?? "" }; continue; }
      if (out.status === "failed")
        return { status: banked > 0 ? "advanced" : "failed", banked, pagesComplete, attempts, failure: out.failure, reason: out.reason };
      if (out.status === "advanced") {
        progressed = true; banked += out.banked;
        const back = await d.refreshHeld(page.path).catch(() => null);
        if (back) held = [...held.filter((h) => h.page !== page.path), ...back];}
      // A PAGE IS COMPLETE ONLY IF NOTHING ON IT WAS SHELVED: with the allowance no longer cutting the walk short, a pass that set every claim aside reaches "no next claim" and would stamp the page done with no failure, burying the typed holds it just recorded.
      if (out.status === "done" || out.cursor?.pageComplete) { if (!held.some((h) => h.page === page.path && setAside.has(h.statementKey))) pagesComplete += 1; break; }}}
  // AN ACCOUNT WITH NO STORED PAGE WORDS OWES NOTHING HERE. Reading that as a failure would pause a fresh
  // account at this phase for ever, now that it runs ahead of the crawl that fills the store.
  if (opened === 0) return { status: "done", banked: 0, pagesComplete: 0, attempts, reason: "no stored page words to check yet" };
  // A PASS THAT SET EVERY CLAIM ASIDE DID NOT RUN OUT OF LEASE, and saying so PAUSES the run: `lease_exhausted`
  // is a hard stop. The last real reason is carried out of the loop and reported as itself.
  return { status: progressed ? "advanced" : pagesComplete > 0 ? "done" : "failed", banked, pagesComplete, attempts, ...(progressed || pagesComplete > 0 ? {} : lastPerClaim
      ? { failure: lastPerClaim.failure, reason: lastPerClaim.reason }
      : { failure: "lease_exhausted" as const, reason: "no page could be worked this pass" }) };}
