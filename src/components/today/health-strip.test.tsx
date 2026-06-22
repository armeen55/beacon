/**
 * a11y #399 (2026-06-14) — HealthStrip status dots + expand toggle.
 *
 * Pins the additive accessibility contract for the Today health strip:
 *
 *   1. The data/scan/local status dots conveyed state by COLOR ALONE. Each
 *      dot must now expose role="img" + an aria-label naming the signal and
 *      its plain-English status ("Data: ok"), so a screen reader announces
 *      what the color encodes.
 *   2. The "how we know" expand toggle had no expanded/collapsed state and
 *      no stable accessible name for assistive tech. It must carry
 *      aria-expanded + an accessible name.
 *
 * Markup-only assertions (renderToStaticMarkup) — no behavior change.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HealthStrip, type HealthStripProps } from "./health-strip";
import type { TodayProofContext } from "@/lib/today-proof-context";

function proofContext(): TodayProofContext {
  return {
    crawlRunId: null,
    crawlCompletedAt: null,
    crawlHref: null,
    visibilityRunId: null,
    visibilityCompletedAt: null,
    visibilityHref: null,
    citationIndexBuiltAt: null,
    visibilitySynthetic: false,
    visibilitySource: null,
    resultsRowCount: 0,
    resultsThrough: null,
    visibilityStaleVsCrawl: false,
    visibilityStaleNote: null,
    crawlAgeDays: null,
    crawlStale: false,
    visibilityPartialSample: false,
  };
}

function props(over: Partial<HealthStripProps> = {}): HealthStripProps {
  return {
    coverageState: "fresh",
    crawlAgeDays: 0,
    hasScanRun: true,
    localNeedsAttention: false,
    proofContext: proofContext(),
    ...over,
  };
}

describe("HealthStrip — #399 status-dot accessible labels", () => {
  it("labels each status dot with its signal name + plain-English status (role=img)", () => {
    const html = renderToStaticMarkup(<HealthStrip {...props()} />);
    // fresh coverage + scan today + no local attention => all "ok".
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Data: ok"');
    expect(html).toContain('aria-label="Scan: ok"');
    expect(html).toContain('aria-label="Local: ok"');
  });

  it("reflects a problem/needs-attention status in the dot label, not color alone", () => {
    const html = renderToStaticMarkup(
      <HealthStrip
        {...props({ coverageState: "critical", localNeedsAttention: true })}
      />,
    );
    expect(html).toContain('aria-label="Data: problem"');
    expect(html).toContain('aria-label="Local: needs attention"');
  });

  it("reflects the neutral 'no data' status when no scan has run", () => {
    const html = renderToStaticMarkup(
      <HealthStrip {...props({ hasScanRun: false, crawlAgeDays: null })} />,
    );
    expect(html).toContain('aria-label="Scan: no data"');
  });
});

describe("HealthStrip — #399 expand toggle ARIA", () => {
  it("exposes aria-expanded (collapsed by default) + aria-controls + an accessible name", () => {
    const html = renderToStaticMarkup(<HealthStrip {...props()} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="health-strip-how-we-know"');
    expect(html).toContain('aria-label="Data status: show how we know"');
  });
});
