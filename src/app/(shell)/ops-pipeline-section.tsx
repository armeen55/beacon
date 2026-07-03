/**
 * OpsPipelineSection (2026-07-02, master plan item 10; extended 2026-07-03,
 * BEACON_500 T0c) - THE one machinery alert at the top of Today. Two watchdogs
 * share this single home so a broken pipe and a stalled scheduler can never
 * render as two competing red boxes:
 *
 *   1. Pipeline invariants (item 10): last night's persisted stage check - a
 *      connected source that wrote 0 rows, a stale sync, a plan with no
 *      candidates. Renders up to 2 red items naming the exact broken stage.
 *   2. The operational deadman (T0c): the cron_runs receipts vs the schedule
 *      map. When a scheduled job is stalled (or the site itself did not answer
 *      the last two nightly probes), its plain sentence joins this same block
 *      as one more line - never a second widget.
 *
 * Sibling pattern (CoverageMapSection): server component, $0 persisted reads
 * (deadline-bound), self-hides when everything is healthy, fail-soft to null,
 * dark-mode + 375px safe (flex-wrap, break-words, tabular-nums).
 */
import Link from "next/link";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { loadDeadmanVerdict } from "@/domains/ops/deadman-view";
import type { PipelineViolation } from "@/domains/ops/pipeline-invariants";
import { valueWithDeadline } from "@/lib/load-with-deadline";

const MAX_SHOWN = 2;

/** FP1 convention - a wedged receipts read may cost at most this before the
 *  alert silently skips the deadman line (the pipeline half still renders). */
const DEADMAN_DEADLINE_MS = 3500;

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

/** T0c - token-only styling (design-system ratchet: no new raw palette
 *  classes); the status-danger tokens carry their own dark-mode values. */
function DeadmanRow({ sentence }: { sentence: string }) {
  return (
    <div
      className="rounded-lg border border-status-danger/40 bg-status-danger-bg px-3 py-2"
      data-deadman-line="true"
    >
      <p className="min-w-0 break-words text-[13px] leading-relaxed text-status-danger tabular-nums">
        {sentence}
      </p>
    </div>
  );
}

export async function OpsPipelineSection({ tenantId }: { tenantId: string }) {
  try {
    const [health, deadman] = await Promise.all([
      readPipelineHealth(tenantId).catch(() => null),
      valueWithDeadline(
        loadDeadmanVerdict(tenantId).catch(() => null),
        null,
        DEADMAN_DEADLINE_MS,
      ),
    ]);
    const violations = health?.violations ?? [];
    const pipelineFires = violations.length > 0;
    const deadmanFires = deadman != null && deadman.alarm && deadman.sentences.length > 0;
    if (!pipelineFires && !deadmanFires) return null;

    const shown = pipelineFires ? violations.slice(0, MAX_SHOWN) : [];
    const hidden = violations.length - shown.length;
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
    // the plainer machinery wording when only the deadman is alarming.
    const heading = pipelineFires
      ? "Your data pipe needs attention"
      : "My overnight work is not running";

    return (
      <section aria-label="Data pipe check" className="space-y-1.5" data-machinery-alert="true">
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
          ? deadman.sentences.map((s) => <DeadmanRow key={s} sentence={s} />)
          : null}
        <p className="text-[11px] text-gray-500 dark:text-neutral-400">
          I recheck this after every nightly sync. Connections live in{" "}
          <Link href="/settings/connectors" className="underline underline-offset-2 hover:text-gray-700 dark:hover:text-neutral-200">Settings, Connections</Link>.
        </p>
      </section>
    );
  } catch {
    return null;
  }
}
