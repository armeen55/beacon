import type { LocalReview, LocalReviewSource } from "@/lib/local-reviews-types";

type RowResult = {
  entity: LocalReview | null;
  errors: string[];
  warnings: string[];
};

const ALLOWED_SOURCES = new Set<LocalReviewSource>([
  "google",
  "yelp",
  "bbb",
  "houzz",
  "other",
]);

const MAX_REVIEW_TEXT = 5000;
const MAX_SHORT = 200;

/** Returns YYYY-MM-DD or null if invalid / future. */
function parseReviewDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (slash) {
    const mm = parseInt(slash[1]!, 10);
    const dd = parseInt(slash[2]!, 10);
    const yyyy = parseInt(slash[3]!, 10);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (
      d.getUTCFullYear() !== yyyy ||
      d.getUTCMonth() !== mm - 1 ||
      d.getUTCDate() !== dd
    ) {
      return null;
    }
    const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (Date.parse(`${iso}T23:59:59Z`) > Date.now()) return null;
    return iso;
  }

  const ms = Date.parse(t.includes("T") ? t : `${t}T12:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  if (ms > Date.now()) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function normalizeSource(raw: string): LocalReviewSource | null {
  const s = raw.trim().toLowerCase();
  if (ALLOWED_SOURCES.has(s as LocalReviewSource)) return s as LocalReviewSource;
  return null;
}

function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Map one CSV/JSON row (snake_case keys from parseCSV/parseJSON) to `LocalReview`.
 */
export function mapLocalReviewRow(row: Record<string, string>, idx: number): RowResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rowLabel = `Row ${idx + 1}`;

  const id = (row.id ?? "").trim();
  if (!id) errors.push(`${rowLabel}: Missing id`);

  const sourceRaw = row.source ?? "";
  const source = normalizeSource(sourceRaw);
  if (!source) {
    errors.push(
      `${rowLabel}: source must be one of: google, yelp, bbb, houzz, other (got "${sourceRaw.trim() || "(empty)"}")`,
    );
  }

  const ratingRaw = row.rating ?? "";
  const rating = Number(ratingRaw);
  if (ratingRaw.trim() === "" || !Number.isFinite(rating)) {
    errors.push(`${rowLabel}: rating must be a number between 1 and 5`);
  } else if (rating < 1 || rating > 5) {
    errors.push(`${rowLabel}: rating must be a number between 1 and 5`);
  }

  const createdRaw = row.created_at ?? row.createdat ?? "";
  let createdNorm: string | null = null;
  if (!createdRaw.trim()) {
    errors.push(`${rowLabel}: Missing created_at`);
  } else {
    createdNorm = parseReviewDate(createdRaw);
    if (!createdNorm) {
      errors.push(`${rowLabel}: created_at must be a valid date`);
    }
  }

  let reviewText = (row.review_text ?? row.reviewtext ?? "").trim() || undefined;
  if (reviewText && reviewText.length > MAX_REVIEW_TEXT) {
    warnings.push(`${rowLabel}: review_text truncated to ${MAX_REVIEW_TEXT} characters`);
    reviewText = reviewText.slice(0, MAX_REVIEW_TEXT);
  }

  let reviewerName = (row.reviewer_name ?? row.reviewername ?? "").trim() || undefined;
  if (reviewerName && reviewerName.length > MAX_SHORT) {
    warnings.push(`${rowLabel}: reviewer_name truncated`);
    reviewerName = reviewerName.slice(0, MAX_SHORT);
  }

  let listingName = (row.listing_name ?? row.listingname ?? "").trim() || undefined;
  if (listingName && listingName.length > MAX_SHORT) {
    warnings.push(`${rowLabel}: listing_name truncated`);
    listingName = listingName.slice(0, MAX_SHORT);
  }

  const reviewUrlRaw = (row.review_url ?? row.reviewurl ?? "").trim();
  let review_url: string | undefined;
  if (reviewUrlRaw) {
    if (!validUrl(reviewUrlRaw)) {
      errors.push(`${rowLabel}: review_url must be a valid http(s) URL`);
    } else {
      review_url = reviewUrlRaw;
    }
  }

  let location_id = (row.location_id ?? row.locationid ?? "").trim() || undefined;
  if (location_id && location_id.length > MAX_SHORT) {
    warnings.push(`${rowLabel}: location_id truncated`);
    location_id = location_id.slice(0, MAX_SHORT);
  }

  if (errors.length > 0) return { entity: null, errors, warnings };

  const entity: LocalReview = {
    id,
    source: source!,
    rating,
    created_at: createdNorm!,
    review_text: reviewText,
    reviewer_name: reviewerName,
    listing_name: listingName,
    review_url,
    location_id,
  };

  return { entity, errors, warnings };
}
