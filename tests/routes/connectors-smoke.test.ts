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
    // 2026-06-22 — connectors auto-refresh on use (no hidden always-on cron);
    // the intro now says it keeps sources fresh automatically while you use it.
    expect(html).toContain("keeps your data fresh on its own");
    expect(html).toContain("never runs in the background");
    expect(html).toContain("Manual CSV/JSON import remains available");
  });
});
