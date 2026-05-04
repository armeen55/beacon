/**
 * W3 Step 3.11 (2026-05-03) — Query Fanout Audit.
 *
 * Operator scope (W3 §3.11): "We should not approve copy from vibes.
 * Show the query fanout / AI search evidence behind each generated
 * edit." Built BEFORE persisting Cupertino / Luxury so the operator
 * can review the evidence chain — not just the copy — for every
 * edit a `--from-bundle --write` would persist.
 *
 * Pure compute. No I/O, no LLM, no DB. Takes a packet + a single edit
 * and returns a structured audit:
 *
 *   - rawQueries[]              : verbatim AI-emitted search queries
 *                                 from packet.aiSearchSignal
 *   - queryFanoutCoverage       : "rich" (≥3) / "partial" (1–2) / "none"
 *   - promptSnippets[]          : packet.affectedPrompts[].promptText
 *   - normalizedIntent          : one-line buyer-intent summary
 *   - recommendedSafeAngle      : public-safe phrasing recommendation
 *   - evidenceSourcesUsed[]     : which packet blocks fed this edit
 *   - transformedTerms[]        : raw forbidden phrases → buyer-safe
 *                                 rewrites (e.g., "best luxury home
 *                                 builders" → "How to choose a luxury
 *                                 home builder")
 *   - confidence                : "fanout-backed" | "prompt-backed only"
 *                                 | "competitor-page-backed"
 *                                 | "thin evidence"
 *   - unsafePhrasings[]         : forbidden-pattern hits detected in
 *                                 the proposed text itself (the
 *                                 validator's `best_in_market` regex
 *                                 missed the Luxury H2's bare-leading
 *                                 "Best ..." — this surface catches it)
 *
 * Hard rules:
 *   1. Raw query fanouts MAY contain "best", "top", "leading" — those
 *      are real user intents. They flow into rawQueries verbatim.
 *   2. Public Ritz copy MUST NOT make those self-claims. The audit
 *      flags any unsafePhrasing in the proposed text and recommends a
 *      buyer-decision angle ("How to choose…", "What to look for…",
 *      "Questions to ask…").
 *   3. When `topSearchQueries` is empty, `queryFanoutCoverage` is
 *      "none" — never invented. Confidence falls to prompt-backed,
 *      competitor-page-backed, or "thin evidence".
 *   4. Same packet + same edit → same audit (deterministic).
 *
 * The audit is observational. It does NOT mutate the edit; the
 * operator reads it and decides whether to persist, hand-edit the
 * saved bundle, or skip.
 */

import type { SpecificEdit } from "./specific-edit-provider";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryFanoutCoverage = "rich" | "partial" | "none";

export type EvidenceSource =
  | "query_fanout"
  | "prompt_text"
  | "descriptor_window"
  | "competitor_co_mention"
  | "competitor_page_blueprint"
  | "citation_evidence"
  | "owned_page"
  | "site_inventory";

export type AuditConfidence =
  | "fanout-backed"
  | "prompt-backed only"
  | "competitor-page-backed"
  | "thin evidence";

export type RawQueryRow = {
  query: string;
  count: number;
  promptIds: string[];
  platforms: string[];
};

export type TransformedTerm = {
  /** Verbatim phrase from the AI fanout that contains a forbidden modifier. */
  rawPhrase: string;
  /** Public-safe rewrite that keeps the buyer-decision intent. */
  publicCopyPhrase: string;
  /** Why the rewrite is safer (e.g., "buyer-decision angle, no self-claim"). */
  reason: string;
};

