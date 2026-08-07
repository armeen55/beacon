/**
 * changes-feed - ONE ranked feed for everything I am doing about this account, in one order:
 * Ready, Needs review, Researching, Watching, Measuring, Results.
 *
 * THE REVERSAL THIS FILE EXISTS FOR: evidence controls an opportunity's STATE, never its
 * existence. A change is only ever Ready when its exact copy passed every check, and that
 * strictness is untouched here. What changed is that everything short of Ready is now SHOWN
 * instead of swallowed: a topic I am still buying evidence on, a page losing clicks I have no
 * change for, an idea I set aside, a change I am measuring. An account holding declining pages,
 * open topics and hundreds of answers can never again render as "no changes yet".
 *
 * PURE PRESENTATION. Every number arrives loaded; nothing here reads a store, and nothing here
 * recomputes a count another surface owns (the lifecycle counts and the ranked queue both come
 * in as they were computed once). Beacon voice: first person, a number where one exists, always
 * a next step, no em or en dashes.
 */

import type { ReactNode } from "react";
import Link from "next/link";

import type { TopicInvestigation } from "@/domains/evidence";
import { setAsideClause, type ChangesView } from "../changes-data";

/** One page's two consecutive 28 day windows, as the decay read hands them over. */
type DecayRow = {
  page: string;
  clicksNow: number;
  clicksPrior: number;
  impressionsNow: number;
  impressionsPrior: number;
  positionNow: number;
  positionPrior: number;
  windowNowEnd?: string;
};

/** The shipped-change ledger row, structurally satisfied by ShippedChangeRecord. */
type LedgerRow = {
  id: string;
  page: string;
  path: string;
  actionType: string;
  shippedAt: string;
  implementedAt?: string | null;
  verdict: string;
  bundleHypothesis?: string | null;
};

/** A DECLINE WORTH A ROW. The smoke alarm's floor (10 clicks) is the one that earns the whole
 *  screen's attention; this is the floor that earns a LINE, because a page quietly shedding a
 *  handful of clicks is exactly what the operator never gets told. A page that had almost no
 *  clicks to begin with is noise, not a decline, so it needs a real prior week behind it. */
const WATCH_MIN_CLICKS_LOST = 3;
const WATCH_MIN_PRIOR_CLICKS = 5;
/** How many rows a lane shows before it says how many more it holds. A feed nobody can read is
 *  the same silence as an empty one. */
const LANE_LIMIT = 6;
const RESEARCH_LIMIT = 5;

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A day in the operator's words. A bare YYYY-MM-DD is a finalized day and is read in UTC, so
 *  the day I name is the day the data actually ends on. */
function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The page, short enough to read. */
const prettyPage = (url: string): string => {
  const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
  return path.length > 48 ? `${path.slice(0, 45)}...` : path;
};

/** The stored slug in the operator's words. Anything unmapped falls back to its own plain words,
 *  so a new action type reads as English rather than as a slug. */
const PART_WORD: Record<string, string> = { meta: "description", faq: "FAQ", h1: "main heading", h2: "section",
  h3: "section", schema: "schema markup", gbp: "Google Business profile", alt: "image descriptions" };
const plainPart = (t: string): string => t.split(" ").map((w) => PART_WORD[w] ?? w).join(" ");

function changeLabel(row: LedgerRow): string {
  if (row.bundleHypothesis?.trim()) return row.bundleHypothesis.trim();
  if (row.actionType === "create_page") return "I published a new page";
  const t = plainPart(row.actionType.replace(/^(edit|change|improve|update|add|fix|rewrite)_/, "").replace(/_/g, " ").trim());
  if (!t) return "I changed this page";
  if (row.actionType.startsWith("add_")) return `I added the ${t}`;
  if (row.actionType.startsWith("fix_")) return `I fixed the ${t}`;
  if (row.actionType.startsWith("rewrite_")) return `I rewrote the ${t}`;
  return `I changed the ${t}`;
}

// ── the strip ────────────────────────────────────────────────────────────────

/** THE PERSISTENT COUNT STRIP. A lane with nothing in it prints no number at all: a row of
 *  zeros told a quiet account nothing and asked nothing of it. */
function SummaryStrip({ counts }: { counts: [string, number][] }) {
  const live = counts.filter(([, n]) => n > 0);
  return (
    <div data-changes-strip="true" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-inset/40 px-3 py-2 text-[12px] tabular-nums text-muted-foreground">
      {live.length === 0 ? (
        <span>I am reading your pages right now, and every lane below fills in as I finish.</span>
      ) : (
        live.map(([label, n]) => (
          <span key={label} className="rounded-md bg-surface-raised px-2 py-0.5">
            {label} {num(n)}
          </span>
        ))
      )}
    </div>
  );
}

