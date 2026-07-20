/**
 * ResultsTimelineReadError - the "See the raw change log" section's failure copy
 * on /results. A DB-unreachable read once leaked the raw exception
 * ("Supabase query failed on changelog_entries: TypeError: fetch failed") straight
 * onto the page. These pins keep the operator-visible copy calm and internals-free;
 * the real error is logged server-side at the catch site instead.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ResultsTimelineReadError } from "./results-timeline";

describe("ResultsTimelineReadError", () => {
  const html = renderToStaticMarkup(<ResultsTimelineReadError />);

  it("renders the plain read-failure copy with a next step", () => {
    expect(html).toContain("I could not read your change history just now.");
    expect(html).toContain("Try again in a minute.");
  });

  it("never leaks internals: no raw error, no store name, no table name, no dashes", () => {
    expect(html).not.toContain("Supabase");
    expect(html).not.toContain("changelog_entries");
    expect(html).not.toContain("fetch failed");
    expect(html).not.toContain("TypeError");
    expect(html).not.toContain("query failed");
    expect(html).not.toMatch(/[‒–—―]/);
  });
});