export type QueryFanoutAudit = {
  /** Compact summary of the proposed edit (no raw JSON). */
  proposedEdit: {
    actionType: string;
    targetUrl: string;
    elementKey: string;
    displayLabel: string;
    proposedText: string;
  };
  /** Verbatim AI-emitted queries from packet.aiSearchSignal.topSearchQueries. */
  rawQueries: RawQueryRow[];
  /** "rich" >=3, "partial" 1–2, "none" 0. Drives confidence. */
  queryFanoutCoverage: QueryFanoutCoverage;
  /** Prompt-text snippets relevant to this edit (capped). */
  promptSnippets: string[];
  /** One-line buyer-intent description, with superlatives stripped. */
  normalizedIntent: string;
  /** Public-safe phrasing recommendation (no superlatives). */
  recommendedSafeAngle: string;
  /** Which packet blocks contributed evidence for this edit. */
  evidenceSourcesUsed: EvidenceSource[];
  /** For each forbidden raw query, a buyer-safe transformation. */
  transformedTerms: TransformedTerm[];
  /** "fanout-backed" / "prompt-backed only" / "competitor-page-backed" / "thin evidence". */
  confidence: AuditConfidence;
  /** Forbidden-pattern hits detected inside the proposed text itself. */
  unsafePhrasings: string[];
};

// ---------------------------------------------------------------------------
// Forbidden-modifier vocabulary
//
// Raw-query side:  these may APPEAR in fanout queries (real user intent).
// Public-copy side: these MAY NOT appear in proposed Ritz copy.
// ---------------------------------------------------------------------------

const FORBIDDEN_MODIFIERS: readonly string[] = [
  "best",
  "top",
  "top-rated",
  "leading",
  "premier",
  "elite",
  "highest-rated",
  "most trusted",
  "most popular",
  "frequently recommended",
  "award-winning",
  "#1",
] as const;

// Geos commonly seen in Ritz fanout. Detected so transformations can
// emit "in the Bay Area" / "in Cupertino" instead of awkward trailing
// tokens. `articled: true` ⇒ "in the {Geo}" (regions, areas);
// `articled: false` ⇒ "in {Geo}" (cities, towns).  The list stays
// Ritz-leaning today (single-tenant); generalize when a second tenant
// ships.
const KNOWN_GEO_TOKENS: ReadonlyArray<{
  pattern: RegExp;
  canonical: string;
  articled: boolean;
}> = [
  { pattern: /\bbay area\b/i, canonical: "Bay Area", articled: true },
  { pattern: /\bsilicon valley\b/i, canonical: "Silicon Valley", articled: false },
  { pattern: /\bsan francisco\b/i, canonical: "San Francisco", articled: false },
  { pattern: /\bpalo alto\b/i, canonical: "Palo Alto", articled: false },
  { pattern: /\bmenlo park\b/i, canonical: "Menlo Park", articled: false },
  { pattern: /\blos altos\b/i, canonical: "Los Altos", articled: false },
  { pattern: /\bmountain view\b/i, canonical: "Mountain View", articled: false },
  { pattern: /\batherton\b/i, canonical: "Atherton", articled: false },
  { pattern: /\bcupertino\b/i, canonical: "Cupertino", articled: false },
  { pattern: /\bsaratoga\b/i, canonical: "Saratoga", articled: false },
  { pattern: /\bwoodside\b/i, canonical: "Woodside", articled: false },
  { pattern: /\bportola valley\b/i, canonical: "Portola Valley", articled: false },
];

