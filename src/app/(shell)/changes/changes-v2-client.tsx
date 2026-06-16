"use client";

/**
 * ChangesV2Client — proof-timeline pass for /changes?v2=1.
 *
 * Bundle (2026-05-10) — second pass at /changes per the maximum-depth
 * UI audit (`~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Goal: turn the legacy 11-column table + drawer into a customer-shaped
 * outcome story:
 *
 *   ┌──────────────────────────────────────────┬─────────────────────────┐
 *   │ Page header                              │                         │
 *   │ ┌─────┐ ┌─────┐ ┌─────┐                  │  Waiting for signal     │
 *   │ │ N   │ │ M   │ │ P   │  (3 counters)    │  (right rail; rows      │
 *   │ │Ship │ │Work │ │Need │                  │   too-early / watching /│
 *   │ │month│ │ing  │ │revw │                  │   live)                 │
 *   │ └─────┘ └─────┘ └─────┘                  │                         │
 *   │                                          │                         │
 *   │ Timeline (one card per row, newest first)│                         │
 *   │ ┌──────────────────────────────────────┐ │                         │
 *   │ │ title  · URL · date         [pill]   │ │                         │
 *   │ │ outcome blurb                        │ │                         │
 *   │ │ pattern-timing line (optional)       │ │                         │
 *   │ │ Open change →                        │ │                         │
 *   │ └──────────────────────────────────────┘ │                         │
 *   │ …                                        │                         │
 *   │ Open table view (legacy escape)          │                         │
 *   └──────────────────────────────────────────┴─────────────────────────┘
 *
 * Pure presentation — no state, no server actions, no data layer
 * rewrite. Consumes the same `EnrichedChangeRow[]` the legacy
 * scorecard table consumes; the proof-pill resolver collapses the
 * legacy three-pill row into ONE customer-readable pill per card.
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   • No "Z-score", "evidence tier", or other internal vocabulary
 *     ever appears in rendered copy.
 *   • Raw verdict / lifecycle enums stay as code identifiers; the
 *     customer reads "Helping" / "Watching" / "Live" / etc.
 *   • Pattern-timing reads as "Similar changes usually show signal
 *     around day N" — never references median_landing_day or the
 *     pattern brain.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/data/page-header";
import {
  resolveProofPill,
  type ProofPill,
} from "@/domains/changes/proof-timeline/result-pill";
import {
  computeProofCounters,
  PROOF_COUNTER_LABEL,
  type ProofCounters,
} from "@/domains/changes/proof-timeline/counters";
import {
  buildWaitingRail,
  type WaitingRailInput,
} from "@/domains/changes/proof-timeline/waiting-rail";
import {
  projectChangeTitle,
  clampShortTitle,
} from "@/domains/changes/proof-timeline/title-projection";
import type { LifecycleTabClass } from "@/domains/attribution/lifecycle-classification";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";

import {
  ChangesV2Card,
  type ChangesV2CardRow,
} from "@/components/changes/v2/changes-v2-card";
import { ChangesV2WaitingRail } from "@/components/changes/v2/changes-v2-waiting-rail";

import type { EnrichedChangeRow } from "./types";
import { markChangelogEditShipped } from "./actions";

export type ChangesV2ClientProps = {
  /** Already-enriched rows from the server page. Newest-first sort
   *  expected (the legacy page sorts before this point). */
  rows: ReadonlyArray<EnrichedChangeRow>;
  /** Lifecycle class per row (keyed by changelog id). */
  classByChangelogId: Record<string, LifecycleTabClass>;
  /** Linked-edit implementation status per row (when joined). */
  editStatusByChangelogId: Record<string, ImplementationStatus>;
};

const MAX_TIMELINE_CARDS = 24;

