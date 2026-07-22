/**
 * 2026-06-16 — Phase 1 (MAX_SEO_AEO audit P0 #1): durable, tenant-scoped Wix
 * mappings store. Pins:
 *   • persistence round-trip through Supabase (save → get),
 *   • TENANT ISOLATION (tenant A's config/map never visible to tenant B; every
 *     read filters by the ambient tenant_id; every written row is stamped with
 *     the ambient tenant_id — never another tenant's),
 *   • contentFieldRoles (the live-push field map) survives the round-trip,
 *   • DURABLE non-destructive REPLACE (upsert + delete-stale): a re-save updates
 *     in place + removes only absent keys, never wiping another tenant; empty
 *     save clears the tenant,
 *   • FILE FALLBACK when Supabase env is absent OR the table isn't migrated
 *     (undefined_table 42P01) — pre-migration / local dev keeps today's behavior,
 *   • push readiness: writeWixUrlMap → resolveWixItemForUrl resolves the item.
 *
 * Tenant is the AMBIENT request tenant (currentTenantId) for both the Supabase
 * and file paths — no explicit override — so isolation is exercised by switching
 * the mocked ambient tenant. A fake in-memory Supabase admin simulates real
 * per-tenant persistence (upsert-by-PK + scoped delete) so the assertions are
 * behavioral, not just call-shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { WixCollectionMapping, WixUrlMapEntry } from "@/lib/connectors/wix/types";

// ── hoisted mock state ────────────────────────────────────────────────
const mockState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "no_env" | "no_table",
  tables: new Map<string, Array<Record<string, unknown>>>(),
  tenant: "tenant-default",
  files: new Map<string, unknown[]>(),
}));

const PK = {
  wix_collection_config: ["tenant_id", "data_collection_id"],
  wix_url_map: ["tenant_id", "url"],
} as Record<string, string[]>;

function tableRows(name: string): Array<Record<string, unknown>> {
  if (!mockState.tables.has(name)) mockState.tables.set(name, []);
  return mockState.tables.get(name)!;
}

const undef = { code: "42P01" };

function fakeAdmin() {
  return {
    from(table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: unknown) {
              if (mockState.mode === "no_table") return Promise.resolve({ data: null, error: undef });
              return Promise.resolve({ data: tableRows(table).filter((r) => r[col] === val), error: null });
            },
          };
        },
        upsert(newRows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) {
          if (mockState.mode === "no_table") return Promise.resolve({ error: undef });
          const conflict = (opts?.onConflict ?? PK[table]?.join(",") ?? "").split(",");
          const arr = tableRows(table);
          for (const nr of newRows) {
            const idx = arr.findIndex((r) => conflict.every((k) => r[k] === nr[k]));
            if (idx >= 0) arr[idx] = { ...nr };
            else arr.push({ ...nr });
          }
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(eqCol: string, eqVal: unknown) {
              return {
                in(inCol: string, list: unknown[]) {
                  if (mockState.mode === "no_table") return Promise.resolve({ error: undef });
                  const set = new Set(list);
                  mockState.tables.set(
                    table,
                    tableRows(table).filter((r) => !(r[eqCol] === eqVal && set.has(r[inCol]))),
                  );
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (mockState.mode === "no_env") throw new Error("no supabase env");
    return fakeAdmin();
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => mockState.tenant,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => mockState.files.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    mockState.files.set(name, data);
  },
}));

import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  getWixUrlMap,
  writeWixUrlMap,
} from "@/lib/connectors/wix/mappings-store";
import { resolveWixItemForUrl } from "@/lib/connectors/wix/url-map";

const MAPPING_A: WixCollectionMapping = {
  dataCollectionId: "Recipes",
  slugField: "slug",
  urlPrefix: "/persian-food",
  labelField: "title",
  contentFieldRoles: { title: "seoTitle", heading: "h1", description: "metaDesc" },
};
const ENTRY_A: WixUrlMapEntry = {
  url: "https://iranopedia.com/persian-food/kabob",
  dataCollectionId: "Recipes",
  dataItemId: "item-1",
  slugField: "slug",
  label: "Kabob",
  syncedAt: "2026-06-16T00:00:00.000Z",
};

beforeEach(() => {
  mockState.mode = "ok";
  mockState.tables = new Map();
  mockState.files = new Map();
  mockState.tenant = "tenant-default";
});

describe("wix mappings-store — Supabase persistence + tenant isolation", () => {
  it("collection-config round-trips through Supabase (incl. contentFieldRoles)", async () => {
    mockState.tenant = "tenant-a";
    await saveWixCollectionConfig([MAPPING_A]);
    const got = await getWixCollectionConfig();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      dataCollectionId: "Recipes",
      slugField: "slug",
      urlPrefix: "/persian-food",
      labelField: "title",
      contentFieldRoles: { title: "seoTitle", heading: "h1", description: "metaDesc" },
    });
  });


  it("TENANT ISOLATION — tenant A's config is invisible to tenant B + every row stamped tenant-a", async () => {
    mockState.tenant = "tenant-a";
    await saveWixCollectionConfig([MAPPING_A]);
    mockState.tenant = "tenant-b";
    expect(await getWixCollectionConfig()).toEqual([]);
    const rows = mockState.tables.get("wix_collection_config") ?? [];
    expect(rows.every((r) => r.tenant_id === "tenant-a")).toBe(true);
  });

  it("TENANT ISOLATION — tenant A's url map is invisible to tenant B", async () => {
    mockState.tenant = "tenant-a";
    await writeWixUrlMap([ENTRY_A]);
    mockState.tenant = "tenant-b";
    expect(await getWixUrlMap()).toEqual([]);
  });

  it("authoritativeCollectionIds scopes stale-delete — a transiently-failed collection's rows are PRESERVED, not wiped", async () => {
    mockState.tenant = "tenant-a";
    // Seed: collection A (2 pages) + collection B (1 page) already mapped.
    const mk = (url: string, col: string, id: string): WixUrlMapEntry => ({
      url, dataCollectionId: col, dataItemId: id, slugField: "slug", label: null, syncedAt: "2026-06-16T00:00:00.000Z",
    });
    await writeWixUrlMap([mk("https://x/a1", "A", "a1"), mk("https://x/a2", "A", "a2"), mk("https://x/b1", "B", "b1")]);
    // Re-sync where ONLY A succeeded (B's query transiently failed → not in
    // entries, not authoritative). A now resolves to just a1 (a2 dropped).
    await writeWixUrlMap([mk("https://x/a1", "A", "a1")], { authoritativeCollectionIds: ["A"] });
    const urls = (await getWixUrlMap()).map((e) => e.url).sort();
    // a2 = stale within authoritative A → deleted; b1 = collection B (NOT
    // authoritative this run) → PRESERVED (no wipe on partial sync).
    expect(urls).toEqual(["https://x/a1", "https://x/b1"]);
  });

  it("authoritative collection that synced to ZERO items still clears its rows", async () => {
    mockState.tenant = "tenant-a";
    const mk = (url: string, col: string, id: string): WixUrlMapEntry => ({
      url, dataCollectionId: col, dataItemId: id, slugField: "slug", label: null, syncedAt: "2026-06-16T00:00:00.000Z",
    });
    await writeWixUrlMap([mk("https://x/a1", "A", "a1"), mk("https://x/b1", "B", "b1")]);
    // Both A and B synced OK this run, but A returned zero items (authoritative + empty).
    await writeWixUrlMap([mk("https://x/b1", "B", "b1")], { authoritativeCollectionIds: ["A", "B"] });
    expect((await getWixUrlMap()).map((e) => e.url)).toEqual(["https://x/b1"]); // A's a1 cleared
  });

  it("durable REPLACE — a save updates in place + drops only absent keys", async () => {
    mockState.tenant = "tenant-a";
    await saveWixCollectionConfig([
      MAPPING_A,
      { dataCollectionId: "Names", slugField: "slug", urlPrefix: "/persian-names" },
    ]);
    await saveWixCollectionConfig([MAPPING_A]); // drop Names, keep Recipes
    const got = await getWixCollectionConfig();
    expect(got.map((m) => m.dataCollectionId)).toEqual(["Recipes"]);
  });


  it("does NOT clobber tenant B when tenant A re-saves", async () => {
    mockState.tenant = "tenant-a";
    await saveWixCollectionConfig([MAPPING_A]);
    mockState.tenant = "tenant-b";
    await saveWixCollectionConfig([{ dataCollectionId: "Cities", slugField: "slug", urlPrefix: "/cities" }]);
    mockState.tenant = "tenant-a";
    await saveWixCollectionConfig([MAPPING_A]); // re-save A
    mockState.tenant = "tenant-b";
    expect((await getWixCollectionConfig()).map((m) => m.dataCollectionId)).toEqual(["Cities"]);
  });
});

describe("wix mappings-store — file fallback (no-env / pre-migration)", () => {
  it("no Supabase env → reads/writes the file store (today's behavior)", async () => {
    mockState.mode = "no_env";
    await saveWixCollectionConfig([MAPPING_A]);
    expect(mockState.files.get("wix-collection-config")).toEqual([MAPPING_A]);
    expect(await getWixCollectionConfig()).toEqual([MAPPING_A]);
  });

  it("undefined_table (42P01, not yet migrated) → falls back to the file store", async () => {
    mockState.mode = "no_table";
    await saveWixCollectionConfig([MAPPING_A]);
    expect(mockState.files.get("wix-collection-config")).toEqual([MAPPING_A]);
    expect(await getWixCollectionConfig()).toEqual([MAPPING_A]);
  });

  it("url-map also soft-falls to the file store on undefined_table", async () => {
    mockState.mode = "no_table";
    await writeWixUrlMap([ENTRY_A]);
    expect(mockState.files.get("wix-url-map")).toEqual([ENTRY_A]);
    expect(await getWixUrlMap()).toEqual([ENTRY_A]);
  });
});

describe("wix mappings-store — push readiness", () => {
  it("writeWixUrlMap → resolveWixItemForUrl resolves the CMS item", async () => {
    mockState.tenant = "tenant-a";
    await writeWixUrlMap([ENTRY_A]);
    const resolved = await resolveWixItemForUrl("https://iranopedia.com/persian-food/kabob");
    expect(resolved?.dataItemId).toBe("item-1");
  });
});
