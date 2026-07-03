/**
 * serp-feature-change.test.ts (BEACON_500 P9 v1 251).
 *
 * Pins the pure detector: it FIRES "appeared" when a winnable Google feature was
 * absent earlier and present in the latest capture, FIRES "disappeared" on the
 * reverse, is EMPTY when the feature state is unchanged, and never fires from a
 * single capture or on non-winnable features (knowledge panel, paid). No I/O.
 */
import { describe, it, expect } from "vitest";

import {
  computeSerpFeatureChanges,
  computeSerpFeatureChangesForQuery,
  appearedFeatureChanges,
  type SerpFeatureHistoryRow,
} from "./serp-feature-change";
import type { ParsedFeaturedSnippet } from "./dataforseo-serp";

const NOW = new Date("2026-07-03T00:00:00.000Z");

function row(overrides: Partial<SerpFeatureHistoryRow> = {}): SerpFeatureHistoryRow {
  return {
    query: "farsi numbers",
    capturedAt: "2026-07-01T00:00:00.000Z",
    ownRank: 4,
    serpFeatures: [],
    aiOverviewPresent: false,
    snippetOwner: null,
    paaQuestions: [],
    ...overrides,
  };
}

const SNIPPET: ParsedFeaturedSnippet = {
  ownerDomain: "rival.com",
  ownerUrl: "https://rival.com/x",
  textExcerpt: "an answer",
  format: "paragraph",
};

describe("computeSerpFeatureChanges (pure detector)", () => {
  it("is EMPTY on empty input", () => {
    expect(computeSerpFeatureChanges([], { now: NOW })).toEqual([]);
  });

  it("FIRES 'appeared' when an answer box (AI Overview) shows up between captures", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", aiOverviewPresent: false }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", aiOverviewPresent: true }),
    ];
    const out = computeSerpFeatureChanges(rows, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.feature).toBe("answer_box");
    expect(out[0]!.direction).toBe("appeared");
    expect(out[0]!.sentence).toContain("Google just added an answer box");
    expect(out[0]!.sentence).toContain("farsi numbers");
    expect(out[0]!.sentence).not.toMatch(/[—–]/);
  });

  it("FIRES 'appeared' when a featured snippet owner shows up (answer box family)", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", snippetOwner: null }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", snippetOwner: SNIPPET }),
    ];
    const out = computeSerpFeatureChanges(rows, { now: NOW });
    expect(out.map((c) => `${c.feature}:${c.direction}`)).toEqual(["answer_box:appeared"]);
  });

  it("FIRES 'appeared' for a People Also Ask block and an image row", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", paaQuestions: [], serpFeatures: [] }),
      row({
        capturedAt: "2026-07-02T00:00:00.000Z",
        paaQuestions: [{ question: "how many?" }],
        serpFeatures: ["image_pack"],
      }),
    ];
    const out = computeSerpFeatureChanges(rows, { now: NOW });
    const kinds = out.map((c) => `${c.feature}:${c.direction}`).sort();
    expect(kinds).toEqual(["image_row:appeared", "people_also_ask:appeared"]);
  });

  it("FIRES 'disappeared' when a feature was present earlier and gone in the latest", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", aiOverviewPresent: true }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", aiOverviewPresent: false }),
    ];
    const out = computeSerpFeatureChanges(rows, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.direction).toBe("disappeared");
    expect(out[0]!.sentence).toContain("Google dropped the answer box");
    expect(out[0]!.sentence).not.toMatch(/[—–]/);
  });

  it("is EMPTY when the feature state is UNCHANGED (present in both captures)", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", aiOverviewPresent: true }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", aiOverviewPresent: true }),
    ];
    expect(computeSerpFeatureChanges(rows, { now: NOW })).toEqual([]);
  });

  it("does not fire from a SINGLE capture", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-07-02T00:00:00.000Z", aiOverviewPresent: true }),
    ];
    expect(computeSerpFeatureChangesForQuery(rows, { now: NOW })).toEqual([]);
  });

  it("never fires on a non-winnable feature like a knowledge panel", () => {
    const rows: SerpFeatureHistoryRow[] = [
      row({ capturedAt: "2026-06-25T00:00:00.000Z", serpFeatures: [] }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", serpFeatures: ["knowledge_panel"] }),
    ];
    expect(computeSerpFeatureChanges(rows, { now: NOW })).toEqual([]);
  });

  it("appearedFeatureChanges keeps only the appeared subset", () => {
    const rows: SerpFeatureHistoryRow[] = [
      // answer_box appears, paa disappears.
      row({ capturedAt: "2026-06-25T00:00:00.000Z", aiOverviewPresent: false, paaQuestions: [{ question: "q?" }] }),
      row({ capturedAt: "2026-07-02T00:00:00.000Z", aiOverviewPresent: true, paaQuestions: [] }),
    ];
    const all = computeSerpFeatureChanges(rows, { now: NOW });
    expect(all).toHaveLength(2);
    const appeared = appearedFeatureChanges(all);
    expect(appeared).toHaveLength(1);
    expect(appeared[0]!.feature).toBe("answer_box");
    expect(appeared[0]!.direction).toBe("appeared");
  });
});
