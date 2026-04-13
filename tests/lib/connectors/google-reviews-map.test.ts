import { describe, it, expect } from "vitest";
import { mapGbpReviewToLocalReview } from "@/lib/connectors/google-reviews-map";

const ctx = { listingTitle: "Test Shop", locationName: "accounts/1/locations/loc1" };

describe("mapGbpReviewToLocalReview", () => {
  it("maps a valid GBP review", () => {
    const raw = {
      reviewId: "abc123",
      starRating: "FIVE",
      createTime: "2026-01-15T12:00:00.000Z",
      comment: "Great work",
      reviewer: { displayName: "Jane" },
    };
    const r = mapGbpReviewToLocalReview(raw, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.id).toBe("google:abc123");
    expect(r.row.source).toBe("google");
    expect(r.row.rating).toBe(5);
    expect(r.row.created_at).toBe("2026-01-15T12:00:00.000Z");
    expect(r.row.review_text).toBe("Great work");
    expect(r.row.reviewer_name).toBe("Jane");
    expect(r.row.listing_name).toBe("Test Shop");
    expect(r.row.location_id).toBe("accounts/1/locations/loc1");
  });

  it("extracts reviewId from name when reviewId missing", () => {
    const raw = {
      name: "accounts/1/locations/l1/reviews/xyz789",
      starRating: "THREE",
      createTime: "2026-02-01T00:00:00Z",
    };
    const r = mapGbpReviewToLocalReview(raw, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.id).toBe("google:xyz789");
    expect(r.row.rating).toBe(3);
  });

  it("rejects missing id", () => {
    const r = mapGbpReviewToLocalReview(
      { starRating: "FIVE", createTime: "2026-01-01T00:00:00Z" },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects invalid star rating", () => {
    const r = mapGbpReviewToLocalReview(
      {
        reviewId: "r1",
        starRating: "NINETY",
        createTime: "2026-01-01T00:00:00Z",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects invalid create time", () => {
    const r = mapGbpReviewToLocalReview(
      {
        reviewId: "r1",
        starRating: "FOUR",
        createTime: "not-a-date",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("omits optional text when empty", () => {
    const r = mapGbpReviewToLocalReview(
      {
        reviewId: "r2",
        starRating: "ONE",
        createTime: "2026-03-10T08:00:00.000Z",
        comment: "   ",
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.review_text).toBeUndefined();
  });
});
