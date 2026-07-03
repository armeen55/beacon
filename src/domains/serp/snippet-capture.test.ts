import { describe, it, expect } from "vitest";

import {
  classifyOwnAnswerStyle,
  findSnippetCaptures,
  qualifiesForCapture,
  snippetCaptureCandidates,
  MAX_SNIPPET_CAPTURE_CANDIDATES,
} from "./snippet-capture";
import type { FeatureStealHistoryRow } from "./feature-steal";

/**
 * BEACON_500 R11 / N29: featured-snippet capture with format-matched steal
 * moves. Pure over the same dataforseo_serp_history rows the shipped
 * feature-steal engine reads. Rank window 2-10, format-matched directive,
 * capped at 5, deduped against existing steal-lane cards by query.
 */

const TENANT_DOMAIN = "iranopedia.com";

function row(overrides: Partial<FeatureStealHistoryRow> = {}): FeatureStealHistoryRow {
  return {
    query: "iran flag history",
    capturedAt: "2026-07-02T00:00:00.000Z",
    ownRank: 4,
    ownUrl: "https://iranopedia.com/iran-flag",
    snippetOwner: {
      ownerDomain: "britannica.com",
      ownerUrl: "https://britannica.com/flag-of-iran",
      textExcerpt: "The flag of Iran...",
      format: "list",
    },
    paaQuestions: [],
    ...overrides,
  };
}

describe("qualifiesForCapture (rank 2-10)", () => {
  it("admits ranks 2 through 10 and nothing else", () => {
    expect(qualifiesForCapture(1)).toBe(false); // rank 1 already owns the page real estate battle
    expect(qualifiesForCapture(2)).toBe(true);
    expect(qualifiesForCapture(10)).toBe(true);
    expect(qualifiesForCapture(11)).toBe(false);
    expect(qualifiesForCapture(null)).toBe(false);
  });
});

describe("classifyOwnAnswerStyle", () => {
  it("is honestly unknown with no stored text", () => {
    expect(classifyOwnAnswerStyle(null)).toBe("unknown");
    expect(classifyOwnAnswerStyle("   ")).toBe("unknown");
  });
  it("classifies prose, list, and table shapes", () => {
    expect(classifyOwnAnswerStyle("The flag of Iran has three bands of color and a long history.")).toBe("prose");
    expect(classifyOwnAnswerStyle("1. Green band\n2. White band\n3. Red band")).toBe("list");
    expect(classifyOwnAnswerStyle("| era | flag |\n| Qajar | lion |")).toBe("table");
  });
});

