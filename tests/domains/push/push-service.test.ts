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
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
}));

const _queryResult: { ok: boolean; value?: unknown[]; reason?: string } = { ok: true, value: [] };
let _updateCalls: Array<Record<string, unknown>> = [];
let _insertCalls: Array<Record<string, unknown>> = [];
let _updateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixQueryDataItems: async () => _queryResult,
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
  };
});

import { executePush, RITZ_TENANT_ID } from "@/domains/push/push-service";
import { stripForbiddenFields } from "@/lib/connectors/wix/client";
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

  it("refuses non-field targets and slug fields", async () => {
    const r1 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "h2" }) });
    expect(r1.kind).toBe("refused");
    const r2 = await executePush({ tenantId: "tenant-iranopedia", edit: edit({ target_element_key: "field:slug" }) });
    expect(r2.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
  });

  it("wix client strips slug/url/id keys from every write payload", () => {
    const safe = stripForbiddenFields({
      description: "ok",
      slug: "evil", "link-name": "x", url: "evil", _id: "evil", customSlugField: "evil",
    });
    expect(Object.keys(safe)).toEqual(["description"]);
  });
});

describe("push happy path + failure ledger", () => {
  it("pushes a field-targeted card and records the ledger", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    expect((_updateCalls[0]!.data as Record<string, unknown>).description).toContain("Ferdowsi");
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
