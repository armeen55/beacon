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
import type { EnrichedChangeRow, ChangeRowProof } from "@/app/(shell)/changes/types";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";

type RowOverrides = {
  id?: string;
  description?: string;
  url?: string | null;
  timestamp?: string;
  /** Proof-gsc measurement summary for the row's ledger record. Omitted =
   *  a mature helped result; null = no proof coverage (not measured). */
  proof?: ChangeRowProof | null;
};

/** Shorthand proof summaries mirroring the old verdict fixture vocabulary. */
const PROOF = {
  helping: {
    maturity: "mature_result",
    direction: "positive",
    verdict: "helped",
    nextCheckpoint: null,
  },
  hurting: {
    maturity: "mature_result",
    direction: "negative",
    verdict: "did_not_help",
    nextCheckpoint: null,
  },
  tooEarly: {
    maturity: "collecting",
    direction: "unknown",
    verdict: null,
    nextCheckpoint: "2026-05-15",
  },
  earlyPositive: {
    maturity: "early_checkpoint",
    direction: "positive",
    verdict: null,
    nextCheckpoint: "2026-05-20",
  },
} satisfies Record<string, ChangeRowProof>;

function makeRow(over: RowOverrides = {}): EnrichedChangeRow {
  const id = over.id ?? "change-1";
  return {
    change: {
      id,
      timestamp: over.timestamp ?? "2026-05-04T00:00:00Z",
      asset_type: "page",
      url: over.url === undefined ? "/services/modern-home-builder-atherton" : over.url,
      asset_name: "Modern Home Builder Atherton",
      change_description:
        over.description ?? "Add an FAQ section for Atherton modern home builder",
    } as unknown as EnrichedChangeRow["change"],
    proof: over.proof === undefined ? PROOF.helping : over.proof,
  };
}

function render(input: {
  rows: EnrichedChangeRow[];
  classByChangelogId?: Record<string, string>;
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
  it("renders the v2 layout marker, the empty state, and one result pill per card with customer labels", () => {
    const empty = render({ rows: [] });
    expect(empty).toContain('data-changes-layout="v2-proof-timeline"');
    expect(empty).toContain('data-changes-empty="true"');

    const html = render({
      rows: [
        makeRow({ id: "card-1", proof: PROOF.helping }),
        makeRow({ id: "card-2", proof: PROOF.hurting }),
      ],
      classByChangelogId: { "card-1": "live_verified", "card-2": "live_verified" },
    });
    // Each card carries exactly one result pill, surfacing a customer label
    // (never a raw enum value).
    const pillMatches = html.match(/data-changes-result-pill="/g) ?? [];
    expect(pillMatches.length).toBe(2);
    expect(html).toContain("Helping");
    expect(html).toContain("Hurting");
  });

  it("never leaks internal vocabulary in the rendered output", () => {
    const html = render({
      rows: [
        makeRow({ id: "r1", proof: PROOF.helping }),
        makeRow({ id: "r2", proof: PROOF.tooEarly }),
        makeRow({ id: "r3", proof: PROOF.earlyPositive }),
        makeRow({ id: "r4", proof: null }),
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
          proof: PROOF.tooEarly,
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
      rows: [makeRow({ id: "accepted-row", proof: null })],
      classByChangelogId: { "accepted-row": "pending_implementation" },
      editStatusByChangelogId: { "accepted-row": "accepted" },
    });
    expect(acceptedHtml).toContain('data-changes-card-mark-shipped="true"');
    expect(acceptedHtml).toContain("I made this change");

    // Recommended (NOT yet accepted) → button absent. Mirrors the legacy
    // M4 rule: Mark shipped must never skip the Accept step.
    const recommendedHtml = render({
      rows: [makeRow({ id: "rec-row", proof: null })],
      classByChangelogId: { "rec-row": "pending_implementation" },
      editStatusByChangelogId: { "rec-row": "recommended" },
    });
    expect(recommendedHtml).not.toContain('data-changes-card-mark-shipped="true"');

    // No linked edit status at all → button absent (legacy / scan rows).
    const noStatusHtml = render({
      rows: [makeRow({ id: "plain-row", proof: PROOF.helping })],
      classByChangelogId: { "plain-row": "live_verified" },
    });
    expect(noStatusHtml).not.toContain('data-changes-card-mark-shipped="true"');

    // Already verified_live → button absent (nothing left to confirm).
    const liveHtml = render({
      rows: [makeRow({ id: "live-row", proof: PROOF.helping })],
      classByChangelogId: { "live-row": "live_verified" },
      editStatusByChangelogId: { "live-row": "verified_live" },
    });
    expect(liveHtml).not.toContain('data-changes-card-mark-shipped="true"');
  });
});