describe("findSnippetCaptures", () => {
  it("emits a format-matched opportunity when a competitor owns the box and we rank 2-10", () => {
    const out = findSnippetCaptures([row()], TENANT_DOMAIN, {
      earlyTextByUrl: new Map([["https://iranopedia.com/iran-flag", "The flag of Iran has three bands of color."]]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.directive).toBe(
      'Google shows a numbered list from britannica.com in the answer box above your #4 spot for "iran flag history". ' +
        "Your page answers in prose. Match the list format with a tight numbered list high on the page to compete for that box. " +
        "That owner is a strong site, so this is a long shot, but the format gap is real.",
    );
    expect(out[0]!.directive).not.toMatch(/[–—]/); // no em or en dashes
  });

  it("drops the current-shape clause when no body text is stored (never claims a shape)", () => {
    const out = findSnippetCaptures([row()], TENANT_DOMAIN, {});
    expect(out[0]!.ownAnswerStyle).toBe("unknown");
    expect(out[0]!.directive).not.toContain("Your page answers");
  });

  it("skips a weak-owner long-shot tail and keeps it for strong owners only", () => {
    const weak = findSnippetCaptures(
      [row({ snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "", format: "list" } })],
      TENANT_DOMAIN,
      {},
    );
    expect(weak[0]!.ownerStrength).toBe("weak");
    expect(weak[0]!.directive).not.toContain("long shot");
  });

  it("never fires when we own the box, rank outside 2-10, or no ranked own page", () => {
    const ownBox = row({ snippetOwner: { ownerDomain: "iranopedia.com", ownerUrl: "https://iranopedia.com/iran-flag", textExcerpt: "", format: "list" } });
    expect(findSnippetCaptures([ownBox], TENANT_DOMAIN, {})).toHaveLength(0);
    expect(findSnippetCaptures([row({ ownRank: 1 })], TENANT_DOMAIN, {})).toHaveLength(0);
    expect(findSnippetCaptures([row({ ownRank: 14 })], TENANT_DOMAIN, {})).toHaveLength(0);
    expect(findSnippetCaptures([row({ ownUrl: null })], TENANT_DOMAIN, {})).toHaveLength(0);
    expect(findSnippetCaptures([row({ snippetOwner: null })], TENANT_DOMAIN, {})).toHaveLength(0);
  });

  it("dedupes against existing steal-lane cards by query", () => {
    const out = findSnippetCaptures([row()], TENANT_DOMAIN, {
      stealLaneQueries: new Set(["iran flag history"]),
    });
    expect(out).toHaveLength(0);
  });

  it("reads only the MOST RECENT capture per query", () => {
    const older = row({ capturedAt: "2026-06-01T00:00:00.000Z" });
    const newest = row({ capturedAt: "2026-07-02T00:00:00.000Z", snippetOwner: null });
    expect(findSnippetCaptures([older, newest], TENANT_DOMAIN, {})).toHaveLength(0);
  });

  it("stays silent when our page already answers in the box's format (no format gap)", () => {
    const out = findSnippetCaptures([row()], TENANT_DOMAIN, {
      earlyTextByUrl: new Map([["https://iranopedia.com/iran-flag", "1. Green\n2. White\n3. Red"]]),
    });
    expect(out).toHaveLength(0);
  });

  it("sorts closest rank first", () => {
    const out = findSnippetCaptures(
      [row({ query: "a query", ownRank: 7 }), row({ query: "b query", ownRank: 3 })],
      TENANT_DOMAIN,
      {},
    );
    expect(out.map((o) => o.ownRank)).toEqual([3, 7]);
  });
});

describe("snippetCaptureCandidates", () => {
  const opportunities = (n: number) =>
    findSnippetCaptures(
      Array.from({ length: n }, (_, i) =>
        row({ query: `query number ${i}`, ownRank: 2 + (i % 9), ownUrl: `https://iranopedia.com/page-${i}` }),
      ),
      TENANT_DOMAIN,
      {},
    );

  it("caps at MAX_SNIPPET_CAPTURE_CANDIDATES (5) and dedupes by query", () => {
    const rows = snippetCaptureCandidates({
      tenantId: "tenant-test",
      opportunities: opportunities(8),
      signalAt: "2026-07-03T00:00:00.000Z",
    });
    expect(rows).toHaveLength(MAX_SNIPPET_CAPTURE_CANDIDATES);
    expect(new Set(rows.map((r) => r.topic_cluster_label)).size).toBe(rows.length);
  });

  it("shapes candidate rows for the existing trigger pipeline", () => {
    const [c] = snippetCaptureCandidates({
      tenantId: "tenant-test",
      opportunities: findSnippetCaptures([row()], TENANT_DOMAIN, {}),
      signalAt: "2026-07-03T00:00:00.000Z",
    });
    expect(c!.trigger_signal).toBe("featured_snippet_capture");
    expect(c!.action_type).toBe("add_answer_block");
    expect(c!.generator_kind).toBe("deterministic");
    expect(c!.target_url).toBe("https://iranopedia.com/iran-flag");
    expect(c!.topic_cluster_label).toBe("featured_snippet:iran flag history");
    expect(c!.confidence).toBe("low"); // britannica.com is a strong owner: an honest long shot
    expect(c!.customer_copy).toContain("answer box");
    expect(c!.customer_copy).not.toMatch(/[–—]/);
    expect(c!.dedupe_key).toBeTruthy();
    expect(c!.cooldown_key).toBeTruthy();
    expect(c!.created_from_signal_at).toBe("2026-07-02T00:00:00.000Z");
  });

  it("gives weak owners medium confidence", () => {
    const [c] = snippetCaptureCandidates({
      tenantId: "tenant-test",
      opportunities: findSnippetCaptures(
        [row({ snippetOwner: { ownerDomain: "smallblog.com", ownerUrl: "https://smallblog.com/x", textExcerpt: "", format: "paragraph" } })],
        TENANT_DOMAIN,
        {},
      ),
      signalAt: "2026-07-03T00:00:00.000Z",
    });
    expect(c!.confidence).toBe("medium");
  });
});