export function ChangesV2Client({
  rows,
  classByChangelogId,
  editStatusByChangelogId,
}: ChangesV2ClientProps) {
  // Resolve the pill + counters + rail rows in one pass. The pure
  // helpers stay pure; this client just orchestrates them.
  const cardRows = projectToCardRows({
    rows,
    classByChangelogId,
    editStatusByChangelogId,
  });

  const counters: ProofCounters = computeProofCounters(
    cardRows.map((card) => ({ pillKind: card.pill.kind })),
  );

  const railInput: WaitingRailInput[] = cardRows.map((card) => ({
    id: card.id,
    title: card.title,
    targetUrl: card.targetUrl,
    shippedAt: card.shippedAt,
    pillKind: card.pill.kind,
    readyOn: card.readyOn,
  }));
  const railItems = buildWaitingRail(railInput);

  const timelineCards = cardRows.slice(0, MAX_TIMELINE_CARDS);

  return (
    <div data-changes-layout="v2-proof-timeline" className="max-w-6xl">
      <PageHeader
        title="Changes"
        description="Track what shipped and whether AI visibility responded."
      />

      {/* Only show the proof counters once there are real timeline rows —
          a fresh tenant should see the calm empty state, not a strip of 0s. */}
      {cardRows.length > 0 && <ProofCounterStrip counters={counters} />}

      {cardRows.length === 0 ? (
        <ChangesV2EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5">
          {/* Timeline */}
          <section
            data-changes-section="timeline"
            aria-label="Recent changes timeline"
            className="space-y-3"
          >
            {timelineCards.map((row) => (
              <ChangesV2CardWithActions key={row.id} row={row} />
            ))}
            {cardRows.length > timelineCards.length && (
              <p className="pt-2 text-[11px] text-muted-foreground/80">
                Showing the {timelineCards.length} most recent changes of {cardRows.length}.
              </p>
            )}
          </section>

          {/* Right rail */}
          <ChangesV2WaitingRail items={railItems} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Card + Mark-shipped action island
// ─────────────────────────────────────────────────────────────────────

/**
 * Wraps `ChangesV2Card` with the per-row Mark-shipped affordance.
 *
 * Parity with the legacy scorecard row (`scorecard-client.tsx`):
 *   • The button is offered ONLY when `row.canMarkShipped` is true
 *     (linked edit is `accepted`).
 *   • Clicking it calls the SAME server action `markChangelogEditShipped`
 *     with the SAME payload (`{ changelogId }`), so persistence is
 *     byte-identical to the legacy path.
 *   • `useTransition` drives the pending state; feedback is surfaced via
 *     `aria-live="polite"` inside the card.
 *   • After a successful flip we `router.refresh()` to re-pull the
 *     server-rendered pill (the action also `revalidatePath("/changes")`,
 *     so the refresh is belt-and-suspenders for the current tab).
 *
 * When `canMarkShipped` is false the card renders exactly as before —
 * no button, no behavior change.
 */
function ChangesV2CardWithActions({ row }: { row: ProjectedCardRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  function handleMarkShipped() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await markChangelogEditShipped({ changelogId: row.id });
        if (res.success) {
          const flipped = res.flipped ?? 0;
          setFeedback({
            message:
              flipped > 0
                ? "Marked live — Beacon is now tracking its impact."
                : "Already live — no change.",
            isError: false,
          });
          // Re-pull the server pill so the card reflects the new
          // lifecycle state without a manual reload.
          router.refresh();
        } else {
          setFeedback({
            message: res.error ?? "Couldn't mark this as shipped.",
            isError: true,
          });
        }
      } catch (err) {
        setFeedback({
          message: `Unexpected error: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        });
      }
    });
  }

  return (
    <ChangesV2Card
      row={row}
      markShipped={{
        canMarkShipped: row.canMarkShipped,
        pending,
        feedback,
        onMarkShipped: handleMarkShipped,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Projection: EnrichedChangeRow → ChangesV2CardRow
// ─────────────────────────────────────────────────────────────────────

type ProjectInput = {
  rows: ReadonlyArray<EnrichedChangeRow>;
  classByChangelogId: Record<string, LifecycleTabClass>;
  editStatusByChangelogId: Record<string, ImplementationStatus>;
};

type ProjectedCardRow = ChangesV2CardRow & {
  readyOn: {
    daysFromChange: number;
    confidenceTier: "high" | "medium" | "low" | null;
  } | null;
  /** Parity with legacy scorecard gating: linked edit is `accepted`. */
  canMarkShipped: boolean;
};

function projectToCardRows({
  rows,
  classByChangelogId,
  editStatusByChangelogId,
}: ProjectInput): ProjectedCardRow[] {
  return rows.map((row) => {
    const ch = row.scorecard.change;
    const lifecycleClass: LifecycleTabClass =
      classByChangelogId[ch.id] ?? "unclassified";
    const lifecycleStatus: ImplementationStatus | null =
      editStatusByChangelogId[ch.id] ?? null;

    const pill: ProofPill = resolveProofPill({
      urlVerdict: row.urlVerdict ?? null,
      lifecycleClass,
      lifecycleStatus,
    });

    const patternTimingNarrative = formatPatternTiming(row.readyOn ?? null);

    // Project the raw change_description into a short customer-
    // facing title. Strips prompt IDs, internal "packet"
    // vocabulary, and runaway parenthetical example lists. The
    // legacy table continues to render the raw description.
    const projected = projectChangeTitle(
      ch.change_description || ch.asset_name,
    );
    const shortTitle = clampShortTitle(projected.shortTitle);

    return {
      id: ch.id,
      title: shortTitle,
      targetUrl: ch.url ?? null,
      shippedAt: ch.timestamp,
      pill,
      patternTimingNarrative,
      // Mark-shipped parity: same gating as the legacy scorecard
      // (`scorecard-client.tsx`) — the button is offered ONLY when the
      // linked recommended-edit is `accepted` (an already-accepted edit
      // the operator can confirm is live). The server action re-validates
      // this server-side, so a stale UI can't skip the Accept step.
      canMarkShipped: lifecycleStatus === "accepted",
      readyOn: row.readyOn
        ? {
            daysFromChange: row.readyOn.daysFromChange,
            confidenceTier: row.readyOn.confidenceTier,
          }
        : null,
    };
  });
}

/**
 * Rewrite the row's `readyOn` field into ONE customer-safe sentence.
 * Returns `null` when there's no pattern timing to surface (the card
 * skips the line).
 */
function formatPatternTiming(
  readyOn: EnrichedChangeRow["readyOn"] | null,
): string | null {
  if (!readyOn) return null;
  const day = readyOn.daysFromChange;
  if (!Number.isFinite(day) || day <= 0) return null;
  return `Similar changes usually show signal around day ${day}.`;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function ProofCounterStrip({ counters }: { counters: ProofCounters }) {
  const items: Array<{ key: keyof ProofCounters; value: number }> = [
    { key: "recentChanges", value: counters.recentChanges },
    { key: "watching", value: counters.watching },
    { key: "needsAttention", value: counters.needsAttention },
  ];

  return (
    <section
      data-changes-counters="true"
      className="mb-5 grid grid-cols-3 gap-3"
      aria-label="Proof counters"
    >
      {items.map(({ key, value }) => (
        <div
          key={key}
          data-changes-counter={key}
          className="rounded-lg border border-border/60 bg-surface-base px-4 py-3"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {PROOF_COUNTER_LABEL[key]}
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
            {value}
          </p>
        </div>
      ))}
    </section>
  );
}

function ChangesV2EmptyState() {
  return (
    <div
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
      role="status"
      data-changes-empty="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        No changes yet.
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
        Beacon logs every accepted recommendation here once the next scan
        confirms it on your site.
      </p>
    </div>
  );
}
