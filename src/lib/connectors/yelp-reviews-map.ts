/**
 * Strict Yelp Fusion review → LocalReview mapping (Track 1.4e).
 * No enrichment beyond optional fields on the API object.
 */

import type { LocalReview } from "@/lib/local-reviews-types";

type YelpReviewMapContext = {
  listingName?: string;
  /** Yelp business id or alias used for the request. */
  businessId: string;
};

function normalizeYelpTime(isoLike: string): string | null {
  const s = isoLike.trim();
  if (!s) return null;
  let t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return new Date(t).toISOString();
  }
  const spaced = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, "$1T$2");
  t = Date.parse(spaced);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  t = Date.parse(`${spaced}Z`);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

/**
 * Map one Yelp Fusion `review` object to LocalReview, or reject with a reason.
 */
export function mapYelpReviewToLocalReview(
  raw: unknown,
  ctx: YelpReviewMapContext,
): { ok: true; row: LocalReview } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const o = raw as Record<string, unknown>;

  const id = o.id;
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, reason: "missing_review_id" };
  }

  const rating = o.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return { ok: false, reason: "invalid_rating" };
  }

  const timeCreated = o.time_created;
  if (typeof timeCreated !== "string") {
    return { ok: false, reason: "missing_time_created" };
  }
  const createdIso = normalizeYelpTime(timeCreated);
  if (!createdIso) {
    return { ok: false, reason: "invalid_time_created" };
  }

  const text = o.text;
  const review_text =
    typeof text === "string" && text.trim() ? text.trim() : undefined;

  let reviewer_name: string | undefined;
  const user = o.user;
  if (user && typeof user === "object") {
    const name = (user as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) reviewer_name = name.trim();
  }

  const url = o.url;
  const review_url =
    typeof url === "string" && url.trim() ? url.trim() : undefined;

  const row: LocalReview = {
    id: `yelp:${id.trim()}`,
    source: "yelp",
    rating,
    created_at: createdIso,
    review_text,
    reviewer_name,
    listing_name: ctx.listingName?.trim() || undefined,
    review_url,
    location_id: ctx.businessId,
  };

  return { ok: true, row };
}
