import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): win fixtures are CALIBRATED so
// the export-a-win render pins calibrated behavior (an uncalibrated win produces no
// win card - the gated splitLedgerLifecycle leaves the Wins band empty).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);
import { renderToStaticMarkup } from "react-dom/server";

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { buildReportModel } from "./report-model";
import { WinCardView, WinCardEmpty } from "./win-card";

/**
 * reports-render tests (P23) - render the two artifacts to static markup and
 * pin the actual rendered copy the operator sees, including the self-hiding
 * empty states. The gated route SHELLS (page.tsx, win/[id]/page.tsx) are thin
 * wrappers over these presentational pieces + loadReportModel, so rendering the
 * card + the model here proves the operator-facing surface without a dev server.
 */

const NOW = new Date("2026-07-03T00:00:00Z");

function wonRow(
  id: string,
  path: string,
  actionType: string,
  adjustedLift: number,
  /** RANK-2: optional already-priced dollar figure attached at measure time. */
  usdPerMonth?: number | null,
): ShippedChangeRecord {
  return {
    id,
    path,
    actionType,
    shippedAt: "2026-05-20",
    verdict: "won", calibrationVersion: TEST_CALIBRATED_VERSION,
    baseline: { impressions: 5_000 },
    windows: [{ day: 28, ran: true, controlsUsed: 3, adjustedLift }],
    dollarValue: usdPerMonth === undefined ? undefined : { usdPerMonth },
  } as unknown as ShippedChangeRecord;
}

describe("export-a-win card render", () => {
  it("renders the win headline with a concrete number and the window", () => {
    const model = buildReportModel({
      ledger: [wonRow("w1", "/persian-comedians", "edit_title", 35)],
      computedAt: NOW.toISOString(),
      now: NOW,
    });
    const win = model.biggestWin!;
    const html = renderToStaticMarkup(
      <WinCardView win={win} computedAt={NOW.toISOString()} nowMs={NOW.getTime()} />,
    );
    expect(html).toContain("Measured win");
    expect(html).toContain("clicks a month");
    expect(html).toContain("persian comedians page");
    expect(html).toContain("title rewrite");
    expect(html).toContain("28-day read");
    // No em/en dash anywhere in the rendered card.
    expect(html).not.toMatch(/[–—]/);
  });

  it("self-hides into the honest empty state when there are no measured wins", () => {
    const html = renderToStaticMarkup(<WinCardEmpty />);
    expect(html).toContain("No measured wins yet.");
    expect(html).toContain("Ship a change and I will show the first one here");
  });
});

describe("monthly report model copy (rendered on the page shell)", () => {
  it("empty ledger yields the null headline (page renders its empty state)", () => {
    const model = buildReportModel({ ledger: [], computedAt: NOW.toISOString(), now: NOW });
    expect(model.outcome).toBeNull();
  });
});

describe("RANK-2 real dollar ROI on the export-a-win card", () => {
  it("renders the grounded dollar line when a per-lead rate + a priced win exist", () => {
    const model = buildReportModel({
      ledger: [wonRow("w1", "/persian-comedians", "edit_title", 35, 420)],
      computedAt: NOW.toISOString(),
      now: NOW,
      revenueModel: { kind: "per_lead", dollarsPerLead: 35 },
    });
    const win = model.biggestWin!;
    expect(win.dollarLine).toBe(
      "This change earned about $420 a month, based on your Search Console clicks and the value you set per lead. This is an estimate at your own rate, not measured revenue.",
    );
    expect(win.dollarPrompt).toBeNull();
    const html = renderToStaticMarkup(
      <WinCardView win={win} computedAt={NOW.toISOString()} nowMs={NOW.getTime()} />,
    );
    expect(html).toContain("This change earned about $420 a month");
    expect(html).toContain("the value you set per lead");
    expect(html).toContain("not measured revenue");
    // Still shows clicks alongside dollars, and never a fake $0 prompt.
    expect(html).toContain("clicks a month");
    expect(html).not.toContain("Connect revenue or tell me");
    expect(html).not.toMatch(/[–—]/);
  });

  it("shows the honest connect-prompt (no dollar figure) when NO revenue model is set", () => {
    const model = buildReportModel({
      ledger: [wonRow("w1", "/persian-comedians", "edit_title", 35, 420)],
      computedAt: NOW.toISOString(),
      now: NOW,
      // revenueModel omitted -> no usable rate
    });
    const win = model.biggestWin!;
    expect(win.dollarLine).toBeNull();
    expect(win.dollarPrompt).toBe(
      "Connect revenue or tell me what a lead is worth, and I will show these wins in dollars.",
    );
    const html = renderToStaticMarkup(
      <WinCardView win={win} computedAt={NOW.toISOString()} nowMs={NOW.getTime()} />,
    );
    expect(html).toContain(
      "Connect revenue or tell me what a lead is worth, and I will show these wins in dollars.",
    );
    // Empty-safe honesty: NO dollar figure anywhere on the ungrounded card.
    expect(html).not.toContain("$420");
    expect(html).not.toContain("earned about $");
    expect(html).not.toMatch(/[–—]/);
  });

  it("shows the prompt (not a fake $0) when a rate is set but the win has no priced figure", () => {
    const model = buildReportModel({
      ledger: [wonRow("w1", "/persian-comedians", "edit_title", 35, null)],
      computedAt: NOW.toISOString(),
      now: NOW,
      revenueModel: { kind: "per_lead", dollarsPerLead: 35 },
    });
    const win = model.biggestWin!;
    expect(win.dollarLine).toBeNull();
    expect(win.dollarPrompt).toContain("Connect revenue or tell me what a lead is worth");
    const html = renderToStaticMarkup(
      <WinCardView win={win} computedAt={NOW.toISOString()} nowMs={NOW.getTime()} />,
    );
    expect(html).not.toContain("earned about $");
  });
});
