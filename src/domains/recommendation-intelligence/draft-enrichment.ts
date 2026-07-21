/**
 * 2026-06-10 — deterministic draft enrichment (P0 wall 3: drafting
 * coverage beyond 3 action types).
 *
 * Trigger-promoted rows used to land with `proposed_text: null` — a
 * "go look at this page" card, not a move. This module fills
 * `display_label`, `current_text`, `proposed_text`, `expected_impact`
 * and `measurement_plan` for the trigger pairs where a CORRECT draft
 * is computable deterministically from the page snapshot:
 *
 *   edit_title   (missing_title / duplicate_title / title_h1_mismatch)
 *   edit_meta    (missing_meta / duplicate_meta)
 *   change_h1    (missing_h1 / weak_h1 / title_h1_mismatch)
 *   fix_canonical / fix_robots / fix_noindex / fix_status_code /
 *   fix_sitemap  (exact, paste-ready directives)
 *   add_internal_link (suggested source pages by title-word overlap)
 *   add_schema   (vertical-neutral JSON-LD skeleton)
 *
 * Hard rules:
 *   • PURE. No I/O, no LLM, no persistence imports, no tenant context.
 *   • `target_element_key` is NEVER changed (stays null): the row id +
 *     the Supabase unique tuple include it — changing it would fork
 *     previously-promoted rows into duplicates.
 *   • Never overwrites an existing `proposed_text`.
 *   • Returns the row UNCHANGED when the data is insufficient for a
 *     correct draft (no fake content, ever).
 *   • Brand suffix is INFERRED from the tenant's own titles (most
 *     common " | Tail" across snapshots) — zero hardcoding.
 */

import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { DeterministicPromotionEditRow } from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import { actionableSchemaWarnings } from "@/domains/recommendation-intelligence/triggers/invalid-schema";
import { detectBiographyPage } from "@/domains/pages/biography-detector";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";
// RANK-5 (2026-07-06) - pure LocalBusiness/Service JSON-LD composer. PURE (no
// I/O); draft-enrichment stays pure by importing only the pure composer.
import { composeLocalSchema } from "@/domains/local-seo/local-schema";

export type DraftEnrichmentContext = {
  /** Latest snapshot per canonical URL (caller dedupes by fetched_at). */
  snapshotByUrl: ReadonlyMap<string, PageSnapshot>;
  /**
   * UX_TEARDOWN #252 — the tenant's REAL configured business name
   * (`businessConfig.name`). When present, it is the Organization
   * (author/publisher + breadcrumb root) on schema drafts and the brand
   * suffix on title/h1 drafts — the honest, tenant-asserted identity.
   * `inferBrandSuffix` (a guess from page-title tails) is used ONLY as
   * the fallback when no real name is configured. Empty/missing →
   * undefined → falls back to inference (prior behavior preserved).
   */
  businessName?: string | null;
  /**
   * Item 73 (2026-07-02), Wikidata grounding. Pre-resolved entity match
   * per page URL, keyed by the SAME `target_url` a biography candidate
   * carries. This module stays PURE (no I/O, no fetch); the async
   * Wikidata lookup happens upstream (src/lib/connectors/wikidata/client.ts)
   * and the caller passes the resolved result in here, exactly like
   * `snapshotByUrl` is pre-populated. Only `confidence: "high"` matches
   * may contribute a `sameAs` link to the emitted Person schema; a
   * `needs-confirm` match is never auto-emitted (operator-confirmable
   * elsewhere), and this map may simply omit a URL when no lookup ran.
   */
  wikidataMatchByUrl?: ReadonlyMap<
    string,
    {
      confidence: "high" | "needs-confirm" | "none";
      wikidataUrl: string | null;
      wikipediaUrl: string | null;
    }
  >;
  /**
   * RANK-5 (2026-07-06) - LOCAL SEO. The tenant's configured local-business
   * facts (name / address / phone / domain / service-area cities). When present
   * AND the schema candidate's target page classifies as a city/service/homepage
   * page, composeSchema emits LocalBusiness (+ Service on service pages) JSON-LD
   * from these facts instead of the generic WebPage skeleton. Absent (a content
   * tenant with no local identity) -> composeSchema is byte-identical to before
   * RANK-5. Never invents an address, phone, or city; only the tenant's own
   * asserted facts are used.
   */
  localBusiness?: {
    name: string;
    address: string;
    phone: string;
    domain: string;
    areaServed: string[];
  } | null;
  /**
   * RANK-5 (2026-07-06). Page type per target URL (from classifyPageType), so
   * composeSchema knows whether an add_schema candidate lands on a city/service/
   * homepage page (LocalBusiness/Service applies) vs any other page (generic
   * WebPage). Absent -> composeSchema falls back to its prior generic behavior.
   */
  pageTypeByUrl?: ReadonlyMap<string, PageType>;
};

/**
 * UX_TEARDOWN #252 — resolve the brand to stamp as the Organization on
 * drafts. Prefer the tenant's REAL configured business name; fall back
 * to the inferred title-suffix ONLY when no name is configured. Returns
 * the inference shape `{ separator, suffix }` so every composer can use
 * it uniformly (real name → default " | " separator; the separator is
 * irrelevant for the schema Organization name, which reads `.suffix`).
 */
function resolveBrand(
  ctx: DraftEnrichmentContext,
): { separator: string; suffix: string } | null {
  const real = ctx.businessName?.trim();
  if (real) return { separator: " | ", suffix: real };
  return inferBrandSuffix(ctx.snapshotByUrl.values());
}

// ── small pure helpers ────────────────────────────────────────────────

const TITLE_SUFFIX_SEPARATORS = [" | ", " — ", " – ", " :: "];

/**
 * Universal CMS placeholder strings (Wix/WordPress/Squarespace template
 * defaults). A heading/title equal to one of these is template residue,
 * not content — never use it as a draft base, never treat it as a
 * brand. Platform hygiene, not vertical vocabulary.
 */
const CMS_PLACEHOLDER_TEXTS: ReadonlySet<string> = new Set([
  "page title",
  "untitled",
  "untitled page",
  "new page",
  "title",
  "heading",
  "your title here",
  "add a title",
]);

export function isCmsPlaceholder(text: string): boolean {
  return CMS_PLACEHOLDER_TEXTS.has(text.trim().toLowerCase());
}

function firstPathSegment(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  return path.split("/").filter((s) => s.length > 0)[0] ?? "";
}

/**
 * Infer the site's brand/title suffix from its own pages. A tail only
 * counts as the BRAND when it behaves like one:
 *   • appears on ≥3 titled pages, AND
 *   • spans ≥2 distinct first path segments.
 * A collection/category tail (e.g. every "/iran-animals/…" dynamic page
 * ending "| Iran Animals & Wildlife") fails the diversity test — caught
 * live on Wix dynamic pages, where the most COMMON tail is usually a
 * collection name, not the site. Returns null when nothing qualifies;
 * drafts simply go suffix-less.
 */
export function inferBrandSuffix(
  snapshots: Iterable<PageSnapshot>,
): { separator: string; suffix: string } | null {
  const counts = new Map<
    string,
    { separator: string; suffix: string; n: number; segments: Set<string> }
  >();
  for (const s of snapshots) {
    const title = s.title?.trim();
    if (!title) continue;
    for (const sep of TITLE_SUFFIX_SEPARATORS) {
      const idx = title.lastIndexOf(sep);
      if (idx <= 0) continue;
      const suffix = title.slice(idx + sep.length).trim();
      if (suffix.length === 0 || suffix.length > 60 || isCmsPlaceholder(suffix)) continue;
      const key = `${sep}::${suffix.toLowerCase()}`;
      const cur = counts.get(key);
      if (cur) {
        cur.n++;
        cur.segments.add(firstPathSegment(s.url));
      } else {
        counts.set(key, {
          separator: sep,
          suffix,
          n: 1,
          segments: new Set([firstPathSegment(s.url)]),
        });
      }
      break; // one suffix per title — the last separator wins
    }
  }
  let best: { separator: string; suffix: string; n: number } | null = null;
  for (const c of counts.values()) {
    if (c.n >= 3 && c.segments.size >= 2 && (best === null || c.n > best.n)) {
      best = c;
    }
  }
  return best ? { separator: best.separator, suffix: best.suffix } : null;
}

/** Strip an inferred brand suffix from a title, if present. */
export function stripBrandSuffix(
  title: string,
  brand: { separator: string; suffix: string } | null,
): string {
  if (!brand) return title.trim();
  const sep = brand.separator;
  const idx = title.lastIndexOf(sep);
  if (idx > 0 && title.slice(idx + sep.length).trim().toLowerCase() === brand.suffix.toLowerCase()) {
    return title.slice(0, idx).trim();
  }
  return title.trim();
}

