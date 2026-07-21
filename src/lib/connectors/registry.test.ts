/**
 * connector registry (2026-07-20) - completeness + honest-rollup pins.
 *
 * The registry is THE one canonical description of the four LIVE connectors. If a
 * field is missing on any entry the surfaces that read it (labels, SLAs, health
 * copy, capability copy, freshness mapping) silently render blanks - so this test
 * asserts every live connector carries every field. The rollup pins the certified
 * leak: "4 of 4 connected" while a source is broken must count as needs-attention.
 */
import { describe, it, expect } from "vitest";

import {
  CONNECTOR_REGISTRY,
  LIVE_CONNECTOR_IDS,
  connectorById,
  connectorBySourceKey,
  isPublishOnly,
  rollupConnectors,
  type ConnectorRollupFact,
} from "./registry";

describe("CONNECTOR_REGISTRY - completeness", () => {
  it("lists exactly the four live connectors, in canonical order", () => {
    expect(LIVE_CONNECTOR_IDS).toEqual([
      "google_gsc",
      "google_ga4",
      "clarity",
      "wix",
    ]);
  });

  it("every live connector has every field populated", () => {
    for (const c of CONNECTOR_REGISTRY) {
      // Identity + keys.
      expect(c.id).toBeTruthy();
      expect(c.sourceKey).toBeTruthy();
      expect(c.teammateKey).toBeTruthy();
      expect(c.cardAnchor).toBeTruthy();
      // Customer wording variants.
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.activityLabel.length).toBeGreaterThan(0);
      expect(c.freshnessLabel.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
      // Capabilities: exactly one of read / publish is the primary posture, and
      // no connector is a dead entry (neither reads nor publishes).
      expect(c.capabilities.readsData || c.capabilities.publishes).toBe(true);
      expect(typeof c.requiresPropertySelection).toBe("boolean");
      // Capability copy.
      expect(c.capabilityCopy.automated.length).toBeGreaterThan(0);
      expect(c.capabilityCopy.youDo.length).toBeGreaterThan(0);
      // Data Health copy.
      expect(c.dataHealth.label.length).toBeGreaterThan(0);
      expect(c.dataHealth.role.length).toBeGreaterThan(0);
      expect(c.dataHealth.unlocks.length).toBeGreaterThan(0);
      expect(c.dataHealth.blockedWhenMissing.length).toBeGreaterThan(0);
      // SLA shape.
      expect(typeof c.sla.required).toBe("boolean");
      expect(typeof c.sla.removed).toBe("boolean");
    }
  });

  it("carries no em or en dash in any customer-facing string (hard Beacon rule)", () => {
    const dash = /[–—]/;
    for (const c of CONNECTOR_REGISTRY) {
      const strings = [
        c.label,
        c.activityLabel,
        c.freshnessLabel,
        c.summary,
        c.capabilityCopy.automated,
        c.capabilityCopy.youDo,
        c.dataHealth.label,
        c.dataHealth.role,
        c.dataHealth.unlocks,
        c.dataHealth.blockedWhenMissing,
      ];
      for (const s of strings) expect(dash.test(s)).toBe(false);
    }
  });

  it("only GA4 requires a per-source property selection", () => {
    expect(connectorById("google_ga4")!.requiresPropertySelection).toBe(true);
    for (const id of ["google_gsc", "clarity", "wix"] as const) {
      expect(connectorById(id)!.requiresPropertySelection).toBe(false);
    }
  });

  it("only Wix is publish-only; the read sources publish nothing", () => {
    expect(isPublishOnly(connectorById("wix")!)).toBe(true);
    for (const id of ["google_gsc", "google_ga4", "clarity"] as const) {
      expect(isPublishOnly(connectorById(id)!)).toBe(false);
    }
  });

  it("GA4 is the removed source; GSC + Clarity are required, Wix optional", () => {
    expect(connectorBySourceKey("ga4")!.sla.removed).toBe(true);
    expect(connectorBySourceKey("gsc")!.sla).toMatchObject({ slaMaxDataAgeDays: 3, required: true });
    expect(connectorBySourceKey("clarity")!.sla).toMatchObject({ slaMaxDataAgeDays: 7, required: true });
    expect(connectorBySourceKey("wix")!.sla).toMatchObject({ required: false, removed: false });
  });

  it("returns undefined for a legacy/non-live provider (profound stays out of the live registry)", () => {
    expect(connectorById("profound")).toBeUndefined();
    expect(connectorById("google_gbp")).toBeUndefined();
    expect(connectorById("yelp")).toBeUndefined();
  });
});

describe("rollupConnectors - honest health counts (the certified leak)", () => {
  const allConnected = (needsAttention: Partial<Record<string, boolean>> = {}): ConnectorRollupFact[] =>
    CONNECTOR_REGISTRY.map((c) => ({
      id: c.id,
      connected: true,
      needsAttention: needsAttention[c.id] ?? false,
    }));

  it("all healthy reads '4 of 4 connected' with no attention clause", () => {
    const r = rollupConnectors(allConnected());
    expect(r.connectedCount).toBe(4);
    expect(r.total).toBe(4);
    expect(r.needsAttentionCount).toBe(0);
    expect(r.headline).toBe("4 of 4 connected");
    expect(r.headline).not.toContain("attention");
  });

  it("the certified case: GA4 ingest broken + Wix publish blocked reads '4 of 4 connected, 2 need attention'", () => {
    const r = rollupConnectors(allConnected({ google_ga4: true, wix: true }));
    expect(r.connectedCount).toBe(4);
    expect(r.needsAttentionCount).toBe(2);
    expect(r.headline).toBe("4 of 4 connected, 2 need attention");
    // The subline never undercounts the impaired sources.
    expect(r.subline).toContain("2 connected sources");
  });

  it("a single impaired source uses singular copy ('1 needs attention')", () => {
    const r = rollupConnectors(allConnected({ google_ga4: true }));
    expect(r.headline).toBe("4 of 4 connected, 1 needs attention");
    expect(r.subline).toContain("1 connected source is not delivering data yet");
  });

  it("needsAttention on a NOT-connected source never inflates the count", () => {
    const facts: ConnectorRollupFact[] = CONNECTOR_REGISTRY.map((c) => ({
      id: c.id,
      connected: false,
      needsAttention: true, // impossible in practice; the rollup must ignore it
    }));
    const r = rollupConnectors(facts);
    expect(r.connectedCount).toBe(0);
    expect(r.needsAttentionCount).toBe(0);
    expect(r.headline).toBe("0 of 4 connected");
  });

  it("partial connect with none impaired reads plainly", () => {
    const facts: ConnectorRollupFact[] = CONNECTOR_REGISTRY.map((c, i) => ({
      id: c.id,
      connected: i < 2,
      needsAttention: false,
    }));
    const r = rollupConnectors(facts);
    expect(r.headline).toBe("2 of 4 connected");
    expect(r.needsAttentionCount).toBe(0);
  });
});
