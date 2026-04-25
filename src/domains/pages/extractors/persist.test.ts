import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PageSnapshot } from "../types";
import {
  buildPageElementRows,
  persistPageElements,
  type PageElementInventoryRow,
} from "./persist";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 6 — persist helper tests.
//
// `buildPageElementRows` is the pure-function core: extract via the
// dispatcher, wrap each row with DB-layer fields. These tests assert the
// row-shape contract (everything `page_element_inventory` requires NOT
// NULL is populated, every column maps from snapshot/extracted-element
// or context cleanly) and idempotency.
//
// `persistPageElements` is the in-process variant that also dual-writes
// via `syncPageElementInventory`. We mock the dual-write module so
// failure-mode tests don't need a live Supabase.
// ---------------------------------------------------------------------------

// ── Mocking helpers ────────────────────────────────────────────────────────

const syncMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/persistence/dual-write", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/lib/persistence/dual-write");
  return {
    ...actual,
    syncPageElementInventory: syncMock,
  };
});

// ── Fixture builders ───────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-2026-04-24-services",
    page_id: "pg-services-design-build",
    url: "https://example.com/services/design-build",
    canonical_url: null,
    fetched_at: "2026-04-24T10:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    ...overrides,
  } as PageSnapshot;
}

const TENANT_ID = "tenant-test-acme";

function buildOne() {
  return buildPageElementRows({
    snapshot: makeSnapshot({
      title: "Custom Home Builder · Acme",
      meta_description: "Acme builds custom homes.",
      h1: "Custom Home Builder",
      h2_list: ["Why choose Acme", "Our process"],
    }),
    html: "",
    tenantId: TENANT_ID,
  });
}

// ── buildPageElementRows: row-shape contract ───────────────────────────────

