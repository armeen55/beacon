/**
 * Link-graph feed tests (2026-06-12 night shift) — the scoped
 * internal_links read that un-starves the cross-page link triggers on
 * hosted/cron (the egress-lean snapshot projection deliberately omits
 * the field; orphan_page + internal_link_opportunity were silently
 * emission-less without this).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type {
  PageSnapshotLinkGraph,
  SeedDataRepository,
} from "@/lib/persistence/repositories/types";

function graph(over: Partial<PageSnapshotLinkGraph>): PageSnapshotLinkGraph {
  return {
    page_id: "p1",
    url: "https://iranopedia.com/a",
    fetched_at: "2026-06-12T04:00:00Z",
    tenant_id: "tenant-iranopedia",
    internal_links: [{ href: "/b", anchor_text: "b" }],
    ...over,
  };
}

describe("getPageSnapshotLinkGraphs — tenant scoping", () => {
  it("forTenant filters the base rows by tenant_id", async () => {
    const base = {
      getPageSnapshotLinkGraphs: async () => [
        graph({ page_id: "p1", tenant_id: "tenant-iranopedia" }),
        graph({ page_id: "p2", tenant_id: "tenant-ritz-founder" }),
      ],
    } as unknown as SeedDataRepository;
    const repo = buildTenantRepo(base, "tenant-iranopedia");
    const rows = await repo.getPageSnapshotLinkGraphs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page_id).toBe("p1");
  });
});
