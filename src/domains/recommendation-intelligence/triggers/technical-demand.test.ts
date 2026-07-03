import { describe, expect, it } from "vitest";

import { technicalDemand, MAX_TECHNICAL_DEMAND_EMISSIONS } from "./technical-demand";
import type { TechnicalDemandFinding } from "@/domains/lifecycle/technical-demand";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function finding(over: Partial<TechnicalDemandFinding> = {}): TechnicalDemandFinding {
  return {
    url: "https://x.com/a",
    kind: "bad_status",
    reason: "Your /a page returns an error.",
    evidence: "technical_demand: test",
    ...over,
  };
}

describe("technicalDemand trigger", () => {
  it("emits nothing for an empty finding list (byte-identical)", () => {
    expect(
      technicalDemand({ tenantId: "t", findings: [], impressionsByUrl: new Map(), signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("maps bad_status -> fix_status_code at confidence medium (customer-queue eligible)", () => {
    const rows = technicalDemand({
      tenantId: "t",
      findings: [finding({ kind: "bad_status" })],
      impressionsByUrl: new Map([["https://x.com/a", 300]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.action_type).toBe("fix_status_code");
    expect(rows[0]!.confidence).toBe("medium");
    expect(rows[0]!.trigger_signal).toBe("technical_demand_bad_status");
  });

  it("maps noindex -> fix_noindex at confidence low (indexing directive, diagnostic-only)", () => {
    const rows = technicalDemand({
      tenantId: "t",
      findings: [finding({ kind: "noindex" })],
      impressionsByUrl: new Map([["https://x.com/a", 300]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.action_type).toBe("fix_noindex");
    expect(rows[0]!.confidence).toBe("low");
  });

  it("maps canonical_elsewhere -> fix_canonical at confidence low", () => {
    const rows = technicalDemand({
      tenantId: "t",
      findings: [finding({ kind: "canonical_elsewhere" })],
      impressionsByUrl: new Map([["https://x.com/a", 300]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.action_type).toBe("fix_canonical");
    expect(rows[0]!.confidence).toBe("low");
  });

  it("ranks by demand and caps at MAX_TECHNICAL_DEMAND_EMISSIONS", () => {
    const findings: TechnicalDemandFinding[] = [];
    const impressions = new Map<string, number>();
    for (let i = 0; i < MAX_TECHNICAL_DEMAND_EMISSIONS + 4; i++) {
      const url = `https://x.com/p${i}`;
      findings.push(finding({ url }));
      impressions.set(url, i);
    }
    const rows = technicalDemand({ tenantId: "t", findings, impressionsByUrl: impressions, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_TECHNICAL_DEMAND_EMISSIONS);
    expect(rows[0]!.target_url).toBe(`https://x.com/p${MAX_TECHNICAL_DEMAND_EMISSIONS + 3}`);
  });
});
