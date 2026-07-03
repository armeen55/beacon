import { describe, expect, it } from "vitest";

import { redirectHygiene, MAX_REDIRECT_HYGIENE_EMISSIONS } from "./redirect-hygiene";
import type { RedirectHygieneFinding } from "@/domains/technical-seo/redirect-hygiene";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function finding(over: Partial<RedirectHygieneFinding> = {}): RedirectHygieneFinding {
  return {
    url: "https://iranopedia.com/guides/old",
    kind: "redirect_chain",
    hopCount: 3,
    finalUrl: "https://iranopedia.com/guides/final",
    reason_copy: "Your /guides/old address points through 3 redirects before it lands.",
    evidence: "redirect_hygiene: test",
    ...over,
  };
}

describe("redirectHygiene trigger", () => {
  it("emits nothing for an empty finding list (byte-identical)", () => {
    expect(
      redirectHygiene({ tenantId: "t", findings: [], impressionsByUrl: new Map(), signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("maps redirect_chain -> fix_status_code at medium confidence", () => {
    const rows = redirectHygiene({
      tenantId: "t",
      findings: [finding({ kind: "redirect_chain" })],
      impressionsByUrl: new Map([["https://iranopedia.com/guides/old", 200]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.action_type).toBe("fix_status_code");
    expect(rows[0]!.confidence).toBe("medium");
    expect(rows[0]!.trigger_signal).toBe("redirect_chain");
    expect(rows[0]!.topic_cluster_label).toBe("Redirect chain");
    expect(rows[0]!.impact_estimate).toBe("medium");
  });

  it("maps soft_404 -> fix_status_code at medium confidence + high impact", () => {
    const rows = redirectHygiene({
      tenantId: "t",
      findings: [finding({ kind: "soft_404", hopCount: 0, finalUrl: null })],
      impressionsByUrl: new Map([["https://iranopedia.com/guides/old", 200]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.trigger_signal).toBe("soft_404");
    expect(rows[0]!.impact_estimate).toBe("high");
    expect(rows[0]!.topic_cluster_label).toBe("Soft 404");
  });

  it("ranks by demand and caps at the max", () => {
    const findings: RedirectHygieneFinding[] = [];
    const impressions = new Map<string, number>();
    for (let i = 0; i < MAX_REDIRECT_HYGIENE_EMISSIONS + 3; i++) {
      const url = `https://iranopedia.com/p${i}`;
      findings.push(finding({ url }));
      impressions.set(url, i * 10);
    }
    const rows = redirectHygiene({ tenantId: "t", findings, impressionsByUrl: impressions, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_REDIRECT_HYGIENE_EMISSIONS);
    expect(rows[0]!.target_url).toBe(`https://iranopedia.com/p${MAX_REDIRECT_HYGIENE_EMISSIONS + 2}`);
  });
});