const MAX_PROMPT_SNIPPETS = 5;
const PROMPT_SNIPPET_MAX_CHARS = 140;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildQueryFanoutAudit(
  packet: SpecificEditEvidencePacket,
  edit: SpecificEdit,
): QueryFanoutAudit {
  const proposedText = edit.targetElement?.proposedText ?? "";

  // 1. Raw queries — verbatim from the packet, sorted as the packet
  //    already sorted them (count desc, query asc).
  const rawQueries: RawQueryRow[] = packet.aiSearchSignal.topSearchQueries.map(
    (q) => ({
      query: q.query,
      count: q.count,
      promptIds: [...q.promptIds],
      platforms: [...q.platforms],
    }),
  );

  // 2. Coverage tier.
  const queryFanoutCoverage: QueryFanoutCoverage =
    rawQueries.length >= 3 ? "rich" : rawQueries.length > 0 ? "partial" : "none";

  // 3. Prompt snippets — every affectedPrompt's text, capped + trimmed.
  //    The edit's evidence array sometimes anchors to a single
  //    promptId; we surface ALL affected prompts so the operator can
  //    see the full cluster context, not just the cited one.
  const promptSnippets: string[] = [];
  for (const p of packet.affectedPrompts) {
    if (promptSnippets.length >= MAX_PROMPT_SNIPPETS) break;
    const t = (p.promptText ?? "").trim();
    if (t.length === 0) continue;
    promptSnippets.push(
      t.length > PROMPT_SNIPPET_MAX_CHARS
        ? `${t.slice(0, PROMPT_SNIPPET_MAX_CHARS - 1).trim()}…`
        : t,
    );
  }

  // 4. Transformed terms — for every raw query that contains a
  //    forbidden modifier, propose a buyer-decision rewrite.
  const transformedTerms: TransformedTerm[] = [];
  for (const r of rawQueries) {
    const t = transformForbiddenQueryToBuyerAngle(r.query);
    if (t) transformedTerms.push(t);
  }

  // 5. Normalized intent — strip superlatives off the top query (if
  //    any) and present as a buyer-search summary. Falls back to the
  //    top prompt snippet when the fanout is empty.
  const normalizedIntent = deriveNormalizedIntent(rawQueries, promptSnippets);

  // 6. Recommended safe angle — first transformed term, or "mirror
  //    top fanout query" if no transforms, or prompt-only / abstain.
  const recommendedSafeAngle = deriveRecommendedSafeAngle(
    transformedTerms,
    rawQueries,
    promptSnippets,
    packet.competitorPageBlueprints.length,
  );

  // 7. Evidence sources used — derived from packet blocks + the edit's
  //    evidence refs.
  const evidenceSourcesUsed = deriveEvidenceSources(packet, edit);

  // 8. Confidence tier.
  const confidence = deriveAuditConfidence({
    fanoutSize: rawQueries.length,
    promptCount: promptSnippets.length,
    blueprintCount: packet.competitorPageBlueprints.length,
  });

  // 9. Unsafe phrasings — flag any forbidden patterns the validator
  //    might have missed in the proposed text. The validator's
  //    `best_in_market` regex caught "the best luxury home builders"
  //    on the Luxury FAQ Q but missed the H2's bare-leading
  //    "Best luxury custom home builders". This surface catches both.
  const unsafePhrasings = detectUnsafePhrasings(proposedText);

  return {
    proposedEdit: {
      actionType: edit.actionType,
      targetUrl: edit.targetUrl,
      elementKey: edit.targetElement?.elementKey ?? "(page-level)",
      displayLabel: edit.targetElement?.displayLabel ?? "(page-level)",
      proposedText,
    },
    rawQueries,
    queryFanoutCoverage,
    promptSnippets,
    normalizedIntent,
    recommendedSafeAngle,
    evidenceSourcesUsed,
    transformedTerms,
    confidence,
    unsafePhrasings,
  };
}

// ---------------------------------------------------------------------------
// Internals — deterministic, side-effect free
// ---------------------------------------------------------------------------

/**
 * Public: scan a string for forbidden public-copy patterns. Exported
 * so the runner script + tests can reuse it. The patterns are
 * deliberately broader than the brand-claim validator's
 * `best_in_market` regex — this is a SECONDARY surface catching what
 * the validator missed.
 */
