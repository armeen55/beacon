/**
 * location-resolver (2026-06-25, Sprint 5B) — map a Move to its LIKELY
 * implementation location. PURE / deterministic / no I/O.
 *
 * Safety contract: this NEVER guesses a CMS selector or page mapping it can't
 * justify. When there's not enough evidence (no target URL for a page-bound
 * action, an unknown action type, a UX fix with no identified element), it returns
 * `blocked: true` with a reason — the plan downstream becomes needs-review, not a
 * confident-but-wrong instruction. We describe locations in plain operator terms
 * ("SEO settings → Title field"), never invented element selectors/screenshots.
 *
 * Pinned by location-resolver.test.ts.
 */

export type TargetSystem = "wix" | "cms" | "manual" | "unknown";

export type LocationKind =
  | "metadata"
  | "section"
  | "faq"
  | "schema_markup"
  | "page"
  | "product"
  | "collection"
  | "component"
  | "field"
  | "unknown";

export type ResolvedLocation = {
  system: TargetSystem;
  kind: LocationKind;
  /** Plain-language description of WHERE to make the change (no invented selectors). */
  detail: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** True when we can't safely localize the change → plan becomes needs-review. */
  blocked: boolean;
};

export type LocationResolverInput = {
  actionType: string;
  targetUrl: string | null;
  pageType?: string | null;
  /** When the caller has a CONFIRMED CMS mapping (Wix url-map etc.). Never invented. */
  knownCms?: { system: "wix" | "cms"; field?: string | null } | null;
};

/** Actions that need an existing target page to localize against. */
const PAGE_BOUND = new Set([
  "edit_title", "change_title_meta", "update_title_meta", "add_answer_block", "add_faq", "faq",
  "content_refresh", "add_schema", "fix_schema", "add_internal_links", "fix_page_experience", "fix_ux",
  "expand_page", "improve_product_page", "improve_collection", "improve_image_seo", "add_image_alt_text",
]);

export function resolveImplementationLocation(input: LocationResolverInput): ResolvedLocation {
  const action = input.actionType;
  const hasUrl = !!input.targetUrl && input.targetUrl.trim().length > 0;
  const system: TargetSystem = input.knownCms?.system ?? "manual";

  // Fail closed: a page-bound action with no target URL can't be localized.
  if (PAGE_BOUND.has(action) && !hasUrl) {
    return {
      system: "unknown",
      kind: "unknown",
      detail: "No target page URL — cannot localize this change.",
      confidence: "low",
      reason: "missing_page_mapping",
      blocked: true,
    };
  }

  switch (action) {
    case "edit_title":
    case "change_title_meta":
    case "update_title_meta":
      return {
        system,
        kind: "metadata",
        detail: input.knownCms?.field
          ? `CMS field: ${input.knownCms.field} (SEO title / meta description)`
          : "Page SEO settings → Title tag + Meta description fields",
        confidence: input.knownCms ? "high" : "medium",
        reason: "Title/meta lives in the page's SEO settings.",
        blocked: false,
      };
    case "add_answer_block":
      return {
        system,
        kind: "section",
        detail: "Page body — insert a concise answer block directly below the H1 / intro paragraph",
        confidence: "medium",
        reason: "Answer blocks belong high in the body; exact element is operator-confirmed (no invented selector).",
        blocked: false,
      };
    case "add_faq":
    case "faq":
      return {
        system,
        kind: "faq",
        detail: "Existing FAQ section — append Q&As; if none, add a new FAQ block near the page end",
        confidence: "medium",
        reason: "FAQ content + (optionally) FAQPage schema.",
        blocked: false,
      };
    case "add_schema":
    case "fix_schema":
      return {
        system,
        kind: "schema_markup",
        detail: "Structured-data settings, or paste the JSON-LD into a custom <head> / embed block",
        confidence: input.knownCms ? "medium" : "medium",
        reason: "Schema is JSON-LD in the page head / structured-data settings.",
        blocked: false,
      };
    case "add_internal_links":
      return {
        system,
        kind: "section",
        detail: "Source page body — add a contextual link (anchor text) pointing at the target URL",
        confidence: "medium",
        reason: "Internal link is inserted in the source page's body copy.",
        blocked: false,
      };
    case "content_refresh":
    case "expand_page":
      return {
        system,
        kind: "section",
        detail: "Page body — refresh/expand the relevant sections (operator confirms which)",
        confidence: "medium",
        reason: "Body content refresh; sections operator-confirmed.",
        blocked: false,
      };
    case "create_page":
      return {
        system: "manual",
        kind: "page",
        detail: "Create a NEW page (proposed slug) — draft only; publish on your approval",
        confidence: hasUrl ? "medium" : "medium",
        reason: "Net-new page; nothing exists to localize against.",
        blocked: false,
      };
    case "create_product":
      return {
        system: "manual",
        kind: "product",
        detail: "Product CONCEPT — draft a product page concept; DO NOT create live inventory",
        confidence: "low",
        reason: "Commerce concept, not confirmed inventory.",
        blocked: false,
      };
    case "create_collection":
      return {
        system: "manual",
        kind: "collection",
        detail: "Collection/category landing CONCEPT — draft only; no live products attached",
        confidence: "low",
        reason: "Commerce collection concept.",
        blocked: false,
      };
    case "improve_product_page":
      return {
        system,
        kind: "product",
        detail: "Existing product page — improve title/desc/schema/images (no price/inventory change)",
        confidence: "medium",
        reason: "Improve an existing product page.",
        blocked: false,
      };
    case "improve_collection":
      return {
        system,
        kind: "collection",
        detail: "Existing collection page — improve title/desc/intro/schema",
        confidence: "medium",
        reason: "Improve an existing collection page.",
        blocked: false,
      };
    case "improve_image_seo":
    case "add_image_alt_text":
      return {
        system,
        kind: "field",
        detail: "Image alt-text fields on the target page (operator confirms which images)",
        confidence: "low",
        reason: "Image alt text; exact images operator-confirmed.",
        blocked: false,
      };
    case "fix_page_experience":
    case "fix_ux":
      // We do NOT know the exact failing element from demand data alone → needs review.
      return {
        system: "unknown",
        kind: "component",
        detail: "UX element causing friction — not identifiable from demand signals alone",
        confidence: "low",
        reason: "needs_location_review",
        blocked: true,
      };
    default:
      return {
        system: "unknown",
        kind: "unknown",
        detail: `Unrecognized action "${action}" — manual review needed.`,
        confidence: "low",
        reason: "needs_location_review",
        blocked: true,
      };
  }
}
