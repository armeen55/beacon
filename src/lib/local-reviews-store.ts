import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { LocalReview } from "@/lib/local-reviews-types";

const STORE = "local-reviews";

/**
 * Current imported reviews (may be empty). Safe when file is missing.
 */
export function readLocalReviews(): LocalReview[] {
  const rows = readStore<LocalReview>(STORE, []);
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
  const existing = readStore<LocalReview>(STORE, []);
  const byId = new Map<string, LocalReview>();
  for (const r of existing) {
    byId.set(r.id, r);
  }
  for (const r of incoming) {
    byId.set(r.id, r);
  }
  await writeStore(STORE, [...byId.values()]);
}
