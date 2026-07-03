import { describe, expect, it } from "vitest";

import { contentLifecycle, MAX_LIFECYCLE_EMISSIONS } from "./content-lifecycle";
import type { LifecycleVerdict } from "@/domains/lifecycle/content-lifecycle";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function verdict(over: Partial<LifecycleVerdict> = {}): LifecycleVerdict {
  return {
    url: "https://x.com/a",
    stage: "prune",
    reason: "Your /a page gets almost no Google traffic.",
    redirectTarget: null,
    evidence: "prune: test",
    ...over,
  };
}

describe("contentLifecycle trigger", () => {
  it("emits nothing when there are no destructive verdicts (byte-identical)", () => {
    const rows = contentLifecycle({
      tenantId: "t",
      verdicts: [verdict({ stage: "keep", reason: "" }), verdict({ stage: "improve", reason: "" })],
      impressionsByUrl: new Map(),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toEqual([]);
  });

  it("emits nothing for an empty verdict list", () => {
    expect(
      contentLifecycle({ tenantId: "t", verdicts: [], impressionsByUrl: new Map(), signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("emits a merge_pages card at confidence low (diagnostic-only, never auto-executed)", () => {
    const rows = contentLifecycle({
      tenantId: "t",
      verdicts: [verdict({ url: "https://x.com/prune", stage: "prune" })],
      impressionsByUrl: new Map([["https://x.com/prune", 3]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("merge_pages");
    expect(rows[0]!.confidence).toBe("low");
    expect(rows[0]!.trigger_signal).toBe("lifecycle_prune");
    expect(rows[0]!.target_url).toBe("https://x.com/prune");
    expect(rows[0]!.customer_copy).toBe("Your /a page gets almost no Google traffic.");
  });

  it("carries the redirect target for a merge verdict in the evidence detail", () => {
    const rows = contentLifecycle({
      tenantId: "t",
      verdicts: [
        verdict({
          url: "https://x.com/fold",
          stage: "merge",
          redirectTarget: "https://x.com/owner",
          reason: "Fold /fold into /owner.",
        }),
      ],
      impressionsByUrl: new Map([["https://x.com/fold", 5]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.trigger_signal).toBe("lifecycle_merge");
    expect(rows[0]!.impact_estimate).toBe("high");
    expect(rows[0]!.evidence[0]!.detail).toContain("redirect_target=https://x.com/owner");
    expect(rows[0]!.operator_evidence).toContain("redirect_target=https://x.com/owner");
  });

  it("gives distinct trigger signals to prune / merge / retire", () => {
    const rows = contentLifecycle({
      tenantId: "t",
      verdicts: [
        verdict({ url: "https://x.com/p", stage: "prune" }),
        verdict({ url: "https://x.com/m", stage: "merge", redirectTarget: "https://x.com/o" }),
        verdict({ url: "https://x.com/r", stage: "retire" }),
      ],
      impressionsByUrl: new Map([
        ["https://x.com/p", 1],
        ["https://x.com/m", 1],
        ["https://x.com/r", 1],
      ]),
      signalAt: SIGNAL_AT,
    });
    expect(new Set(rows.map((r) => r.trigger_signal))).toEqual(
      new Set(["lifecycle_prune", "lifecycle_merge", "lifecycle_retire"]),
    );
  });

  it("ranks by demand (highest impressions first) and caps at MAX_LIFECYCLE_EMISSIONS", () => {
    const verdicts: LifecycleVerdict[] = [];
    const impressions = new Map<string, number>();
    for (let i = 0; i < MAX_LIFECYCLE_EMISSIONS + 5; i++) {
      const url = `https://x.com/p${i}`;
      verdicts.push(verdict({ url }));
      impressions.set(url, i); // p0 lowest, higher index = more demand
    }
    const rows = contentLifecycle({ tenantId: "t", verdicts, impressionsByUrl: impressions, signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(MAX_LIFECYCLE_EMISSIONS);
    // Highest-demand page must lead.
    const topUrl = `https://x.com/p${MAX_LIFECYCLE_EMISSIONS + 4}`;
    expect(rows[0]!.target_url).toBe(topUrl);
  });

  it("dedupe_key and cooldown_key are stable per (tenant, action, url)", () => {
    const rows = contentLifecycle({
      tenantId: "t",
      verdicts: [verdict({ url: "https://x.com/x" })],
      impressionsByUrl: new Map([["https://x.com/x", 1]]),
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.cooldown_key).toHaveLength(40); // sha1 hex
    expect(rows[0]!.dedupe_key).toHaveLength(40);
  });
});
