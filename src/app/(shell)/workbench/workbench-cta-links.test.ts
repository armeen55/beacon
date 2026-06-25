/**
 * Workbench CTA wiring pins (operator-OS rebuild, Phase 2).
 *
 * Every "Run Deep Audit" / "Review Change Pack" CTA must land on the Workbench.
 * These pin the source so a future edit can't silently re-point them back to the
 * generic /recommendations list (the divergence Phase 1 + 2 exist to kill). The
 * encode/decode + workbenchHref behavior itself is covered by
 * `workbench-route.test.ts`; here we assert the surfaces actually call it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("Opportunity Map CTA → Workbench", () => {
  const src = read("../opportunities/opportunity-list.tsx");
  it("imports the shared workbenchHref builder", () => {
    expect(src).toContain('from "@/domains/insight/workbench-route"');
    expect(src).toContain("workbenchHref");
  });
  it("routes the row CTA to the per-page Workbench (not the generic list)", () => {
    expect(src).toContain("href={workbenchHref(o.path)}");
    // The old path-less REVIEW_HREF must no longer drive the CTA.
    expect(src).not.toContain("href={REVIEW_HREF}");
  });
});

describe("Recommendations PS-ready card → Workbench", () => {
  const src = read("../recommendations/recommendations-v2-client.tsx");
  it("imports the shared workbenchHref builder", () => {
    expect(src).toContain('from "@/domains/insight/workbench-route"');
  });
  it("passes a Workbench reviewHref for Page-Surgeon-ready cards", () => {
    expect(src).toMatch(/reviewHref=\{\s*psSummary\?\.hasPack\s*\?\s*workbenchHref\(psSummary\.path\)/);
  });
});

describe("State of the Union 'Do next' → Workbench", () => {
  const src = read("../state-of-union-section.tsx");
  it("links each next-action to the per-page Workbench", () => {
    expect(src).toContain('from "@/domains/insight/workbench-route"');
    expect(src).toContain("href={workbenchHref(a.path)}");
  });
});

describe("Cockpit site-wide sections → Workbench", () => {
  // The site-wide intelligence sections (B55–B57) route their "do the work" CTA to
  // the per-page Workbench, not a bare /proof record form or /moves list. (The
  // detail sections use a literal href; the unified feed uses workbenchHref for the
  // site-wide signal rows but routes queued moves to their rec detail — so for it we
  // pin the workbenchHref call's PRESENCE, not the exact href wrapper.)
  const cases: Array<[string, string]> = [
    ["../today-quickwins-section.tsx", "workbenchHref(r.page)"],
    ["../today-moneyleak-section.tsx", "workbenchHref(r.page)"],
    ["../today-declines-section.tsx", "workbenchHref(r.targetUrl)"],
  ];
  for (const [rel, call] of cases) {
    it(`${rel} routes its CTA via workbenchHref`, () => {
      const src = read(rel);
      expect(src).toContain('from "@/domains/insight/workbench-route"');
      expect(src).toContain(`href={${call}}`);
      // The old record-form / list destinations must not drive the CTA anymore.
      expect(src).not.toContain("href={`/proof?page=");
    });
  }

  it("unified opportunities feed routes site-wide signals to Workbench, moves to rec detail", () => {
    const src = read("../today-opportunities-feed.tsx");
    expect(src).toContain('from "@/domains/insight/workbench-route"');
    expect(src).toContain("workbenchHref(it.page)"); // site-wide signal rows
    expect(src).toContain("buildRecommendationDetailHref({ id: m.id })"); // queued moves
  });
});
