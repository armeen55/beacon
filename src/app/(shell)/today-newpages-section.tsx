import Link from "next/link";
import { loadNewPagesData } from "./today-newpages-data";
import { NewPageCard } from "./today-newpages-card";
import { NewPagesPrepareButton } from "./today-newpages-prepare";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { SectionHeader } from "@/components/ui/section-header";
import { topicIdentityKey } from "@/domains/demand-graph/dedupe-new-page-cards";
import type { NewPagesData } from "./today-newpages-data";
import { loadCurrentCustomerSurface } from "./customer-surface-store";

/**
 * today-newpages-section (2026-06-24) — the "New Pages to Build" board: the
 * create_page half of the Rank-&-Revenue engine. Topics competitors own that the
 * tenant has no page for — the biggest growth lever — surfaced as a premium board,
 * each card with the competitor teardown + an on-demand "✨ Draft the opening".
 * Read-only, tenant-agnostic; self-hides when there are none.
 *
 * FP6b-2 (2026-07-02) - the outer board shell was a light-only gradient card
 * (design audit: "dark-broken"). Moved onto Card + SectionHeader + tokens so
 * dark mode is free; the old emerald gradient accent is dropped rather than
 * kept, since it read only against a white background and had no token-based
 * equivalent worth preserving.
 *
 * FP5b (2026-07-02) - ONE home per job: this board renders ONCE, on /changes.
 * Today renders TodayNewPagesSummaryLine (one sentence + a link) instead of a
 * second copy of the board, and `excludeTopics` lets /changes drop any card
 * whose topic is already in this week's page-factory batch (that card is
 * further along: it has a drafted page and an Approve button), so a new-page
 * idea never appears in two formats on the same page.
 */

export async function TodayNewPagesSection({
  enableAeoBrief = false,
  limit,
  excludeTopics = [],
  dataOverride,
}: { enableAeoBrief?: boolean; limit?: number; excludeTopics?: string[]; dataOverride?: NewPagesData | null } = {}) {
  let data;
  try {
    // FP1 (2026-07-02) - this board can rebuild the demand graph on a cold cache,
    // the slowest read on Today. Deadline-bounded so its pulse skeleton can never
    // strand; the abandoned build keeps running and warms the cache.
    if (dataOverride === null) return null;
    if (dataOverride !== undefined) {
      data = dataOverride;
    } else {
      const raced = await loadWithDeadline(loadNewPagesData());
      if (raced.timedOut) return <HonestDelay />;
      data = raced.data;
    }
  } catch {
    return null;
  }
  // FP5b - a topic the page-factory batch card already presents (with its drafted
  // page and Approve button) must not ALSO get a board card on the same page.
  const excludeKeys = new Set(excludeTopics.map(topicIdentityKey));
  const opportunities =
    excludeKeys.size > 0
      ? data.opportunities.filter((o) => !excludeKeys.has(topicIdentityKey(o.topic)))
      : data.opportunities;
  if (!opportunities.length) return null;

  const operator = await isOperatorModeServer();
  const preparedCount = opportunities.filter((o) => o.preparedVerdict).length;
  const shown = limit ? opportunities.slice(0, limit) : opportunities;
  // Owned-coverage honesty (2026-07-11, blind-benchmark defect 1): the blanket "you
  // have no page yet" claim is only true when NO rendered card carries owned coverage.
  // A Watching card naming /nowruz under that header would contradict itself on one
  // screen, so the header softens the moment any rendered card is owned-covered.
  const anyOwnedCoverage = shown.some((o) => !!o.ownedCoverage);

  return (
    <section id="new-pages" className="rounded-3xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <SectionHeader
        title="New pages to build"
        sub={newPagesSectionSub(anyOwnedCoverage)}
        action={
          <>
            {operator && !limit ? <NewPagesPrepareButton alreadyPrepared={preparedCount} total={opportunities.length} /> : null}
            {limit && opportunities.length > limit ? (
              // UX4 item 5 legacy - a capped render names exactly where the rest live.
              <Link
                href="/changes#new-pages"
                className="rounded-lg border border-border bg-card px-3.5 py-1.5 text-body font-semibold text-foreground-secondary transition-colors hover:bg-surface-raised"
              >
                See all {opportunities.length} in Changes →
              </Link>
            ) : null}
            {!limit && data.totalCandidates > opportunities.length ? (
              <Link
                href="/changes#new-pages"
                className="rounded-lg border border-border bg-card px-3.5 py-1.5 text-body font-semibold text-foreground-secondary transition-colors hover:bg-surface-raised"
              >
                +{data.totalCandidates - opportunities.length} more →
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((o) => (
          <NewPageCard key={o.id} o={o} ownDomain={data.ownDomain} enableAeoBrief={enableAeoBrief} />
        ))}
      </div>
    </section>
  );
}

/** FP5b - the one sentence for the Today summary line. PURE; exported for a direct
 *  copy pin (today-newpages-summary.test.tsx). First person, concrete number, one
 *  next step, no dashes. */
export function newPagesSummarySentence(count: number): string {
  return `I found ${count} new page${count === 1 ? "" : "s"} worth building. The full board, with drafts and competitor teardowns, lives in Changes.`;
}

/** Owned-coverage honest subhead (2026-07-11, blind-benchmark defect 1). PURE;
 *  exported for a direct copy pin (today-newpages-summary.test.ts). The blanket
 *  "you have no page yet" claim only renders when no card on the board carries
 *  owned coverage; otherwise the soft variant defers to the per-card sentences
 *  so the section never contradicts a Watching card on the same screen. */
export function newPagesSectionSub(anyOwnedCoverage: boolean): string {
  return anyOwnedCoverage
    ? "Competitor pages get cited for these topics. Where I already have a page, I say so on the card."
    : "Competitor pages get cited for these topics, and you have no page yet. The fastest way to capture demand AI and Google are already sending elsewhere.";
}

/**
 * TodayNewPagesSummaryLine (2026-07-02, FP5b) - Today's ONE line about new pages.
 * The board itself (cards, drafts, prepare buttons) has exactly one home now:
 * /changes#new-pages. Reads the same request-cached loader the board uses, so the
 * count here always equals the number of cards the board shows. Self-hides at zero;
 * deadline-bounded so it can never strand Today's stream.
 */
export async function TodayNewPagesSummaryLine() {
  let count = 0;
  try {
    const customer = await loadCurrentCustomerSurface().catch(() => null);
    if (customer) {
      count = customer.newPages?.opportunities.length ?? 0;
    } else {
      const raced = await loadWithDeadline(loadNewPagesData());
      if (raced.timedOut) return null;
      count = raced.data.opportunities.length;
    }
  } catch {
    return null;
  }
  if (count === 0) return null;
  return (
    <p
      data-newpages-summary-line="true"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-body text-foreground-secondary tabular-nums"
    >
      <span>{newPagesSummarySentence(count)}</span>
      <Link
        href="/changes#new-pages"
        className="shrink-0 text-body font-medium text-foreground-secondary underline underline-offset-2 hover:text-foreground"
      >
        Open the board →
      </Link>
    </p>
  );
}
