import { describe, expect, it } from "vitest";

import { deadUrlRecovery, MAX_DEAD_URL_RECOVERY_EMISSIONS } from "./dead-url-recovery";
import type { DeadUrlFinding } from "@/domains/technical-seo/dead-url-recovery";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function finding(over: Partial<DeadUrlFinding> = {}): DeadUrlFinding {
  return {
    url: "https://iranopedia.com/a",
    reason: "http_not_found",
    impressions90d: 300,
    clicks90d: 5,
    reason_copy: "Your /a page now returns Not Found.",
    evidence: "dead_url_recovery: test",
    ...over,
  };
}

describe("deadUrlRecovery trigger", () => {
  it("emits nothing for an empty finding list (byte-identical)", () => {
    expect(deadUrlRecovery({ tenantId: "t", findings: [], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("maps a finding -> fix_status_code at confidence medium (customer-queue eligible)", () => {
    const rows = deadUrlRecovery({ tenantId: "t", findings: [finding()], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("fix_status_code");
    expect(rows[0]!.confidence).toBe("medium");
    expect(rows[0]!.impact_estimate).toBe("high");
    expect(rows[0]!.trigger_signal).toBe("dead_url_recovery");
    expect(rows[0]!.customer_copy).toBe("Your /a page now returns Not Found.");
    // cooldown_key uses fix_status_code so it dedupes against the R19 bad_status card.
    expect(rows[0]!.cooldown_key).toBeTruthy();
  });

  it("ranks by demand (impressions, then clicks) and caps at the max", () => {
    const findings: DeadUrlFinding[] = [];
    for (let i = 0; i < MAX_DEAD_URL_RECOVERY_EMISSIONS + 3; i++) {
      findings.push(finding({ url: `https://iranopedia.com/p${i}`, impressions90d: i * 100 }));
    }
    const rows = deadUrlRecovery({ tenantId: "t", findings, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_DEAD_URL_RECOVERY_EMISSIONS);
    expect(rows[0]!.target_url).toBe(
      `https://iranopedia.com/p${MAX_DEAD_URL_RECOVERY_EMISSIONS + 2}`,
    );
  });
});
