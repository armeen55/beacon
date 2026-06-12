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

export type DraftEnrichmentContext = {
  /** Latest snapshot per canonical URL (caller dedupes by fetched_at). */
  snapshotByUrl: ReadonlyMap<string, PageSnapshot>;
};

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

function titleCaseLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
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

const SCAN_VERIFY_PLAN =
  "The nightly scan re-checks this page and marks the move verified once the change is live; the daily poll tracks whether AI answers start citing it.";
const FIX_VERIFY_PLAN =
  "The nightly scan re-checks this page; this issue clears from the queue automatically once it is fixed.";

function composeTitle(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  const current = snap?.title?.trim() ?? "";
  // Base candidates in preference order, skipping CMS template residue
  // ("Page Title" et al.). The URL slug beats the cluster label: for
  // trigger candidates the cluster label is the TRIGGER's name ("Page
  // title"), not the page's topic — the slug is the page naming itself.
  const base =
    [
      snap?.h1?.trim() ?? "",
      snap?.h2_list?.[0]?.trim() ?? "",
      titleFromSlug(candidate.target_url ?? ""),
      titleCaseLabel(candidate.topic_cluster_label.trim()),
    ].find((b) => b.length > 0 && !isCmsPlaceholder(b)) ?? "";
  if (!base) return null;
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

function composeMeta(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  isChrome: (text: string) => boolean,
): DraftFill | null {
  const current = snap?.meta_description?.trim() ?? "";
  // Source preference: real body paragraphs → page structure (h1 +
  // h2s + card texts, minus site-wide chrome). The structural fallback
  // matters on Wix, whose DOM hides body copy from the <main>/<article>
  // extractor (caught live: body_paragraph_sample empty on every
  // Iranopedia page). Either way the draft is built ONLY from the
  // page's own words.
  const body = (snap?.body_paragraph_sample ?? []).join(" ").trim();
  const structural = [
    snap?.h1 ?? "",
    ...(snap?.h2_list ?? []),
    ...(snap?.card_texts ?? []),
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isCmsPlaceholder(s) && !isChrome(s))
    .join(" — ")
    .trim();
  const source = body.length >= 40 ? body : structural;
  if (source.length < 40) return null; // not enough real copy — no fake drafts
  const proposed = clipOnWordBoundary(source, 155);
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
function composeContentArticleSchema(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  const headline = snap.h1?.trim() || snap.title?.trim() || "";
  if (!headline) return null;
  const pageUrl = candidate.target_url ?? snap.url;
  const description =
    snap.meta_description?.trim() ||
    clipOnWordBoundary((snap.body_paragraph_sample ?? []).join(" "), 155);
  const orgName = brand?.suffix?.trim() || "";

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    ...(description ? { description } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
    ...(orgName
      ? {
          author: { "@type": "Organization", name: orgName },
          publisher: { "@type": "Organization", name: orgName },
        }
      : {}),
  };

  const blocks: string[] = [jsonLdScript(article)];

  // BreadcrumbList from the URL path — only when the page sits below
  // the root and the URL parses. The last item carries no `item`.
  try {
    const u = new URL(pageUrl);
    const segments = u.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length > 0) {
      const rootName = orgName || u.hostname.replace(/^www\./i, "");
      const items: Array<Record<string, unknown>> = [
        {
          "@type": "ListItem",
          position: 1,
          name: rootName,
          item: `${u.origin}/`,
        },
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
      blocks.push(
        jsonLdScript({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items,
        }),
      );
    }
  } catch {
    // Unparseable URL — the Article block alone is still a complete draft.
  }

  return {
    display_label:
      "Add Article structured data so AI engines understand this page",
    current_text: null,
    proposed_text:
      "Add these JSON-LD blocks to the page <head> — they are complete and ready to paste:\n" +
      blocks.join("\n"),
    expected_impact:
      "Structured data is the page explaining itself in the engines' own language.",
    measurement_plan: FIX_VERIFY_PLAN,
  };
}

function composeSchema(
  candidate: RecommendationCandidateRow,
  snap: PageSnapshot | undefined,
  brand: { separator: string; suffix: string } | null,
): DraftFill | null {
  if (!snap) return null;

  // Content Schema Engine (2026-06-12): content-page candidates get a
  // complete Article (+BreadcrumbList) draft instead of the generic
  // skeleton below.
  if (candidate.trigger_signal === "missing_schema_content") {
    return composeContentArticleSchema(candidate, snap, brand);
  }

  const name = snap.title?.trim() || snap.h1?.trim() || "";
  if (!name) return null;
  const description =
    snap.meta_description?.trim() ||
    clipOnWordBoundary((snap.body_paragraph_sample ?? []).join(" "), 155);
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
      const brand = inferBrandSuffix(ctx.snapshotByUrl.values());
      fill = composeTitle(candidate, snap, brand);
      break;
    }
    case "edit_meta":
      fill = composeMeta(candidate, snap, buildChromeDetector(ctx.snapshotByUrl));
      break;
    case "change_h1": {
      const brand = inferBrandSuffix(ctx.snapshotByUrl.values());
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
      const brand = inferBrandSuffix(ctx.snapshotByUrl.values());
      fill = composeSchema(candidate, snap, brand);
      break;
    }
    default:
      fill = null;
  }

  if (fill === null) return row;
  return {
    ...row,
    display_label: fill.display_label,
    current_text: fill.current_text,
    proposed_text: fill.proposed_text,
    expected_impact: fill.expected_impact,
    measurement_plan: fill.measurement_plan,
  };
}
