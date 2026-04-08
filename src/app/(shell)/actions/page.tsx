import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
import {
  results,
  changelogEntries,
  opportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { candidateLinks } from "@/domains/attribution/store";
import { computeFullActionQueue } from "@/domains/actions/compute";
import {
  actionsByBucket,
  completedActions,
  summarizeQueue,
} from "@/domains/actions/selectors";
import type { ActionItem, ActionBucket } from "@/domains/actions/types";
import {
  BUCKET_LABELS,
  BUCKET_COLORS,
  BUCKET_TEXT_COLORS,
  ACTION_TYPE_LABELS,
  FOLLOW_THROUGH_LABELS,
  FOLLOW_THROUGH_COLORS,
} from "@/domains/actions/types";
import { ActionStateControls } from "@/components/data/action-controls";

function BucketSection({
  bucket,
  actions,
  showFollowThrough,
}: {
  bucket: ActionBucket;
  actions: ActionItem[];
  showFollowThrough?: boolean;
}) {
  if (actions.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3
          className={`text-[13px] font-semibold ${BUCKET_TEXT_COLORS[bucket]}`}
        >
          {BUCKET_LABELS[bucket]}
        </h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          ({actions.length})
        </span>
      </div>
      <div className="space-y-2">
        {actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            showFollowThrough={showFollowThrough}
          />
        ))}
      </div>
    </div>
  );
}

