import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeStore } from "@/lib/persistence/json-store";
import type { LocalReview } from "@/lib/local-reviews-types";
import {
  readLocalReviews,
  mergeUpsertLocalReviews,
  writeLocalReviews,
} from "@/lib/local-reviews-store";

const base = (over: Partial<LocalReview>): LocalReview => ({
  id: "x",
  source: "google",
  rating: 5,
  created_at: "2026-01-10",
  ...over,
});

describe("local-reviews-store", () => {
  beforeEach(async () => {
    await writeStore("local-reviews", []);
  });

  afterEach(async () => {
    await writeStore("local-reviews", []);
  });

  it("readLocalReviews returns empty when store cleared", async () => {
    expect(await readLocalReviews()).toHaveLength(0);
  });

  it("mergeUpsertLocalReviews upserts by id (newer wins)", async () => {
    await writeLocalReviews([base({ id: "a", rating: 3 })]);
    await mergeUpsertLocalReviews([base({ id: "a", rating: 5 }), base({ id: "b", rating: 4 })]);
    const rows = await readLocalReviews();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "a")!.rating).toBe(5);
    expect(rows.find((r) => r.id === "b")!.rating).toBe(4);
  });
});
