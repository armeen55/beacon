/**
 * SOURCES — Wix field mapping + URL map (Core 100K lane S merge).
 *
 * Merged from tests/lib/connectors/wix/{body-field-mapping,
 * derive-content-field-key, suggest-mapping, url-map-probe}.
 *
 * Pinned boundaries:
 *   • bodyField packs into content_field_roles jsonb (no migration), old rows
 *     parse (backward compat), malformed degrades to paste-only, slug-ish
 *     body keys are refused (never a body target).
 *   • deriveWixContentFieldKey is operator-config driven: no mapped role, no
 *     synced URL, or no roles at all → null (paste-ready), never hardcoded.
 *   • suggestCollectionMapping never proposes a URL/slug/link field as a
 *     content role; system collections are partitioned away from content.
 *   • syncWixUrlMap probe is warn-only: failures listed, entries persist.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { WixCollectionMapping, WixUrlMapEntry } from "@/lib/connectors/wix/types";
import { parseWixBodyField, isWixBodyFieldKind } from "@/lib/connectors/wix/types";
import { makeWixFakeAdmin, wixTableRows } from "./_wix-store";

// ── hoisted mock state (fake Supabase + ambient tenant + file store) ──
const mockState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "no_env",
  tables: new Map<string, Array<Record<string, unknown>>>(),
  tenant: "tenant-a",
  files: new Map<string, unknown[]>(),
}));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (mockState.mode === "no_env") throw new Error("no supabase env");
    return makeWixFakeAdmin(mockState);
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

// url-map-probe: stub the paged collection read; the probe path is under test.
let _probeItems: Array<{ id: string; dataCollectionId: string; data: Record<string, unknown> }> = [];
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixQueryAllDataItems: async () => ({ ok: true, value: _probeItems }),
  };
});

import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  writeWixUrlMap,
} from "@/lib/connectors/wix/mappings-store";
import {
  resolveWixBodyFieldForUrl,
  deriveWixContentFieldKey,
  syncWixUrlMap,
} from "@/lib/connectors/wix/url-map";
import {
  suggestCollectionMapping,
  slugifyForUrlPrefix,
  isSystemWixCollection,
  partitionWixCollectionsBySystem,
} from "@/lib/connectors/wix/suggest-mapping";
import type { WixDiscoveredCollection } from "@/lib/connectors/wix/types";

const RECIPES: WixCollectionMapping = {
  dataCollectionId: "Recipes",
  slugField: "slug",
  urlPrefix: "/persian-food",
  labelField: "title",
  contentFieldRoles: { title: "seoTitle", heading: "h1" },
  bodyField: { key: "content", kind: "html" },
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
  _probeItems = [];
});

// ─────────────────────────────────────────────────────────────────────
// Body-field mapping
// ─────────────────────────────────────────────────────────────────────

describe("body-field mapping", () => {
  it("bodyField packs INSIDE content_field_roles jsonb and survives the round-trip", async () => {
    await saveWixCollectionConfig([RECIPES]);
    const rows = mockState.tables.get("wix_collection_config") ?? [];
    const stored = rows[0]!.content_field_roles as Record<string, unknown>;
    expect(stored.__bodyField).toEqual({ key: "content", kind: "html" });
    expect(Object.keys(rows[0]!)).not.toContain("body_field");

    const got = await getWixCollectionConfig();
    expect(got[0]?.bodyField).toEqual({ key: "content", kind: "html" });
    expect(got[0]?.contentFieldRoles).toEqual({ title: "seoTitle", heading: "h1" });
  });

  it("BACKWARD COMPAT: old rows without __bodyField parse; malformed degrades to no bodyField", async () => {
    wixTableRows(mockState, "wix_collection_config").push(
      {
        tenant_id: "tenant-a",
        data_collection_id: "Legacy",
        slug_field: "slug",
        url_prefix: "/legacy",
        label_field: null,
        content_field_roles: { title: "seoTitle" },
      },
      {
        tenant_id: "tenant-a",
        data_collection_id: "Broken",
        slug_field: "slug",
        url_prefix: "/broken",
        label_field: null,
        content_field_roles: { __bodyField: { key: "", kind: "markdown" } },
      },
    );
    const got = await getWixCollectionConfig();
    expect(got.find((m) => m.dataCollectionId === "Legacy")!.bodyField).toBeUndefined();
    expect(got.find((m) => m.dataCollectionId === "Broken")!.bodyField).toBeUndefined();
  });

  it("parseWixBodyField / isWixBodyFieldKind narrow defensively", () => {
    expect(isWixBodyFieldKind("plain")).toBe(true);
    expect(isWixBodyFieldKind("html")).toBe(true);
    expect(isWixBodyFieldKind("ricos")).toBe(true);
    expect(isWixBodyFieldKind("markdown")).toBe(false);
    expect(parseWixBodyField(null)).toBeNull();
    expect(parseWixBodyField({ key: "", kind: "html" })).toBeNull();
    expect(parseWixBodyField({ key: "  content  ", kind: "ricos" })).toEqual({
      key: "content",
      kind: "ricos",
    });
  });

  it("resolveWixBodyFieldForUrl resolves mapped pages; null for unmapped / no bodyField", async () => {
    await saveWixCollectionConfig([RECIPES]);
    await writeWixUrlMap([KABOB_ENTRY]);
    const resolved = await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/kabob");
    expect(resolved?.entry.dataItemId).toBe("item-1");
    expect(resolved?.bodyField).toEqual({ key: "content", kind: "html" });

    expect(await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/unknown")).toBeNull();
  });

  it("refuses a slug-ish or URL-bearing body key (never a body target)", async () => {
    await saveWixCollectionConfig([{ ...RECIPES, bodyField: { key: "link-page-url", kind: "plain" } }]);
    await writeWixUrlMap([KABOB_ENTRY]);
    expect(await resolveWixBodyFieldForUrl("https://iranopedia.com/persian-food/kabob")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// deriveWixContentFieldKey — operator-config driven, opt-in
// ─────────────────────────────────────────────────────────────────────

describe("deriveWixContentFieldKey", () => {
  const URL = "https://x.com/poets";

  beforeEach(() => {
    mockState.files.set("wix-url-map", [
      {
        url: URL,
        dataCollectionId: "Poets",
        dataItemId: "i1",
        slugField: "slug",
        label: null,
        syncedAt: "2026-06-13T00:00:00Z",
      },
    ]);
    mockState.files.set("wix-collection-config", [
      {
        dataCollectionId: "Poets",
        slugField: "slug",
        urlPrefix: "/poets",
        contentFieldRoles: { title: "seoTitle", heading: "h1Text", description: "seoDescription" },
      },
    ]);
    // No-env mode so the store reads the file fallback fixtures above.
    mockState.mode = "no_env";
  });

  it("maps edit_title / change_h1 / edit_meta to the configured field keys", async () => {
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBe("field:seoTitle");
    expect(await deriveWixContentFieldKey(URL, "change_h1")).toBe("field:h1Text");
    expect(await deriveWixContentFieldKey(URL, "edit_meta")).toBe("field:seoDescription");
  });

  it("null for unmapped actions, unmapped URLs, and unconfigured roles (opt-in)", async () => {
    expect(await deriveWixContentFieldKey(URL, "add_internal_link")).toBeNull();
    expect(await deriveWixContentFieldKey("https://x.com/not-mapped", "edit_title")).toBeNull();

    mockState.files.set("wix-collection-config", [
      { dataCollectionId: "Poets", slugField: "slug", urlPrefix: "/poets" },
    ]);
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBeNull();
  });

  it("a role present for one action but absent for another resolves per-role", async () => {
    mockState.files.set("wix-collection-config", [
      {
        dataCollectionId: "Poets",
        slugField: "slug",
        urlPrefix: "/poets",
        contentFieldRoles: { heading: "h1Text" },
      },
    ]);
    expect(await deriveWixContentFieldKey(URL, "edit_title")).toBeNull();
    expect(await deriveWixContentFieldKey(URL, "change_h1")).toBe("field:h1Text");
  });
});

// ─────────────────────────────────────────────────────────────────────
// suggestCollectionMapping — safe suggestions
// ─────────────────────────────────────────────────────────────────────

function field(key: string, type = "TEXT") {
  return { key, displayName: key, type };
}
function collection(
  displayName: string,
  fields: ReadonlyArray<{ key: string; displayName: string; type: string }>,
  id = `col-${displayName}`,
): WixDiscoveredCollection {
  return { id, displayName, fields: [...fields] };
}

describe("suggestCollectionMapping", () => {
  it("slugifies the display name and prefers a real slug field (case-insensitive)", () => {
    expect(slugifyForUrlPrefix("Persian Recipes")).toBe("/persian-recipes");
    expect(slugifyForUrlPrefix("")).toBe("/");
    const c = collection("Recipes", [field("Title"), field("Slug")]);
    expect(suggestCollectionMapping(c).slugField).toBe("Slug");
    const linkish = collection("Names", [field("name"), field("link-names-title")]);
    expect(suggestCollectionMapping(linkish).slugField).toBe("link-names-title");
  });

  it("maps content roles to REAL field keys and never suggests a URL/slug/link field as a role", () => {
    const c = collection("Posts", [
      field("Slug"),
      field("SeoTitle"),
      field("H1Text"),
      field("MetaDescription"),
    ]);
    const roles = suggestCollectionMapping(c).contentFieldRoles!;
    expect(roles.title).toBe("SeoTitle");
    expect(roles.heading).toBe("H1Text");
    const urlOnly = collection("Bare", [field("slug"), field("link-x-title", "URL")]);
    const suggestion = suggestCollectionMapping(urlOnly);
    expect(
      Object.values(suggestion.contentFieldRoles ?? {}).every(
        (v) => !/slug|link|url/i.test(String(v)),
      ),
    ).toBe(true);
  });

  it("partitions system collections away from content (trust audit F)", () => {
    expect(isSystemWixCollection("Forms/contact03")).toBe(true);
    expect(isSystemWixCollection("Members/PrivateMembersData")).toBe(true);
    expect(isSystemWixCollection("Stores/Orders")).toBe(true);
    expect(isSystemWixCollection("Stores/Products")).toBe(false); // product pages have URLs
    expect(isSystemWixCollection("PersianKabobs")).toBe(false);
    const { content, system } = partitionWixCollectionsBySystem([
      { collection: { id: "IranFlags" } },
      { collection: { id: "Forms/contact03" } },
      { collection: { id: "PersianKabobs" } },
    ]);
    expect(content.map((r) => r.collection.id)).toEqual(["IranFlags", "PersianKabobs"]);
    expect(system.map((r) => r.collection.id)).toEqual(["Forms/contact03"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// syncWixUrlMap — sampled probe is warn-only
// ─────────────────────────────────────────────────────────────────────

describe("syncWixUrlMap — sampled URL verification", () => {
  beforeEach(() => {
    mockState.mode = "no_env"; // file-fallback stores back the url-map
    mockState.files.set("wix-collection-config", [
      { dataCollectionId: "Foods", slugField: "slug", urlPrefix: "/persian-food", labelField: null },
    ]);
    _probeItems = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      dataCollectionId: "Foods",
      data: { slug: `dish-${i}` },
    }));
  });

  it("probes up to 3 deterministic samples and reports ok counts on canonicalized urls", async () => {
    const probed: string[] = [];
    const r = await syncWixUrlMap(
      { siteBaseUrl: "https://www.iranopedia.com" },
      {
        fetchImpl: (async (url: RequestInfo | URL) => {
          probed.push(String(url));
          return new Response("ok", { status: 200 });
        }) as typeof fetch,
      },
    );
    expect(r.ok).toBe(true);
    expect(r.itemsMapped).toBe(5);
    expect(r.probe.checked).toBe(3);
    expect(r.probe.ok).toBe(3);
    expect(probed.every((u) => u.includes("iranopedia.com/persian-food/dish-"))).toBe(true);
  });

  it("probe failures are warn-only: entries persist, failures listed, never throws", async () => {
    const r = await syncWixUrlMap(
      { siteBaseUrl: "https://www.iranopedia.com" },
      { fetchImpl: (async () => new Response("nope", { status: 404 })) as typeof fetch },
    );
    expect(r.ok).toBe(true);
    expect(r.probe.ok).toBe(0);
    expect(r.probe.failures[0]).toContain("HTTP 404");
    expect((mockState.files.get("wix-url-map") ?? []).length).toBe(5);
  });
});
