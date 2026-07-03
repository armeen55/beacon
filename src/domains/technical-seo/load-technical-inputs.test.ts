import { describe, expect, it } from "vitest";

import {
  assembleTechnicalInputs,
  statusToLiveness,
  type TechnicalInspection,
} from "./load-technical-inputs";
import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "id",
    page_id: "pid",
    url: "https://iranopedia.com/a",
    canonical_url: null,
    fetched_at: "2026-07-01T00:00:00Z",
    http_status: 200,
    title: "A",
    meta_description: null,
    h1: "A",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "t",
    ...over,
  };
}

function gsc(over: Partial<GscPageSignal> = {}): GscPageSignal {
  return {
    page: "https://iranopedia.com/a",
    clicks90d: 0,
    impressions90d: 0,
    ctr90d: 0,
    position90d: 0,
    topQueries: [],
    ...over,
  };
}

describe("statusToLiveness", () => {
  it("maps 2xx/3xx -> live, 4xx/5xx -> dead, 0/undefined -> unknown", () => {
    expect(statusToLiveness(200)).toBe("live");
    expect(statusToLiveness(301)).toBe("live");
    expect(statusToLiveness(404)).toBe("dead");
    expect(statusToLiveness(500)).toBe("dead");
    expect(statusToLiveness(0)).toBe("unknown");
    expect(statusToLiveness(undefined)).toBe("unknown");
  });
});

describe("assembleTechnicalInputs", () => {
  it("returns empty shapes for no snapshots (byte-identical clean baseline)", () => {
    const out = assembleTechnicalInputs({
      snapshots: [],
      gscSignals: new Map(),
      inspectionByUrl: new Map(),
    });
    expect(out.deadUrlPages).toEqual([]);
    expect(out.brokenLinkPages).toEqual([]);
    expect(out.redirectPages).toEqual([]);
    expect(out.unknownLinkTargets).toEqual([]);
    expect(out.redirectingOwnedUrls).toEqual([]);
  });

  it("joins GSC demand + inspection coverage onto each dead-URL page", () => {
    const out = assembleTechnicalInputs({
      snapshots: [snap({ url: "https://iranopedia.com/a", http_status: 404 })],
      gscSignals: new Map<string, GscPageSignal>([
        ["https://iranopedia.com/a", gsc({ impressions90d: 500, clicks90d: 10 })],
      ]),
      inspectionByUrl: new Map<string, TechnicalInspection>([
        ["https://iranopedia.com/a", { coverageState: "Not found (404)" }],
      ]),
    });
    expect(out.deadUrlPages[0]).toMatchObject({
      url: "https://iranopedia.com/a",
      httpStatus: 404,
      coverageState: "Not found (404)",
      impressions90d: 500,
      clicks90d: 10,
    });
  });

  it("resolves + dedupes internal links, drops self-links, tags unknown targets", () => {
    const out = assembleTechnicalInputs({
      snapshots: [
        snap({
          url: "https://iranopedia.com/source",
          internal_links: [
            { href: "/source", anchor_text: "self" }, // self-link dropped
            { href: "/owned-dead", anchor_text: "dead" },
            { href: "/owned-dead", anchor_text: "dup" }, // dedupe
            { href: "https://external.com/gone", anchor_text: "ext" }, // unknown target
          ],
        }),
        snap({ url: "https://iranopedia.com/owned-dead", http_status: 404 }),
      ],
      gscSignals: new Map(),
      inspectionByUrl: new Map(),
    });
    const src = out.brokenLinkPages.find((p) => p.sourceUrl === "https://iranopedia.com/source");
    expect(src!.links.map((l) => l.targetUrl)).toEqual([
      "https://iranopedia.com/owned-dead",
      "https://external.com/gone",
    ]);
    // owned-dead has a 404 snapshot -> its status is in statusByUrl (liveness=dead).
    expect(out.statusByUrl.get("https://iranopedia.com/owned-dead")).toBe(404);
    // external target has no snapshot -> flagged for the live-liveness pass.
    expect(out.unknownLinkTargets).toContain("https://external.com/gone");
    // owned-dead is a snapshot, NOT an unknown target.
    expect(out.unknownLinkTargets).not.toContain("https://iranopedia.com/owned-dead");
  });

  it("flags demand-carrying owned redirecting pages for chain probing only", () => {
    const out = assembleTechnicalInputs({
      snapshots: [
        snap({ url: "https://iranopedia.com/redir", http_status: 301 }),
        snap({ url: "https://iranopedia.com/lowdemand-redir", http_status: 302 }),
        snap({ url: "https://iranopedia.com/ok", http_status: 200 }),
      ],
      gscSignals: new Map<string, GscPageSignal>([
        ["https://iranopedia.com/redir", gsc({ impressions90d: 400 })],
        ["https://iranopedia.com/lowdemand-redir", gsc({ impressions90d: 5 })],
      ]),
      inspectionByUrl: new Map(),
    });
    expect(out.redirectingOwnedUrls).toContain("https://iranopedia.com/redir");
    // below the demand floor -> not probed.
    expect(out.redirectingOwnedUrls).not.toContain("https://iranopedia.com/lowdemand-redir");
    // a 200 page never gets probed.
    expect(out.redirectingOwnedUrls).not.toContain("https://iranopedia.com/ok");
  });
});
