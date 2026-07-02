/**
 * second-order-citations (2026-07-02, BEACON_500 item 72) - the "get cited BY
 * the cited" playbook. AI engines repeat their trusted sources over and over,
 * so a third-party domain that already gets cited a lot on this tenant's
 * topics is often a faster route to visibility than trying to outrank it -
 * get listed ON it (a directory row, a roundup mention, a press pickup)
 * instead of beating it in the results.
 *
 * PURE ranking + classification lives here (rankSecondOrderDomains,
 * classifyDomain, buildPlaybook) so it is trivially testable with no I/O. The
 * loader (loadSecondOrderCitationPlaybook) does the only two reads this needs:
 *   1. profound_citation_rows (Supabase, tenant-scoped, PAGE-read past the
 *      1000-row PostgREST cap) - the same table competitor-citations-loader.ts
 *      and mine-leads.ts already read, just aggregated the other direction
 *      (by THIRD-PARTY domain, not by competitor page).
 *   2. the dataforseo-llm-mentions 7-day cache, when present - gives a REAL
 *      tracked question ("examplePrompt") behind a domain's citations instead
 *      of only a URL-slug guess.
 *
 * Reuses domainOf/isNoiseDomain from evidence/relevance-gate.ts (the existing
 * noise-domain list) rather than duplicating a domain blocklist - this module
 * owns classification (listicle/directory/UGC/media/reference/other), not
 * noise exclusion.
 *
 * Tenant-generic: no tenant/vertical literals. Every string here is either a
 * structural pattern (URL path shape, host suffix) or built from the tenant's
 * own citation data at render time.
 */

import { domainOf, isNoiseDomain } from "@/domains/evidence/relevance-gate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecondOrderDomainClass =
  | "listicle"
  | "directory"
  | "ugc_community"
  | "media_press"
  | "reference"
  | "other";

/** One AI citation of a third-party domain, already scoped to this tenant's
 *  topics (the loader only ever passes in rows for the tenant's own category). */
export type SecondOrderCitationInput = {
  domain: string;
  url: string;
  /** Topic label for this citation (category label, or a derived slug label -
   *  never a raw UUID). */
  topic: string | null;
  /** How many times this exact (domain, url) was cited. */
  count: number;
};

/** A real tracked prompt/question this domain has been cited for (from the
 *  dataforseo-llm-mentions cache), when available. */
export type SecondOrderPromptHint = {
  domain: string;
  question: string;
};

export type OutreachLinkage = {
  /** True when this domain already has a row in the outreach pipeline. */
  inOutreachPipeline: boolean;
  /** The pipeline row's status, when linked. */
  status?: string;
};

export type SecondOrderDomainPlaybook = {
  domain: string;
  class: SecondOrderDomainClass;
  /** Realistic outreach targets (directory/listicle/media). Wikipedia/UGC use
   *  a different playbook entirely (edit/community-post, not a pitch email). */
  isOutreachTarget: boolean;
  citationCount: number;
  topTopics: string[];
  /** The exact page (on this third-party domain) that AI cited - shows the
   *  competitor being cited there, proof this domain is a real trust signal. */
  exampleCitedUrl: string;
  /** A real prompt this domain wins, when we have one on file; otherwise a
   *  plain phrase built from the cleaned topic label. Null when neither a
   *  real prompt nor a clean topic phrase is available (never renders a raw
   *  slug or a "question about" framing over noise). */
  examplePrompt: string | null;
  /** Plain-English pitch or listing step - operator reads this and decides;
   *  nothing here ever sends anything automatically. */
  suggestedAction: string;
  outreach: OutreachLinkage;
};

export type SecondOrderPlaybookResult = {
  domains: SecondOrderDomainPlaybook[];
  rowsScanned: number;
};

// ---------------------------------------------------------------------------
// Classification (deterministic, URL/host pattern based)
// ---------------------------------------------------------------------------

const UGC_COMMUNITY_HOSTS = [
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com",
  "forum.", "forums.", ".proboards.com", "discourse.", "community.",
  "answers.com",
];

const REFERENCE_HOSTS = [
  "wikipedia.org", "wikidata.org", "wiktionary.org", "britannica.com",
  "dictionary.com", "merriam-webster.com",
];

const MEDIA_PRESS_HOSTS = [
  "nytimes.com", "washingtonpost.com", "forbes.com", "bloomberg.com",
  "reuters.com", "apnews.com", "bbc.com", "cnn.com", "theguardian.com",
  "npr.org", "wsj.com", "usatoday.com", "businessinsider.com",
  "techcrunch.com", "wired.com", "huffpost.com", "vox.com", "axios.com",
  "news.", ".news",
];

