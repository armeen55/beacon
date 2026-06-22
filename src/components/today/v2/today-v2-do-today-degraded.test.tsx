/**
 * audit-4 — TodayV2DoToday must not present a recommendation-queue LOAD FAILURE
 * as "you're caught up". SSR (renderToStaticMarkup) against the real component:
 *   • primaryAction null + queueLoadFailed=true  → "Couldn't load" degraded card
 *     (NOT "Nothing to ship right now").
 *   • primaryAction null + queueLoadFailed=false → the calm "Nothing to ship"
 *     empty state (unchanged).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayV2DoToday } from "./today-v2-do-today";

describe("TodayV2DoToday — load-failure honesty (audit-4)", () => {
  it("queueLoadFailed=true → shows a 'couldn't load' state, not 'nothing to ship'", () => {
    const html = renderToStaticMarkup(
      <TodayV2DoToday primaryAction={null} queueLoadFailed />,
    );
    expect(html).toContain("Couldn&#x27;t load your recommendations");
    expect(html).not.toContain("Nothing to ship right now");
    expect(html).toContain('data-today-v2-degraded="true"');
  });

  it("queueLoadFailed=false → the calm empty state is unchanged", () => {
    const html = renderToStaticMarkup(
      <TodayV2DoToday primaryAction={null} queueLoadFailed={false} />,
    );
    expect(html).toContain("Nothing to ship right now");
    expect(html).not.toContain("Couldn&#x27;t load your recommendations");
    expect(html).toContain('data-today-v2-empty="true"');
  });

  it("default (no flag) → calm empty state (back-compat)", () => {
    const html = renderToStaticMarkup(<TodayV2DoToday primaryAction={null} />);
    expect(html).toContain("Nothing to ship right now");
  });
});
