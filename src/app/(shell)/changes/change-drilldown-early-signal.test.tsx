/**
 * Change drilldown — EarlySignalPill surfacing test.
 *
 * /changes/[id] historically had no `weak_signal` surface; the natural-
 * controls AttributionDrilldown uses a different status enum. The 2026-05-09
 * UI bundle surfaces the URL Z-score `weak_signal` verdict on this page
 * via the existing EarlySignalPill component, alongside an italic clarifier
 * sentence.
 *
 * This test renders a minimal isolated fragment matching the shape wired
 * into [id]/page.tsx, so we can exercise the SSR surface without booting
 * the full Next page (which pulls in too many server-only dependencies
 * for a unit test). The structure under test mirrors what `await (async
 * () => { ... })()` produces inside the page.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EarlySignalPill } from "@/components/display/early-signal-pill";
import type { VerdictLabel } from "@/domains/attribution/url-verdict";

function DrilldownEarlySignal({
  verdict,
}: {
  verdict: VerdictLabel | null;
}) {
  if (verdict !== "weak_signal") return null;
  return (
    <div
      className="mb-3 flex items-center gap-2"
      data-change-drilldown-early-signal="true"
    >
      <EarlySignalPill verdict={verdict} />
      <span className="text-[11px] text-muted-foreground italic">
        URL Z-score engine — directional only, not yet a strong signal.
      </span>
    </div>
  );
}

describe("Change drilldown — EarlySignalPill surfacing", () => {
  it("renders the pill + clarifier when URL outcome verdict is weak_signal", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict="weak_signal" />,
    );
    expect(html).toContain('data-change-drilldown-early-signal="true"');
    expect(html).toContain('data-early-signal-pill="true"');
    expect(html).toContain("Early signs of lift");
    expect(html).toContain("directional only");
  });

  it("renders nothing for helping rows", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict="helping" />,
    );
    expect(html).toBe("");
  });

  it("renders nothing for hurting rows", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict="hurting" />,
    );
    expect(html).toBe("");
  });

  it("renders nothing for nothing_yet rows", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict="nothing_yet" />,
    );
    expect(html).toBe("");
  });

  it("renders nothing for null (no url_change_outcomes row found)", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict={null} />,
    );
    expect(html).toBe("");
  });

  it("never overclaims weak_signal as proof on this surface", () => {
    const html = renderToStaticMarkup(
      <DrilldownEarlySignal verdict="weak_signal" />,
    );
    const lc = html.toLowerCase();
    expect(lc).not.toContain("validated");
    expect(lc).not.toContain("proven");
    expect(lc).not.toContain("confirmed");
    expect(lc).not.toMatch(/\bwinning\b/);
    expect(lc).not.toMatch(/\bwon\b/);
    // Note: the pill's tooltip uses "not yet proof" — a negating phrase,
    // not an overclaim — so we don't blacklist the literal word "proof"
    // here. The operator-locked forbidden list is the brief's set:
    // proven / validated / confirmed / winning / won.
  });

  it("/changes/[id] page wires the pill via getUrlChangeOutcomes + entry.id", () => {
    // Lightweight architecture check — the page must reference the new
    // getUrlChangeOutcomes import and the data attribute the component
    // emits, so a future refactor that breaks the wiring will fail here.
    // (We do NOT import the page module — its server-only dependencies
    // make boot expensive.)
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const pageSrc = fs.readFileSync(
      path.resolve(__dirname, "[id]", "page.tsx"),
      "utf-8",
    );
    expect(pageSrc).toContain("getUrlChangeOutcomes");
    expect(pageSrc).toContain("EarlySignalPill");
    expect(pageSrc).toContain('data-change-drilldown-early-signal="true"');
    expect(pageSrc).toMatch(/urlOutcome\?\.verdict\s*===\s*"weak_signal"/);
  });
});