const DIRECTORY_PATH_HINTS = [
  "/directory", "/directories", "/listing", "/listings", "/companies",
  "/profile", "/profiles", "/business/", "/vendors", "/providers",
];

const LISTICLE_TITLE_HINTS = [
  "best-", "top-", "-list", "top10", "top-10", "-vs-", "-comparison",
  "review", "roundup", "alternatives",
];

function hostMatchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.startsWith(".")) return host.endsWith(p) || host === p.slice(1);
    if (p.endsWith(".")) return host.includes(p);
    return host === p || host.endsWith(`.${p}`);
  });
}

function pathOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Classify a domain by host pattern + a representative cited URL's path
 * shape. Deterministic - no LLM, no network. Order matters: reference and
 * UGC checks run first because a domain that is both (e.g. a wiki with a
 * forum subpath) should read as the stronger, more identifiable class.
 */
export function classifyDomain(domain: string, sampleUrl: string): SecondOrderDomainClass {
  const host = domain.toLowerCase();
  if (hostMatchesAny(host, REFERENCE_HOSTS)) return "reference";
  if (hostMatchesAny(host, UGC_COMMUNITY_HOSTS)) return "ugc_community";
  if (hostMatchesAny(host, MEDIA_PRESS_HOSTS)) return "media_press";

  const path = pathOf(sampleUrl);
  if (DIRECTORY_PATH_HINTS.some((p) => path.includes(p))) return "directory";
  if (LISTICLE_TITLE_HINTS.some((p) => path.includes(p))) return "listicle";

  return "other";
}

/** Realistic outreach targets: directories/listicles/media are a normal pitch
 *  or listing step. Wikipedia/reference and UGC/community need a DIFFERENT
 *  playbook (an edit, a community post) - never a cold pitch email. */
export function isRealisticOutreachTarget(cls: SecondOrderDomainClass): boolean {
  return cls === "directory" || cls === "listicle" || cls === "media_press";
}

/** D5 (2026-07-02): the "other" class has no deterministic page-pitch rule
 *  (unlike directory/listicle/media, which map to a known outreach shape).
 *  Rather than repeat a flat non-answer for every "other" domain, name the
 *  real threshold: once a domain has been cited this many times on the
 *  tenant's own topics, there is enough repeat pattern to point at a
 *  specific page instead of just "worth a look." This is a documented
 *  floor, not derived from a model - the module has no other signal to
 *  set it from. */
export const OTHER_CLASS_CITATION_FLOOR = 10;

const CLASS_ACTION: Record<SecondOrderDomainClass, (domain: string, topic: string, citationCount: number) => string> = {
  directory: (domain, topic) =>
    `I'd add our listing to ${domain}. Directories like this get cited a lot when AI answers questions about ${topic}, and a listing is usually a short form, not a pitch.`,
  listicle: (domain, topic) =>
    `I'd pitch ${domain} to add us to their roundup on ${topic}. AI keeps citing this page, so one more mention there reaches every AI answer that already trusts it.`,
  media_press: (domain, topic) =>
    `I'd reach out to ${domain} with a short story angle on ${topic}. A single press mention here could get repeated across AI answers for a long time.`,
  ugc_community: (domain, topic) =>
    `${domain} is a community, not an outreach target. Different playbook: post something genuinely useful about ${topic} there yourself, rather than pitching an editor.`,
  reference: (domain, topic) =>
    `${domain} is a reference site with its own edit rules. Different playbook: check whether their page on ${topic} is missing us before trying anything else here.`,
  other: (domain, topic, citationCount) =>
    `${domain} on ${topic}: cited ${citationCount} time${citationCount === 1 ? "" : "s"} so far; after about ${OTHER_CLASS_CITATION_FLOOR} citations I can name the exact page to pitch.`,
};

export function suggestedActionFor(cls: SecondOrderDomainClass, domain: string, topic: string, citationCount = 0): string {
  const topicLabel = topic.trim() || "your topics";
  return CLASS_ACTION[cls](domain, topicLabel, citationCount);
}

// ---------------------------------------------------------------------------
// Topic phrase hygiene (D3, 2026-07-02) - a slug-derived topic label like
// "wiki chaharshanbe suri 2026" is not a question, and rendering it inside
// "A question about X" reads as broken copy. Strip junk tokens (site-section
// words, a leading/trailing product-category filler, bare numbers) so what's
// left is a plain phrase, or nothing at all if the whole label was junk.
// ---------------------------------------------------------------------------

