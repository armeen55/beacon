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
import type { ChangeProposal } from "@/domains/decision";
import { type ChangesView } from "../changes-data";
import { isWatchedDecay } from "./lane-counts";
import { pageLabel } from "./types";

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

// ── the opportunity lane, one card per ranked signal ─────────────────────────

/** ONE OPPORTUNITY THAT HAS NO FINISHED WORDS YET, SHOWN WHOLE. It was a number in a sentence until 2026-08-15
 *  ("7 opportunities are still being developed"), which is the account's own ranked research reported as
 *  weather. Every card says the page, the exact search behind it, how big the audience is, what Beacon believes
 *  is wrong, what it already holds, what is still missing and what happens next. Nothing here is offered as
 *  work: there is no copy to take and no control that records it done. */
function ResearchCard({ p }: { p: ChangeProposal }) {
  const path = p.pagePath ?? p.pageUrl ?? "";
  const owed = p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after : p.recommendedChange.proposedTitle;
  const believes = p.causeFinding?.explanation ?? p.whyItMatters;
  const next = p.researchOnly === true && (p.operatorSteps ?? []).length > 0 ? p.operatorSteps!.at(-1)! : "The exact work is not written yet. It lands on this card when it is, and nothing here is yours to do until then.";
  const held = (p.evidence?.hints ?? []).filter((h) => h.trim() && h !== believes && !owed.includes(h.trim())).slice(0, 2);
  const facts = [p.demandImpressions90d ? `${num(p.demandImpressions90d)} views in Google over 90 days` : null,
    p.impactScore ? `${num(p.impactScore)} clicks recoverable` : null].filter(Boolean);
  return (
    <li className="space-y-1.5 rounded-2xl border border-border bg-surface-raised p-4" data-research-card="true">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[14px] font-semibold text-foreground">{path ? pageLabel(path) : p.pageLabel}</span>
        {path ? <span className="text-[12px] text-muted-foreground">{prettyPage(path)}</span> : null}
      </p>
      <p className="text-[13px] font-semibold leading-relaxed text-foreground">{p.opportunityType}</p>
      <p className="text-[12px] tabular-nums text-muted-foreground">
        Searched as &ldquo;{p.primaryQuery}&rdquo;{facts.length > 0 ? ` · ${facts.join(" · ")}` : ""}
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">What the evidence says: </span>{believes}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground" data-research-owed="true"><span className="font-semibold text-foreground">Still missing: </span>{owed}</p>
      <p className="text-[12px] leading-relaxed text-muted-foreground" data-research-next="true"><span className="font-semibold text-foreground">Next: </span>{next}</p>
      {held.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-research-evidence="true">
          {held.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      ) : null}
      <Link href={`/changes/${encodeURIComponent(p.id)}`} data-research-detail="true" className="inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Open details &rarr;</Link>
    </li>
  );
}

// ── the feed ─────────────────────────────────────────────────────────────────

/** THE one Changes screen. `queue` is the ranked list (its own client component, which owns paging, set aside
 *  and mark implemented); the ledger sits under it, and the background sits in a closed drawer under that. */
