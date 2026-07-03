/**
 * alt-audit (2026-07-03, BEACON_500 P24 image-SEO lane, v1 410/552) - the pure
 * alt-text inventory + coverage math over already-scanned page images.
 *
 * PURE / no I/O. Reads the `images` field the scanner now captures on each
 * PageSnapshot (extractor.ts) and computes, per page and per tenant, how many
 * pictures are missing alt text - the words screen readers and Google Images
 * read. The trigger (add-image-alt-text.ts) consumes the per-page findings; a
 * tenant-level summary drives the "42 of 60 pictures on your site have no alt
 * text" headline.
 *
 * Definitions (mirrors extractor.ts's capture):
 *   • alt = null  -> NO alt attribute. A real gap. Counted as missing.
 *   • alt = ""    -> EMPTY alt (decorative). Intentional; NEVER counted as
 *                    missing (flagging it would tell operators to describe a
 *                    spacer.gif).
 *   • alt = "..." -> has alt text. Counted as covered.
 *
 * Demand-prioritized: each page's 90-day Google impressions rank the findings so
 * a picture on a page real searches land on is raised before one on a page
 * nobody visits. A page with no demand still audits (the inventory is honest),
 * but the trigger applies its own demand floor on top of this.
 *
 * Empty-safe by construction (the pins the P24 slice must hold):
 *   • old snapshots with NO images field         -> contribute 0 images, no finding
 *   • pages where every image already has alt     -> missingAlt 0, no finding
 *   • no-demand pages                             -> audited but impressions 0
 * Byte-identical downstream when nothing is missing. No em or en dashes; no lab
 * words ("picture"/"image", never "asset").
 */

import type { PageImage, PageSnapshot } from "@/domains/pages/types";

/** One image missing alt text, kept with enough context to draft a description. */
export type MissingAltImage = {
  src: string;
  width: number | null;
  height: number | null;
};

/** Per-page alt-text coverage. */
export type PageAltAudit = {
  /** Canonical page URL (the identity used to join GSC demand). */
  url: string;
  /** Total pictures captured on the page (excludes decorative empty-alt? no -
   *  totalImages counts every captured <img>; see coveredAlt/missingAlt for the
   *  split). */
  totalImages: number;
  /** Pictures that already have alt text (alt is a non-empty string). */
  coveredAlt: number;
  /** Pictures with an EMPTY alt attribute (decorative; deliberately excluded
   *  from the missing count). Surfaced for honesty, not as a gap. */
  decorativeAlt: number;
  /** Pictures with NO alt attribute at all - the real gaps this lane fixes. */
  missingAlt: number;
  /** The actual missing-alt images (capped by the caller's page cap upstream). */
  missingImages: MissingAltImage[];
  /** 90-day Google impressions for the page (0 when GSC is not connected / no
   *  demand). Drives prioritization only. */
  impressions90d: number;
};

/** Tenant-wide rollup: the headline "N of M pictures have no alt text". */
export type TenantAltInventory = {
  /** Pages that carried at least one captured picture. */
  pagesWithImages: number;
  /** Total pictures captured across all owned pages. */
  totalImages: number;
  /** Total pictures already covered with alt text. */
  coveredAlt: number;
  /** Total decorative (empty-alt) pictures. */
  decorativeAlt: number;
  /** Total pictures missing alt text across the site. */
  missingAlt: number;
  /** Pages that have at least one missing-alt picture. */
  pagesWithMissingAlt: number;
  /** Per-page audits, HIGHEST DEMAND FIRST (then most-missing, then url) - so a
   *  caller can take the top N without re-sorting. Only pages that captured at
   *  least one image are included. */
  pages: PageAltAudit[];
};

function isMissingAlt(img: PageImage): boolean {
  return img.alt === null;
}

function isDecorativeAlt(img: PageImage): boolean {
  return img.alt === "";
}

function isCoveredAlt(img: PageImage): boolean {
  return typeof img.alt === "string" && img.alt.trim().length > 0;
}

export type AuditPageInput = {
  url: string;
  images: PageImage[] | undefined;
  impressions90d: number;
};

/**
 * Audit ONE page's images. Empty-safe: a page with no images (undefined or [])
 * returns totals of 0 and an empty missingImages list. Pure.
 */
export function auditPageAltText(page: AuditPageInput): PageAltAudit {
  const imgs = page.images ?? [];
  const missingImages: MissingAltImage[] = [];
  let coveredAlt = 0;
  let decorativeAlt = 0;
  for (const img of imgs) {
    if (isCoveredAlt(img)) {
      coveredAlt += 1;
    } else if (isDecorativeAlt(img)) {
      decorativeAlt += 1;
    } else if (isMissingAlt(img)) {
      missingImages.push({ src: img.src, width: img.width, height: img.height });
    }
  }
  return {
    url: page.url,
    totalImages: imgs.length,
    coveredAlt,
    decorativeAlt,
    missingAlt: missingImages.length,
    missingImages,
    impressions90d: page.impressions90d,
  };
}

/**
 * Build the tenant-wide alt-text inventory across every owned snapshot,
 * demand-prioritized. Empty-safe end to end:
 *   • no snapshots            -> all zeros, empty pages[]
 *   • snapshots with no images -> counted as pagesWithImages 0, no page rows
 *   • all-alt-present pages     -> included with missingAlt 0 (honest inventory)
 * The `impressionsFor` resolver returns the page's 90-day impressions (0 when
 * unknown); it is the ONLY demand input, keeping this pure over pre-loaded data.
 * Pure.
 */
export function buildTenantAltInventory(input: {
  snapshots: ReadonlyArray<Pick<PageSnapshot, "url" | "images">>;
  impressionsFor: (url: string) => number;
}): TenantAltInventory {
  const { snapshots, impressionsFor } = input;
  const pages: PageAltAudit[] = [];
  let totalImages = 0;
  let coveredAlt = 0;
  let decorativeAlt = 0;
  let missingAlt = 0;
  let pagesWithImages = 0;
  let pagesWithMissingAlt = 0;

  for (const snap of snapshots) {
    const audit = auditPageAltText({
      url: snap.url,
      images: snap.images,
      impressions90d: impressionsFor(snap.url),
    });
    if (audit.totalImages === 0) continue; // no pictures captured -> not a page row
    pagesWithImages += 1;
    totalImages += audit.totalImages;
    coveredAlt += audit.coveredAlt;
    decorativeAlt += audit.decorativeAlt;
    missingAlt += audit.missingAlt;
    if (audit.missingAlt > 0) pagesWithMissingAlt += 1;
    pages.push(audit);
  }

  // Highest demand first, then most-missing, then a stable url tiebreak.
  pages.sort(
    (a, b) =>
      b.impressions90d - a.impressions90d ||
      b.missingAlt - a.missingAlt ||
      a.url.localeCompare(b.url),
  );

  return {
    pagesWithImages,
    totalImages,
    coveredAlt,
    decorativeAlt,
    missingAlt,
    pagesWithMissingAlt,
    pages,
  };
}
