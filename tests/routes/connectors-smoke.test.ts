import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
// the connector page now reads via async Supabase. Mock the store so
// the smoke test stays disk + Supabase-agnostic.
vi.mock("@/lib/connector-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/connector-store")>(
    "@/lib/connector-store",
  );
  return {
    ...actual,
    getConnectorInfo: vi.fn(async () => ({
      status: "disconnected" as const,
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
    })),
    getGoogleConnectorToken: vi.fn(async () => null),
    getYelpConnectorToken: vi.fn(async () => null),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

vi.mock("@/domains/ops/refresh-runs-store", () => ({
  latestRefreshBySource: vi.fn(async () => ({})),
}));
vi.mock("@/domains/ops/warm-receipt-store", () => ({
  readLastWarmReceipt: vi.fn(async () => ({
    tenant_id: "tenant-iranopedia",
    date: "2026-07-17",
    ran_at: "2026-07-18T05:30:00.000Z",
    ok: true,
    totalMs: 1200,
    trigger: "visit",
    steps: [],
  })),
}));

describe("Connectors settings route smoke", () => {
  it("renders connector page with the GSC + GA4 + Clarity connector cards", async () => {
    const { default: ConnectorsPage } = await import(
      "@/app/(shell)/settings/connectors/page"
    );
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Connectors");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Connect Google Search Console");
    // Slice 9.A1β (2026-05-18) — Google Analytics card now ships in
    // the default disconnected (NOT CONNECTED) state.
    expect(html).toContain('data-connector-card="google-ga4"');
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Connect Google Analytics");
    // Yelp connector removed 2026-06-18 (operator request — not relevant to
    // content/AEO tenants). Assert the cards that DO ship instead.
    expect(html).not.toContain("Enter Yelp API Key");
    expect(html).toContain('data-connector-card="clarity"');
    // FP10a (2026-07-02) — the summary strip replaces the old five-plus-times
    // repeated "what's connected / how syncs work" paragraphs with one line
    // up top plus a single intro sentence.
    expect(html).toContain('data-connectors-summary-strip="true"');
    expect(html).toContain("connected");
    expect(html).toContain("Automatic upkeep:");
    expect(html).toContain("The only thing I never do on my own is change your live site");
    expect(html).toContain("Manual CSV/JSON import remains available");
    expect(html).not.toContain("Autopilot for proven changes");
    expect(html).not.toContain("Prepare tomorrow");
  });

  it("computes 'N of M connected' from provider reads and surfaces the on-use receipt", async () => {
    const { getConnectorInfo } = await import("@/lib/connector-store");
    vi.mocked(getConnectorInfo).mockImplementation(async (provider: string) => {
      const connected = provider === "google_gsc" || provider === "wix";
      return {
        status: connected ? "connected" : "disconnected",
        connected_at: connected ? "2026-06-01T00:00:00.000Z" : null,
        expires_at: null,
        last_synced_at: connected ? "2026-07-01T09:00:00.000Z" : null,
      };
    });

    const { default: ConnectorsPage } = await import(
      "@/app/(shell)/settings/connectors/page"
    );
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // 2 of the 4 counted self-serve sources (GSC, GA4, Wix, Clarity) are
    // connected in this mock. Profound was deliberately removed from the
    // connectors page (and no longer counts toward the total).
    expect(html).toContain("2 of 4 connected");
    expect(html).toContain("Automatic upkeep: last finished");
    expect(html).not.toContain("Last night’s sync");
  });
});