describe("Phase 6A.1.6 — buildPageElementRows row shape", () => {
  it("returns an array (empty when snapshot has zero extractable content)", () => {
    const rows = buildPageElementRows({
      snapshot: makeSnapshot(),
      html: "",
      tenantId: TENANT_ID,
    });
    expect(Array.isArray(rows)).toBe(true);
    // Zero active extractors should fire on an empty snapshot — title/meta/h1
    // are null, h2_list/faqs/schema_types/location_terms empty, html "".
    expect(rows.length).toBe(0);
  });

  it("emits at least one row per active extractor when content is present", () => {
    const rows = buildOne();
    // title (1) + meta (1) + h1 (1) + h2 (2) = ≥5
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // Element types should be a subset of the active set
    const types = new Set(rows.map((r) => r.element_type));
    expect(types.has("title")).toBe(true);
    expect(types.has("meta")).toBe(true);
    expect(types.has("h1")).toBe(true);
    expect(types.has("h2")).toBe(true);
  });

  it("every row has all NOT NULL columns populated", () => {
    const rows = buildOne();
    for (const r of rows) {
      expect(r.id).toBeTypeOf("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.tenant_id).toBeTypeOf("string");
      expect(r.tenant_id.length).toBeGreaterThan(0);
      expect(r.page_id).toBeTypeOf("string");
      expect(r.page_id.length).toBeGreaterThan(0);
      expect(r.url).toBeTypeOf("string");
      expect(r.url.length).toBeGreaterThan(0);
      expect(r.element_type).toBeTypeOf("string");
      expect(r.element_key).toBeTypeOf("string");
      expect(r.element_key.length).toBeGreaterThan(0);
      expect(r.display_label).toBeTypeOf("string");
      expect(r.display_label.length).toBeGreaterThan(0);
      expect(r.element_metadata).toBeTypeOf("object");
      expect(r.extractor_version).toBeTypeOf("number");
      expect(r.observed_at).toBeTypeOf("string");
      expect(r.source_snapshot_id).toBeTypeOf("string");
    }
  });

  it("threads tenant_id from the args to every row", () => {
    const rows = buildOne();
    for (const r of rows) {
      expect(r.tenant_id).toBe(TENANT_ID);
    }
  });

  it("threads source_snapshot_id from snapshot.id to every row", () => {
    const snap = makeSnapshot({
      id: "snap-X",
      title: "T",
      h1: "H",
    });
    const rows = buildPageElementRows({
      snapshot: snap,
      html: "",
      tenantId: TENANT_ID,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.source_snapshot_id).toBe("snap-X");
    }
  });

  it("threads page_id + url from the snapshot to every row", () => {
    const snap = makeSnapshot({
      id: "snap-Y",
      page_id: "pg-locations-palo-alto",
      url: "https://example.com/locations/palo-alto",
      title: "Palo Alto",
    });
    const rows = buildPageElementRows({
      snapshot: snap,
      html: "",
      tenantId: TENANT_ID,
    });
    for (const r of rows) {
      expect(r.page_id).toBe("pg-locations-palo-alto");
      expect(r.url).toBe("https://example.com/locations/palo-alto");
    }
  });

  it("uses snapshot.fetched_at as observed_at", () => {
    const snap = makeSnapshot({
      fetched_at: "2026-05-15T07:00:00Z",
      title: "T",
    });
    const rows = buildPageElementRows({
      snapshot: snap,
      html: "",
      tenantId: TENANT_ID,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.observed_at).toBe("2026-05-15T07:00:00Z");
    }
  });

  it("derives id deterministically from snapshot.id + element_key", () => {
    const rows = buildOne();
    for (const r of rows) {
      expect(r.id).toBe(`${r.source_snapshot_id}__${r.element_key}`);
    }
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────

describe("Phase 6A.1.6 — buildPageElementRows idempotency", () => {
  it("produces the same rows on repeated calls with the same input", () => {
    const a = buildOne();
    const b = buildOne();
    // Same row count
    expect(a.length).toBe(b.length);
    // Same id set (deterministic)
    const idsA = a.map((r) => r.id).sort();
    const idsB = b.map((r) => r.id).sort();
    expect(idsA).toEqual(idsB);
    // Same element_key set
    const keysA = a.map((r) => r.element_key).sort();
    const keysB = b.map((r) => r.element_key).sort();
    expect(keysA).toEqual(keysB);
  });

  it("element_keys (with content hash) shift when content changes — id shifts in lockstep", () => {
    const beforeRows = buildPageElementRows({
      snapshot: makeSnapshot({ title: "Old Title" }),
      html: "",
      tenantId: TENANT_ID,
    });
    const afterRows = buildPageElementRows({
      snapshot: makeSnapshot({ title: "New Title" }),
      html: "",
      tenantId: TENANT_ID,
    });
    const beforeTitle = beforeRows.find((r) => r.element_type === "title")!;
    const afterTitle = afterRows.find((r) => r.element_type === "title")!;
    expect(beforeTitle.element_key).not.toBe(afterTitle.element_key);
    expect(beforeTitle.id).not.toBe(afterTitle.id);
  });
});

// ── Dictionary threading ───────────────────────────────────────────────────

describe("Phase 6A.1.6 — dictionary threading (tenant-agnostic)", () => {
  it("city_mention rows reflect the cityDictionary passed in (no Ritz hardcoding)", () => {
    const html = `<html><body><main>
      <p>We work in Burbank and Pasadena.</p>
    </main></body></html>`;
    const rows = buildPageElementRows({
      snapshot: makeSnapshot({ word_count: 100 }),
      html,
      tenantId: TENANT_ID,
      cityDictionary: ["Burbank", "Pasadena"],
    });
    const cityMentions = rows.filter((r) => r.element_type === "city_mention");
    const labels = new Set(cityMentions.map((r) => r.element_text));
    expect(labels.has("Burbank")).toBe(true);
    expect(labels.has("Pasadena")).toBe(true);
  });

  it("service_mention rows reflect the serviceDictionary passed in", () => {
    const html = `<html><body><main>
      <p>We do roof replacement work and chimney rebuild jobs.</p>
    </main></body></html>`;
    const rows = buildPageElementRows({
      snapshot: makeSnapshot({ word_count: 100 }),
      html,
      tenantId: TENANT_ID,
      serviceDictionary: ["roof replacement", "chimney rebuild"],
    });
    const serviceMentions = rows.filter(
      (r) => r.element_type === "service_mention",
    );
    expect(serviceMentions.length).toBeGreaterThanOrEqual(2);
  });
});

// ── persistPageElements: dual-write integration ────────────────────────────

describe("Phase 6A.1.6 — persistPageElements", () => {
  beforeEach(() => {
    syncMock.mockReset();
    syncMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls syncPageElementInventory exactly once with the built rows", async () => {
    const rows = await persistPageElements({
      snapshot: makeSnapshot({ title: "T", h1: "H1" }),
      html: "",
      tenantId: TENANT_ID,
    });
    expect(syncMock).toHaveBeenCalledTimes(1);
    const passedRows = (syncMock.mock.calls[0] as unknown as [
      PageElementInventoryRow[],
    ])[0];
    expect(passedRows.length).toBe(rows.length);
    expect(passedRows[0]?.tenant_id).toBe(TENANT_ID);
  });

  it("returns the rows it dual-wrote", async () => {
    const rows = await persistPageElements({
      snapshot: makeSnapshot({ title: "T" }),
      html: "",
      tenantId: TENANT_ID,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT_ID)).toBe(true);
  });

  it("swallows dual-write failures and returns [] (snapshot path is upstream)", async () => {
    syncMock.mockImplementationOnce(async () => {
      throw new Error("simulated supabase outage");
    });
    const rows = await persistPageElements({
      snapshot: makeSnapshot({ title: "T" }),
      html: "",
      tenantId: TENANT_ID,
    });
    expect(rows).toEqual([]);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("does not throw when given a snapshot with zero extractable content", async () => {
    const rows = await persistPageElements({
      snapshot: makeSnapshot(),
      html: "",
      tenantId: TENANT_ID,
    });
    expect(rows).toEqual([]);
    // syncPageElementInventory called with [] — helper short-circuits to no-op.
    expect(syncMock).toHaveBeenCalledTimes(1);
    const passed = (syncMock.mock.calls[0] as unknown as [
      PageElementInventoryRow[],
    ])[0];
    expect(passed).toEqual([]);
  });
});
