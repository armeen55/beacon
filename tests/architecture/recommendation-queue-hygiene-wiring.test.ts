import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CRON = readFileSync(
  resolve(__dirname, "../../src/lib/connectors/cron-sync.ts"),
  "utf8",
);

describe("recommendation queue hygiene production wiring", () => {
  it("runs both bounded hygiene passes in the existing nightly path", () => {
    expect(CRON).toContain('from "@/domains/recommendations/queue-sweeper"');
    expect(CRON).toContain(
      'from "@/domains/recommendations/recrawl-demotion-runner"',
    );
    expect(CRON).toContain("await demoteResolvedForTenant(t.id)");
    expect(CRON).toContain("await sweepQueueForTenant(t.id)");
  });

  it("demotes crawl-proven resolved work before sweeping stale rows", () => {
    expect(CRON.indexOf("await demoteResolvedForTenant(t.id)")).toBeLessThan(
      CRON.indexOf("await sweepQueueForTenant(t.id)"),
    );
  });
});