/** Clip text to a max length on a word boundary (meta descriptions). */
export function clipOnWordBoundary(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut.slice(0, max)).trim();
}

/**
 * Clean a candidate content chunk of JUNK zero-width characters before
 * it's used in a draft. Removes ZERO-WIDTH SPACE (U+200B) and BOM
 * (U+FEFF) — Wix injects these into headings/card text and they
 * survive `.trim()`, so an "empty" chunk would otherwise read as a
 * 1-char string. DELIBERATELY preserves U+200C ZWNJ / U+200D ZWJ:
 * those are SEMANTICALLY MEANINGFUL inside Persian/Arabic words
 * (e.g. می‌روم) and must never be stripped. Pure.
 */
export function stripJunkZeroWidth(s: string): string {
  return s.replace(/[\u200B\uFEFF]/g, "").trim();
}

/** Whether a chunk has any VISIBLE glyph — strips ALL zero-width marks
 *  (incl. ZWNJ/ZWJ) + whitespace purely for the emptiness test, so a
 *  chunk that is ONLY zero-width/whitespace is rejected, while a real
 *  Persian word containing an internal ZWNJ still passes. */
export function hasVisibleGlyph(s: string): boolean {
  return s.replace(/[\u200B-\u200D\uFEFF\s]/g, "").length > 0;
}

function titleCaseLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ── Prose vs. list/label detection (meta-description quality) ─────────
//
// A meta description must read as PROSE, not as a recipe ingredient list
// or a heading/section-label index. These pure predicates let composeMeta
// reject list-like bodies and label-list structural sources, and refuse to
// ever emit "colon-soup" (the section-heading list joined by " — " that the
// extractor produced on Wix recipe/spec pages whose body copy it can't see).
// All vertical-agnostic: derived only from the shape of the page's own
// text, never from hardcoded vocabulary.

/** A line/fragment that opens like a list item: bullet glyph, dash, star,
 *  or an enumerator ("1.", "2)"). Recipe ingredient lines + numbered steps
 *  match — they are not description prose. */
function looksLikeBulletLine(line: string): boolean {
  return /^\s*(?:[•·▪◦‣*\-–—]|\d+[.)])\s+/.test(line);
}

/**
 * Whether a body source reads as a LIST rather than prose. True when the
 * sample is bullet-dominated — either most of its lines open like list
 * items, or bullet glyphs make up a meaningful fraction of the characters
 * (Wix recipe pages emit a single run with inline "• …• …• …" that has no
 * newlines but is unmistakably a list). A recipe ingredient list is not a
 * page description, so composeMeta must not draft a meta from it.
 */
export function isListLikeBody(text: string): boolean {
  const clean = text.trim();
  if (clean.length === 0) return false;
  // Inline bullet density: count list glyphs vs. total length. Wix joins a
  // recipe's ingredient lines into one string with "•" separators (no
  // newlines) — ~one glyph per short fragment is enough to dominate.
  const bulletGlyphs = (clean.match(/[•·▪◦‣]/g) ?? []).length;
  if (bulletGlyphs >= 3) return true;
  // Per-line: >30% of non-empty lines opening like list items → list.
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  const bulletLines = lines.filter(looksLikeBulletLine).length;
  return bulletLines / lines.length > 0.3;
}

/**
 * Whether a structural fragment (an h1/h2/card chunk) is a heading or
 * section LABEL rather than a prose sentence. Such fragments must be
 * dropped before assembling a meta source — joined together they read as
 * the broken placeholder "Ingredients: — Serving Info: — Step 1: …".
 * A fragment is a label when ANY of:
 *   • it ends with a colon ("Ingredients:", "Serving Info:")
 *   • it matches a "Step N" / "Section N" enumerator heading
 *   • it is a short heading: ≤4 words AND carries no sentence punctuation
 *     (a real description sentence is longer or ends with . ! ?)
 * Pure; vertical-agnostic (shape only, no vocabulary).
 */
export function isLabelOrHeadingFragment(fragment: string): boolean {
  const s = fragment.trim();
  if (s.length === 0) return true;
  if (s.endsWith(":")) return true;
  // "Step 1: …", "Step 1 …", "Section 2", "Part 3 –" — enumerated headings.
  if (/^(?:step|section|part|chapter|phase)\s+\d+\b/i.test(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  const hasSentencePunctuation = /[.!?]/.test(s);
  if (words.length <= 4 && !hasSentencePunctuation) return true;
  return false;
}

/**
 * Last-line guard: does an assembled candidate STILL read as a label /
 * heading list rather than a description? Catches colon-soup that slips
 * past per-fragment filtering. True when:
 *   • it carries the colon-fragment signature ": —" or "—…:" (a section
 *     label adjacent to the " — " join), OR
 *   • it is mostly Title-Case fragments joined by " — " (a heading index,
 *     not a sentence) with no real sentence punctuation.
 * When true, composeMeta returns null — NEVER emits colon-soup.
 */
export function readsAsLabelList(text: string): boolean {
  const s = text.trim();
  if (s.length === 0) return true;
  // Colon adjacent to the structural " — " join, or a trailing bare colon.
  if (/:\s*—/.test(s) || /—\s*[^—]*:\s*(?:—|$)/.test(s)) return true;
  if (/:\s*$/.test(s)) return true;
  // Title-Case-fragment index: split on the " — " join; if most pieces are
  // short Title-Case headings (no sentence punctuation), it's a label list.
  if (s.includes(" — ")) {
    const pieces = s.split(" — ").map((p) => p.trim()).filter(Boolean);
    if (pieces.length >= 2) {
      const headingish = pieces.filter((p) => isLabelOrHeadingFragment(p)).length;
      if (headingish / pieces.length >= 0.6) return true;
    }
  }
  return false;
}

/**
 * Extract the first PROSE sentence ≥ minLen chars from a body sample —
 * skipping any leading list/bullet content. Splits on sentence
 * terminators; returns the first non-bullet sentence long enough to read
 * as a description, else null. Pure.
 */
export function firstProseSentence(text: string, minLen = 40): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return null;
  // Split into candidate sentences on terminator + space; keep terminators.
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length < minLen) continue;
    if (looksLikeBulletLine(sentence)) continue;
    if (isListLikeBody(sentence)) continue;
    return sentence;
  }
  return null;
}

/**
 * Derive a human title from the URL slug: "/persian-last-names" →
 * "Persian Last Names". The slug is the page's own name for itself —
 * the most reliable deterministic base on pages whose extracted
 * title/h1 are missing (caught live: Wix pages with null title AND
 * null h1 but a perfectly descriptive slug).
 */
export function titleFromSlug(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  const seg = path.split("/").filter((s) => s.length > 0).pop() ?? "";
  const words = seg
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[-_]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "";
  return titleCaseLabel(words.join(" "));
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "your", "this", "that", "what",
  "when", "where", "how", "why", "are", "was", "were", "will", "can",
  "about", "into", "near", "best", "guide", "page", "home",
]);

function meaningfulWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9؀-ۿ]+/)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Rank other pages by title/h1 word overlap with the target.
 * Site-wide boilerplate tokens (brand names, nav words) are excluded
 * via document frequency — a word on ≥3 pages AND >50% of the site
 * says nothing about topical relatedness. Vertical-agnostic by
 * construction: the filter is derived from the tenant's own pages.
 */
