import { notFound } from "next/navigation";
import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageShell } from "@/components/ui/page-shell";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReceiptLine, buildReceiptLine } from "@/components/data/receipt-line";
import { loadReportModel } from "./reports-data";
import { monthlyHeadline, missesOwnedLine } from "./report-model";
import { WinCardView, WinCardEmpty } from "./win-card";
import { serverNowMs } from "@/lib/server-clock";

/**
 * /reports (P23, v1 257 + 575 merged, INTERNAL-only) - the trailing-month
 * report for the operator. It summarizes the month HONESTLY: changes shipped,
 * how many won / are still measuring / did not move the needle, total clicks
 * gained across wins, the single biggest win (as a screenshot-ready export
 * card), and the misses owned plainly.
 *
 * COUNT AGREEMENT: it reads the SAME snapshot /results reads
 * (loadReportModel -> loadResultsLedgerSurface), so every number here matches
 * /results and /changes by construction - never a re-derived contradiction.
 *
 * INTERNAL-ONLY: operator-gated (BEACON_OPERATOR_MODE, same guard as
 * /diagnostics) and hidden from nav. No public share, no external send. The
 * public win-page version stays deferred (see the master plan P23 line).
 */

// Same operator gate + prerender safety as /diagnostics: this page reads
// tenant-scoped proof data on request, so it must never be statically
// prerendered at build time.
export const dynamic = "force-dynamic";

function operatorMode(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

export default async function ReportsPage() {
  if (!operatorMode()) {
    notFound();
  }

  const model = await loadReportModel();
  const nowMs = serverNowMs();
  const headline = monthlyHeadline(model);
  const misses = missesOwnedLine(model);
  const receipt = buildReceiptLine({
    source: "your Search Console data, measured against comparison pages you did not change",
    checkedAt: model.computedAt,
    nowMs,
  });

  return (
    <PageShell
      title="Monthly report"
      description="What we shipped this month and what it actually drove. These numbers are the same ones on your Results page."
    >
      {/* The one honest headline. Empty state when nothing has ever shipped. */}
      <Card padding="lg" className="flex flex-col gap-3">
        <SectionHeader title="This month at a glance" />
        {headline ? (
          <>
            <p className="text-sub font-medium text-foreground">{headline}</p>
            <div className="flex flex-wrap gap-2">
              <Pill intent="won">{model.outcome?.won ?? 0} won</Pill>
              <Pill intent="measuring">{model.outcome?.measuring ?? 0} measuring</Pill>
              <Pill intent="neutral">{model.shipped} shipped all time</Pill>
            </div>
            {model.totalClicksPerMonth > 0 ? (
              <p className="text-body text-foreground-secondary">
                Together your wins are adding about{" "}
                {model.totalClicksPerMonth.toLocaleString("en-US")} extra clicks a month.
              </p>
            ) : null}
            <ReceiptLine line={receipt} />
          </>
        ) : (
          <EmptyState
            headline="No changes shipped yet."
            nextStep="Ship a move from your Changes list and this report fills in as its read comes back."
          />
        )}
      </Card>

      {/* The single biggest win, as the screenshot-ready export card. */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Your biggest win"
          sub="Screenshot this to share the result."
        />
        {model.biggestWin ? (
          <WinCardView win={model.biggestWin} computedAt={model.computedAt} nowMs={nowMs} />
        ) : (
          <WinCardEmpty />
        )}
      </section>

      {/* Every other measured win, one line each, deep-linking to its own export card. */}
      {model.wins.length > 1 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Other measured wins" count={model.wins.length - 1} />
          <Card padding="md">
            <ul className="flex flex-col gap-2">
              {model.wins.slice(1).map((win) => (
                <li
                  key={win.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                >
                  <span className="text-body text-foreground">{win.pageName}</span>
                  <Link
                    href={`/reports/win/${encodeURIComponent(win.id)}`}
                    className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    +{win.clicksPerMonth.toLocaleString("en-US")} clicks a month
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {/* The misses, owned plainly. Self-hides when there is nothing to own. */}
      {misses ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="What did not work" sub={misses} />
          <Card padding="md">
            <ul className="flex flex-col gap-3">
              {model.misses.map((item) => (
                <li key={item.id} className="text-body leading-relaxed text-foreground-secondary">
                  <span className="font-medium text-foreground">{item.headline}</span> {item.detail}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </PageShell>
  );
}
