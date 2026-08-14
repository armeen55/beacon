import "server-only";

/**
 * decision/producers/page-job: WHAT ONE PAGE IS FOR, in a sentence, read off the page's own stored extract.
 *
 * Every producer in this folder decides which page a search belongs on by counting shared words. Shared words are a
 * coincidence detector, not an understanding: a page of Persian boy names and a page about a city in Iran share the
 * word "Iranian", so a section about one landed on the other. A page job is the missing sentence. It says what the
 * page is for, what shape it is, who reads it, which subjects it covers and whether it sells, and a fit check reads
 * that instead of guessing from an overlap.
 *
 * FOUR RULES HOLD THIS FILE.
 *   1. THE READING IS DURABLE. It lives in page_understanding, one row per page, versioned by the fingerprint of the
 *      extract it was read from. It used to live in the shared call cache, which held 300 rows for a whole account
 *      and was emptied nightly by the answer analyses, so a site that had been read woke up knowing nothing about
 *      itself. A row whose fingerprint still matches is served free forever; a row whose page changed under it is
 *      served STALE and refreshed when the pass can afford to.
 *   2. A MISSING READING IS TYPED, never a bare null. "Not asked" and "could not afford" and "the page has no words"
 *      are opposite facts that used to arrive as the same silence. Callers act on the reason: a card that carries a
 *      subject from somewhere else onto a page HOLDS when the reason is not_asked or refused, because placing an
 *      essay on a page nobody has read is research, not publishable work; unaffordable and unreadable keep the old
 *      fail-open behaviour so a budget ceiling never empties the queue.
 *   3. THE WHOLE SITE GETS READ. One pass buys at most MAX_NEW_READS_PER_PASS new readings, spent on the pages that
 *      matter first and then on a rotation through everything else, resumed from a persisted cursor, so a large site
 *      converges over passes instead of re-reading the same sixty pages forever.
 *   4. BOUNDED SPEND. Every read goes through the drafter's own checkBudget/recordSpend gateway, and a durable or
 *      cached hit costs nothing and counts against nothing.
 *
 * The reading NAMES the page. It never writes copy, never proposes a change, and never decides that a page should
 * exist: that verdict belongs to the coverage path, which owns new-page identity.
 */

import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl } from "@/domains/decision/llm/call-cache";
import type { PageJob } from "@/domains/decision/llm/schemas";
import { pageStore, type PageUnderstanding } from "./page-understanding";

/** What one page's stored capture holds, as much of it as the caller actually has. Every field is optional on
 *  purpose: the lean page projection carries a title, a heading, an outline and a word count for every owned page,
 *  and the opening words are held only where the caller already paid to read the body. */
type PageExtract = {
  url: string;
  title?: string | null;
  h1?: string | null;
  headings?: readonly string[];
  openingSample?: string | null;
  wordCount?: number | null;
  /** When this capture was taken, when the caller knows. Recorded on the durable reading, never used to date it. */
  fetchedAt?: string | null;
};

/** One page's job, carrying the address it was read for. */
export type OwnedPageJob = PageJob & { url: string };

/** WHY A PAGE HAS NO JOB, or how the one it has was come by. Five outcomes used to arrive as one null.
 *  read: a current reading, from the durable row or bought just now. stale: a reading taken before the page
 *  changed, served as the best thing known. not_asked: nobody asked, so nobody knows. unaffordable: the pass or
 *  the account was out of budget. unreadable: the capture holds no words to read. refused: the reading was asked
 *  for and did not come back usable. */
type JobReason = "read" | "stale" | "not_asked" | "unaffordable" | "unreadable" | "refused";

/** The durable store, injectable so tests exercise the whole path with no database. */
type Store = typeof pageStore;

