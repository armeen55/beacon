/**
 * OpsPipelineSection (2026-07-02, master plan item 10; extended 2026-07-03,
 * BEACON_500 T0c) - THE one machinery alert at the top of Today. Two watchdogs
 * share this single home so a broken pipe and a stalled scheduler can never
 * render as two competing red boxes:
 *
 *   1. Pipeline invariants (item 10): the latest persisted stage check - a
 *      connected source that wrote 0 rows, a stale sync, a plan with no
 *      candidates. Renders up to 2 red items naming the exact broken stage.
 *   2. The operational deadman (T0c): the cron_runs receipts vs the schedule
 *      map. When a scheduled job is stalled (or the site itself did not answer
 *      the last two background probes), its plain sentence joins this same block
 *      as one more line - never a second widget.
 *
 * Sibling pattern (CoverageMapSection): server component, $0 persisted reads
 * (deadline-bound), self-hides when everything is healthy, fail-soft to null,
 * dark-mode + 375px safe (flex-wrap, break-words, tabular-nums).
 */
import Link from "next/link";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { loadDeadmanVerdict } from "@/domains/ops/deadman-view";
import { loadErrorSpikeLine } from "@/domains/ops/error-spike";
import type { PipelineViolation } from "@/domains/ops/pipeline-invariants";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { recoveryForCronFailure, recoveryForSiteDown } from "@/domains/ops/recovery-actions";
import type { JobPace } from "@/domains/ops/deadman";
import { deriveDefectSignal } from "@/domains/ops/defect-signal";

const MAX_SHOWN = 2;

/** FP1 convention - a wedged receipts read may cost at most this before the
 *  alert silently skips the deadman line (the pipeline half still renders).
 *  Exported (P2-a, 2026-07-10) so page.tsx's Today command can read the SAME
 *  deadman/error-spike signals this banner's red condition uses - see the
 *  comment on page.tsx's pipelineAlarms for why they must agree. */
export const DEADMAN_DEADLINE_MS = 3500;

function ViolationRow({ violation }: { violation: PipelineViolation }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/40">
      <p className="min-w-0 break-words text-[13px] leading-relaxed text-red-900 dark:text-red-200 tabular-nums">
        {violation.sentence}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-red-700/80 dark:text-red-300/70 tabular-nums">
        <span>expected {violation.expected}</span>
        <span>got {violation.actual}</span>
      </p>
    </div>
  );
}

/** I-60 (operator spec 2026-07-09) - the AMBER staleness row. Token-only styling
 *  (design-system ratchet: no new raw palette classes); the status-warning tokens
 *  carry their own dark-mode values. Staleness is honest but NOT a red break, so it
 *  lives in a separate amber box away from the "needs attention" banner. */
function WarnRow({ violation }: { violation: PipelineViolation }) {
  return (
    <div
      className="rounded-lg border border-status-warning/40 bg-status-warning-bg px-3 py-2"
      data-staleness-warn-row="true"
    >
      <p className="min-w-0 break-words text-[13px] leading-relaxed text-status-warning tabular-nums">
        {violation.sentence}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-status-warning/80 tabular-nums">
        <span>expected {violation.expected}</span>
        <span>got {violation.actual}</span>
      </p>
    </div>
  );
}

/** T0c - token-only styling (design-system ratchet: no new raw palette
 *  classes); the status-danger tokens carry their own dark-mode values.
 *
 * T0b (2026-07-03): `fix` is the exact-recovery sentence from the SAME
 * shared map (recovery-actions.ts) the Connections page cards and the cron
 * health panel read, so this "Start with..." line can never disagree with
 * what those surfaces say about the same broken thing. */
function DeadmanRow({ sentence, fix }: { sentence: string; fix?: string }) {
  return (
    <div
      className="rounded-lg border border-status-danger/40 bg-status-danger-bg px-3 py-2"
      data-deadman-line="true"
    >
      <p className="min-w-0 break-words text-[13px] leading-relaxed text-status-danger tabular-nums">
        {sentence}
      </p>
      {fix ? (
        <p className="mt-1 min-w-0 break-words text-[12px] leading-relaxed text-status-danger/80" data-deadman-fix="true">
          <span className="font-semibold">Start with:</span> {fix}
        </p>
      ) : null}
    </div>
  );
}

/** Match a deadman sentence back to the job that produced it (deadman.ts
 *  composes `sentences` by flattening `jobs`), so the recovery map can be
 *  looked up by job + pace instead of re-parsing plain-English text. */
function jobForSentence(jobs: readonly JobPace[], sentence: string): JobPace | null {
  return jobs.find((j) => j.sentence === sentence) ?? null;
}

