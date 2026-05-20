/**
 * 2026-05-19 — Slice 4.5.B.α₀ — customer-safe copy templates.
 *
 * Pure templating. LLM NEVER writes `customer_copy`. Each template
 * returns plain prose safe for customer surfaces — though α₀
 * candidates ONLY surface on the operator-only diagnostic page
 * (customer-queue flip is Slice 4.5.D), the
 * `recommendation-intelligence-customer-copy-vocab` invariant
 * scans every template for internal taxonomy, forbidden vocab
 * from Section 6 + 9, and UUID-shape strings.
 *
 * α₁ + α₂ extend this module with additional templates as
 * predicates land.
 */

export function missingTitleCopy(): string {
  return "Add a clear page title so AI search platforms can surface this page accurately.";
}

export function missingMetaCopy(): string {
  return "Add a meta description so AI search platforms have a clean snippet to extract.";
}
