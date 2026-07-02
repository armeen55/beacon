/**
 * OpsPipelineSection contract pins (2026-07-02, master plan item 10).
 *
 * Source-level pins (the sibling pattern for server sections): the Ops card
 * must read the PERSISTED invariant check (never recompute on render), cap at
 * 2 red items, self-hide when clean, fail soft to null, carry dark-mode +
 * small-screen classes, and never contain an em or en dash.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "ops-pipeline-section.tsx"), "utf8");

describe("OpsPipelineSection contract", () => {
  it("reads the persisted pipeline health store (no recompute on render)", () => {
    expect(SRC).toContain('from "@/domains/ops/pipeline-health-store"');
    expect(SRC).toContain("readPipelineHealth(tenantId)");
    expect(SRC).not.toContain("gatherPipelineReadings");
    expect(SRC).not.toContain("checkPipelineInvariants");
  });

  it("self-hides when the last check was clean or absent", () => {
    expect(SRC).toContain("if (!health || health.violations.length === 0) return null");
  });

  it("caps at 2 items and admits the rest in one line", () => {
    expect(SRC).toContain("MAX_SHOWN = 2");
    expect(SRC).toContain("violations.slice(0, MAX_SHOWN)");
    expect(SRC).toContain("more stage");
  });

  it("fails soft to null (never a crashed Today)", () => {
    expect(SRC).toMatch(/catch\s*\{\s*return null;\s*\}/);
  });

  it("renders red attention styling with dark-mode + 375px safety", () => {
    expect(SRC).toContain("border-red-200");
    expect(SRC).toContain("dark:border-red-900/60");
    expect(SRC).toContain("break-words");
    expect(SRC).toContain("flex-wrap");
    expect(SRC).toContain("tabular-nums");
  });

  it("speaks first person with the checked time and a next step", () => {
    expect(SRC).toContain("Your data pipe needs attention");
    expect(SRC).toContain("I checked");
    expect(SRC).toContain("I recheck this after every nightly sync");
    expect(SRC).toContain('href="/settings/connectors"');
  });

  it("contains no em or en dashes anywhere", () => {
    expect(SRC).not.toMatch(/[–—]/);
  });

  it("is mounted on the Today page above the attention band", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(page).toContain('import { OpsPipelineSection } from "./ops-pipeline-section"');
    expect(page).toContain("<OpsPipelineSection tenantId={tenantId} />");
  });

  it("the cron wires the invariant check as an isolated final step", () => {
    const cron = readFileSync(
      resolve(__dirname, "../../lib/connectors/cron-sync.ts"),
      "utf8",
    );
    expect(cron).toContain("gatherPipelineReadings(t.id)");
    expect(cron).toContain("checkPipelineInvariants(readings)");
    expect(cron).toContain("writePipelineHealth(buildPipelineHealthRow(readings, violations))");
    expect(cron).toContain("pipeline invariant check failed");
  });
});
