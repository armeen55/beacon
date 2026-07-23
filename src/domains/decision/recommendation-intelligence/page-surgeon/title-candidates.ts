/**
 * Page Surgeon — TITLE candidate generator (W1a).
 *
 * Enumerates plausible title STRATEGIES from the evidence packet. It NEVER
 * picks a winner and encodes NO preference ("brand good/bad", "query always
 * wins" are forbidden) — the scorer + gate decide. Brand text comes from the
 * tenant's configured/ inferred name passed in by the caller; this module has
 * no tenant literals.
 *
 * Pure. Deterministic. No I/O.
 */

import type {
  CandidateOption,
  EvidencePacket,
  BrandSuffixDecision,
} from "./contract";
import { tokenSet } from "./contract";

export type BrandConfig = { separator: string; suffix: string } | null;

const STOP = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "with", "by",
  "is", "are", "your", "you", "best", "top", "guide", "list",
]);

/** Title-case a short label (keeps existing all-caps acronyms intact-ish). */
function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Strip a known brand suffix tail from a title, if present. */
function stripBrand(title: string, brand: BrandConfig): string {
  if (!brand) return title.trim();
  const sep = brand.separator;
  const idx = title.toLowerCase().lastIndexOf(
    (sep + brand.suffix).toLowerCase(),
  );
  return idx >= 0 ? title.slice(0, idx).trim() : title.trim();
}

/** The "descriptive tail": meaningful words in the current title that are NOT
 *  part of the query, NOT stopwords, and NOT the tenant's own boilerplate/chrome
 *  — the intent-bearing extras like "with meanings", "history". Capped so a
 *  deterministic candidate never becomes a word-salad of leftover tokens
 *  (coherent multi-part composition is the LLM judge's job). Original order. */
function descriptiveExtras(
  currentBase: string,
  query: string,
  boilerplate: Set<string>,
  cap = 2,
): string[] {
  const q = tokenSet(query);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of currentBase.split(/\s+/)) {
    const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm.length === 0) continue;
    if (q.has(norm) || STOP.has(norm) || boilerplate.has(norm) || seen.has(norm))
      continue;
    // Drop pure-number/short fragments ("15", "2026", "bce") — not coherent
    // standalone title words; the LLM judge can reintroduce them with grammar.
    if (/^[0-9]+$/.test(norm) || norm.length <= 2) continue;
    seen.add(norm);
    out.push(raw);
    if (out.length >= cap) break;
  }
  return out;
}

function termsDelta(
  fromTitle: string | null,
  toTitle: string | null,
): { preserved: string[]; removed: string[] } {
  const from = fromTitle ? fromTitle.split(/\s+/).filter(Boolean) : [];
  const toSet = tokenSet(toTitle);
  const preserved: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const w of from) {
    const norm = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm.length === 0 || STOP.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    (toSet.has(norm) ? preserved : removed).push(w);
  }
  return { preserved, removed };
}

function mk(
  strategy: string,
  proposedText: string | null,
  currentTitle: string | null,
  brandSuffixDecision: BrandSuffixDecision,
  rationaleSeed: string,
): CandidateOption {
  const { preserved, removed } =
    proposedText == null
      ? { preserved: [], removed: [] }
      : termsDelta(currentTitle, proposedText);
  return {
    id: `title::${strategy}`,
    strategy,
    proposedText,
    preservedTerms: preserved,
    removedTerms: removed,
    brandSuffixDecision,
    rationaleSeed,
  };
}

/**
 * Generate the title candidate set for a page from its evidence packet.
 * Emits each strategy ONLY when the evidence makes it plausible; dedupes
 * identical proposed texts. `keep_current` is always present (the baseline the
 * scorer must beat). No winner is chosen here.
 */
export function generateTitleCandidates(
  packet: EvidencePacket,
  brand: BrandConfig,
): CandidateOption[] {
  const currentTitle = packet.current.currentText?.trim() || null;
  const currentBase = currentTitle ? stripBrand(currentTitle, brand) : "";
  const topQuery = packet.gsc?.topQueries?.[0]?.query?.trim() ?? "";
  const queryTitle = topQuery.length > 0 ? titleCase(topQuery) : "";
  const boilerplate = new Set(
    (packet.boilerplateTerms ?? []).map((t) => t.toLowerCase()),
  );

  const out: CandidateOption[] = [];
  const pushUnique = (c: CandidateOption) => {
    const key = (c.proposedText ?? `∅:${c.strategy}`).toLowerCase();
    if (out.some((o) => (o.proposedText ?? `∅:${o.strategy}`).toLowerCase() === key))
      return;
    out.push(c);
  };

  // 1. Keep current — always on the table as the baseline to beat.
  pushUnique(
    mk(
      "keep_current",
      null,
      currentTitle,
      "neutral",
      "Baseline: leave the title unchanged.",
    ),
  );

  if (queryTitle.length > 0) {
    // 2. Query-first (no brand).
    pushUnique(
      mk(
        "query_first",
        queryTitle,
        currentTitle,
        "omit",
        `Lead with the page's top search term "${topQuery}".`,
      ),
    );

    // 6/7. Preserve vs replace the descriptive tail.
    const extras = descriptiveExtras(currentBase, topQuery, boilerplate);
    if (extras.length > 0) {
      pushUnique(
        mk(
          "preserve_descriptive_tail",
          `${queryTitle} ${extras.join(" ")}`.trim(),
          currentTitle,
          "omit",
          `Query term plus the page's existing intent words (${extras.join(", ")}).`,
        ),
      );
      pushUnique(
        mk(
          "replace_descriptive_tail",
          queryTitle,
          currentTitle,
          "omit",
          "Query term only — drop the current descriptive tail.",
        ),
      );
    }

  }

  // 4/5. Brand-suffix variants (only when a brand is configured/inferred).
  if (brand) {
    const base = queryTitle.length > 0 ? queryTitle : currentBase;
    if (base.length > 0) {
      pushUnique(
        mk(
          "with_brand_suffix",
          `${base}${brand.separator}${brand.suffix}`,
          currentTitle,
          "include",
          `Add the brand suffix "${brand.suffix}" for trust.`,
        ),
      );
      pushUnique(
        mk(
          "without_brand_suffix",
          base,
          currentTitle,
          "omit",
          "Same base without the brand suffix (saves characters for terms).",
        ),
      );
    }
  }

  // 8. Create a new page instead — only plausible when the top query is
  //    topically far from the page (handled by the scorer's page_topic_fit;
  //    we offer the option, the scorer decides if it wins).
  if (queryTitle.length > 0 && currentBase.length > 0) {
    pushUnique(
      mk(
        "create_new_page",
        null,
        currentTitle,
        "neutral",
        `If "${topQuery}" is a different topic than this page, a new page may fit better than re-titling.`,
      ),
    );
  }

  return out;
}
