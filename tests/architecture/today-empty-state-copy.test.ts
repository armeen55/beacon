/**
 * D3 (operator audit, 2026-05-05) — KPI empty-state guidance copy.
 *
 * Pre-D3: the third KPI tile rendered "no data yet" with zero
 * explanation when `citedPageCount === 0`. A first-time operator —
 * especially during onboarding before the first daily poll — would
 * see a stark empty state and assume the product was broken.
 *
 * Post-D3: when the tenant is in a true first-run state (no
 * citations, no result count, no asOfDate), the meta lines render
 * customer-safe guidance:
 *
 *   • "Beacon starts collecting AI answers after the next scheduled poll."
 *   • "Most accounts show their first full daily sample after the next run."
 *
 * Constraints:
 *   • Copy is generic — does NOT promise a specific time (e.g., "10 UTC
 *     tomorrow") because the app does not know each tenant's actual
 *     cron schedule from the render path.
 *   • Copy must NOT show on populated tenants (Ritz with 14k+ obs
 *     should never see first-run guidance).
 *   • Source-text invariant — every customer-facing string must live
 *     in source, so grepping is sufficient.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCOREBOARD_PATH = resolve(
  __dirname,
  "../../src/components/today/today-scoreboard.tsx",
);
const SCOREBOARD_SRC = readFileSync(SCOREBOARD_PATH, "utf-8");

describe("D3 — first-run KPI guidance copy is present", () => {
  it("scoreboard source contains the citations first-run guidance string", () => {
    expect(
      SCOREBOARD_SRC.includes(
        "Beacon starts collecting AI answers after the next scheduled poll.",
      ),
      "today-scoreboard.tsx must include first-run copy 'Beacon starts collecting AI answers after the next scheduled poll.' (D3)",
    ).toBe(true);
  });

  it("scoreboard source contains the pages first-run guidance string", () => {
    expect(
      SCOREBOARD_SRC.includes(
        "Most accounts show their first full daily sample after the next run.",
      ),
      "today-scoreboard.tsx must include first-run copy 'Most accounts show their first full daily sample after the next run.' (D3)",
    ).toBe(true);
  });

  it("scoreboard branches on `isFirstRunNoData` (gates the first-run copy on empty state)", () => {
    expect(
      SCOREBOARD_SRC.includes("isFirstRunNoData"),
      "today-scoreboard.tsx must compute and branch on `isFirstRunNoData` so first-run copy only renders for empty tenants (D3)",
    ).toBe(true);
    // The condition tightens on three signals: zero totalCitations, zero
    // resultCount, and no asOfDate. A tenant with even one full poll
    // has at least one of these non-zero / set.
    expect(
      SCOREBOARD_SRC.match(
        /isFirstRunNoData\s*=\s*\n?\s*scoreboard\.totalCitations\s*===\s*0\s*&&\s*\n?\s*scoreboard\.resultCount\s*===\s*0\s*&&\s*\n?\s*asOfDate\s*===\s*null/,
      ),
      "isFirstRunNoData must require totalCitations=0 AND resultCount=0 AND asOfDate=null (D3)",
    ).not.toBeNull();
  });
});

describe("D3 — first-run copy does NOT overpromise specific timing", () => {
  it("scoreboard does not claim a specific UTC hour or 'tomorrow' time", () => {
    // The brief: "Do not overpromise exact timing unless the app knows
    // it." A first-run tenant on a fresh account does NOT know exactly
    // when their next poll fires (cron schedule + tenant onboarding
    // ordering). Generic-safe copy only.
    const forbidden = [
      "07:00 UTC",
      "10:00 UTC",
      "by tomorrow",
      "tomorrow morning",
      "in 24 hours",
      "within an hour",
    ];
    const hits = forbidden.filter((p) => SCOREBOARD_SRC.includes(p));
    expect(
      hits,
      `D3 copy must NOT include specific timing claims; found: ${hits.join(", ")}`,
    ).toEqual([]);
  });
});

describe("D3 — first-run copy is gated to empty state (does not leak to populated tenants)", () => {
  it("first-run guidance strings live INSIDE a conditional that checks isFirstRunNoData", () => {
    // The strings must appear AFTER the `isFirstRunNoData` declaration
    // and inside ternary expressions guarded by that flag — not at the
    // top of the meta cascade. Grep for the structural shape.
    const citationsCopyIdx = SCOREBOARD_SRC.indexOf(
      "Beacon starts collecting AI answers after the next scheduled poll.",
    );
    const isFirstRunDeclIdx = SCOREBOARD_SRC.indexOf(
      "isFirstRunNoData =",
    );
    expect(
      citationsCopyIdx > isFirstRunDeclIdx,
      "First-run copy must appear after the `isFirstRunNoData` declaration (D3)",
    ).toBe(true);
    // The line that consumes the citation copy must reference
    // `isFirstRunNoData` (i.e., the ternary branches on it).
    const citationsContext = SCOREBOARD_SRC.slice(
      Math.max(0, citationsCopyIdx - 400),
      citationsCopyIdx + 200,
    );
    expect(
      citationsContext.includes("isFirstRunNoData"),
      "First-run citation copy must be guarded by isFirstRunNoData ternary (D3)",
    ).toBe(true);
  });

  it("the legacy 'no data yet' literal is gone from the third KPI tile when state is non-first-run", () => {
    // After D3, the third tile uses "no citations yet on this window"
    // for the non-first-run empty case (e.g., a populated tenant whose
    // selected window has zero citations). The legacy "no data yet"
    // string should appear nowhere in the file.
    expect(
      SCOREBOARD_SRC.includes('"no data yet"'),
      "today-scoreboard.tsx must replace the bare 'no data yet' literal with first-run guidance or windowed copy (D3)",
    ).toBe(false);
  });
});