function Lane({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  const slug = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section id={slug} className="scroll-mt-6 space-y-3" data-lane={slug}>
      <div className="space-y-0.5">
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1.5 text-[12px] tabular-nums text-muted-foreground" data-evidence-held="true">
      {items.map((c) => (
        <span key={c} className="rounded-md border border-border px-2 py-0.5">{c}</span>
      ))}
    </p>
  );
}

// ── Researching ──────────────────────────────────────────────────────────────

/** HOW MUCH THIS TOPIC IS WORTH LOOKING AT, in one number I can defend: the largest priced
 *  search behind it, or the impressions Google already gave it. Never a sum of overlapping
 *  volumes, which is the same rule the packet itself follows. */
const weightOf = (inv: TopicInvestigation): number =>
  Math.max(inv.demand.monthlySearchVolume ?? 0, (inv.demand.gscImpressions ?? 0) / 4, inv.demand.trackedPrompts * 50);

/** What I noticed, in the evidence's own numbers. */
function signalOf(inv: TopicInvestigation): string {
  const parts: string[] = [];
  if (inv.demand.monthlySearchVolume != null) parts.push(`about ${num(inv.demand.monthlySearchVolume)} searches a month`);
  if (inv.demand.gscImpressions != null && inv.demand.gscImpressions > 0) parts.push(`your pages already came up ${num(inv.demand.gscImpressions)} times for it`);
  if (inv.demand.trackedPrompts > 0) parts.push(`${inv.demand.trackedPrompts} of the AI questions I track land here`);
  if (inv.demand.fanOuts > 0) parts.push(`${inv.demand.fanOuts} follow up ${plural(inv.demand.fanOuts, "search", "searches")} the engines ran themselves`);
  return parts.length > 0
    ? `I found ${parts.join(", ")}.`
    : "I found this topic in your own evidence and I am pricing it now.";
}

/** Why it is worth my money and your time, said only from what I hold. */
function stakesOf(inv: TopicInvestigation): string {
  const winners = inv.distinctWinners;
  if (winners > 0 && inv.pageType !== "unknown") {
    return `${winners} ${plural(winners, "site wins", "sites win")} this today and the pages that win it are the same shape, so I can tell you exactly what yours would have to answer.`;
  }
  if (winners > 0) return `${winners} ${plural(winners, "site is", "sites are")} winning this instead of you.`;
  return "I cannot name who wins this yet, which is exactly what I am buying next.";
}

/** How much of this I can stand behind. Plain words, never a score. */
function confidenceOf(inv: TopicInvestigation): string {
  if (inv.currentReadableWinners >= 3 && inv.serpFreshness === "current") return "Strong evidence";
  if (inv.exactSerps.length > 0) return "Early evidence";
  return "Still building evidence";
}

function lastLookOf(inv: TopicInvestigation): string {
  const newest = [...inv.exactSerps.map((s) => s.observedAt), inv.answerIntel.latestObservedAt]
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const day = dayLabel(newest);
  return day ? `Last looked ${day}` : "Not looked at yet";
}

