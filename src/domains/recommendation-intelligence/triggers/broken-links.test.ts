import { describe, expect, it } from "vitest";

import { brokenLinks, MAX_BROKEN_LINKS_EMISSIONS } from "./broken-links";
import type { BrokenLinkFinding } from "@/domains/technical-seo/broken-links";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function finding(over: Partial<BrokenLinkFinding> = {}): BrokenLinkFinding {
  return {
    sourceUrl: "https://iranopedia.com/persian-food",
    deadTargets: [{ targetUrl: "https://iranopedia.com/gone", anchorText: "gone" }],
    reason_copy: "1 link on your /persian-food page points at a page that no longer exists.",
    evidence: "broken_links: test",
    ...over,
  };
}

describe("brokenLinks trigger", () => {
  it("emits nothing when there is no link data (data unavailable, not 'clean')", () => {
    expect(
      brokenLinks({ tenantId: "t", findings: [finding()], hasLinkData: false, signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("emits nothing for an empty finding list even with link data (byte-identical)", () => {
    expect(
      brokenLinks({ tenantId: "t", findings: [], hasLinkData: true, signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("maps a finding -> add_internal_link at confidence medium", () => {
    const rows = brokenLinks({
      tenantId: "t",
      findings: [finding()],
      hasLinkData: true,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("add_internal_link");
    expect(rows[0]!.confidence).toBe("medium");
    expect(rows[0]!.trigger_signal).toBe("broken_internal_links");
    expect(rows[0]!.target_url).toBe("https://iranopedia.com/persian-food");
  });

  it("ranks by dead-link count and caps at the max", () => {
    const findings: BrokenLinkFinding[] = [];
    for (let i = 0; i < MAX_BROKEN_LINKS_EMISSIONS + 3; i++) {
      findings.push(
        finding({
          sourceUrl: `https://iranopedia.com/p${i}`,
          deadTargets: Array.from({ length: i + 1 }, (_, j) => ({
            targetUrl: `https://iranopedia.com/d${i}-${j}`,
            anchorText: "x",
          })),
        }),
      );
    }
    const rows = brokenLinks({ tenantId: "t", findings, hasLinkData: true, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_BROKEN_LINKS_EMISSIONS);
    // most dead links first
    expect(rows[0]!.target_url).toBe(`https://iranopedia.com/p${MAX_BROKEN_LINKS_EMISSIONS + 2}`);
  });
});
