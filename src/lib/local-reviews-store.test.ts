import { describe, expect, it } from "vitest";
import type { LocalReview } from "./local-reviews-types";
import { localReviewIdentity, mergeLocalReviewRows } from "./local-reviews-store";

function review(overrides: Partial<LocalReview>): LocalReview {
  return {
    id: "manual-1",
    source: "google",
    rating: 5,
    created_at: "2026-07-01",
    reviewer_name: "Ada Lovelace",
    review_text: "Wonderful work and clear communication.",
    ...overrides,
  };
}

describe("local review cross-source identity", () => {
  it("matches manual and connector rows by normalized author/date/text", () => {
    expect(localReviewIdentity(review({}))).toBe(localReviewIdentity(review({
      id: "google:abc",
      created_at: "2026-07-01T19:00:00.000Z",
      reviewer_name: "  ADA   LOVELACE ",
      review_text: "Wonderful work and clear communication. ",
    })));
  });

  it("deduplicates across ids and preserves richer fields", () => {
    const rows = mergeLocalReviewRows(
      [review({ review_url: "https://example.com/review" })],
      [review({ id: "google:abc", location_id: "locations/1" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "google:abc",
      review_url: "https://example.com/review",
      location_id: "locations/1",
    });
  });

  it("does not collapse sparse reviews without a complete content tuple", () => {
    const rows = mergeLocalReviewRows(
      [review({ id: "a", review_text: undefined })],
      [review({ id: "b", review_text: undefined })],
    );
    expect(rows).toHaveLength(2);
  });

  it("replaces an exact source id even when the review content changed", () => {
    const rows = mergeLocalReviewRows(
      [review({ id: "google:1", created_at: "2020-01-01", rating: 2, review_text: undefined })],
      [review({ id: "google:1", created_at: "2026-07-01", rating: 5 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe(5);
  });
});
