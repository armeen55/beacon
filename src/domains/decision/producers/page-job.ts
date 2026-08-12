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
 * THREE RULES HOLD THIS FILE.
 *   1. FAIL OPEN, ALWAYS. A page with no job on file suppresses nothing: the producer's existing word overlap runs
 *      unchanged. A job SHARPENS a decision where it exists and is never a precondition for one. Nothing here throws.
 *   2. NO NEW STORE. The job is keyed by the extract text itself through the existing content-hash call cache, so a
 *      re-crawled page pays for a fresh reading on its own and an unchanged page never pays twice. A stale job is
 *      structurally impossible: change the page and the key changes with it.
 *   3. BOUNDED SPEND. Every read goes through the drafter's own checkBudget/recordSpend gateway, and one pass buys at
 *      most MAX_NEW_READS_PER_PASS new readings, so a cold start on a large site spreads over passes instead of
 *      spending a site's whole month in one.
 *
 * The reading NAMES the page. It never writes copy, never proposes a change, and never decides that a page should
 * exist: that verdict belongs to the coverage path, which owns new-page identity.
 */

import { log } from "@/lib/logger";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl } from "@/domains/decision/llm/call-cache";
import type { PageJob } from "@/domains/decision/llm/schemas";

/** What one page's stored capture holds, as much of it as the caller actually has. Every field is optional on
 *  purpose: the lean page projection carries a title, a heading, an outline and a word count for every owned page,
 *  and the opening words are held only where the caller already paid to read the body. */
export type PageExtract = {
  url: string;
  title?: string | null;
  h1?: string | null;
  headings?: readonly string[];
  openingSample?: string | null;
  wordCount?: number | null;
};

/** One page's job, carrying the address it was read for. */
export type OwnedPageJob = PageJob & { url: string };

/** What one reading is expected to cost, for the budget reservation. */
const PAGE_JOB_COST_USD = 0.002;
/** Reasoning tokens are spent before the answer, so the ceiling covers both; the answer itself is a few lines. */
const PAGE_JOB_MAX_TOKENS = 1200;
/** How many readings run at once. Four keeps the provider inside its concurrency and one pass inside its time. */
const CONCURRENCY = 4;
/** New readings one pass may BUY. A cache hit costs nothing and never counts, so a warm site reads its whole
 *  inventory for free and a cold one spreads over passes rather than spending its month in a single sweep. */
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

/** The page as the model sees it. This text IS the cache key input, so a page whose capture changed asks a
 *  different question and a page whose capture did not is answered for free. */
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

/** A page with no words of its own captured cannot be read, and paying to be told so is waste. */
const readable = (extract: PageExtract): boolean =>
  !!trim(extract.title, MAX_TITLE_CHARS) || !!trim(extract.h1, MAX_TITLE_CHARS) || (extract.headings ?? []).some((h) => !!trim(h, MAX_HEADING_CHARS));

export type PageJobOptions = { complete?: CompleteFn; cacheImpl?: CacheImpl; now?: Date; bypassCache?: boolean };

/** One page's job, or null. NULL IS A COMPLETE ANSWER and it always means the same thing: the job is not known
 *  yet. Over budget, no extract, a refused call, a shape that did not validate, all land here, and every consumer
 *  treats them alike by falling back to the behaviour it had before this file existed. Never throws. */
export async function pageJobFor(tenantId: string, extract: PageExtract, opts: PageJobOptions = {}): Promise<OwnedPageJob | null> {
  return (await readPageJob(tenantId, extract, opts)).job;
}

