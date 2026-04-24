/**
 * Regression test for Phase 2.5-DIAG Fix 1 (2026-04-24).
 *
 * PostgREST caps non-paginated `.select("*")` responses at 1000 rows by
 * default. Tables that exceed that cap MUST go through `queryAllPaged` in
 * `supabase-backend.ts`, not the unbounded `query` helper.
 *
 * The bug: `getPages: () => query<PageEntity>("pages")` truncated the hosted
 * page inventory to ~3 owned rows (out of 37), making the recommendation
 * resolver fall through to create_new_page for every blocker cluster.
 *
 * This test mocks the Supabase client's fluent `.from().select().range()`
 * API so we can simulate the 1000-row cap and prove the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

// Shared mutable pool of rows the mock client will serve. Each test resets it.
let mockPagesRows: PageEntity[] = [];

// Minimal mock of the Supabase fluent API. Only the methods supabase-backend.ts
// actually calls: `.from(table).select("*").range(from, to)` and
// `.from(table).select("*")` (unpaged). Returns `{ data, error }` shape.
function makeMockClient(tableRows: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          const rows = tableRows[table] ?? [];
          return {
            range(from: number, to: number) {
              return Promise.resolve({
                data: rows.slice(from, to + 1),
                error: null,
                count: opts?.count === "exact" ? rows.length : null,
              });
            },
            // non-ranged select — PostgREST would truncate at 1000 here, which
            // is exactly the behavior we want to prevent for paginated tables.
            then(
              resolve: (v: { data: unknown[]; error: null }) => unknown,
            ): unknown {
              return resolve({
                data: rows.slice(0, 1000),
                error: null,
              });
            },
            order(_col: string, _opts: { ascending: boolean }) {
              return {
                range: (from: number, to: number) =>
                  Promise.resolve({
                    data: rows.slice(from, to + 1),
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () =>
    makeMockClient({
      pages: mockPagesRows as unknown[],
    }),
}));

// Imports AFTER the mock so supabase-backend picks up the mocked admin.
import { supabaseBackend } from "@/lib/persistence/repositories/supabase-backend";
import { buildPageInventory } from "@/domains/recommendations/page-inventory";

// --- test fixtures ---

function makePage(i: number, overrides: Partial<PageEntity> = {}): PageEntity {
  return {
    id: `pg-${i}`,
    url: `https://competitor${i}.com/some-path-${i}`,
    canonical_url: `https://competitor${i}.com/some-path-${i}`,
    domain: `competitor${i}.com`,
    path: `/some-path-${i}`,
    page_type: "other",
    city: null,
    service: null,
    topics: [],
    ownership_tier: "competitor",
    tracked_entity_id: null,
    is_owned: false,
    first_seen_at: "2026-03-01T00:00:00Z",
    last_observed_at: "2026-04-24T00:00:00Z",
    discovery_sources: [],
    title_last_seen: null,
    changelog_ids: [],
    metadata: {},
    tenant_id: "",
    ...overrides,
  };
}

const OWNED_ENTITY: TrackedEntity = {
  id: "own-ritzbuilders-com",
  account_id: "ritz-builders",
  entity_type: "brand",
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  url: "https://ritzbuilders.com",
  location_scope: "Bay Area",
  service_scope: "custom home building",
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-22T19:25:41.868Z",
  updated_at: "2026-04-22T19:25:41.868Z",
};

describe("supabase-backend pagination (Phase 2.5-DIAG Fix 1)", () => {
  beforeEach(() => {
    mockPagesRows = [];
  });

  afterEach(() => {
    mockPagesRows = [];
  });

  it("getPages returns every row when the table has > 1000 rows", async () => {
    // 2001 total: 2000 competitor fillers + 1 owned Ritz row at index 1500.
    const rows: PageEntity[] = [];
    for (let i = 0; i < 2001; i += 1) rows.push(makePage(i));
    rows[1500] = makePage(1500, {
      id: "pg-ritz-palo-alto",
      url: "https://ritzbuilders.com/locations/palo-alto",
      canonical_url: "https://ritzbuilders.com/locations/palo-alto",
      domain: "ritzbuilders.com",
      path: "/locations/palo-alto",
      page_type: "city_page",
      city: "palo alto",
      is_owned: true,
      title_last_seen: "Custom Home Builder Palo Alto | Ritz Builders",
    });
    mockPagesRows = rows;

    const got = await supabaseBackend.getPages();

    // The whole point: with non-paginated query this would return 1000.
    expect(got.length).toBe(2001);
    // And the owned row past the cap is present.
    expect(
      got.some((p) => p.url === "https://ritzbuilders.com/locations/palo-alto"),
    ).toBe(true);
  });

  it("owned rows past row 1000 reach buildPageInventory", async () => {
    const rows: PageEntity[] = [];
    for (let i = 0; i < 1500; i += 1) rows.push(makePage(i));
    rows.push(
      makePage(1500, {
        id: "pg-ritz-palo-alto",
        url: "https://ritzbuilders.com/locations/palo-alto",
        canonical_url: "https://ritzbuilders.com/locations/palo-alto",
        domain: "ritzbuilders.com",
        path: "/locations/palo-alto",
        page_type: "city_page",
        city: "palo alto",
        is_owned: true,
        title_last_seen: "Custom Home Builder Palo Alto | Ritz Builders",
      }),
    );
    rows.push(
      makePage(1501, {
        id: "pg-ritz-design-build",
        url: "https://ritzbuilders.com/services/design-build",
        canonical_url: "https://ritzbuilders.com/services/design-build",
        domain: "ritzbuilders.com",
        path: "/services/design-build",
        page_type: "service_page",
        city: "bay area",
        is_owned: true,
        title_last_seen: "Design-Build Bay Area | Ritz Builders",
      }),
    );
    mockPagesRows = rows;

    const pages = await supabaseBackend.getPages();
    const synthSnapshot = (pageId: string, title: string): PageSnapshot => ({
      id: `snap-${pageId}`,
      page_id: pageId,
      url: "",
      canonical_url: null,
      fetched_at: "2026-04-22T00:00:00Z",
      http_status: 200,
      title,
      meta_description: null,
      h1: title,
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
      content_hash: "",
      headings_hash: "",
      faq_hash: "",
      schema_hash: "",
      tenant_id: "",
    });
    const snapshots: PageSnapshot[] = [
      synthSnapshot("pg-ritz-palo-alto", "Custom Home Builder Palo Alto | Ritz Builders"),
      synthSnapshot("pg-ritz-design-build", "Design-Build Bay Area | Ritz Builders"),
    ];

    const inventory = buildPageInventory({
      pages,
      snapshots,
      activeEntities: [OWNED_ENTITY],
    });

    const urls = inventory.map((e) => e.url);
    expect(urls).toContain("https://ritzbuilders.com/locations/palo-alto");
    expect(urls).toContain("https://ritzbuilders.com/services/design-build");
    // Exactly two owned rows should pass the host filter.
    expect(inventory.length).toBe(2);
  });
});
