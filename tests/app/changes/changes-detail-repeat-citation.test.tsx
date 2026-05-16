/**
 * Section 5.B Slice 1 (2026-05-16) — RepeatCitationAct3 render tests.
 *
 * Pins:
 *   - Band → customer-label mapping (stable→Consistent;
 *     intermittent→Recurring; one_off→Early signal;
 *     not_repeated→"Not repeated in this window";
 *     still_learning→Still learning).
 *   - Locked copy templates per band.
 *   - Suppression: result=null, ineligible, band=null,
 *     still_learning + no first-cited → no DOM output.
 *   - No internal-band leakage ("One-off" / "Intermittent"
 *     forbidden in rendered text).
 *   - No percentage characters in customer copy.
 *   - First-cited rendered as `Mon DD` short form.
 *   - data-attr root selector present for downstream selectors.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RepeatCitationAct3 } from "@/components/changes/repeat-citation-act3";
import type { RepeatCitationResult } from "@/domains/citation-lifecycle/compute-repeat-citation";

function result(over: Partial<RepeatCitationResult> = {}): RepeatCitationResult {
  return {
    eligible: true,
    eligibility_reason: "eligible_verified_live",
    window_days: 30,
    polling_days: 19,
    distinct_citation_days: 3,
    citation_rate: 3 / 19,
    band: "one_off",
    per_platform: {
      chatgpt: { polling_days: 19, distinct_citation_days: 0 },
      perplexity: { polling_days: 19, distinct_citation_days: 3 },
      google_ai_overviews: null,
    },
    first_citation_date_iso: "2026-04-28",
    ...over,
  };
}

describe("RepeatCitationAct3 — band → customer label mapping", () => {
  it("stable → 'Citation stability: Consistent'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result({ band: "stable" })} />,
    );
    expect(html).toContain("Citation stability: Consistent");
    expect(html).not.toContain("Stable");
  });

  it("intermittent → 'Citation stability: Recurring'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result({ band: "intermittent" })} />,
    );
    expect(html).toContain("Citation stability: Recurring");
    expect(html).not.toContain("Intermittent");
  });

  it("one_off → 'Citation stability: Early signal'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result({ band: "one_off" })} />,
    );
    expect(html).toContain("Citation stability: Early signal");
    expect(html).not.toContain("One-off");
  });

  it("not_repeated → 'Citation stability: Not repeated in this window'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3
        result={result({
          band: "not_repeated",
          distinct_citation_days: 0,
          polling_days: 19,
        })}
      />,
    );
    expect(html).toContain("Citation stability: Not repeated in this window");
  });

  it("still_learning with first_citation_date_iso → 'Still learning' copy", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3
        result={result({
          band: "still_learning",
          polling_days: 4,
          distinct_citation_days: 0,
          first_citation_date_iso: "2026-04-28",
        })}
      />,
    );
    expect(html).toContain("Citation stability: Still learning");
    expect(html).toContain("4 successful AI readings so far");
    expect(html).toContain("First cited Apr 28");
  });
});

describe("RepeatCitationAct3 — copy templates", () => {
  it("stable/intermittent/one_off renders 'Cited on N of M successful AI readings · First cited DATE'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result()} />, // one_off, 3/19, 2026-04-28
    );
    expect(html).toContain("Cited on 3 of 19 successful AI readings");
    expect(html).toContain("First cited Apr 28");
  });

  it("not_repeated renders 'N successful AI readings in the last 30 days · First cited DATE'", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3
        result={result({
          band: "not_repeated",
          distinct_citation_days: 0,
          polling_days: 14,
          first_citation_date_iso: "2026-04-10",
        })}
      />,
    );
    expect(html).toContain("14 successful AI readings in the last 30 days");
    expect(html).toContain("First cited Apr 10");
  });

  it("never renders a '%' character", () => {
    for (const band of ["stable", "intermittent", "one_off"] as const) {
      const html = renderToStaticMarkup(
        <RepeatCitationAct3 result={result({ band })} />,
      );
      expect(html).not.toContain("%");
    }
  });

  it("never renders the internal 'One-off' or 'Intermittent' label", () => {
    for (const band of ["one_off", "intermittent"] as const) {
      const html = renderToStaticMarkup(
        <RepeatCitationAct3 result={result({ band })} />,
      );
      expect(html).not.toContain("One-off");
      expect(html).not.toContain("Intermittent");
    }
  });

  it("data-attr selectors present on root and detail line", () => {
    const html = renderToStaticMarkup(<RepeatCitationAct3 result={result()} />);
    expect(html).toContain('data-change-detail-repeat-citation="true"');
    expect(html).toContain('data-change-detail-repeat-citation-label="true"');
    expect(html).toContain('data-change-detail-repeat-citation-detail="true"');
  });
});

describe("RepeatCitationAct3 — suppression", () => {
  it("result=null → renders nothing", () => {
    const html = renderToStaticMarkup(<RepeatCitationAct3 result={null} />);
    expect(html).toBe("");
  });

  it("eligible=false → renders nothing", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result({ eligible: false, band: null })} />,
    );
    expect(html).toBe("");
  });

  it("band=null → renders nothing", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3 result={result({ band: null })} />,
    );
    expect(html).toBe("");
  });

  it("still_learning + no first_citation_date_iso → renders nothing", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3
        result={result({
          band: "still_learning",
          polling_days: 4,
          distinct_citation_days: 0,
          first_citation_date_iso: null,
        })}
      />,
    );
    expect(html).toBe("");
  });
});

describe("RepeatCitationAct3 — date formatting", () => {
  it("formats various months correctly as 'Mon DD'", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["2026-01-05", "Jan 5"],
      ["2026-04-28", "Apr 28"],
      ["2026-12-31", "Dec 31"],
    ];
    for (const [iso, expected] of cases) {
      const html = renderToStaticMarkup(
        <RepeatCitationAct3
          result={result({ first_citation_date_iso: iso })}
        />,
      );
      expect(html).toContain(`First cited ${expected}`);
    }
  });

  it("malformed first_citation_date_iso → omits the First cited suffix", () => {
    const html = renderToStaticMarkup(
      <RepeatCitationAct3
        result={result({ first_citation_date_iso: "not-a-date" })}
      />,
    );
    expect(html).not.toContain("First cited");
    // Still renders the band line + detail (the band is one_off in
    // the fixture, eligibility passes).
    expect(html).toContain("Citation stability: Early signal");
  });
});