/** The same read, with whether it was PAID, which is what the per-pass cap counts. */
async function readPageJob(tenantId: string, extract: PageExtract, opts: PageJobOptions): Promise<{ job: OwnedPageJob | null; paid: boolean }> {
  if (!tenantId?.trim() || !extract?.url || !readable(extract)) return { job: null, paid: false };
  try {
    const lines = extractLines(extract);
    const call = await callStructuredLLM({
      kind: "page_job", tenantId, system: SYSTEM,
      user: [...lines, "Say what this page is for."].join("\n"),
      grounded: lines.join(" "),
      projectedCostUsd: PAGE_JOB_COST_USD, maxTokens: PAGE_JOB_MAX_TOKENS,
      complete: opts.complete, cacheImpl: opts.cacheImpl, now: opts.now, bypassCache: opts.bypassCache,
    });
    if (call.status !== "drafted") {
      log.info("[page-job] no job read for this page", { tenantId, path: pathOf(extract.url), status: call.status });
      return { job: null, paid: false };
    }
    const value = call.value as PageJob;
    return { job: { ...value, topics: value.topics.map((t) => t.toLowerCase()), url: extract.url }, paid: call.cached !== true };
  } catch (e) {
    log.warn("[page-job] page job read failed (the page keeps the behaviour it had without one)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return { job: null, paid: false };
  }
}

/**
 * The jobs on file for a set of owned pages, keyed by canonical address. Reads in the order given, so the caller
 * decides which pages matter first, four at a time, and stops BUYING once this pass has bought its allowance. A page
 * missing from the returned map has no job yet, which changes nothing about how it is treated. Never throws.
 */
export async function loadPageJobs(
  tenantId: string,
  extracts: readonly PageExtract[],
  opts: PageJobOptions & { maxNewReads?: number } = {},
): Promise<Map<string, OwnedPageJob>> {
  const out = new Map<string, OwnedPageJob>();
  const items = (extracts ?? []).filter((e) => !!e?.url);
  if (!tenantId?.trim() || items.length === 0) return out;
  const allowance = Math.max(0, opts.maxNewReads ?? MAX_NEW_READS_PER_PASS);
  let at = 0, paid = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = at++;
      if (i >= items.length || paid >= allowance) return;
      const extract = items[i]!;
      const read = await readPageJob(tenantId, extract, opts);
      if (read.paid) paid += 1;
      const key = canonicalUrlKey(extract.url);
      if (read.job && key) out.set(key, read.job);
    }
  }));
  if (paid > 0) log.info("[page-job] jobs read for this pass", { tenantId, pages: items.length, known: out.size, bought: paid });
  return out;
}

// ── the fit checks the producers read ───────────────────────────────────────── A verdict of "unknown" is the fail
// open path and it is returned whenever a job is missing: the caller then runs exactly the logic it ran before.

export type FitVerdict = "fits" | "wrong_type" | "off_topic" | "unknown";

/** THE PAGES AN ADDED ESSAY NEVER GOES ON. A storefront answers with products and a front page answers with
 *  directions, so "add a section answering this question" there is work nobody would publish. */
const ESSAY_NEVER: ReadonlySet<PageJob["pageType"]> = new Set(["product", "category", "home"]);

const topicWords = (job: OwnedPageJob): Set<string> => new Set(topicTokens(job.topics.join(" ")));

const shares = (words: readonly string[], job: OwnedPageJob): boolean => {
  const has = topicWords(job);
  return words.some((w) => has.has(w));
};

/** Does a section answering these subject words belong on this page? "unknown" whenever the page has no job. */
export function sectionFit(job: OwnedPageJob | null | undefined, subjectWords: readonly string[]): FitVerdict {
  if (!job) return "unknown";
  if (ESSAY_NEVER.has(job.pageType)) return "wrong_type";
  if (subjectWords.length === 0) return "unknown";
  return shares(subjectWords, job) ? "fits" : "off_topic";
}

/** Does a body link carrying these anchor words belong on the source page, pointing at the target? "unknown"
 *  whenever either page has no job. A translation page answers one word for a reader who asked for that word:
 *  sending somebody there from a page that shares none of its subjects helps nobody and reads as spam. */
export function linkFit(
  target: OwnedPageJob | null | undefined,
  source: OwnedPageJob | null | undefined,
  anchorWords: readonly string[],
): FitVerdict {
  if (!target || !source) return "unknown";
  if (anchorWords.length === 0) return "unknown";
  if (!shares(anchorWords, target)) return "off_topic";
  if (target.pageType === "translation" && !shares([...topicWords(source)], target)) return "wrong_type";
  return "fits";
}