/** What one reading is expected to cost, for the budget reservation. */
const PAGE_JOB_COST_USD = 0.002;
/** Reasoning tokens are spent before the answer, so the ceiling covers both; the answer itself is a few lines. */
const PAGE_JOB_MAX_TOKENS = 1200;
/** How many readings run at once. Four keeps the provider inside its concurrency and one pass inside its time. */
const CONCURRENCY = 4;
/** New readings one pass may BUY. A durable or cached hit costs nothing and never counts, so a site that has been
 *  read answers for free forever and a cold one spreads over passes rather than spending its month in one sweep. */
const MAX_NEW_READS_PER_PASS = 60;
/** Bounds on what is shown to the model, so one enormous page cannot become one enormous prompt. */
const MAX_HEADINGS = 24, MAX_HEADING_CHARS = 120, MAX_OPENING_CHARS = 600, MAX_TITLE_CHARS = 200;

const SYSTEM = [
  "You read ONE page of a website and say what that page is for.",
  "You are given the page's address, its title, its heading, its section headings, how many words it holds, and its opening words when they were captured.",
  "Rules:",
  "1. Use ONLY the text you are given. Never name a subject, a place, a product or a reader the given text does not carry. If the text is thin, say the little it supports and no more.",
  "2. job: ONE plain sentence saying what this page is for, in the words a business owner would use. Never advice, never a change to make, never praise.",
  "3. pageType: pick the one shape that fits. guide (explains a subject), list (a roster of many items), product (sells one item), category (a rail of products or posts), city (one place), entity (one named person, place or thing that is not a city), translation (what words or phrases mean between two languages), hub (an index whose purpose is to send readers to other pages of this site), home (the front page), other.",
  "4. audience: who the page is written for, in plain words.",
  "5. topics: 3 to 8 lowercase subject words or short phrases the page is actually about. No filler, no slogans, no site name.",
  "6. commercial: true only when the page exists to sell something.",
  "Write plain English. Use no dashes. Use no number you were not given.",
].join("\n");

const trim = (s: string | null | undefined, max: number): string | null => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; }
};

/** The page as the model sees it. This text IS both the cache key input and the durable row's fingerprint, so a
 *  page whose capture changed asks a different question and a page whose capture did not is answered for free. */
function extractLines(extract: PageExtract): string[] {
  const headings = (extract.headings ?? [])
    .map((h) => trim(h, MAX_HEADING_CHARS))
    .filter((h): h is string => !!h)
    .slice(0, MAX_HEADINGS);
  return [
    `ADDRESS: ${pathOf(extract.url)}`,
    `TITLE: ${trim(extract.title, MAX_TITLE_CHARS) ?? "not captured"}`,
    `HEADING: ${trim(extract.h1, MAX_TITLE_CHARS) ?? "not captured"}`,
    `SECTION HEADINGS: ${headings.length > 0 ? headings.join(" | ") : "not captured"}`,
    `LENGTH: ${typeof extract.wordCount === "number" && extract.wordCount > 0 ? `${extract.wordCount} words` : "not captured"}`,
    `HOW IT OPENS: ${trim(extract.openingSample, MAX_OPENING_CHARS) ?? "not captured"}`,
  ];
}

/** THE FINGERPRINT of the exact capture a reading was taken from. Equal means the row still describes the page. */
const fingerprintOf = (lines: readonly string[]): string => createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);

/** A page with no words of its own captured cannot be read, and paying to be told so is waste. */
const readable = (extract: PageExtract): boolean =>
  !!trim(extract.title, MAX_TITLE_CHARS) || !!trim(extract.h1, MAX_TITLE_CHARS) || (extract.headings ?? []).some((h) => !!trim(h, MAX_HEADING_CHARS));

type PageJobOptions = {
  complete?: CompleteFn; cacheImpl?: CacheImpl; now?: Date; bypassCache?: boolean;
  /** The durable store seam. */
  store?: Store;
  /** False forbids a paid reading: the durable row answers or the reason says why nothing does. */
  buy?: boolean;
  /** A reading already on file for this page, when the caller batched the store read. */
  held?: PageUnderstanding | null;
};

