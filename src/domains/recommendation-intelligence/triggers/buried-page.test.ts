import { describe, expect, it } from "vitest";

import { buriedPage, MIN_IMPRESSIONS_90D, TOO_DEEP_HOPS } from "./buried-page";
import type { PageAuthority } from "@/domains/linkgraph/internal-pagerank";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function auth(over: Partial<PageAuthority> = {}): PageAuthority {
  return {
    url: "https://x.com/a",
    authorityScore: 0.1,
    clickDepth: 2,
    orphaned: false,
    inboundCount: 3,
    ...over,
  };
}

describe("buriedPage", () => {
  it("emits an add_internal_link for a high-demand page nothing links to", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [auth({ url: "https://x.com/iran-visa", orphaned: true, inboundCount: 0, clickDepth: null })],
      impressionsByUrl: new Map([["https://x.com/iran-visa", 340]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("add_internal_link");
    expect(rows[0]!.trigger_signal).toBe("buried_page");
    expect(rows[0]!.target_url).toBe("https://x.com/iran-visa");
    expect(rows[0]!.confidence).toBe("medium");
    expect(rows[0]!.customer_copy).toContain("/iran-visa");
    expect(rows[0]!.customer_copy).toContain("nothing else on your site links to it");
    expect(rows[0]!.customer_copy).toContain("340");
    // No lab words, no em/en dash.
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("orphan");
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("pagerank");
    expect(rows[0]!.customer_copy).not.toMatch(/[—–]/);
  });

  it("emits a too-deep card for a high-demand page buried many clicks from home", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [auth({ url: "https://x.com/deep", orphaned: false, inboundCount: 1, clickDepth: TOO_DEEP_HOPS + 1 })],
      impressionsByUrl: new Map([["https://x.com/deep", 500]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customer_copy).toContain("clicks from your homepage");
    expect(rows[0]!.customer_copy).toContain(String(TOO_DEEP_HOPS + 1));
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("click-depth");
  });

  it("DEMAND GATE: a low-demand page never fires (even orphaned/deep)", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [
        auth({ url: "https://x.com/lowtraffic", orphaned: true, inboundCount: 0, clickDepth: null }),
      ],
      impressionsByUrl: new Map([["https://x.com/lowtraffic", MIN_IMPRESSIONS_90D - 1]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toEqual([]);
  });

  it("emits only ONE card per page (orphan wins over too-deep)", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [
        auth({ url: "https://x.com/both", orphaned: true, inboundCount: 0, clickDepth: 6 }),
      ],
      impressionsByUrl: new Map([["https://x.com/both", 400]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customer_copy).toContain("nothing else on your site links to it");
  });

  it("a well-linked, shallow page never fires", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [auth({ url: "https://x.com/good", orphaned: false, inboundCount: 5, clickDepth: 2 })],
      impressionsByUrl: new Map([["https://x.com/good", 1000]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toEqual([]);
  });

  it("BYTE-IDENTICAL EMPTY: empty authorities yields []", () => {
    expect(buriedPage({ tenantId: "t", authorities: [], impressionsByUrl: new Map(), signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("ranks highest-demand first and caps emissions", () => {
    const authorities: PageAuthority[] = Array.from({ length: 8 }, (_, i) =>
      auth({ url: `https://x.com/p${i}`, orphaned: true, inboundCount: 0, clickDepth: null }),
    );
    const impressionsByUrl = new Map(authorities.map((a, i) => [a.url, 200 + i]));
    const rows = buriedPage({ tenantId: "t", authorities, impressionsByUrl, signalAt: SIGNAL_AT, maxEmissions: 3 });
    expect(rows).toHaveLength(3);
    // p7 has the most impressions (200+7) -> first.
    expect(rows[0]!.target_url).toBe("https://x.com/p7");
  });

  it("stable dedupe/cooldown keys let the loader dedupe against orphan_page", () => {
    const rows = buriedPage({
      tenantId: "t",
      authorities: [auth({ url: "https://x.com/iran-visa", orphaned: true, inboundCount: 0, clickDepth: null })],
      impressionsByUrl: new Map([["https://x.com/iran-visa", 340]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0]!.dedupe_key).toMatch(/^[0-9a-f]{40}$/);
  });
});
