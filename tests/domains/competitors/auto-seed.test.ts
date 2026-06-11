/**
 * 2026-06-11 (night shift, #24) — competitor auto-seed.
 * Pins: direct-only seeding, owned/existing exclusion, nightly cap,
 * deterministic idempotent ids, dated auto-discovered tagging, and the
 * skip reasons (no data / nothing new).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  selectSeedCandidates,
  autoSeedCompetitorsForTenant,
  MAX_SEEDS_PER_NIGHT,
  type CompetitorSeedRow,
} from "@/domains/competitors/auto-seed";
import type { DiscoveryResult } from "@/domains/competitors/discover";

const NOW = new Date("2026-06-11T05:35:00Z");

function direct(domain: string, citations: number): DiscoveryResult["direct"][number] {
  return {
    domain,
    citations,
    type: "direct",
  } as unknown as DiscoveryResult["direct"][number];
}

describe("selectSeedCandidates", () => {
  it("seeds direct rivals ranked by citations, skipping owned + existing", () => {
    const rows = selectSeedCandidates({
      discovery: {
        direct: [
          direct("rival-b.com", 5),
          direct("rival-a.com", 20),
          direct("www.iranopedia.com", 99), // owned — never
          direct("already.com", 50), // configured — never
        ],
      },
      existingDomains: new Set(["already.com"]),
      ownedDomain: "iranopedia.com",
      tenantId: "tenant-iranopedia",
      now: NOW,
    });
    expect(rows.map((r) => r.domain)).toEqual(["rival-a.com", "rival-b.com"]);
    expect(rows[0]!.display_name).toBe("Rival A");
    expect(rows[0]!.tags).toEqual(["auto-discovered"]);
    expect(rows[0]!.notes).toContain("2026-06-11");
    expect(rows[0]!.notes).toContain("20 citations");
    expect(rows[0]!.status).toBe("active");
  });

  it("caps at MAX_SEEDS_PER_NIGHT", () => {
    const rows = selectSeedCandidates({
      discovery: {
        direct: Array.from({ length: MAX_SEEDS_PER_NIGHT + 5 }, (_, i) =>
          direct(`rival-${i}.com`, i),
        ),
      },
      existingDomains: new Set(),
      ownedDomain: "own.com",
      tenantId: "t",
      now: NOW,
    });
    expect(rows).toHaveLength(MAX_SEEDS_PER_NIGHT);
  });

  it("ids are deterministic per tenant+domain (idempotent re-runs)", () => {
    const args = {
      discovery: { direct: [direct("rival.com", 1)] },
      existingDomains: new Set<string>(),
      ownedDomain: "own.com",
      tenantId: "tenant-x",
      now: NOW,
    };
    const a = selectSeedCandidates(args);
    const b = selectSeedCandidates(args);
    expect(a[0]!.id).toBe(b[0]!.id);
    const other = selectSeedCandidates({ ...args, tenantId: "tenant-y" });
    expect(other[0]!.id).not.toBe(a[0]!.id);
  });
});

describe("autoSeedCompetitorsForTenant", () => {
  it("skips quietly when there's no citation data yet", async () => {
    const r = await autoSeedCompetitorsForTenant("tenant-x", {
      loadDiscovery: async () => null,
      upsertRows: async () => {
        throw new Error("must not write");
      },
    });
    expect(r).toEqual({ seeded: 0, skipped: "no_citation_data" });
  });

  it("skips when nothing new is discovered", async () => {
    const r = await autoSeedCompetitorsForTenant("tenant-x", {
      loadDiscovery: async () => ({
        discovery: { direct: [direct("already.com", 9)] } as DiscoveryResult,
        existingDomains: new Set(["already.com"]),
        ownedDomain: "own.com",
      }),
      upsertRows: async () => {
        throw new Error("must not write");
      },
    });
    expect(r).toEqual({ seeded: 0, skipped: "no_direct_competitors" });
  });

  it("persists new rivals and reports them", async () => {
    const written: CompetitorSeedRow[][] = [];
    const r = await autoSeedCompetitorsForTenant("tenant-iranopedia", {
      loadDiscovery: async () => ({
        discovery: { direct: [direct("rival.com", 12)] } as DiscoveryResult,
        existingDomains: new Set(),
        ownedDomain: "iranopedia.com",
      }),
      upsertRows: async (rows) => {
        written.push(rows);
      },
      now: NOW,
    });
    expect(r).toEqual({ seeded: 1, domains: ["rival.com"] });
    expect(written[0]![0]!.tenant_id).toBe("tenant-iranopedia");
  });
});

describe("platform-domain exclusion (caught live 2026-06-11)", () => {
  it("universal platforms are never seeded as rivals, including subdomains", () => {
    const rows = selectSeedCandidates({
      discovery: {
        direct: [
          direct("youtube.com", 50),
          direct("www.facebook.com", 40),
          direct("m.youtube.com", 30),
          direct("real-rival.com", 5),
        ],
      },
      existingDomains: new Set(),
      ownedDomain: "ritzbuilders.com",
      tenantId: "tenant-ritz-founder",
      now: new Date("2026-06-11T05:35:00Z"),
    });
    expect(rows.map((r) => r.domain)).toEqual(["real-rival.com"]);
  });
});
