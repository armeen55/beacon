/**
 * Strict GBP v4 Review → LocalReview mapping (Track 1.4e).
 * No enrichment beyond optional fields present on the API object.
 */

import type { LocalReview } from "@/lib/local-reviews-types";

type GbpReviewMapContext = {
  /** Display title for the location (e.g. from locations.list). */
  listingTitle: string;
  /** Resource name, e.g. accounts/x/locations/y */
  locationName: string;
};

const STAR_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function extractReviewId(raw: Record<string, unknown>): string | null {
  const rid = raw.reviewId;
  if (typeof rid === "string" && rid.trim()) return rid.trim();
  const name = raw.name;
  if (typeof name === "string" && name.includes("/reviews/")) {
    const part = name.split("/reviews/").pop();
    if (part?.trim()) return part.trim();
  }
  return null;
}

function parseCreateTime(iso: string): boolean {
  const t = Date.parse(iso);
  return !Number.isNaN(t);
}

/**
 * Map one GBP API review object to LocalReview, or reject with a reason.
 */
export function mapGbpReviewToLocalReview(
  raw: unknown,
  ctx: GbpReviewMapContext,
): { ok: true; row: LocalReview } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const o = raw as Record<string, unknown>;

  const reviewId = extractReviewId(o);
  if (!reviewId) {
    return { ok: false, reason: "missing_review_id" };
  }

  const starRaw = o.starRating;
  if (typeof starRaw !== "string" || !(starRaw in STAR_MAP)) {
    return { ok: false, reason: "invalid_star_rating" };
  }
  const rating = STAR_MAP[starRaw];

  const createTime = o.createTime;
  if (typeof createTime !== "string" || !parseCreateTime(createTime)) {
    return { ok: false, reason: "invalid_create_time" };
  }

  const comment = o.comment;
  const review_text =
    typeof comment === "string" && comment.trim() ? comment.trim() : undefined;

  let reviewer_name: string | undefined;
  const reviewer = o.reviewer;
  if (reviewer && typeof reviewer === "object") {
    const dn = (reviewer as Record<string, unknown>).displayName;
    if (typeof dn === "string" && dn.trim()) reviewer_name = dn.trim();
  }

  const row: LocalReview = {
    id: `google:${reviewId}`,
    source: "google",
    rating,
    created_at: createTime,
    review_text,
    reviewer_name,
    listing_name: ctx.listingTitle.trim() || undefined,
    location_id: ctx.locationName,
  };

  return { ok: true, row };
}
