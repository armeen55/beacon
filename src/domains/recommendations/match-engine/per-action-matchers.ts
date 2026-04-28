/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * Per-action-type matchers. Each function takes a `RecommendedEditRow`
 * + the relevant inventory slice and returns a `MatchResult`.
 *
 * ALL FUNCTIONS ARE PURE. No I/O, no mutation of inputs, no global
 * state, deterministic for fixed inputs.
 *
 * Spec: `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §3.2.
 */

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { ElementType } from "@/domains/pages/extractors/registry";
import type { RecommendedEditRow } from "../recommended-edits-persistence";
import {
  ACTION_THRESHOLDS,
  type MatchResult,
  type OtherUrlInventory,
} from "./types";
import { normalizeText, normalizeTextBoth } from "./normalize-text";
import { similarity } from "./similarity";

// ── URL path comparison ───────────────────────────────────────────────────

/**
 * Compare two URLs at path-only granularity (matches Phase 0 spec §3.4
 * wrong-page guard). Strips protocol + host + trailing slash, lowercases.
 * Pure.
 */
export function pathMatches(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(u: string): string {
  return u
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// ── Helpers shared across matchers ────────────────────────────────────────

/**
 * Filter inventory to a single element_type. Returns a NEW array;
 * caller must not mutate.
 */
function filterByType(
  inventory: ReadonlyArray<PageElementInventoryRow>,
  type: ElementType,
): PageElementInventoryRow[] {
  return inventory.filter((r) => r.element_type === type);
}

/**
 * Score a candidate inventory row against the proposed text. Computes
 * both exact (case-preserving) equality and folded similarity in one
 * pass to avoid double-normalization.
 *
 * Returns null when the row has no element_text to score.
 */
type Scored = {
  row: PageElementInventoryRow;
  exactMatch: boolean;
  similarity: number;
};

function scoreCandidate(
  row: PageElementInventoryRow,
  proposedExact: string,
  proposedFolded: string,
): Scored | null {
  if (row.element_text === null) return null;
  const cur = normalizeTextBoth(row.element_text);
  const exactMatch = cur.exact === proposedExact;
  const sim = exactMatch ? 1 : similarity(cur.folded, proposedFolded);
  return { row, exactMatch, similarity: sim };
}

/**
 * Pick the highest-scoring candidate. Ties broken by exactMatch first,
 * then by inventory order (stable). Returns undefined for empty input.
 */
function pickBest(scored: ReadonlyArray<Scored>): Scored | undefined {
  if (scored.length === 0) return undefined;
  let best = scored[0]!;
  for (let i = 1; i < scored.length; i++) {
    const c = scored[i]!;
    if (c.similarity > best.similarity) best = c;
    else if (c.similarity === best.similarity && c.exactMatch && !best.exactMatch)
      best = c;
  }
  return best;
}

// ── Singleton matcher (title / meta / h1) ─────────────────────────────────

export function matchSingleton(
  edit: RecommendedEditRow,
  currentInventory: ReadonlyArray<PageElementInventoryRow>,
  elementType: "title" | "meta" | "h1",
): MatchResult {
  const proposed = edit.proposed_text;
  if (proposed === null) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "none",
      reason: "edit has no proposed_text",
    };
  }
  const candidates = filterByType(currentInventory, elementType);
  // Singleton — there should be 0 or 1, but defensively pick the best.
  const { exact: pExact, folded: pFolded } = normalizeTextBoth(proposed);
  const scored: Scored[] = [];
  for (const row of candidates) {
    const s = scoreCandidate(row, pExact, pFolded);
    if (s !== null) scored.push(s);
  }
  const best = pickBest(scored);
  return interpretBest(best, edit.action_type);
}

// ── Positional-new matcher (h2 / faq leg / internal_link) ─────────────────

export function matchPositional(
  edit: RecommendedEditRow,
  currentInventory: ReadonlyArray<PageElementInventoryRow>,
  elementType: ElementType,
  options?: {
    otherUrlInventories?: ReadonlyArray<OtherUrlInventory>;
    /**
     * Recommendation Lifecycle OS — Phase 2 add-on (2026-04-27).
     *
     * Optional pure transform applied to `edit.proposed_text` BEFORE
     * scoring. Default = identity (no behavior change). Used ONLY by
     * the H2 dispatch in `index.ts` to extract the first non-empty
     * line as the heading candidate when the generator's
     * `proposed_text` concatenates heading + body paragraph.
     *
     * Applies to BOTH the target-URL scoring AND the off-target
     * wrong-page check (same `pExact`/`pFolded` derivation), so
     * wrong-page detection works correctly with multi-line proposed
     * text too.
     *
     * `edit.proposed_text` itself is never mutated — only the local
     * scoring derivative changes. Surfaces / UI / reporting paths see
     * the original full text unchanged.
     */
    proposedTextTransform?: (text: string) => string;
  },
): MatchResult {
  const proposed = edit.proposed_text;
  if (proposed === null) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "none",
      reason: "edit has no proposed_text",
    };
  }
  const proposedForMatch = options?.proposedTextTransform
    ? options.proposedTextTransform(proposed)
    : proposed;
  const { exact: pExact, folded: pFolded } = normalizeTextBoth(proposedForMatch);
  const candidates = filterByType(currentInventory, elementType);
  const scored: Scored[] = [];
  for (const row of candidates) {
    const s = scoreCandidate(row, pExact, pFolded);
    if (s !== null) scored.push(s);
  }
  const best = pickBest(scored);
  const interpreted = interpretBest(best, edit.action_type);
  if (interpreted.outcome !== "not_found") return interpreted;

  // Wrong-page detection: the engine ONLY consults other URLs when the
  // target URL produced no match at all. A match on the target URL —
  // even MEDIUM — wins over any other-URL hit.
  if (!options?.otherUrlInventories) return interpreted;
  for (const other of options.otherUrlInventories) {
    if (pathMatches(other.url, edit.target_url)) continue; // skip same-URL aliases
    const otherCandidates = filterByType(other.rows, elementType);
    for (const row of otherCandidates) {
      const s = scoreCandidate(row, pExact, pFolded);
      if (s === null) continue;
      // Wrong-page only when the OFF-PAGE match would itself be HIGH
      // (modified-or-better). Otherwise it's likely a coincidental
      // similarity and we report not_found cleanly.
      const threshold = thresholdsFor(edit.action_type).modified;
      if (s.exactMatch || s.similarity >= threshold) {
        return {
          outcome: "wrong_page",
          confidence: "low",
          kind: "wrong_page",
          similarity: s.similarity,
          matchedElementKey: s.row.element_key,
          matchedElementText: s.row.element_text ?? undefined,
          matchedUrl: other.url,
          reason: `text matched on ${other.url}, not target ${edit.target_url}`,
        };
      }
    }
  }
  return interpreted;
}

// ── Schema-type matcher ───────────────────────────────────────────────────

/**
 * For `add_schema` / `fix_schema` action types. The generators encode
 * the target schema type (e.g. "FAQPage", "BreadcrumbList") into
 * `proposed_text` or `display_label`. Match if any current
 * `schema_type` element's text contains the target type (exact or
 * suffix match).
 *
 * Intentionally simple in v1. The richer 5-rung ladder in
 * `match-schema-experiment.ts` operates on a different schema (changelog
 * entries vs scan deltas) — we don't import it here to keep the engine
 * pure and self-contained. A future phase can reconcile.
 */
export function matchSchemaType(
  edit: RecommendedEditRow,
  currentInventory: ReadonlyArray<PageElementInventoryRow>,
): MatchResult {
  const target = (edit.proposed_text ?? edit.display_label ?? "").trim();
  if (target.length === 0) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "none",
      reason: "edit has no proposed schema type",
    };
  }
  const targetFolded = normalizeText(target, { lowercase: true });
  const candidates = filterByType(currentInventory, "schema_type");
  for (const row of candidates) {
    if (row.element_text === null) continue;
    const cur = normalizeText(row.element_text, { lowercase: true });
    // Exact OR suffix-match (e.g. proposed "FAQPage" finds element_text "schema:FAQPage").
    if (cur === targetFolded || cur.endsWith(targetFolded)) {
      return {
        outcome: "verified_live",
        confidence: "high",
        kind: "exact",
        similarity: 1,
        matchedElementKey: row.element_key,
        matchedElementText: row.element_text,
      };
    }
  }
  return {
    outcome: "not_found",
    confidence: "low",
    kind: "none",
    reason: `schema type "${target}" not found in current snapshot`,
  };
}

// ── Internal-link matcher ─────────────────────────────────────────────────

/**
 * Link matching trades on TWO signals: anchor text (`element_text`) and
 * href (`element_metadata.href`). v1 contract:
 *
 *   HIGH (exact)    — anchor exact AND href exact (case-insensitive path)
 *   HIGH (modified) — anchor exact OR href exact (one signal suffices)
 *   MEDIUM          — anchor similarity ≥ medium threshold AND href differs
 *   LOW             — neither signal matches
 *
 * The `proposed_text` carries the anchor; the proposed href is encoded
 * in `display_label` as `"anchor → href"` by current generators, OR may
 * be omitted (anchor-only edit). When href is unknown, fall back to
 * anchor-only matching (singleton-style scoring).
 */
export function matchInternalLink(
  edit: RecommendedEditRow,
  currentInventory: ReadonlyArray<PageElementInventoryRow>,
): MatchResult {
  const proposedAnchor = edit.proposed_text;
  if (proposedAnchor === null) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "none",
      reason: "edit has no proposed anchor text",
    };
  }
  const proposedHref = extractHrefHint(edit);
  const { exact: pExact, folded: pFolded } = normalizeTextBoth(proposedAnchor);
  const links = filterByType(currentInventory, "internal_link");

  let bestAnchor: Scored | undefined;
  let exactPair: PageElementInventoryRow | undefined;
  let anchorOrHrefMatch: PageElementInventoryRow | undefined;

  for (const row of links) {
    const score = scoreCandidate(row, pExact, pFolded);
    if (score !== null) {
      if (!bestAnchor || score.similarity > bestAnchor.similarity)
        bestAnchor = score;
    }
    const rowHref = readHref(row);
    const hrefMatch =
      proposedHref !== null && rowHref !== null && hrefEquals(rowHref, proposedHref);
    const anchorMatch = score?.exactMatch === true;
    if (anchorMatch && hrefMatch) exactPair = row;
    if (anchorMatch || hrefMatch) anchorOrHrefMatch ??= row;
  }

  if (exactPair) {
    return {
      outcome: "verified_live",
      confidence: "high",
      kind: "exact",
      similarity: 1,
      matchedElementKey: exactPair.element_key,
      matchedElementText: exactPair.element_text ?? undefined,
    };
  }
  if (anchorOrHrefMatch) {
    return {
      outcome: "verified_live_modified",
      confidence: "high",
      kind: "modified",
      similarity: bestAnchor?.similarity ?? 1,
      matchedElementKey: anchorOrHrefMatch.element_key,
      matchedElementText: anchorOrHrefMatch.element_text ?? undefined,
      reason:
        "one of (anchor, href) matched exactly; the other differs or is unknown",
    };
  }
  // Anchor-only fuzzy fallback.
  return interpretBest(bestAnchor, edit.action_type);
}

function extractHrefHint(edit: RecommendedEditRow): string | null {
  // Generators may encode the href in `display_label` as "anchor → href"
  // or "anchor (href)" or just include it in evidence_metadata. Keep the
  // extractor permissive — undetected href just degrades to anchor-only.
  const candidates = [
    edit.display_label ?? "",
    edit.measurement_plan ?? "",
  ];
  for (const c of candidates) {
    const arrow = c.match(/(?:→|->)\s*(\S+)/);
    if (arrow) return arrow[1]!;
    const paren = c.match(/\((\/?[^)]+)\)/);
    if (paren && (paren[1]!.startsWith("/") || /^https?:/i.test(paren[1]!)))
      return paren[1]!;
  }
  return null;
}

function readHref(row: PageElementInventoryRow): string | null {
  const meta = row.element_metadata as { href?: unknown } | undefined;
  if (!meta || typeof meta.href !== "string") return null;
  return meta.href;
}

function hrefEquals(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

// ── Shared: turn a scored candidate into a MatchResult ────────────────────

function thresholdsFor(actionType: string) {
  return ACTION_THRESHOLDS[actionType] ?? { modified: 0.85, medium: 0.5 };
}

function interpretBest(
  best: Scored | undefined,
  actionType: string,
): MatchResult {
  if (!best) {
    return {
      outcome: "not_found",
      confidence: "low",
      kind: "none",
      reason: "no candidate elements of the matching type in inventory",
    };
  }
  const t = thresholdsFor(actionType);
  if (best.exactMatch) {
    return {
      outcome: "verified_live",
      confidence: "high",
      kind: "exact",
      similarity: 1,
      matchedElementKey: best.row.element_key,
      matchedElementText: best.row.element_text ?? undefined,
    };
  }
  if (best.similarity >= t.modified) {
    return {
      outcome: "verified_live_modified",
      confidence: "high",
      kind: "modified",
      similarity: best.similarity,
      matchedElementKey: best.row.element_key,
      matchedElementText: best.row.element_text ?? undefined,
    };
  }
  if (best.similarity >= t.medium) {
    return {
      outcome: "needs_review",
      confidence: "medium",
      kind: "text_only",
      similarity: best.similarity,
      matchedElementKey: best.row.element_key,
      matchedElementText: best.row.element_text ?? undefined,
      reason: "best candidate above MEDIUM threshold but below modified — operator review",
    };
  }
  return {
    outcome: "not_found",
    confidence: "low",
    kind: "none",
    similarity: best.similarity,
    reason: "best candidate similarity below MEDIUM threshold",
  };
}
