/**
 * 2026-06-10 — §push layer invariants (these tests ARE the contract).
 *
 *   1. Ritz NEVER pushes — dev note only, regardless of config.
 *   2. Caps enforced in the push path: daily cap, non-destructive
 *      patch, field-targeted-only, no slug fields.
 *   3. pushed/push_failed land in the ledger; url-map miss refuses.
 *   4. The Wix client strips slug/url/id fields from every write.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// in-memory json-store (push-ledger + wix stores)
const _stores = new Map<string, unknown[]>();
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

let _tenant: Record<string, unknown> | null = null;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => _tenant,
}));

let _urlMapEntry: Record<string, unknown> | null = null;
// Wix content-push slice (2026-06-13): the push service derives a
// field:<x> target for content edits via this; null = operator hasn't
// mapped the role → card stays paste-ready (today's behavior).
let _deriveFieldKey: string | null = null;
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
  deriveWixContentFieldKey: async () => _deriveFieldKey,
}));

const _queryResult: { ok: boolean; value?: unknown[]; reason?: string } = { ok: true, value: [] };
let _updateCalls: Array<Record<string, unknown>> = [];
let _insertCalls: Array<Record<string, unknown>> = [];
let _updateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
// Wix SEO push slice (2026-06-12) — Stores product mocks.
let _productResult: { ok: boolean; value?: Record<string, unknown>; reason?: string } = { ok: true };
let _seoUpdateCalls: Array<Record<string, unknown>> = [];
let _seoUpdateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixQueryDataItems: async () => _queryResult,
    // audit-wave #13: the add_schema product lookup now paginates the full
    // catalog via wixQueryAllDataItems — resolve it from the same fixture.
    wixQueryAllDataItems: async () => _queryResult,
    // The field route now fetches the exact item by id (get-by-id) instead of
    // querying the collection — resolve it from the same _queryResult fixture.
    wixGetDataItem: async (args: { dataItemId?: string }) => {
      if (!_queryResult.ok) return { ok: false, reason: _queryResult.reason };
      const found = ((_queryResult.value ?? []) as Array<{ id?: string }>).find(
        (i) => i.id === args.dataItemId,
      );
      return { ok: true, value: found ?? null };
    },
    wixUpdateDataItem: async (args: Record<string, unknown>) => {
      _updateCalls.push(args);
      return _updateResult.ok
        ? { ok: true, value: { id: "item-1", dataCollectionId: "col", data: {} } }
        : _updateResult;
    },
    wixInsertDataItem: async (args: Record<string, unknown>) => {
      _insertCalls.push(args);
      return { ok: true, value: { id: "new-item", dataCollectionId: args.dataCollectionId, data: args.data } };
    },
    wixGetStoreProduct: async () =>
      _productResult.ok
        ? { ok: true, value: _productResult.value ?? { id: "prod-1", name: "P", slug: "s", seoData: { tags: [] } } }
        : _productResult,
    wixUpdateProductSeoData: async (args: Record<string, unknown>) => {
      _seoUpdateCalls.push(args);
      return _seoUpdateResult.ok ? { ok: true, value: { id: "prod-1" } } : _seoUpdateResult;
    },
  };
});

import { executePush, RITZ_TENANT_ID } from "@/domains/push/push-service";
import { MAX_PUSHES_PER_DAY, assertNonDestructivePatch } from "@/domains/push/caps";
import { formatDevNote } from "@/domains/push/dev-note";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-iranopedia",
    rec_id: "rec-1",
    action_type: "refresh_content" as RecommendedEditRow["action_type"],
    target_url: "https://www.iranopedia.com/famous-iranian-poets",
    target_element_key: "field:description",
    display_label: "Refresh the poets intro",
    current_text: "old intro text that is long enough to matter for shrink checks",
    proposed_text: "A refreshed introduction covering Ferdowsi, Hafez, and Rumi with dates.",
    why: "stale copy",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-10T00:00:00Z",
    updated_at: "2026-06-10T00:00:00Z",
    implementation_status: "accepted",
    ...over,
  } as RecommendedEditRow;
}

beforeEach(() => {
  _stores.clear();
  _tenant = { id: "tenant-iranopedia", publish_target: "wix_cms" };
  _urlMapEntry = {
    url: "https://www.iranopedia.com/famous-iranian-poets",
    dataCollectionId: "col",
    dataItemId: "item-1",
    slugField: "slug",
    label: null,
    syncedAt: "2026-06-10T00:00:00Z",
  };
  _queryResult.ok = true;
  _queryResult.value = [{ id: "item-1", dataCollectionId: "col", data: { description: "old" } }];
  _updateCalls = [];
  _insertCalls = [];
  _updateResult = { ok: true };
  _productResult = { ok: true };
  _seoUpdateCalls = [];
  _seoUpdateResult = { ok: true };
  _deriveFieldKey = null;
});

describe("Wix content-push slice — field-role derivation for content edits", () => {
  it("an edit_title card with NO element key + a configured role pushes LIVE via the field path", async () => {
    _deriveFieldKey = "field:title"; // operator mapped title → "title" on /diagnostics/wix
    _queryResult.value = [
      { id: "item-1", dataCollectionId: "col", data: { title: "Old Title" } },
    ];
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        action_type: "edit_title" as RecommendedEditRow["action_type"],
        target_element_key: null,
        current_text: "Old Title",
        proposed_text: "Famous Iranian Poets | Iranopedia",
      }),
    });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("title");
    expect(_updateCalls[0]!.value).toBe("Famous Iranian Poets | Iranopedia");
  });

  it("an edit_meta card with NO element key + a configured description role pushes LIVE to the SEO-Variable field", async () => {
    // The page's meta description is a Wix SEO Variable bound to this CMS
    // field; writing the field updates the live meta (Wix dynamic-page SEO).
    _deriveFieldKey = "field:seoDescription"; // operator mapped description → "seoDescription"
    _queryResult.value = [
      { id: "item-1", dataCollectionId: "col", data: { seoDescription: "Old meta." } },
    ];
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        action_type: "edit_meta" as RecommendedEditRow["action_type"],
        target_element_key: null,
        current_text: "Old meta.",
        proposed_text:
          "Explore famous Iranian poets — Rumi, Hafez, Saadi — with concise, sourced biographies on Iranopedia.",
      }),
    });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("seoDescription");
    expect(_updateCalls[0]!.value).toBe(
      "Explore famous Iranian poets — Rumi, Hafez, Saadi — with concise, sourced biographies on Iranopedia.",
    );
  });

  it("a content card with NO configured role stays PASTE-READY (refused), never written", async () => {
    _deriveFieldKey = null; // operator has not mapped the field role
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        action_type: "edit_title" as RecommendedEditRow["action_type"],
        target_element_key: null,
        current_text: "Old Title",
        proposed_text: "A New Title For The Page",
      }),
    });
    expect(r.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
  });

  it("derivation never overrides an explicit element key (field:/create: pass through unchanged)", async () => {
    _deriveFieldKey = "field:title"; // would derive, but the card already has a key
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ target_element_key: "field:description" }),
    });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls[0]!.field).toBe("description");
    expect(_updateCalls[0]!.value).toBe(edit().proposed_text);
  });
});

describe("Invariant 2 — Ritz NEVER pushes", () => {
  it("returns a dev note for Ritz even with a wix_cms target configured", async () => {
    _tenant = { id: RITZ_TENANT_ID, publish_target: "wix_cms" };
    const r = await executePush({ tenantId: RITZ_TENANT_ID, edit: edit() });
    expect(r.kind).toBe("dev_note");
    expect(_updateCalls).toHaveLength(0);
    if (r.kind === "dev_note") {
      expect(r.reason).toMatch(/advise-mode only/i);
      expect(r.note).toContain("Change to (exact copy");
    }
  });
});

describe("Invariant 3 — caps in the push path", () => {
  it("refuses past the daily cap", async () => {
    const day = new Date().toISOString().slice(0, 10);
    _stores.set(
      "push-ledger",
      Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => ({
        id: `p${i}`, tenant_id: "tenant-iranopedia", edit_id: `e${i}`,
        target_url: "x", adapter: "wix_cms", pushed_at: new Date().toISOString(),
        day, result: "pushed", detail: null,
      })),
    );
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/daily push cap/);
    expect(_updateCalls).toHaveLength(0);
  });

  it("refuses deletion-shaped patches (empty + >80% shrink)", async () => {
    expect(assertNonDestructivePatch({ currentText: "long ".repeat(40), proposedText: "" }).allowed).toBe(false);
    expect(assertNonDestructivePatch({ currentText: "long ".repeat(40), proposedText: "tiny" }).allowed).toBe(false);
    expect(assertNonDestructivePatch({ currentText: null, proposedText: "new content" }).allowed).toBe(true);
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ proposed_text: "" }),
    });
    expect(r.kind).toBe("refused");
  });

  it("audit-3 #11: refuses an over-limit title before any live write", async () => {
    const longTitle = "Famous Iranian and Persian Poets Writers Authors and Literary Figures Through History"; // > 70 chars
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        action_type: "edit_title" as RecommendedEditRow["action_type"],
        target_element_key: "field:title",
        proposed_text: longTitle,
      }),
    });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/push limit/);
    expect(_updateCalls).toHaveLength(0);
  });

  it("audit-3 #11: allows a within-limit title (the gate is not over-strict)", async () => {
    const okTitle = "Famous Iranian & Persian Poets | Iranopedia"; // ~43 chars
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        action_type: "edit_title" as RecommendedEditRow["action_type"],
        target_element_key: "field:title",
        proposed_text: okTitle,
      }),
    });
    expect(r.kind).not.toBe("refused");
  });

  it("refuses non-field targets and slug fields", async () => {
    const r1 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "h2" }) });
    expect(r1.kind).toBe("refused");
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "field:slug" }) });
    expect(r2.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
  });

  it("a content edit NEVER changes the slug/link (target field is preserve-only)", async () => {
    // Regression for the 2026-06-13 koobideh 404: the write path must change
    // ONLY the approved field and carry slug/link through unchanged. The
    // per-field preservation is unit-tested in
    // tests/lib/connectors/wix/update-preserves-url-fields.test.ts; here we
    // pin that the push path refuses a slug-ish target outright.
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ target_element_key: "field:slug" }),
    });
    expect(r.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
  });
});

describe("push happy path + failure ledger", () => {
  it("pushes a field-targeted card and records the ledger", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("description");
    expect(String(_updateCalls[0]!.value)).toContain("Ferdowsi");
    const ledger = _stores.get("push-ledger") as Array<{ result: string }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.result).toBe("pushed");
  });

  it("url-map miss refuses with a sync hint; write failure lands push_failed", async () => {
    _urlMapEntry = null;
    const r1 = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r1.kind).toBe("refused");
    if (r1.kind === "refused") expect(r1.reason).toMatch(/url-map sync/);

    _urlMapEntry = {
      url: "https://www.iranopedia.com/famous-iranian-poets",
      dataCollectionId: "col", dataItemId: "item-1", slugField: "slug", label: null, syncedAt: "x",
    };
    _updateResult = { ok: false, reason: "api_error", detail: "http_500" };
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r2.kind).toBe("refused");
    const ledger = _stores.get("push-ledger") as Array<{ result: string }>;
    expect(ledger.some((e) => e.result === "push_failed")).toBe(true);
  });

  it("unset publish target → dev note (safe default), no write", async () => {
    _tenant = { id: "tenant-iranopedia" };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("dev_note");
    expect(_updateCalls).toHaveLength(0);
  });

  it("create route: inserts a NEW item; refuses when the URL already maps", async () => {
    _urlMapEntry = null; // URL not mapped → genuinely new page
    const createCard = edit({
      target_element_key: "create:Foods",
      target_url: "https://www.iranopedia.com/persian-food/ghormeh-sabzi",
      current_text: null,
      proposed_text: JSON.stringify({ slug: "ghormeh-sabzi", title: "Ghormeh Sabzi", description: "Herb stew." }),
    });
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: createCard });
    expect(r.kind).toBe("pushed");
    expect(_insertCalls).toHaveLength(1);
    expect((_insertCalls[0]!.data as Record<string, unknown>).slug).toBe("ghormeh-sabzi");

    // mapped URL → creation never overwrites
    _urlMapEntry = { url: "https://www.iranopedia.com/persian-food/ghormeh-sabzi", dataCollectionId: "Foods", dataItemId: "i1", slugField: "slug", label: null, syncedAt: "x" };
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: createCard });
    expect(r2.kind).toBe("refused");
    if (r2.kind === "refused") expect(r2.reason).toMatch(/never overwrites/);
  });

  it("formatDevNote carries the exact paste-ready copy", () => {
    const note = formatDevNote(edit());
    expect(note).toContain("**Page:** https://www.iranopedia.com/famous-iranian-poets");
    expect(note).toContain("Ferdowsi, Hafez, and Rumi");
  });
});

// ── Wix SEO push slice (2026-06-12) — add_schema → product seoData ──────

const BREADCRUMB_BLOCK = JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Iranopedia", item: "https://www.iranopedia.com/" },
      { "@type": "ListItem", position: 2, name: "Persian Cat Hoodie" },
    ],
  },
  null,
  2,
);
const SCHEMA_DRAFT =
  "Add this JSON-LD block to the page <head> — complete and ready to paste (Beacon can also apply it for you on approval):\n" +
  '<script type="application/ld+json">\n' +
  BREADCRUMB_BLOCK +
  "\n</script>";

function schemaEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return edit({
    action_type: "add_schema" as RecommendedEditRow["action_type"],
    target_url: "https://www.iranopedia.com/product-page/persian-cat-hoodie",
    target_element_key: null,
    proposed_text: SCHEMA_DRAFT,
    current_text: null,
    ...over,
  });
}

describe("wix_cms SEO route — add_schema cards push to product seoData", () => {
  beforeEach(() => {
    _queryResult.ok = true;
    _queryResult.value = [
      { id: "prod-1", dataCollectionId: "Stores/Products", data: { slug: "persian-cat-hoodie" } },
    ];
  });

  it("pushes the extracted JSON-LD block onto the matched product's seoData (snapshot first)", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("pushed");
    expect(_seoUpdateCalls).toHaveLength(1);
    const tags = (_seoUpdateCalls[0]!.tags ?? []) as Array<Record<string, unknown>>;
    const script = tags.find((t) => t.type === "script")!;
    expect(script).toBeDefined();
    expect(String(script.children)).toContain('"BreadcrumbList"');
    // fail-closed snapshot captured before the write
    const snaps = (_stores.get("push-snapshots") ?? []) as Array<Record<string, unknown>>;
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps[snaps.length - 1]!.field).toBe("seoData");
  });

  it("replaces a prior custom script tag of the same @type (idempotent re-push)", async () => {
    _productResult = {
      ok: true,
      value: {
        id: "prod-1", name: "P", slug: "persian-cat-hoodie",
        seoData: { tags: [
          { type: "title", children: "Keep me", custom: false, disabled: false },
          { type: "script", props: { type: "application/ld+json" }, children: '{"@type":"BreadcrumbList"}', custom: true, disabled: false },
        ] },
      },
    };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("pushed");
    const tags = (_seoUpdateCalls[0]!.tags ?? []) as Array<Record<string, unknown>>;
    expect(tags.filter((t) => t.type === "script")).toHaveLength(1);
    expect(tags.find((t) => t.type === "title")).toBeDefined();
  });

  it("refuses when the URL does not match any store product (card stays paste-ready)", async () => {
    _queryResult.value = [
      { id: "prod-2", dataCollectionId: "Stores/Products", data: { slug: "other-product" } },
    ];
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/not a Wix Stores product/);
    expect(_seoUpdateCalls).toHaveLength(0);
  });

  it("refuses when the draft has no extractable JSON-LD block", async () => {
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: schemaEdit({ proposed_text: "Fix the offers block on your Product schema." }),
    });
    expect(r.kind).toBe("refused");
    expect(_seoUpdateCalls).toHaveLength(0);
  });

  it("refuses (fail-closed) when the product read for the snapshot fails", async () => {
    _productResult = { ok: false, reason: "api_error" };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/snapshot/);
    expect(_seoUpdateCalls).toHaveLength(0);
  });
});

// ── Audit #33/#35 hardening (2026-06-12) ───────────────────────────────

describe("dry-run mode (audit #35) — full guard path, zero side effects", () => {
  it("field route: reports the would-be write; no snapshot, no ledger, no adapter call", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit(), dryRun: true });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") expect(r.detail).toMatch(/would update "description" on col\/item-1/);
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
    expect(_stores.get("push-ledger") ?? []).toHaveLength(0);
  });

  it("add_schema route: stops before snapshot + seoData write", async () => {
    _queryResult.value = [
      { id: "prod-1", dataCollectionId: "Stores/Products", data: { slug: "persian-cat-hoodie" } },
    ];
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit(), dryRun: true });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") expect(r.detail).toMatch(/would apply 1 JSON-LD block/);
    expect(_seoUpdateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });

  it("create route: reports the would-be insert without inserting", async () => {
    _urlMapEntry = null;
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        target_element_key: "create:Foods",
        target_url: "https://www.iranopedia.com/persian-food/ash-reshteh",
        current_text: null,
        proposed_text: JSON.stringify({ slug: "ash-reshteh", title: "Ash Reshteh" }),
      }),
      dryRun: true,
    });
    expect(r.kind).toBe("dry_run");
    expect(_insertCalls).toHaveLength(0);
  });

  it("still REFUSES on real guard failures — dry-run is not a yes-machine", async () => {
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ target_element_key: "field:slug" }),
      dryRun: true,
    });
    expect(r.kind).toBe("refused");
  });
});

describe("Wix page limits on the MERGED tag set (audit #33)", () => {
  it("refuses when existing JSON-LD scripts + incoming would exceed the 5-markup page limit", async () => {
    _queryResult.value = [
      { id: "prod-1", dataCollectionId: "Stores/Products", data: { slug: "persian-cat-hoodie" } },
    ];
    const ldTag = (t: string) => ({
      type: "script",
      props: { type: "application/ld+json" },
      children: JSON.stringify({ "@type": t }),
      custom: true,
      disabled: false,
    });
    _productResult = {
      ok: true,
      value: {
        id: "prod-1", name: "P", slug: "persian-cat-hoodie",
        seoData: { tags: ["Product", "Offer", "FAQPage", "Organization", "WebSite"].map(ldTag) },
      },
    };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/markups per page/);
    expect(_seoUpdateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });

  it("refuses a merged CMS item that would exceed the 1MB write ceiling", async () => {
    _queryResult.value = [
      { id: "item-1", dataCollectionId: "col", data: { description: "old", blob: "x".repeat(1_100_000) } },
    ];
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/bytes/);
    expect(_updateCalls).toHaveLength(0);
  });
});
