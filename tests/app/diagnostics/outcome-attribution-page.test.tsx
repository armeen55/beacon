/**
 * 2026-05-19 — Slice 9.A2α.3 — operator-only outcome-attribution
 * diagnostic page render tests.
 *
 * Pins:
 *   • Operator gate: non-operator + non-test env → `notFound()` invoked.
 *   • Render under `NODE_ENV === "test"`: page renders.
 *   • Empty state: no verified-live edits → empty copy.
 *   • Populated state: counter strip + per-edit table render with
 *     `data-row-mode-a-kind` AND `data-row-mode-a-reason` data
 *     attributes per row.
 *   • Eligible row carries empty reason; still_learning_outcome +
 *     ineligible rows carry the discriminator reason.
 *   • Supabase fail-soft variants:
 *     - 42P01 (undefined_table) → banner; no crash.
 *     - generic read error → banner; no crash.
 *   • Customer-vocab safety (defense in depth): NO K5-forbidden
 *     tokens (`drove` / `caused` / `revenue` / `dollars` / `$` /
 *     `generated`) in rendered HTML.
 *   • `data-diagnostics-row-count` attribute present + matches
 *     per-edit count.
 *   • NO GA4 Data API call on render — page source MUST NOT import
 *     `@/lib/connectors/ga4/data-api`; fetch MUST NOT be invoked.
 *
 * Mocks the repository + Supabase admin + currentTenantId + operator-
 * mode + canonicalize-url so tests stay backend-agnostic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let _isOperator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _isOperator,
}));

const _notFoundSpy = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    _notFoundSpy();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));

let _editsToReturn: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_t: string) => ({
      getRecommendedEdits: vi.fn(async () => _editsToReturn),
    }),
  }),
}));

let _trafficRowsToReturn: Array<Record<string, unknown>> = [];
let _supabaseError: { code?: string; message?: string } | null = null;
let _supabaseAdminThrows = false;
const _lastSelectColumns = { current: "" };
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (_supabaseAdminThrows) {
      throw new Error("admin unavailable in this environment");
    }
    return {
      from: (_table: string) => ({
        select: (cols: string) => {
          _lastSelectColumns.current = cols;
          return {
            eq: (_col: string, _val: string) =>
              Promise.resolve(
                _supabaseError != null
                  ? { data: null, error: _supabaseError }
                  : { data: _trafficRowsToReturn, error: null },
              ),
          };
        },
      }),
    };
  },
}));

vi.mock("@/domains/citation-lifecycle/canonicalize-url", () => ({
  canonicalizeCitationUrl: (url: string | null | undefined) => {
    if (url == null || url === "") return "";
    return url
      .toLowerCase()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  },
}));

// 9.A2γ — the page now imports the server action; mock it so the
// page renders without triggering the action's downstream imports
// (which include `next/cache`, the connector store, etc.). Both
// `refreshTenantGa4Traffic` (programmatic + test surface) and the
// thin `refreshTenantGa4TrafficFromForm` (the form-binding wrapper
// the page uses) are mocked.
vi.mock("@/app/(shell)/diagnostics/outcome-attribution/actions", () => ({
  refreshTenantGa4Traffic: vi.fn(async () => ({
    ok: true,
    rows_fetched: 0,
    rows_upserted: 0,
    startDate: "2026-02-18",
    endDate: "2026-05-19",
  })),
  refreshTenantGa4TrafficFromForm: vi.fn(async (_fd: FormData) => undefined),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  _isOperator = true;
  _editsToReturn = [];
  _trafficRowsToReturn = [];
  _supabaseError = null;
  _supabaseAdminThrows = false;
  _notFoundSpy.mockClear();
  // @ts-expect-error — vitest test env allows mutating NODE_ENV
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  // @ts-expect-error — restore
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

// Re-import after mocks.
import OutcomeAttributionDiagnosticPage from "@/app/(shell)/diagnostics/outcome-attribution/page";

async function renderPage(): Promise<string> {
  const tree = (await OutcomeAttributionDiagnosticPage({
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return renderToStaticMarkup(tree);
}

// ─────────────────────────────────────────────────────────────────────
// Operator gate
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — operator gate", () => {
  it("calls notFound() when operator mode is off AND NODE_ENV is not test", async () => {
    _isOperator = false;
    // @ts-expect-error — emulate production environment
    process.env.NODE_ENV = "production";
    let thrown = false;
    try {
      await OutcomeAttributionDiagnosticPage({
        searchParams: Promise.resolve({}),
      });
    } catch (e) {
      thrown = true;
      expect((e as Error).message).toBe("NEXT_NOT_FOUND");
    }
    expect(thrown).toBe(true);
    expect(_notFoundSpy).toHaveBeenCalledTimes(1);
  });

  it("renders when NODE_ENV is test even with operator mode off", async () => {
    _isOperator = false;
    const html = await renderPage();
    expect(html).toContain('data-diagnostic="outcome-attribution"');
    expect(_notFoundSpy).not.toHaveBeenCalled();
  });

  it("renders when operator mode is on", async () => {
    _isOperator = true;
    const html = await renderPage();
    expect(html).toContain('data-diagnostic="outcome-attribution"');
    expect(_notFoundSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — empty state", () => {
  it("renders empty-state copy when no verified-live edits exist", async () => {
    _editsToReturn = [
      {
        id: "r1",
        target_url: "/x",
        live_at: null,
        implementation_status: "recommended",
      },
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="empty"');
    expect(html).toContain("No verified-live edits");
  });

  it("renders the counter strip even when empty", async () => {
    _editsToReturn = [];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="counters"');
    expect(html).toContain('data-counter="total_verified_live"');
    expect(html).toContain('data-counter="eligible"');
    expect(html).toContain('data-counter="still_learning_outcome"');
    expect(html).toContain('data-counter="ineligible"');
    expect(html).toContain('data-counter="total_cached_traffic_rows"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Populated state — Mode A variant rendering
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — populated state (Mode A variants)", () => {
  it("renders eligible row with data-row-mode-a-kind='eligible' and empty reason", async () => {
    const liveAt = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    _editsToReturn = [
      {
        id: "edit-1-uuid-abcdef",
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
        live_at: liveAt,
        implementation_status: "verified_live",
      },
    ];
    _trafficRowsToReturn = [
      {
        url: "https://ritzbuilders.com/services/whole-home-remodel",
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        sessions: 10,
        engaged_sessions: 8,
        conversions: 1,
      },
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="per-edit-table"');
    expect(html).toContain('data-row-edit-id="edit-1-uuid-abcdef"');
    expect(html).toContain('data-row-mode-a-kind="eligible"');
    expect(html).toContain('data-row-mode-a-reason=""');
  });

  it("renders still_learning_outcome row with discriminator reason on data attribute", async () => {
    const liveAt = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    _editsToReturn = [
      {
        id: "edit-2",
        target_url: "https://ritzbuilders.com/path",
        live_at: liveAt,
        implementation_status: "verified_live",
      },
    ];
    // 2 sessions in 14 days = insufficient_volume.
    _trafficRowsToReturn = [
      {
        url: "https://ritzbuilders.com/path",
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        sessions: 2,
        engaged_sessions: 1,
        conversions: 0,
      },
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-mode-a-kind="still_learning_outcome"');
    expect(html).toContain('data-row-mode-a-reason="insufficient_volume"');
  });

  it("renders ineligible row with discriminator reason on data attribute", async () => {
    _editsToReturn = [
      {
        id: "edit-3",
        target_url: "https://ritzbuilders.com/path",
        live_at: null, // → ineligible: no_live_at
        implementation_status: "verified_live",
      },
    ];
    const html = await renderPage();
    expect(html).toContain('data-row-mode-a-kind="ineligible"');
    expect(html).toContain('data-row-mode-a-reason="no_live_at"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Data attributes
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — data attributes", () => {
  it("emits data-diagnostics-row-count matching the per-edit count", async () => {
    const liveAt = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    _editsToReturn = [
      {
        id: "a",
        target_url: "/a",
        live_at: liveAt,
        implementation_status: "verified_live",
      },
      {
        id: "b",
        target_url: "/b",
        live_at: liveAt,
        implementation_status: "verified_live_modified",
      },
      {
        id: "c",
        target_url: "/c",
        live_at: liveAt,
        implementation_status: "partially_implemented",
      },
    ];
    const html = await renderPage();
    expect(html).toContain('data-diagnostics-row-count="3"');
  });

  it("renders all 3 required data attributes per row (kind + reason + edit-id)", async () => {
    const liveAt = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    _editsToReturn = [
      {
        id: "x",
        target_url: "https://ritzbuilders.com/x",
        live_at: liveAt,
        implementation_status: "verified_live",
      },
    ];
    _trafficRowsToReturn = [
      {
        url: "https://ritzbuilders.com/x",
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        sessions: 100,
        engaged_sessions: 80,
        conversions: 5,
      },
    ];
    const html = await renderPage();
    // Insufficient days → still_learning_outcome: insufficient_days
    expect(html).toContain('data-row-edit-id="x"');
    expect(html).toContain('data-row-mode-a-kind="still_learning_outcome"');
    expect(html).toContain('data-row-mode-a-reason="insufficient_days"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Supabase fail-soft
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — Supabase fail-soft", () => {
  it("renders without crashing + shows banner on 42P01 (table missing)", async () => {
    _editsToReturn = [
      {
        id: "edit-4",
        target_url: "https://ritzbuilders.com/path",
        live_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        implementation_status: "verified_live",
      },
    ];
    _supabaseError = { code: "42P01", message: "relation does not exist" };
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="traffic-banner"');
    expect(html).toContain('data-traffic-status="table_missing"');
    expect(html).toContain('data-row-mode-a-kind="ineligible"');
    expect(html).toContain('data-row-mode-a-reason="no_traffic_data"');
  });

  it("renders banner on generic read error (non-42P01)", async () => {
    _editsToReturn = [];
    _supabaseError = { code: "08001", message: "connection refused" };
    const html = await renderPage();
    expect(html).toContain('data-traffic-status="read_error"');
  });

  it("renders banner when Supabase admin client init throws", async () => {
    _editsToReturn = [];
    _supabaseAdminThrows = true;
    const html = await renderPage();
    expect(html).toContain('data-traffic-status="admin_unavailable"');
  });

  it("does NOT render a banner on healthy (status=ok) read", async () => {
    _editsToReturn = [];
    _trafficRowsToReturn = [];
    const html = await renderPage();
    expect(html).not.toContain('data-diagnostic-section="traffic-banner"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Customer-vocab safety (defense in depth)
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — customer-vocab safety", () => {
  it("renders NO K5-forbidden customer vocab anywhere on the page", async () => {
    const liveAt = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    _editsToReturn = [
      {
        id: "edit-5",
        target_url: "https://ritzbuilders.com/path",
        live_at: liveAt,
        implementation_status: "verified_live",
      },
    ];
    _trafficRowsToReturn = [
      {
        url: "https://ritzbuilders.com/path",
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        sessions: 10,
        engaged_sessions: 8,
        conversions: 1,
      },
    ];
    const html = await renderPage();
    // Strip React's framework-injected <script> / <style> tags
    // (9.A2γ: `<form action={serverAction}>` triggers React's auto-
    //  injected form-replay script which contains `$$reactFormReplay`).
    // The K5 forbidden-vocab rule applies to customer-visible text,
    // NOT framework infrastructure.
    const visible = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    const lower = visible.toLowerCase();
    expect(lower.includes("drove")).toBe(false);
    expect(lower.includes("caused")).toBe(false);
    expect(lower.includes("revenue")).toBe(false);
    expect(lower.includes("dollars")).toBe(false);
    expect(lower.includes("generated")).toBe(false);
    expect(visible.includes("$")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// No GA4 Data API call on render (source-text contract)
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — no GA4 Data API call on render", () => {
  // Source-text check at runtime. The page MUST NOT import the
  // GA4 Data API client (which would risk triggering a network
  // call during server render). Mode A is pure compute over
  // pre-cached `ga4_url_traffic` rows. The architecture invariant
  // `ga4-no-page-load-call` (existing) auto-covers customer
  // surfaces; this test is the diagnostic-page-specific source
  // check (since `/diagnostics/*` is intentionally outside the
  // customer-surface scan).
  it("page.tsx does NOT import from @/lib/connectors/ga4/data-api", () => {
    const pagePath = resolve(
      __dirname,
      "../../../src/app/(shell)/diagnostics/outcome-attribution/page.tsx",
    );
    const source = readFileSync(pagePath, "utf-8");
    expect(source.includes("@/lib/connectors/ga4/data-api")).toBe(false);
  });

  it("page.tsx does NOT call fetch() anywhere", () => {
    const pagePath = resolve(
      __dirname,
      "../../../src/app/(shell)/diagnostics/outcome-attribution/page.tsx",
    );
    const source = readFileSync(pagePath, "utf-8");
    // Strip comments before checking — narrative comments may
    // reference "fetch" descriptively.
    const stripped = source
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\bfetch\s*\(/.test(stripped)).toBe(false);
  });

  it("page.tsx does NOT import runGa4UrlTrafficReport by name", () => {
    const pagePath = resolve(
      __dirname,
      "../../../src/app/(shell)/diagnostics/outcome-attribution/page.tsx",
    );
    const source = readFileSync(pagePath, "utf-8");
    expect(source.includes("runGa4UrlTrafficReport")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9.A2γ — Refresh form + last-refresh label
// ─────────────────────────────────────────────────────────────────────

describe("Outcome attribution diagnostic — refresh form (9.A2γ)", () => {
  it("renders a refresh form with the Refresh GA4 traffic button", async () => {
    const html = await renderPage();
    expect(html).toContain('data-diagnostic-section="refresh"');
    expect(html).toContain('data-action="refresh-ga4-traffic"');
    expect(html).toContain("Refresh GA4 traffic");
    expect(html).toContain("<form");
  });

  it("renders an em-dash placeholder for last refresh when no rows are cached", async () => {
    _trafficRowsToReturn = [];
    const html = await renderPage();
    expect(html).toContain('data-refresh-last-synced-at=""');
    expect(html).toContain("Last refresh:");
    expect(html).toContain(">—<"); // dash placeholder
  });

  it("renders MAX(last_synced_at) when rows are present and labels row count", async () => {
    _trafficRowsToReturn = [
      {
        url: "/a",
        date: "2026-05-18",
        sessions: 10,
        engaged_sessions: 8,
        conversions: 0,
        last_synced_at: "2026-05-19T16:30:00.000Z",
      },
      {
        url: "/b",
        date: "2026-05-19",
        sessions: 3,
        engaged_sessions: 2,
        conversions: 0,
        last_synced_at: "2026-05-19T17:00:00.000Z",
      },
    ];
    const html = await renderPage();
    expect(html).toContain(
      'data-refresh-last-synced-at="2026-05-19T17:00:00.000Z"',
    );
    expect(html).toContain("2026-05-19T17:00:00.000Z");
    // 2 cached rows label
    expect(html).toContain(">2</span> cached rows");
  });

  it("includes last_synced_at in the Supabase select clause", async () => {
    _lastSelectColumns.current = "";
    await renderPage();
    expect(_lastSelectColumns.current).toContain("last_synced_at");
  });

  it("does NOT import next/cache (only the action imports revalidatePath)", () => {
    const pagePath = resolve(
      __dirname,
      "../../../src/app/(shell)/diagnostics/outcome-attribution/page.tsx",
    );
    const source = readFileSync(pagePath, "utf-8");
    const stripped = source
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped.includes('from "next/cache"')).toBe(false);
  });
});
