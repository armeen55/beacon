/**
 * today-moves-data staging gate (P2-g, 2026-07-10 visual audit) - source pin confirming
 * the "Stage in Wix" one-click button's `staging.enabled` computation applies
 * copyAllowedForStaging (the W5 source-safety gate), never just the stageRoute + text
 * checks alone. today-moves-data.ts has no existing render/data-flow test harness (it
 * composes many heavy sources), so this pins the wiring directly at the source, the same
 * convention already used for changes-list-client.tsx / ops-pipeline-section.tsx elsewhere
 * in this codebase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../../src/app/(shell)/today-moves-data.ts"), "utf8");

describe("today-moves-data - P2-g staging.enabled respects the source-safety gate", () => {
  it("imports copyAllowedForStaging from the shared stage-route module", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*copyAllowedForStaging[^}]*\}\s*from\s*"@\/domains\/push\/stage-route"/);
  });

  it("staging.enabled applies copyAllowedForStaging(preparedQuality), not just the route + text checks", () => {
    expect(SRC).toContain(
      "enabled: stagingAvail.enabled && stageRoute != null && hasStageText && copyAllowedForStaging(preparedQuality),",
    );
  });
});
