/**
 * Feature-steal wiring pins (2026-07-02, BEACON_500 item 25).
 *
 * Source-level pins (the sibling pattern used for item 14's spike rows, item 20's
 * AI-Overview gap line, and item 21's seasonal row): the nightly plan builder
 * reads the bounded steal hint feed, attaches the steal fact to the pick's SERP
 * evidence, adds a team-review voice, and the daily card renders it - all without
 * disturbing the three other hint families already wired beside it. Dash-clean.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUILD_TODAY_PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const DAILY_SECTION = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");

describe("build-today-preview.ts wires the feature-steal hint feed (item 25)", () => {
  it("reads the $0 history-backed steal candidates beside the other three hint families", () => {
    expect(BUILD_TODAY_PREVIEW).toContain('from "@/domains/serp/serp-history"');
    expect(BUILD_TODAY_PREVIEW).toContain("loadFeatureStealCandidates(tenantId, now).catch(() => [])");
    expect(BUILD_TODAY_PREVIEW).toContain('from "@/domains/serp/feature-steal"');
    expect(BUILD_TODAY_PREVIEW).toContain("buildFeatureStealHintNotes(featureSteals)");
  });

  it("attaches the steal fact onto the pick's SERP evidence, format included", () => {
    expect(BUILD_TODAY_PREVIEW).toContain("featureStealHintsByQuery.get(serp.query.trim().toLowerCase())");
    expect(BUILD_TODAY_PREVIEW).toContain("serp.featureSteal = { ownerDomain: steal.ownerDomain, format: steal.format, sentence: steal.sentence }");
  });

  it("adds a bounded 'Answer box to steal' team-review voice", () => {
    expect(BUILD_TODAY_PREVIEW).toContain('"Answer box to steal"');
  });

  it("contains no em or en dashes anywhere", () => {
    expect(BUILD_TODAY_PREVIEW).not.toMatch(/[–—]/);
  });
});

describe("daily-experiments-section.tsx renders the steal fact (item 25)", () => {
  it("renders serp.featureSteal inside the existing SerpReaction line, honest silence otherwise", () => {
    expect(DAILY_SECTION).toContain("serp.featureSteal ? <> {stripBannedDashes(serp.featureSteal.sentence)}</> : null");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(DAILY_SECTION).not.toMatch(/[–—]/);
  });
});