export function detectUnsafePhrasings(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const hits: string[] = [];
  const trimmed = text.trim();

  // 1. Leading-superlative H2 / heading patterns. The Luxury H2 reads
  //    "Best luxury custom home builders in the Bay Area\n\n..." — the
  //    validator's subject-of-sentence regex doesn't fire on a bare
  //    leading "Best ...". We catch it here.
  if (/^Best\b/i.test(trimmed)) hits.push("starts with 'Best ...'");
  if (/^Top\b/i.test(trimmed)) hits.push("starts with 'Top ...'");
  if (/^Leading\b/i.test(trimmed)) hits.push("starts with 'Leading ...'");
  if (/^Premier\b/i.test(trimmed)) hits.push("starts with 'Premier ...'");

  // 2. Inline forbidden modifiers — "award-winning", "top-rated", etc.
  const inlinePatterns: ReadonlyArray<{ regex: RegExp; label: string }> = [
    { regex: /\baward-winning\b/i, label: "'award-winning'" },
    { regex: /\btop-rated\b/i, label: "'top-rated'" },
    { regex: /\bhighest-rated\b/i, label: "'highest-rated'" },
    { regex: /\bmost trusted\b/i, label: "'most trusted'" },
    { regex: /\bmost popular\b/i, label: "'most popular'" },
    { regex: /\bfrequently recommended\b/i, label: "'frequently recommended'" },
    { regex: /\bpremier\b/i, label: "'premier'" },
    { regex: /\belite\b/i, label: "'elite'" },
    { regex: /#1\b/, label: "'#1'" },
  ];
  for (const { regex, label } of inlinePatterns) {
    if (regex.test(trimmed)) hits.push(label);
  }

  // 3. Subject-of-sentence "best X" — keeps parity with the brand
  //    validator but covers a wider noun list.
  if (
    /\bbest\s+(builder|builders|firm|firms|company|companies|contractor|contractors|home\s+builder|home\s+builders|luxury\s+home\s+builder|luxury\s+home\s+builders|custom\s+home\s+builder|custom\s+home\s+builders|remodeler|remodelers)\b/i.test(
      trimmed,
    )
  ) {
    hits.push("subject 'best builder/firm/etc.'");
  }

  // De-dupe + stable order for hash-friendly comparisons in tests.
  return [...new Set(hits)];
}

/**
 * Public: transform a single forbidden raw query into a buyer-decision
 * angle. Returns null when the query has no forbidden modifier.
 *
 * Examples:
 *   "best luxury home builders"         → "How to choose a luxury home builder"
 *   "top luxury home builders Bay Area" → "How to choose a luxury home builder in the Bay Area"
 *   "best custom home builders 2023"    → "How to choose a custom home builder"
 *   "luxury home builders"              → null  (no forbidden modifier)
 */
export function transformForbiddenQueryToBuyerAngle(
  rawQuery: string,
): TransformedTerm | null {
  if (typeof rawQuery !== "string") return null;
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) return null;

  // Match an optional leading article + a forbidden modifier + the rest.
  // Build a single alternation of forbidden modifiers, escaped, with
  // multi-word ones first so "most trusted" wins over "most" alone (we
  // don't actually have "most" in the list, but defensive ordering for
  // future additions).
  const escaped = FORBIDDEN_MODIFIERS.map((m) =>
    m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  )
    .sort((a, b) => b.length - a.length)
    .join("|");
  const re = new RegExp(
    `^\\s*(?:the\\s+|a\\s+|an\\s+)?(${escaped})\\s+(.+)$`,
    "i",
  );
  const m = trimmed.match(re);
  if (!m) return null;
  const forbidden = m[1].toLowerCase();
  let subject = m[2].toLowerCase().trim();

  // Drop trailing year tokens ("2023", "2024") — they're noise in the
  // public-safe form.
  subject = subject.replace(/\s*\b(19|20)\d{2}\b\s*$/, "").trim();

  // Singularize common plurals so the rewrite reads naturally.
  subject = subject
    .replace(/\bbuilders\b/g, "builder")
    .replace(/\bcontractors\b/g, "contractor")
    .replace(/\bremodelers\b/g, "remodeler")
    .replace(/\barchitects\b/g, "architect")
    .replace(/\bcompanies\b/g, "company")
    .replace(/\bfirms\b/g, "firm");

  // Detect a known geo and lift it out into "in {Geo}" (cities) or
  // "in the {Geo}" (regions). Cities reading "in the Cupertino" was
  // ungrammatical in early audit output.
  let geoSuffix = "";
  for (const { pattern, canonical, articled } of KNOWN_GEO_TOKENS) {
    if (pattern.test(subject)) {
      geoSuffix = articled ? ` in the ${canonical}` : ` in ${canonical}`;
      subject = subject.replace(pattern, "").trim();
      break;
    }
  }
  // Collapse residual whitespace.
  subject = subject.replace(/\s+/g, " ").trim();

  if (subject.length === 0) {
    // Edge: query was just "best builders 2023" → subject empty after
    // strip. Default to a generic buyer-decision angle.
    subject = "the right partner";
  }

  // a/an article based on subject leading vowel sound (heuristic — good
  // enough for the buyer-search vocabulary; "honest" / "hour" edge
  // cases don't show up in fanout queries).
  const article = /^[aeiou]/i.test(subject) ? "an" : "a";

  return {
    rawPhrase: trimmed,
    publicCopyPhrase: `How to choose ${article} ${subject}${geoSuffix}`,
    reason: `Strips the "${forbidden}" superlative; keeps buyer-decision intent without an unsupported self-claim.`,
  };
}

