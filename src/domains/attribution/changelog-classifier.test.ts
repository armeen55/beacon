/**
 * changelog-classifier — Proof Engine activation (2026-06-11).
 * Pins the deterministic enum-grounded mapping + the end-to-end fact
 * that classified changelog entries are accepted by the natural-controls
 * engine's eligibility gate (the whole point of the adapter).
 */

import { describe, it, expect } from "vitest";

import {
  classifyChangelogEntry,
  classifyChangelogEntries,
} from "./changelog-classifier";
import { layerOf } from "./change-taxonomy";
import { eligibilityCheck } from "./natural-controls";
import type { ChangelogEntry } from "@/domains/changelog/types";

function entry(over: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "ch-1",
    timestamp: "2026-05-01T00:00:00.000Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://acme.com/services/roofing",
    asset_name: "Roofing",
    change_description: "Rewrote the roofing service page body copy.",
    topic_targeted: "roofing",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...over,
  } as ChangelogEntry;
}

const T = "tenant-acme";

describe("classifyChangelogEntry — on-site changes are ELIGIBLE for diff-in-diff", () => {
  it("a content edit with a url → change/single_url/high → eligible", () => {
    const c = classifyChangelogEntry(entry({}), T);
    expect(c.taxonomy_layer).toBe("change");
    expect(c.scope).toBe("single_url");
    expect(c.url).toBe("/services/roofing"); // normalizeUrl → path
    expect(c.url_type).toBe("service");
    expect(c.confidence).toBe("high");
    expect(c.tenant_id).toBe(T);
    expect(eligibilityCheck(c).eligible).toBe(true); // the whole point
    expect(layerOf(c.primary_bucket)).not.toBeNull(); // real taxonomy id
  });

  it("an FAQ edit maps to the faq bucket and is eligible", () => {
    const c = classifyChangelogEntry(entry({ signal_type: "faq", url: "https://acme.com/faq" }), T);
    expect(c.primary_bucket).toBe("content.faq.add");
    expect(eligibilityCheck(c).eligible).toBe(true);
  });

  it("an on-site change with NO url → confidence low → INELIGIBLE (can't run URL math)", () => {
    const c = classifyChangelogEntry(entry({ url: null }), T);
    expect(c.confidence).toBe("low");
    expect(eligibilityCheck(c).eligible).toBe(false);
  });
});

describe("classifyChangelogEntry — non-attributable signals are honestly ineligible (no fake lift)", () => {
  it("review → offsite_external_signal/tenant-global → ineligible", () => {
    const c = classifyChangelogEntry(entry({ signal_type: "review", url: null }), T);
    expect(c.taxonomy_layer).toBe("offsite_external_signal");
    expect(c.authorship).toBe("third_party_generated");
    const elig = eligibilityCheck(c);
    expect(elig.eligible).toBe(false);
    if (!elig.eligible) expect(elig.status).toBe("ineligible_layer");
  });

  it("technical → infra/infra-global → ineligible (unsupported scope or layer)", () => {
    const c = classifyChangelogEntry(entry({ signal_type: "technical" }), T);
    expect(c.taxonomy_layer).toBe("infra");
    expect(eligibilityCheck(c).eligible).toBe(false);
  });

  it("measurement → noise → ineligible, real noise bucket id", () => {
    const c = classifyChangelogEntry(entry({ signal_type: "measurement", url: null }), T);
    expect(c.taxonomy_layer).toBe("noise");
    expect(c.primary_bucket).toBe("noise.measurement-snapshot");
    expect(layerOf(c.primary_bucket)).toBe("noise");
    expect(eligibilityCheck(c).eligible).toBe(false);
  });
});

describe("classifyChangelogEntries — batch", () => {
  it("drops archived entries; every emitted event has a valid taxonomy bucket", () => {
    const events = classifyChangelogEntries(
      [
        entry({ id: "a" }),
        { ...entry({ id: "b" }), archived: true } as ChangelogEntry & { archived: boolean },
        entry({ id: "c", signal_type: "faq", url: "https://acme.com/faq" }),
      ],
      T,
    );
    expect(events.map((e) => e.source_id).sort()).toEqual(["a", "c"]);
    for (const e of events) expect(layerOf(e.primary_bucket)).not.toBeNull();
  });

  it("url_type falls back to the asset archetype when the URL is opaque", () => {
    const c = classifyChangelogEntry(
      entry({ url: "https://acme.com/x7", asset_type: "city_page" }),
      T,
    );
    // /x7 yields no structural type → asset_type city_page → location
    expect(c.url_type).toBe("location");
  });
});
