import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { dossierHref } from "@/lib/page-dossier-link";

/**
 * dossier-sections contract pins (BEACON_500 item 54) - the sibling source-pin
 * pattern (see coverage-map-section.test.ts): the dossier's bands must render
 * honest empty states, reuse the shared chart/formatting components, stream
 * behind their own Suspense on the route, carry dark-mode-safe token classes,
 * and never contain an em or en dash. Plus the cross-app link pins: the four
 * highest-traffic page-name surfaces must link to the dossier through the ONE
 * shared dossierHref helper.
 */

const SECTIONS = readFileSync(resolve(__dirname, "dossier-sections.tsx"), "utf8");
const ROUTE = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
const CHART = readFileSync(resolve(__dirname, "dossier-chart.tsx"), "utf8");
const LOADER = readFileSync(resolve(__dirname, "page-dossier-data.ts"), "utf8");
const LINK_HELPER = readFileSync(resolve(__dirname, "../../../../lib/page-dossier-link.ts"), "utf8");

describe("dossier route composition", () => {
  it("every band streams behind its own Suspense with a skeleton", () => {
    const suspenseCount = (ROUTE.match(/<Suspense/g) ?? []).length;
    expect(suspenseCount).toBeGreaterThanOrEqual(6); // header + 5 bands
    expect(ROUTE).toContain("fallback={<CardSkeleton />}");
    expect(ROUTE).toContain("animate-pulse");
  });

  it("the route derives its path through pathFromSegments (normalized, decoded)", () => {
    expect(ROUTE).toContain("pathFromSegments(segments ?? [])");
  });

  it("the loader composes EXISTING loaders only (no supabase import, no new query logic)", () => {
    expect(LOADER).not.toContain("getSupabaseAdmin");
    expect(LOADER).not.toContain(".from(");
    expect(LOADER).toContain("loadDailyClicksByPathsForTenant");
    expect(LOADER).toContain("loadGscPageSignalsForTenant");
    expect(LOADER).toContain("loadClarityPageSignalsForTenant");
    expect(LOADER).toContain("loadCrawlCitationFunnel");
    expect(LOADER).toContain("loadLanguageGaps");
    expect(LOADER).toContain("loadProofLedgerCached");
    expect(LOADER).toContain("loadChangesView");
  });

  it("the loader is request-memoized with react cache and every source is fail-soft", () => {
    expect(LOADER).toMatch(/export const loadPageDossier = cache\(/);
    const catches = (LOADER.match(/\.catch\(\(\) =>/g) ?? []).length;
    expect(catches).toBeGreaterThanOrEqual(9);
  });
});

describe("dossier sections", () => {
  it("every band has an honest empty state", () => {
    expect(SECTIONS).toContain("I do not have enough days of search data for this page yet");
    expect(SECTIONS).toContain("I have not matched any Google search queries to this page yet");
    expect(SECTIONS).toContain("None of the team have a read on this page yet");
    expect(SECTIONS).toContain("I have not shipped any change on this page yet");
    expect(SECTIONS).toContain("Nothing is queued for this page right now");
  });

  it("the chart band reuses the shared AreaChart with ship-marker events", () => {
    expect(CHART).toContain('from "@/components/viz/area-chart"');
    expect(CHART).toContain("events={events}");
    expect(CHART).toContain("Shipped ${d.date}");
  });

  it("the queries table scrolls inside its own container on small screens", () => {
    expect(SECTIONS).toContain("overflow-x-auto");
    expect(SECTIONS).toContain("tabular-nums");
  });

  it("uses token-based colors (dark-mode safe via theme tokens)", () => {
    expect(SECTIONS).toContain("text-foreground");
    expect(SECTIONS).toContain("text-muted-foreground");
    expect(SECTIONS).toContain("border-border/60");
  });

  it("history rows link to Results and current moves link to Changes", () => {
    expect(SECTIONS).toContain('href="/proof"');
    expect(SECTIONS).toContain('href="/worklist"');
  });
});

describe("cross-app dossier links (the 4 highest-traffic page-name surfaces)", () => {
  const surfaces = [
    "../../today-moves-card.tsx", // worklist MoveCard
    "../../daily-experiments-section.tsx", // daily card
    "../../proof/page.tsx", // proof ledger rows
    "../../war-room-sections.tsx", // war-room funnel band
  ];
  for (const rel of surfaces) {
    it(`${rel.replace("../../", "")} links page names through the shared dossierHref helper`, () => {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src).toContain('import { dossierHref } from "@/lib/page-dossier-link"');
      expect(src).toContain("dossierHref(");
    });
  }

  it("dossierHref never links the create-page sentinel or the site root", () => {
    expect(LINK_HELPER).toContain('"needs_new_page"');
    expect(LINK_HELPER).toContain('path === "/"');
    expect(LINK_HELPER).toContain("return null");
  });

  it("dossierHref maps full URLs and bare paths onto /page/... (and refuses dead links)", () => {
    expect(dossierHref("https://iranopedia.com/cities")).toBe("/page/cities");
    expect(dossierHref("https://www.iranopedia.com/Cities/")).toBe("/page/cities");
    expect(dossierHref("/persian-boy-names")).toBe("/page/persian-boy-names");
    expect(dossierHref("needs_new_page")).toBeNull();
    expect(dossierHref("https://iranopedia.com/")).toBeNull();
    expect(dossierHref("")).toBeNull();
    expect(dossierHref(null)).toBeNull();
  });
});

describe("dash guard (no em or en dashes anywhere in the dossier's own files)", () => {
  const files: Array<[string, string]> = [
    ["dossier-sections.tsx", SECTIONS],
    ["page.tsx", ROUTE],
    ["dossier-chart.tsx", CHART],
    ["page-dossier-data.ts", LOADER],
    ["page-dossier-link.ts", LINK_HELPER],
  ];
  for (const [name, src] of files) {
    it(`${name} contains no em or en dash`, () => {
      expect(src).not.toMatch(/[–—]/);
    });
  }
});
