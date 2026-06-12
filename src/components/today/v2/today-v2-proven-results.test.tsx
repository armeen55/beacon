/**
 * TodayV2ProvenResults — home-screen causal wedge render pin.
 *
 * Renders the plain-English proof headline + a /changes link per win; SELF-
 * HIDES (renders nothing) when there are no proven wins so the home screen
 * stays quiet rather than showing a placeholder.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayV2ProvenResults } from "./today-v2-proven-results";
import type { ProvenWin } from "@/domains/attribution/load-proven-wins";

const win: ProvenWin = {
  sourceId: "rec-1",
  url: "/services/roofing",
  primaryBucket: "content.faq.add",
  liftPerDay: 2,
  relativeLiftPct: 50,
  confidence: "high",
  headline:
    "This change brought in about +2 more AI citations a day than comparable pages that didn't change — about +50% more.",
  treatmentDate: "2026-05-15",
};

describe("TodayV2ProvenResults", () => {
  it("renders the proof headline + a /changes link when wins exist", () => {
    const html = renderToStaticMarkup(<TodayV2ProvenResults wins={[win]} />);
    expect(html).toContain("Proven by Beacon");
    expect(html).toContain("more AI citations a day");
    expect(html).toContain("/changes/rec-1");
    expect(html).toContain("strong evidence");
  });

  it("renders NOTHING when there are no proven wins (self-hides)", () => {
    const html = renderToStaticMarkup(<TodayV2ProvenResults wins={[]} />);
    expect(html).toBe("");
  });
});
