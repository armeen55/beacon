import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("on-use customer language", () => {
  it("does not mount dormant overnight autopilot controls on Connections", () => {
    const page = source("src/app/(shell)/settings/connectors/page.tsx");
    expect(page).not.toContain("AutopilotCard");
    expect(page).not.toContain("Prepare tomorrow");
  });

  it("describes Today recovery as background work triggered by use", () => {
    const section = source("src/app/(shell)/ops-pipeline-section.tsx");
    expect(section).toContain("My background work needs attention");
    expect(section).toContain("I recheck this automatically while you use Beacon");
    expect(section).not.toContain("My overnight work is not running");
    expect(section).not.toContain("after every nightly sync");
  });

  it("never promises a nonexistent scheduled retry in shared recovery copy", () => {
    const recovery = source("src/domains/ops/recovery-actions.ts");
    expect(recovery).not.toContain("on my own overnight");
    expect(recovery).not.toContain("next scheduled run");
    expect(recovery).not.toContain("own overnight schedule");
    expect(recovery).toContain("as you keep using Beacon");
  });

  it("uses today language on the live execution surfaces", () => {
    const surfaces = [
      source("src/app/(shell)/tonight-summary-chip.tsx"),
      source("src/app/(shell)/daily-experiments-section.tsx"),
      source("src/app/(shell)/changes-list-client.tsx"),
    ].join("\n");
    expect(surfaces).toContain("Today: {picked} picked");
    expect(surfaces).toContain("Today: {applied} of {total} applied");
    expect(surfaces).toContain("Today&apos;s batch:");
    expect(surfaces).not.toContain("Tonight: {picked} picked");
    expect(surfaces).not.toContain("Tonight&apos;s batch:");
  });

  it("keeps supporting surfaces honest about refresh timing", () => {
    const activity = source("src/app/(shell)/activity/page.tsx");
    const questions = source("src/app/(shell)/prompts/unanswered-questions-section.tsx");
    const gaps = source("src/domains/gsc/ingestion-gaps.ts");
    expect(activity).not.toContain("nightly jobs");
    expect(questions).not.toContain("rebuild this list every night");
    expect(gaps).not.toContain("re-pull it tonight");
    expect(questions).toContain("as you use Beacon");
    expect(gaps).toContain("while you use Beacon");
  });
});
