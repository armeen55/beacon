/**
 * /changes proof-timeline — render contract for ChangesV2Client.
 *
 * Pins the v2 layout marker, the three top counters, the timeline card
 * anatomy, the right-rail behavior, and the absence of internal
 * vocabulary. Renders the client as a pure server-side string via
 * `renderToStaticMarkup` so the suite stays Node-only (no DOM, no
 * @testing-library/react).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangesV2Client } from "@/app/(shell)/changes/changes-v2-client";
import type { EnrichedChangeRow } from "@/app/(shell)/changes/scorecard-client";
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";

type RowOverrides = {
  id?: string;
  description?: string;
  url?: string | null;
  timestamp?: string;
  verdict?: import("@/domains/attribution/url-verdict").VerdictLabel | null;
  readyOn?: EnrichedChangeRow["readyOn"];
};

function makeRow(over: RowOverrides = {}): EnrichedChangeRow {
  const id = over.id ?? "change-1";
  return {
    scorecard: {
      // Cast only the parts we actually use in the card.
      change: {
        id,
        timestamp: over.timestamp ?? "2026-05-04T00:00:00Z",
        asset_type: "page",
        url: over.url === undefined ? "/services/modern-home-builder-atherton" : over.url,
        asset_name: "Modern Home Builder Atherton",
        change_description:
          over.description ?? "Add an FAQ section for Atherton modern home builder",
      } as unknown as EnrichedChangeRow["scorecard"]["change"],
      verdict: "ok" as never,
      verdictSummary: "",
      evidenceTier: "exact" as never,
      evidenceFlags: [],
      topScore: null,
      topConfidence: null,
      topTrust: null,
      eventAttributions: [],
      platforms: [],
      topics: [],
      totalEventsLinked: 0,
      operatorConfirmedCount: 0,
      daysSinceChange: 7,
      impact: {
        confidence: "low",
        direction: "neutral",
        whyExplanation: "",
        nextAction: "",
      } as never,
    },
    urlVerdict:
      over.verdict === null
        ? null
        : ({
            verdict: over.verdict ?? ("helping" as const),
          } as unknown as EnrichedChangeRow["urlVerdict"]),
    seriesPreview: null,
    hasUrl: true,
    readyOn: over.readyOn ?? null,
  };
}

function render(input: {
  rows: EnrichedChangeRow[];
  classByChangelogId?: Record<string, LifecycleTabClass>;
  editStatusByChangelogId?: Record<string, ImplementationStatus>;
}): string {
  return renderToStaticMarkup(
    <ChangesV2Client
      rows={input.rows}
      classByChangelogId={input.classByChangelogId ?? {}}
      editStatusByChangelogId={input.editStatusByChangelogId ?? {}}
    />,
  );
}

describe("ChangesV2Client — proof timeline", () => {
  it("renders the v2 layout marker + header copy", () => {
    const html = render({ rows: [] });
    expect(html).toContain('data-changes-layout="v2-proof-timeline"');
    expect(html).toContain("Changes");
    // Subline locked.
    expect(html).toContain(
      "Track what shipped and whether AI visibility responded",
    );
  });

  it("renders the three top counters with customer-safe labels", () => {
    const html = render({
      rows: [
        makeRow({ id: "a" }),
        makeRow({
          id: "b",
          timestamp: new Date().toISOString(),
        }),
      ],
      classByChangelogId: {
        a: "live_verified",
        b: "live_verified",
      },
    });
    expect(html).toContain('data-changes-counter="shippedThisMonth"');
    expect(html).toContain('data-changes-counter="working"');
    expect(html).toContain('data-changes-counter="needsReview"');
    expect(html).toContain("Shipped this month");
    expect(html).toContain("Working");
    expect(html).toContain("Needs review");
  });

  it("renders the empty state when there are no rows", () => {
    const html = render({ rows: [] });
    expect(html).toContain('data-changes-empty="true"');
    expect(html).toContain("No changes yet");
  });

  it("renders timeline cards with exactly ONE result pill per card", () => {
    const html = render({
      rows: [
        makeRow({ id: "card-1", verdict: "helping" }),
        makeRow({ id: "card-2", verdict: "hurting" }),
      ],
      classByChangelogId: {
        "card-1": "live_verified",
        "card-2": "live_verified",
      },
    });
    // The two card markers
    expect(html).toContain('data-changes-card-id="card-1"');
    expect(html).toContain('data-changes-card-id="card-2"');
    // Each card carries exactly one result pill — count pill data-attrs.
    const pillMatches = html.match(/data-changes-result-pill="/g) ?? [];
    expect(pillMatches.length).toBe(2);
    // Pills surface customer labels, not raw enum values.
    expect(html).toContain("Helping");
    expect(html).toContain("Hurting");
  });

  it("renders an Open change CTA per card linking to /changes/[id]?v2=1", () => {
    const html = render({
      rows: [makeRow({ id: "rec-abc-123" })],
      classByChangelogId: { "rec-abc-123": "live_verified" },
    });
    expect(html).toContain('data-changes-card-cta="open-change"');
    // Preserves v2 context so the click-through lands on the proof
    // brief instead of the legacy detail page.
    expect(html).toContain('href="/changes/rec-abc-123?v2=1"');
    expect(html).toContain("Open change");
  });

  it("renders the Waiting-for-signal rail for too-early rows with pattern-timing rewritten", () => {
    const html = render({
      rows: [
        makeRow({
          id: "waiting-1",
          verdict: "too_early",
          readyOn: {
            readyDate: "2026-05-15",
            daysFromChange: 7,
            patternId: "pat-1",
            helpingCount: 3,
            sampleCount: 4,
            confidenceTier: "high",
            narrative: "Internal narrative",
          },
        }),
      ],
    });
    expect(html).toContain('data-changes-rail="waiting-for-signal"');
    expect(html).toContain('data-changes-rail-item="true"');
    expect(html).toContain("Similar changes usually show signal around day 7");
  });

  it("renders the legacy escape footer link", () => {
    const html = render({ rows: [makeRow()] });
    expect(html).toContain('data-changes-cta="legacy"');
    expect(html).toContain('href="/changes?legacy=1"');
    expect(html).toContain("Open table view");
  });

  it("never leaks internal vocabulary in the rendered output", () => {
    const html = render({
      rows: [
        makeRow({ id: "r1", verdict: "helping" }),
        makeRow({ id: "r2", verdict: "too_early" }),
        makeRow({ id: "r3", verdict: "weak_signal" }),
        makeRow({
          id: "r4",
          verdict: "too_early",
          readyOn: {
            readyDate: "2026-05-20",
            daysFromChange: 7,
            patternId: "pat-1",
            helpingCount: 3,
            sampleCount: 4,
            confidenceTier: "high",
            narrative: "Internal narrative",
          },
        }),
      ],
      classByChangelogId: {
        r1: "live_verified",
        r2: "live_verified",
        r3: "live_verified",
        r4: "live_verified",
      },
    });
    const lower = html.toLowerCase();
    const banned = [
      "z-score",
      "evidence tier",
      "evidence_tier",
      "pattern brain",
      "decision queue",
      "decision matrix",
      "resolver tier",
      "first_appearance",
      "visibility_regained",
      "mention_surge",
      "visibility_lost",
      "mention_decline",
      "median_landing_day",
      "candidate cause",
      "native observation",
    ];
    for (const term of banned) {
      expect(lower, `rendered HTML leaked '${term}'`).not.toContain(term);
    }
  });

  it("caps the timeline at 24 cards and surfaces a 'See full table' link when the list overflows", () => {
    const many: EnrichedChangeRow[] = Array.from({ length: 30 }, (_, i) =>
      makeRow({
        id: `bulk-${i}`,
        timestamp: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const classByChangelogId: Record<string, LifecycleTabClass> = {};
    for (const r of many) {
      classByChangelogId[r.scorecard.change.id] = "live_verified";
    }
    const html = render({ rows: many, classByChangelogId });
    const cards = html.match(/data-changes-card="proof-timeline"/g) ?? [];
    expect(cards.length).toBe(24);
    expect(html).toContain('data-changes-cta="see-all-legacy"');
    expect(html).toContain("See full table");
  });
});
