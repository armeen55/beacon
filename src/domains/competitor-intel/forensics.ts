/**
 * 2026-06-09 — "Why them, not you" forensics (pure).
 *
 * For one tracked competitor: which prompts cite THEIR page, what words
 * AI uses about them vs about you (descriptor windows already extracted
 * per answer at poll time), your closest equivalent page, and the
 * structural gaps between the two — every gap a plain-English sentence.
 *
 * Deterministic v1 — no LLM. Gap dimensions are limited to what both
 * page shapes actually carry (FAQ, pricing language, section coverage,
 * meta description, page existence). Full answer text is NOT stored by
 * the pollers (only extracted features), so the prompt table speaks in
 * ranks + dates, never fabricated quotes.
 *
 * Honesty floors: a report needs ≥ MIN_THEIR_CITATIONS on their URL;
 * the equivalent-page match needs ≥ MIN_MATCH_TOKENS shared meaningful
 * tokens or we say "no close match" instead of guessing.
 */

import { normalizeHost } from "./citation-series";
import type {
  DescriptorContrast,
  StructureGap,
  WhyThemPromptRow,
  WhyThemReport,
} from "./types";

export const MIN_THEIR_CITATIONS = 2;
export const MIN_MATCH_TOKENS = 2;
const MAX_PROMPT_ROWS = 8;
const MAX_DESCRIPTORS = 6;
const MAX_SECTION_GAPS_NAMED = 3;

// ── Tokenizing ────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "our", "you", "are", "what",
  "how", "much", "does", "best", "near", "top", "page", "home", "html",
  "www", "com", "inc", "llc", "services", "service",
]);

