/**
 * Section-presence classifier for "Add X section" recommendations.
 *
 * Phase post-A+B1 (2026-04-20). Given a target page and a section concept
 * (the phrase inside an "Add <X> section on /path" headline), decide whether
 * the section is:
 *
 *   absent                   — not mentioned anywhere on the page we can see
 *   exists_weakly_signposted — mentioned in body/card/FAQ/title/h1/meta/
 *                              schema, but NOT as an H2 or H3 section title
 *   exists_signposted        — clearly titled as an H2 or H3 on the page
 *
 * The caller decides what to do with each state:
 *   absent                   → keep "Add X section on /path"
 *   exists_weakly_signposted → rewrite to "Strengthen the X section framing…"
 *   exists_signposted        → suppress
 *
 * Design rules (operator-directed):
 *   - "Signposted" = H2 / H3 only. NOT title, H1, or schema entity names.
 *     Rationale: a page title/H1 mentioning the concept doesn't mean there
 *     is already a section for it; schema entity names aren't user-visible
 *     section framing. We specifically want Beacon to handle the case:
 *     "the concept exists, but the H2 should probably change."
 *   - Everything except H2/H3 counts as "substance." Body text, card text,
 *     FAQ questions, meta description, title, H1, schema entity names —
 *     these show substance without signposting.
 *   - Reuses `containsConcept` from 3A's text-normalize helpers. Contiguous-
 *     subsequence match with singular/plural fold. No semantic stretching.
 *   - Empty/1-token concepts skip classification ("unknown" state — caller
 *     should keep the rec unchanged).
 */

import { containsConcept, tokenizeForMatch } from "@/lib/text-normalize";

export type SectionPresence =
  | "absent"
  | "exists_weakly_signposted"
  | "exists_signposted"
  | "unknown";

export type SectionPresenceInput = {
  /** Fields the classifier reads. All optional; absent fields are skipped. */
  h2_list?: string[] | null;
  h3_list?: string[] | null;
  title?: string | null;
  h1?: string | null;
  meta_description?: string | null;
  body_paragraph_sample?: string[] | null;
  card_texts?: string[] | null;
  schema_entity_names?: string[] | null;
  faqs?: { question: string }[] | null;
};

export type SectionPresenceResult = {
  state: SectionPresence;
  /** The first field where the concept was found (for logging). Null when
   *  state is "absent" or "unknown". */
  matchedField: string | null;
  /** The matching field's text (truncated) — included in logs only so
   *  operators can eyeball the match. */
  matchedText: string | null;
};

/** Minimum number of meaningful tokens in the concept before we classify.
 *  Empty or 1-token concepts (e.g. "The", "Section") are unfit input. */
const MIN_CONCEPT_TOKENS = 2;

function firstContains(
  fields: string[],
  concept: string,
): { index: number; text: string } | null {
  for (let i = 0; i < fields.length; i++) {
    if (containsConcept(fields[i] ?? "", concept)) {
      return { index: i, text: fields[i] };
    }
  }
  return null;
}

/**
 * Classify whether a section concept already exists on a page, and how.
 */