function deriveNormalizedIntent(
  rawQueries: ReadonlyArray<RawQueryRow>,
  promptSnippets: ReadonlyArray<string>,
): string {
  if (rawQueries.length > 0) {
    const top = rawQueries[0].query;
    // Strip the same forbidden modifier the transformer drops, so the
    // intent reads cleanly even when the raw query is "best ...".
    const cleaned = top
      .replace(
        /^\s*(?:the\s+|a\s+|an\s+)?(best|top|top-rated|leading|premier|elite|highest-rated|most trusted|most popular|frequently recommended|award-winning|#1)\s+/i,
        "",
      )
      .trim();
    return `Buyers searching for ${cleaned}`;
  }
  if (promptSnippets.length > 0) {
    return `Prompt-only intent: "${promptSnippets[0]}"`;
  }
  return "No fanout, no prompt evidence — abstain";
}

function deriveRecommendedSafeAngle(
  transformedTerms: ReadonlyArray<TransformedTerm>,
  rawQueries: ReadonlyArray<RawQueryRow>,
  promptSnippets: ReadonlyArray<string>,
  blueprintCount: number,
): string {
  if (transformedTerms.length > 0) return transformedTerms[0].publicCopyPhrase;
  if (rawQueries.length > 0) {
    return `Mirror top fanout phrasing: "${rawQueries[0].query}"`;
  }
  if (blueprintCount > 0 && promptSnippets.length > 0) {
    return "Lean on competitor-page structure + prompt intent; keep copy buyer-neutral.";
  }
  if (promptSnippets.length > 0) {
    return `Prompt-only — anchor to: "${promptSnippets[0]}"`;
  }
  return "Insufficient evidence — abstain (do not generate or persist).";
}

function deriveEvidenceSources(
  packet: SpecificEditEvidencePacket,
  edit: SpecificEdit,
): EvidenceSource[] {
  const out = new Set<EvidenceSource>();

  if (packet.aiSearchSignal.topSearchQueries.length > 0) out.add("query_fanout");
  if (packet.aiSearchSignal.topDescriptors.length > 0)
    out.add("descriptor_window");
  if (packet.aiSearchSignal.topCompetitorCoMentions.length > 0)
    out.add("competitor_co_mention");
  if (packet.competitorPageBlueprints.length > 0) {
    out.add("competitor_page_blueprint");
    out.add("citation_evidence");
  }
  if (packet.affectedPrompts.length > 0) out.add("prompt_text");
  if (packet.targetPageElements.length > 0) out.add("site_inventory");

  // Walk the edit's own evidence refs — these are what the generator
  // explicitly cited as the basis for THIS edit.
  for (const ref of edit.evidence) {
    if (ref.type === "owned_page") out.add("owned_page");
    if (ref.type === "element") out.add("site_inventory");
    if (ref.type === "competitor") out.add("competitor_co_mention");
    if (ref.type === "prompt") out.add("prompt_text");
  }

  // Stable order for tests.
  const ORDER: EvidenceSource[] = [
    "query_fanout",
    "prompt_text",
    "descriptor_window",
    "competitor_co_mention",
    "competitor_page_blueprint",
    "citation_evidence",
    "owned_page",
    "site_inventory",
  ];
  return ORDER.filter((s) => out.has(s));
}

function deriveAuditConfidence(args: {
  fanoutSize: number;
  promptCount: number;
  blueprintCount: number;
}): AuditConfidence {
  if (args.fanoutSize >= 1) return "fanout-backed";
  if (args.blueprintCount >= 1) return "competitor-page-backed";
  if (args.promptCount >= 1) return "prompt-backed only";
  return "thin evidence";
}