/** One page's job AND why it is the answer. Never throws. */
export async function pageJobFor(tenantId: string, extract: PageExtract, opts: PageJobOptions = {}): Promise<{ job: OwnedPageJob | null; reason: JobReason }> {
  const read = await readPageJob(tenantId, extract, opts);
  return { job: read.job, reason: read.reason };
}

/** The same read, with whether it CONSUMED an allowance unit, which is what the per-pass cap counts. */
async function readPageJob(
  tenantId: string, extract: PageExtract, opts: PageJobOptions,
): Promise<{ job: OwnedPageJob | null; reason: JobReason; paid: boolean }> {
  if (!tenantId?.trim() || !extract?.url || !readable(extract)) return { job: null, reason: "unreadable", paid: false };
  const store = opts.store ?? pageStore;
  const lines = extractLines(extract);
  const fingerprint = fingerprintOf(lines);
  // THE DURABLE ROW FIRST, always free. Its fingerprint decides whether it still describes this page.
  const held = opts.held !== undefined ? opts.held : (await store.read(tenantId, [extract.url]).catch(() => null))?.get(canonicalUrlKey(extract.url)) ?? null;
  const asJob = (r: NonNullable<typeof held>): OwnedPageJob => ({ job: r.job, pageType: r.pageType, audience: r.audience, topics: r.topics, commercial: r.commercial, url: extract.url });
  if (held && held.contentFingerprint === fingerprint) return { job: asJob(held), reason: "read", paid: false };
  const stale = (): { job: OwnedPageJob | null; reason: JobReason; paid: boolean } =>
    held ? { job: asJob(held), reason: "stale", paid: false } : { job: null, reason: "unaffordable", paid: false };
  if (opts.buy === false) return stale();
  try {
    const call = await callStructuredLLM({
      kind: "page_job", tenantId, system: SYSTEM,
      user: [...lines, "Say what this page is for."].join("\n"),
      grounded: lines.join(" "),
      projectedCostUsd: PAGE_JOB_COST_USD, maxTokens: PAGE_JOB_MAX_TOKENS,
      complete: opts.complete, cacheImpl: opts.cacheImpl, now: opts.now, bypassCache: opts.bypassCache,
    });
    if (call.status !== "drafted") {
      log.info("[page-job] no job read for this page", { tenantId, path: pathOf(extract.url), status: call.status });
      // AN ATTEMPT IS AN ATTEMPT. A call that reached the provider and came back unusable spends the pass's
      // allowance exactly as a good one does, or a site with an exhausted balance would try every page it has,
      // every pass. Only "off" and a refused budget never reached anybody and cost nothing.
      const attempted = call.status === "validation_failed";
      if (held) return { job: asJob(held), reason: "stale", paid: attempted };
      // "off" is nobody asked (no transport at all). MONEY AND WEATHER ARE NOT A REFUSAL: an empty balance, a
      // spend cap or a provider having a bad minute say nothing about the page, and holding every card on one of
      // them would empty the queue over a billing problem. Only an answer that came back and could not be used is
      // a refusal, because that IS about this page. The live run found this: an exhausted balance read as a
      // refusal and would have held every section card on the site.
      const soft = call.status === "validation_failed"
        && ["credit_exhausted", "budget", "transient", "client_timeout", "provider_refused", "incomplete"].includes(call.failure);
      const reason: JobReason = call.status === "off" ? "not_asked"
        : call.status === "blocked_budget" || soft ? "unaffordable" : "refused";
      return { job: null, reason, paid: attempted };
    }
    const value = call.value as PageJob;
    const job: OwnedPageJob = { ...value, topics: value.topics.map((t) => t.toLowerCase()), url: extract.url };
    await store.save(tenantId, {
      ...job, contentFingerprint: fingerprint,
      readAt: (opts.now ?? new Date()).toISOString(), sourceExtractAt: extract.fetchedAt ?? null,
    }).catch(() => false);
    return { job, reason: "read", paid: call.cached !== true };
  } catch (e) {
    log.warn("[page-job] page job read failed (the page keeps the behaviour it had without one)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return held ? { job: asJob(held), reason: "stale", paid: false } : { job: null, reason: "refused", paid: false };
  }
}

type LoadOptions = PageJobOptions & {
  maxNewReads?: number;
  /** How many leading extracts are PRIORITY: read first every pass and never rotated. Everything after them is
   *  the rotation, resumed from the persisted cursor so the whole site is reached over passes. */
  priority?: number;
  /** Every page looked at, with why it ended where it did. The caller's receipt of what this pass knows. */
  onRead?: (url: string, reason: JobReason) => void;
};

/** Start the rotation where the last pass stopped. A cursor naming a page that is gone starts at the beginning. */
function rotated<T>(items: readonly T[], keyOf: (t: T) => string, cursor: string | null): T[] {
  const at = cursor ? items.findIndex((i) => keyOf(i) === cursor) : -1;
  return at <= 0 ? [...items] : [...items.slice(at), ...items.slice(0, at)];
}

/**
 * The jobs on file for a set of owned pages, keyed by canonical address. One batched store read makes every page
 * already understood free, then the pass BUYS readings in the order given until its allowance is gone, and where it
 * stopped in the rotation is persisted so the next pass carries on from there. A page missing from the returned map
 * has no job yet, and `onRead` says why for every page looked at. Never throws.
 */
export async function loadPageJobs(
  tenantId: string,
  extracts: readonly PageExtract[],
  opts: LoadOptions = {},
): Promise<Map<string, OwnedPageJob>> {
  const out = new Map<string, OwnedPageJob>();
  const items = (extracts ?? []).filter((e) => !!e?.url);
  if (!tenantId?.trim() || items.length === 0) return out;
  const store = opts.store ?? pageStore;
  const allowance = Math.max(0, opts.maxNewReads ?? MAX_NEW_READS_PER_PASS);
  const held = await store.read(tenantId, items.map((e) => e.url)).catch(() => new Map<string, PageUnderstanding>());
  const lead = Math.min(Math.max(0, opts.priority ?? items.length), items.length);
  const cursor = lead >= items.length ? null : await store.cursor(tenantId).catch(() => null);
  const ordered = [...items.slice(0, lead), ...rotated(items.slice(lead), (e) => canonicalUrlKey(e.url), cursor)];
  let at = 0, paid = 0, lastBought = -1;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ordered.length) }, async () => {
    for (;;) {
      const i = at++;
      if (i >= ordered.length) return;
      const extract = ordered[i]!;
      const key = canonicalUrlKey(extract.url);
      // THE ALLOWANCE IS RESERVED BEFORE THE READING, not counted after it. Four readings run at once, and
      // counting afterwards let all four pass a cap of one. A reading that turned out free hands its unit back.
      const buy = paid < allowance;
      if (buy) paid += 1;
      const read = await readPageJob(tenantId, extract, { ...opts, buy, held: held.get(key) ?? null });
      if (buy && !read.paid) paid -= 1;
      if (read.paid && i >= lead) lastBought = Math.max(lastBought, i);
      opts.onRead?.(extract.url, read.reason);
      if (read.job && key) out.set(key, read.job);
    }
  }));
  // WHERE THE NEXT PASS RESUMES: the page after the last one this pass paid to read, wrapping to the start of the
  // rotation when it reached the end. A pass that bought nothing moves nothing.
  if (lastBought >= 0 && ordered.length > lead) {
    const next = ordered[lastBought + 1] ?? ordered[lead]!;
    await store.cursor(tenantId, next.url).catch(() => null);
  }
  if (paid > 0) log.info("[page-job] jobs read for this pass", { tenantId, pages: items.length, known: out.size, bought: paid });
  return out;
}