export function ChangesFeed({ view, queue, decay, declineNotes, measuring, results, heldForMeasurement = 0, ledgerRead = true, evidenceRead = true, researchPaused = false, staleCounts = null }: {
  view: ChangesView;
  queue: ReactNode;
  decay: readonly DecayRow[];
  declineNotes: readonly { page: string; note: string }[];
  measuring: readonly LedgerRow[];
  results: readonly LedgerRow[];
  heldForMeasurement?: number;
  /** FALSE when the ledger behind the two lanes below could not be read. An empty list I could not fill is NOT
   *  an account with nothing measuring: printing "make your first change" to an operator holding 25 results is
   *  the worst lie this screen can tell, and the counts it cannot stand behind stay off the strip. */
  ledgerRead?: boolean;
  /** FALSE when the decay read behind the watched pages could not be read. Absence of a source is not an
   *  account with nothing open: the drawer says which of the two happened and claims no count. */
  evidenceRead?: boolean;
  /** TRUE when the account's research switch is off. Nothing on this screen may then promise a next daily round
   *  or work happening behind the scenes, because none is. */
  researchPaused?: boolean;
  /** Release-stamped open-lane counts (same arithmetic, lane-counts.ts), shown with their age ONLY when the live read failed. */
  staleCounts?: { researching: number; watching: number; ago: string | null } | null;
}) {
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
  // A live read that failed falls back to the count the release stamped, said with its age.
  const watchLabel = evidenceRead === false ? staleCounts?.watching ?? null : watchingCount;
  // THE THREE LANES ARE COUNTED ONCE, HERE, off the same release Today reads, so the two screens agree exactly.
  const research = view.research ?? [], shownResearch = research.slice(0, RESEARCH_LIMIT);

  return (
    <div className="space-y-8" data-changes-feed="true">
      {/* THE BLURB IS A PROMISE ABOUT EVERY ROW, so it says only what the completeness boundary guarantees: the exact work, in full, on every card. */}
      <Lane title="Your changes" blurb="Ranked by payoff. Every card carries the exact work to make: what to change, where, and the final wording. The chip on each one says how strong the evidence behind it is. Every change is measured after you make it.">
        {/* THE WATERMARK, ONCE. Every Google number on this screen ends on the same finalized day, so it is
            said here rather than in brackets on every row that happens to quote one. */}
        {through ? <p className="-mt-1 text-[12px] tabular-nums text-muted-foreground" data-watermark="true">Google data through {through}.</p> : null}
        {queue}
      </Lane>

      {/* THE THIRD LANE, AND IT IS A LIST OF CARDS RATHER THAN A NUMBER (operator, 2026-08-15). Genuine
          opportunities whose exact words are not written stay VISIBLE here with everything known about each
          one; what the gates decide is that none of them carries copy to take or a control that records it
          done. Nothing is hidden but a duplicate, a page mapping the evidence refuses, an idea the evidence
          contradicts and a gap too small to be worth a morning, and each of those keeps its existing exit. */}
      {research.length > 0 ? (
        <Lane title="Opportunities being researched" blurb="Real signals off your own data with no finished wording yet. Each one says what is known, what is still missing and what happens next. Nothing here is ready to make.">
          <p className="text-[14px] font-semibold tabular-nums text-foreground" data-research-count="true">
            {num(view.summary?.research ?? research.length)} {plural(view.summary?.research ?? research.length, "opportunity is", "opportunities are")} being researched
          </p>
          <ul className="list-none space-y-3">{shownResearch.map((p) => <ResearchCard key={p.id} p={p} />)}</ul>
          {research.length > shownResearch.length ? (
            <details className="rounded-xl border border-dashed border-border" data-lane-more="research">
              <summary className="cursor-pointer px-3 py-2 text-[12px] tabular-nums text-muted-foreground">Show {num(research.length - shownResearch.length)} more {plural(research.length - shownResearch.length, "opportunity", "opportunities")}, worked in this order</summary>
              <ul className="list-none space-y-3 p-3 pt-0">{research.slice(shownResearch.length).map((p) => <ResearchCard key={p.id} p={p} />)}</ul>
            </details>
          ) : null}
        </Lane>
      ) : null}

      <Lane title="Measuring and results" blurb="Changes you have already made. Each page is read against how it did before and against similar pages that were not changed.">
        {view.countsUnavailable || !ledgerRead ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            What is measuring could not be read just now, so no count is shown that cannot be stood behind. Retrying automatically.
          </p>
        ) : measuring.length === 0 && results.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-4 text-[13px] leading-relaxed text-muted-foreground">
            Nothing is measuring yet. Make the top change above on your site, mark it done, and that page starts being read.
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

      {/* THE PAGES BEING WATCHED, CLOSED. Not opportunities and not work: pages losing clicks, ideas set aside
          and ideas waiting on a page already under measurement, one line each. Every opportunity that HAS a
          card now has one, in the lane above, so the drawer that used to hide them holds only this. */}
      <details id="researching" className="rounded-2xl border border-border bg-surface-inset/40 px-4 py-3" data-backstage="true">
        {/* A PAUSED ACCOUNT HAS NOTHING HAPPENING BEHIND THE SCENES, and saying otherwise is the one claim here the operator can check and catch. */}
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
          {researchPaused ? "Pages watched while research is paused" : "Pages being watched"}
          {watchLabel == null ? "" : ` (${num(watchLabel)} ${plural(watchLabel, "page", "pages")})`}
        </summary>
        <div className="mt-3 space-y-4">
          {researchPaused ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground" data-paused-note="true">
              Research is paused, so none of this is being worked on right now. Turn it back on in Settings and the next round picks it up.
            </p>
          ) : null}
          {/* A SOURCE THAT DID NOT ANSWER IS NOT AN ACCOUNT WITH NOTHING OPEN. The list comes off that read; the
              ideas set aside and the ones waiting on a measured page come off the release, so they are still said. */}
          {evidenceRead === false ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Your Google search data could not be read just now, so no empty list is shown. Nothing here has been dropped, and Beacon is checking again automatically.
            </p>
          ) : null}
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
                  <li className="text-[13px] leading-relaxed text-muted-foreground" data-watching-row="true">{`The bar for what counts as worth your time went up, so ${num(setAside)} earlier ${plural(setAside, "idea", "ideas")} that no longer clear it went aside.`}</li>
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
