/**
 * today-proof-strip (Wave 3B) - the ONE consolidated measuring/results strip (slot 5). Pins the
 * canonical measuring count + next-read date, the empty state (never a bare zero), and - the whole
 * reason this replaced the old inline MeasuringSection - that the next-read date is formatted with
 * the canonical monthDayLabel (UTC), so it never drifts a day in a non-UTC timezone the way the old
 * `new Date(y, m, d).toLocaleDateString()` local-time formatter did.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayProofStrip } from "./today-proof-strip";

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&rarr;|→/g, "->")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const NOW = Date.parse("2026-07-09T17:00:00Z");

describe("TodayProofStrip", () => {
  it("names the canonical count, the UTC next-read date, and a freshness receipt", () => {
    const markup = renderToStaticMarkup(
      <TodayProofStrip measuringCount={2} firstReadOn="2026-07-18" gscThrough="2026-07-08" nowMs={NOW} />,
    );
    const t = text(markup);
    expect(t).toContain("2 changes are measuring.");
    // UTC formatting: the date renders as its own UTC day, never drifted to Jul 17 in a western TZ.
    expect(t).toContain("The next results land around Jul 18.");
    expect(t).toContain("From your Search Console data through Jul 8");
    expect(t).toContain("See what's measuring ->");
    expect(markup).toContain('href="/results"');
    expect(markup).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });

  it("uses the singular form for one change", () => {
    const markup = renderToStaticMarkup(
      <TodayProofStrip measuringCount={1} firstReadOn="2026-07-18" gscThrough="2026-07-08" nowMs={NOW} />,
    );
    expect(text(markup)).toContain("1 change is measuring.");
  });

  it("shows an honest empty state, never a bare zero, when nothing is measuring", () => {
    const markup = renderToStaticMarkup(
      <TodayProofStrip measuringCount={0} firstReadOn={null} gscThrough="2026-07-08" nowMs={NOW} />,
    );
    const t = text(markup);
    expect(t).toContain("Nothing is measuring yet.");
    expect(t).not.toContain("0 change");
  });
});
