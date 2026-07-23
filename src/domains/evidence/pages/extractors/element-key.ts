/**
 * Sprint 6A.1 Phase 4 (2026-04-24) — Stable element_key helpers + display labels.
 *
 * Pure-function utilities that every extractor (Phase 6A.1.5) and every
 * provider output (Phase 6A.1.8/9 + 6A.2) must use when addressing a
 * page element. The element_key is what `page_element_inventory.element_key`
 * and `changelog_entries.target_element_key` store; attribution joins
 * across snapshots on this identifier.
 *
 * Design choices — not negotiable without re-reading this doc:
 *
 *   1. Position + content hash in one string. A rename produces a NEW
 *      key (different hash). This prevents silent attribution leaks
 *      where an operator's change to an H2 ends up cross-counted
 *      against the pre-rewrite content's time series. If the operator
 *      rewrites h2[3] "About Us" → "Why Choose Us", the stored row
 *      retires at `h2[3]:hashA` and a fresh `h2[3]:hashB` appears —
 *      attribution correctly starts a fresh window.
 *
 *   2. Whitespace normalization (trim + collapse \s+ → " ") before
 *      hashing. Prevents reformatting-only edits from burning
 *      attribution windows unnecessarily.
 *
 *   3. Case preserved. "Custom Home Builder" vs. "custom home builder"
 *      is semantically different for edit recommendations (title case
 *      is intentional signal). Hashing lowercases would lose that.
 *
 *   4. 12-char truncated hex. Full sha256 is 64 chars; 12 hex chars =
 *      48 bits of entropy. Collision probability across 4000 elements
 *      ≈ 4000² / 2·2⁴⁸ ≈ 3 × 10⁻⁸. A single Beacon tenant has low
 *      hundreds of elements per page × tens of pages — orders of
 *      magnitude below the collision threshold. Keys stay readable.
 *
 *   5. Schema paths encode structure directly. `schema_type` keys use
 *      the @type literal as identity (no content hash — "FAQPage" IS
 *      the value). `schema_property` keys encode the nested path
 *      (`schema[FAQPage].mainEntity[2].name`) AND append a content hash
 *      of the property value so a property-text edit produces a new
 *      key — consistent with positional keys' rename semantics.
 *
 *   6. "[new]" index for proposed elements. Generators that recommend
 *      ADDING a new H2/FAQ/etc. use `h2[new]:hash` — the hash
 *      disambiguates proposals when a rec suggests multiple adds of
 *      the same element_type.
 *
 * Pure functions only. No DB writes. No extractors bound here. Safe to
 * import from both server and client code.
 */

import { createHash } from "node:crypto";
import {
  EXTRACTOR_REGISTRY,
  type ElementType,
} from "./registry";

// ── Normalization + hashing ────────────────────────────────────────────────

/**
 * Canonicalize text for content hashing. Rules:
 *   - Leading + trailing whitespace removed.
 *   - Any run of whitespace (spaces, tabs, newlines, non-breaking
 *     spaces, etc.) collapsed to a single ASCII space.
 *   - Case preserved (intentional — see design note #3).
 *   - Unicode normalized to NFC so visually-identical but differently-
 *     composed strings hash identically.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Content hash: first 12 lowercase hex chars of sha256 after
 * normalization. Used in all positional / new / schema_property keys.
 */
export function contentHash(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 12);
}

// ── Key builders ───────────────────────────────────────────────────────────

/**
 * Positional key: `<elementType>[<index>]:<hash>`.
 * Used for heading, link, mention, block, and FAQ elements where
 * multiple instances can appear on a page and position matters.
 *
 *   positionalKey("h2", 3, "Architect-Led Design-Build")
 *     → "h2[3]:9d8c7b6a5f4e"
 */
export function positionalKey(
  elementType: ElementType,
  index: number,
  content: string,
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `positionalKey: index must be a non-negative integer, got ${index}`,
    );
  }
  return `${elementType}[${index}]:${contentHash(content)}`;
}

/**
 * Singleton key: positional key fixed at index 0. Used for elements
 * that appear at most once per page (title, meta, canonical,
 * og_title, og_desc). Equivalent to `positionalKey(type, 0, content)`.
 */
