/**
 * safe-internal-link (2026-06-30) — the second safe daily lever. Proposes ONE exact, contextual,
 * non-duplicative internal link, and ONLY when every safety condition is provable from Beacon's own
 * crawl (page_snapshots). PURE, deterministic, $0, no LLM, no fabrication.
 *
 * The link wraps an EXISTING exact phrase in an EXISTING sentence (the destination's own entity
 * name appearing in the source's body) — it never adds a sentence, never invents text, never uses a
 * generic anchor ("click here"), never links a page to itself or to a page it already links. An
 * internal link influences TWO pages (source receives it; destination receives authority), so the
 * caller must mark protected/active destinations ineligible BEFORE calling — this module only ever
 * proposes a link to a destination flagged `eligible`.
 */

/** Normalize any URL (relative or absolute, www or not, trailing slash, query/hash) to a path key. */
export function toLinkPath(u: string | null | undefined): string {
  if (!u) return "";
  const noHost = u.replace(/^https?:\/\/[^/]+/i, "");
  return (noHost.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
}

const GENERIC_TOKEN = new Set([
  "iran", "iranian", "persian", "flag", "flags", "rug", "rugs", "the", "of", "and", "a", "an",
  "history", "guide", "page", "pages", "names", "food", "city", "cities", "best", "top", "list", "all",
  // site-chrome / connector filler (an H1 made only of these is navigation, not an entity)
  "related", "articles", "article", "overview", "featured", "items", "item", "additional",
  "resources", "resource", "information", "info", "content", "main", "more", "home", "about",
  "contact", "blog", "post", "posts", "news", "category", "categories", "section", "sections",
  "welcome", "explore", "discover", "shop", "store",
]);
// An anchor must not be a call-to-action phrase — those are forbidden generic anchors.
const CTA_LEAD = /^(discover|explore|learn|read|see|find|shop|click|view|visit|check|browse|get|buy)\b/i;

/** A destination's distinctive entity phrase (its own H1, else its slug label), 2–4 words, whose
 *  FIRST word is distinctive (not a generic topic token) and which isn't a CTA phrase. */
export function distinctiveAlias(h1: string | null | undefined, label: string): string | null {
  const consider = (raw: string | null | undefined): string | null => {
    const cand = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!cand) return null;
    const words = cand.split(" ");
    if (words.length < 2 || words.length > 4) return null;
    if (CTA_LEAD.test(cand)) return null;
    // at least one DISTINCTIVE token (not all generic) — "Persian Wolf" ok (via "wolf"), "Iran Flag" not
    if (words.every((w) => GENERIC_TOKEN.has(w.toLowerCase()))) return null;
    return cand;
  };
  return consider(h1) || consider(label.replace(/\b\w/g, (c) => c.toUpperCase()));
}

export type LinkDestination = {
  path: string; // normalized path key (for dedup)
  canonicalUrl: string; // full URL for the href / operator instructions
  label: string;
  family: string;
  alias: string; // the exact anchor phrase to look for
  eligible: boolean; // false when protected / active treatment / active control / reserved
  ineligibleReason?: string;
};

const familyOf = (path: string): string => path.split("/").filter(Boolean)[0] ?? "";

/** Build the destination registry from snapshots. `isProtected(path)` returns a reason string when a
 *  page must not RECEIVE a link (active treatment/control, reserved, or in the protected set). */
export function buildLinkDestinations(
  snapshots: Array<{ url?: string; page?: string; canonical_url?: string | null; h1?: string | null }>,
  isProtected: (path: string) => string | null,
): LinkDestination[] {
  const out: LinkDestination[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    const canonicalUrl = s.canonical_url || s.url || s.page || "";
    const path = toLinkPath(canonicalUrl);
    if (!path || path === "/" || seen.has(path)) continue;
    const label = (path.split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ").trim();
    const alias = distinctiveAlias(s.h1, label);
    if (!alias) continue;
    seen.add(path);
    const reason = isProtected(path);
    out.push({ path, canonicalUrl, label, family: familyOf(path), alias, eligible: !reason, ineligibleReason: reason ?? undefined });
  }
  return out;
}

/** Distinctive (non-generic, >2-char) tokens of a phrase — the relevance vocabulary. */
function distinctiveTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC_TOKEN.has(w)),
  );
}
/**
 * Intent-fit gate: a link is contextually valid only when the destination genuinely relates to the
 * SOURCE page. Same-family links (hub/child/sibling) are inherently contextual. A cross-family link
 * must share at least one distinctive token between the destination (its anchor/label) and the
 * source's target query OR page label — otherwise it's an off-topic link (e.g. a "Persian jewelry"
 * link on a t-shirt product page) and is rejected so the planner falls back to a relevant lever.
 */
