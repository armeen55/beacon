import { describe, it, expect } from "vitest";
import type { Result } from "@/domains/results/types";
import {
  proposeCitationDailyTotal,
  proposeCitation7dSurge,
} from "@/domains/milestones/compute";

function row(partial: Partial<Result> & Pick<Result, "id">): Result {
  const {
    id,
    snapshot_date = "2026-01-01",
    platform = "chatgpt",
    metric_type = "citation_share",
    metric_value = 0,
    previous_value = null,
    delta = null,
    delta_percentage = null,
    topic = "T",
    city = null,
    url_measured = "https://example.com/",
    attributed_changelog_ids = [],
    notes = null,
    citation_count = 0,
    mention_count = 0,
    total_possible = null,
    position = null,
    created_at = "2026-01-01T00:00:00.000Z",
    ...rest
  } = partial;
  return {
    id,
    snapshot_date,
    platform,
    metric_type,
    metric_value,
    previous_value,
    delta,
    delta_percentage,
    topic,
    city,
    url_measured,
    attributed_changelog_ids,
    notes,
    citation_count,
    mention_count,
    total_possible,
    position,
    created_at,
    ...rest,
  } as Result;
}

describe("milestone compute", () => {
  it("proposeCitationDailyTotal picks max day", () => {
    const results: Result[] = [
      row({ id: "1", snapshot_date: "2026-01-01", citation_count: 10 }),
      row({ id: "2", snapshot_date: "2026-01-01", citation_count: 5 }),
      row({ id: "3", snapshot_date: "2026-01-02", citation_count: 30 }),
    ];
    const p = proposeCitationDailyTotal(results);
    expect(p?.value).toBe(30);
    expect(p?.meta?.date).toBe("2026-01-02");
  });

  it("proposeCitation7dSurge finds strongest last-7 vs prior-7", () => {
    const days: Result[] = [];
    let id = 0;
    const totals = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 10, 10, 10, 10, 10, 10, 10];
    for (let i = 0; i < totals.length; i++) {
      const d = `2026-01-${String(i + 1).padStart(2, "0")}`;
      days.push(
        row({
          id: `r-${id++}`,
          snapshot_date: d,
          citation_count: totals[i],
        }),
      );
    }
    const p = proposeCitation7dSurge(days);
    expect(p).not.toBeNull();
    expect(p!.value).toBeGreaterThan(0);
  });
});
