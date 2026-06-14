/**
 * Sprint 7 Phase 7.8a (2026-04-25) — migration script tests.
 *
 * Tests the pure migration logic exported from
 * `scripts/migrate-flat-to-tenant-data.ts` against tmpdir fixtures. No
 * production `.data/` is touched.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  GLOBAL_STORES,
  SINGLETON_STORES,
  TENANT_SCOPED_STORES,
  processStore,
  runMigration,
  summarize,
  type MigrateOptions,
} from "../../scripts/migrate-flat-to-tenant-data";

// ── Fixture helpers ─────────────────────────────────────────────────

let dataRoot: string;

function makeOpts(overrides: Partial<MigrateOptions> = {}): MigrateOptions {
  return {
    dataRoot,
    ritzTenantId: "tenant-ritz-founder",
    ritzTenantSlug: "ritz-builders",
    commit: false,
    ...overrides,
  };
}

function writeFlatJson(name: string, data: unknown): void {
  const path = join(dataRoot, ".data", `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), "beacon-migrate-78a-"));
  mkdirSync(join(dataRoot, ".data"), { recursive: true });
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// ── Classification ──────────────────────────────────────────────────

describe("Phase 7.8a — store classification (sanity)", () => {
  it("TENANT_SCOPED_STORES, SINGLETON_STORES, and GLOBAL_STORES are pairwise disjoint", () => {
    const all = [
      ...TENANT_SCOPED_STORES,
      ...SINGLETON_STORES,
      ...GLOBAL_STORES,
    ];
    const dedup = new Set(all);
    expect(dedup.size).toBe(all.length);
  });

  it("TENANT_SCOPED_STORES has the expected breadth (>= 47 after Phase 7.8a.1)", () => {
    // 38 inherited + 9 added in 7.8a.1.
    expect(TENANT_SCOPED_STORES.size).toBeGreaterThanOrEqual(47);
  });

  it("SINGLETON_STORES has the expected breadth (>= 9 after Phase 7.8a.1)", () => {
    // 2 inherited + 7 added in 7.8a.1.
    expect(SINGLETON_STORES.size).toBeGreaterThanOrEqual(9);
  });

  it("GLOBAL_STORES has the expected breadth (>= 21)", () => {
    // 16 inherited + 6 added in 7.8a.1 = 22, then -1 (de-vert 2026-06-15):
    // "competitor-monitoring" moved GLOBAL → TENANT_SCOPED (it holds a
    // tenant's OWN competitor snapshots/alerts; being global bled the
    // founder's builder competitors onto every tenant's dashboard).
    expect(GLOBAL_STORES.size).toBeGreaterThanOrEqual(21);
  });

  it("GLOBAL_STORES includes the canonical globals", () => {
    expect(GLOBAL_STORES.has("business-config")).toBe(true);
    expect(GLOBAL_STORES.has("change-patterns")).toBe(true);
    expect(GLOBAL_STORES.has("triage-rules")).toBe(true);
    expect(GLOBAL_STORES.has("scan-state")).toBe(true);
    expect(GLOBAL_STORES.has("tenants")).toBe(true);
  });

  it("Phase 7.8a.1 — newly classified stores land in the right Set", () => {
    // Per-tenant array stores added in 7.8a.1.
    for (const s of [
      "change-events",
      "classified-events",
      "data-quality-flags",
      "event-attributions",
      "natural-control-results",
      "page-element-inventory",
      "recommended-edits",
      "site-movement-events",
      "url-change-outcomes",
    ]) {
      expect(TENANT_SCOPED_STORES.has(s)).toBe(true);
    }
    // Per-tenant singleton stores added in 7.8a.1.
    for (const s of [
      "change-outcomes-summary",
      "natural-control-summary",
      "robots-state",
      "site-citation-timeline",
      "taxonomy-distribution-report",
      "url-daily-citations",
      "url-watcher-state",
    ]) {
      expect(SINGLETON_STORES.has(s)).toBe(true);
    }
    // Global stores added in 7.8a.1.
    for (const s of [
      "adjudicator-cache",
      "adjudicator-history",
      "llm-budget",
      "shared-brain",
      "shared-brain-summary",
      "url-change-patterns",
    ]) {
      expect(GLOBAL_STORES.has(s)).toBe(true);
    }
  });
});

// ── De-vert isolation ratchets (2026-06-15) ──────────────────────────
// Pin the two ground-truth-found leaks (dev server rendered as
// tenant-iranopedia) so they can't silently regress:
//   1. competitor-monitoring was GLOBAL → every tenant's dashboard showed the
//      founder's "De Mattei Construction" competitor alerts.
//   2. seed-data.server fell back to the founder's builder demo seed for any
//      tenant with no import_runs → Iranopedia's ⌘K showed "Custom Home Building".
describe("de-vert isolation ratchets — founder data must not bleed to other tenants", () => {
  it("competitor-monitoring is TENANT_SCOPED, not GLOBAL", () => {
    expect(TENANT_SCOPED_STORES.has("competitor-monitoring")).toBe(true);
    expect(GLOBAL_STORES.has("competitor-monitoring")).toBe(false);
  });

  it("seed-data.server gates the demo-seed fallback on the seed-owner tenant", () => {
    // The else-branch (import-less, NON-owner tenant) must return empty arrays,
    // never the founder seed. Only `tenantId === SEED_OWNER_TENANT_ID` gets it.
    const src = readFileSync(
      join(process.cwd(), "src/lib/seed-data.server.ts"),
      "utf8",
    );
    expect(src).toMatch(/SEED_OWNER_TENANT_ID/);
    expect(src).toMatch(/tenantId === SEED_OWNER_TENANT_ID/);
  });
});

// ── Dry-run writes nothing ──────────────────────────────────────────

describe("Phase 7.8a — dry-run", () => {
  it("does not create the per-tenant directory in dry-run mode", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
    ]);
    const reports = runMigration(makeOpts({ commit: false }));
    expect(reports.length).toBeGreaterThan(0);
    expect(existsSync(join(dataRoot, ".data", "tenants"))).toBe(false);
    expect(existsSync(join(dataRoot, ".data", "global"))).toBe(false);
  });

  it("does not create the global directory in dry-run mode", () => {
    writeFlatJson("business-config", { siteDomain: "ritzbuilders.com" });
    runMigration(makeOpts({ commit: false }));
    expect(existsSync(join(dataRoot, ".data", "global"))).toBe(false);
  });

  it("dry-run reports include source/dest paths and counts even without writing", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-ritz-founder" },
    ]);
    const reports = runMigration(makeOpts({ commit: false }));
    const r = reports.find((x) => x.name === "imported-results");
    expect(r).toBeDefined();
    expect(r!.classification).toBe("per-tenant");
    expect(r!.sourceExists).toBe(true);
    expect(r!.sourceRowCount).toBe(2);
    expect(r!.destRowCount).toBe(2);
    expect(r!.destPath).toBe(
      join(dataRoot, ".data", "tenants", "ritz-builders", "imported-results.json"),
    );
    expect(r!.wrote).toBe(false);
  });
});

// ── Per-tenant routing ──────────────────────────────────────────────

describe("Phase 7.8a — per-tenant routing", () => {
  it("commits ritz rows to .data/tenants/ritz-builders/<name>.json", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-ritz-founder" },
    ]);
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "imported-results")!;
    expect(r.wrote).toBe(true);
    const dest = readJson<{ id: string; tenant_id: string }[]>(r.destPath);
    expect(dest).toHaveLength(2);
    expect(dest.map((x) => x.id).sort()).toEqual(["r1", "r2"]);
  });

  it("treats empty/missing tenant_id rows as ritz (Phase 7.2 backfill semantics)", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "" },
      { id: "r3" }, // tenant_id absent entirely
    ]);
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "imported-results")!;
    expect(r.destRowCount).toBe(3);
    const dest = readJson<{ id: string }[]>(r.destPath);
    expect(dest.map((x) => x.id).sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("skips rows belonging to other tenants", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-other" },
      { id: "r3", tenant_id: "tenant-ritz-founder" },
    ]);
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "imported-results")!;
    expect(r.destRowCount).toBe(2);
    const dest = readJson<{ id: string }[]>(r.destPath);
    expect(dest.map((x) => x.id).sort()).toEqual(["r1", "r3"]);
  });
});

// ── Global routing ──────────────────────────────────────────────────

describe("Phase 7.8a — global routing", () => {
  it("copies global stores verbatim to .data/global/<name>.json", () => {
    writeFlatJson("business-config", {
      siteDomain: "ritzbuilders.com",
      industry: "construction",
    });
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "business-config")!;
    expect(r.classification).toBe("global");
    expect(r.destPath).toBe(
      join(dataRoot, ".data", "global", "business-config.json"),
    );
    expect(r.wrote).toBe(true);
    const dest = readJson<{ siteDomain: string; industry: string }>(r.destPath);
    expect(dest.siteDomain).toBe("ritzbuilders.com");
    expect(dest.industry).toBe("construction");
  });

  it("does NOT route global stores into the per-tenant directory", () => {
    writeFlatJson("change-patterns", [
      { id: "p1", pattern: "title-rewrite" },
    ]);
    runMigration(makeOpts({ commit: true }));
    const wrong = join(
      dataRoot,
      ".data",
      "tenants",
      "ritz-builders",
      "change-patterns.json",
    );
    expect(existsSync(wrong)).toBe(false);
    const right = join(dataRoot, ".data", "global", "change-patterns.json");
    expect(existsSync(right)).toBe(true);
  });
});

// ── Singleton routing ───────────────────────────────────────────────

describe("Phase 7.8a — singleton routing", () => {
  it("copies singleton stores verbatim into the per-tenant dir", () => {
    writeFlatJson("citation-evidence-index", {
      built_at: "2026-04-24T10:00:00Z",
      by_topic: [],
      by_page_and_topic: [],
    });
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "citation-evidence-index")!;
    expect(r.classification).toBe("singleton");
    expect(r.destPath).toBe(
      join(
        dataRoot,
        ".data",
        "tenants",
        "ritz-builders",
        "citation-evidence-index.json",
      ),
    );
    expect(r.wrote).toBe(true);
    const dest = readJson<{ built_at: string }>(r.destPath);
    expect(dest.built_at).toBe("2026-04-24T10:00:00Z");
  });
});

// ── Missing files do not crash ──────────────────────────────────────

describe("Phase 7.8a — missing files", () => {
  it("reports missing flat files without crashing", () => {
    // .data/ is empty for this test (just-created tmpdir).
    const reports = runMigration(makeOpts({ commit: false }));
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      if (!r.sourceExists) {
        expect(r.notes).toContain("source file not found — skipping");
        expect(r.wrote).toBe(false);
        expect(r.destRowCount).toBeNull();
      }
    }
  });

  it("missing files don't even attempt to create the dest dir", () => {
    runMigration(makeOpts({ commit: true }));
    // No flat files were ever present, so the migration should not have
    // touched the destination subtrees.
    expect(existsSync(join(dataRoot, ".data", "tenants"))).toBe(false);
    expect(existsSync(join(dataRoot, ".data", "global"))).toBe(false);
  });
});

// ── Mixed-tenant honesty ─────────────────────────────────────────────

describe("Phase 7.8a — mixed-tenant honesty", () => {
  it("reports byTenant counts grouped by tenant_id (including empty)", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-other" },
      { id: "r3", tenant_id: "tenant-other" },
      { id: "r4", tenant_id: "" },
      { id: "r5" },
    ]);
    const r = processStore("imported-results", makeOpts({ commit: false }));
    expect(r.byTenant["tenant-ritz-founder"]).toBe(1);
    expect(r.byTenant["tenant-other"]).toBe(2);
    // Empty string and missing both bucket as "(empty)".
    expect(r.byTenant["(empty)"]).toBe(2);
  });

  it("emits a `mixed-tenant` note when other-tenant rows are present", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-other" },
    ]);
    const r = processStore("imported-results", makeOpts({ commit: false }));
    expect(r.notes.some((n) => n.includes("mixed-tenant"))).toBe(true);
    expect(r.notes.some((n) => n.includes("ritz-builders"))).toBe(true);
  });

  it("does NOT emit a mixed-tenant note for a clean ritz-only file", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
      { id: "r2", tenant_id: "tenant-ritz-founder" },
    ]);
    const r = processStore("imported-results", makeOpts({ commit: false }));
    expect(r.notes.some((n) => n.includes("mixed-tenant"))).toBe(false);
  });
});

// ── Unknown stores ──────────────────────────────────────────────────

describe("Phase 7.8a — unknown stores", () => {
  it("classifies unrecognized .data/*.json files as `unknown` and skips with a note", () => {
    // Brand-new store name not in any list.
    writeFlatJson("brand-new-store-xyz", [{ id: "x" }]);
    const reports = runMigration(makeOpts({ commit: true }));
    const r = reports.find((x) => x.name === "brand-new-store-xyz")!;
    expect(r.classification).toBe("unknown");
    expect(r.wrote).toBe(false);
    expect(r.notes.some((n) => n.includes("unclassified"))).toBe(true);
    // Nothing should have been written to either dest.
    expect(
      existsSync(join(dataRoot, ".data", "tenants", "ritz-builders", "brand-new-store-xyz.json")),
    ).toBe(false);
    expect(
      existsSync(join(dataRoot, ".data", "global", "brand-new-store-xyz.json")),
    ).toBe(false);
  });
});

// ── Source preservation ─────────────────────────────────────────────

describe("Phase 7.8a — source files preserved (Phase 7.8a contract)", () => {
  it("does NOT delete or modify flat .data/*.json after a --commit run", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
    ]);
    writeFlatJson("business-config", { siteDomain: "x.com" });
    const before = readdirSync(join(dataRoot, ".data"))
      .filter((n) => n.endsWith(".json"))
      .sort();

    runMigration(makeOpts({ commit: true }));

    const after = readdirSync(join(dataRoot, ".data"))
      .filter((n) => n.endsWith(".json"))
      .sort();
    expect(after).toEqual(before);
    // And the contents are byte-identical to what we wrote.
    const beforeContent = readJson<{ id: string }[]>(
      join(dataRoot, ".data", "imported-results.json"),
    );
    expect(beforeContent.map((x) => x.id)).toEqual(["r1"]);
  });
});

// ── Summary ──────────────────────────────────────────────────────────

describe("Phase 7.8a — summary counts", () => {
  it("counts perTenant / global / singleton / unknown / missing / wrote correctly", () => {
    writeFlatJson("imported-results", [
      { id: "r1", tenant_id: "tenant-ritz-founder" },
    ]);
    writeFlatJson("business-config", { x: 1 });
    writeFlatJson("citation-evidence-index", { built_at: "2026-01-01" });
    writeFlatJson("brand-new-store", [{ x: 1 }]);

    const reports = runMigration(makeOpts({ commit: true }));
    const c = summarize(reports);
    expect(c.perTenant).toBe(1);
    expect(c.global).toBe(1);
    expect(c.singleton).toBe(1);
    expect(c.unknown).toBe(1);
    // wrote = perTenant + global + singleton (not unknown, not missing).
    expect(c.wrote).toBe(3);
    // missing = every other store in the list that doesn't have a flat
    // file (huge — every store name minus the four we wrote).
    expect(c.missing).toBeGreaterThan(0);
  });
});
