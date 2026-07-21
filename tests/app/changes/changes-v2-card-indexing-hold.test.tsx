/**
 * #310 — indexing-safety hold posture on the Changes card surface.
 *
 * FOLDED here (2026-07-21) from the retired recommendations v2 card, whose
 * route + component were deleted with the /recommendations surface collapse.
 * The safety invariant SURVIVES the deletion: a crawl/index directive
 * (robots.txt edit, meta noindex removal, canonical tag, redirect/status) can
 * DEINDEX a live site if applied wrong, so the Changes card must
 *   1. show a plain-English hold notice before the owner can act, and
 *   2. NEVER offer a one-tap live-confirm affordance for it — the row is HELD
 *      FOR REVIEW and routed to the change's review surface instead.
 * Benign on-page content changes (FAQ / schema / copy) must NOT carry the
 * notice and keep their normal one-tap affordance.
 *
 * SSR via renderToStaticMarkup against the real exported <ChangesV2Card>.
 * Type-driven, never copy-driven: the raw editActionType drives the hold.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChangesV2Card,
  type ChangesV2CardRow,
} from "@/components/changes/v2/changes-v2-card";
import {
  INDEXING_DIRECTIVE_CAVEAT,
  type ActionType,
} from "@/domains/recommendations/action-types";
import type { ProofPill } from "@/domains/changes/proof-timeline/result-pill";

// ── Fixtures ────────────────────────────────────────────────────────────────

const PILL: ProofPill = {
  kind: "live",
  label: "Live",
  tone: "info",
  blurb: "This change is live on your site.",
};

function makeRow(editActionType: ActionType | null): ChangesV2CardRow {
  return {
    id: "change-1",
    title: "Remove the noindex tag from the Homepage",
    targetUrl: "https://example.com/",
    shippedAt: "2026-05-04T00:00:00Z",
    pill: PILL,
    patternTimingNarrative: null,
    editActionType,
  };
}

// An `accepted`-linked edit is the ONLY state that offers the one-tap
// "I made this change" live-confirm affordance. An indexing directive must
// SUPPRESS even that.
function renderCard(row: ChangesV2CardRow): string {
  return renderToStaticMarkup(
    <ChangesV2Card
      row={row}
      markShipped={{
        canMarkShipped: true,
        pending: false,
        feedback: null,
        onMarkShipped: () => {},
      }}
    />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("#310 — indexing-safety caveat on the Changes card surface", () => {
  it("renders the caveat for a meta-robots noindex directive", () => {
    const html = renderCard(makeRow("fix_noindex"));
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).toContain("data-changes-card-indexing-caveat");
  });

  it("renders the caveat for a robots.txt directive", () => {
    const html = renderCard(makeRow("fix_robots"));
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a canonical-tag directive", () => {
    const html = renderCard(makeRow("fix_canonical"));
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("renders the caveat for a status-code / redirect directive", () => {
    const html = renderCard(makeRow("fix_status_code"));
    expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("does NOT render the caveat for a benign add_faq change", () => {
    const html = renderCard(makeRow("add_faq"));
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
    expect(html).not.toContain("data-changes-card-indexing-caveat");
  });
});

describe("held-for-review posture — an indexing directive is NEVER a one-tap change", () => {
  const INDEXING: ActionType[] = [
    "fix_noindex",
    "fix_robots",
    "fix_canonical",
    "fix_status_code",
  ];

  for (const t of INDEXING) {
    it(`${t}: suppresses the one-tap live-confirm affordance even when the edit is accepted`, () => {
      const html = renderCard(makeRow(t));
      // The one-tap "I made this change" button must NOT render for an
      // indexing directive, even though the linked edit is `accepted`.
      expect(html).not.toContain('data-changes-card-mark-shipped="true"');
      // The hold notice still renders, and the review route ("Open change")
      // stays available so the owner is routed to the confirm surface.
      expect(html).toContain(INDEXING_DIRECTIVE_CAVEAT);
      expect(html).toContain('data-changes-card-cta="open-change"');
    });
  }

  it("CONTROL: a benign accepted change DOES render the one-tap live-confirm affordance", () => {
    const html = renderCard(makeRow("add_faq"));
    expect(html).toContain('data-changes-card-mark-shipped="true"');
    expect(html).not.toContain(INDEXING_DIRECTIVE_CAVEAT);
  });

  it("CONTROL: a change with no editActionType keeps its one-tap affordance", () => {
    const html = renderCard(makeRow(null));
    expect(html).toContain('data-changes-card-mark-shipped="true"');
    expect(html).not.toContain("data-changes-card-indexing-caveat");
  });
});
