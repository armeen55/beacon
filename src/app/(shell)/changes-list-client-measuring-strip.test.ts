/**
 * changes-list-client - the working strip must show the canonical measuring count (2026-07-20).
 *
 * Source-pinning tests (this repo's convention for interactive client components with no jsdom
 * configured - see changes-list-client-session.test.ts). Before this fix the strip rendered only
 * the To do / Ready tabs, so the canonical "measuring" set (the same In-flight number Today and
 * Results show) was invisible on Changes. One-count rule: the count must come from the ONE
 * canonical field (measuringCountCanonical), never a strip-local re-derive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - measuring is visible on the working strip", () => {
  it("renders a 'Measuring' count in the strip", () => {
    expect(SRC).toMatch(/Measuring\s*<span/);
  });

  it("reads the count from the ONE canonical field (measuringCountCanonical), not a re-derive", () => {
    expect(SRC).toContain("view.measuringCountCanonical > 0");
    expect(SRC).toContain("{view.measuringCountCanonical}");
  });

  it("self-hides at zero so a cold tenant never shows a bare 'Measuring 0'", () => {
    expect(SRC).toMatch(/view\.measuringCountCanonical > 0 \? \(/);
  });
});
