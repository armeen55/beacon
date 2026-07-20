import Link from "next/link";

/**
 * activity-list (R14a, 2026-07-03) - the presentational half of /activity: the
 * paged stream rows plus honest paging links. PURE over props (no hooks, no I/O)
 * so activity-list.test.tsx can pin the rendered copy directly.
 */

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ActivityPage } from "@/domains/activity/activity-stream";

export function ActivityList({
  paged,
  loadFailed = false,
}: {
  paged: ActivityPage;
  /** True when a read failed this visit, so an empty stream means "I could not
   *  look", NOT "nothing happened". The two must never share copy. */
  loadFailed?: boolean;
}) {
  if (paged.total === 0) {
    if (loadFailed) {
      return (
        <EmptyState
          headline="I could not load your activity just now. Nothing is lost."
          nextStep="Refreshing usually fixes this. I also retry on my next background pass."
        />
      );
    }
    return (
      <EmptyState
        headline="Nothing logged yet."
        nextStep="As I sync your data, ship changes, and measure results, every action lands here with its receipt."
      />
    );
  }
  return (
    <div>
      <Card padding="none">
        <ul className="divide-y divide-border-subtle">
          {paged.rows.map((e, i) => (
            <li key={`${e.at}::${e.kind}::${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
              <span className="w-[84px] shrink-0 text-meta text-muted-foreground tabular-nums">
                {e.at.slice(0, 10)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sub font-semibold text-foreground">{e.title}</div>
                <div className="text-sub leading-relaxed text-foreground-secondary">
                  {e.sentence}{" "}
                  <Link
                    href={e.href}
                    className="whitespace-nowrap text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {e.linkLabel}
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {paged.pageCount > 1 ? (
        <div className="mt-3 flex items-center gap-3 text-meta text-muted-foreground tabular-nums">
          {paged.page > 1 ? (
            <Link href={`/activity?p=${paged.page - 1}`} className="font-medium underline underline-offset-2 hover:text-foreground">
              Newer
            </Link>
          ) : null}
          <span>
            Page {paged.page} of {paged.pageCount}, {paged.total} entries in all.
          </span>
          {paged.page < paged.pageCount ? (
            <Link href={`/activity?p=${paged.page + 1}`} className="font-medium underline underline-offset-2 hover:text-foreground">
              Older
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
