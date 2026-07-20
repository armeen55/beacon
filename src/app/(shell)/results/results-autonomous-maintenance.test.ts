import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
// Span the freshness note (resultsFreshnessNote) AND the status stream that
// consumes it: the background-refresh copy was extracted into the pure helper
// that sits just above ResultsStatusStream, while the scheduleAutoMeasure wiring
// stays in the stream. Both belong to the same "measurement recovery is
// automatic, never a user chore" invariant, so both must stay in scope.
const statusStream = source.slice(
  source.indexOf("export function resultsFreshnessNote"),
  source.indexOf("async function MeasuredOutcomesContextStream"),
);

describe("Results autonomous maintenance", () => {
  it("schedules safe due measurement for every authenticated Results visit", () => {
    expect(statusStream).toContain(
      "if (dueNow.length > 0 || eligibleReverify) scheduleAutoMeasure(tenantId);",
    );
    expect(statusStream).not.toMatch(/isOperator\s*&&[\s\S]{0,120}scheduleAutoMeasure/);
  });

  it("does not assign background measurement recovery to the user", () => {
    expect(statusStream).not.toContain("Refresh in a moment");
    expect(statusStream).not.toContain("Measuring ${dueNow.length}");
    expect(statusStream).not.toContain("Refresh to update");
    expect(statusStream).toContain("I am refreshing connected data in the background");
  });
});
