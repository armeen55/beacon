/**
 * BEACON_500 item 2 (2026-07-01): the body-field mapping model.
 * Pins:
 *   - bodyField round-trips through the Supabase store (packed into the
 *     existing content_field_roles jsonb under __bodyField, so NO schema
 *     migration is needed) and through the file fallback,
 *   - old rows WITHOUT a body field still parse (backward compatible),
 *   - malformed stored body fields degrade to "no body field" (paste-only),
 *   - resolveWixBodyFieldForUrl walks url -> item -> collection ->
 *     bodyField and refuses slug-ish keys and unknown kinds.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { WixCollectionMapping, WixUrlMapEntry } from "@/lib/connectors/wix/types";
import { parseWixBodyField, isWixBodyFieldKind } from "@/lib/connectors/wix/types";

// ── hoisted mock state (same fake-Supabase posture as mappings-store.test) ──
const mockState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "no_env",
  tables: new Map<string, Array<Record<string, unknown>>>(),
  tenant: "tenant-a",
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

function fakeAdmin() {
  return {
    from(table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: unknown) {
              return Promise.resolve({ data: tableRows(table).filter((r) => r[col] === val), error: null });
            },
          };
        },
        upsert(newRows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) {
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
  writeWixUrlMap,
} from "@/lib/connectors/wix/mappings-store";
import { resolveWixBodyFieldForUrl } from "@/lib/connectors/wix/url-map";

const RECIPES: WixCollectionMapping = {
  dataCollectionId: "Recipes",
  slugField: "slug",
  urlPrefix: "/persian-food",
  labelField: "title",
  contentFieldRoles: { title: "seoTitle", heading: "h1" },
  bodyField: { key: "content", kind: "html" },
};

const NAMES: WixCollectionMapping = {
  dataCollectionId: "Names",
  slugField: "slug",
  urlPrefix: "/persian-names",
  // no bodyField: this collection stays paste-only
};

const KABOB_ENTRY: WixUrlMapEntry = {
  url: "https://iranopedia.com/persian-food/kabob",
  dataCollectionId: "Recipes",
  dataItemId: "item-1",
  slugField: "slug",
  label: "Kabob",
  syncedAt: "2026-07-01T00:00:00.000Z",
};

beforeEach(() => {
  mockState.mode = "ok";
  mockState.tables = new Map();
  mockState.files = new Map();
  mockState.tenant = "tenant-a";
});

describe("body-field mapping - store round-trip", () => {
  it("bodyField survives the Supabase round-trip alongside contentFieldRoles", async () => {
    await saveWixCollectionConfig([RECIPES, NAMES]);
    const got = await getWixCollectionConfig();
    const recipes = got.find((m) => m.dataCollectionId === "Recipes");
    const names = got.find((m) => m.dataCollectionId === "Names");
    expect(recipes?.bodyField).toEqual({ key: "content", kind: "html" });
    expect(recipes?.contentFieldRoles).toEqual({ title: "seoTitle", heading: "h1" });
    expect(names?.bodyField).toBeUndefined();
  });

  it("packs bodyField INSIDE the existing content_field_roles jsonb (no new column, no migration)", async () => {
    await saveWixCollectionConfig([RECIPES]);
    const rows = mockState.tables.get("wix_collection_config") ?? [];
    expect(rows).toHaveLength(1);
    const stored = rows[0]!.content_field_roles as Record<string, unknown>;
    expect(stored.__bodyField).toEqual({ key: "content", kind: "html" });
    expect(stored.title).toBe("seoTitle");
    expect(Object.keys(rows[0]!)).not.toContain("body_field");
  });

  it("a bodyField with NO roles still round-trips (roles stay undefined)", async () => {
    await saveWixCollectionConfig([
      { dataCollectionId: "Cities", slugField: "slug", urlPrefix: "/cities", bodyField: { key: "body", kind: "plain" } },
    ]);
    const got = await getWixCollectionConfig();
    expect(got[0]?.bodyField).toEqual({ key: "body", kind: "plain" });
    expect(got[0]?.contentFieldRoles).toBeUndefined();
  });

  it("BACKWARD COMPAT: an old stored row without __bodyField parses to no bodyField", async () => {
    // Simulate a pre-item-2 row written directly to the fake table.
    tableRows("wix_collection_config").push({
      tenant_id: "tenant-a",
      data_collection_id: "Legacy",
      slug_field: "slug",
      url_prefix: "/legacy",
      label_field: null,
      content_field_roles: { title: "seoTitle" },
    });
    const got = await getWixCollectionConfig();
    expect(got).toHaveLength(1);
    expect(got[0]!.bodyField).toBeUndefined();
    expect(got[0]!.contentFieldRoles).toEqual({ title: "seoTitle" });
  });

  it("a MALFORMED stored __bodyField degrades to no bodyField instead of throwing", async () => {
    tableRows("wix_collection_config").push({
      tenant_id: "tenant-a",
      data_collection_id: "Broken",
      slug_field: "slug",
      url_prefix: "/broken",
      label_field: null,
      content_field_roles: { __bodyField: { key: "", kind: "markdown" } },
    });
    const got = await getWixCollectionConfig();
    expect(got[0]!.bodyField).toBeUndefined();
  });

  it("file fallback (no Supabase env) round-trips bodyField too", async () => {
    mockState.mode = "no_env";
    await saveWixCollectionConfig([RECIPES]);
    const got = await getWixCollectionConfig();
    expect(got[0]?.bodyField).toEqual({ key: "content", kind: "html" });
  });
});

describe("parseWixBodyField / isWixBodyFieldKind", () => {
  it("accepts only the three supported kinds", () => {
    expect(isWixBodyFieldKind("plain")).toBe(true);
    expect(isWixBodyFieldKind("html")).toBe(true);
    expect(isWixBodyFieldKind("ricos")).toBe(true);
    expect(isWixBodyFieldKind("markdown")).toBe(false);
    expect(isWixBodyFieldKind("")).toBe(false);
    expect(isWixBodyFieldKind(null)).toBe(false);
  });

  it("narrows defensively: bad shapes parse to null", () => {
    expect(parseWixBodyField(null)).toBeNull();
    expect(parseWixBodyField("content")).toBeNull();
    expect(parseWixBodyField({ key: "content" })).toBeNull();
    expect(parseWixBodyField({ key: "", kind: "html" })).toBeNull();
    expect(parseWixBodyField({ key: "  content  ", kind: "ricos" })).toEqual({ key: "content", kind: "ricos" });
  });
});

describe("resolveWixBodyFieldForUrl - url to body-field descriptor", () => {
  it("resolves a mapped page to its item + body descriptor", async () => {
    await saveWixCollectionConfig([RECIPES]);
    await writeWixUrlMap([KABOB_ENTRY]);
    const resolved = await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/kabob");
    expect(resolved).not.toBeNull();
    expect(resolved?.entry.dataItemId).toBe("item-1");
    expect(resolved?.bodyField).toEqual({ key: "content", kind: "html" });
  });

  it("returns null for an unmapped URL", async () => {
    await saveWixCollectionConfig([RECIPES]);
    const resolved = await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/unknown");
    expect(resolved).toBeNull();
  });

  it("returns null when the collection has no bodyField (stays paste-only)", async () => {
    await saveWixCollectionConfig([NAMES]);
    await writeWixUrlMap([
      { ...KABOB_ENTRY, url: "https://iranopedia.com/persian-names/dariush", dataCollectionId: "Names", dataItemId: "n-1" },
    ]);
    const resolved = await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-names/dariush");
    expect(resolved).toBeNull();
  });

  it("refuses a slug-ish or URL-bearing body key (never a body target)", async () => {
    await saveWixCollectionConfig([
      { ...RECIPES, bodyField: { key: "link-page-url", kind: "plain" } },
    ]);
    await writeWixUrlMap([KABOB_ENTRY]);
    const resolved = await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/kabob");
    expect(resolved).toBeNull();
  });
});
