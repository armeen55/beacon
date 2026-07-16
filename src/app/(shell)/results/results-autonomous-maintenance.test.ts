import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const statusStream = source.slice(
  source.indexOf("async function ResultsStatusStream"),
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
    expect(statusStream).toContain("Beacon is refreshing connected data in the background");
  });
});