/** Site-section / boilerplate words that show up in slugs but say nothing
 *  about the topic itself (wiki, mag/magazine, blog, category index pages). */
const JUNK_SLUG_TOKENS = new Set([
  "wiki", "wikipedia", "mag", "magazine", "blog", "blogs", "post", "posts",
  "article", "articles", "news", "category", "categories", "tag", "tags",
  "page", "pages", "index", "home", "archive", "archives", "topic", "topics",
  // product-category filler: URL paths like "/product-category/gifts/..."
  // slug into "product category gifts ..." - neither word says anything
  // about the actual topic once the real subject (the rest of the phrase)
  // is present.
  "product", "products",
]);

/** Strip junk tokens + bare numbers from a slug-derived topic label, leaving
 *  only the meaningful words. Returns null when nothing meaningful remains
 *  (e.g. the whole label was "wiki 2026"). PURE. */
export function cleanTopicPhrase(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const kept = trimmed
    .split(/\s+/)
    .filter((w) => {
      const lower = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!lower) return false;
      if (/^\d+$/.test(lower)) return false; // bare year/number, e.g. "2026"
      if (JUNK_SLUG_TOKENS.has(lower)) return false;
      return true;
    });
  if (kept.length === 0) return null;
  return kept.join(" ");
}

// ---------------------------------------------------------------------------
// Pure ranking
// ---------------------------------------------------------------------------

const MAX_TOP_TOPICS = 3;

type DomainAgg = {
  domain: string;
  citationCount: number;
  topicCounts: Map<string, number>;
  urlCounts: Map<string, number>;
};

/**
 * Rank + classify third-party domains by citation frequency across the
 * tenant's own topics. Excludes the tenant's own domain and noise domains
 * (the existing evidence-relevance list) up front. PURE - the caller passes
 * in already-tenant-scoped rows; no I/O happens here.
 */
export function rankSecondOrderDomains(
  citations: SecondOrderCitationInput[],
  opts: { ownDomain?: string; promptHints?: SecondOrderPromptHint[]; outreachDomains?: Map<string, OutreachLinkage> } = {},
): SecondOrderDomainPlaybook[] {
  const ownNorm = (opts.ownDomain ?? "").trim().toLowerCase().replace(/^www\./, "");
  const promptByDomain = new Map<string, string>();
  for (const hint of opts.promptHints ?? []) {
    const d = hint.domain.trim().toLowerCase();
    if (d && hint.question && !promptByDomain.has(d)) promptByDomain.set(d, hint.question);
  }

  const byDomain = new Map<string, DomainAgg>();
  for (const c of citations) {
    const domain = domainOf(c.domain) || c.domain.trim().toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    if (ownNorm && (domain === ownNorm || domain.endsWith(`.${ownNorm}`))) continue;
    if (isNoiseDomain(domain)) continue;

    let agg = byDomain.get(domain);
    if (!agg) {
      agg = { domain, citationCount: 0, topicCounts: new Map(), urlCounts: new Map() };
      byDomain.set(domain, agg);
    }
    const count = Number.isFinite(c.count) && c.count > 0 ? c.count : 1;
    agg.citationCount += count;
    if (c.topic && c.topic.trim()) {
      const t = c.topic.trim();
      agg.topicCounts.set(t, (agg.topicCounts.get(t) ?? 0) + count);
    }
    if (c.url) agg.urlCounts.set(c.url, (agg.urlCounts.get(c.url) ?? 0) + count);
  }

  const results: SecondOrderDomainPlaybook[] = [];
  for (const agg of byDomain.values()) {
    const topTopics = [...agg.topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOP_TOPICS)
      .map(([t]) => t);
    const exampleCitedUrl = [...agg.urlCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const cls = classifyDomain(agg.domain, exampleCitedUrl);
    const primaryTopic = topTopics[0] ?? "";
    const realPrompt = promptByDomain.get(agg.domain);
    // D3 (2026-07-02): only ever render a REAL tracked prompt or a cleaned
    // plain phrase - never a raw slug and never "A question about <slug>"
    // framing, which read as broken copy over topic labels derived from
    // URL paths (e.g. "wiki chaharshanbe suri").
    const cleanedTopic = cleanTopicPhrase(primaryTopic);
    const examplePrompt = realPrompt
      ? realPrompt
      : cleanedTopic
        ? `It wins answers about ${cleanedTopic}.`
        : null;

    const outreach = opts.outreachDomains?.get(agg.domain) ?? { inOutreachPipeline: false };

    results.push({
      domain: agg.domain,
      class: cls,
      isOutreachTarget: isRealisticOutreachTarget(cls),
      citationCount: agg.citationCount,
      topTopics,
      exampleCitedUrl,
      examplePrompt,
      suggestedAction: suggestedActionFor(cls, agg.domain, primaryTopic, agg.citationCount),
      outreach,
    });
  }

  return results.sort((a, b) => b.citationCount - a.citationCount || a.domain.localeCompare(b.domain));
}

// ---------------------------------------------------------------------------
// Loader (I/O) - Supabase profound_citation_rows + optional dataforseo cache.
// ---------------------------------------------------------------------------

import "server-only";
import { cache } from "react";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getBusinessConfig } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";
import { log } from "@/lib/logger";