// ── the fit checks the producers read ───────────────────────────────────────── A verdict of "unknown" is returned
// whenever a job is missing; what that licenses is the CALLER's decision, made on the typed reason, not this file's.

type FitVerdict = "fits" | "wrong_type" | "off_topic" | "unknown";
type Jobs = ReadonlyMap<string, OwnedPageJob>;

/** THE PAGES AN ADDED ESSAY NEVER GOES ON. A storefront answers with products and a front page answers with
 *  directions, so "add a section answering this question" there is work nobody would publish. */
const ESSAY_NEVER: ReadonlySet<PageJob["pageType"]> = new Set(["product", "category", "home"]);

/** ONE SHARED WORD IS NOT A FIT. Two distinct words of the search have to be words this page is FOR, which is what
 *  a page about painters was never asked for when a search about musicians shared the word "Persian" with it. A
 *  search whose whole subject is one word still has to have that word covered, so a link to the Persepolis page
 *  anchored "Persepolis" is unharmed. */
const MIN_JOB_MATCHES = 2;
/** How many readings an account needs before one of its own words can be called ubiquitous. */
const MIN_JOB_CORPUS = 6;
/** A word carried by this share of an account's readings describes the site, not any page of it. */
const COMMON_SHARE = 0.4;

/** Every word one reading puts on its page: its subjects, the sentence saying what it is for, and who reads it. */
const vocabularyOf = (job: OwnedPageJob): Set<string> =>
  new Set(topicTokens([job.topics.join(" "), job.job, job.audience].join(" ")));
