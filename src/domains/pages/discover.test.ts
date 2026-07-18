import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/business-config", () => ({
  getBusinessConfig: () => ({ locations: [] }),
}));

import { discoverPages, stablePageId } from "./discover";
import type { PageEntity } from "./types";

describe("stable page registry identity", () => {
  it("derives the same id regardless of URL casing and trailing slash", () => {
    expect(stablePageId("tenant-a", "https://Example.com/Page/ ")).toBe(
      stablePageId("tenant-a", "https://example.com/page"),
    );
    expect(stablePageId("tenant-a", "https://example.com/page")).not.toBe(
      stablePageId("tenant-b", "https://example.com/page"),
    );
  });

  it("does not change ids when discovery order changes", () => {
    const make = (urls: string[]) =>
      discoverPages({
        citations: urls.map((url, index) => ({
          id: `citation-${index}`,
          url,
          domain: "example.com",
          observed_at: "2026-01-01T00:00:00.000Z",
        })) as never[],
        changes: [],
        entities: [],
        ownedDomain: "example.com",
        tenantId: "tenant-a",
      });

    const first = make(["https://example.com/a", "https://example.com/b"]);
    const second = make(["https://example.com/b", "https://example.com/a"]);
    const ids = (rows: PageEntity[]) =>
      Object.fromEntries(rows.map((row) => [row.url, row.id]));
    expect(ids(first)).toEqual(ids(second));
  });

  it("reuses a legacy id for an existing URL", () => {
    const legacy = {
      id: "pg-7",
      url: "https://example.com/a",
    } as PageEntity;
    const [page] = discoverPages({
      citations: [{
        id: "citation-1",
        url: "https://example.com/a/",
        domain: "example.com",
        observed_at: "2026-01-01T00:00:00.000Z",
      }] as never[],
      changes: [],
      entities: [],
      ownedDomain: "example.com",
      tenantId: "tenant-a",
      existingPages: [legacy],
    });
    expect(page.id).toBe("pg-7");
  });
});