export async function OpsPipelineSection({ tenantId }: { tenantId: string }) {
  try {
    const [health, deadman, errorSpike] = await Promise.all([
      readPipelineHealth(tenantId).catch(() => null),
      valueWithDeadline(
        loadDeadmanVerdict(tenantId).catch(() => null),
        null,
        DEADMAN_DEADLINE_MS,
      ),
      // N39 error spine: ONE honest line when things kept failing in the last
      // 24h (>= 10 failures). Same one-widget rule as the deadman: it joins
      // THIS block, never a second red box. Self-hides (null) otherwise.
      valueWithDeadline(
        loadErrorSpikeLine(tenantId).catch(() => null),
        null,
        DEADMAN_DEADLINE_MS,
      ),
    ]);
    // I-60 alert taxonomy (operator spec 2026-07-09). Three tiers:
    //  - ALARM (default) drives the red "needs attention" banner: a genuinely broken
    //    pipe (GSC auth/never-synced, demand-spine 0 rows, no plan candidates, no moves).
    //  - WARN is STALENESS: rendered in a SEPARATE amber box ("Some data is getting
    //    stale"), never red. A stale or never-synced optional source is honest, not urgent.
    //  - INFO (a connected source that synced fine but is simply quiet, e.g. a dormant/
    //    dead AI feed) is never surfaced on Today.
    // P2-a (2026-07-10, visual audit) - alarmViolations/redFires now come from the SHARED
    // deriveDefectSignal (domains/ops/defect-signal.ts), the exact same pure read page.tsx's
    // Today command uses to build its fix_defect gate, so the two can never disagree again.
    const { alarmViolations, warnViolations, redFires, deadmanSentences } = deriveDefectSignal({
      violations: health?.violations ?? [],
      deadman,
      errorSpikeLine: errorSpike,
    });
    const pipelineFires = alarmViolations.length > 0;
    const warnFires = warnViolations.length > 0;
    const deadmanFires = deadmanSentences.length > 0;
    const spikeFires = errorSpike != null;
    if (!pipelineFires && !warnFires && !deadmanFires && !spikeFires) return null;

    const shown = pipelineFires ? alarmViolations.slice(0, MAX_SHOWN) : [];
    const hidden = alarmViolations.length - shown.length;
    const shownWarn = warnViolations.slice(0, MAX_SHOWN);
    const hiddenWarn = warnViolations.length - shownWarn.length;
    const checkedDate = health ? new Date(health.checked_at) : null;
    const checkedLabel =
      checkedDate && Number.isFinite(checkedDate.getTime())
        ? checkedDate.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
          })
        : null;

    // One heading for the one home: the pipe wording when stage checks fired,
    // the plainer machinery wording when the deadman is alarming, and the
    // failure-count wording when only the error spike fired.
    const heading = pipelineFires
      ? "Your data pipe needs attention"
      : deadmanFires
        ? "My background work needs attention"
        : "Some of my background work kept failing";

    return (
      <section aria-label="Data pipe check" className="space-y-3" data-machinery-alert="true">
        {redFires ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">{heading}</h2>
              {pipelineFires && checkedLabel ? (
                <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">I checked {checkedLabel}</span>
              ) : null}
            </div>
            {shown.map((v) => (
              <ViolationRow key={v.stage} violation={v} />
            ))}
            {hidden > 0 ? (
              <p className="text-[11px] text-red-700/80 dark:text-red-300/70">
                {hidden} more stage{hidden === 1 ? " is" : "s are"} broken too. Fixing the ones above usually clears the rest.
              </p>
            ) : null}
            {deadmanFires
              ? deadmanSentences.map((s) => {
                  // Site-down sentence is exactly deadman.siteSentence; every other
                  // sentence traces back to one job in deadman.jobs (or is the
                  // trailing "N other jobs are stalled too" summary line, which
                  // names no single job and gets no fix line of its own).
                  const fix =
                    s === deadman?.siteSentence
                      ? recoveryForSiteDown().exactFix
                      : (() => {
                          const job = jobForSentence(deadman?.jobs ?? [], s);
                          if (job == null || job.pace === "healthy" || job.pace === "waiting") return undefined;
                          return recoveryForCronFailure(job.job, job.label, job.pace).exactFix;
                        })();
                  return <DeadmanRow key={s} sentence={s} fix={fix} />;
                })
              : null}
            {errorSpike ? (
              <div
                className="rounded-lg border border-status-warning/40 bg-status-warning-bg px-3 py-2"
                data-error-spike="true"
              >
                <p className="min-w-0 break-words text-[13px] leading-relaxed text-status-warning tabular-nums">
                  {errorSpike}{" "}
                  <Link
                    href="/diagnostics/errors"
                    className="underline underline-offset-2 hover:opacity-80"
                  >
                    See what failed
                  </Link>
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        {/* I-60: STALENESS is amber, in its own box, separate from the red banner
            above. Renders on its own even when nothing red is firing. */}
        {warnFires ? (
          <div className="space-y-1.5" data-staleness-warn="true">
            <h2 className="text-sm font-semibold text-status-warning">Some data is getting stale</h2>
            {shownWarn.map((v) => (
              <WarnRow key={v.stage} violation={v} />
            ))}
            {hiddenWarn > 0 ? (
              <p className="text-[11px] text-status-warning/80">
                {hiddenWarn} more source{hiddenWarn === 1 ? " is" : "s are"} getting stale too.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-[11px] text-gray-500 dark:text-neutral-400">
          I recheck this automatically while you use Beacon. Connections live in{" "}
          <Link href="/settings/connectors" className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-neutral-200">Settings, Connections</Link>.
        </p>
      </section>
    );
  } catch {
    return null;
  }
}