export function suggestLinkSources(
  targetUrl: string,
  target: PageSnapshot | undefined,
  clusterLabel: string,
  snapshotByUrl: ReadonlyMap<string, PageSnapshot>,
  maxSources = 3,
): Array<{ url: string; title: string; overlap: number }> {
  const docFreq = new Map<string, number>();
  let docCount = 0;
  for (const snap of snapshotByUrl.values()) {
    docCount++;
    for (const w of meaningfulWords([snap.title ?? "", snap.h1 ?? ""].join(" "))) {
      docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
  }
  const isBoilerplate = (w: string): boolean => {
    const n = docFreq.get(w) ?? 0;
    return n >= 3 && n / Math.max(docCount, 1) > 0.5;
  };

  const targetWords = new Set(
    [...meaningfulWords([target?.title ?? "", target?.h1 ?? "", clusterLabel].join(" "))].filter(
      (w) => !isBoilerplate(w),
    ),
  );
  if (targetWords.size === 0) return [];
  const scored: Array<{ url: string; title: string; overlap: number }> = [];
  for (const [url, snap] of snapshotByUrl) {
    if (url === targetUrl) continue;
    if (snap.http_status >= 400) continue;
    const words = meaningfulWords([snap.title ?? "", snap.h1 ?? ""].join(" "));
    let overlap = 0;
    for (const w of words) if (targetWords.has(w)) overlap++;
    if (overlap > 0) scored.push({ url, title: snap.title ?? snap.h1 ?? url, overlap });
  }
  scored.sort((a, b) => b.overlap - a.overlap || a.url.localeCompare(b.url));
  return scored.slice(0, maxSources);
}

// ── composers ─────────────────────────────────────────────────────────

type DraftFill = {
  display_label: string;
  current_text: string | null;
  proposed_text: string;
  expected_impact: string | null;
  measurement_plan: string;
};

// Trust audit fix D (2026-06-16): title / H1 / meta moves are SEARCH-CTR
// changes — their measurable payoff is Google Search performance, NOT AI
// citations. The old copy ("tracks whether AI answers start citing it") was an
// ungrounded AEO claim on search moves with no AI-answer evidence. AI-
// recommendation lift is claimed ONLY by AEO_MEASURE_PLAN (the answer-block /
// sources moves that genuinely target it). No cron language (refresh-driven).
const SCAN_VERIFY_PLAN =
  "When you refresh your connected data, Beacon re-checks this page in Google Search — impressions, clicks, and average position — and marks the move verified once the change is live.";
const FIX_VERIFY_PLAN =
  "When you refresh your connected data, Beacon re-checks this page; this issue clears from the queue once it is fixed.";

/** Measurement plan for AEO CONTENT moves (answer blocks, sources)
 *  whose payoff is AI-recommendation lift, not a queue-clear. Ties the
 *  card to the Proof Engine + the sourced platform-aware watch windows
 *  (see natural-controls.ts platformPostWindowDays). Plain English; no
 *  jargon — "how often AI assistants recommend this page", never
 *  "citations". Honest on timing (Perplexity fast, Google/ChatGPT
 *  slow) so the operator doesn't judge the result too early. */
const AEO_MEASURE_PLAN =
  "After you publish this, Beacon watches how often AI assistants recommend this page and reports the change on the Proof tab. Perplexity usually reflects edits within about two weeks; Google and ChatGPT take longer, so give it a few weeks before judging the result.";

// Query-bearing edit_title triggers (2026-06-16): these set
// topic_cluster_label to the actual GSC/SEMrush query AND fire ONLY when that
// query is absent from the current title (the trigger's own containment guard)
// — so the whole point of the fix is to get the searched term INTO the title.
// For these, lead the proposed title with the query (the search intent);
// every other trigger (missing/duplicate/mismatch) keeps the page's own
// h1/slug base, unchanged.
const QUERY_TITLE_TRIGGERS: ReadonlySet<string> = new Set([
  "gsc_low_ctr",
  "gsc_striking_distance",
]);
/** A query short enough to BE a title (avoid turning a long-tail query into an
 *  unwieldy title — fall back to the page's own base above this). */
const MAX_QUERY_TITLE_CHARS = 60;

function composeTitle(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  const current = snap?.title?.trim() ?? "";
  // Query-lead base for the query-bearing triggers (when the query is a
  // sensible title length); else null so the page-base logic below runs.
  const queryLabel = candidate.topic_cluster_label.trim();
  const queryBase =
    QUERY_TITLE_TRIGGERS.has(candidate.trigger_signal) &&
    queryLabel.length > 0 &&
    queryLabel.length <= MAX_QUERY_TITLE_CHARS &&
    !isCmsPlaceholder(queryLabel)
      ? titleCaseLabel(queryLabel)
      : "";
  // Base candidates in preference order, skipping CMS template residue
  // ("Page Title" et al.). The URL slug beats the cluster label: for
  // trigger candidates the cluster label is the TRIGGER's name ("Page
  // title"), not the page's topic — the slug is the page naming itself.
  const base =
    queryBase !== ""
      ? queryBase
      : ([
          snap?.h1?.trim() ?? "",
          snap?.h2_list?.[0]?.trim() ?? "",
          titleFromSlug(candidate.target_url ?? ""),
          titleCaseLabel(candidate.topic_cluster_label.trim()),
        ].find((b) => b.length > 0 && !isCmsPlaceholder(b)) ?? "");
  if (!base) return null;
  // Trust audit E2/E3/E4 (2026-06-16): a title rewrite must ADD the searched
  // term or fix a real defect — it must NOT merely swap/append the brand suffix
  // or DROP descriptive words the current title already has. Low CTR alone is
  // not a reason to rewrite an on-topic title. So when the current title is a
  // real (non-placeholder) title that ALREADY contains the proposed base, the
  // only delta would be cosmetic (a brand suffix) or a net LOSS of descriptive
  // text (e.g. dropping "Persian Flags History") — skip the rec entirely.
  // (Query-bearing triggers lead with a query that's absent from the title, so
  // their base is NOT contained here and they still fire.)
  if (current !== "" && !isCmsPlaceholder(current)) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    if (norm(current).includes(norm(base))) return null;
  }
  const proposed = brand ? `${base}${brand.separator}${brand.suffix}` : base;
  if (proposed.trim().length === 0 || proposed.trim() === current) return null;
  return {
    display_label:
      current === ""
        ? `Add a page title: “${proposed}”`
        : `Change the page title to “${proposed}”`,
    current_text: current === "" ? null : current,
    proposed_text: proposed,
    expected_impact:
      "Pages with a clear, specific title are far easier for search engines and AI assistants to quote correctly.",
    measurement_plan: SCAN_VERIFY_PLAN,
  };
}

/**
 * Site-wide chrome detector for structural text pieces (h2s, card
 * texts): a piece appearing verbatim on ≥3 pages AND >50% of the site
 * is template chrome ("Browse by", "Explore More", the brand-as-h2) —
 * not page content. Derived from the tenant's own pages; no hardcoded
 * UI strings.
 */
function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function buildChromeDetector(
  snapshotByUrl: ReadonlyMap<string, PageSnapshot>,
): (text: string) => boolean {
  const freq = new Map<string, number>();
  let pages = 0;
  for (const snap of snapshotByUrl.values()) {
    pages++;
    const pieces = new Set(
      [...(snap.h2_list ?? []), ...(snap.card_texts ?? [])]
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    );
    for (const p of pieces) freq.set(p, (freq.get(p) ?? 0) + 1);
  }
  return (text: string): boolean => {
    const clean = text.trim().toLowerCase();
    const n = freq.get(clean) ?? 0;
    if (n < 3) return false;
    // Site-wide repetition → chrome regardless of length.
    if (n / Math.max(pages, 1) > 0.5) return true;
    // Short fragments repeating across pages are template UI ("Browse
    // by", "Filter by", "Explore More" on every category page) even
    // when the template covers <50% of the site. Real content pieces
    // that recur are longer than 3 words.
    return wordCount(clean) <= 3;
  };
}

/**
 * Pick the liftable PROSE source for a page's meta description, or null
 * when there isn't one. Extracted from `composeMeta` (2026-06-16) so the
 * `missing-meta` trigger can ask the EXACT question composeMeta answers —
 * "can a meta be auto-drafted from this page?" — without re-implementing
 * the prose/list/label gates and risking divergence.
 *
 * A meta description MUST read as prose, never as a recipe ingredient
 * list or a section-heading index. The source selection below only
 * accepts genuine prose; anything that still reads as a label/heading
 * list (colon-soup) is refused — better NO source than a broken one.
 *
 * Preference order (own words only; no hardcoded vertical/brand strings):
 *   (a) the page's existing meta_description (a real prose value), then
 *   (b) the first clean PROSE sentence in the body (skipping bullets), then
 *   (c) page structure (h1 + h2s + cards) AFTER dropping heading/label
 *       fragments — only when ≥40 chars of real prose survive, then
 *   (d) null.
 *
 * PURE.
 */
