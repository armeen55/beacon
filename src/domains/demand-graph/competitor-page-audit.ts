/**
 * competitor-page-audit (2026-06-24, Step 3) — DETERMINISTIC teardown of the
 * pages AI cites instead of the tenant. NO LLM, NO paid SERP. Fetch the top
 * AEO-cited competitor URLs (Step 2) with the existing polite fetcher, then
 * extract structural facts ("what wins") so Step 4 can compare them against the
 * tenant's own pages and draft the fix.
 *
 * Facts only — never strategy/prose (that's Step 4). Pure `extractCompetitorFacts`
 * (html → facts) is fully unit-testable; `auditCompetitorPage` adds fail-soft
 * fetch; results cache to the `competitor-page-audit` json-store keyed by URL +
 * content hash so a re-run skips unchanged pages. Tenant-scoped.
 */

import "server-only";
import { cache } from "react";

import { load as cheerioLoad } from "cheerio";
import { createHash } from "node:crypto";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { loadDemandGraphForTenant } from "./load-graph";

const STORE = "competitor-page-audit";
const DEFAULT_TOP_N = 20;
const MAX_OUTLINE = 12;
const MAX_FAQ = 8;
const MAX_TERMS = 10;

const STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are", "was",
  "with", "best", "top", "how", "what", "why", "list", "guide", "your", "you", "this",
  "that", "from", "by", "at", "as", "it", "be", "we", "our", "their", "they", "have",
  "has", "can", "will", "more", "all", "about", "into", "out", "up", "if", "but",
]);

export type CompetitorFetchStatus =
  | "ok"
  | "blocked_robots"
  | "http_error"
  | "fetch_failed"
  | "empty";

export type CompetitorPageFacts = {
  canonicalUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2Count: number;
  h3Count: number;
  outline: string[];
  schemaTypes: string[];
  hasFaq: boolean;
  faqQuestionCount: number;
  faqQuestions: string[];
  /** A short, direct answer paragraph near the top (AEO answer-block pattern). */
  hasAnswerBlock: boolean;
  wordCount: number;
  /** Approx content sections (H2 count, min 1 when there's body). */
  sectionCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  /** A form/calculator/quiz/converter interactive asset on the page. */
  hasToolOrCalculator: boolean;
  /** First credible publish/modified date signal, if any. */
  freshnessDate: string | null;
  ogTitle: string | null;
  ogType: string | null;
  /** Top content tokens — the topic/entity terms the page leans on. */
  topTerms: string[];
};

export type CompetitorPageAudit = {
  url: string;
  domain: string;
  fetchStatus: CompetitorFetchStatus;
  httpStatus: number | null;
  facts: CompetitorPageFacts | null;
  /** sha256(prefix) of the fetched HTML — cache-invalidation key. */
  contentHash: string | null;
  auditedAt: string;
  error: string | null;
};

export type CompetitorFetchResult =
  | { ok: true; html: string; status: number }
  | { ok: false; reason: "robots_blocked" | "fetch_failed"; status?: number };

export type CompetitorAuditDeps = {
  /** Test seam — inject the fetch result instead of a live polite fetch. */
  fetchHtml?: (url: string) => Promise<CompetitorFetchResult>;
  now?: () => string;
};

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function stripWww(h: string): string {
  return h.replace(/^www\./i, "").toLowerCase();
}

function hostOf(url: string): string {
  try {
    return stripWww(new URL(url.startsWith("http") ? url : `https://${url}`).hostname);
  } catch {
    return "";
  }
}

function toks(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

/** Recursively collect JSON-LD @type strings. */
function collectSchemaTypes(node: unknown, out: Set<string>): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const n of node) collectSchemaTypes(n, out);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);
    for (const k of Object.keys(obj)) {
      if (k === "@type") continue;
      collectSchemaTypes(obj[k], out);
    }
  }
}

function collectDates(node: unknown, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const n of node) collectDates(n, out);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const k of ["datePublished", "dateModified", "uploadDate"]) {
      const v = obj[k];
      if (typeof v === "string" && v.length >= 4) out.push(v);
    }
    for (const k of Object.keys(obj)) collectDates(obj[k], out);
  }
}

const TOOL_RE = /\b(calculator|converter|estimator|quiz|interactive|tool)\b/i;

