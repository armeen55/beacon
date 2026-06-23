/**
 * Batch Experiment Planner surface pins (TASK 4).
 *
 * The /experiments route must be operator-gated, must feed the pure selector from
 * the batch loader, and the client must offer the batch actions (copy, mark
 * shipped via the /proof prefill, open Workbench, skip, refresh). Source pins so a
 * future edit can't drop the gate or unwire an action. The route is also operator-
 * only in the nav (operatorNavGroup, never the customer navigationGroups).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("/experiments route", () => {
  const src = read("./page.tsx");
  it("is operator-gated and force-dynamic", () => {
    expect(src).toContain("isOperatorModeServer");
    expect(src).toContain("notFound()");
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });
  it("feeds the batch loader into the pure selector", () => {
    expect(src).toContain("loadBatchExperimentRows");
    expect(src).toContain("selectExperimentBatch");
  });
});

describe("/experiments client batch actions", () => {
  const src = read("./experiments-client.tsx");
  it("marks shipped via the existing /proof record flow with the page prefilled (full canonUrl)", () => {
    expect(src).toContain("/proof?page=${encodeURIComponent(card.canonUrl)}");
  });
  it("offers copy, open-workbench, skip, and refresh", () => {
    expect(src).toContain("navigator.clipboard.writeText");
    expect(src).toContain("card.workbenchHref");
    expect(src).toContain("Skip for now");
    expect(src).toContain("router.refresh()");
  });
  it("never fakes copy: a card with no draft routes to the Workbench instead", () => {
    expect(src).toContain("No drafted copy yet");
  });
});

describe("/experiments is an operator-only nav entry", () => {
  const nav = read("../../../lib/navigation.ts");
  it("appears in operatorNavGroup, not the customer navigationGroups", () => {
    const opIdx = nav.indexOf("operatorNavGroup");
    const expIdx = nav.indexOf('"/experiments"');
    expect(expIdx).toBeGreaterThan(opIdx); // declared inside the operator group block
  });
});
