export const dynamic = "force-dynamic";
// No page-level maxDuration override: this route INHERITS the (shell) layout's 300s ceiling. A 60s page cap used to kill the lambda before the layout's post-response autonomous cycle (AUTONOMOUS_RUN_DEADLINE_MS = 210s) could write its terminal receipt, leaving the status UI stuck on "working" forever. The 300s ceiling also covers this route's long "Update data" Server Action (refreshAllConnectedDataNow), which pulls every connected source and warms the shared surfaces: it has more headroom now, not less.

import { Suspense } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { countConnectedDataSources } from "@/components/today/data-sources-strip";
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { loadTodayV2GateData } from "./today-gate-data";
import { loadTodayView } from "./today-view-data";
import { currentTenantId } from "@/lib/tenant-context";
import { requireReadyAccount } from "@/domains/account";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/measurement";
import { splitLedgerLifecycle } from "@/domains/decision";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { CopyButton } from "./changes/change-controls";

/** Today `/` - WORK, NOT A STATUS REPORT (2026-08-11). The operator has made zero changes because this screen narrated what Beacon was
 *  doing instead of handing him one edit. It is now exactly five things: the greeting with how many edits are open, THE TOP EDIT ITSELF
 *  with the number behind it and one link that opens it, the clicks scoreboard, the last change that provably won, and the one refresh
 *  control. Everything about passes, readings, topics collected and evidence held is gone from here; Changes owns what is not yet an edit. */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const notice = (await searchParams).notice;
  // The ONE lifecycle gate: pending resumes onboarding, a failed read renders the
  // bounded retry boundary, and a paused or cancelled account gets one honest
  // notice here instead of a silently normal dashboard.
  const { access } = await requireReadyAccount(await currentTenantId());
  if (access.kind === "suspended") {
    return (
      <div className="max-w-3xl rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <p className="text-[13px] font-semibold text-foreground">
          {access.reason === "paused"
            ? "Your account is paused, so no research or drafting is running right now."
            : "This account is closed, so no research or drafting is running."}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Reply to your welcome email to {access.reason === "paused" ? "turn it back on" : "get help from there"}.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <AlreadyLaunchedNotice notice={notice} />
      <Suspense fallback={<CockpitSkeleton />}>
        <Cockpit />
      </Suspense>
    </div>
  );
}

function AlreadyLaunchedNotice({ notice }: { notice: string | string[] | undefined }) {
  if (notice !== "already_launched") return null;
  return (
    <div className="mb-6 rounded-md border border-border/60 bg-surface-inset/40 px-4 py-3 text-[13px]">
      <p className="font-medium text-foreground">You&apos;ve already finished setup. Here&apos;s your workspace.</p>
      <p className="mt-1 text-muted-foreground">
        Setup is a one-time step. To change your business details, service area, or competitors, head to{" "}
        <Link href="/settings/config" className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Settings</Link>.
      </p>
    </div>
  );
}

function CockpitSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading today">
      <div className="space-y-2">
        <div className="h-7 w-28 rounded-md bg-muted/40" />
        <div className="h-4 w-2/3 max-w-md rounded-md bg-muted/25" />
      </div>
      <div className="h-28 rounded-2xl border border-border bg-surface-inset" />
      <div className="grid gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-border bg-surface-inset" />)}</div>
    </div>
  );
}

async function Cockpit() {
  // Perf trace (disabled by default via BEACON_PERF_TRACE) lives in this nested async component, not the top-level page export, so the Suspense shell still streams instantly. Times the two real loaders + flushes on every exit path (demo / first-reading / error / success) via finally.
  const trace = createPerfTrace("loader:/", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/",
  });
  try {
    return await renderCockpit(trace);
  } finally {
    trace.flush();
  }
}

/** FP1 - the two hero loaders get a little more room than a section band: a timeout here replaces the whole page with the honest one-liner, so it should only fire when things are genuinely wedged, not on a cold lambda. */
const TODAY_HERO_DEADLINE_MS = 8000;

