"use client";

/**
 * ChangesV2Client — the "what changed / is it measuring / did it work" timeline,
 * embedded under Results. A three-counter strip, a newest-first card timeline, and
 * a waiting-for-signal rail. Consumes `EnrichedChangeRow[]` (changelog entry + the
 * proof-gsc measurement summary); the proof-pill resolver collapses each row into
 * ONE customer-readable pill. Rendered copy never leaks internal vocabulary
 * (maturity enums, calibration words); timing reads as "I will take the next
 * Google reading on [date]" from the proof ledger's own checkpoint schedule.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/data/page-header";
// Client component: import the pure client-safe presentation helpers from their
// deep modules, not the decision facade (the facade re-exports server-only
// modules; Turbopack's server-only boundary is this file's guardrail).
import {
  resolveProofPill,
  type ProofPill,
} from "@/domains/decision/changes/proof-timeline/result-pill";
import {
  computeProofCounters,
  PROOF_COUNTER_LABEL,
  type ProofCounters,
} from "@/domains/decision/changes/proof-timeline/counters";
import {
  buildWaitingRail,
  type WaitingRailInput,
} from "@/domains/decision/changes/proof-timeline/waiting-rail";
import {
  projectChangeTitle,
  clampShortTitle,
} from "@/domains/decision/changes/proof-timeline/title-projection";
import type { ImplementationStatus } from "@/domains/decision/changes/recommended-edits-persistence";

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
  /** Retired (Core 100K): the lifecycle-classification tab map. Always an empty object
   *  now - each row's pill is driven by its joined proof coverage, not a tab class. */
  classByChangelogId: Record<string, string>;
  /** Linked-edit implementation status per row (when joined). */
  editStatusByChangelogId: Record<string, ImplementationStatus>;
  /** Count of GSC-proof tracked experiments shown in the strip above. When
   *  >0, a bare "No changes yet" empty state would contradict it, so the
   *  empty state acknowledges the tracked experiments instead. */
  proofLedgerCount?: number;
  /** IA consolidation (2026-06-23): when this timeline is embedded inside the
   *  Results (/results) page, the page already shows the "Results" header, so the
   *  component's own header is suppressed to avoid a second (legacy "Changes")
   *  title. Default true keeps the standalone behavior. */
  showHeader?: boolean;
  /** Optional header title/description override (used when not embedded). */
  headerTitle?: string;
  headerDescription?: string;
};

const MAX_TIMELINE_CARDS = 24;

export function ChangesV2Client({
  rows,
  classByChangelogId,
  editStatusByChangelogId,
  proofLedgerCount = 0,
  showHeader = true,
  headerTitle = "Your changes",
  headerDescription = "See the changes you made and whether more people found you on Google.",
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
    nextCheckpoint: card.nextCheckpoint,
  }));
  const railItems = buildWaitingRail(railInput);

  const timelineCards = cardRows.slice(0, MAX_TIMELINE_CARDS);

  return (
    <div data-changes-layout="v2-proof-timeline" className="max-w-6xl">
      {showHeader && (
        <PageHeader title={headerTitle} description={headerDescription} />
      )}

      {/* Only show the proof counters once there are real timeline rows —
          a fresh tenant should see the calm empty state, not a strip of 0s. */}
      {cardRows.length > 0 && <ProofCounterStrip counters={counters} />}

      {cardRows.length === 0 ? (
        <ChangesV2EmptyState proofLedgerCount={proofLedgerCount} />
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
                ? "Got it. We'll let you know if this helped."
                : "Already live. No change needed.",
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
        // Keep the technical detail in the console for debugging; the
        // owner sees a friendly, reassuring message instead.
        console.error("markChangelogEditShipped failed", err);
        setFeedback({
          message: "Something went wrong saving that. Please try again.",
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
  classByChangelogId: Record<string, string>;
  editStatusByChangelogId: Record<string, ImplementationStatus>;
};

type ProjectedCardRow = ChangesV2CardRow & {
  /** Soonest future proof checkpoint (YYYY-MM-DD), threaded to the rail. */
  nextCheckpoint: string | null;
  /** Parity with legacy scorecard gating: linked edit is `accepted`. */
  canMarkShipped: boolean;
};

function projectToCardRows({
  rows,
  editStatusByChangelogId,
}: ProjectInput): ProjectedCardRow[] {
  return rows.map((row) => {
    const ch = row.change;
    const lifecycleStatus: ImplementationStatus | null =
      editStatusByChangelogId[ch.id] ?? null;

    // Core 100K: no tab classification anymore - each row's pill is resolved from its
    // joined proof coverage (and, for the Mark-shipped gate, its linked edit status).
    const pill: ProofPill = resolveProofPill({
      proof: row.proof,
      lifecycleClass: null,
      lifecycleStatus,
    });

    const patternTimingNarrative = formatNextReading(row.proof, pill.kind);

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
      nextCheckpoint: row.proof?.nextCheckpoint ?? null,
    };
  });
}

/**
 * ONE customer-safe timing sentence per card: the date the proof ledger
 * takes its next Google reading for this row. Only shown while the row is
 * still pre-verdict (a decided row has nothing left to wait for), and
 * only when the ledger actually scheduled a checkpoint. Returns `null`
 * when there is nothing honest to say (the card skips the line).
 */
function formatNextReading(
  proof: EnrichedChangeRow["proof"],
  pillKind: ProofPill["kind"],
): string | null {
  if (!proof?.nextCheckpoint) return null;
  if (pillKind !== "too_early" && pillKind !== "watching") return null;
  const formatted = formatCheckpointDate(proof.nextCheckpoint);
  if (!formatted) return null;
  return `I will take the next Google reading on ${formatted}.`;
}

/** "2026-07-28" -> "July 28". Null on an unparseable date (skip the line). */
function formatCheckpointDate(isoDate: string): string | null {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
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

function ChangesV2EmptyState({ proofLedgerCount }: { proofLedgerCount: number }) {
  const hasTracked = proofLedgerCount > 0;
  return (
    <div
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-8 text-center"
      role="status"
      data-changes-empty="true"
    >
      <p className="text-[14px] font-semibold text-foreground">
        {hasTracked
          ? `${proofLedgerCount} change${proofLedgerCount === 1 ? "" : "s"} tracked above, measuring now.`
          : "No changes yet."}
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
        {hasTracked
          ? `Those are the changes you shipped, each measuring against comparable pages. This timeline adds a row automatically when Beacon's next scan confirms an accepted recommendation went live on your site.`
          : "Once you make a change on your site and mark it done, it shows up here so you can see if it worked."}
      </p>
    </div>
  );
}