const ROW_PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugTopicLabel(url: string): string | null {
  try {
    const path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
    const label = path
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[/_-]+/g, " ")
      .trim()
      .toLowerCase();
    return label || null;
  } catch {
    return null;
  }
}

async function readCitationRows(
  tenantId: string,
): Promise<Array<{ root_domain: string; url: string; category_id: string | null }>> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const rows: Array<{ root_domain: string; url: string; category_id: string | null }> = [];
  for (let off = 0; off < MAX_ROWS; off += ROW_PAGE_SIZE) {
    const { data, error } = await sb
      .from("profound_citation_rows")
      .select("root_domain,url,category_id,citation_count")
      .eq("tenant_id", tenantId)
      .range(off, off + ROW_PAGE_SIZE - 1);
    if (error) {
      log.warn("[second-order-citations] read failed", { tenantId, error: error.message });
      break;
    }
    const batch = (data ?? []) as Array<{
      root_domain: string;
      url: string;
      category_id: string | null;
      citation_count: number | null;
    }>;
    for (const r of batch) {
      rows.push({ root_domain: r.root_domain, url: r.url, category_id: r.category_id });
    }
    if (batch.length < ROW_PAGE_SIZE) break;
  }
  return rows;
}

async function readPromptHints(tenantId: string): Promise<SecondOrderPromptHint[]> {
  try {
    const { readAllCachedLlmMentions } = await import("@/domains/serp/dataforseo-llm-mentions");
    const records = await readAllCachedLlmMentions();
    const hints: SecondOrderPromptHint[] = [];
    for (const rec of records) {
      for (const m of rec.mentions) {
        if (m.domain) hints.push({ domain: m.domain, question: rec.question });
      }
    }
    return hints;
  } catch (e) {
    log.warn("[second-order-citations] llm-mentions hint read failed", { tenantId, error: String(e) });
    return [];
  }
}

async function readOutreachLinkage(tenantId: string): Promise<Map<string, OutreachLinkage>> {
  const linkage = new Map<string, OutreachLinkage>();
  try {
    const { listOutreachRows } = await import("@/domains/outreach/outreach-store");
    const rows = await listOutreachRows(tenantId);
    for (const r of rows) {
      const domain = r.targetDomain.trim().toLowerCase().replace(/^www\./, "");
      if (domain && !linkage.has(domain)) linkage.set(domain, { inOutreachPipeline: true, status: r.status });
    }
  } catch (e) {
    log.warn("[second-order-citations] outreach linkage read failed", { tenantId, error: String(e) });
  }
  return linkage;
}

async function loadUncached(tenantId: string): Promise<SecondOrderPlaybookResult> {
  const config = getBusinessConfig(tenantId);
  const ownDomain = (config.domain || "").trim();

  const [rawRows, promptHints, outreachDomains] = await Promise.all([
    readCitationRows(tenantId).catch((e): Array<{ root_domain: string; url: string; category_id: string | null }> => {
      log.warn("[second-order-citations] citation row read threw", { tenantId, error: String(e) });
      return [];
    }),
    readPromptHints(tenantId),
    readOutreachLinkage(tenantId),
  ]);

  if (rawRows.length === 0) {
    return { domains: [], rowsScanned: 0 };
  }

  const citations: SecondOrderCitationInput[] = rawRows.map((r) => {
    const rawCategory = (r.category_id || "").trim();
    const topic = rawCategory && !UUID_RE.test(rawCategory) ? rawCategory : slugTopicLabel(r.url);
    return { domain: r.root_domain || "", url: r.url || "", topic, count: 1 };
  });

  const domains = rankSecondOrderDomains(citations, { ownDomain, promptHints, outreachDomains });

  return { domains, rowsScanned: rawRows.length };
}

/** Request-memoized: computes on render, no store, no migration. */
export const loadSecondOrderCitationPlaybook = cache(
  async (): Promise<SecondOrderPlaybookResult> => loadUncached(await currentTenantId()),
);
