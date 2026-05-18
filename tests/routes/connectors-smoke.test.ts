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
  it("renders connector page with the GSC card + Yelp section", async () => {
    const { default: ConnectorsPage } = await import(
      "@/app/(shell)/settings/connectors/page"
    );
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Connectors");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect Google Search Console");
    expect(html).toContain("Yelp");
    expect(html).toContain("Enter Yelp API Key");
    expect(html).toContain("Save API Key");
    expect(html).toContain("Pulls reviews from Yelp on demand");
    expect(html).toContain("No automatic syncing");
    expect(html).toContain("Manual CSV/JSON import remains available");
  });
});
