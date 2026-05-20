/**
 * 2026-05-19 — Section 9 Today tile — "Edit outcomes (past 30 days)".
 *
 * Second customer-facing Section-9 surface after the Changes detail
 * Mode A sub-line (9.A2β + 9.A2β.1). Pure presentational React; type-
 * only `OutcomesSummary` import. State machine per preflight section
 * F: null/data_unavailable → still-gathering · total=0 → empty ·
 * eligible=0+total>0 → still-gathering · defensive 0-sessions →
 * still-gathering · eligible≥1+sessions>0 → healthy. Plural-aware
 * across edits/sessions/calls. CallRail K2-deferred → calls clause
 * source-present but runtime-suppressed when sum_calls=0 (NEVER
 * "0 calls" per operator lock). K5 forbidden tokens (`drove` /
 * `caused` / `generated` / `revenue` / `dollars` / `$` / `ROI` /
 * `sales` / `leads` / `Mode A`/`B`/`C` / `primary recommendation` /
 * `Google Analytics` / `GA4` / `CallRail`) absent from rendered copy.
 *
 * Pinned by:
 *   • tests/components/today/edit-outcomes-tile.test.tsx
 *   • tests/architecture/edit-outcomes-tile-vocab.test.ts
 *   • tests/architecture/edit-outcomes-tile-suppression.test.ts
 */

import type { ReactElement } from "react";

import type { OutcomesSummary } from "@/domains/outcome-attribution/load-outcomes-summary-for-tenant";

export type EditOutcomesTileProps = {
  summary: OutcomesSummary | null;
};

/** Singular/plural helper: `1 session` vs `N sessions`. Avoids
 *  nested template literals so static-text source scanners can
 *  reason about every customer-visible literal independently (per
 *  the 9.A2β experience where nested templates tripped the vocab
 *  scan). */
function pluralize(n: number, singular: string): string {
  const word = n === 1 ? singular : singular + "s";
  return n + " " + word;
}

type RenderState = "empty" | "still_gathering" | "healthy";

function resolveState(summary: OutcomesSummary | null): RenderState {
  if (summary == null) return "still_gathering";
  if (summary.status === "data_unavailable") return "still_gathering";
  if (summary.total_recent_live_edits === 0) return "empty";
  if (summary.eligible_edits === 0) return "still_gathering";
  // Defensive: eligible >= 1 but somehow sum_sessions === 0 (logically
  // impossible per the Mode A compute, but pre-empt the bug-shaped
  // "0 sessions" copy). Fall back to still-gathering.
  if (summary.sum_post_live_sessions === 0) return "still_gathering";
  return "healthy";
}

/**
 * Build the locked customer copy for the healthy state. Plural-aware
 * across edits / sessions / calls. The calls clause is source-present
 * (forward-compat for 9.B CallRail) but suppressed at runtime when
 * `sum_post_live_qualified_calls === 0` so v1 never renders "0 calls".
 */
function buildHealthyCopy(summary: OutcomesSummary): string {
  const editsClause = pluralize(summary.eligible_edits, "live edit");
  const sessionsClause = pluralize(summary.sum_post_live_sessions, "session");
  const callsClause =
    summary.sum_post_live_qualified_calls >= 1
      ? " and " + pluralize(summary.sum_post_live_qualified_calls, "call")
      : "";
  return (
    editsClause +
    " received " +
    sessionsClause +
    callsClause +
    " from changed pages."
  );
}

const EMPTY_COPY = "No post-live outcome evidence yet.";

const STILL_GATHERING_COPY =
  "Beacon is still collecting post-live traffic evidence for recent edits.";

/**
 * Customer-facing outcome-attribution Today tile. Renders inside its
 * own Suspense boundary between the Edit lifecycle tile and the
 * Descriptors section.
 */
export function EditOutcomesTile({
  summary,
}: EditOutcomesTileProps): ReactElement {
  const state = resolveState(summary);
  const total = summary?.total_recent_live_edits ?? 0;
  const eligible = summary?.eligible_edits ?? 0;
  const sessions = summary?.sum_post_live_sessions ?? 0;

  let body: string;
  if (state === "empty") {
    body = EMPTY_COPY;
  } else if (state === "still_gathering") {
    body = STILL_GATHERING_COPY;
  } else {
    // state === "healthy" — summary is guaranteed non-null here per
    // resolveState's contract, but the optional chain stays for
    // defensive typing.
    body =
      summary != null
        ? buildHealthyCopy(summary)
        : STILL_GATHERING_COPY;
  }

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-base px-4 py-3.5"
      data-today-edit-outcomes-tile="true"
      data-edit-outcomes-state={state}
      data-edit-outcomes-total-edits={total}
      data-edit-outcomes-eligible={eligible}
      data-edit-outcomes-sessions={sessions}
      aria-labelledby="edit-outcomes-tile-heading"
    >
      <header>
        <h3
          id="edit-outcomes-tile-heading"
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          Edit outcomes
        </h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          past 30 days
        </p>
      </header>
      <p
        className="mt-3 text-[12.5px] leading-relaxed text-foreground/80"
        data-edit-outcomes-body="true"
      >
        {body}
      </p>
    </section>
  );
}
