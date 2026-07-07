import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { writeStore } from "@/lib/persistence/json-store";
import type { ImportRun } from "@/lib/import/types";
import type { ConnectorToken, YelpConnectorToken } from "@/lib/connector-store";

// 2026-05-16 connector-tokens-supabase-and-gsc-scope-split:
// in-memory mock of the new async connector-store API.
let _tokenStore: Map<string, ConnectorToken> = new Map();

vi.mock("@/lib/connector-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/connector-store")>(
    "@/lib/connector-store",
  );
  return {
    ...actual,
    saveConnectorToken: vi.fn(async (token: ConnectorToken) => {
      _tokenStore.set(token.provider, token);
    }),
    getConnectorToken: vi.fn(async (provider: string) => {
      return _tokenStore.get(provider) ?? null;
    }),
    getGoogleConnectorToken: vi.fn(async (kind: "gsc" | "gbp" = "gsc") => {
      const key = kind === "gsc" ? "google_gsc" : "google_gbp";
      const t = _tokenStore.get(key);
      return t != null && (t.provider === "google_gsc" || t.provider === "google_gbp") ? t : null;
    }),
    getYelpConnectorToken: vi.fn(async () => {
      const t = _tokenStore.get("yelp");
      return t != null && t.provider === "yelp" ? t : null;
    }),
    getConnectorInfo: vi.fn(async (provider: string) => {
      const t = _tokenStore.get(provider);
      if (!t) {
        return {
          status: "disconnected" as const,
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        };
      }
      if (t.provider === "google_gsc" || t.provider === "google_gbp") {
        return {
          status: "connected" as const,
          connected_at: t.connected_at,
          expires_at: t.expires_at,
          last_synced_at: t.last_synced_at ?? null,
          selected_location_id: t.selected_location_id ?? null,
          selected_location_name: t.selected_location_name ?? null,
        };
      }
      return {
        status: "connected" as const,
        connected_at: t.connected_at,
        expires_at: null,
        last_synced_at: t.last_synced_at ?? null,
      };
    }),
  };
});

import { saveConnectorToken } from "@/lib/connector-store";

// Hermeticity (2026-06-14): the import-runs json-store has an anti-race
// guard that REFUSES to overwrite a non-empty file with `[]` (so a startup
// race never flushes an empty array). The global test fixture seeds an
// import-run, so `writeStore("import-runs", [])` is a no-op and the
// freshness read leaks the fixture's "Last imported …". Seed a single
// NON-qualifying run instead (imported_count: 0 → excluded by the manual-
// review filter in lastManualReviewsImportCompletedAt) — non-empty, so the
// guard allows the overwrite, and freshness still reads "No imports yet".
const NO_MANUAL_IMPORTS: ImportRun[] = [
  {
    id: "test-noop-import",
    entity_type: "reviews",
    source_system: "manual_csv",
    imported_count: 0,
    completed_at: "2026-01-01T00:00:00.000Z",
  } as unknown as ImportRun,
];

describe("Local presence route smoke", () => {
  beforeEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", NO_MANUAL_IMPORTS);
    _tokenStore = new Map();
  });

  afterEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", NO_MANUAL_IMPORTS);
    _tokenStore = new Map();
  });

  it("LocalPresencePage renders read-only framing and disclosure", async () => {
    // A connected local source (Google Business Profile) makes the listing-health
    // scorecard render. A fully-cold tenant with no source shows the honest empty
    // state instead (covered by "fully-cold tenant shows the honest empty state").
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T18:00:00.000Z",
    });
    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Local presence");
    expect(html).toContain("read-only");
    expect(html).toContain("not live directory truth");
    expect(html).toContain("Listing identity");
    expect(html).toContain("Listing health");
    expect(html).toContain("/ 100");
    expect(html).toContain("No review data yet");
    expect(html).toContain("Listing completeness");
    expect(html).toContain("data-testid=\"local-listing-completeness\"");
    expect(html).toContain("How this works");
    expect(html).toContain("/settings/methodology");
  });

  it("Data freshness shows each source, with empty-state copy for unsynced sources", async () => {
    // One connected source (Google) renders the scorecard; Yelp + manual stay
    // empty so their per-source empty-state copy is still asserted.
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T18:00:00.000Z",
    });
    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Data freshness");
    expect(html).toContain('data-testid="local-data-freshness"');
    expect(html).toContain("Never synced"); // Yelp: no token
    expect(html).toContain("No imports yet"); // manual: no qualifying import
    expect(html).toContain("Each source updates independently");
    expect(html).toContain("Based only on imported or synced data");
    expect(html).toContain("No automatic syncing unless you trigger it");
    expect(html).toContain("#review-source-timestamps");
  });

  it("fully-cold tenant shows the honest empty state (no 0/100 scorecard)", async () => {
    // No reviews, no connected source, no qualifying import -> nothing honest to
    // score. The page must show the connect-a-source empty state, NOT a listing-
    // health scorecard reading "0 / 100" (a bare zero that reads as "you scored 0").
    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Local presence");
    expect(html).toContain("No local health to show yet");
    expect(html).toContain("Connect Google Business Profile");
    expect(html).not.toContain("/ 100");
  });

  it("Data freshness shows manual import when only manual ImportRun exists", async () => {
    const run: ImportRun = {
      id: "manual-1",
      source_system: "csv",
      entity_type: "reviews",
      format: "csv",
      started_at: "2026-04-10T10:00:00.000Z",
      completed_at: "2026-04-10T10:05:00.000Z",
      total_rows: 2,
      imported_count: 2,
      skipped_count: 0,
      errors: [],
      warnings: [],
      tenant_id: "tenant-test",
    };
    await writeStore("import-runs", [run]);

    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Last imported:");
    expect(html).toContain("Never synced");
  });

  it("Data freshness shows Google, Yelp, and manual when all timestamps exist", async () => {
    await saveConnectorToken({
      provider: "google_gbp",
      access_token: "a",
      refresh_token: "r",
      expires_at: Date.now() + 3_600_000,
      connected_at: "2026-04-13T08:00:00.000Z",
      scopes: [],
      last_synced_at: "2026-04-13T18:00:00.000Z",
    });
    const yelp: YelpConnectorToken = {
      provider: "yelp",
      api_key: "k",
      connected_at: "2026-04-13T08:00:00.000Z",
      business_id: "b",
      last_synced_at: "2026-04-14T12:00:00.000Z",
    };
    await saveConnectorToken(yelp);
    const run: ImportRun = {
      id: "manual-2",
      source_system: "json",
      entity_type: "reviews",
      format: "json",
      started_at: "2026-04-11T10:00:00.000Z",
      completed_at: "2026-04-11T10:05:00.000Z",
      total_rows: 1,
      imported_count: 1,
      skipped_count: 0,
      errors: [],
      warnings: [],
      tenant_id: "tenant-test",
    };
    await writeStore("import-runs", [run]);

    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html.match(/Last synced:/g)?.length).toBe(2);
    expect(html).toContain("Last imported:");
    expect(html).not.toContain("Never synced");
    expect(html).not.toContain("No imports yet");
  });
});
