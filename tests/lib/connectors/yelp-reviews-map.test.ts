import { describe, it, expect } from "vitest";
import { mapYelpReviewToLocalReview } from "@/lib/connectors/yelp-reviews-map";

const ctx = { businessId: "acme-corp-sf", listingName: "Acme HQ" };

describe("mapYelpReviewToLocalReview", () => {
  it("maps a valid Fusion review to LocalReview with yelp: id and source yelp", () => {
    const raw = {
      id: "abc123",
      rating: 4,
      text: "  Solid work.  ",
      time_created: "2026-04-10T15:30:00.000Z",
      user: { name: "  Pat  " },
      url: "https://www.yelp.com/biz/foo#review-abc123",
    };
    const m = mapYelpReviewToLocalReview(raw, ctx);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.row).toEqual({
      id: "yelp:abc123",
      source: "yelp",
      rating: 4,
      created_at: "2026-04-10T15:30:00.000Z",
      review_text: "Solid work.",
      reviewer_name: "Pat",
      listing_name: "Acme HQ",
      review_url: "https://www.yelp.com/biz/foo#review-abc123",
      location_id: "acme-corp-sf",
    });
  });

  it("accepts Yelp space-separated time_created", () => {
    const raw = {
      id: "r2",
      rating: 5,
      time_created: "2026-01-02 08:09:10",
    };
    const m = mapYelpReviewToLocalReview(raw, { businessId: "b" });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.row.id).toBe("yelp:r2");
    expect(m.row.created_at).toMatch(/^2026-01-02T/);
  });

  it("omits optional text and reviewer when absent or empty", () => {
    const raw = {
      id: "r3",
      rating: 3,
      time_created: "2026-03-01T00:00:00Z",
      text: "   ",
      user: {},
    };
    const m = mapYelpReviewToLocalReview(raw, { businessId: "b" });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.row.review_text).toBeUndefined();
    expect(m.row.reviewer_name).toBeUndefined();
  });

  it("rejects non-object", () => {
    expect(mapYelpReviewToLocalReview(null, ctx).ok).toBe(false);
  });

  it("rejects missing review id", () => {
    const m = mapYelpReviewToLocalReview(
      { rating: 5, time_created: "2026-01-01T00:00:00Z" },
      ctx,
    );
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.reason).toBe("missing_review_id");
  });

  it("rejects non-integer rating", () => {
    const m = mapYelpReviewToLocalReview(
      {
        id: "x",
        rating: 4.5,
        time_created: "2026-01-01T00:00:00Z",
      },
      ctx,
    );
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.reason).toBe("invalid_rating");
  });

  it("rejects rating out of 1–5", () => {
    for (const rating of [0, 6]) {
      const m = mapYelpReviewToLocalReview(
        { id: "x", rating, time_created: "2026-01-01T00:00:00Z" },
        ctx,
      );
      expect(m.ok).toBe(false);
      if (m.ok) return;
      expect(m.reason).toBe("invalid_rating");
    }
  });

  it("rejects invalid time_created", () => {
    const m = mapYelpReviewToLocalReview(
      { id: "x", rating: 2, time_created: "not-a-date" },
      ctx,
    );
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.reason).toBe("invalid_time_created");
  });
});
