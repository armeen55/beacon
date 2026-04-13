import { describe, it, expect } from "vitest";
import { mapLocalReviewRow } from "@/lib/import/review-mapper";

describe("mapLocalReviewRow", () => {
  it("maps a valid row", () => {
    const { entity, errors } = mapLocalReviewRow(
      {
        id: "r1",
        source: "google",
        rating: "5",
        created_at: "2026-01-15",
      },
      0,
    );
    expect(errors).toHaveLength(0);
    expect(entity).not.toBeNull();
    expect(entity!.id).toBe("r1");
    expect(entity!.source).toBe("google");
    expect(entity!.rating).toBe(5);
    expect(entity!.created_at).toBe("2026-01-15");
  });

  it("rejects invalid source", () => {
    const { entity, errors } = mapLocalReviewRow(
      { id: "r1", source: "facebook", rating: "5", created_at: "2026-01-15" },
      0,
    );
    expect(entity).toBeNull();
    expect(errors.some((e) => e.includes("source must be one of"))).toBe(true);
  });

  it("rejects rating out of range", () => {
    const { entity } = mapLocalReviewRow(
      { id: "r1", source: "google", rating: "6", created_at: "2026-01-15" },
      0,
    );
    expect(entity).toBeNull();
  });

  it("accepts MM/DD/YYYY", () => {
    const { entity, errors } = mapLocalReviewRow(
      { id: "r1", source: "yelp", rating: "4", created_at: "3/10/2026" },
      0,
    );
    expect(errors).toHaveLength(0);
    expect(entity!.created_at).toBe("2026-03-10");
  });

  it("rejects future created_at", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const d = future.toISOString().slice(0, 10);
    const { entity } = mapLocalReviewRow(
      { id: "r1", source: "google", rating: "5", created_at: d },
      0,
    );
    expect(entity).toBeNull();
  });

  it("rejects invalid review_url", () => {
    const { entity, errors } = mapLocalReviewRow(
      {
        id: "r1",
        source: "google",
        rating: "5",
        created_at: "2026-01-15",
        review_url: "not-a-url",
      },
      0,
    );
    expect(entity).toBeNull();
    expect(errors.some((e) => e.includes("review_url"))).toBe(true);
  });

  it("truncates long review_text with warning", () => {
    const long = "x".repeat(6000);
    const { entity, warnings } = mapLocalReviewRow(
      {
        id: "r1",
        source: "other",
        rating: "3",
        created_at: "2026-01-15",
        review_text: long,
      },
      0,
    );
    expect(entity).not.toBeNull();
    expect(entity!.review_text!.length).toBe(5000);
    expect(warnings.some((w) => w.includes("truncated"))).toBe(true);
  });

  it("normalizes source case", () => {
    const { entity } = mapLocalReviewRow(
      { id: "r1", source: "GOOGLE", rating: "5", created_at: "2026-01-15" },
      0,
    );
    expect(entity!.source).toBe("google");
  });
});