/** WHAT THE PAGE IS ACTUALLY FOR, and only that: the named subjects the reading settled on. Admission used to be
 *  decided on the whole vocabulary above, which is a sentence of prose and a sentence about readers, so a
 *  timeline of Iranian history matched a question about famous Iranian PEOPLE on the incidental words around its
 *  subjects. A page answers for its subjects; the prose describing it is not a claim of coverage. */
const subjectsOf = (job: OwnedPageJob): Set<string> => new Set(topicTokens(job.topics.join(" ")));

const commonCache = new WeakMap<object, ReadonlySet<string>>();
const EMPTY: ReadonlySet<string> = new Set<string>();

/** THE WORDS THIS SITE PUTS ON EVERYTHING. A site about Iran says "Iran" on every page it has, so sharing that
 *  word with a search proves nothing at all; only the words that tell its pages APART can decide where a search
 *  belongs. Derived from the account's own readings every pass, never a list anybody typed. */
function commonWords(jobs: Jobs | null | undefined): ReadonlySet<string> {
  if (!jobs || jobs.size < MIN_JOB_CORPUS) return EMPTY;
  const cached = commonCache.get(jobs);
  if (cached) return cached;
  const counts = new Map<string, number>();
  // COUNTED OVER THE WHOLE VOCABULARY on purpose, while admission below is decided on subjects alone: finding the
  // words a site says everywhere wants breadth, and deciding what a page covers wants precision.
  for (const j of jobs.values()) for (const t of vocabularyOf(j)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const floor = Math.max(3, Math.ceil(jobs.size * COMMON_SHARE));
  const out: ReadonlySet<string> = new Set([...counts.entries()].filter(([, n]) => n >= floor).map(([t]) => t));
  commonCache.set(jobs, out);
  return out;
}

/** Does what this page is for actually cover these words? The floor is two distinct matches, or every word when
 *  the search only has one word left worth telling pages apart by. */
function covers(job: OwnedPageJob, words: readonly string[], jobs: Jobs | null | undefined): boolean {
  const common = commonWords(jobs);
  const distinct = [...new Set(words)].filter((w) => !common.has(w));
  if (distinct.length === 0) return false;
  const has = subjectsOf(job);
  return distinct.filter((w) => has.has(w)).length >= Math.min(MIN_JOB_MATCHES, distinct.length);
}

/** THE PAGE SHAPES THAT SPEAK FOR ONE NAMED THING and never for the whole it belongs to. */
const SCOPED: ReadonlySet<PageJob["pageType"]> = new Set(["city", "entity", "product", "translation"]);
/**
 * A PAGE ABOUT ONE THING IS NOT THE ANSWER ABOUT EVERYTHING AROUND IT. A city page is not the national landmarks
 * answer, a product page is not the category answer, and a word's translation page is not the language answer.
 * Subject overlap can never see this, because the city page genuinely covers landmarks: what it does not cover is
 * the SCOPE that was asked about. So a page whose job speaks for one named thing may answer only a request that
 * names that thing, read off the page's own address and its most specific subject. Deterministic, no spend.
 */
function inScope(job: OwnedPageJob, request: string): boolean {
  if (!SCOPED.has(job.pageType)) return true;
  // ITS OWN NAME, read off its address and nothing else. Its topics are what it COVERS, and matching on those is
  // the very mistake this check exists to catch: a Tehran page covers landmarks, which is why it was handed a
  // question about the landmarks of a whole country. An address with no words in it settles nothing, so it passes.
  const own = topicTokens(job.url.replace(/^https?:\/\/[^/]+/, "").replace(/[-/]/g, " "));
  if (own.length === 0) return true;
  const asked = new Set(topicTokens(request));
  return own.some((w) => asked.has(w));
}

/** WHAT THE REQUEST ASKS SOMEONE TO ACCOMPLISH, read off its own words. Deterministic, no spend. A page
 *  can cover the right subjects and still be the wrong KIND of page: a festival article covers culture and
 *  traditions and is still not an answer to "reliable sources for learning about Iranian culture", because
 *  that request wants a directory of sources, not one more source. */
type RequestShape = "source_discovery" | "roster" | "shopping" | "topical";
const SOURCE_DISCOVERY = /\b(sources?|resources?|references?|where (can|do|to) (i |you |one )?(learn|find|read|start)|learn(ing)? about)\b/i;
/** A ROSTER ASK NAMES THE THING IT WANTS ALL OF. Bare "all" and "every" fired on "all I want to know" and
 *  "how often should I water every day", which sent ordinary questions to the hub-and-list gate and refused
 *  them everywhere else. The word now has to lead a noun phrase: something plural, or something counted off
 *  inside a set ("every city in Iran"). The spelled-out list phrases still stand on their own. */
const ROSTER = /\b(?:full list|list of|top \d+|best \d+)\b|\b(?:all|every)\s+(?:the\s+)?(?:[a-z]+\s+){0,2}[a-z]{3,}(?:s\b|\s+(?:in|of|for)\b)/i;
const SHOPPING = /\b(buy|price|cost|shop|order|purchase)\b/i;
const requestShape = (text: string): RequestShape =>
  SOURCE_DISCOVERY.test(text) ? "source_discovery" : SHOPPING.test(text) ? "shopping" : ROSTER.test(text) ? "roster" : "topical";
/** The page shapes that can satisfy each request shape. A hub or list is built to survey or send onward,
 *  so it may answer a directory or an all-of-X question; a single guide, entity or city page may not,
 *  however well its subjects match. Topical requests stay with coverage alone, so broad hubs and ordinary
 *  questions both keep working exactly as before. */
const SATISFIES: Record<RequestShape, ReadonlySet<OwnedPageJob["pageType"]> | null> = {
  source_discovery: new Set(["hub", "list"]), roster: new Set(["hub", "list", "category"]),
  shopping: new Set(["product", "category"]), topical: null,
};

/** Does a section answering these subject words belong on this page? "unknown" whenever the page has no job.
 *  `jobs` is every reading this pass holds, which is how a word this whole site carries stops counting as a tie.
 *  `request` is the asking text itself: subject coverage says the page knows the topic, the request shape says
 *  this kind of page can actually satisfy what was asked, and admission needs both. */
export function sectionFit(job: OwnedPageJob | null | undefined, subjectWords: readonly string[], jobs?: Jobs, request?: string): FitVerdict {
  if (!job) return "unknown";
  // WHAT WAS ASKED DECIDES BEFORE THE DEFAULT DOES. ESSAY_NEVER ran first and rejected every product and
  // category page, which made the shopping row of the table below unreachable: a request to BUY something,
  // landing on the page that sells it, was refused as a rail an essay never goes on. When the words name a
  // shape, that shape's own row is the whole answer; ESSAY_NEVER is the rule for a request that names none.
  const need = request ? SATISFIES[requestShape(request)] : null;
  if (need ? !need.has(job.pageType) : ESSAY_NEVER.has(job.pageType)) return "wrong_type";
  // AND THE SCOPE HAS TO MATCH, not just the shape and the subjects: /tehran was handed "the most famous
  // landmarks in Iran" because it genuinely covers landmarks, on a question that never mentions Tehran.
  if (request && !inScope(job, request)) return "wrong_type";
  if (subjectWords.length === 0) return "unknown";
  return covers(job, subjectWords, jobs) ? "fits" : "off_topic";
}

/** Does a body link carrying these anchor words belong on the source page, pointing at the target? "unknown"
 *  whenever either page has no job. A translation page answers one word for a reader who asked for that word:
 *  sending somebody there from a page that shares none of its subjects helps nobody and reads as spam. */
export function linkFit(
  target: OwnedPageJob | null | undefined,
  source: OwnedPageJob | null | undefined,
  anchorWords: readonly string[],
  jobs?: Jobs,
): FitVerdict {
  if (!target || !source) return "unknown";
  if (anchorWords.length === 0) return "unknown";
  if (!covers(target, anchorWords, jobs)) return "off_topic";
  if (target.pageType === "translation" && !covers(target, [...vocabularyOf(source)], jobs)) return "wrong_type";
  return "fits";
}

// ── which pages one pass pays to understand ──────────────────────────────────

/** NEW READINGS ONE PASS BUYS. A page already on file is free and counts against nothing, so a site that has been
 *  read costs nothing at all. The reserve is what is left for the pages a card is actually about to land on, which
 *  is money better spent than on the next page down a ranking nobody will mint from. */
const MINT_TIME_RESERVE = 10;
/** Impressions that make a page one of the site's important ones for this purpose. */
const HIGH_DEMAND = 500;
/** Clicks a page must have been earning before losing them is worth reading the page over. */
const MATERIAL_CLICKS = 20;

const extractOf = (p: OwnedPageEvidence): PageExtract => ({
  url: p.url, title: p.content?.title, h1: p.content?.h1, headings: p.content?.outline ?? [],
  wordCount: p.content?.wordCount ?? null, fetchedAt: p.content?.fetchedAt ?? null,
});

/** What one pass knows about its own pages, and what it refused to guess. */
type PageUnderstandingPass = {
  corpus: ReadonlyMap<string, OwnedPageJob>;
  /** What this page is for: the durable row is free, and a page never read is bought while the reserve lasts. */
  of: (page: OwnedPageEvidence) => Promise<{ job: OwnedPageJob | null; reason: JobReason }>;
  hold: (pageUrl: string, reason: string) => void;
  held: { pageUrl: string; reason: string }[];
};

/**
 * WHAT EACH PAGE IS FOR, and in which order the pass pays to find out.
 *
 * The old order was the sixty busiest pages, every pass, forever: the same sixty were re-read and the rest of the
 * site was never read at all, which is how a card landed on a page whose job nobody had ever asked about. The
 * order now is what matters: pages this account already has work queued on, pages losing traffic they used to
 * earn, pages with real demand, pages AI answers already cite, pages whose copy changed since they were last
 * read, and then a rotation through everything else that RESUMES where the last pass stopped, so the whole site
 * is understood over passes instead of one slice of it being understood forever. The caller decides which pages
 * are eligible at all, because what an essay may never land on is the caller's rule, not this file's.
 */
export async function pageUnderstanding(
  tenantId: string, eligible: readonly OwnedPageEvidence[], opts: { openPaths: ReadonlySet<string>; now: Date; store?: Store },
): Promise<PageUnderstandingPass> {
  const { now, openPaths } = opts;
  const store = opts.store ?? pageStore;
  const decay = await import("@/domains/evidence/readers/gsc-page-signals")
    .then((m) => m.loadGscDecaySignalsForTenant(tenantId, now)).catch(() => null);
  const onFile = await store.read(tenantId, eligible.map((p) => p.url)).catch(() => new Map<string, PageUnderstanding>());
  const losing = (p: OwnedPageEvidence): boolean => {
    const d = decay?.get(p.url) ?? decay?.get(pathOf(p.url));
    return !!d && d.clicksPrior >= MATERIAL_CLICKS && d.clicksNow < d.clicksPrior;
  };
  // A READING TAKEN BEFORE THE PAGE CHANGED describes a page that no longer exists in that form.
  const outdated = (p: OwnedPageEvidence): boolean => {
    const r = onFile.get(canonicalUrlKey(p.url));
    return !!r?.sourceExtractAt && !!p.content?.fetchedAt && r.sourceExtractAt < p.content.fetchedAt;
  };
  const tierOf = (p: OwnedPageEvidence): number =>
    openPaths.has(pathOf(p.url).toLowerCase()) ? 0 : losing(p) ? 1
      : (p.search?.impressions90d ?? 0) >= HIGH_DEMAND ? 2
        : (p.aiCitations?.distinctPrompts ?? 0) > 0 ? 3 : outdated(p) ? 4 : 5;
  const tiered = eligible.map((p) => ({ p, tier: tierOf(p) }));
  const first = tiered.filter((t) => t.tier < 5)
    .sort((a, b) => a.tier - b.tier || (b.p.search?.impressions90d ?? 0) - (a.p.search?.impressions90d ?? 0));
  // The rotation is walked in a stable address order, so the cursor means the same place on every pass.
  const rest = tiered.filter((t) => t.tier === 5).sort((a, b) => a.p.url.localeCompare(b.p.url));
  const reasons = new Map<string, JobReason>();
  const corpus = await loadPageJobs(tenantId, [...first, ...rest].map((t) => extractOf(t.p)), {
    priority: first.length, maxNewReads: MAX_NEW_READS_PER_PASS - MINT_TIME_RESERVE, now, store,
    onRead: (url, reason) => reasons.set(canonicalUrlKey(url), reason),
  }).catch(() => new Map<string, OwnedPageJob>());
  const minted = new Map<string, Promise<{ job: OwnedPageJob | null; reason: JobReason }>>();
  const held: { pageUrl: string; reason: string }[] = [];
  let reserve = MINT_TIME_RESERVE;
  return {
    corpus, held,
    hold: (pageUrl, reason) => {
      if (held.some((h) => h.pageUrl === pageUrl && h.reason === reason)) return;
      held.push({ pageUrl, reason });
      log.info("[page-job] card held: this page has no reading to place it on", { tenantId, page: pathOf(pageUrl), reason });
    },
    of: (page) => {
      const key = canonicalUrlKey(page.url);
      const known = corpus.get(key);
      if (known) return Promise.resolve({ job: known, reason: reasons.get(key) ?? "read" });
      const already = minted.get(key);
      if (already) return already;
      // THE READING IS BOUGHT WHERE A CARD WOULD LAND, which is money better spent than the next page down a
      // ranking nobody mints from. Out of reserve is the fail-open case, never a hold.
      const buy = reserve > 0;
      if (buy) reserve -= 1;
      const read = pageJobFor(tenantId, extractOf(page), { buy, now, store })
        .catch(() => ({ job: null as OwnedPageJob | null, reason: "refused" as JobReason }));
      minted.set(key, read);
      return read;
    },
  };
}