/** THE ONE SENTENCE WITH THE NUMBER IN IT. The whole reason is a paragraph on the card; Today takes the sentence carrying the figure. */
function reasonLine(text: string | undefined): string | null {
  // Rows persisted before the voice amendment still open in the first person; the stored copy refreshes on
  // its next redraft, and until then the legacy opener is cut here rather than shown.
  const cleaned = (text ?? "").replace(/^I gave this page my deepest read because\s+/i, "");
  const parts = cleaned.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
  const line = parts.find((s) => /\d/.test(s)) ?? parts[0] ?? null;
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : null;
}

/** THE LAST CHANGE THAT PROVABLY WON, in the lift the ledger already stored: the newest settled win, its page, and how far it beat the
 *  pages nobody touched. Null while nothing has settled, which is the honest answer. */
type LedgerRow = Awaited<ReturnType<typeof loadProofLedgerCached>>[number];
/** The newest settled window that actually ran against real control pages. Null when none did. */
const provenLift = (r: LedgerRow): number | null =>
  [...r.windows].filter((w) => w.ran && (w.controlsUsed ?? 0) > 0 && w.adjustedLift != null)
    .sort((a, b) => b.day - a.day)[0]?.adjustedLift ?? null;
function lastWinLine(rows: Awaited<ReturnType<typeof loadProofLedgerCached>>, nowMs: number): string | null {
  const won = splitLedgerLifecycle(rows, new Date(nowMs)).won;
  const newest = [...won].sort((a, b) => (b.implementedAt ?? b.shippedAt).localeCompare(a.implementedAt ?? a.shippedAt))[0];
  if (!newest) return null;
  // A WIN WITH NO CLICK NUMBER IS STILL A WIN. Rounding a missing lift to zero deleted the whole line, so an
  // account whose newest win was read in click rate or position was told nothing had ever worked.
  const raw = provenLift(newest);
  const lift = raw == null ? null : Math.round(raw);
  const page = (newest.page || newest.path).replace(/^https?:\/\/[^/]+/, "") || "/";
  return lift != null && lift > 0
    ? `Your last change to ${page} earned ${lift.toLocaleString("en-US")} more ${lift === 1 ? "click" : "clicks"} than the pages that were not changed.`
    : `Your last change to ${page} finished ahead of the pages that were not changed.`;
}

/** TWO BLOCKS AND THE WAY TO RESULTS, off the ledger rows Today already holds. The counts come from
 *  splitLedgerLifecycle, whose bands settle on the SAME maturity rule Results groups its rows on
 *  (results-presentation.ts isMature), so "out of 12 finished" here is the 12 Results shows. COUNTS ONLY: no
 *  clicks or impressions are summed on Today, because a sum here mixed click and rate units and printed +54
 *  then +103 across two visits, which the operator caught both times. Null when the ledger is empty.
 *  Only the first block is a week; the wins block is all time and says so on its own line. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
type WeekBlock = { label: string; value: string; sub: string; pages: string | undefined };
/** The pages behind a block, for the hover. Six paths, then how many more, so the block can be checked without leaving Today. */
function pagesHover(rows: readonly LedgerRow[]): string | undefined {
  const paths = [...new Set(rows.map((r) => (r.page || r.path).replace(/^https?:\/\/[^/]+/, "") || "/"))];
  if (paths.length === 0) return undefined;
  return paths.length > 6 ? `${paths.slice(0, 6).join("\n")}\nand ${paths.length - 6} more` : paths.join("\n");
}
function weekStrip(rows: Awaited<ReturnType<typeof loadProofLedgerCached>>, nowMs: number): { made: WeekBlock; wins: WeekBlock } | null {
  if (rows.length === 0) return null;
  const b = splitLedgerLifecycle(rows, new Date(nowMs));
  const made = rows.filter((r) => Date.parse(r.implementedAt ?? r.shippedAt) >= nowMs - WEEK_MS);
  const measuring = b.measuring.length + b.promising.length;
  const settled = b.won.length + b.learned.length;
  return {
    made: {
      label: "made", value: made.length > 0 ? `${made.length} ${made.length === 1 ? "change" : "changes"} this week` : "No changes this week",
      sub: measuring > 0 ? `${measuring} measuring now` : "nothing measuring right now",
      pages: pagesHover(made),
    },
    // ALL TIME, SAID ON THE TILE. "3 wins all time" sat beside "2 edits this week" under one week framing, so the
    // period each block answers for now rides its own sub line.
    wins: {
      label: "wins", value: settled === 0 ? "Nothing finished yet" : b.won.length === 0 ? "No win yet" : `${b.won.length} ${b.won.length === 1 ? "win" : "wins"}`,
      sub: settled === 0 ? "all time; each read closes at 28 days" : `all time, out of ${settled} finished`,
      pages: pagesHover(b.won),
    },
  };
}

