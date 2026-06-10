/**
 * Operator Competitor-Intel Surface — 2026-06-09.
 *
 * The refresh trigger + raw view behind the customer "Their winning
 * moves" / "Why them, not you" sections: crawl sitemaps → fetch
 * top-cited competitor pages → diff structure → join with citation
 * aftermath. Shows ALL move tiers (including quiet, which the customer
 * surface suppresses) plus the durable change stores' recent rows.
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s otherwise.
 * Resilient — failed reads render empty states, never crash the build.
 *
 * Pinned by tests/app/diagnostics/competitor-intel-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { getCompetitorMonitoringState } from "@/domains/competitor-monitoring/store";
import { loadCompetitorMoves, type CompetitorMoveWithEvidence } from "@/domains/competitor-intel/load-moves";
import { getCompetitorStructuralChanges } from "@/domains/competitor-intel/structural-changes-store";
import type { CompetitorStructuralChange } from "@/domains/competitor-intel/types";
import { refreshCompetitorIntelFromForm } from "./actions";

export const dynamic = "force-dynamic";

type LoadedState = {
  lastCrawlAt: string | null;
  moves: CompetitorMoveWithEvidence[];
  structuralChanges: CompetitorStructuralChange[];
};

async function loadState(): Promise<LoadedState> {
  let lastCrawlAt: string | null = null;
  let moves: CompetitorMoveWithEvidence[] = [];
  let structuralChanges: CompetitorStructuralChange[] = [];
  try {
    lastCrawlAt = (await getCompetitorMonitoringState()).lastCrawlAt;
  } catch {
    /* soft-fail */
  }
  try {
    moves = await loadCompetitorMoves();
  } catch {
    /* soft-fail */
  }
  try {
    structuralChanges = (await getCompetitorStructuralChanges()).slice(0, 20);
  } catch {
    /* soft-fail */
  }
  return { lastCrawlAt, moves, structuralChanges };
}

export default async function CompetitorIntelDiagnosticPage() {
  if (!isOperatorModeServer()) {
    notFound();
  }

  const { lastCrawlAt, moves, structuralChanges } = await loadState();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Competitor intel"
        description="Crawl tracked competitors' sitemaps, fetch their most-cited pages, diff structure, and join each change with its AI-citation aftermath. Feeds the customer 'Their winning moves' + 'Why them, not you' sections. Operator-mode only."
      />

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {lastCrawlAt != null
              ? `last crawl ${lastCrawlAt}`
              : "never crawled"}
          </div>
          <form action={refreshCompetitorIntelFromForm}>
            <button
              type="submit"
              className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
            >
              Refresh competitor intel
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Sequential + robots-respecting + bounded (top-cited pages and
          just-changed URLs only). No schedule — refresh deliberately.
        </p>
      </section>

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Detected moves ({moves.length})
        </h2>
        {moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No moves yet. Refresh to crawl + fetch; moves appear once a
            change and its citation window exist.
          </p>
        ) : (
          <ul className="space-y-2">
            {moves.map((m) => (
              <li key={m.id} className="text-sm" data-move-tier={m.tier}>
                <span className="mr-2 inline-flex items-center rounded-full border border-border/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.tier}
                </span>
                {m.line}{" "}
                <span className="text-xs text-muted-foreground">
                  (pre {m.preCount} → post {m.postCount}) · {m.action.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent structural changes ({structuralChanges.length})
        </h2>
        {structuralChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None recorded. Structural changes are detected when a fresh
            fetch differs from the stored snapshot of the same URL.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {structuralChanges.map((c) => (
              <li
                key={`${c.url}|${c.kind}|${c.capturedAt}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span>
                  <span className="font-medium">{c.displayName}</span>{" "}
                  {c.detail}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {c.url} · {c.capturedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
