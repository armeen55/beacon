/**
 * spelling-demand-move trigger tests (P20, v1 129).
 *
 * Pins: empty-safe (no items / no site root -> []), correct create_page shape,
 * demand carried into copy + operator evidence, per-canonical dedupe, ordering.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { spellingDemandMove } from "@/domains/recommendation-intelligence/triggers/spelling-demand-move";
import type { SpellingDemandMoveItem } from "@/domains/spelling-demand/build-move-items";

const ROOT = "https://example.com/";
const AT = "2026-07-03T00:00:00.000Z";

function item(over: Partial<SpellingDemandMoveItem> = {}): SpellingDemandMoveItem {
  return {
    canonical: "saffron",
    combinedDemand: 1400,
    topSpellingDemand: 620,
    spellingCount: 4,
    otherSpellings: ["safron", "zafran", "saffran"],
    ...over,
  };
}

describe("spellingDemandMove — empty-safety", () => {
  it("returns [] with no items", () => {
    expect(
      spellingDemandMove({ tenantId: "t", items: [], siteRootUrl: ROOT, signalAt: AT }),
    ).toEqual([]);
  });

  it("returns [] when there is no site root to anchor on", () => {
    expect(
      spellingDemandMove({ tenantId: "t", items: [item()], siteRootUrl: null, signalAt: AT }),
    ).toEqual([]);
  });
});

describe("spellingDemandMove — emission shape", () => {
  it("emits a create_page Move anchored on the site root", () => {
    const rows = spellingDemandMove({
      tenantId: "t",
      items: [item()],
      siteRootUrl: ROOT,
      signalAt: AT,
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("spelling_demand_move");
    expect(r.action_type).toBe("create_page");
    expect(r.generator_kind).toBe("deterministic");
    expect(r.target_url).toBe(ROOT);
    expect(r.topic_cluster_label).toBe("saffron");
    expect(r.impact_estimate).toBe("high");
    expect(r.confidence).toBe("medium");
    expect(r.created_from_signal_at).toBe(AT);
  });

  it("carries the combined + top demand and canonical into the copy", () => {
    const rows = spellingDemandMove({
      tenantId: "t",
      items: [item()],
      siteRootUrl: ROOT,
      signalAt: AT,
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("saffron");
    expect(copy).toContain("1,400");
    expect(copy).toContain("620");
    expect(copy).toContain("3 other spellings of it");
    // No lab words, no dashes.
    expect(copy).not.toMatch(/[‒–—―]/);
    expect(copy.toLowerCase()).not.toContain("transliteration");
    expect(copy.toLowerCase()).not.toContain("variant");
  });

  it("records combined demand + other spellings in the operator evidence", () => {
    const rows = spellingDemandMove({
      tenantId: "t",
      items: [item()],
      siteRootUrl: ROOT,
      signalAt: AT,
    });
    const ev = rows[0]!.operator_evidence;
    expect(ev).toContain("signal=spelling_demand_move");
    expect(ev).toContain("canonical=saffron");
    expect(ev).toContain("combined_demand=1400");
    expect(ev).toContain("other_spellings=safron,zafran,saffran");
  });

  it("orders by combined demand and dedupes repeated canonicals", () => {
    const rows = spellingDemandMove({
      tenantId: "t",
      items: [
        item({ canonical: "saffron", combinedDemand: 300 }),
        item({ canonical: "kebab", combinedDemand: 9000, otherSpellings: ["kabob"] }),
        item({ canonical: "Saffron", combinedDemand: 250 }), // dup canonical
      ],
      siteRootUrl: ROOT,
      signalAt: AT,
    });
    expect(rows.map((r) => r.topic_cluster_label)).toEqual(["kebab", "saffron"]);
    // Each canonical yields a distinct cooldown key.
    expect(new Set(rows.map((r) => r.cooldown_key)).size).toBe(2);
  });

  it("renders in a minimal card without dashes (rendered-copy check)", () => {
    const rows = spellingDemandMove({
      tenantId: "t",
      items: [item()],
      siteRootUrl: ROOT,
      signalAt: AT,
    });
    const html = renderToStaticMarkup(<div>{rows[0]!.customer_copy}</div>);
    expect(html).toContain("searches a month combined");
    expect(html).not.toMatch(/[‒–—―]/);
  });
});