async function renderCockpit(trace: ReturnType<typeof createPerfTrace>) {
  // FP1 (2026-07-02) - the gate read is deadline-bounded so the CockpitSkeleton pulse can never strand. Past the deadline, say so honestly; the abandoned loader keeps running and warms the cache for the next visit.
  const gateRaced = await trace.time("loadTodayV2GateData", () =>
    loadWithDeadline(loadTodayV2GateData(), TODAY_HERO_DEADLINE_MS),
  );
  if (gateRaced.timedOut) return <HonestDelay />;
  const gate = gateRaced.data;

  if (gate.unreadable) return <HonestDelay message="Couldn’t read your account just now. Your data is safe, and Beacon is retrying automatically." />;
  if (gate.isDemoMode) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Your site is being read, and your first edits land here on their own</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          There is nothing to press. Connecting Google Search Console is optional: it names the exact searches you already earn
          clicks on instead of estimating them.
        </p>
        <Link href="/settings/connectors" className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Connect Search Console →</Link>
      </div>
    );
  }
  let composite: Awaited<ReturnType<typeof loadTodayView>>;
  try {
    // FP1 - loadTodayView serves the SWR snapshot instantly when one exists; the deadline only bites on the cold no-snapshot compute, which keeps running in the background and persists its snapshot, so the next visit is instant.
    const viewRaced = await trace.time("loadTodayView", () =>
      loadWithDeadline(loadTodayView(), TODAY_HERO_DEADLINE_MS),
    );
    if (viewRaced.timedOut) return <HonestDelay />;
    composite = viewRaced.data;
  } catch {
    return <HonestDelay message="Couldn’t load Today just now. Your data is safe, and Beacon is retrying automatically." />;
  }
  // WAITING FOR A FIRST READING IS ONLY TRUE WHILE THERE IS NOTHING TO SHOW. An account whose research had already ranked changes was told to sit and wait beside work it could have done, because the waiting screen was decided before the release was ever read.
  if (gate.firstReading.isFirstReading && !composite.hasChanges) {
    return <FirstReadingWaiting context={gate.firstReading.context} />;
  }
  const { today } = composite;
  const tenantId = await currentTenantId();
  const nowMs = Date.now();
  // TWO READS, and both are about HIS site: how many sources can be refreshed, and the settled wins on file.
  const [connectedSourceCount, ledgerRows] = await Promise.all([
    // A failed count is UNKNOWN, never zero: defaulting to 0 showed the zero-connection copy to a fully connected account.
    valueWithDeadline(countConnectedDataSources(tenantId).catch(() => null), null),
    valueWithDeadline(
      loadProofLedgerCached(tenantId).catch(() => [] as Awaited<ReturnType<typeof loadProofLedgerCached>>),
      [],
    ),
  ]);

  const nowPacific = new Date(nowMs);
  const dayLine = nowPacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const hour = Number(nowPacific.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // THE TOP EDIT is the top of the SAME ranked queue Changes pages, so "do this first" here and "1" there are one change.
  // TODAY LEADS WITH SOMETHING THE OPERATOR CAN DO (Codex, 2026-08-23). Taking the first row meant an opportunity
  // still being researched led the page while finished work sat below it, so the product opened on its own
  // homework. Ready leads; then a draft awaiting review; research only when there is genuinely nothing else.
  const top = today.nextOpportunities.find((o) => o.lane === "ready")
    ?? today.nextOpportunities.find((o) => o.lane === "review") ?? today.nextOpportunities[0] ?? null;
  // WHAT THE TOP ITEM IS, BEFORE ANYTHING IS OFFERED ABOUT IT. Today leads with finished work whenever there is
  // any, and otherwise with the draft or the opportunity next in line: both are named for what they are, neither
  // gets the pasteable line or the "make this change" press, and neither is ever called finished.
  const lane = top?.lane ?? "ready";
  const edit = lane === "ready" ? today.topEdit ?? null : null;
  // A PLAN IS STILL READ RATHER THAN PASTED: a merge carries several moves, so it opens instead of copying.
  // Nothing unfinished reaches here at all now, so there is no "read this first" state left to render.
  const plan = !!edit && !edit.paste && !edit.after;
  // THE OTHER CHANGES ARE THE OTHER FINISHED ONES, counted from the ready lane alone: Today never counts a
  // draft or Beacon's own research as the operator's work (operator, 2026-08-21).
  const others = Math.max(0, (today.readyTotal ?? 0) - (lane === "ready" && edit ? 1 : 0));
  const winLine = lastWinLine(ledgerRows, nowMs);
  const week = weekStrip(ledgerRows, nowMs);

  return (
    <div className="space-y-6">
      <PageHeader title={greeting} description={`${dayLine}. ${today.headerSentence}`}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} researchPaused={composite.researchPaused === true} />
      </PageHeader>

      {/* THE EDIT ITSELF, above everything, AND THE ACTION LEADS. The card used to open on the paragraph arguing the change, so the
          first thing read was reasoning for a thing nobody had been told to do yet. Order now: what to change, what is there now,
          what to put there with the press that takes it, then the one number that says why, then the way in. */}
      {top ? (
        <div className={`rounded-2xl border bg-surface-raised p-5 ${lane === "ready" ? "border-accent-primary/50" : "border-border"}`} data-top-edit="true">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground" data-top-lane={lane}>
            {lane === "ready" ? "Do this first" : lane === "review" ? "Beacon is still checking this one" : "A future opportunity"}{/* OWNERSHIP SAID TRUTHFULLY (operator, 2026-08-29): a review-lane row is held by BEACON'S own unfinished step, so Today may not tell the operator a draft waits on THEM; "your decision" is reserved for genuine operator decisions */}
          </p>
          <p className="mt-1 text-[15px] font-semibold leading-relaxed text-foreground">{edit?.action ?? top.recommendation}</p>
          {edit && edit.after ? (
            <div className="mt-2 space-y-1" data-top-edit-lines="true">
              {edit.before ? (
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Now: <span className="line-through">{edit.before}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
                <p className="min-w-0 flex-1 whitespace-pre-line text-[14px] font-semibold leading-relaxed text-foreground">
                  <span className="font-normal text-muted-foreground">{edit.lead}</span>{edit.after}
                </p>
                {edit.paste ? <CopyButton text={edit.after} label="Copy" /> : null}
              </div>
              {edit.where ? (
                <p className="text-[12px] leading-relaxed text-muted-foreground" data-top-edit-where="true">Where it goes: {edit.where}</p>
              ) : null}
            </div>
          ) : edit ? (
            <p className="mt-1 text-[13px] text-muted-foreground">A plan, not a paste. Open it and read the steps before touching anything.</p>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">{top.pageLabel}</p>
          )}
          {reasonLine(top.problem) ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground" data-top-edit-reason="true">{reasonLine(top.problem)}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href={`/changes/${encodeURIComponent(top.changeId)}`}
              className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white">
              {lane === "research" ? "See what is missing" : lane === "review" ? "See where it stands" : plan ? "Open the steps" : "Make this change"}
            </Link>
            <Link href="/changes" className="text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
              {others > 0 ? `See the other ${others.toLocaleString("en-US")} finished ${others === 1 ? "change" : "changes"}` : "Open Changes"}
            </Link>
          </div>
        </div>
      ) : (
        /* ZERO FINISHED CHANGES IS AN HONEST DAY, SAID PLAINLY. The header above already carries how many opportunities
           are still being developed, so this states the fact and points at the screen that lists what has been written. */
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-5 text-[13px] leading-relaxed text-muted-foreground" data-no-finished-change="true">
          No finished change is ready today. <Link href="/changes" className="underline underline-offset-2">Open Changes</Link> to see everything that has been written for your pages.
        </p>
      )}
      {/* THE HEARTBEAT: what the last research pass did and when, off its own stored row, so "is this thing alive" is answered on the first screen without a support question. */}
      {composite.researchLiveness ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground" data-research-liveness="true">{composite.researchLiveness}</p>
      ) : null}
      {/* A SPENT MODEL BUDGET IS A FACT ABOUT THIS ACCOUNT, said in one line rather than left to look like a quiet day. SAID NO WIDER THAN IT IS PROVEN (operator, 2026-08-29): the gate this asks answers for the monthly model budget alone, so the line may not claim that search, stored evidence, cached answers or any deterministic work has stopped, because none of that is what was checked. It also states CAPABILITY, never outcome: work that costs nothing CAN continue, where "still lands here" promised an arrival that a gate, a staleness rule or a supersede can still refuse. */}
      {composite.modelBudgetSpent ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground" data-model-budget-spent="true">
          New AI writing and factual reviews are paused because this month&rsquo;s model budget is spent. Stored and no cost work can continue.
        </p>
      ) : null}
      {/* THE PAUSE SWITCH IS A FACT ABOUT THIS ACCOUNT, said where the work is with the control that turns it back on. Nothing here may promise a nightly round while it is off. */}
      {composite.researchPaused ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground" data-research-paused="true">
          Research is paused, so no new opportunity is being worked on and nothing new lands here until it is back on.{" "}
          <Link href="/settings" className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Turn research back on</Link>
        </p>
      ) : null}

      {/* The scoreboard chart: the ONE place a clicks delta is stated, in its own week-over-week window. */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-border bg-surface-inset" />}>
        <ScoreboardSection tenantId={tenantId} />
      </Suspense>

      {/* THREE BLOCKS: the edits made this week, the wins banked all time, then the way to every one of them.
          Hover a count to see the pages behind it. No clicks are summed here: the scoreboard above owns that number. */}
      {week ? (
        <div className="grid grid-cols-3 gap-2" data-week-strip="true">
          {[week.made, week.wins].map((block) => (
            <div key={block.label} title={block.pages} className="rounded-2xl border border-border bg-surface-raised px-4 py-3">
              <p className="text-[15px] font-semibold leading-snug tabular-nums tracking-tight text-foreground">{block.value}</p>
              <p className="mt-0.5 text-[12px] leading-snug tabular-nums text-muted-foreground">{block.sub}</p>
            </div>
          ))}
          <Link href="/results"
            className="group rounded-2xl border border-border bg-surface-raised px-4 py-3 transition-colors hover:border-accent-primary/50 hover:bg-accent-primary/5">
            <p className="text-[15px] font-semibold leading-snug tracking-tight text-accent-primary">
              Results has each one <span className="inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">What each change earned, page by page</p>
          </Link>
        </div>
      ) : null}

      {/* THE PROOF, in one line: the last change that settled and what it beat. */}
      {winLine ? (
        <p className="text-[13px] leading-relaxed text-foreground" data-last-win="true">
          {winLine}{" "}
          <Link href="/results" className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">See what every change earned</Link>
        </p>
      ) : null}
    </div>
  );
}
