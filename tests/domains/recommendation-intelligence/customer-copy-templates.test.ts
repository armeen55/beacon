/**
 * Slice 4.5.B.α₀ + α₁ + α₂ + Slice 4.5.C.α₀ — customer-copy-templates
 * unit tests.
 *
 * Behavioral assertions on the operator-locked phrasing. The
 * vocab-safety scan lives in
 * `tests/architecture/recommendation-intelligence-customer-copy-vocab.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  duplicateMetaCopy,
  duplicateTitleCopy,
  fixCanonicalCopy,
  fixNoindexCopy,
  fixRobotsCopy,
  fixSitemapCopy,
  fixStatusCodeCopy,
  missingH1Copy,
  missingMetaCopy,
  missingTitleCopy,
  titleH1MismatchCopy,
  weakH1Copy,
} from "@/domains/recommendation-intelligence/customer-copy-templates";

describe("customer-copy templates (α₀ + α₁ + α₂ + 4.5.C.α₀)", () => {
  it("missingTitleCopy returns the operator-locked phrasing", () => {
    expect(missingTitleCopy()).toBe(
      "Add a clear page title so AI search platforms can surface this page accurately.",
    );
  });

  it("missingMetaCopy returns the operator-locked phrasing", () => {
    expect(missingMetaCopy()).toBe(
      "Add a meta description so AI search platforms have a clean snippet to extract.",
    );
  });

  it("missingH1Copy returns the operator-locked phrasing (α₁)", () => {
    expect(missingH1Copy()).toBe(
      "Add a clear H1 so the page anchors its main topic.",
    );
  });

  it("weakH1Copy returns the operator-locked phrasing (α₁)", () => {
    expect(weakH1Copy()).toBe(
      "Strengthen the H1 to include the right service or location so AI search platforms can anchor the page intent.",
    );
  });

  it("titleH1MismatchCopy returns the operator-locked phrasing (α₁)", () => {
    expect(titleH1MismatchCopy()).toBe(
      "Bring the page title and H1 into closer alignment so AI search platforms see consistent intent for this page.",
    );
  });

  it("template outputs are pure (same call → same output)", () => {
    expect(missingTitleCopy()).toBe(missingTitleCopy());
    expect(missingMetaCopy()).toBe(missingMetaCopy());
    expect(missingH1Copy()).toBe(missingH1Copy());
    expect(weakH1Copy()).toBe(weakH1Copy());
    expect(titleH1MismatchCopy()).toBe(titleH1MismatchCopy());
    expect(duplicateTitleCopy(2)).toBe(duplicateTitleCopy(2));
    expect(duplicateMetaCopy(5)).toBe(duplicateMetaCopy(5));
    expect(fixSitemapCopy()).toBe(fixSitemapCopy());
    expect(fixRobotsCopy()).toBe(fixRobotsCopy());
    expect(fixNoindexCopy()).toBe(fixNoindexCopy());
    expect(fixStatusCodeCopy()).toBe(fixStatusCodeCopy());
    expect(fixCanonicalCopy()).toBe(fixCanonicalCopy());
  });

  // ── α₂ count-aware duplicate-metadata templates ─────────────────────

  it("duplicateTitleCopy(2) returns the operator-locked phrasing (α₂)", () => {
    expect(duplicateTitleCopy(2)).toBe(
      "This page title is repeated across 2 owned pages. Make each title distinct so AI search platforms can tell the pages apart.",
    );
  });

  it("duplicateTitleCopy interpolates the integer count for any group size", () => {
    for (const n of [2, 3, 5, 10, 25]) {
      const out = duplicateTitleCopy(n);
      expect(out).toContain("repeated across " + String(n) + " owned pages");
    }
  });

  it("duplicateMetaCopy(2) returns the operator-locked phrasing (α₂)", () => {
    expect(duplicateMetaCopy(2)).toBe(
      "This meta description is repeated across 2 owned pages. Tailor each description so AI search platforms see distinct snippets.",
    );
  });

  it("duplicateMetaCopy interpolates the integer count for any group size", () => {
    for (const n of [2, 3, 5, 10, 25]) {
      const out = duplicateMetaCopy(n);
      expect(out).toContain("repeated across " + String(n) + " owned pages");
    }
  });

  // ── 4.5.C.α₀ indexability remediation templates ─────────────────────

  it("fixSitemapCopy returns the operator-locked phrasing (4.5.C.α₀)", () => {
    expect(fixSitemapCopy()).toBe(
      "This URL is missing from your sitemap.xml. Add it and resubmit so AI search platforms can discover it.",
    );
  });

  it("fixRobotsCopy returns the operator-locked phrasing (4.5.C.α₀)", () => {
    expect(fixRobotsCopy()).toBe(
      "Your robots.txt blocks this URL. Update the rule so AI search platforms and Googlebot can crawl this page.",
    );
  });

  it("fixNoindexCopy returns the operator-locked phrasing (4.5.C.α₀)", () => {
    expect(fixNoindexCopy()).toBe(
      "This page sets a noindex meta tag. Remove it if this page should be discoverable in AI search.",
    );
  });

  it("fixStatusCodeCopy returns the operator-locked phrasing (4.5.C.α₀)", () => {
    expect(fixStatusCodeCopy()).toBe(
      "This URL returns an error or redirect. Restore a clean 200 response so AI search platforms can index this page.",
    );
  });

  it("fixCanonicalCopy returns the operator-locked phrasing (4.5.C.α₀)", () => {
    expect(fixCanonicalCopy()).toBe(
      "This page's canonical URL points to a different page. Update the canonical tag if this URL is the intended primary.",
    );
  });
});
