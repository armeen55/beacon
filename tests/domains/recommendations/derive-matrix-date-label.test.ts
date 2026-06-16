import { describe, expect, it } from "vitest";

import { deriveMatrixDateLabel } from "@/domains/recommendations/load-queue";

describe("deriveMatrixDateLabel (#322 — honest 'Updated {date}')", () => {
  it("returns the latest updated_at (YYYY-MM-DD), not today", () => {
    const out = deriveMatrixDateLabel([
      { updated_at: "2026-05-01T10:00:00.000Z" },
      { updated_at: "2026-05-20T08:30:00.000Z" }, // latest
      { updated_at: "2026-05-12T00:00:00.000Z" },
    ]);
    expect(out).toBe("2026-05-20");
  });

  it("falls back to created_at when updated_at is missing", () => {
    expect(
      deriveMatrixDateLabel([{ updated_at: null, created_at: "2026-04-09T00:00:00Z" }]),
    ).toBe("2026-04-09");
  });

  it("does NOT claim today when the data is weeks stale", () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = deriveMatrixDateLabel([{ updated_at: "2026-01-15T00:00:00Z" }]);
    expect(out).toBe("2026-01-15");
    expect(out).not.toBe(today);
  });

  it("falls back to today for an empty queue (no stale data to misstate)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(deriveMatrixDateLabel([])).toBe(today);
  });
});
