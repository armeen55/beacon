/**
 * OpsPipelineSection (2026-07-02, master plan item 10) - the Ops attention card
 * for pipeline invariant violations. When last night's check found a broken
 * stage (a connected source that wrote 0 rows, a stale sync, a plan with no
 * candidates, a graph with no moves), this renders up to 2 red items naming the
 * exact broken stage, so downstream surfaces never quietly show nothing.
 *
 * Sibling pattern (CoverageMapSection): server component, $0 persisted read,
 * self-hides when the last check was clean or absent, fail-soft to null,
 * dark-mode + 375px safe (flex-wrap, break-words, tabular-nums).
 */
import Link from "next/link";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import type { PipelineViolation } from "@/domains/ops/pipeline-invariants";

const MAX_SHOWN = 2;

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

export async function OpsPipelineSection({ tenantId }: { tenantId: string }) {
  try {
    const health = await readPipelineHealth(tenantId);
    if (!health || health.violations.length === 0) return null;
    const shown = health.violations.slice(0, MAX_SHOWN);
    const hidden = health.violations.length - shown.length;
    const checkedDate = new Date(health.checked_at);
    const checkedLabel = Number.isFinite(checkedDate.getTime())
      ? checkedDate.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Los_Angeles",
        })
      : null;
    return (
      <section aria-label="Data pipe check" className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">Your data pipe needs attention</h2>
          {checkedLabel ? (
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
