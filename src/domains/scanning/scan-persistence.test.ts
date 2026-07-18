import { describe, expect, it } from "vitest";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageSnapshot } from "@/domains/pages/types";
import {
  mergeLatestCanonicalInventory,
  mergeLatestCanonicalSnapshots,
  pageFetchRejectionReason,
} from "./scan-persistence";

function snapshot(id: string, url: string): PageSnapshot {
  return { id, page_id: id, url } as PageSnapshot;
}

function row(id: string, url: string): PageElementInventoryRow {
  return { id, url } as PageElementInventoryRow;
}

describe("pageFetchRejectionReason", () => {
  it("rejects HTTP error documents and short rendering shells", () => {
    expect(pageFetchRejectionReason({ html: "x".repeat(2_000), status: 404 })).toBe("HTTP 404");
    expect(pageFetchRejectionReason({ html: "<div id='root'></div>", status: 200 })).toContain(
      "incomplete rendering shell",
    );
  });

  it("accepts a substantial successful HTML response", () => {
    expect(pageFetchRejectionReason({ html: "x".repeat(500), status: 200 })).toBeNull();
  });
});

describe("latest canonical persistence", () => {
  it("keeps prior canonical snapshots after partial scans and drops removed URLs", () => {
    const result = mergeLatestCanonicalSnapshots({
      canonicalUrls: ["https://site.test/a", "https://site.test/b/"],
      freshSnapshots: [snapshot("new-a", "https://site.test/a/")],
      previousSnapshots: [
        snapshot("old-a", "https://site.test/a"),
        snapshot("old-b", "https://site.test/b"),
        snapshot("removed", "https://site.test/removed"),
      ],
    });

    expect(result.map((item) => item.id)).toEqual(["new-a", "old-b"]);
  });

  it("replaces inventory only for freshly observed pages", () => {
    const result = mergeLatestCanonicalInventory({
      canonicalUrls: ["https://site.test/a", "https://site.test/b"],
      freshRows: [row("new-a", "https://site.test/a")],
      previousRows: [
        row("old-a", "https://site.test/a/"),
        row("old-b", "https://site.test/b"),
        row("removed", "https://site.test/removed"),
      ],
      freshSnapshotUrls: ["https://site.test/a"],
    });

    expect(result.map((item) => item.id)).toEqual(["new-a", "old-b"]);
  });
});
