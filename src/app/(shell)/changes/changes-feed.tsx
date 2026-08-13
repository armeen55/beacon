/**
 * changes-feed - THE EDITS FIRST, and everything that is not yet an edit last. The ranked queue and the changes
 * already being read are the page; the topics under research and the pages being watched sit at the bottom in one
 * closed drawer, one line each, because they are background owed honestly and never work anybody has to read.
 * THE RULE THAT SURVIVED: evidence controls an opportunity's STATE, never its existence, so nothing is swallowed.
 * PURE PRESENTATION: every number arrives loaded, nothing here reads a store, and nothing recomputes a count
 * another surface owns. Beacon voice (amended 2026-08-11): NO first person, a number where one exists, a next step.
 */

import type { ReactNode } from "react";
import Link from "next/link";

import { changeSentence, ledgerProofLine } from "@/domains/decision";
import type { TopicInvestigation } from "@/domains/evidence";
import { setAsideClause, type ChangesView } from "../changes-data";
import { isWatchedDecay } from "./lane-counts";

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
  windows?: { day: number; ran: boolean; controlsUsed?: number | null; adjustedLift?: number }[];
};

/** How many rows a lane shows before it says how many more it holds. A feed nobody can read is the same
 *  silence as an empty one. */
const LANE_LIMIT = 6;
const RESEARCH_LIMIT = 8;

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** A day in the operator's words. A bare YYYY-MM-DD is a finalized day read in UTC, so the day I name is the
 *  day the data actually ends on. */
function dayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The page path, full length for matching. */
const pathOf = (url: string): string => url.replace(/^https?:\/\/[^/]+/, "") || "/";
/** The page, short enough to read. */
const prettyPage = (url: string): string => {
  const path = pathOf(url);
  return path.length > 48 ? `${path.slice(0, 45)}...` : path;
};

/** The stored slug in the operator's words. Anything unmapped falls back to its own plain words. */
const PART_WORD: Record<string, string> = { meta: "description", faq: "FAQ", h1: "main heading", h2: "section",
  h3: "section", schema: "schema markup", gbp: "Google Business profile", alt: "image descriptions" };
const plainPart = (t: string): string => t.split(" ").map((w) => PART_WORD[w] ?? w).join(" ");

/** THIS LIST HOLDS A TITLE, NOT AN ARGUMENT. A stored hypothesis is the whole reason the change was made (one
 *  row printed about sixty words of it), so a hypothesis only reaches this line when nothing shorter exists,
 *  and then it is cut at a word. */
