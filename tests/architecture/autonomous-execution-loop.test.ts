import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("autonomous execution loop", () => {
  const changesPage = read("src/app/(shell)/changes/page.tsx");
  const changesClient = read("src/app/(shell)/changes-list-client.tsx");
  const moveCard = read("src/app/(shell)/today-moves-card.tsx");
  const resultsPage = read("src/app/(shell)/results/page.tsx");
  const visitRunner = read("src/domains/ops/on-visit-refresh.ts");
  const moveActions = read("src/app/(shell)/today-moves-actions.ts");

  it("maintains the ready queue on same-day navigation without rerunning deep research", () => {
    expect(visitRunner).toMatch(
      /if \(shouldRunDeepResearch\) \{[\s\S]*?runAutonomousResearchForTenant[\s\S]*?\} else \{[\s\S]*?replenishReadyQueueForTenant\(tenantId\)/,
    );
  });

  it("does not ask the operator to prepare, enrich, or improve the queue", () => {
    expect(changesPage).not.toContain("PrepareTonightButton");
    expect(changesPage).not.toContain("PrepareOverflowMenu");
    expect(changesPage).not.toContain("NewPagesBoard");
    expect(changesPage).not.toContain("PageFactoryBatch");
  });

  it("lets the signed-in customer schedule bounded queue maintenance without operator mode", () => {
    const start = moveActions.indexOf("export async function autoAdvancePrepareAction");
    // 2026-07-18 - the dead `EnrichResearchResult` export this used as an end
    // marker was deleted in the today-moves-actions.ts slimming, which made
    // indexOf return -1 and the slice run to (effectively) the end of the
    // file - capturing every later action (including ones that DO gate on
    // isOperatorModeServer) instead of just this function. Find the next
    // top-level `export` declaration after this one instead, so the slice
    // stops exactly at the end of autoAdvancePrepareAction.
    const end = moveActions.indexOf("\nexport ", start + 1);
    const action = moveActions.slice(start, end);
    expect(action).toContain("replenishReadyQueueForTenant");
    expect(action).not.toContain("isOperatorModeServer");
    expect(action).not.toContain("Operator mode only");
  });

  it("keeps Changes focused on To do and Ready", () => {
    const tabs = changesClient.slice(changesClient.indexOf("const TABS"), changesClient.indexOf("const GOALS"));
    expect(tabs).toContain('{ id: "todo", label: "To do" }');
    expect(tabs).toContain('{ id: "ready", label: "Ready" }');
    expect(tabs).not.toMatch(/measuring|results|watching/i);
    expect(changesClient).not.toContain("Tonight&apos;s 30 minutes");
    expect(changesClient).not.toContain('aria-label="Filter by goal"');
  });

  it("leads expanded work with exact copy and collapses research machinery", () => {
    expect(moveCard).toContain("Exact copy-ready change");
    expect(moveCard).toContain("Evidence and details");
    expect(moveCard.indexOf("Exact copy-ready change")).toBeLessThan(moveCard.indexOf("Evidence and details"));
    expect(moveCard.indexOf("Evidence and details")).toBeLessThan(moveCard.indexOf("Research - what this page should own"));
  });

  it("keeps the Results manual-record path as a collapsed fallback", () => {
    const label = resultsPage.indexOf("Record a change Beacon did not track");
    expect(label).toBeGreaterThan(-1);
    expect(resultsPage.lastIndexOf("<details", label)).toBeGreaterThan(-1);
  });
});