export function singletonKey(
  elementType: ElementType,
  content: string,
): string {
  return positionalKey(elementType, 0, content);
}

/**
 * New / additive key: `<elementType>[new]:<hash>`. Used when a
 * generator is proposing to ADD an element that doesn't currently
 * exist on the page. The content hash ensures multiple proposed
 * additions of the same element_type don't collide on a single
 * recommendation.
 *
 *   newElementKey("h2", "Architect-Led Design-Build")
 *     → "h2[new]:9d8c7b6a5f4e"
 */
export function newElementKey(
  elementType: ElementType,
  content: string,
): string {
  return `${elementType}[new]:${contentHash(content)}`;
}

/**
 * Schema type key: `schema[<@type>]`. Identity is the @type literal
 * itself; no content hash — a page that has `@type: FAQPage` is
 * unambiguously addressed by `schema[FAQPage]`.
 *
 *   schemaTypeKey("FAQPage") → "schema[FAQPage]"
 */
export function schemaTypeKey(schemaType: string): string {
  return `schema[${schemaType}]`;
}

/**
 * Schema property key:
 *   `schema[<@type>].<segment>.<segment>…:<hash>`.
 * Path segments use `.name` for object properties and `[N]` for array
 * indices. Content hash appended for rename semantics (a property-
 * value edit produces a new key, matching positional keys).
 *
 *   schemaPropertyKey("FAQPage", ["mainEntity", 2, "name"], "How long does a custom home take?")
 *     → "schema[FAQPage].mainEntity[2].name:3d4e5f6a7b8c"
 *
 *   schemaPropertyKey("LocalBusiness", ["address", "streetAddress"], "456 Main St")
 *     → "schema[LocalBusiness].address.streetAddress:<hash>"
 */
export function schemaPropertyKey(
  schemaType: string,
  pathSegments: Array<string | number>,
  value: string,
): string {
  if (pathSegments.length === 0) {
    throw new Error(
      "schemaPropertyKey: pathSegments must be non-empty — use schemaTypeKey for @type-only identity",
    );
  }
  const pathStr = pathSegments
    .map((seg) =>
      typeof seg === "number" ? `[${seg}]` : `.${seg}`,
    )
    .join("");
  return `schema[${schemaType}]${pathStr}:${contentHash(value)}`;
}

// ── Display labels ─────────────────────────────────────────────────────────

/**
 * Operator-facing label for an element. Reads the registry's
 * `operatorLabel` and appends a position marker + a truncated content
 * preview where appropriate. Kept intentionally short for UI badges.
 *
 * Examples:
 *   displayLabel({ elementType: "title", content: "Ritz Builders — Custom Home Builder Bay Area" })
 *     → 'Title tag: "Ritz Builders — Custom Home Builder Bay Area"'
 *
 *   displayLabel({ elementType: "h2", position: 3, content: "What Defines a Custom Home Builder" })
 *     → 'H2 heading #4: "What Defines a Custom Home Builder"'
 *
 *   displayLabel({ elementType: "h2", position: "new", content: "Architect-Led Design-Build" })
 *     → 'H2 heading (new): "Architect-Led Design-Build"'
 *
 *   displayLabel({ elementType: "schema_type", content: "FAQPage" })
 *     → 'Schema @type: FAQPage'
 */
export function displayLabel(options: {
  elementType: ElementType;
  /** The element's content / value. Optional for page-level edits that
   *  don't target a specific existing element (e.g. `create_page`). */
  content?: string | null;
  /** Zero-indexed position in the page; "new" for proposed additions;
   *  null for singletons and schema types. */
  position?: number | "new" | null;
}): string {
  const spec = EXTRACTOR_REGISTRY[options.elementType];
  const base = spec.operatorLabel;

  const posPart =
    options.position === "new"
      ? " (new)"
      : typeof options.position === "number"
        ? ` #${options.position + 1}` // humans count from 1
        : "";

  const content = options.content?.trim();
  const contentPart = content
    ? `: "${truncateForLabel(content, 60)}"`
    : "";

  return `${base}${posPart}${contentPart}`;
}

function truncateForLabel(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}
