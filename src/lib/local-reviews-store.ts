import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { LocalReview } from "@/lib/local-reviews-types";
import { createHash } from "node:crypto";

const STORE = "local-reviews";

/**
 * Current imported reviews (may be empty). Safe when file is missing.
 */
export async function readLocalReviews(): Promise<LocalReview[]> {
  const rows = await readStore<LocalReview>(STORE, []);
  return [...rows];
}

/**
 * Replace entire store (used by clear). Prefer mergeUpsertLocalReviews for imports.
 */
export async function writeLocalReviews(reviews: LocalReview[]): Promise<void> {
  await writeStore(STORE, reviews);
}

/**
 * Upsert by `id`: rows from the latest import overwrite existing rows with the same id.
 * Order within `incoming` matters — later entries win for the same id.
 */
export async function mergeUpsertLocalReviews(incoming: LocalReview[]): Promise<void> {
  const existing = await readStore<LocalReview>(STORE, []);
  await writeStore(STORE, mergeLocalReviewRows(existing, incoming));
}

function normalizeIdentityPart(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Cross-source identity for the same real review. Falls back to id when the
 * content tuple is incomplete so sparse records never collapse speculatively. */
export function localReviewIdentity(review: LocalReview): string {
  const author = normalizeIdentityPart(review.reviewer_name);
  const date = review.created_at.slice(0, 10);
  const text = normalizeIdentityPart(review.review_text);
  if (!author || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) return `id:${review.id}`;
  const digest = createHash("sha256")
    .update(`${author}\0${date}\0${text}`)
    .digest("hex")
    .slice(0, 24);
  return `content:${digest}`;
}

export function mergeLocalReviewRows(
  existing: ReadonlyArray<LocalReview>,
  incoming: ReadonlyArray<LocalReview>,
): LocalReview[] {
  const merged = new Map<string, LocalReview>();
  const keyById = new Map<string, string>();
  for (const review of [...existing, ...incoming]) {
    // Exact source id is the strongest identity. If its content changed (for
    // example a connector refreshed an edited review), remove the old content
    // key before inserting the replacement.
    const oldKeyForId = keyById.get(review.id);
    if (oldKeyForId) merged.delete(oldKeyForId);
    const key = localReviewIdentity(review);
    const prior = merged.get(key);
    const next = prior ? {
      ...prior,
      ...review,
      review_text: review.review_text ?? prior.review_text,
      reviewer_name: review.reviewer_name ?? prior.reviewer_name,
      listing_name: review.listing_name ?? prior.listing_name,
      review_url: review.review_url ?? prior.review_url,
      location_id: review.location_id ?? prior.location_id,
    } : review;
    if (prior && prior.id !== review.id) keyById.delete(prior.id);
    merged.set(key, next);
    keyById.set(review.id, key);
  }
  return [...merged.values()];
}
