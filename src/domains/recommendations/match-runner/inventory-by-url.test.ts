import { describe, it, expect } from "vitest";

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageSnapshot } from "@/domains/pages/types";
import { buildInventoryByUrl } from "./inventory-by-url";

function snap(id: string, url: string, fetchedAt: string): PageSnapshot {
  return {
    id,
    page_id: "p",
    url,
    canonical_url: null,
    fetched_at: fetchedAt,
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
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    observation_run_id: "obs-1",
    tenant_id: "tenant-test",
  };
}

function row(
  id: string,
  url: string,
  snapshotId: string,
  type: PageElementInventoryRow["element_type"] = "h2",
): PageElementInventoryRow {
  return {
    id,
    tenant_id: "tenant-test",
    page_id: "p",
    url,
    element_type: type,
    element_key: id,
    display_label: id,
    element_text: id,
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-27T00:00:00.000Z",
    source_snapshot_id: snapshotId,
  };
}

describe("buildInventoryByUrl", () => {
  it("keeps only rows from the latest snapshot per URL", () => {
    const result = buildInventoryByUrl(
      [
        row("e1", "https://x.com/a", "snap-old"),
        row("e2", "https://x.com/a", "snap-new"),
        row("e3", "https://x.com/a", "snap-new"),
        row("e4", "https://x.com/b", "snap-other"),
      ],
      [
        snap("snap-old", "https://x.com/a", "2026-04-26T00:00:00Z"),
        snap("snap-new", "https://x.com/a", "2026-04-27T00:00:00Z"),
        snap("snap-other", "https://x.com/b", "2026-04-27T00:00:00Z"),
      ],
    );
    const aRows = result.byUrl.get("https://x.com/a") ?? [];
    expect(aRows.map((r) => r.id).sort()).toEqual(["e2", "e3"]);
    expect(result.byUrl.get("https://x.com/b")?.[0]!.id).toBe("e4");
  });

  it("latestSnapshotByUrl returns the freshest snapshot per URL", () => {
    const result = buildInventoryByUrl(
      [],
      [
        snap("a-old", "https://x.com/a", "2026-04-25T00:00:00Z"),
        snap("a-mid", "https://x.com/a", "2026-04-26T00:00:00Z"),
        snap("a-new", "https://x.com/a", "2026-04-27T00:00:00Z"),
      ],
    );
    expect(result.latestSnapshotByUrl.get("https://x.com/a")?.id).toBe("a-new");
  });

  it("drops inventory rows whose URL has no snapshot", () => {
    const result = buildInventoryByUrl(
      [row("orphan", "https://x.com/orphan", "snap-x")],
      [],
    );
    expect(result.byUrl.size).toBe(0);
  });

  it("drops inventory rows whose source_snapshot_id is not the latest for that URL", () => {
    const result = buildInventoryByUrl(
      [row("stale", "https://x.com/a", "snap-old")],
      [
        snap("snap-old", "https://x.com/a", "2026-04-26T00:00:00Z"),
        snap("snap-new", "https://x.com/a", "2026-04-27T00:00:00Z"),
      ],
    );
    expect(result.byUrl.size).toBe(0);
  });

  it("does not mutate inputs", () => {
    const inv = Object.freeze([row("e", "u", "s")]);
    const snaps = Object.freeze([snap("s", "u", "2026-01-01T00:00:00Z")]);
    expect(() =>
      buildInventoryByUrl(
        inv as ReadonlyArray<PageElementInventoryRow>,
        snaps as ReadonlyArray<PageSnapshot>,
      ),
    ).not.toThrow();
  });
});
