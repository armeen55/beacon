import { describe, it, expect } from "vitest";
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

function wonRow(id: string, path: string, actionType: string, adjustedLift: number): ShippedChangeRecord {
  return {
    id,
    path,
    actionType,
    shippedAt: "2026-05-20",
    verdict: "won",
    baseline: { impressions: 5_000 },
    windows: [{ day: 28, ran: true, controlsUsed: 3, adjustedLift }],
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
