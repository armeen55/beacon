import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { writeStore } from "@/lib/persistence/json-store";
import type { ImportRun } from "@/lib/import/types";
import {
  _deleteStoreFile,
  _resetCache,
  saveConnectorToken,
  type YelpConnectorToken,
} from "@/lib/connector-store";

describe("Local presence route smoke", () => {
  beforeEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
    _deleteStoreFile();
    _resetCache();
  });

  afterEach(async () => {
    await writeStore("local-reviews", []);
    await writeStore("import-runs", []);
    _deleteStoreFile();
    _resetCache();
  });

  it("LocalPresencePage renders read-only framing and disclosure", async () => {
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

  it("Data freshness shows all three sources with empty-state copy", async () => {
    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Data freshness");
    expect(html).toContain('data-testid="local-data-freshness"');
    expect(html).toContain("Never synced");
    expect(html).toContain("No imports yet");
    expect(html).toContain("Each source updates independently");
    expect(html).toContain("Based only on imported or synced data");
    expect(html).toContain("No automatic syncing unless you trigger it");
    expect(html).toContain("#review-source-timestamps");
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
    };
    await writeStore("import-runs", [run]);

    const { default: LocalPresencePage } = await import("@/app/(shell)/local/page");
    const tree = await LocalPresencePage();
    const html = renderToStaticMarkup(tree as ReactElement);

    expect(html).toContain("Last imported:");
    expect(html).toContain("Never synced");
  });

  it("Data freshness shows Google, Yelp, and manual when all timestamps exist", async () => {
    saveConnectorToken({
      provider: "google",
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
    saveConnectorToken(yelp);
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
