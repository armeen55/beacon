import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { _deleteStoreFile } from "@/lib/connector-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/connectors",
}));

describe("Connectors settings route smoke", () => {
  beforeEach(() => {
    _deleteStoreFile();
  });

  afterEach(() => {
    _deleteStoreFile();
  });

  it("renders connector page with Google section and disclosure", async () => {
    const { default: ConnectorsPage } = await import(
      "@/app/(shell)/settings/connectors/page"
    );
    const tree = await ConnectorsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Review connectors");
    expect(html).toContain("Google Business Profile");
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect Google");
    expect(html).toContain("No data is imported automatically yet");
    expect(html).toContain("Yelp");
    expect(html).toContain("Enter Yelp API Key");
    expect(html).toContain("Save API Key");
    expect(html).toContain("Pulls reviews from Yelp on demand");
    expect(html).toContain("No automatic syncing");
    expect(html).toContain("Manual CSV/JSON import remains available");
  });
});