function ResearchingCard({ inv, rankReason }: { inv: TopicInvestigation; rankReason: string | null }) {
  const held: string[] = [];
  if (inv.exactSerps.length > 0) held.push(`${inv.exactSerps.length} ${plural(inv.exactSerps.length, "results page", "results pages")} read`);
  if (inv.distinctWinners > 0) held.push(`${inv.currentReadableWinners} of ${inv.distinctWinners} winning ${plural(inv.distinctWinners, "page", "pages")} read`);
  if (inv.answerIntel.answers > 0) held.push(`${inv.answerIntel.answers} AI ${plural(inv.answerIntel.answers, "answer", "answers")} analyzed`);
  if (inv.keywords.length > 0) held.push(`${inv.keywords.length} ${plural(inv.keywords.length, "search", "searches")} priced`);
  const next = inv.nextAcquisition;
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-surface-raised p-4" data-researching-card="true">
      <p className="text-[14px] font-semibold text-foreground">{inv.label}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{signalOf(inv)}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{stakesOf(inv)}</p>
      <Chips items={held} />
      {inv.missingEvidence.length > 0 ? (
        <div className="space-y-1" data-evidence-missing="true">
          <p className="text-[12px] font-semibold text-foreground">What I still do not have</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
            {inv.missingEvidence.slice(0, 4).map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="text-[13px] leading-relaxed text-foreground" data-next-step="true">
        My next step: {next ? next.why : "I have bought everything here that would change the answer, so I am holding this until your own numbers move."}
      </p>
      <p className="text-[12px] tabular-nums text-muted-foreground">
        {confidenceOf(inv)} · {lastLookOf(inv)}
        {rankReason ? ` · ${rankReason}` : ""}
      </p>
    </li>
  );
}

// ── the feed ─────────────────────────────────────────────────────────────────

/**
 * THE one Changes screen. `queue` is the ranked Ready / Needs review list (its own client
 * component, which owns paging, set aside and mark implemented); everything under it is the
 * work that is real but not yet a change you can make.
 */
export function ChangesFeed({ view, queue, investigations, decay, declineNotes, measuring, results, heldForMeasurement = 0, ledgerRead = true }: {
  view: ChangesView;
  queue: ReactNode;
  investigations: readonly TopicInvestigation[];
  decay: readonly DecayRow[];
  declineNotes: readonly { page: string; note: string }[];
  measuring: readonly LedgerRow[];
  results: readonly LedgerRow[];
  heldForMeasurement?: number;
  /** FALSE when the ledger behind the two lanes below could not be read (a failed read or a
   *  deadline that lost). An empty list I could not fill is NOT an account with nothing
   *  measuring: printing "make your first change" to an operator holding 25 results is the
   *  worst lie this screen can tell, and the counts it cannot stand behind stay off the strip. */
  ledgerRead?: boolean;
}) {
  // RANKED, AND THE ORDER SAYS WHY. Weight is the one defensible number behind the topic, so
  // the sentence under each card compares it with the card below rather than asserting a rank.
  const ranked = [...investigations].sort((a, b) => weightOf(b) - weightOf(a));
  const shownResearch = ranked.slice(0, RESEARCH_LIMIT);

  // Pages the decision already judged and resolved to watch keep the kernel's own verdict.
  const judged = new Map(declineNotes.map((n) => [n.page, n.note] as const));
  const declining = decay
    .map((d) => ({ ...d, lost: d.clicksPrior - d.clicksNow }))
    .filter((d) => d.lost >= WATCH_MIN_CLICKS_LOST && d.clicksPrior >= WATCH_MIN_PRIOR_CLICKS)
    .sort((a, b) => b.lost - a.lost);
  const through = dayLabel(decay[0]?.windowNowEnd ?? null);
  // A BAR I COULD NOT READ IS NOT A BAR I RAISED, so a release I cannot check claims no
  // set aside count at all rather than blaming the operator's ideas for an outage.
  const setAside = view.basisUnreadable ? 0 : view.demotedStaleBasis ?? 0;
  // ONE ARITHMETIC PER LANE, and the strip reads the SAME variables the rows below are drawn
  // from. A count computed separately from its own list is a contradiction waiting to ship
  // (the strip said 12 measuring over a lane that said nothing was), so every lane's total is
  // its shown rows plus the remainder it states out loud, and nothing else.
  const shownWatch = declining.slice(0, LANE_LIMIT);
  const extraWatchRows = (setAside > 0 ? 1 : 0) + (heldForMeasurement > 0 ? 1 : 0);
  const watchingCount = declining.length + extraWatchRows;
  const watchMore = watchingCount - (shownWatch.length + extraWatchRows);
  const shownMeasuring = measuring.slice(0, LANE_LIMIT), shownResults = results.slice(0, LANE_LIMIT);
  const ledgerMore = (measuring.length - shownMeasuring.length) + (results.length - shownResults.length);
  // A COUNT I COULD NOT READ IS NOT A ZERO AND NOT A NUMBER: it is withheld, and the lane says why.
  const ledgerCounts: [string, number][] = ledgerRead && !view.countsUnavailable
    ? [["Measuring", measuring.length], ["Results", results.length]] : [];

  return (
    <div className="space-y-8" data-changes-feed="true">
      <SummaryStrip
        counts={[
          ["Ready", view.summary.ready],
          ["Needs review", view.summary.todo],
          ["Researching", ranked.length],
          ["Watching", watchingCount],
          ...ledgerCounts,
        ]}
      />

      <Lane title="Ready and needs review" blurb="A change reaches Ready only when its exact copy passed every evidence and safety check. Everything else in this list is honest work in progress, not a change I am asking you to make.">
        {queue}
      </Lane>

      <Lane title="Researching" blurb="Topics I am actively buying evidence on. None of these is a change yet, and I say exactly what I am still missing on each one.">
        {shownResearch.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            I have no topic open right now. My next daily round opens the strongest one it finds and it lands here.
          </p>
        ) : (
          <ol className="space-y-3">
            {shownResearch.map((inv, i) => {
              const below = shownResearch[i + 1];
              const reason = below
                ? `Ahead of "${below.label}" on about ${num(weightOf(inv))} against ${num(weightOf(below))}`
                : null;
              return <ResearchingCard key={inv.key} inv={inv} rankReason={reason} />;
            })}
          </ol>
        )}
        {ranked.length > shownResearch.length ? (
          <p className="text-[12px] tabular-nums text-muted-foreground">
            {ranked.length - shownResearch.length} more {plural(ranked.length - shownResearch.length, "topic is", "topics are")} open under these, and I work them in this order.
          </p>
        ) : null}
      </Lane>

      <Lane title="Watching" blurb="Pages and ideas I am holding rather than acting on, each with the reason I am holding it. Nothing here is deleted and nothing here is forgotten.">
        <ul className="space-y-2">
          {shownWatch.map((d) => {
            const note = judged.get(prettyPage(d.page)) ?? judged.get(d.page) ?? null;
            return (
              <li key={d.page} className="space-y-1 rounded-xl border border-border bg-surface-raised px-4 py-3" data-watching-row="true">
                <p className="text-[13px] font-semibold text-foreground">{prettyPage(d.page)}</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground tabular-nums">
                  It lost {num(d.lost)} {plural(d.lost, "click", "clicks")} against the 28 days before
                  {through ? ` (data through ${through})` : ""}, and it now sits at position {d.positionNow.toFixed(1)} against {d.positionPrior.toFixed(1)}.
                </p>
                <p className="text-[13px] leading-relaxed text-foreground">
                  {note ?? "I have no change on it my evidence supports yet, so I am reading its results pages next rather than sending you to rewrite a page that may be winning."}
                </p>
              </li>
            );
          })}
          {heldForMeasurement > 0 ? (
            <li className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-[13px] leading-relaxed text-muted-foreground" data-watching-row="true">
              I am holding {num(heldForMeasurement)} new {plural(heldForMeasurement, "idea", "ideas")} back because {plural(heldForMeasurement, "that page", "those pages")} already {plural(heldForMeasurement, "carries", "carry")} a change I am measuring.
            </li>
          ) : null}
          {setAside > 0 ? (
            <li className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-[13px] leading-relaxed text-muted-foreground" data-watching-row="true">
              {setAsideClause(setAside)} I keep them, and any one of them comes back the moment its own evidence moves.
            </li>
          ) : null}
          {declining.length === 0 && setAside === 0 && heldForMeasurement === 0 ? (
            <li className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
              No page of yours is losing clicks against the four weeks before, so I am holding nothing back today.
            </li>
          ) : null}
        </ul>
        {watchMore > 0 ? (
          <p className="text-[12px] tabular-nums text-muted-foreground" data-lane-more="watching">
            {num(watchMore)} more {plural(watchMore, "page is", "pages are")} down by less than these, and I am watching every one.
          </p>
        ) : null}
      </Lane>

      <Lane title="Measuring and results" blurb="Changes you have already made. I read each page against how it did before and against similar pages you did not change.">
        {view.countsUnavailable || !ledgerRead ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            I could not read what is measuring just now, so I am not showing you a count I cannot stand behind. I am retrying automatically.
          </p>
        ) : measuring.length === 0 && results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            Nothing is measuring yet. Make the top ready change on your site, mark it done, and I start reading that page for you.
          </p>
        ) : (
          <ul className="space-y-2">
            {[...shownMeasuring.map((r) => ({ r, state: "measuring" as const })), ...shownResults.map((r) => ({ r, state: "result" as const }))]
              .map(({ r, state }) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-raised px-4 py-3" data-ledger-row={state}>
                  <span className="text-[13px] font-semibold text-foreground">{prettyPage(r.page || r.path)}</span>
                  <span className="text-[13px] text-muted-foreground">{changeLabel(r)}</span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {dayLabel(r.implementedAt ?? r.shippedAt) ?? "date not recorded"} ·{" "}
                    {state === "measuring"
                      ? "still measuring"
                      : r.verdict === "won"
                        ? "it worked"
                        : "what I learned"}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {ledgerRead && measuring.length + results.length > 0 ? (
          <Link href="/results" data-lane-more="ledger" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
            {ledgerMore > 0 ? `See the other ${num(ledgerMore)} on Results` : "See every reading"} &rarr;
          </Link>
        ) : null}
      </Lane>
    </div>
  );
}