export function selectMetaSource(
  snap: PageSnapshot | undefined,
  isChrome: (text: string) => boolean,
): string | null {
  const current = snap?.meta_description?.trim() ?? "";

  // (b) First clean prose sentence from the body. Reject the body source
  // outright when it is bullet-dominated (recipe ingredient lists on Wix) —
  // a list is not a description.
  const bodyRaw = (snap?.body_paragraph_sample ?? []).join(" ").trim();
  const bodyProse =
    bodyRaw.length > 0 && !isListLikeBody(bodyRaw)
      ? firstProseSentence(bodyRaw, 40)
      : null;

  // (c) Structural fallback (Wix hides body copy from the <main>/<article>
  // extractor). The page's own H1 is its name for itself — a legitimate
  // lead, kept verbatim when it's real content (not a CMS placeholder /
  // site chrome). Everything below it (h2s + card texts) is filtered: a
  // heading/section LABEL fragment ("Ingredients:", "Serving Info:", "Step
  // 1: …", a short Title-Case heading) is dropped, because joined together
  // those read as the broken placeholder "Ingredients: — Serving Info: —
  // Step 1: …" (caught live on iranopedia.com/persian-kabobs/koobideh-kabob).
  // Only the H1 + real prose fragments survive.
  const cleanH1 = stripJunkZeroWidth(snap?.h1 ?? "");
  const h1Lead =
    hasVisibleGlyph(cleanH1) && !isCmsPlaceholder(cleanH1) && !isChrome(cleanH1)
      ? cleanH1
      : "";
  const proseFragments = [
    ...(snap?.h2_list ?? []),
    ...(snap?.card_texts ?? []),
  ]
    // Strip JUNK zero-width (ZWSP/BOM) Wix injects — these survive
    // .trim() and otherwise pass the length check as 1-char "empty"
    // chunks, producing garbage like "Kabob Barg \u2014 \u200b \u2014 \u200b".
    // ZWNJ/ZWJ (Persian) are preserved by stripJunkZeroWidth;
    // hasVisibleGlyph rejects chunks with no real glyph.
    .map((s) => stripJunkZeroWidth(s))
    .filter(
      (s) =>
        hasVisibleGlyph(s) &&
        !isCmsPlaceholder(s) &&
        !isChrome(s) &&
        !isLabelOrHeadingFragment(s),
    );
  const structural = [h1Lead, ...proseFragments]
    .filter((s) => s.length > 0)
    .join(" — ")
    .trim();

  // Pick the best PROSE source in preference order: existing meta first,
  // then a clean body sentence, then the structural prose — each only when
  // it carries ≥40 chars of real prose.
  const source =
    current.length >= 40
      ? current
      : bodyProse && bodyProse.length >= 40
        ? bodyProse
        : structural.length >= 40
          ? structural
          : "";
  if (source.length < 40) return null; // not enough real prose — no fake drafts

  // Hard guard: NEVER emit colon-soup. If the assembled candidate still
  // reads as a label/heading list (colon-fragment signature, or a Title-Case
  // heading index joined by " — "), refuse the source entirely.
  if (readsAsLabelList(source)) return null;
  return source;
}

function composeMeta(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  isChrome: (text: string) => boolean,
): DraftFill | null {
  const current = snap?.meta_description?.trim() ?? "";

  // Behaves IDENTICALLY to before extraction (2026-06-16): the whole
  // source-selection + prose/list/label gating now lives in the exported
  // `selectMetaSource` so the missing-meta trigger can ask the same
  // "can this be auto-drafted?" question without divergence.
  const source = selectMetaSource(snap, isChrome);
  if (source === null) return null; // not enough liftable prose — no fake drafts

  const proposed = clipOnWordBoundary(source, 155);
  // Post-clip safety re-check: refuse if clipping left it too short or
  // turned the tail into a bare colon/label.
  if (proposed.length < 40 || readsAsLabelList(proposed)) return null;
  if (proposed === current) return null;
  return {
    display_label:
      current === ""
        ? "Add the short page description search and AI results show"
        : "Rewrite the short page description search and AI results show",
    current_text: current === "" ? null : current,
    proposed_text: proposed,
    expected_impact:
      "This is the snippet searchers and AI assistants see — a real description in the page's own words lifts click-through.",
    measurement_plan: SCAN_VERIFY_PLAN,
  };
}

function composeH1(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  const current = snap?.h1?.trim() ?? "";
  const fromTitle = snap?.title ? stripBrandSuffix(snap.title, brand) : "";
  const proposed =
    [
      fromTitle,
      titleFromSlug(candidate.target_url ?? ""),
      titleCaseLabel(candidate.topic_cluster_label.trim()),
    ].find((b) => b.length > 0 && !isCmsPlaceholder(b)) ?? "";
  if (!proposed || proposed === current) return null;
  return {
    display_label:
      current === ""
        ? `Add the main page heading: “${proposed}”`
        : `Change the main page heading to “${proposed}”`,
    current_text: current === "" ? null : current,
    proposed_text: proposed,
    expected_impact:
      "The main heading is the strongest single signal of what a page answers — for readers and for AI assistants.",
    measurement_plan: SCAN_VERIFY_PLAN,
  };
}

