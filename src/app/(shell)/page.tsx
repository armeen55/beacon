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
  const parts = (text ?? "").split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
  return parts.find((s) => /\d/.test(s)) ?? parts[0] ?? null;
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
  const lift = newest ? Math.round(provenLift(newest) ?? 0) : null;
  if (!newest || lift == null || lift <= 0) return null;
  const page = (newest.page || newest.path).replace(/^https?:\/\/[^/]+/, "") || "/";
  return `Your last change to ${page} earned ${lift.toLocaleString()} more ${lift === 1 ? "click" : "clicks"} than the pages that were not changed.`;
}

/** THE WEEK IN ONE LINE, off the SAME ledger Today already holds: what was made, what is being read, and what
 *  the settled ones earned. Null when nothing landed in seven days, and the clicks clause self hides when no
 *  settled read carries a proven lift, so this never prints a number it cannot show. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function weekDigest(rows: Awaited<ReturnType<typeof loadProofLedgerCached>>, nowMs: number): string | null {
  const made = rows.filter((r) => Date.parse(r.implementedAt ?? r.shippedAt) >= nowMs - WEEK_MS).length;
  if (made === 0) return null;
  const b = splitLedgerLifecycle(rows, new Date(nowMs));
  const lift = b.won.reduce((sum, r) => sum + Math.max(0, Math.round(provenLift(r) ?? 0)), 0);
  const head = `This week: ${made} ${made === 1 ? "edit" : "edits"} made, ${b.measuring.length + b.promising.length} measuring`;
  return lift > 0 ? `${head}, the finished ones added +${lift.toLocaleString()} clicks.` : `${head}.`;
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
  // TWO READS, and both are about HIS site: how many sources I can refresh, and the settled wins I can prove.
  const [connectedSourceCount, ledgerRows] = await Promise.all([
    valueWithDeadline(countConnectedDataSources(tenantId).catch(() => 0), 0),
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
  const top = today.nextOpportunities[0] ?? null;
  const openTotal = (today.readyTotal ?? 0) + (today.toDoTotal ?? 0);
  const winLine = lastWinLine(ledgerRows, nowMs);
  const digest = weekDigest(ledgerRows, nowMs);

  return (
    <div className="space-y-6">
      <PageHeader title={greeting} description={`${dayLine}. ${today.headerSentence}`}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>

      {/* THE EDIT ITSELF, above everything. The page, the exact thing to change, the number that says why, and one link that opens it. */}
      {top ? (
        <div className="rounded-2xl border border-accent-primary/50 bg-surface-raised p-5" data-top-edit="true">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Do this first</p>
          <p className="mt-1 text-[15px] font-semibold text-foreground">{top.pageLabel}</p>
          <p className="mt-1 text-[14px] font-semibold leading-relaxed text-foreground">{top.recommendation}</p>
          {reasonLine(top.problem) ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground" data-top-edit-reason="true">{reasonLine(top.problem)}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href={`/changes/${encodeURIComponent(top.changeId)}`}
              className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white">
              Make this change
            </Link>
            {openTotal > 1 ? (
              <Link href="/changes" className="text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
                See the other {(openTotal - 1).toLocaleString()} {openTotal - 1 === 1 ? "edit" : "edits"}
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-5 text-[13px] leading-relaxed text-muted-foreground">
          No edit is ready for you right now. <Link href="/changes" className="underline underline-offset-2">Open Changes</Link> to see what is in progress for your pages.
        </p>
      )}

      {/* The scoreboard chart: the ONE place a clicks delta is stated, in its own week-over-week window. */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-border bg-surface-inset" />}>
        <ScoreboardSection tenantId={tenantId} />
      </Suspense>

      {digest ? (
        <p className="text-[13px] leading-relaxed tabular-nums text-muted-foreground" data-week-digest="true">{digest}</p>
      ) : null}

      {/* THE PROOF, in one line: the last change of yours I measured and what it beat. */}
      {winLine ? (
        <p className="text-[13px] leading-relaxed text-foreground" data-last-win="true">
          {winLine}{" "}
          <Link href="/results" className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">See what every change earned</Link>
        </p>
      ) : null}
    </div>
  );
}
