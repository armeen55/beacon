/**
 * 2026-05-19 — Slice 4.5.B.α₀ + α₁ + α₂ + Slice 4.5.C.α₀ +
 * Slice 4.5.C.α₃a + Slice 4.5.C.α₃b — customer-safe copy templates.
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

// ── Slice 4.5.C.α₃a (2026-05-20) — internal-linking copy ─────────────────
// Operator-locked phrasing — do not edit without operator approval.

export function addInternalLinkCopy(): string {
  return "This page has no internal links pointing to it from elsewhere on your site. Add links from related hub or detail pages so AI search platforms can discover it.";
}

// ── Slice 4.5.C.α₃b (2026-05-20) — structured-data copy ──────────────────
// Operator-locked phrasing — do not edit without operator approval.

export function addSchemaCopy(): string {
  return "Add structured data so AI search platforms can extract this page's purpose more reliably.";
}

// ── Slice 4.5.E.α₁a (2026-05-21) — H2 rewrite copy ───────────────────────
// Operator-locked phrasing — do not edit without operator approval.
// Paired with the new `weak-h2` trigger predicate which emits
// `rewrite_h2` candidates at `confidence: "low"` (routes to
// diagnostic_only via applyQueueRules — never to customer queue
// without operator validation). LLM-drafted replacement text
// lands in a later α₁b slice via the operator-only LLM gateway.

export function rewriteH2Copy(): string {
  return "Rewrite this H2 to include the page's target topic so AI search platforms can understand the section more clearly.";
}

// ── Night-shift #43 (2026-06-11) — merge-pages copy ──────────────────────
// Diagnostic-only trigger (thin_content_overlap); plain English, no
// jargon. Operator-locked phrasing — do not edit without approval.

export function mergePagesCopy(): string {
  return "This short page covers nearly the same topic as another page on your site. Folding them into one stronger page usually earns more AI citations than two thin ones.";
}

// ── Night-shift #44 (2026-06-11) — stale-content copy ────────────────────
// Diagnostic-only trigger (stale_content); operator-locked phrasing.

export function staleContentCopy(): string {
  return "This page hasn't changed in a long time. A refreshed intro with current facts makes it far more quotable for AI search platforms.";
}

// ── fix_schema slice (2026-06-12) — structured-data repair copy ──────────

export function fixSchemaCopy(): string {
  return "This page's structured data has errors AI search platforms will reject. Repair it so the page is read correctly.";
}

// ── Insight Graph slice 1 (2026-06-12) — GSC low-CTR copy ────────────────

export function gscLowCtrCopy(query: string, impressions: number): string {
  return (
    "People searched “" +
    query +
    "” " +
    impressions.toLocaleString("en-US") +
    " times in the last 4 weeks and saw this page — but few clicked it. A clearer title can win those clicks."
  );
}

// ── Insight Graph slice 2 (2026-06-12) — striking-distance copy ──────────

export function strikingDistanceCopy(
  keyword: string,
  position: number,
  volume: number,
): string {
  return (
    "This page already ranks #" +
    position +
    " in Google for “" +
    keyword +
    "” — searched about " +
    volume.toLocaleString("en-US") +
    " times a month. A focused title update can lift it into the results people actually click."
  );
}

// ── Rule B (2026-06-12) — first-party striking-distance copy ─────────────

export function gscStrikingDistanceCopy(
  query: string,
  position: number,
  impressions: number,
): string {
  return (
    "Google already shows this page around #" +
    position +
    " when people search \u201c" +
    query +
    "\u201d \u2014 " +
    impressions.toLocaleString("en-US") +
    " times in the last 4 weeks. Naming it in the title can push it into the top results."
  );
}

// ── Decay slice (2026-06-12) — fading-page refresh copy ──────────────────

export function gscDecayCopy(dropPct: number): string {
  return (
    "This page is fading in Google — clicks are down about " +
    dropPct +
    "% versus the previous month. A content refresh usually recovers lost ground fastest."
  );
}

// ── Cannibalization slice (2026-06-12) ───────────────────────────────────

export function cannibalizationCopy(keyword: string): string {
  return (
    "Two of your pages compete in Google for \u201c" +
    keyword +
    "\u201d, splitting their strength. Pointing one at the other makes the stronger page win."
  );
}

// ── Keyword-gap slice (2026-06-12) ───────────────────────────────────────

export function internalLinkOpportunityCopy(destinationTitle: string): string {
  return (
    "Two of your pages cover the same topic, but one never points readers (or Google) to the other. Add a link to \u201c" +
    destinationTitle +
    "\u201d where the topic comes up \u2014 it helps that page get found."
  );
}

export function uncitedContentCopy(): string {
  return (
    "This in-depth page backs up none of its facts with outside sources. " +
    "AI engines favor pages that cite checkable references \u2014 adding a short sources section makes this page easier to trust and recommend."
  );
}

export function keywordGapExpandCopy(keyword: string, volume: number): string {
  return (
    "A rival already wins \u201c" +
    keyword +
    "\u201d in Google \u2014 searched about " +
    volume.toLocaleString("en-US") +
    " times a month \u2014 and you already have a page on this topic. Expanding that page with a section on it beats building a duplicate."
  );
}

export function keywordGapCopy(keyword: string, volume: number): string {
  return (
    "A rival already wins \u201c" +
    keyword +
    "\u201d in Google \u2014 searched about " +
    volume.toLocaleString("en-US") +
    " times a month \u2014 and you have no page for it. A dedicated page puts you in that race."
  );
}