/** PURE: HTML → structural facts. Deterministic, no I/O. */
export function extractCompetitorFacts(html: string, url: string): CompetitorPageFacts {
  const $ = cheerioLoad(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const h1 = $("h1").first().text().trim() || null;
  const h2Count = $("h2").length;
  const h3Count = $("h3").length;
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
  const ogType = $('meta[property="og:type"]').attr("content")?.trim() || null;

  const outline: string[] = [];
  $("h2, h3").each((_, el) => {
    if (outline.length >= MAX_OUTLINE) return;
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) outline.push(t.slice(0, 120));
  });

  // ── schema + dates ──
  const schemaSet = new Set<string>();
  const dates: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      collectSchemaTypes(data, schemaSet);
      collectDates(data, dates);
    } catch {
      /* malformed — ignore */
    }
  });
  const schemaTypes = [...schemaSet];

  // ── FAQ (questions only; schema OR DOM question headings) ──
  const faqQuestions: string[] = [];
  const pushQ = (q: string) => {
    const cleaned = q.replace(/\s+/g, " ").trim();
    if (cleaned && /\?$|^(how|what|why|when|where|who|which|can|does|is|are|do)\b/i.test(cleaned)) {
      if (!faqQuestions.includes(cleaned) && faqQuestions.length < MAX_FAQ) faqQuestions.push(cleaned.slice(0, 160));
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      const scan = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(scan);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          if (o["@type"] === "Question" && typeof o.name === "string") pushQ(o.name);
          for (const k of Object.keys(o)) scan(o[k]);
        }
      };
      scan(data);
    } catch {
      /* ignore */
    }
  });
  $("h2, h3, summary, dt").each((_, el) => {
    const t = $(el).text();
    if (/\?/.test(t)) pushQ(t);
  });
  const hasFaq = schemaTypes.includes("FAQPage") || faqQuestions.length > 0;

  // ── content body (strip boilerplate) for word count + answer block + terms ──
  const $clone = cheerioLoad($.html());
  $clone("nav, footer, header, aside, script, style, noscript, svg, iframe, form").remove();
  const mainEl = $clone("main").length ? $clone("main").first() : $clone("article").length ? $clone("article").first() : $clone("body");
  const bodyText = mainEl.text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  // answer-block heuristic: an early substantial paragraph (40–60-word AEO norm)
  let hasAnswerBlock = false;
  let pSeen = 0;
  mainEl.find("p").each((_, el) => {
    if (hasAnswerBlock || pSeen >= 3) return;
    const w = $clone(el).text().trim().split(/\s+/).filter(Boolean).length;
    pSeen += 1;
    if (w >= 20 && w <= 120) hasAnswerBlock = true;
  });

  const sectionCount = Math.max(h2Count, wordCount > 0 ? 1 : 0);

  // ── links + images ──
  const pageHost = hostOf(canonicalUrl || url);
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    let h = "";
    try {
      h = stripWww(new URL(href, `https://${pageHost || "x.com"}`).hostname);
    } catch {
      return;
    }
    if (h === pageHost) internalLinkCount += 1;
    else externalLinkCount += 1;
  });
  const imageCount = $("img").length;

  // ── tool / calculator ──
  const hasToolOrCalculator =
    $("form").length > 0 ||
    $("input, select, canvas").length > 0 ||
    TOOL_RE.test(`${title ?? ""} ${h1 ?? ""} ${$("body").attr("class") ?? ""} ${outline.join(" ")}`);

  // ── freshness ──
  const metaDate =
    $('meta[property="article:published_time"]').attr("content")?.trim() ||
    $('meta[property="article:modified_time"]').attr("content")?.trim() ||
    $("time[datetime]").first().attr("datetime")?.trim() ||
    null;
  const freshnessDate = dates[0] ?? metaDate ?? null;

  // ── top terms ──
  const termCounts = new Map<string, number>();
  for (const t of toks(`${title ?? ""} ${h1 ?? ""} ${outline.join(" ")} ${bodyText.slice(0, 4000)}`)) {
    termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
  }
  const topTerms = [...termCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS)
    .map(([t]) => t);

  return {
    canonicalUrl,
    title,
    metaDescription: metaDescription ? metaDescription.slice(0, 300) : null,
    h1,
    h2Count,
    h3Count,
    outline,
    schemaTypes,
    hasFaq,
    faqQuestionCount: faqQuestions.length,
    faqQuestions,
    hasAnswerBlock,
    wordCount,
    sectionCount,
    internalLinkCount,
    externalLinkCount,
    imageCount,
    hasToolOrCalculator,
    freshnessDate,
    ogTitle,
    ogType,
    topTerms,
  };
}

/** Deterministic "what wins" one-liner from the facts (NO LLM). */
export function whatWins(facts: CompetitorPageFacts | null): string {
  if (!facts) return "—";
  const parts: string[] = [];
  if (facts.hasFaq) parts.push(facts.schemaTypes.includes("FAQPage") ? "FAQ schema" : "FAQ");
  if (facts.hasAnswerBlock) parts.push("answer block");
  if (facts.schemaTypes.length > 0) parts.push(`${facts.schemaTypes.length} schema type(s)`);
  if (facts.wordCount >= 1500) parts.push(`${(facts.wordCount / 1000).toFixed(1)}k words`);
  else if (facts.wordCount >= 300) parts.push(`${facts.wordCount} words`);
  if (facts.h2Count >= 5) parts.push(`${facts.h2Count} sections`);
  if (facts.hasToolOrCalculator) parts.push("interactive tool");
  if (facts.imageCount >= 5) parts.push(`${facts.imageCount} images`);
  if (facts.internalLinkCount >= 10) parts.push("strong internal linking");
  if (facts.freshnessDate) parts.push("dated/fresh");
  return parts.length ? parts.join(" · ") : "thin page (low structure)";
}

