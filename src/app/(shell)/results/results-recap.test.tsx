/**
 * results-recap (R14a) - membership rules + rendered copy pins for the
 * "We got this wrong" section on /results.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildRecapItems, WeGotThisWrongSection } from "./results-recap";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

function makeRecord(over: Partial<ShippedChangeRecord>): ShippedChangeRecord {
  return {
    id: "/persian-cats::2026-06-20",
    page: "https://example.com/persian-cats",
    path: "/persian-cats",
    actionType: "edit_meta",
    before: "old",
    after: "new",
    shippedAt: "2026-06-20T00:00:00.000Z",
    baseline: { clicks: 100, impressions: 5000, ctr: 0.02, position: 6, windowDays: 28 },
    targetQueries: ["persian cats"],
    controlPages: [],
    windows: [],
    verdict: "inconclusive",
    confidence: "low",
    measuredAt: "2026-07-19T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...over,
  };
}

const PLAIN = (a: string) => (a === "edit_meta" ? "description change" : a.replace(/_/g, " "));

describe("buildRecapItems (membership rules)", () => {
  it("a revised-DOWNWARD verdict joins with the retraction voice", () => {
    const items = buildRecapItems(
      [
        makeRecord({
          verdictRevisions: [
            { at: "2026-07-19T08:00:00.000Z", from: "won", to: "inconclusive", reason: "the 28-day read" },
          ],
        }),
      ],
      PLAIN,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.headline).toBe(
      "I called the description change on /persian-cats a win too early and took it back.",
    );
    expect(items[0]!.detail).toBe(
      "Here is what changed: the 28-day read on 2026-07-19 showed no clear effect.",
    );
    expect(items[0]!.href).toBe("/results#proof-/persian-cats::2026-06-20");
  });

  it("an UPGRADED verdict (measuring -> won) stays off the recap", () => {
    const items = buildRecapItems([
      makeRecord({
        verdict: "won",
        verdictRevisions: [
          { at: "2026-07-19T08:00:00.000Z", from: "measuring", to: "won", reason: "the 7-day read" },
        ],
      }),
    ]);
    expect(items).toHaveLength(0);
  });

  it("a proven-neutral change joins with the owned-plainly lesson voice", () => {
    const items = buildRecapItems(
      [
        makeRecord({
          equivalence: {
            provenNeutral: true,
            sentence: "the full window proved any effect smaller than 4 clicks a month.",
          } as ShippedChangeRecord["equivalence"],
        }),
      ],
      PLAIN,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.headline).toBe("That one did not work: the description change on /persian-cats.");
    expect(items[0]!.detail).toContain("Here is what we learned:");
  });

  it("an ordinary record (no revisions, not proven neutral) stays off the recap", () => {
    expect(buildRecapItems([makeRecord({})])).toHaveLength(0);
  });

  it("caps at 5, newest first", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRecord({
        id: `/p${i}::2026-06-20`,
        path: `/p${i}`,
        verdictRevisions: [
          { at: `2026-07-1${i}T00:00:00.000Z`, from: "won", to: "lost", reason: "the 28-day read" },
        ],
      }),
    );
    const items = buildRecapItems(rows);
    expect(items).toHaveLength(5);
    expect(items[0]!.path).toBe("/p6"); // newest revision leads
  });
});

describe("WeGotThisWrongSection (rendered copy)", () => {
  it("self-hides with no items", () => {
    expect(renderToStaticMarkup(<WeGotThisWrongSection items={[]} />)).toBe("");
  });

  it("renders the section heading, the honesty framing, and the card deep link", () => {
    const items = buildRecapItems(
      [
        makeRecord({
          verdictRevisions: [
            { at: "2026-07-19T08:00:00.000Z", from: "won", to: "inconclusive", reason: "the 28-day read" },
          ],
        }),
      ],
      PLAIN,
    );
    const html = renderToStaticMarkup(<WeGotThisWrongSection items={items} />);
    expect(html).toContain("We got this wrong");
    expect(html).toContain("I say so here instead of quietly rewriting it");
    expect(html).toContain("I called the description change on /persian-cats a win too early and took it back.");
    expect(html).toContain("See the full read");
    expect(html).toContain("#proof-/persian-cats::2026-06-20");
    expect(html).not.toMatch(/[‒–—―]/);
  });
});
