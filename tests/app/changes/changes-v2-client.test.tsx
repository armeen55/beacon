/**
 * /changes proof-timeline — render contract for ChangesV2Client.
 *
 * Pins the v2 layout marker, the three top counters, the timeline card
 * anatomy, the right-rail behavior, and the absence of internal
 * vocabulary. Renders the client as a pure server-side string via
 * `renderToStaticMarkup` so the suite stays Node-only (no DOM, no
 * @testing-library/react).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The v2 client is now a client island (it owns the per-row Mark-shipped
// transition). `ChangesV2CardWithActions` calls `useRouter`, which throws
// outside the App Router context. Stub the hooks so the SSR smoke render
// stays Node-only — same posture as the switcher contract test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/changes",
}));

// The Mark-shipped server action is imported by the client. Stub it so the
// render test never reaches the real persistence layer.
vi.mock("@/app/(shell)/changes/actions", () => ({
  markChangelogEditShipped: vi.fn(async () => ({ success: true, flipped: 1 })),
}));

import { ChangesV2Client } from "@/app/(shell)/changes/changes-v2-client";
import type { EnrichedChangeRow } from "@/app/(shell)/changes/types";
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
      "Track what shipped and whether search visibility responded",
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
    // Polish bundle (2026-05-11): counters swapped from
    // "Shipped this month / Working / Needs review" to the
    // calendar-free triplet so the strip never reads 0/0/0 just
    // because the customer is viewing on the wrong side of a
    // month boundary.
    expect(html).toContain('data-changes-counter="recentChanges"');
    expect(html).toContain('data-changes-counter="watching"');
    expect(html).toContain('data-changes-counter="needsAttention"');
    expect(html).toContain("Recent changes");
    expect(html).toContain("Watching for signal");
    expect(html).toContain("Needs attention");
    // The pre-polish labels must NOT appear.
    expect(html).not.toContain("Shipped this month");
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

  it("no longer renders the 'Open table view' customer-facing footer CTA (removed 2026-05-12)", () => {
    // Pre-cleanup: the v2 proof timeline carried a "Need the table
    // view? Open table view →" footer link. Removed as part of the
    // perf/legacy-bloat audit because v2 is the production default
    // and the visible CTA made the product feel unfinished. The
    // `?legacy=1` query param still routes to the legacy table for
    // rollback. The overflow "See full table →" link (only shown
    // when >24 rows) is kept — it's a legitimate "show more"
    // affordance, not a redundant escape.
    const html = render({ rows: [makeRow()] });
    expect(html).not.toContain('data-changes-cta="legacy"');
    expect(html).not.toContain("Open table view");
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

  it("projects raw change_description into a customer-safe short title (strips prompt IDs + packet vocab)", () => {
    // Polish bundle (2026-05-11) — the raw description below is
    // a real fixture shape from the Ritz workspace. The v2 card
    // must NEVER render `prompt 319557d1` or "packet's cited
    // source pages" — those are internal operator terms.
    const rawLeaky =
      "H2: Architect-led design-build advantage — Adds a clear benefit statement drawn from prompt 319557d1 and the packet's cited source pages (examples: hdrremodeling.com, baysidebuildersgroup.com) showing architect-led firms are commonly recommended.";
    const html = render({
      rows: [makeRow({ id: "leaky", description: rawLeaky })],
      classByChangelogId: { leaky: "live_verified" },
    });

    // Short title is exactly the headline before the em-dash.
    expect(html).toContain("H2: Architect-led design-build advantage");

    // Forbidden raw vocab must NEVER appear in the rendered HTML.
    expect(html).not.toMatch(/prompt\s+[0-9a-f]{6,}/i);
    expect(html).not.toContain("packet's cited");
    expect(html).not.toContain("packet&#x27;s cited");
    expect(html).not.toContain("hdrremodeling.com");
    expect(html).not.toContain("baysidebuildersgroup.com");
  });

  it("right-rail items also receive the projected short title (no leak)", () => {
    const rawLeaky =
      "FAQ answer: Architect-led firm benefits — Provides a concise answer tied to prompt 7ee3216b and the packet's cited pages (examples: site.com).";
    const html = render({
      rows: [
        makeRow({
          id: "rail-leaky",
          description: rawLeaky,
          verdict: "too_early",
          readyOn: {
            readyDate: "2026-05-15",
            daysFromChange: 7,
            patternId: "pat-1",
            helpingCount: 3,
            sampleCount: 4,
            confidenceTier: "high",
            narrative: "internal",
          },
        }),
      ],
    });
    // Rail rendered.
    expect(html).toContain('data-changes-rail="waiting-for-signal"');
    // Title preserved (the short headline).
    expect(html).toContain("FAQ answer: Architect-led firm benefits");
    // Forbidden raw vocab NEVER appears in the rail item either.
    expect(html).not.toMatch(/prompt\s+[0-9a-f]{6,}/i);
    expect(html).not.toContain("packet");
    expect(html).not.toContain("site.com");
  });

  it("shows the Mark shipped button ONLY for an accepted edit (legacy gating parity)", () => {
    // Accepted → button present (operator can confirm it's live).
    const acceptedHtml = render({
      rows: [makeRow({ id: "accepted-row", verdict: null })],
      classByChangelogId: { "accepted-row": "pending_implementation" },
      editStatusByChangelogId: { "accepted-row": "accepted" },
    });
    expect(acceptedHtml).toContain('data-changes-card-mark-shipped="true"');
    expect(acceptedHtml).toContain("Mark shipped");

    // Recommended (NOT yet accepted) → button absent. Mirrors the legacy
    // M4 rule: Mark shipped must never skip the Accept step.
    const recommendedHtml = render({
      rows: [makeRow({ id: "rec-row", verdict: null })],
      classByChangelogId: { "rec-row": "pending_implementation" },
      editStatusByChangelogId: { "rec-row": "recommended" },
    });
    expect(recommendedHtml).not.toContain('data-changes-card-mark-shipped="true"');

    // No linked edit status at all → button absent (legacy / scan rows).
    const noStatusHtml = render({
      rows: [makeRow({ id: "plain-row", verdict: "helping" })],
      classByChangelogId: { "plain-row": "live_verified" },
    });
    expect(noStatusHtml).not.toContain('data-changes-card-mark-shipped="true"');

    // Already verified_live → button absent (nothing left to confirm).
    const liveHtml = render({
      rows: [makeRow({ id: "live-row", verdict: "helping" })],
      classByChangelogId: { "live-row": "live_verified" },
      editStatusByChangelogId: { "live-row": "verified_live" },
    });
    expect(liveHtml).not.toContain('data-changes-card-mark-shipped="true"');
  });

  it("caps the timeline at 24 cards and surfaces an overflow note when the list overflows", () => {
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
    // Surface collapse (2026-06-15): the legacy "See full table →" escape
    // link (`?legacy=1`) was removed with the legacy table. The overflow
    // note now just states how many of how many are shown.
    expect(html).not.toContain('data-changes-cta="see-all-legacy"');
    expect(html).not.toContain("See full table");
    expect(html).toMatch(/Showing the 24 most recent changes of 30/);
  });
});