function ActionCard({
  action,
  showFollowThrough,
}: {
  action: ActionItem;
  showFollowThrough?: boolean;
}) {
  const isDone = action.status === "done";
  const isDismissed = action.status === "dismissed";

  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        isDone || isDismissed
          ? "border-border/50 bg-surface-inset opacity-75"
          : BUCKET_COLORS[action.bucket]
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${BUCKET_TEXT_COLORS[action.bucket]}`}
            >
              {ACTION_TYPE_LABELS[action.actionType]}
            </span>
            {action.confidenceBand === "high" && (
              <span className="text-[10px] text-status-success">strong evidence</span>
            )}
            {action.confidenceBand === "medium" && (
              <span className="text-[10px] text-muted-foreground">mixed signals</span>
            )}
            {action.confidenceBand === "low" && (
              <span className="text-[10px] text-muted-foreground/60">thin evidence</span>
            )}
            {action.stalenessBand === "stale" && (
              <span className="text-[10px] text-status-danger">stale — refresh inputs</span>
            )}
            {action.stalenessBand === "aging" && (
              <span className="text-[10px] text-status-warning">getting old</span>
            )}
            {isDone && (
              <span className="text-[10px] font-medium text-status-success">
                Done
              </span>
            )}
            {isDismissed && (
              <span className="text-[10px] font-medium text-muted-foreground">
                Dismissed
              </span>
            )}
          </div>
          <p className="text-[13px] font-medium">{action.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {action.whyNow}
          </p>

          {/* Pattern context */}
          {action.patternId && action.patternLabel && (
            <div className="mt-2 rounded border border-accent-primary/20 bg-accent-primary/5 px-3 py-2">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-primary">
                  Pattern
                </span>
                <span className="font-medium">{action.patternLabel}</span>
                {action.patternSuccessRate !== null && (
                  <span className="text-muted-foreground">
                    worked {action.patternSuccessRate}% of the time
                  </span>
                )}
              </div>
              {action.similarContexts.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Untapped: {action.similarContexts.slice(0, 3).join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Detail strip */}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
            <span>
              Scope: {action.recommendedScope.length > 60
                ? action.recommendedScope.slice(0, 60) + "…"
                : action.recommendedScope}
            </span>
            {action.blockingIssue && (
              <span className="text-status-danger">
                Blocked: {action.blockingIssue.slice(0, 50)}…
              </span>
            )}
          </div>

          {/* Expected outcome + resolution criteria */}
          <div className="mt-2 space-y-1 text-[11px]">
            <div>
              <span className="text-muted-foreground">Expected: </span>
              <span>{action.expectedOutcome}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Done when: </span>
              <span>{action.resolutionCriteria}</span>
            </div>
          </div>

          {/* Follow-through for completed actions */}
          {showFollowThrough && action.followThrough && (
            <div className="mt-2">
              <span className="text-[11px] text-muted-foreground">
                Follow-through:{" "}
              </span>
              <span
                className={`text-[11px] font-medium ${FOLLOW_THROUGH_COLORS[action.followThrough]}`}
              >
                {FOLLOW_THROUGH_LABELS[action.followThrough]}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ActionStateControls
            actionId={action.id}
            currentState={action.status}
          />
          <Link
            href={`/review?cluster=${encodeURIComponent(action.clusterId)}`}
            className="text-[11px] text-muted-foreground hover:text-accent-primary hover:underline"
          >
            Cluster →
          </Link>
          {(action.bucket === "do_now" ||
            action.bucket === "do_this_week" ||
            action.bucket === "system_fix") && (
            <Link
              href="/briefs/proposed"
              className="text-[11px] text-muted-foreground hover:text-accent-primary hover:underline"
            >
              Brief →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActionsPage() {
  if (!hasActiveExperiment()) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h2 className="text-[16px] font-semibold mb-2">
          No active experiment
        </h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          Import a Ritz workbook to start an experiment. The Action Queue
          populates automatically from outcome events and cluster analysis.
        </p>
        <Link
          href="/import"
          className="text-[12px] text-accent-primary hover:underline font-medium"
        >
          Go to Import
        </Link>
      </div>
    );
  }

  const { actions } = computeFullActionQueue(
    results,
    changelogEntries,
    opportunities,
    candidateLinks
  );

  const summary = summarizeQueue(actions);
  const active = actions.filter(
    (a) => a.status !== "done" && a.status !== "dismissed"
  );
  const done = completedActions(actions);
  const dismissed = actions.filter((a) => a.status === "dismissed");

  const doNow = actionsByBucket(active, "do_now");
  const doThisWeek = actionsByBucket(active, "do_this_week");
  const systemFix = actionsByBucket(active, "system_fix");
  const monitor = actionsByBucket(active, "monitor");
  const deprioritized = actionsByBucket(active, "deprioritized");

  return (
    <div>
      <PageHeader
        title="What to do next"
        description="Suggested moves based on what's working. Treat these as ideas until review confirms what actually drove the results."
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-6">
        <StatCard label="Active" value={summary.active} />
        <StatCard label="Do Now" value={summary.doNow} />
        <StatCard label="System Fix" value={summary.systemFix} />
        <StatCard label="Completed" value={summary.completed} />
        <StatCard
          label="With Follow-up"
          value={summary.evidencePositive}
        />
        <StatCard label="Total" value={summary.total} />
      </div>

      <div className="space-y-8">
        <BucketSection bucket="do_now" actions={doNow} />
        <BucketSection bucket="system_fix" actions={systemFix} />
        <BucketSection bucket="do_this_week" actions={doThisWeek} />
        <BucketSection bucket="monitor" actions={monitor} />

        {deprioritized.length > 0 && (
          <details className="group">
            <summary className="text-[12px] text-muted-foreground cursor-pointer hover:text-foreground">
              Deprioritized ({deprioritized.length})
            </summary>
            <div className="mt-3">
              <BucketSection bucket="deprioritized" actions={deprioritized} />
            </div>
          </details>
        )}

        {done.length > 0 && (
          <div className="border-t border-border pt-6">
            <h3 className="text-[13px] font-semibold mb-3">
              Completed ({done.length})
            </h3>
            <div className="space-y-2">
              {done.map((a) => (
                <ActionCard
                  key={a.id}
                  action={a}
                  showFollowThrough
                />
              ))}
            </div>
          </div>
        )}

        {dismissed.length > 0 && (
          <details className="group">
            <summary className="text-[12px] text-muted-foreground cursor-pointer hover:text-foreground">
              Dismissed ({dismissed.length})
            </summary>
            <div className="mt-3 space-y-2">
              {dismissed.map((a) => (
                <ActionCard key={a.id} action={a} />
              ))}
            </div>
          </details>
        )}

        {actions.length === 0 && (
          <div className="rounded-md border border-border p-8 text-center">
            <p className="text-[14px] font-medium mb-1">
              No actions generated
            </p>
            <p className="text-[12px] text-muted-foreground">
              Actions are derived from outcome event clusters. Import data and
              review attribution to generate the action queue.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
