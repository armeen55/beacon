export const dynamic = "force-dynamic";

/**
 * /activity (R14a, P1 trust receipts, 2026-07-03) - the operator's "what has Beacon
 * done while I was away" answer: ONE unified, reverse-chronological stream composed
 * from EXISTING stores only (shipped changes with who shipped them, plan approvals
 * and clears, cron receipts under plain names, repeated failures above the spike
 * floor, connection events). Read-only, paged 50, deadline-bounded, honest empty
 * state. Composition lives in src/domains/activity/activity-stream.ts.
 */

import { PageShell } from "@/components/ui/page-shell";
import { HonestDelay } from "@/components/honest-delay";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { pageActivityEvents } from "@/domains/activity/activity-stream";
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
import { loadActivityEvents } from "./activity-data";
import { ActivityList } from "./activity-list";
import { serverNowMs } from "@/lib/server-clock";

const PAGE_DEADLINE_MS = 15_000;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await (searchParams ??
    Promise.resolve<Record<string, string | string[] | undefined>>({}));
  const requestedPage = typeof params.p === "string" ? Number.parseInt(params.p, 10) : 1;

  const raced = await loadWithDeadline(
    loadActivityEvents().catch(() => []),
    PAGE_DEADLINE_MS,
  );

  return (
    <PageShell
      title="Activity"
      description="Everything Beacon did while you were away: changes shipped, plans approved, nightly jobs, and anything that needs your eye."
    >
      {raced.timedOut ? (
        <HonestDelay />
      ) : (
        <div>
          {/* R14b (receipts everywhere) - the stream's own receipt: what records it
              is assembled from and that it was composed this visit, plus the same
              rows as a file. */}
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <ReceiptLine
              line={buildReceiptLine({
                source: "your own change, plan, job, spend, and connection records",
                checkedAt: new Date().toISOString(),
                verb: "assembled",
                nowMs: serverNowMs(),
              })}
            />
            {raced.data.length > 0 ? (
              <a
                href="/activity/export"
                className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                Download as spreadsheet
              </a>
            ) : null}
          </div>
          <ActivityList paged={pageActivityEvents(raced.data, Number.isFinite(requestedPage) ? requestedPage : 1)} />
        </div>
      )}
    </PageShell>
  );
}
