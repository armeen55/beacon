/**
 * PLATFORM — json-store + dotdata-json runtime routing (Core 100K terminal
 * suite; merged from tests/lib/persistence/{json-store-routing,
 * dotdata-json-routing, json-store-vercel, link-graph-feed}).
 *
 * Boundary pins:
 *   - per-tenant stores route to .data/tenants/{slug}/{name}.json, global
 *     stores to .data/global/{name}.json; neither ever consults a flat file,
 *   - tenant isolation: another tenant's routed file is never read,
 *   - unknown store names throw fail-loud (the anti-cross-tenant-leak guard),
 *   - the import-runs anti-race guard refuses to blank a non-empty file,
 *   - VERCEL=1 with no .data dir stays safe (no mkdir, in-memory cache),
 *   - the tenant-repo link-graph feed filters by tenant_id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantSlug: vi.fn(async () => "ritz-builders"),
}));

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { readDotDataJson, writeDotDataJson } from "@/lib/persistence/dotdata-json";
import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type { PageSnapshotLinkGraph, SeedDataRepository } from "@/lib/persistence/repositories/types";
import { currentTenantSlug } from "@/lib/tenant-context";

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "beacon-platform-routing-")));
  mkdirSync(join(tmpRoot, ".data", "global"), { recursive: true });
  mkdirSync(join(tmpRoot, ".data", "tenants", "ritz-builders"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("ritz-builders");
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
  // Module-level caches persist across tests in this file; each test uses
  // distinct store names so cache keys never collide across cases.
});

describe("readStore routing", () => {
  it("reads a per-tenant store from .data/tenants/{slug}/{name}.json", async () => {
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "ritz-builders", "imported-results.json"),
      JSON.stringify([{ id: "tenant-row" }]),
    );
    expect(await readStore<{ id: string }[]>("imported-results")).toEqual([{ id: "tenant-row" }]);
  });

  it("reads a global store from .data/global/{name}.json regardless of tenant", async () => {
    writeFileSync(join(tmpRoot, ".data", "global", "triage-rules.json"), JSON.stringify([{ id: "rule-1" }]));
    const a = await readStore<{ id: string }>("triage-rules");
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    const b = await readStore<{ id: string }>("triage-rules");
    expect(a).toEqual(b);
    expect(a).toEqual([{ id: "rule-1" }]);
  });

  it("does not see another tenant's data (isolation)", async () => {
    mkdirSync(join(tmpRoot, ".data", "tenants", "other"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "other", "imported-changes.json"),
      JSON.stringify([{ id: "other-row" }]),
    );
    expect(await readStore<{ id: string }>("imported-changes")).toEqual([]);
  });

  it("never falls back to a flat .data file for a routed store", async () => {
    writeFileSync(join(tmpRoot, ".data", "pages.json"), JSON.stringify([{ id: "flat-row" }]));
    expect(await readStore<{ id: string }>("pages")).toEqual([]);
  });

  it("throws fail-loud on an unclassified store name, naming the three Sets", async () => {
    await expect(readStore<{ id: string }>("brand-new-unclassified-store")).rejects.toThrow(
      /unknown store 'brand-new-unclassified-store'.*store-classification\.ts/,
    );
    await expect(readStore<{ id: string }>("another-mystery-store")).rejects.toThrow(
      /TENANT_SCOPED_STORES[\s\S]*SINGLETON_STORES[\s\S]*GLOBAL_STORES/,
    );
  });
});

describe("writeStore routing", () => {
  it("writes per-tenant to the routed subdir and never the flat path", async () => {
    await writeStore("imported-results", [{ id: "wrote-tenant" }]);
    const tenantPath = join(tmpRoot, ".data", "tenants", "ritz-builders", "imported-results.json");
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([{ id: "wrote-tenant" }]);
    expect(existsSync(join(tmpRoot, ".data", "imported-results.json"))).toBe(false);
  });

  it("writes global stores to .data/global and not the tenant subdir", async () => {
    await writeStore("change-patterns", [{ id: "global-pattern" }]);
    expect(existsSync(join(tmpRoot, ".data", "global", "change-patterns.json"))).toBe(true);
    expect(existsSync(join(tmpRoot, ".data", "tenants", "ritz-builders", "change-patterns.json"))).toBe(false);
  });

  it("throws on an unclassified store name and writes nothing", async () => {
    await expect(writeStore("brand-new-unclassified-store", [{ x: 42 }])).rejects.toThrow(
      /unknown store 'brand-new-unclassified-store'/,
    );
    expect(existsSync(join(tmpRoot, ".data", "brand-new-unclassified-store.json"))).toBe(false);
  });
});

describe("import-runs anti-race guard", () => {
  it("refuses to overwrite a non-empty per-tenant import-runs.json with []", async () => {
    const tenantPath = join(tmpRoot, ".data", "tenants", "ritz-builders", "import-runs.json");
    writeFileSync(tenantPath, JSON.stringify([{ id: "preexisting-run" }]));
    await writeStore("import-runs", [] as unknown[]);
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([{ id: "preexisting-run" }]);
  });

  it("evaluates the guard per tenant: another tenant's data never blocks this tenant's write", async () => {
    const ritzPath = join(tmpRoot, ".data", "tenants", "ritz-builders", "import-runs.json");
    writeFileSync(ritzPath, JSON.stringify([{ id: "ritz-run" }]));
    (currentTenantSlug as ReturnType<typeof vi.fn>).mockResolvedValue("acme");
    mkdirSync(join(tmpRoot, ".data", "tenants", "acme"), { recursive: true });
    await writeStore("import-runs", [{ id: "acme-run" }]);
    expect(
      JSON.parse(readFileSync(join(tmpRoot, ".data", "tenants", "acme", "import-runs.json"), "utf8")),
    ).toEqual([{ id: "acme-run" }]);
    expect(JSON.parse(readFileSync(ritzPath, "utf8"))).toEqual([{ id: "ritz-run" }]);
  });
});

describe("readDotDataJson / writeDotDataJson routing", () => {
  it("routes per-tenant and singleton stores to the tenant subdir", async () => {
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "ritz-builders", "page-snapshots.json"),
      JSON.stringify([{ id: "tenant-row" }]),
    );
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "ritz-builders", "citation-evidence-index.json"),
      JSON.stringify({ built_at: "2026-01-01" }),
    );
    expect(await readDotDataJson<{ id: string }[]>("page-snapshots")).toEqual([{ id: "tenant-row" }]);
    expect(await readDotDataJson<{ built_at: string }>("citation-evidence-index")).toEqual({
      built_at: "2026-01-01",
    });
  });

  it("returns null (never the flat file) when the routed file is missing", async () => {
    writeFileSync(join(tmpRoot, ".data", "page-snapshots.json"), JSON.stringify([{ id: "flat-row" }]));
    expect(await readDotDataJson<{ id: string }[]>("page-snapshots")).toBeNull();
  });

  it("does not see another tenant's routed file", async () => {
    mkdirSync(join(tmpRoot, ".data", "tenants", "other"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".data", "tenants", "other", "page-snapshots.json"),
      JSON.stringify([{ id: "other-row" }]),
    );
    expect(await readDotDataJson<{ id: string }[]>("page-snapshots")).toBeNull();
  });

  it("throws fail-loud on an unclassified store name", async () => {
    await expect(readDotDataJson("brand-new-unclassified-blob")).rejects.toThrow(
      /unknown store 'brand-new-unclassified-blob'.*store-classification\.ts/,
    );
    await expect(writeDotDataJson("brand-new-unclassified-blob", { x: 42 })).rejects.toThrow(
      /unknown store 'brand-new-unclassified-blob'/,
    );
    expect(existsSync(join(tmpRoot, ".data", "brand-new-unclassified-blob.json"))).toBe(false);
  });

  it("writes to the routed subdir, creating it when missing, never the flat path", async () => {
    rmSync(join(tmpRoot, ".data", "tenants"), { recursive: true });
    await writeDotDataJson("page-snapshots", [{ id: "auto-mkdir" }]);
    const tenantPath = join(tmpRoot, ".data", "tenants", "ritz-builders", "page-snapshots.json");
    expect(JSON.parse(readFileSync(tenantPath, "utf8"))).toEqual([{ id: "auto-mkdir" }]);
    expect(existsSync(join(tmpRoot, ".data", "page-snapshots.json"))).toBe(false);
  });
});

describe("VERCEL=1 with no .data dir stays safe (hosted contract)", () => {
  const previousVercel = process.env.VERCEL;
  let hostedCwd: string | null = null;

  beforeEach(() => {
    process.env.VERCEL = "1";
    hostedCwd = mkdtempSync(join(tmpdir(), "beacon-vercel-safe-"));
    // Intentionally NO .data inside hostedCwd.
    process.chdir(hostedCwd);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (hostedCwd) rmSync(hostedCwd, { recursive: true, force: true });
    hostedCwd = null;
  });

  it("read + write + read round-trips through the in-memory cache and never creates .data", async () => {
    const { readStore: read2, writeStore: write2 } = await import("@/lib/persistence/json-store");
    expect(await read2<{ id: string }>("change-patterns")).toEqual([]);
    await expect(write2("change-patterns", [{ id: "x" }])).resolves.toBeUndefined();
    expect(await read2<{ id: string }>("change-patterns")).toEqual([{ id: "x" }]);
    expect(existsSync(join(hostedCwd!, ".data"))).toBe(false);
  });
});

describe("tenant-repo link-graph feed", () => {
  it("getPageSnapshotLinkGraphs filters the base rows by tenant_id", async () => {
    const graph = (over: Partial<PageSnapshotLinkGraph>): PageSnapshotLinkGraph => ({
      page_id: "p1",
      url: "https://iranopedia.com/a",
      fetched_at: "2026-06-12T04:00:00Z",
      tenant_id: "tenant-iranopedia",
      internal_links: [{ href: "/b", anchor_text: "b" }],
      ...over,
    });
    const base = {
      getPageSnapshotLinkGraphs: async () => [
        graph({ page_id: "p1", tenant_id: "tenant-iranopedia" }),
        graph({ page_id: "p2", tenant_id: "tenant-ritz-founder" }),
      ],
    } as unknown as SeedDataRepository;
    const rows = await buildTenantRepo(base, "tenant-iranopedia").getPageSnapshotLinkGraphs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page_id).toBe("p1");
  });
});
