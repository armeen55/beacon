/**
 * classify (2026-07-03, BEACON_500 P24 image-SEO lane, v1 248) - the pure engine
 * that turns a demand-carrying page's missing-alt pictures into one alt-text
 * finding, with a deterministically-drafted description.
 *
 * PURE / no I/O / no LLM. Composes the alt-audit (how many pictures miss alt
 * text) with the deterministic drafter (what to write) into a single per-page
 * finding the trigger adapter (add-image-alt-text.ts) emits as a Move. The
 * trigger stays a thin adapter; all the judgement lives here so it is unit
 * testable.
 *
 * Only EXISTING images are ever touched - this lane never proposes NEW images
 * (that would need N5's gate); it only asks for descriptions on pictures the
 * page already ships. So no N5 gate is involved.
 *
 * Empty-safe / abstains cleanly:
 *   • a page with no missing-alt pictures        -> no finding
 *   • a page below the demand floor              -> no finding
 *   • a page where the drafter can ground NOTHING -> no finding (we do not raise
 *                                                    a card we cannot help with)
 * The demand floor mirrors the other demand-first engines so a customer never
 * sees an alt-text card for a picture on a page nobody visits.
 */

import type { PageImage } from "@/domains/pages/types";
import { auditPageAltText, type MissingAltImage } from "./alt-audit";
import { draftAltText } from "./draft-alt-text";

/** A page needs at least this many 90-day Google impressions before its
 *  missing-alt pictures are worth a customer card. Below this the page has no
 *  real demand to protect. Matches the technical-demand / buried-page floor. */
export const ALT_TEXT_MIN_IMPRESSIONS_90D = 100;

/** Cap the drafted examples we carry per finding (the card names the count and
 *  shows the first drafted description; more than a few is noise). */
const MAX_DRAFTED_EXAMPLES = 3;

export type AltGapPageInput = {
  /** Canonical page URL. */
  url: string;
  /** The page's captured images (undefined/[] on pages with none). */
  images: PageImage[] | undefined;
  /** The page's H1, used to ground a draft when the filename is generic. */
  h1: string | null;
  /** The page's <title>, used to ground a draft as a fallback. */
  pageTitle: string | null;
  /** The page's top Google search term, a last-resort grounding signal. */
  topQuery: string | null;
  /** 90-day Google impressions (the demand gate). */
  impressions90d: number;
};

export type DraftedAltExample = {
  src: string;
  /** The deterministically-drafted description. */
  draft: string;
};

export type AltTextGapFinding = {
  url: string;
  /** How many pictures on the page have no alt text. */
  missingCount: number;
  /** Total pictures on the page (for the honest denominator). */
  totalImages: number;
  /** Up to MAX_DRAFTED_EXAMPLES drafted descriptions (the first one is shown in
   *  the card copy). Always at least one entry when a finding is returned. */
  examples: DraftedAltExample[];
  impressions90d: number;
  /** Operator-only structured trace. */
  evidence: string;
};

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Classify ONE page's alt-text gap. Returns null when there is nothing worth a
 * card (no missing alt, below demand floor, or no draftable description). Pure.
 */
export function classifyAltTextGap(
  page: AltGapPageInput,
): AltTextGapFinding | null {
  if (page.impressions90d < ALT_TEXT_MIN_IMPRESSIONS_90D) return null;

  const audit = auditPageAltText({
    url: page.url,
    images: page.images,
    impressions90d: page.impressions90d,
  });
  if (audit.missingAlt === 0) return null;

  // Draft a description for each missing picture; keep only the ones we can
  // ground (drafter returns null when it has nothing honest to say). If we can
  // ground NONE, we do not raise a card we cannot actually help with.
  const examples: DraftedAltExample[] = [];
  for (const img of audit.missingImages) {
    if (examples.length >= MAX_DRAFTED_EXAMPLES) break;
    const draft = draftAltForImage(img, page);
    if (draft) examples.push({ src: img.src, draft });
  }
  if (examples.length === 0) return null;

  return {
    url: page.url,
    missingCount: audit.missingAlt,
    totalImages: audit.totalImages,
    examples,
    impressions90d: page.impressions90d,
    evidence:
      "alt_text_gap path=" +
      pathOf(page.url) +
      "; missing=" +
      String(audit.missingAlt) +
      "/" +
      String(audit.totalImages) +
      "; impressions_90d=" +
      String(page.impressions90d) +
      "; first_draft=" +
      JSON.stringify(examples[0]!.draft),
  };
}

function draftAltForImage(
  img: MissingAltImage,
  page: AltGapPageInput,
): string | null {
  return draftAltText({
    src: img.src,
    h1: page.h1,
    pageTitle: page.pageTitle,
    topQuery: page.topQuery,
  });
}