const LABEL_MAX = 90;
function shortLabel(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= LABEL_MAX) return one;
  const cut = one.slice(0, LABEL_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, "")}...`;
}

function changeLabel(row: LedgerRow): string {
  if (row.actionType === "create_page") return "A new page was published";
  const mapped = changeSentence(row.actionType);
  if (mapped) return mapped;
  if (row.bundleHypothesis?.trim()) return shortLabel(row.bundleHypothesis);
  const t = plainPart(row.actionType.replace(/^(edit|change|improve|update|add|fix|rewrite)_/, "").replace(/_/g, " ").trim());
  if (!t) return "This page was changed";
  if (row.actionType.startsWith("add_")) return `Added the ${t}`;
  if (row.actionType.startsWith("fix_")) return `Fixed the ${t}`;
  if (row.actionType.startsWith("rewrite_")) return `Rewrote the ${t}`;
  return `Changed the ${t}`;
}

/** The reads every change gets, in days, when a row carries no window list of its own yet. */
const READ_LADDER = [7, 14, 28];
/** HOW FAR THE READING HAS GOT ON ONE CHANGE, from the windows the row already carries. "still measuring" is
 *  not an answer to "when do I hear back", so this names the read that landed and the one it waits on, or the
 *  day the first one lands. One clause, no lab words. */
function readProgress(row: LedgerRow): string {
  const windows = row.windows ?? [];
  const days = windows.length > 0 ? [...new Set(windows.map((w) => w.day))].sort((a, b) => a - b) : READ_LADDER;
  const done = windows.filter((w) => w.ran).map((w) => w.day).sort((a, b) => b - a)[0] ?? null;
  const next = days.find((d) => done == null || d > done) ?? null;
  if (done != null) return next == null ? `${done} day read done` : `${done} day read done, waiting on the ${next} day`;
  const started = Date.parse(row.implementedAt ?? row.shippedAt);
  const lands = Number.isFinite(started) ? dayLabel(new Date(started + (next ?? READ_LADDER[0]!) * 86_400_000).toISOString()) : null;
  return lands ? `waiting on the first read (lands ${lands})` : "waiting on the first read";
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

// ── the drawer's two lanes, one line per row ─────────────────────────────────

/** HOW MUCH THIS TOPIC IS WORTH LOOKING AT, in one number I can defend: the largest priced search behind it,
 *  or the impressions Google already gave it. Never a sum of overlapping volumes. */
const weightOf = (inv: TopicInvestigation): number =>
  Math.max(inv.demand.monthlySearchVolume ?? 0, (inv.demand.gscImpressions ?? 0) / 4, inv.demand.trackedPrompts * 50);

/** What I noticed, in ONE number. "came up 1 times" is not English, and it shipped. */
function signalOf(inv: TopicInvestigation): string {
  if (inv.demand.monthlySearchVolume != null) return `${num(inv.demand.monthlySearchVolume)} searches a month`;
  const seen = inv.demand.gscImpressions ?? 0;
  if (seen > 0) return `you came up ${seen === 1 ? "once" : `${num(seen)} times`} for it`;
  if (inv.demand.trackedPrompts > 0) return `${inv.demand.trackedPrompts} of the tracked AI questions land here`;
  return "Pricing the demand now";
}

/** What I do next on this topic, from the acquisition's KIND rather than its sentence, so no stored date and no
 *  internal phrasing can ever reach this line. */
const NEXT_WORD: Record<string, string> = { read_winner: "reading the winning pages",
  buy_serp: "reading Google's results page", buy_volume: "pricing the searches" };
const nextOf = (inv: TopicInvestigation): string =>
  (inv.nextAcquisition ? NEXT_WORD[inv.nextAcquisition.kind] : null) ?? "watching it until your numbers move";

// ── the feed ─────────────────────────────────────────────────────────────────

/** THE one Changes screen. `queue` is the ranked list (its own client component, which owns paging, set aside
 *  and mark implemented); the ledger sits under it, and the background sits in a closed drawer under that. */
export function ChangesFeed({ view, queue, investigations, decay, declineNotes, measuring, results, heldForMeasurement = 0, ledgerRead = true, evidenceRead = true, staleCounts = null }: {
  view: ChangesView;
  queue: ReactNode;
  investigations: readonly TopicInvestigation[];
  decay: readonly DecayRow[];
  declineNotes: readonly { page: string; note: string }[];
  measuring: readonly LedgerRow[];
  results: readonly LedgerRow[];
  heldForMeasurement?: number;
  /** FALSE when the ledger behind the two lanes below could not be read. An empty list I could not fill is NOT
   *  an account with nothing measuring: printing "make your first change" to an operator holding 25 results is
   *  the worst lie this screen can tell, and the counts it cannot stand behind stay off the strip. */
  ledgerRead?: boolean;
  /** FALSE when the evidence behind the drawer could not be read. Absence of a source is not an account with
   *  nothing open: the drawer says which of the two happened and claims no count. */
  evidenceRead?: boolean;
  /** Release-stamped open-lane counts (same arithmetic, lane-counts.ts), shown with their age ONLY when the live read failed. */
  staleCounts?: { researching: number; watching: number; ago: string | null } | null;
}) {
  // One row per topic label: two investigation records for the same words is my bookkeeping, not two topics.
  const seenLabels = new Set<string>();
  const ranked = [...investigations].sort((a, b) => weightOf(b) - weightOf(a))
    .filter((inv) => (seenLabels.has(inv.label) ? false : (seenLabels.add(inv.label), true)));
  const shownResearch = ranked.slice(0, RESEARCH_LIMIT);
  // SAID ONCE WHEN IT IS THE SAME ANSWER. Eight rows repeating one sentence is not eight facts.
  const nextWords = new Set(shownResearch.map(nextOf));
  const oneNext = nextWords.size === 1 ? [...nextWords][0]! : null;

  // Pages the decision already judged and resolved to watch keep the kernel's own verdict.
  const judged = new Map(declineNotes.map((n) => [n.page, n.note] as const));
  // THE FIX IS IN THE QUEUE, so this page may not also be called a page I have no change for. The ranking's own
  // order is the rank, because queuedPages is cut from it before the screen is.
  const queued = new Map((view.queuedPages ?? []).map((p, i) => [p, i + 1] as const));
  const declining = decay
    .map((d) => ({ ...d, lost: d.clicksPrior - d.clicksNow }))
    .filter(isWatchedDecay)
    .sort((a, b) => b.lost - a.lost);
  const through = dayLabel(decay[0]?.windowNowEnd ?? null);
  // A BAR I COULD NOT READ IS NOT A BAR I RAISED: a release I cannot check claims no set-aside count at all.
  const setAside = view.basisUnreadable ? 0 : view.demotedStaleBasis ?? 0;
  // ONE ARITHMETIC PER LANE, off the SAME variables the rows below are drawn from. A count computed separately
  // from its own list is a contradiction waiting to ship (the strip said 12 measuring over a lane that said
  // nothing was), so every lane's total is its shown rows plus the remainder it states out loud.
  const shownWatch = declining.slice(0, LANE_LIMIT);
  const extraWatchRows = (setAside > 0 ? 1 : 0) + (heldForMeasurement > 0 ? 1 : 0);
  const watchingCount = declining.length + extraWatchRows;
  const watchMore = watchingCount - (shownWatch.length + extraWatchRows);
  const shownMeasuring = measuring.slice(0, LANE_LIMIT), shownResults = results.slice(0, LANE_LIMIT);
  const ledgerMore = (measuring.length - shownMeasuring.length) + (results.length - shownResults.length);
  // A live read that failed falls back to the counts the release stamped, said with their age.
  const stale = evidenceRead === false ? staleCounts : null;
  const backstage = evidenceRead === false
    ? (stale ? { topics: stale.researching, pages: stale.watching, ago: stale.ago } : null)
    : { topics: ranked.length, pages: watchingCount, ago: null };

  return (
    <div className="space-y-8" data-changes-feed="true">
      <Lane title="Your edits" blurb="Every card here is an edit you can make right now, ranked by payoff. The chip on each one tells you how proven it is. Every edit is measured after you make it.">
        {/* THE WATERMARK, ONCE. Every Google number on this screen ends on the same finalized day, so it is
            said here rather than in brackets on every row that happens to quote one. */}
        {through ? <p className="-mt-1 text-[12px] tabular-nums text-muted-foreground" data-watermark="true">Google data through {through}.</p> : null}
        {queue}
      </Lane>

      <Lane title="Measuring and results" blurb="Changes you have already made. Each page is read against how it did before and against similar pages that were not changed.">
        {view.countsUnavailable || !ledgerRead ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            What is measuring could not be read just now, so no count is shown that cannot be stood behind. Retrying automatically.
          </p>
        ) : measuring.length === 0 && results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            Nothing is measuring yet. Make the top edit above on your site, mark it done, and that page starts being read.
          </p>
        ) : (
          <ul className="space-y-2">
            {[...shownMeasuring.map((r) => ({ r, state: "measuring" as const })), ...shownResults.map((r) => ({ r, state: "result" as const }))]
              .map(({ r, state }) => (
                /* ONE LINE, AND IT ANSWERS WHEN. What changed, the day it was made, and where the reading has got to.
                   Every part truncates, so a stored paragraph can never turn one row into three. */
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-raised px-4 py-3" data-ledger-row={state}>
                  <span className="max-w-full shrink-0 truncate text-[13px] font-semibold text-foreground">{prettyPage(r.page || r.path)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={changeLabel(r)}>{changeLabel(r)}</span>
                  <span className="shrink-0 truncate text-[12px] tabular-nums text-muted-foreground">
                    {dayLabel(r.implementedAt ?? r.shippedAt) ?? "date not recorded"} ·{" "}
                    {state === "measuring"
                      ? readProgress(r)
                      : r.verdict === "won"
                        ? "it worked"
                        : "what it taught"}
                    {state === "result" && r.windows ? ((p) => (p ? <> · {p}</> : null))(ledgerProofLine({ windows: r.windows })) : null}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {ledgerRead && measuring.length + results.length > 0 ? (
          <Link href="/results" data-lane-more="ledger" className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
            {ledgerMore > 0 ? `See the other ${num(ledgerMore)} on Results` : "See what every change earned"} &rarr;
          </Link>
        ) : null}
      </Lane>

      {/* THE BACKGROUND, CLOSED. It is true, it is mine, and it is not his work: one line per row, no bullets,
          no per-row repetition of a sentence that is the same on every one of them. */}
      <details id="researching" className="rounded-2xl border border-border bg-surface-inset/40 px-4 py-3" data-backstage="true">
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
          Work happening behind the scenes
          {backstage ? ` (${num(backstage.topics)} ${plural(backstage.topics, "topic", "topics")}, ${num(backstage.pages)} ${plural(backstage.pages, "page", "pages")})` : ""}
        </summary>
        <div className="mt-3 space-y-4">
          {/* A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING OPEN. The two lists below come off that
              read; the ideas I set aside and the ones waiting on a measured page come off the release, so they
              are still said. */}
          {evidenceRead === false ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Your Google search data could not be read just now, so no empty list is shown. Nothing here has been dropped, and Beacon is checking again automatically.
            </p>
          ) : (
              <div className="space-y-1" data-backstage-topics="true">
                {shownResearch.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No topic is open right now. The next daily round opens the strongest one it finds and it lands here.</p>
                ) : (
                  <>
                    {oneNext ? <p className="text-[12px] text-muted-foreground" data-lane-note="true">Next on every one of these: {oneNext}.</p> : null}
                    <ul className="space-y-1">
                      {shownResearch.map((inv) => (
                        <li key={inv.key} className="text-[13px] leading-relaxed text-muted-foreground tabular-nums" data-researching-card="true">
                          <span className="font-semibold text-foreground">{inv.label}</span> · {signalOf(inv)}
                          {oneNext ? "" : ` · next: ${nextOf(inv)}`}
                        </li>
                      ))}
                    </ul>
                    {ranked.length > shownResearch.length ? (
                      <p className="text-[12px] tabular-nums text-muted-foreground">
                        {num(ranked.length - shownResearch.length)} more {plural(ranked.length - shownResearch.length, "topic is", "topics are")} open under these, and they are worked in this order.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
          )}

          <ul className="space-y-1" data-backstage-pages="true">
            {(evidenceRead === false ? [] : shownWatch).map((d) => {
                  const path = pathOf(d.page);
                  const rank = queued.get(path) ?? null;
                  const note = rank != null
                    ? `its fix is #${rank} in the list above`
                    : judged.get(prettyPage(d.page)) ?? judged.get(d.page) ?? "its results page is read next";
                  return (
                    <li key={d.page} className="text-[13px] leading-relaxed text-muted-foreground tabular-nums" data-watching-row="true">
                      <span className="font-semibold text-foreground">{prettyPage(d.page)}</span> · lost {num(d.lost)} {plural(d.lost, "click", "clicks")} in 4 weeks · {note}
                    </li>
                  );
                })}
                {heldForMeasurement > 0 ? (
                  <li className="text-[13px] leading-relaxed text-muted-foreground" data-watching-row="true">
                    {num(heldForMeasurement)} new {plural(heldForMeasurement, "idea waits", "ideas wait")} on {plural(heldForMeasurement, "a page", "pages")} that already {plural(heldForMeasurement, "carries", "carry")} a change under measurement.
                  </li>
                ) : null}
                {setAside > 0 ? (
                  <li className="text-[13px] leading-relaxed text-muted-foreground" data-watching-row="true">{setAsideClause(setAside)}</li>
                ) : null}
                {evidenceRead !== false && declining.length === 0 && setAside === 0 && heldForMeasurement === 0 ? (
                  <li className="text-[13px] leading-relaxed text-muted-foreground">No page of yours is losing clicks against the four weeks before.</li>
                ) : null}
                {evidenceRead !== false && watchMore > 0 ? (
                  <li className="text-[12px] tabular-nums text-muted-foreground" data-lane-more="watching">
                    {num(watchMore)} more {plural(watchMore, "page is", "pages are")} down by less than these, and every one is watched.
                  </li>
                ) : null}
          </ul>
        </div>
      </details>
    </div>
  );
}
