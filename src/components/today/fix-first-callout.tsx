/**
 * "Fix first" callout (2026-06-16) — the cross-source fusion insight.
 *
 * Surfaces pages that are BOTH losing Google clicks (GSC decline) AND
 * frustrating visitors (Clarity friction). Neither source alone reveals
 * this — GSC says "clicks down", Clarity says "high friction"; together
 * they say "this page is fading in search AND broken for visitors, fix it
 * before anything else." This is the kind of connect-the-sources judgment
 * the whole product exists to automate.
 *
 * Pure presentation. Receives the already-fused list from
 * `buildFixFirstPages` (server-side). Renders nothing when the list is
 * empty (the common case) so it never adds noise — it only appears when
 * there's a genuinely urgent, doubly-confirmed problem.
 */

import Link from "next/link";
import type { FixFirstPage } from "@/domains/today-summary/build-source-stat-cards";

export function FixFirstCallout({
  pages,
}: {
  pages: FixFirstPage[] | null;
}) {
  if (!pages || pages.length === 0) return null;
  return (
    <section
      className="rounded-lg border border-status-warning/40 bg-status-warning/[0.06] px-5 py-4"
      data-today-section="fix-first"
      aria-label="Fix these pages first"
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
          Fix these first
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Losing Google clicks <span aria-hidden="true">·</span> and
          frustrating visitors
        </span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {pages.length === 1 ? "This page is" : `These ${pages.length} pages are`}{" "}
        fading in search <strong className="font-semibold text-foreground">and</strong>{" "}
        tripping up the visitors who do land, the highest-value place to
        spend your next edit.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {pages.map((p) => (
          <li
            key={p.path}
            className="flex items-baseline justify-between gap-3 text-[12px]"
            data-fix-first-page={p.path}
          >
            <span className="truncate font-mono text-foreground/90">
              {p.path}
            </span>
            <span className="shrink-0 tabular-nums text-status-warning font-semibold">
              −{p.dropPct}% clicks <span className="text-muted-foreground/60">·</span>{" "}
              {p.frictionPerVisit} friction clicks/visit
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/recommendations"
        className="mt-3 inline-flex text-[12px] font-semibold text-accent-primary hover:underline"
        data-fix-first-cta="true"
      >
        See the fixes →
      </Link>
    </section>
  );
}
