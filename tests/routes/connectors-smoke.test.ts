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
  it("renders connector page with the GSC card + GA4 card + Yelp section", async () => {
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
    expect(html).toContain("Yelp");
    expect(html).toContain("Enter Yelp API Key");
    expect(html).toContain("Save API Key");
    // #199/#200 — Yelp card reframed to the on-demand idiom of the other
    // cards; no longer pitches "no automatic syncing" as a feature.
    expect(html).toContain("Refresh your Yelp reviews any time with Sync now");
    // #216 — persistent note that nothing runs on a schedule.
    expect(html).toContain("nothing runs on a schedule");
    expect(html).toContain("Manual CSV/JSON import remains available");
  });
});
