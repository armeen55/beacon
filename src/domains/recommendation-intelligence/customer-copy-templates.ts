/**
 * 2026-05-19 — Slice 4.5.B.α₀ + α₁ + α₂ + Slice 4.5.C.α₀ —
 * customer-safe copy templates.
 *
 * Pure templating. LLM NEVER writes `customer_copy`. Each template
 * returns plain prose safe for customer surfaces — though α₀/α₁/α₂
 * candidates ONLY surface on the operator-only diagnostic page
 * (customer-queue flip is Slice 4.5.D), the
 * `recommendation-intelligence-customer-copy-vocab` invariant
 * scans every template for internal taxonomy, forbidden vocab
 * from Section 6 + 9, and UUID-shape strings.
 *
 * α₂ adds two count-aware templates (`duplicateTitleCopy` +
 * `duplicateMetaCopy`) that take an integer occurrenceCount.
 * Implemented with `String()` concatenation rather than
 * `${expression}` template literals so the customer-copy-vocab
 * scan stays straightforward.
 *
 * Slice 4.5.C.α₀ adds five no-arg indexability-remediation
 * templates (`fixSitemapCopy`, `fixRobotsCopy`, `fixNoindexCopy`,
 * `fixStatusCodeCopy`, `fixCanonicalCopy`) paired with the new
 * inactive registry entries. Predicates that consume them land in
 * Slice 4.5.C.α₁ / α₂.
 */

export function missingTitleCopy(): string {
  return "Add a clear page title so AI search platforms can surface this page accurately.";
}

export function missingMetaCopy(): string {
  return "Add a meta description so AI search platforms have a clean snippet to extract.";
}

export function missingH1Copy(): string {
  return "Add a clear H1 so the page anchors its main topic.";
}

export function weakH1Copy(): string {
  return "Strengthen the H1 to include the right service or location so AI search platforms can anchor the page intent.";
}

export function titleH1MismatchCopy(): string {
  return "Bring the page title and H1 into closer alignment so AI search platforms see consistent intent for this page.";
}

export function duplicateTitleCopy(occurrenceCount: number): string {
  return (
    "This page title is repeated across " +
    String(occurrenceCount) +
    " owned pages. Make each title distinct so AI search platforms can tell the pages apart."
  );
}

export function duplicateMetaCopy(occurrenceCount: number): string {
  return (
    "This meta description is repeated across " +
    String(occurrenceCount) +
    " owned pages. Tailor each description so AI search platforms see distinct snippets."
  );
}

// ── Slice 4.5.C.α₀ (2026-05-19) — indexability remediation copy ─────────
// All five are no-arg, registered inactive; predicates that emit them
// land in Slice 4.5.C.α₁ (Tier-1) and α₂ (Tier-2). Operator-locked
// phrasing — do not edit without operator approval.

export function fixSitemapCopy(): string {
  return "This URL is missing from your sitemap.xml. Add it and resubmit so AI search platforms can discover it.";
}

export function fixRobotsCopy(): string {
  return "Your robots.txt blocks this URL. Update the rule so AI search platforms and Googlebot can crawl this page.";
}

export function fixNoindexCopy(): string {
  return "This page sets a noindex meta tag. Remove it if this page should be discoverable in AI search.";
}

export function fixStatusCodeCopy(): string {
  return "This URL returns an error or redirect. Restore a clean 200 response so AI search platforms can index this page.";
}

export function fixCanonicalCopy(): string {
  return "This page's canonical URL points to a different page. Update the canonical tag if this URL is the intended primary.";
}