function composeFixDirective(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
): DraftFill | null {
  const url = candidate.target_url ?? "";
  switch (`${candidate.trigger_signal}::${candidate.action_type}`) {
    case "canonical_mismatch::fix_canonical": {
      if (!snap) return null;
      return {
        display_label: "Point this page's canonical tag at itself",
        current_text: snap.canonical_url ?? null,
        proposed_text: `Set the canonical link on ${url} to "${url}" (it currently points at "${snap.canonical_url ?? "(none)"}"). One line in the page <head>: <link rel="canonical" href="${url}">`,
        expected_impact:
          "A page that claims another URL as its 'real' version asks search and AI engines to credit someone else for its content.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    }
    case "robots_blocks_googlebot::fix_robots":
      return {
        display_label: "Unblock Google from crawling this site",
        current_text: null,
        proposed_text:
          `robots.txt currently blocks Googlebot. Edit robots.txt so Googlebot is allowed (remove the Disallow rules under "User-agent: Googlebot", or under "User-agent: *" if that's the blocking block). Verify at ${url ? new URL(url).origin : ""}/robots.txt.`,
        expected_impact:
          "While Google is blocked, nothing else on this list can move the needle — the site is invisible at the front door.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    case "robots_blocks_ai_bots::fix_robots":
      return {
        display_label: "Unblock AI assistants from reading this site",
        current_text: null,
        proposed_text:
          "robots.txt currently blocks AI crawlers (e.g. GPTBot, PerplexityBot, ClaudeBot). Remove those Disallow blocks so AI assistants can read — and recommend — this site.",
        expected_impact:
          "AI assistants can't recommend pages they're forbidden to read.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    case "noindex_on_indexable_page::fix_noindex": {
      if (!snap) return null;
      return {
        display_label: "Remove the 'don't index me' tag from this page",
        current_text: snap.robots_meta ?? null,
        proposed_text: `Remove "noindex" from the robots meta tag on ${url} (currently: "${snap.robots_meta ?? ""}"). The page is telling search engines to forget it exists.`,
        expected_impact:
          "A noindexed page is excluded from search and from most AI answers on purpose — almost never what you want on a real content page.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    }
    case "bad_http_status::fix_status_code": {
      if (!snap) return null;
      return {
        display_label: `Fix the ${snap.http_status} error on this page`,
        current_text: `HTTP ${snap.http_status}`,
        proposed_text: `${url} returns HTTP ${snap.http_status}. Restore the page (or 301-redirect it to its replacement) so visitors and crawlers stop hitting an error.`,
        expected_impact:
          "Broken pages bleed both visitors and the credibility signals AI assistants rely on.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    }
    case "sitemap_missing::fix_sitemap": {
      const origin = url ? new URL(url).origin : "";
      return {
        display_label: "Publish a sitemap so engines can find every page",
        current_text: null,
        proposed_text: `No sitemap.xml was found. Publish one at ${origin}/sitemap.xml listing the site's canonical pages, then submit it in Google Search Console.`,
        expected_impact:
          "Without a sitemap, new and updated pages get discovered late or not at all.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    }
    default:
      return null;
  }
}

function composeInternalLinks(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  ctx: DraftEnrichmentContext,
): DraftFill | null {
  const url = candidate.target_url ?? "";
  const sources = suggestLinkSources(url, snap, candidate.topic_cluster_label, ctx.snapshotByUrl);
  if (sources.length === 0) return null;
  const anchor = snap?.h1?.trim() || snap?.title?.trim() || candidate.topic_cluster_label;
  const lines = sources.map((s) => `• ${s.url} (“${s.title}”)`);
  return {
    display_label: `Link to this page from ${sources.length} related page(s)`,
    current_text: null,
    proposed_text:
      `No other page links to ${url}, so visitors and crawlers rarely find it. Add a link (anchor text: “${anchor}”) from these related pages:\n${lines.join("\n")}`,
    expected_impact:
      "Pages nothing links to are nearly invisible — one or two in-context links from related pages changes that.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * Serialize JSON-LD for embedding inside a `<script>` tag. `</` is
 * escaped to `<\/` so page text containing "</script>" can never
 * terminate the script block early (standard JSON-LD embedding
 * hygiene; JSON.parse treats `\/` identically to `/`).
 */
function jsonLdScript(obj: unknown): string {
  const body = JSON.stringify(obj, null, 2).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">\n${body}\n</script>`;
}

/** First-character uppercase for ASCII words only — non-Latin text
 *  (e.g. Persian/Finglish path segments) passes through verbatim,
 *  never mangled by Latin casing rules. */
function humanizePathSegment(segment: string): string {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // keep the raw segment on malformed escapes
  }
  text = text.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return text.replace(/(^|\s)([a-z])/g, (m, sp: string, ch: string) => sp + ch.toUpperCase());
}

/**
 * Content Schema Engine (2026-06-12) — complete Article
 * (+BreadcrumbList) JSON-LD for `missing_schema_content` candidates.
 * Accept-ready: the owner pastes finished, valid markup — never asked
 * to "extend the @type" themselves.
 *
 * Derivation (omit-when-missing, NEVER fabricate; primary-doc
 * grounding cited in the slice commit):
 *   • Article has NO required properties (Google Article doc), so an
 *     omit-when-missing object is always schema-valid.
 *   • headline ← h1, else title. Neither → no draft (better empty
 *     than fake).
 *   • description ← meta description, else clipped body sample.
 *   • author/publisher ← Organization named by the tenant's OWN
 *     inferred title-suffix brand; omitted when no brand infers.
 *     (Google accepts Organization authors.)
 *   • image / dates / inLanguage: not on the snapshot → omitted.
 *   • BreadcrumbList (second block) from the URL path: per ListItem,
 *     `position` + `name` are required; `item` is omitted on the LAST
 *     element (Google uses the containing page's URL).
 */
/**
 * Content-schema type classifier (2026-06-18) — picks the schema.org @type
 * that actually fits the page instead of stamping `Article` on everything (a
 * real quality gap a professional SEO would never ship: a recipe page wants
 * `Recipe`, a "best X" ranking wants `ItemList`). Deterministic + GENERIC —
 * it keys off page STRUCTURE (recipe-shaped headings, ranked headline + a
 * multi-item body), never off the vertical/topic, so it generalizes to any
 * tenant. `article` stays the safe default when nothing clearly fits.
 */
export function classifyContentSchemaType(
  snap: PageSnapshot,
  headline: string,
): "list" | "recipe" | "article" {
  const headings = [...(snap.h2_list ?? []), ...(snap.h3_list ?? [])].map((h) =>
    h.toLowerCase(),
  );
  // Recipe: the page structurally presents ingredients AND preparation steps.
  const hasIngredients = headings.some((h) => /\bingredient/.test(h));
  const hasSteps = headings.some((h) =>
    /\b(instructions?|directions?|methods?|preparation|steps?|how to make)\b/.test(
      h,
    ),
  );
  if (hasIngredients && hasSteps) return "recipe";
  // Ranked list: "best …" / "top N …" / "N best …" headline WITH a real
  // multi-item body (cards or repeated H2 sections).
  const itemCount = Math.max(
    (snap.card_texts ?? []).length,
    (snap.h2_list ?? []).length,
  );
  const looksRanked = /\b(best|top\s+\d+|\d+\s+best)\b/i.test(headline);
  if (looksRanked && itemCount >= 3) return "list";
  return "article";
}

/**
 * BreadcrumbList block from the URL path (shared by the Article + ItemList
 * drafts). The leaf carries no `item`. Returns null when the URL is the root
 * or unparseable.
 */
function buildBreadcrumbBlock(
  pageUrl: string,
  leafName: string,
  orgName: string,
): string | null {
  try {
    const u = new URL(pageUrl);
    const segments = u.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return null;
    const rootName = orgName || u.hostname.replace(/^www\./i, "");
    const items: Array<Record<string, unknown>> = [
      { "@type": "ListItem", position: 1, name: rootName, item: `${u.origin}/` },
    ];
    let cumulative = "";
    for (let i = 0; i < segments.length - 1; i++) {
      cumulative += `/${segments[i]}`;
      items.push({
        "@type": "ListItem",
        position: items.length + 1,
        name: humanizePathSegment(segments[i]!),
        item: `${u.origin}${cumulative}`,
      });
    }
    items.push({ "@type": "ListItem", position: items.length + 1, name: leafName });
    return jsonLdScript({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items,
    });
  } catch {
    return null;
  }
}

/**
 * ItemList DIRECTIVE for ranked "best/top" pages. `ItemList` is the type a pro
 * SEO would use here (it tells engines "this is a ranked collection," which
 * `Article` cannot). We DELIBERATELY do not auto-build the items: on real
 * pages the crawl's headings/cards are mostly nav chrome + section labels
 * ("Explore More", brand name), NOT the actual entries — so a generated
 * ItemList would be full of garbage list items, which is worse than none and
 * exactly the kind of fabrication the trust audit forbids. So we name the type
 * + the entries to mark up, and the owner supplies the verbatim list.
 */
function composeContentListDirective(): DraftFill {
  return {
    display_label:
      "Use ItemList structured data so engines read this as a ranked list",
    current_text: null,
    proposed_text:
      "This page is a ranked list (e.g. “best” / “top N”), so it should use schema.org/ItemList structured data, not a generic Article. Add an ItemList JSON-LD block to the <head> with one ListItem per entry on the page, in order (position 1, 2, 3…), each item's name copied from the page. If each entry is a place or product, you can nest its specific type (e.g. Restaurant, Product) for richer results. Beacon doesn't auto-fill the entries because the crawled page mixes the real items with navigation, so they must be taken from your actual content.",
    expected_impact:
      "ItemList tells AI engines this is a ranked set of options so they can lift the entries directly — an Article type hides that structure entirely.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * Recipe DIRECTIVE for recipe-structured pages. We do NOT emit a half-Recipe:
 * Google's Recipe rich results REQUIRE recipeIngredient + recipeInstructions,
 * and those must match the page exactly — fabricating them would be wrong and
 * an incomplete Recipe is worse than none. So we name the opportunity + the
 * required fields and let the owner fill the verbatim content. Still far
 * better than stamping `Article` on a recipe.
 */
function composeContentRecipeDirective(): DraftFill {
  return {
    display_label:
      "Add Recipe structured data so this dish can win recipe results",
    current_text: null,
    proposed_text:
      "This page is structured like a recipe (it lists ingredients and preparation steps) but has no Recipe structured data. Add a schema.org/Recipe JSON-LD block to the <head> with at least: name, recipeIngredient (one entry per ingredient, copied verbatim from the page), and recipeInstructions (the steps in order). Recipe markup is what makes a page eligible for recipe rich results and lets AI assistants answer “how do I make this” step by step. Beacon doesn't auto-fill the ingredients and steps because they must match your page exactly.",
    expected_impact:
      "A complete Recipe block can win recipe rich results and is far easier for AI assistants to quote step-by-step — a generic Article type captures none of that.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * Item 73 (2026-07-02), build the Person JSON-LD block for a biography
 * shaped content page. Deterministic from the page's own extracted
 * fields (via `detectBiographyPage`) plus an OPTIONAL pre-resolved
 * Wikidata match. Every field is independently omitted when not
 * confidently known, never invented:
 *   - name: required (the detector already guarantees a non-empty name
 *     for a biography classification).
 *   - birthDate: only when the detector extracted one.
 *   - jobTitle: only when an occupation phrase was extracted.
 *   - sameAs: ONLY for a `confidence: "high"` Wikidata match. A
 *     `needs-confirm` match is never auto-emitted here (surfaced
 *     separately as an operator-confirmable suggestion).
 *
 * Returns null when the page isn't biography-shaped (caller skips the
 * Person block entirely; Article-only drafting is unaffected).
 */
export function buildPersonBlock(
  snap: PageSnapshot,
  wikidataMatch:
    | { confidence: "high" | "needs-confirm" | "none"; wikidataUrl: string | null; wikipediaUrl: string | null }
    | undefined,
): Record<string, unknown> | null {
  const detection = detectBiographyPage(snap);
  if (!detection.isBiography || !detection.extracted) return null;

  const { name, birthDate, occupation } = detection.extracted;
  if (!name) return null;

  const sameAs: string[] = [];
  if (wikidataMatch?.confidence === "high") {
    if (wikidataMatch.wikidataUrl) sameAs.push(wikidataMatch.wikidataUrl);
    if (wikidataMatch.wikipediaUrl) sameAs.push(wikidataMatch.wikipediaUrl);
  }

  return {
    "@type": "Person",
    name,
    ...(birthDate ? { birthDate } : {}),
    ...(occupation ? { jobTitle: occupation } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function composeContentArticleSchema(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot,
  brand: { separator: string; suffix: string } | null,
  wikidataMatch?: {
    confidence: "high" | "needs-confirm" | "none";
    wikidataUrl: string | null;
    wikipediaUrl: string | null;
  },
): DraftFill | null {
  // audit-wave3 #6: a CMS template placeholder ("Page Title"/"Untitled") must
  // NOT be asserted as the page's entity name in JSON-LD — treat it as no headline.
  const headline = snap.h1?.trim() || snap.title?.trim() || "";
  if (!headline || isCmsPlaceholder(headline)) return null;

  // Content-aware @type: a recipe page → Recipe directive; a ranked "best X"
  // page → ItemList; everything else → the Article default below.
  const kind = classifyContentSchemaType(snap, headline);
  if (kind === "recipe") return composeContentRecipeDirective();
  if (kind === "list") return composeContentListDirective();

  const pageUrl = candidate.target_url ?? snap.url;
  const descriptionSource = selectMetaSource(snap, () => false);
  const description = descriptionSource
    ? clipOnWordBoundary(descriptionSource, 155)
    : null;
  const orgName = brand?.suffix?.trim() || "";
  // Entity coherence (L11): reference the site Organization's stable @id (the one
  // the Entity-foundation Organization+WebSite graph publishes) so this page's
  // Article links INTO the entity graph instead of declaring an anonymous org.
  const orgIdMatch = /^https?:\/\/[^/]+/.exec(pageUrl ?? "");
  const orgRef = orgName
    ? orgIdMatch
      ? { "@type": "Organization", "@id": `${orgIdMatch[0]}/#organization`, name: orgName }
      : { "@type": "Organization", name: orgName }
    : null;

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    ...(description ? { description } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    ...(orgRef ? { author: orgRef, publisher: orgRef } : {}),
  };

  const blocks: string[] = [jsonLdScript(article)];

  // Item 73 (2026-07-02), Wikidata grounding: a biography-shaped page also
  // gets a Person block (own JSON-LD script, additive to Article since
  // Google allows multiple JSON-LD scripts per page).
  const personBlock = buildPersonBlock(snap, wikidataMatch);
  const isBiography = personBlock != null;
  if (personBlock) {
    blocks.push(
      jsonLdScript({ "@context": "https://schema.org", ...personBlock }),
    );
  }

  const crumb = buildBreadcrumbBlock(pageUrl, headline, orgName);
  if (crumb) blocks.push(crumb);

  return {
    display_label: isBiography
      ? "Add Article + Person structured data so AI engines recognize this person"
      : "Add Article structured data so AI engines understand this page",
    current_text: null,
    proposed_text:
      "Add these JSON-LD blocks to the page <head> — they are complete and ready to paste:\n" +
      blocks.join("\n"),
    expected_impact: isBiography
      ? "AI answer engines resolve people to knowledge-graph entities before citing sources. Person structured data (plus a verified Wikidata link when confirmed) is the page identifying its subject in the engines' own language."
      : "Structured data is the page explaining itself in the engines' own language.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * fix_schema slice (2026-06-12) — repair directive for
 * `invalid_schema` candidates. The scanner's own validator output is
 * quoted verbatim (prefix stripped for plain English): the owner sees
 * exactly which type + property is broken on THIS page. Deterministic,
 * derived 100% from scanner output — nothing invented. Same
 * directive-draft family as composeFixDirective (canonical/robots/…).
 */
function composeFixSchema(
  snap: PageSnapshot | undefined,
): DraftFill | null {
  if (!snap) return null;
  const actionable = actionableSchemaWarnings(
    snap.schema_validation_warnings,
  );
  if (actionable.length === 0) return null;
  const lines = actionable.map(
    (w) =>
      "- " + w.replace(/^schema_(critical|warning):/, "").trim(),
  );
  return {
    display_label: "Repair this page's structured data",
    current_text: null,
    proposed_text:
      `The scanner found ${actionable.length} issue${actionable.length === 1 ? "" : "s"} in this page's structured data:\n` +
      lines.join("\n") +
      "\n\nOpen the page's JSON-LD block(s) and fix each item above; keep every other field unchanged.",
    expected_impact:
      "Broken structured data is worse than none — engines discard the whole block. Repairing it restores the page's machine-readable meaning.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * Wix SEO push slice (2026-06-12) — BreadcrumbList-only draft for
 * store-product pages (`missing_schema_store`). Breadcrumb is the one
 * duplication-safe type there (the platform auto-generates Product
 * JSON-LD) and the block is machine-extractable, so the push path can
 * apply it via the Stores seoData write on Accept.
 */
function composeStoreBreadcrumbSchema(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  // audit-wave3 #6: a CMS template placeholder ("Page Title"/"Untitled") must
  // NOT be asserted as the page's entity name in JSON-LD — treat it as no headline.
  const headline = snap.h1?.trim() || snap.title?.trim() || "";
  if (!headline || isCmsPlaceholder(headline)) return null;
  const pageUrl = candidate.target_url ?? snap.url;
  const orgName = brand?.suffix?.trim() || "";
  let block: string;
  try {
    const u = new URL(pageUrl);
    const segments = u.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return null;
    const rootName = orgName || u.hostname.replace(/^www\./i, "");
    const items: Array<Record<string, unknown>> = [
      { "@type": "ListItem", position: 1, name: rootName, item: `${u.origin}/` },
    ];
    let cumulative = "";
    for (let i = 0; i < segments.length - 1; i++) {
      cumulative += `/${segments[i]}`;
      items.push({
        "@type": "ListItem",
        position: items.length + 1,
        name: humanizePathSegment(segments[i]!),
        item: `${u.origin}${cumulative}`,
      });
    }
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name: headline,
    });
    block = jsonLdScript({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items,
    });
  } catch {
    return null;
  }
  return {
    display_label:
      "Add breadcrumb structured data so engines see where this product sits",
    current_text: null,
    proposed_text:
      "Add this JSON-LD block to the page <head> — complete and ready to paste (Beacon can also apply it for you on approval):\n" +
      block,
    expected_impact:
      "Structured data is the page explaining itself in the engines' own language.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

function composeSchema(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  brand: { separator: string; suffix: string } | null,
  wikidataMatch?: {
    confidence: "high" | "needs-confirm" | "none";
    wikidataUrl: string | null;
    wikipediaUrl: string | null;
  },
  local?: {
    facts: {
      name: string;
      address: string;
      phone: string;
      domain: string;
      areaServed: string[];
    } | null;
    pageType: PageType | undefined;
  },
): DraftFill | null {
  if (!snap) return null;

  // Content Schema Engine (2026-06-12): content-page candidates get a
  // complete Article (+BreadcrumbList) draft instead of the generic
  // skeleton below. Item 73 (2026-07-02): a biography-shaped page also
  // gets a Person block (buildPersonBlock no-ops for non-biography pages).
  if (candidate.trigger_signal === "missing_schema_content") {
    return composeContentArticleSchema(candidate, snap, brand, wikidataMatch);
  }

  // Wix SEO push slice (2026-06-12): store-product pages get a
  // Breadcrumb-only block (duplication-safe + pushable).
  if (candidate.trigger_signal === "missing_schema_store") {
    return composeStoreBreadcrumbSchema(candidate, snap, brand);
  }

  // RANK-5 (2026-07-06) - LOCAL SEO. A local-service tenant's city / service /
  // homepage page gets LocalBusiness (+ Service on service pages) JSON-LD built
  // from the tenant's OWN configured facts (name / address / phone / areaServed)
  // instead of the generic WebPage skeleton below. This is exactly the schema
  // the expected-schema map already flags as REQUIRED on city_page /
  // service_page. Empty-safe: no local facts, or a non-local page type ->
  // composeLocalSchema returns null and we fall through to the generic skeleton,
  // byte-identical to before RANK-5.
  const localApplies =
    local?.facts != null &&
    (local.pageType === "city" ||
      local.pageType === "service" ||
      local.pageType === "homepage");
  if (localApplies && local?.facts != null) {
    const isServicePage = local.pageType === "service";
    const localJsonLd = composeLocalSchema({
      pageUrl: candidate.target_url ?? snap.url,
      facts: local.facts,
      service: isServicePage
        ? snap.h1?.trim() || snap.title?.trim() || null
        : null,
    });
    if (localJsonLd != null) {
      return {
        display_label:
          "Add local business structured data so engines know who you are and where you serve",
        current_text: null,
        proposed_text:
          "Add this JSON-LD block to the page <head> so AI search platforms can read your business name, address, phone, and the areas you serve:\n" +
          jsonLdScript(localJsonLd),
        expected_impact:
          "Structured data is the page explaining itself in the engines' own language, and a LocalBusiness block tells them exactly who you are and where you work.",
        measurement_plan: FIX_VERIFY_PLAN,
      };
    }
  }

  const name = snap.title?.trim() || snap.h1?.trim() || "";
  if (!name) return null;
  const descriptionSource = selectMetaSource(snap, () => false);
  const description = descriptionSource
    ? clipOnWordBoundary(descriptionSource, 155)
    : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    url: candidate.target_url ?? snap.url,
    ...(description ? { description } : {}),
  };
  return {
    display_label: "Add structured data so engines understand this page",
    current_text: null,
    proposed_text:
      `Add this JSON-LD block to the page <head> (extend the @type if a more specific one fits — Article, FAQPage, Product):\n${jsonLdScript(jsonLd)}`,
    expected_impact:
      "Structured data is the page explaining itself in the engines' own language.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

/**
 * Source-ledger slice (2026-06-12) — directive draft for
 * `uncited_content` candidates. Names WHAT to add (a sources section
 * for the page's checkable claims) — never invents the sources
 * themselves; that's editorial judgment the operator keeps.
 */
function composeSourcesDirective(
  snap: PageSnapshot | undefined,
): DraftFill | null {
  if (!snap) return null;
  return {
    display_label: "Add a sources section so engines can trust this page",
    current_text: null,
    proposed_text:
      "Add a short \u201cSources\u201d section at the end of this page citing 2\u20134 authoritative references for its checkable claims (dates, names, statistics, historical facts). Link each source where the claim appears or list them together at the bottom. Choose references a reader would recognize as credible \u2014 academic, institutional, or established publications.",
    expected_impact:
      "Pages that cite checkable sources are measurably more likely to be quoted by AI engines, and sourcing is a trust signal for search quality raters.",
    measurement_plan: AEO_MEASURE_PLAN,
  };
}

/**
 * AEO answer-block readiness slice (2026-06-12) — directive draft for
 * `missing_answer_block`. Names the question + the sourced answer
 * pattern (≈80-150 words per W5 J-71, "40-60 is too thin"; first block
 * under H1, entity-named, pronoun-free, visible body text NOT FAQ
 * schema) but NEVER writes the answer — factual correctness + voice are
 * the owner's, and fabricating cultural/historical facts is a hard rail.
 *
 * Sourced (full digest in the slice commit): GEO study (Aggarwal et
 * al., KDD 2024) on quotable self-contained statements; the 80-150 word
 * answer-block length standard (W5 J-71, superseding the older ~40-60
 * word featured-snippet convention); answer-first placement
 * (AirOps/Frase 2025-26); Anthropic contextual-retrieval pronoun
 * penalty (via Lumar); Google FAQ rich results fully retired May 2026
 * (so: inline answer, not FAQ schema).
 */
function composeAnswerBlockDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  const question =
    candidate.topic_cluster_label?.trim() ||
    candidate.target_url ||
    "this page's main question";
  return {
    display_label: "Add a direct answer at the top so AI engines can quote it",
    current_text: null,
    proposed_text:
      "This page targets the question \u201c" +
      question +
      "\u201d but doesn't answer it up front. Add a 2\u20133 sentence direct answer (about 40\u201360 words) as the FIRST content block, right under the headline \u2014 before any intro. The first sentence must NAME the subject explicitly (no \u201cit\u201d / \u201cthis\u201d) and state the answer so it stands alone if quoted out of context. If a heading covers this topic, phrase it as the actual question and put the answer directly beneath it. Keep it as visible body text \u2014 don't rely on FAQ markup (Google retired FAQ rich results in 2026).",
    expected_impact:
      "Answer engines lift a short, self-contained answer near the top verbatim. Burying it or opening with a preamble means there's no clean passage to quote.",
    measurement_plan: AEO_MEASURE_PLAN,
  };
}

/**
 * improve_meta directive (2026-06-16) — directive draft for a
 * `missing_meta` candidate that `composeMeta` CANNOT auto-draft
 * (`selectMetaSource` returned null: list-structured / label-soup prose,
 * common on Wix pages). Without this, the row promoted as
 * `missing_meta::edit_meta` with a NULL draft — a blank, render-suppressed
 * card. This converts it into an actionable, customer-queue-ready
 * instruction that tells the owner WHAT to write, mirroring
 * `composeAnswerBlockDirective`: plain, jargon-free, no fabrication. The
 * `proposed_text` is INSTRUCTION PROSE, never a publishable meta string —
 * it is never written to a live meta tag (improve_meta has no Wix field
 * mapping, so executePush refuses it).
 */
function composeMetaDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  return {
    display_label: "Write a short page description (Beacon can't draft this one)",
    current_text: null,
    proposed_text:
      "This page has no meta description, and there isn't enough clean text on it for Beacon to draft one automatically. Add a 150–160 character summary that states what the page is about in the words people actually search for. If the page is mostly a list or has very little written copy, also expand it with a sentence or two of real description so there's enough substance to summarize — that helps both readers and the AI assistants that quote pages.",
    expected_impact:
      "This is the snippet searchers and AI assistants see. A clear description in the page's own words lifts click-through, and adding real copy makes the page easier to quote.",
    measurement_plan: SCAN_VERIFY_PLAN,
  };
}

// Clarity fuse (2026-06-13): directive draft for clarity_friction.
// Names the specific Clarity signal + what to investigate; NEVER
// fabricates the fix (the JS bug / frustrating element is the owner's
// to locate). Sources: Microsoft Learn semantic-metrics + Data Export
// API; Google JS-rendering guidance; AI-crawler JS-execution research.
function composeClarityDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  const ev = candidate.operator_evidence ?? "";
  const isErrors = /reason=script_errors/.test(ev);
  if (isErrors) {
    return {
      display_label: "Fix the JavaScript errors on this page",
      current_text: null,
      proposed_text:
        "Microsoft Clarity recorded JavaScript errors affecting a meaningful share of sessions on this page. Open the page in your browser's dev console (and Clarity's \u201cErrors\u201d view) to find the failing script, then fix or remove it. This matters twice over: errors break interactivity for visitors, and most AI answer-engine crawlers (GPTBot, OAI-SearchBot, Perplexity) do NOT run JavaScript \u2014 if a script error blocks content from rendering, those engines never see it.",
      expected_impact:
        "Removing render-breaking errors restores the page for both visitors and the JS-free AI crawlers that decide what to cite.",
      measurement_plan:
        "After you fix it, Clarity's script-error count for this page should drop the next time you refresh your connected data; watch the page's AI-citation trend on the Proof tab.",
    };
  }
  const isDead = /reason=dead_clicks/.test(ev);
  if (isDead) {
    return {
      display_label: "Find the dead element visitors keep clicking",
      current_text: null,
      proposed_text:
        "Microsoft Clarity recorded a high rate of \u201cdead clicks\u201d on this page \u2014 visitors clicking something that looks tappable but does nothing. Watch a few Clarity session recordings for this page to spot what they keep clicking (a broken link, a dead button, or an image/heading people expect to open or expand), then either make it work or remove the false affordance so it no longer looks clickable.",
      expected_impact:
        "Fixing the element visitors expect to work reduces dead-end sessions and the abandonment that follows.",
      measurement_plan:
        "After the fix, Clarity's dead-click rate for this page should fall the next time you refresh your connected data.",
    };
  }
  return {
    display_label: "Review the element visitors are rage-clicking",
    current_text: null,
    proposed_text:
      "Microsoft Clarity recorded rage clicks (rapid repeated clicks in one spot) on this page \u2014 a strong signal that something looks interactive but isn't responding, or responds too slowly. Watch a few Clarity session recordings for this page to find the element, then make it work as users expect (or remove the false affordance).",
    expected_impact:
      "Resolving the frustrating element reduces abandonment and improves the page's engagement signals.",
    measurement_plan:
      "After the fix, Clarity's rage-click rate for this page should fall the next time you refresh your connected data.",
  };
}

// Refresh-play directives (2026-06-16): close the last "fires on
// connected data but emits no draft" gap. `update_intro` (gsc_decay /
// stale_content) and `merge_pages` (thin_content_overlap) previously
// fell through to a null draft — a customer-queue-ready fading-page rec
// (gsc_decay::update_intro is the only customer-facing one) showed no
// concrete play. These emit a grounded DIRECTIVE: they name the numbers
// and the exact refresh/merge steps, but NEVER fabricate the new prose
// (the rewrite is the owner's — same rail as answer-block / sources).

const DECAY_NUM = (ev: string, re: RegExp): number | null => {
  const m = re.exec(ev);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

function composeDecayDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  const ev = candidate.operator_evidence ?? "";
  const clicksPrior = DECAY_NUM(ev, /clicks_prior=(\d+)/);
  const clicksNow = DECAY_NUM(ev, /clicks_now=(\d+)/);
  const posPrior = DECAY_NUM(ev, /position_prior=([\d.]+)/);
  const posNow = DECAY_NUM(ev, /position_now=([\d.]+)/);
  const dropPct =
    clicksPrior != null && clicksNow != null && clicksPrior > 0
      ? Math.round((1 - clicksNow / clicksPrior) * 100)
      : null;
  const slipped =
    posPrior != null && posNow != null && posNow - posPrior >= 0.5;

  const lead =
    dropPct != null && clicksPrior != null && clicksNow != null
      ? "This page brought in about " +
        clicksPrior +
        " clicks from Google a month ago and is down to about " +
        clicksNow +
        " — a drop of roughly " +
        dropPct +
        "%" +
        (slipped && posPrior != null && posNow != null
          ? ", and its average position slipped from #" +
            posPrior.toFixed(1) +
            " to #" +
            posNow.toFixed(1)
          : "") +
        ". "
      : "This page is losing the Google clicks it used to earn. ";

  // Per-query grounding (2026-06-16): name the exact search terms the page is
  // known for, threaded from gsc_daily_rows via gscSignals.topQueries. Absent
  // (heavy page-signal read timed out) → no sentence, directive stays valid.
  const qMatch = /top_queries=([^;]+)/.exec(ev);
  const topQueries = qMatch
    ? qMatch[1]!.split("|").map((q) => q.trim()).filter((q) => q.length > 0)
    : [];
  const queryLine =
    topQueries.length > 0
      ? " People reach this page searching " +
        topQueries.map((q) => "“" + q + "”").join(", ") +
        " — make sure your refreshed top section answers those terms directly and in current language."
      : "";

  return {
    display_label: "Refresh the top of this page to win back its lost clicks",
    current_text: null,
    proposed_text:
      lead +
      "A fading page is almost always a freshness problem, not a rewrite job. Refresh the top section first: update any dated facts, years, prices, or statistics; re-state the page's main answer in the opening paragraph in today's terms; and add one recent example or angle that wasn't there before. Keep the URL and the core content — you're signalling to Google (and the AI assistants that read these pages) that it's current again, not starting over." +
      queryLine,
    expected_impact:
      "Pages recover fastest when the part engines read first is visibly current. A focused freshness pass usually recovers lost ground without the cost of a full rewrite.",
    measurement_plan:
      "After you publish the refresh, watch this page's clicks the next time you refresh your connected data — recovering pages usually turn within a few weeks.",
  };
}

function composeStaleDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  const ev = candidate.operator_evidence ?? "";
  const m = /lastmod=(\d{4}-\d{2}-\d{2})/.exec(ev);
  const since = m ? m[1] : null;
  return {
    display_label: "Refresh this page — it hasn't changed in a long time",
    current_text: null,
    proposed_text:
      (since
        ? "Your sitemap shows this page hasn't been updated since " +
          since +
          ". "
        : "This page hasn't been updated in a long time. ") +
      "Older pages quietly lose ground as the topic moves on. Refresh the top section: update any dated facts, years, and statistics; confirm the main answer still reflects how things work today; and add a recent example or development. You don't need to rewrite the whole page — a visibly current top section is what search engines and the AI assistants that read them reward.",
    expected_impact:
      "A current top section keeps a page eligible to be ranked and quoted; stale facts are a reason engines pass it over.",
    measurement_plan:
      "After you publish the refresh, Beacon picks up the new change date the next time you refresh your connected data and tracks whether the page's visibility recovers.",
  };
}

function composeMergeDirective(
  candidate: RecommendationCandidateRow,
): DraftFill | null {
  const ev = candidate.operator_evidence ?? "";
  const m = /vs (\S+) \(\d+w\)/.exec(ev);
  const other = m ? m[1] : null;
  return {
    display_label: "Combine this thin page with the one it overlaps",
    current_text: null,
    proposed_text:
      "This page is short and covers nearly the same topic as " +
      (other ? other : "another page on your site") +
      ". Two thin pages on one topic split your strength, and engines struggle to tell which one to surface. Pick the stronger page, fold this page's unique points into it, and redirect this URL there (a 301 redirect). If you'd rather keep both, make this one clearly distinct — a different question or angle — and expand it past a thin word count. Don't leave two near-duplicates competing.",
    expected_impact:
      "Merging near-duplicates concentrates the signals engines use to rank and quote a page, so one strong page outperforms two weak ones.",
    measurement_plan:
      "After you merge and redirect, Beacon re-checks both URLs the next time you refresh your connected data and clears the overlap from the queue.",
  };
}

// ── entry point ───────────────────────────────────────────────────────

/**
 * Fill draft fields on a promotion row when a correct deterministic
 * draft is computable. Returns the SAME row (unchanged) otherwise.
 */
export function enrichPromotionRow(
  row: DeterministicPromotionEditRow,
  candidate: RecommendationCandidateRow,
  ctx: DraftEnrichmentContext,
): DeterministicPromotionEditRow {
  if (row.proposed_text != null) return row; // never overwrite
  const snap = candidate.target_url != null ? ctx.snapshotByUrl.get(candidate.target_url) : undefined;

  let fill: DraftFill | null = null;
  switch (candidate.action_type) {
    case "edit_title": {
      const brand = resolveBrand(ctx);
      fill = composeTitle(candidate, snap, brand);
      break;
    }
    case "edit_meta":
      fill = composeMeta(candidate, snap, buildChromeDetector(ctx.snapshotByUrl));
      break;
    case "improve_meta":
      // missing_meta candidate that composeMeta couldn't auto-draft
      // (selectMetaSource null) — a directive telling the owner WHAT to
      // write, never a publishable meta string. Non-pushable (no Wix
      // field mapping); mirrors add_answer_block.
      fill =
        candidate.trigger_signal === "missing_meta"
          ? composeMetaDirective(candidate)
          : null;
      break;
    case "change_h1": {
      const brand = resolveBrand(ctx);
      fill = composeH1(candidate, snap, brand);
      break;
    }
    case "fix_canonical":
    case "fix_robots":
    case "fix_noindex":
    case "fix_status_code":
    case "fix_sitemap":
      fill = composeFixDirective(candidate, snap);
      break;
    case "add_internal_link":
      fill = composeInternalLinks(candidate, snap, ctx);
      break;
    case "add_schema": {
      const brand = resolveBrand(ctx);
      const wikidataMatch =
        candidate.target_url != null
          ? ctx.wikidataMatchByUrl?.get(candidate.target_url)
          : undefined;
      // RANK-5 (2026-07-06): thread the tenant's local-business facts + this
      // page's type so a city/service/homepage page gets LocalBusiness/Service
      // JSON-LD. Both are optional on the context; absent -> composeSchema is
      // byte-identical to before RANK-5 (generic WebPage skeleton).
      const local = {
        facts: ctx.localBusiness ?? null,
        pageType:
          candidate.target_url != null
            ? ctx.pageTypeByUrl?.get(candidate.target_url)
            : undefined,
      };
      fill = composeSchema(candidate, snap, brand, wikidataMatch, local);
      break;
    }
    case "fix_schema":
      fill = composeFixSchema(snap);
      break;
    case "add_proof_section":
      // Only the uncited_content trigger carries a deterministic
      // directive; other proof-section candidates stay draft-less.
      fill =
        candidate.trigger_signal === "uncited_content"
          ? composeSourcesDirective(snap)
          : null;
      break;
    case "add_answer_block":
      fill =
        candidate.trigger_signal === "missing_answer_block"
          ? composeAnswerBlockDirective(candidate)
          : null;
      break;
    case "fix_page_experience":
      fill =
        candidate.trigger_signal === "clarity_friction"
          ? composeClarityDirective(candidate)
          : null;
      break;
    case "update_intro":
      fill =
        candidate.trigger_signal === "gsc_decay"
          ? composeDecayDirective(candidate)
          : candidate.trigger_signal === "stale_content"
            ? composeStaleDirective(candidate)
            : null;
      break;
    case "merge_pages":
      fill =
        candidate.trigger_signal === "thin_content_overlap"
          ? composeMergeDirective(candidate)
          : null;
      break;
    default:
      fill = null;
  }

  if (fill === null) return row;
  // Single chokepoint for the zero-width junk strip (review finding
  // 2026-06-13): #105 only sanitized the META draft, but composeTitle /
  // composeH1 / composeSchema / fix directives all pass raw snap.title /
  // snap.h1 (which can carry U+200B/U+FEFF from the CMS) into customer-facing
  // proposed_text + display_label. Strip every customer-facing string here so
  // EVERY action type is covered. stripJunkZeroWidth preserves Persian ZWNJ
  // (U+200C), so Iranopedia content is untouched.
  return {
    ...row,
    display_label: stripJunkZeroWidth(fill.display_label),
    current_text:
      fill.current_text == null
        ? fill.current_text
        : stripJunkZeroWidth(fill.current_text),
    proposed_text: stripJunkZeroWidth(fill.proposed_text),
    expected_impact: fill.expected_impact,
    measurement_plan: fill.measurement_plan,
  };
}
