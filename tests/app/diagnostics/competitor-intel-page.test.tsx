/**
 * 2026-06-09 — operator-only /diagnostics/competitor-intel contract:
 * gate (404), refresh action operator-gate + delegation, empty states,
 * all-tier move listing (quiet included here, unlike the customer
 * surface).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));

let _lastCrawlAt: string | null = null;
vi.mock("@/domains/competitor-monitoring/store", () => ({
  getCompetitorMonitoringState: async () => ({
    lastCrawlAt: _lastCrawlAt,
    snapshots: [],
    recentChanges: [],
  }),
}));

let _moves: unknown[] = [];
vi.mock("@/domains/competitor-intel/load-moves", () => ({
  loadCompetitorMoves: async () => _moves,
}));

let _structural: unknown[] = [];
vi.mock("@/domains/competitor-intel/structural-changes-store", () => ({
  getCompetitorStructuralChanges: async () => _structural,
}));

const refreshCompetitorIntel = vi.fn(async () => ({
  ok: true as const,
  competitorsCrawled: 2,
  sitemapChangesDetected: 1,
  sitemapChangesRecorded: 1,
  urlsFetched: 3,
  urlsBlocked: 0,
  urlsFailed: 0,
  structuralChangesDetected: 1,
}));
vi.mock("@/domains/competitor-intel/refresh-intel", () => ({
  refreshCompetitorIntel: () => refreshCompetitorIntel(),
}));

import CompetitorIntelDiagnosticPage from "@/app/(shell)/diagnostics/competitor-intel/page";
import { refreshCompetitorIntelAction } from "@/app/(shell)/diagnostics/competitor-intel/actions";

async function render(): Promise<string> {
  return renderToStaticMarkup(await CompetitorIntelDiagnosticPage());
}

beforeEach(() => {
  _operator = true;
  _lastCrawlAt = null;
  _moves = [];
  _structural = [];
  refreshCompetitorIntel.mockClear();
});

describe("/diagnostics/competitor-intel — gate + states", () => {
  it("404s for non-operators", async () => {
    _operator = false;
    await expect(render()).rejects.toThrow(NotFoundError);
  });

  it("renders empty states + never-crawled", async () => {
    const html = await render();
    expect(html).toContain("Competitor intel");
    expect(html).toContain("never crawled");
    expect(html).toMatch(/no moves yet/i);
    expect(html).toContain("Refresh competitor intel");
  });

  it("lists moves of every tier (quiet included)", async () => {
    _lastCrawlAt = "2026-06-09T12:00:00Z";
    _moves = [
      {
        id: "m1",
        tier: "quiet",
        line: "Supple Homes updated a adu page on April 1. No AI pickup yet.",
        preCount: 0,
        postCount: 0,
        action: { actionType: "refresh_content", label: "Refresh your matching page" },
      },
    ];
    const html = await render();
    expect(html).toContain("last crawl 2026-06-09T12:00:00Z");
    expect(html).toContain('data-move-tier="quiet"');
    expect(html).toContain("No AI pickup yet.");
  });
});

describe("refreshCompetitorIntelAction", () => {
  it("rejects non-operators (no crawl/fetch fires)", async () => {
    _operator = false;
    const r = await refreshCompetitorIntelAction();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(refreshCompetitorIntel).not.toHaveBeenCalled();
  });

  it("delegates to the domain refresh for operators", async () => {
    const r = await refreshCompetitorIntelAction();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.urlsFetched).toBe(3);
    expect(refreshCompetitorIntel).toHaveBeenCalledTimes(1);
  });
});
