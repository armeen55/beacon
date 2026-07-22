/**
 * executePush — the structural push-safety authority (Core 100K Phase 6).
 *
 * Merges tests/domains/push/push-service.test.ts + push-snapshots.test.ts,
 * trimmed to one boundary case per rule. The invariants ARE the contract:
 *   1. Ritz NEVER pushes — dev note only, regardless of config.
 *   2. Caps enforced in the push path: daily cap, non-destructive patch,
 *      field-targeted-only, no slug fields, title length, 1MB / 5-markup limits.
 *   3. pushed/push_failed land in the ledger; url-map miss refuses.
 *   4. Snapshot of the prior value is captured BEFORE every write and a
 *      capture failure refuses the push (fail-closed undo).
 *   5. Creation never overwrites; identical retries replay idempotently.
 *   6. Dry-run walks the full guard path with zero side effects and is
 *      not a yes-machine.
 *   7. Body route: snapshot-first merge, paste-ready refusals, revert
 *      restores the exact prior value through the SAME push path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// in-memory json-store (push-ledger + push-snapshots + wix stores)
const _stores = new Map<string, unknown[]>();
let _failSnapshotWrite = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    if (name === "push-snapshots" && _failSnapshotWrite) throw new Error("disk full");
    _stores.set(name, data);
  },
}));

let _tenant: Record<string, unknown> | null = null;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => _tenant,
}));

let _urlMapEntry: Record<string, unknown> | null = null;
let _deriveFieldKey: string | null = null;
let _bodyResolved: { entry: Record<string, unknown>; bodyField: { key: string; kind: string } } | null = null;
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
  deriveWixContentFieldKey: async () => _deriveFieldKey,
  resolveWixBodyFieldForUrl: async () => _bodyResolved,
}));

const _queryResult: { ok: boolean; value?: unknown[]; reason?: string } = { ok: true, value: [] };
let _updateCalls: Array<Record<string, unknown>> = [];
let _insertCalls: Array<Record<string, unknown>> = [];
let _updateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
// Body-mode fixture: when non-null, wixGetDataItem serves this ONE mutable
// fake CMS item and wixUpdateDataItem lands updates on it, so the body
// route's verify-by-re-read genuinely observes the write.
let _itemData: Record<string, unknown> | null = null;
let _getFails = false;
let _productResult: { ok: boolean; value?: Record<string, unknown>; reason?: string } = { ok: true };
let _seoUpdateCalls: Array<Record<string, unknown>> = [];
let _seoUpdateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixQueryDataItems: async () => (_itemData !== null ? { ok: true, value: [] } : _queryResult),
    wixQueryAllDataItems: async () => (_itemData !== null ? { ok: true, value: [] } : _queryResult),
    wixGetDataItem: async (args: { dataItemId?: string }) => {
      if (_getFails) return { ok: false, reason: "api_error", detail: "http_500" };
      if (_itemData !== null) {
        return { ok: true, value: { id: "item-1", dataCollectionId: "Recipes", data: { ..._itemData } } };
      }
      if (!_queryResult.ok) return { ok: false, reason: _queryResult.reason };
      const found = ((_queryResult.value ?? []) as Array<{ id?: string }>).find(
        (i) => i.id === args.dataItemId,
      );
      return { ok: true, value: found ?? null };
    },
    wixUpdateDataItem: async (args: Record<string, unknown>) => {
      _updateCalls.push(args);
      if (!_updateResult.ok) return _updateResult;
      if (_itemData !== null) {
        _itemData = { ..._itemData, [String(args.field)]: args.value };
        return { ok: true, value: { id: "item-1", dataCollectionId: "Recipes", data: { ..._itemData } } };
      }
      return { ok: true, value: { id: "item-1", dataCollectionId: "col", data: {} } };
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
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import { buildRevertEdit, findLatestSnapshotForEdit, type PushSnapshotRow } from "@/domains/push/push-snapshots";
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
  _failSnapshotWrite = false;
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
  _bodyResolved = null;
  _itemData = null;
  _getFails = false;
});

describe("field-role derivation for content edits", () => {
  it("an edit_title card with NO element key + a configured role pushes LIVE via the field path", async () => {
    _deriveFieldKey = "field:title";
    _queryResult.value = [{ id: "item-1", dataCollectionId: "col", data: { title: "Old Title" } }];
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

  it("a content card with NO configured role stays PASTE-READY (refused), never written", async () => {
    _deriveFieldKey = null;
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

  it("refuses an over-limit title before any live write", async () => {
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

  it("refuses non-field targets and slug fields (a content edit can NEVER change the slug/link)", async () => {
    const r1 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "h2" }) });
    expect(r1.kind).toBe("refused");
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "field:slug" }) });
    expect(r2.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
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

  it("create route: inserts a NEW item; refuses when the URL already maps (creation never overwrites)", async () => {
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

    // mapped URL → creation never overwrites. Different card = different
    // change hash so this exercises the overwrite guard, not the N41 replay.
    _urlMapEntry = { url: "https://www.iranopedia.com/persian-food/ghormeh-sabzi", dataCollectionId: "Foods", dataItemId: "i1", slugField: "slug", label: null, syncedAt: "x" };
    const overwriteCard = edit({
      target_element_key: "create:Foods",
      target_url: "https://www.iranopedia.com/persian-food/ghormeh-sabzi",
      current_text: null,
      proposed_text: JSON.stringify({ slug: "ghormeh-sabzi", title: "Ghormeh Sabzi v2", description: "Updated herb stew." }),
    });
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: overwriteCard });
    expect(r2.kind).toBe("refused");
    if (r2.kind === "refused") expect(r2.reason).toMatch(/never overwrites/);
  });

  it("create route fails closed when the live slug check is unavailable", async () => {
    _urlMapEntry = null;
    _queryResult.ok = false;
    _queryResult.reason = "api_error";
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        target_element_key: "create:Foods",
        target_url: "https://www.iranopedia.com/persian-food/fesenjan",
        current_text: null,
        proposed_text: JSON.stringify({ slug: "fesenjan", title: "Fesenjan" }),
      }),
    });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("could not verify the live collection");
    expect(_insertCalls).toHaveLength(0);
  });

  it("N41 outbox: an IDENTICAL retry of a landed push is an idempotent replay, never a second write", async () => {
    _urlMapEntry = null;
    const createCard = edit({
      target_element_key: "create:Foods",
      target_url: "https://www.iranopedia.com/persian-food/fesenjan",
      current_text: null,
      proposed_text: JSON.stringify({ slug: "fesenjan", title: "Fesenjan", description: "Walnut stew." }),
    });
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: createCard });
    expect(r.kind).toBe("pushed");
    expect(_insertCalls).toHaveLength(1);
    // Same tenant + url + change hash + day = same outbox key -> short-circuit.
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: createCard });
    expect(r2.kind).toBe("pushed");
    if (r2.kind === "pushed") expect(r2.detail).toMatch(/already published this exact change/);
    expect(_insertCalls).toHaveLength(1);
  });
});

// ── Wix SEO route — add_schema → product seoData ────────────────────────

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

  it("refuses (fail-closed) when the product read for the snapshot fails", async () => {
    _productResult = { ok: false, reason: "api_error" };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: schemaEdit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/snapshot/);
    expect(_seoUpdateCalls).toHaveLength(0);
  });

  it("refuses when existing JSON-LD scripts + incoming would exceed the 5-markup page limit", async () => {
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
});

describe("dry-run mode — full guard path, zero side effects", () => {
  it("field route: reports the would-be write; no snapshot, no ledger, no adapter call", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit(), dryRun: true });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") expect(r.detail).toMatch(/would update "description" on col\/item-1/);
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
    expect(_stores.get("push-ledger") ?? []).toHaveLength(0);
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

// ── pre-push snapshots + revert (field route) ───────────────────────────

describe("pre-push snapshot capture", () => {
  beforeEach(() => {
    _queryResult.value = [
      { id: "item-1", dataCollectionId: "col", data: { description: "the original text" } },
    ];
  });

  it("captures the previous field value BEFORE the write", async () => {
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ current_text: "the original text" }),
    });
    expect(r.kind).toBe("pushed");
    const snaps = _stores.get("push-snapshots") as PushSnapshotRow[];
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.previous_text).toBe("the original text");
    expect(snaps[0]!.field).toBe("description");
    expect(snaps[0]!.edit_id).toBe("edit-1");
  });

  it("FAIL-CLOSED: capture failure refuses the push (live site untouched)", async () => {
    _failSnapshotWrite = true;
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("pre-push snapshot");
    expect(_updateCalls).toHaveLength(0); // never reached the write
  });

  it("refuses deletion-shaped reverts (empty previous value)", () => {
    const snap: PushSnapshotRow = {
      id: "s",
      tenant_id: "t",
      edit_id: "edit-1",
      target_url: "u",
      dataCollectionId: "col",
      dataItemId: "item-1",
      field: "description",
      previous_text: "   ",
      captured_at: "2026-06-11T00:00:00Z",
    };
    const r = buildRevertEdit(snap, edit(), new Date());
    expect(r).toEqual({ ok: false, reason: "empty_previous_value" });
  });
});

// ── body-section push path ──────────────────────────────────────────────

const PAGE_URL = "https://www.iranopedia.com/persian-food/kabob";
const ORIGINAL_BODY =
  "Kabob koobideh is Iran's most beloved grilled dish.\n\n" +
  "History\n\n" +
  "Street vendors in Tehran popularized koobideh in the Qajar era.";
const ANSWER_DRAFT =
  "Koobideh kabob is ground meat kabob seasoned with grated onion and grilled on flat skewers.";

function bodyEdit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return edit({
    id: "edit-body-1",
    rec_id: "rec-body-1",
    action_type: "add_answer_block" as RecommendedEditRow["action_type"],
    target_url: PAGE_URL,
    target_element_key: null,
    display_label: "Add an answer block to the kabob page",
    current_text: null,
    proposed_text: ANSWER_DRAFT,
    why: "AI answers quote a rival page for this question",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...over,
  });
}

describe("body-section push path", () => {
  beforeEach(() => {
    _urlMapEntry = {
      url: PAGE_URL,
      dataCollectionId: "Recipes",
      dataItemId: "item-1",
      slugField: "slug",
      label: "Kabob",
      syncedAt: "2026-07-01T00:00:00Z",
    };
    _bodyResolved = {
      entry: _urlMapEntry,
      bodyField: { key: "content", kind: "plain" },
    };
    _itemData = { slug: "kabob", title: "Kabob", content: ORIGINAL_BODY };
  });

  it("add_answer_block: snapshot first, PREPENDS the draft, verifies by re-read, ledgers pushed", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: bodyEdit() });
    expect(r.kind).toBe("pushed");

    // Snapshot captured the FULL prior body before the write.
    const snaps = (_stores.get("push-snapshots") ?? []) as Array<Record<string, unknown>>;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.field).toBe("content");
    expect(snaps[0]!.previous_text).toBe(ORIGINAL_BODY);

    // Exactly one write, full merged value, draft first, original intact.
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("content");
    const written = String(_updateCalls[0]!.value);
    expect(written.startsWith(ANSWER_DRAFT)).toBe(true);
    expect(written).toContain(ORIGINAL_BODY);

    // Verified on re-read + honest first-person receipt.
    if (r.kind === "pushed") {
      expect(r.detail).toContain("I saved the previous version first");
      expect(r.detail).toContain("new section is in place");
      expect(hasBannedDash(r.detail)).toBe(false);
    }
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string; detail: string | null }>;
    expect(ledger.some((e) => e.result === "pushed" && (e.detail ?? "").includes("verified"))).toBe(true);
  });

  it("RICOS: writes the merged doc back as an OBJECT and snapshots the JSON string", async () => {
    const RICOS_OBJECT = {
      type: "DOC",
      nodes: [
        {
          type: "PARAGRAPH",
          id: "orig-1",
          nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: "Existing paragraph.", decorations: [] } }],
          paragraphData: {},
        },
      ],
    };
    _bodyResolved = { entry: _urlMapEntry!, bodyField: { key: "richContent", kind: "ricos" } };
    _itemData = { slug: "kabob", richContent: RICOS_OBJECT };

    const r = await executePush({ tenantId: "tenant-iranopedia", edit: bodyEdit() });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    const value = _updateCalls[0]!.value as { nodes: Array<{ id: string }> };
    expect(typeof value).toBe("object");
    expect(value.nodes).toHaveLength(2);
    expect(value.nodes[1]!.id).toBe("orig-1"); // prepend keeps original after the answer
    const snaps = (_stores.get("push-snapshots") ?? []) as Array<Record<string, unknown>>;
    expect(snaps[0]!.previous_text).toBe(JSON.stringify(RICOS_OBJECT));
  });

  it("no body mapping -> refused, card stays paste-ready, nothing written", async () => {
    _bodyResolved = null;
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: bodyEdit() });
    expect(r.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });

  it("a plain/html mapping over an OBJECT value fails closed (kind mismatch beats corruption)", async () => {
    _itemData = { slug: "kabob", content: { nodes: [] } };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: bodyEdit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("does not hold plain content");
    expect(_updateCalls).toHaveLength(0);
  });

  it("pushing the same answer block twice writes once; the second push is an honest no-op", async () => {
    const original = bodyEdit();
    const first = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(first.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    expect((_stores.get("push-snapshots") ?? []) as unknown[]).toHaveLength(1);

    // N41: a SAME-DAY identical re-push is caught by the idempotent publish
    // outbox FIRST; the merge-level already-applied check is the backstop.
    const second = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(second.kind).toBe("pushed");
    if (second.kind === "pushed") {
      expect(second.detail).toContain("already published this exact change");
      expect(hasBannedDash(second.detail)).toBe(false);
    }

    // NO second Wix write, NO second snapshot, no duplicated body.
    expect(_updateCalls).toHaveLength(1);
    expect((_stores.get("push-snapshots") ?? []) as unknown[]).toHaveLength(1);
    const occurrences = String(_itemData!.content).split(ANSWER_DRAFT).length - 1;
    expect(occurrences).toBe(1);

    // The replay does not eat a daily-cap slot.
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string; detail: string | null }>;
    const replayRow = ledger.find((e) => (e.detail ?? "").includes("outbox_idempotent_replay"));
    expect(replayRow).toBeDefined();
    expect(replayRow!.result).toBe("push_failed");
  });

  it("rollback: buildRevertEdit targets the snapshot field and executePush restores the exact prior value", async () => {
    const original = bodyEdit();
    const push = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(push.kind).toBe("pushed");
    expect(String(_itemData!.content).startsWith(ANSWER_DRAFT)).toBe(true);

    const snap = await findLatestSnapshotForEdit("tenant-iranopedia", original.id);
    expect(snap).not.toBeNull();
    const revert = buildRevertEdit(snap!, original, new Date());
    expect(revert.ok).toBe(true);
    if (!revert.ok) return;
    // The revert is field-targeted so it can NEVER re-run the merge path.
    expect(revert.edit.target_element_key).toBe("field:content");

    const restore = await executePush({ tenantId: "tenant-iranopedia", edit: revert.edit });
    expect(restore.kind).toBe("pushed");
    expect(_itemData!.content).toBe(ORIGINAL_BODY);
  });
});