export function tokenize(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (s == null) return out;
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

// ── Equivalent-page matching ──────────────────────────────────────────

export type TheirPageInput = {
  url: string;
  title: string | null;
  h1: string | null;
  h2_list: ReadonlyArray<string>;
  faq_questions: ReadonlyArray<string>;
  meta_description: string | null;
};

export type OurPageInput = {
  url: string;
  title: string | null;
  h1: string | null;
  h2_list: ReadonlyArray<string>;
  /** Count of FAQ items on our page. */
  faq_count: number;
  meta_description: string | null;
  /** Extra topical tokens (e.g. PageSnapshot.service_terms). */
  extra_terms?: ReadonlyArray<string>;
};

function pathTokens(url: string): Set<string> {
  try {
    return tokenize(new URL(url).pathname.replace(/[-_/]+/g, " "));
  } catch {
    return tokenize(url);
  }
}

/**
 * Our page that most plausibly answers the same buyer question as
 * theirs. Score = shared meaningful tokens between (their path+title+h1)
 * and (our path+title+h1+extra_terms). Accepted at ≥ MIN_MATCH_TOKENS
 * shared tokens, OR a single shared token that appears in BOTH URL
 * paths (a path-to-path service term like "adu" is high-precision).
 * Below that → null ("no close match" is more honest than a bad one).
 */
export function matchEquivalentPage(
  theirs: Pick<TheirPageInput, "url" | "title" | "h1">,
  ourPages: ReadonlyArray<OurPageInput>,
): { url: string; score: number } | null {
  const theirPath = pathTokens(theirs.url);
  const theirTokens = new Set<string>([
    ...theirPath,
    ...tokenize(theirs.title),
    ...tokenize(theirs.h1),
  ]);
  if (theirTokens.size === 0) return null;

  let best: { url: string; score: number; pathHit: boolean } | null = null;
  for (const page of ourPages) {
    const ourPath = pathTokens(page.url);
    const ourTokens = new Set<string>([
      ...ourPath,
      ...tokenize(page.title),
      ...tokenize(page.h1),
    ]);
    for (const t of page.extra_terms ?? []) {
      for (const tok of tokenize(t)) ourTokens.add(tok);
    }
    let score = 0;
    for (const t of theirTokens) if (ourTokens.has(t)) score++;
    let pathHit = false;
    for (const t of theirPath) {
      if (ourPath.has(t)) {
        pathHit = true;
        break;
      }
    }
    const accepted = score >= MIN_MATCH_TOKENS || (score >= 1 && pathHit);
    if (!accepted) continue;
    if (
      best == null ||
      score > best.score ||
      (score === best.score && pathHit && !best.pathHit)
    ) {
      best = { url: page.url, score, pathHit };
    }
  }
  return best == null ? null : { url: best.url, score: best.score };
}

// ── Gap engine ────────────────────────────────────────────────────────

const PRICING_RE = /\b(cost|price|pricing|how much|budget|estimate|\$\s?\d)/i;

function hasPricingLanguage(args: {
  title: string | null;
  h2_list: ReadonlyArray<string>;
  faq: ReadonlyArray<string>;
}): boolean {
  if (args.title != null && PRICING_RE.test(args.title)) return true;
  if (args.h2_list.some((h) => PRICING_RE.test(h))) return true;
  return args.faq.some((q) => PRICING_RE.test(q));
}

function normalizeHeading(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Gaps where THEY have something OUR page lacks (the jealousy
 * direction — we never list what we have that they lack; that's not
 * what loses the prompt). `ours === null` → single no-equivalent gap.
 */
export function computeStructureGaps(
  theirs: TheirPageInput,
  ours: OurPageInput | null,
): StructureGap[] {
  if (ours == null) {
    return [
      {
        dimension: "no_equivalent_page",
        theirs: "a page for this question",
        ours: "no close match",
        sentence:
          "They have a page built for this question — you don't have a close match yet.",
      },
    ];
  }

  const gaps: StructureGap[] = [];

  const theirFaq = theirs.faq_questions.length;
  if (theirFaq > 0 && ours.faq_count === 0) {
    gaps.push({
      dimension: "faq",
      theirs: `${theirFaq} answered question${theirFaq === 1 ? "" : "s"}`,
      ours: "none",
      sentence: `Their page answers ${theirFaq} common question${theirFaq === 1 ? "" : "s"} right on the page; yours answers none.`,
    });
  }

  const theirPricing = hasPricingLanguage({
    title: theirs.title,
    h2_list: theirs.h2_list,
    faq: theirs.faq_questions,
  });
  const ourPricing = hasPricingLanguage({
    title: ours.title,
    h2_list: ours.h2_list,
    faq: [],
  });
  if (theirPricing && !ourPricing) {
    gaps.push({
      dimension: "pricing_language",
      theirs: "talks costs and prices",
      ours: "doesn't mention them",
      sentence: "Their page talks costs and prices; yours doesn't mention them.",
    });
  }

  const ourSections = new Set(ours.h2_list.map(normalizeHeading).filter(Boolean));
  const ourTokenPool = new Set<string>();
  for (const h of ours.h2_list) for (const t of tokenize(h)) ourTokenPool.add(t);
  const missing: string[] = [];
  for (const h of theirs.h2_list) {
    const norm = normalizeHeading(h);
    if (norm === "" || ourSections.has(norm)) continue;
    // Token-level mercy: if our page covers the same words in some
    // heading, don't call it a gap.
    const toks = [...tokenize(h)];
    const covered = toks.length > 0 && toks.every((t) => ourTokenPool.has(t));
    if (!covered) missing.push(h.trim());
  }
  if (missing.length > 0) {
    const named = missing.slice(0, MAX_SECTION_GAPS_NAMED).map((h) => `“${h}”`).join(", ");
    const more = missing.length > MAX_SECTION_GAPS_NAMED
      ? ` and ${missing.length - MAX_SECTION_GAPS_NAMED} more`
      : "";
    gaps.push({
      dimension: "section_coverage",
      theirs: `${missing.length} section${missing.length === 1 ? "" : "s"} you don't have`,
      ours: "not covered",
      sentence: `They cover ${named}${more} — your page doesn't.`,
    });
  }

  const theirMeta = theirs.meta_description?.trim() ?? "";
  const ourMeta = ours.meta_description?.trim() ?? "";
  if (theirMeta !== "" && ourMeta === "") {
    gaps.push({
      dimension: "meta_description",
      theirs: "has a search description",
      ours: "missing",
      sentence: "Their page has a search description; yours is missing one.",
    });
  }

  return gaps;
}

// ── Descriptor contrast + prompt rows ─────────────────────────────────

/** Minimal observation shape for forensics (subset of
 *  PromptAnswerObservation). */
export type ForensicsObservationInput = {
  prompt_id: string;
  platform: string;
  observed_at: string;
  citation_domains?: string[] | null;
  citation_rank?: number | null;
  descriptor_window?: string[] | null;
  competitor_descriptor_windows?: Record<string, string[]> | null;
};

function topWords(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  cap: number,
): string[] {
  const freq = new Map<string, number>();
  for (const list of lists) {
    for (const raw of list) {
      const w = raw.toLowerCase().trim();
      if (w.length < 3 || STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, z) => z[1] - a[1] || (a[0] < z[0] ? -1 : 1))
    .slice(0, cap)
    .map(([w]) => w);
}

/** Words AI uses near THEIR mentions vs near OURS. */
export function buildDescriptorContrast(
  observations: ReadonlyArray<ForensicsObservationInput>,
  competitorDisplayName: string,
): DescriptorContrast {
  const wanted = competitorDisplayName.toLowerCase();
  const theirs: string[][] = [];
  const ours: string[][] = [];
  for (const obs of observations) {
    const windows = obs.competitor_descriptor_windows;
    if (windows != null) {
      for (const [name, words] of Object.entries(windows)) {
        if (name.toLowerCase() === wanted && Array.isArray(words)) {
          theirs.push(words);
        }
      }
    }
    if (Array.isArray(obs.descriptor_window)) ours.push(obs.descriptor_window);
  }
  return {
    theirs: topWords(theirs, MAX_DESCRIPTORS),
    ours: topWords(ours, MAX_DESCRIPTORS),
  };
}

/**
 * Prompts whose answers cited the competitor's domain. Losses (we
 * weren't cited at all) sort first, then most recent. One row per
 * prompt (latest observation wins).
 */
export function buildPromptRows(
  observations: ReadonlyArray<ForensicsObservationInput>,
  promptTextById: ReadonlyMap<string, string>,
  competitorDomain: string,
): WhyThemPromptRow[] {
  const domain = normalizeHost(competitorDomain);
  const latestByPrompt = new Map<string, WhyThemPromptRow>();

  for (const obs of observations) {
    const domains = obs.citation_domains;
    if (domains == null || domains.length === 0) continue;
    let theirRank: number | null = null;
    for (let i = 0; i < domains.length; i++) {
      const host = normalizeHost(domains[i] ?? "");
      if (host === domain || host.endsWith(`.${domain}`)) {
        theirRank = i + 1;
        break;
      }
    }
    if (theirRank == null) continue;

    const promptText = promptTextById.get(obs.prompt_id);
    if (promptText == null || promptText === "") continue;

    const row: WhyThemPromptRow = {
      promptText,
      platform: obs.platform,
      lastSeen: obs.observed_at,
      theirRank,
      ourRank: typeof obs.citation_rank === "number" ? obs.citation_rank : null,
      theyWereFirst: theirRank === 1,
    };
    const existing = latestByPrompt.get(obs.prompt_id);
    if (existing == null || existing.lastSeen < row.lastSeen) {
      latestByPrompt.set(obs.prompt_id, row);
    }
  }

  return [...latestByPrompt.values()]
    .sort((a, z) => {
      const aLoss = a.ourRank == null ? 0 : 1;
      const zLoss = z.ourRank == null ? 0 : 1;
      return (
        aLoss - zLoss ||
        (a.lastSeen < z.lastSeen ? 1 : a.lastSeen > z.lastSeen ? -1 : 0) ||
        (a.promptText < z.promptText ? -1 : 1)
      );
    })
    .slice(0, MAX_PROMPT_ROWS);
}

// ── Report assembly ───────────────────────────────────────────────────

export type BuildWhyThemReportArgs = {
  domain: string;
  displayName: string;
  theirUrl: string;
  theirCitationTotal: number;
  /** Their page structure; null when never fetched (gaps limited). */
  theirSnapshot: TheirPageInput | null;
  ourPages: ReadonlyArray<OurPageInput>;
  observations: ReadonlyArray<ForensicsObservationInput>;
  promptTextById: ReadonlyMap<string, string>;
};

export function buildWhyThemReport(
  args: BuildWhyThemReportArgs,
): WhyThemReport | null {
  if (args.theirCitationTotal < MIN_THEIR_CITATIONS) return null;

  const prompts = buildPromptRows(
    args.observations,
    args.promptTextById,
    args.domain,
  );
  if (prompts.length === 0) return null; // nothing concrete to show

  let equivalentPageUrl: string | null = null;
  let gaps: StructureGap[] = [];
  if (args.theirSnapshot != null) {
    const match = matchEquivalentPage(args.theirSnapshot, args.ourPages);
    equivalentPageUrl = match?.url ?? null;
    const ourPage =
      match == null
        ? null
        : (args.ourPages.find((p) => p.url === match.url) ?? null);
    gaps = computeStructureGaps(args.theirSnapshot, ourPage);
  }

  return {
    domain: normalizeHost(args.domain),
    displayName: args.displayName,
    theirUrl: args.theirUrl,
    theirTitle: args.theirSnapshot?.title ?? null,
    theirCitationTotal: args.theirCitationTotal,
    equivalentPageUrl,
    gaps,
    prompts,
    descriptors: buildDescriptorContrast(args.observations, args.displayName),
  };
}