async function defaultFetchHtml(url: string): Promise<CompetitorFetchResult> {
  // Profound stores scheme-less URLs (e.g. "theknot.com/x") — `new URL()` throws
  // on those, so make it absolute before the polite fetch / robots check.
  const abs = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  // fetchPageHtml does its own robots check + timeout; one cache per call is
  // fine for the ≤20 mostly-distinct-origin competitor URLs.
  const robotsCache = new Map<string, string[]>();
  const r = await fetchPageHtml(abs, robotsCache);
  if (r.ok) return { ok: true, html: r.html, status: r.status };
  const httpStatus =
    r.reason === "fetch_failed" && r.detail?.startsWith("http_")
      ? Number(r.detail.slice(5))
      : undefined;
  return { ok: false, reason: r.reason, status: httpStatus };
}

/** Fetch + extract ONE competitor page, fail-soft. */
export async function auditCompetitorPage(
  url: string,
  deps: CompetitorAuditDeps = {},
): Promise<CompetitorPageAudit> {
  const now = deps.now ?? (() => new Date().toISOString());
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
  const domain = hostOf(url);
  const base = { url, domain, auditedAt: now() };

  try {
    const r = await fetchHtml(url);
    if (!r.ok) {
      if (r.reason === "robots_blocked") {
        return { ...base, fetchStatus: "blocked_robots", facts: null, contentHash: null, httpStatus: null, error: null };
      }
      return {
        ...base,
        fetchStatus: typeof r.status === "number" && r.status >= 400 ? "http_error" : "fetch_failed",
        facts: null,
        contentHash: null,
        httpStatus: r.status ?? null,
        error: r.reason,
      };
    }
    if (!r.html || r.html.length < 200) {
      return { ...base, fetchStatus: "empty", facts: null, contentHash: r.html ? hash(r.html) : null, httpStatus: r.status, error: "empty/too-small" };
    }
    const facts = extractCompetitorFacts(r.html, url);
    return { ...base, fetchStatus: "ok", facts, contentHash: hash(r.html.slice(0, 20000)), httpStatus: r.status, error: null };
  } catch (e) {
    return { ...base, fetchStatus: "fetch_failed", facts: null, contentHash: null, httpStatus: null, error: String(e).slice(0, 160) };
  }
}

// ── cache (tenant-scoped json-store; Supabase migration written-not-applied) ──

// Request-cached: both cockpit sections (Today's Moves teardown + New Pages
// "what wins") read the audit store on one `/` render — share a single read.
export const getCompetitorAuditsForTenant = cache(
  async (): Promise<Map<string, CompetitorPageAudit>> => {
    const rows = await readStore<CompetitorPageAudit>(STORE, []).catch(() => []);
    const map = new Map<string, CompetitorPageAudit>();
    for (const r of rows) map.set(canonicalizeCitationUrl(r.url) || r.url, r);
    return map;
  },
);

async function saveAudits(audits: CompetitorPageAudit[]): Promise<void> {
  const existing = await readStore<CompetitorPageAudit>(STORE, []).catch(() => []);
  const byUrl = new Map<string, CompetitorPageAudit>();
  for (const r of existing) byUrl.set(canonicalizeCitationUrl(r.url) || r.url, r);
  for (const a of audits) byUrl.set(canonicalizeCitationUrl(a.url) || a.url, a);
  await writeStore(STORE, [...byUrl.values()]);
}

/**
 * Audit the competitor pages the Top-N MOVES actually reference (each move's
 * top cited competitor), so the teardown aligns 1:1 with the EvidencePackets.
 * Cache-aware (skips a URL already audited "ok" unless `force`). Fail-soft per URL.
 */
export async function auditTopCompetitorsForTenant(
  args: { tenantId: string; limit?: number; force?: boolean },
  deps: CompetitorAuditDeps = {},
): Promise<{ audited: CompetitorPageAudit[]; targets: number; cached: number }> {
  const limit = args.limit ?? DEFAULT_TOP_N;
  const { graph } = await loadDemandGraphForTenant(args.tenantId);
  const actionable = graph.moves.filter((m) => m.gap !== "low_demand" && m.gap !== "healthy");

  // The per-move top competitor URLs (what the packets reference), deduped.
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const m of actionable.slice(0, limit)) {
    const u = m.competitorUrls[0];
    if (!u) continue;
    const key = canonicalizeCitationUrl(u) || u;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(u);
  }

  const cache = await getCompetitorAuditsForTenant();
  const out: CompetitorPageAudit[] = [];
  let cached = 0;
  for (const url of urls) {
    const key = canonicalizeCitationUrl(url) || url;
    const prior = cache.get(key);
    if (!args.force && prior && prior.fetchStatus === "ok") {
      cached += 1;
      out.push(prior);
      continue;
    }
    out.push(await auditCompetitorPage(url, deps));
  }
  await saveAudits(out);
  return { audited: out, targets: urls.length, cached };
}