export function classifySectionPresence(
  page: SectionPresenceInput,
  concept: string,
): SectionPresenceResult {
  const conceptTokens = tokenizeForMatch(concept);
  if (conceptTokens.length < MIN_CONCEPT_TOKENS) {
    // 1-token concepts like "Neighborhoods" should still classify — check
    // that it's non-empty rather than requiring 2 tokens. Operator direction:
    // keep v1 simple; the existing single-token concept "Neighborhoods" is
    // the exact case we want to catch. Relax the guard to 1 token.
    if (conceptTokens.length === 0) {
      return { state: "unknown", matchedField: null, matchedText: null };
    }
  }

  // SIGNPOST FIELDS (H2/H3 only). Concept here = section is clearly titled.
  const h2 = page.h2_list ?? [];
  const h3 = page.h3_list ?? [];

  const h2Match = firstContains(h2, concept);
  if (h2Match) {
    return {
      state: "exists_signposted",
      matchedField: `h2_list[${h2Match.index}]`,
      matchedText: h2Match.text.slice(0, 120),
    };
  }
  const h3Match = firstContains(h3, concept);
  if (h3Match) {
    return {
      state: "exists_signposted",
      matchedField: `h3_list[${h3Match.index}]`,
      matchedText: h3Match.text.slice(0, 120),
    };
  }

  // SUBSTANCE FIELDS — concept appears but no H2/H3 signposts it.
  const substanceChecks: { name: string; value: string | null | undefined }[] = [
    { name: "title", value: page.title },
    { name: "h1", value: page.h1 },
    { name: "meta_description", value: page.meta_description },
  ];
  for (const check of substanceChecks) {
    if (check.value && containsConcept(check.value, concept)) {
      return {
        state: "exists_weakly_signposted",
        matchedField: check.name,
        matchedText: check.value.slice(0, 120),
      };
    }
  }

  const bodyMatch = firstContains(page.body_paragraph_sample ?? [], concept);
  if (bodyMatch) {
    return {
      state: "exists_weakly_signposted",
      matchedField: `body_paragraph_sample[${bodyMatch.index}]`,
      matchedText: bodyMatch.text.slice(0, 120),
    };
  }

  const cardMatch = firstContains(page.card_texts ?? [], concept);
  if (cardMatch) {
    return {
      state: "exists_weakly_signposted",
      matchedField: `card_texts[${cardMatch.index}]`,
      matchedText: cardMatch.text.slice(0, 120),
    };
  }

  const schemaMatch = firstContains(page.schema_entity_names ?? [], concept);
  if (schemaMatch) {
    return {
      state: "exists_weakly_signposted",
      matchedField: `schema_entity_names[${schemaMatch.index}]`,
      matchedText: schemaMatch.text.slice(0, 120),
    };
  }

  const faqTexts = (page.faqs ?? []).map((f) => f.question);
  const faqMatch = firstContains(faqTexts, concept);
  if (faqMatch) {
    return {
      state: "exists_weakly_signposted",
      matchedField: `faqs[${faqMatch.index}].question`,
      matchedText: faqMatch.text.slice(0, 120),
    };
  }

  return { state: "absent", matchedField: null, matchedText: null };
}

/**
 * Extract the section-concept phrase from an "Add X section on /path"
 * headline. Returns null when the headline doesn't match that pattern so
 * the caller can skip classification safely.
 *
 * Generic: does not hardcode specific section names.
 *
 * Supported shapes:
 *   Add neighborhoods section on /locations/atherton
 *   Add cost breakdown on /services/whole-home-remodel
 *   Add process section on /our-process
 *   Add "Custom Homes in Atherton" on /locations/atherton
 */
const ADD_SECTION_RE =
  /^Add\s+(?:"([^"]+)"|([^"]+?))(?:\s+section)?\s+on\s+(\/[^\s]+)$/i;

export function parseAddSectionHeadline(
  headline: string,
): { concept: string; path: string } | null {
  const m = headline.trim().match(ADD_SECTION_RE);
  if (!m) return null;
  const concept = (m[1] ?? m[2] ?? "").trim();
  const path = (m[3] ?? "").trim();
  if (!concept || !path) return null;
  // Reject headlines whose "concept" is another recognizable pattern we
  // shouldn't treat as a section (e.g. "FAQ schema", "structured data").
  // Narrow: just pass them through and let the classifier's concept-token
  // guard handle anything truly unfit.
  return { concept, path };
}

/**
 * Log-friendly one-liner for dogfood.
 */
export function formatSectionPresenceLog(
  concept: string,
  path: string,
  result: SectionPresenceResult,
): string {
  const matched = result.matchedField
    ? ` matched=${result.matchedField} "${(result.matchedText ?? "").replace(/"/g, "'")}"`
    : "";
  return `[section-presence] "${concept}" on ${path} \u2192 ${result.state}${matched}`;
}