function destinationIsRelevant(srcFamily: string, srcQuery: string, srcLabel: string, dest: LinkDestination): boolean {
  if (dest.family && dest.family === srcFamily) return true;
  const srcToks = distinctiveTokens(`${srcQuery} ${srcLabel}`);
  if (srcToks.size === 0) return true; // no source context supplied → don't enforce (backward-compatible)
  const destToks = distinctiveTokens(`${dest.alias} ${dest.label}`);
  for (const t of destToks) if (srcToks.has(t)) return true;
  return false;
}

/** Whole-phrase, word-bounded, case-insensitive, Unicode-aware match. */
function phraseRegex(anchor: string): RegExp {
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})($|[^\\p{L}\\p{N}])`, "iu");
}

/** Split a paragraph into sentences (delimiters kept). */
function sentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+[.!?]+(\s|$)|\S[^.!?]*$/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph.trim()];
}

export type InternalLinkProposal = {
  destinationPath: string;
  destinationUrl: string;
  destinationLabel: string;
  destinationFamily: string;
  anchorText: string; // the exact matched substring (source casing preserved)
  exactSourceText: string; // the exact sentence as it appears now
  exactReplacementText: string; // the sentence with ONLY the anchor wrapped in <a>
  paragraphIndex: number;
  paragraphExcerpt: string;
  relationship: "child_to_hub" | "hub_to_child" | "sibling" | "contextual_related";
  ownershipReason: string;
  wixInstructions: string;
};

function relationshipOf(srcPath: string, dest: LinkDestination): InternalLinkProposal["relationship"] {
  const srcFam = familyOf(srcPath);
  const srcDepth = srcPath.split("/").filter(Boolean).length;
  const destDepth = dest.path.split("/").filter(Boolean).length;
  if (srcFam === dest.family) return srcDepth < destDepth ? "hub_to_child" : srcDepth > destDepth ? "child_to_hub" : "sibling";
  return "contextual_related";
}

/**
 * Propose ONE safe internal link from a source page. PURE. Returns null unless an EXACT, eligible,
 * non-duplicative, contextual link can be proven. Scans the source's real body paragraphs for the
 * first eligible destination whose distinctive alias appears as a whole phrase and isn't already
 * linked. The edit wraps that exact phrase in its exact sentence — nothing else changes.
 */
export function proposeSafeInternalLink(input: {
  sourcePath: string;
  sourceParagraphs: string[];
  sourceLinkedPaths: Set<string>; // normalized paths the source already links to
  destinations: LinkDestination[];
  sourceQuery?: string; // the source page's target query (intent-fit gate)
  sourceLabel?: string; // the source page's label (intent-fit gate)
}): InternalLinkProposal | null {
  const src = toLinkPath(input.sourcePath);
  const srcFamily = familyOf(src);
  const paras = input.sourceParagraphs.filter((p) => p && p.trim().length >= 40);
  // Eligible, non-self, not-already-linked, AND contextually relevant to this page (intent-fit gate);
  // then prefer same-family hub/child, then by alias length (more specific = safer).
  const candidates = input.destinations
    .filter((d) => d.eligible && d.path !== src && !input.sourceLinkedPaths.has(d.path))
    .filter((d) => destinationIsRelevant(srcFamily, input.sourceQuery ?? "", input.sourceLabel ?? "", d))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const d of candidates) {
    const re = phraseRegex(d.alias);
    for (let i = 0; i < paras.length; i++) {
      const para = paras[i];
      const m = re.exec(para);
      if (!m) continue;
      const matched = m[2]; // exact source casing
      // Find the exact sentence containing the match.
      const sent = sentences(para).find((s) => phraseRegex(d.alias).test(s));
      if (!sent) continue;
      // Wrap ONLY the first whole-phrase occurrence; everything else byte-identical.
      const sentRe = phraseRegex(d.alias);
      const sm = sentRe.exec(sent);
      if (!sm) continue;
      const before = sent.slice(0, sm.index + sm[1].length);
      const after = sent.slice(sm.index + sm[1].length + matched.length);
      const replacement = `${before}<a href="${d.canonicalUrl}">${matched}</a>${after}`;
      const rel = relationshipOf(src, d);
      return {
        destinationPath: d.path,
        destinationUrl: d.canonicalUrl,
        destinationLabel: d.label,
        destinationFamily: d.family,
        anchorText: matched,
        exactSourceText: sent,
        exactReplacementText: replacement,
        paragraphIndex: i,
        paragraphExcerpt: para.slice(0, 200),
        relationship: rel,
        ownershipReason: `Destination "${d.label}" owns the exact phrase "${matched}" (its page H1/title); the source mentions it in body copy without linking it.`,
        wixInstructions: `Wix CMS → open the source page body → find the sentence "${sent.slice(0, 90)}${sent.length > 90 ? "…" : ""}" → highlight "${matched}" → click Link → paste ${d.canonicalUrl}`,
      };
    }
  }
  return null;
}
