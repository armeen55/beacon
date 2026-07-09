/**
 * TodayV2ProvenResults — the causal wedge on the home screen.
 *
 * Renders the Proof Engine's `computed` + positive-lift wins (the strongest,
 * control-backed evidence Beacon has) as plain-English "we measured this"
 * cards. Distinct from the Z-score "Recent wins" rail: this states a strong,
 * control-backed signal ("+N more AI citations a day than comparable pages
 * that didn't change"). Copy aligned to /settings/methodology: it is the
 * strongest evidence in the category, but framed as a signal associated with
 * the change — never proven causation or revenue.
 *
 * Pure presentational. SELF-HIDES when there are no proven wins, so the home
 * screen stays quiet until the engine has a real causal result — never a
 * placeholder, never an overclaim.
 */

import Link from "next/link";

import type { ProvenWin } from "@/domains/attribution/load-proven-wins";

function confidenceWord(confidence: string): string {
  switch (confidence) {
    case "high":
      return "strong evidence";
    case "medium":
      return "moderate evidence";
    case "low":
      return "early read";
    default:
      return confidence;
  }
}

export function TodayV2ProvenResults({
  wins,
}: {
  wins: ReadonlyArray<ProvenWin>;
}) {
  if (wins.length === 0) return null;
  return (
    <article
      className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-5"
      data-today-v2-card="proven-results"
    >
      {/* operator spec 2026-07-09 E-34: "Proven by Beacon" claimed causal certainty this file's
          own doc comment above explicitly disclaims ("never proven causation"). A strong estimate
          against comparison pages is not proof. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-status-success">
          Strongest estimate, not proof
        </span>
        <span className="text-[10px] text-muted-foreground">
          vs. comparable pages I did not touch
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {wins.map((w) => (
          <li key={w.sourceId}>
            <Link
              href={`/changes/${encodeURIComponent(w.sourceId)}`}
              className="group block"
            >
              <p className="text-[13px] font-medium leading-snug text-foreground group-hover:text-accent-primary">
                {w.headline}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {w.url ?? "this change"}
                {w.relativeLiftPct != null ? ` · +${w.relativeLiftPct}%` : ""} ·{" "}
                {confidenceWord(w.confidence)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
