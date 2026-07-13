import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "@/components/display/priority-badge";
import { EffortBadge } from "@/components/display/effort-badge";
import { BriefVerdictBadge } from "@/components/display/brief-verdict-badge";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import { InteractiveChecklist } from "@/components/data/interactive-checklist";
import { InteractiveOutcomes } from "@/components/data/interactive-outcomes";
import { RecordResultButton } from "@/components/forms/record-result-sheet";
import { StallBanner } from "@/components/data/stall-banner";
import { BriefRetrospective } from "@/components/data/brief-retrospective";
import { BriefStatusSelect } from "@/components/forms/status-select";
import { LogChangeButton } from "@/components/forms/log-change-sheet";
import { getBriefs, getChangelogEntries } from "@/lib/seed-data.server";
import {
  getOpportunityForBrief,
  getChangesForBrief,
  getResultsForBrief,
  getBriefById,
} from "@/lib/lookups";
import { getStallStatus } from "@/domains/briefs/stall";
import { getDueDelta } from "@/domains/briefs/utils";
import { computeBriefVerdict } from "@/domains/attribution/compute";
import {
  BRIEF_TYPE_LABELS,
  PLATFORM_LABELS,
  SIGNAL_TYPE_LABELS,
  METRIC_TYPE_LABELS,
} from "@/lib/constants";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground mb-1">
        {label}
      </p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const briefs = await getBriefs();
  const brief = briefs.find((b) => b.id === id);
  if (!brief) notFound();

  const [sourceOpportunities, relatedChanges, relatedResults, relatedBriefs, changelogEntries] = await Promise.all([
    getOpportunityForBrief(brief.id),
    getChangesForBrief(brief.id),
    getResultsForBrief(brief.id),
    Promise.all(brief.related_brief_ids.map((rid) => getBriefById(rid))).then((arr) => arr.filter((b): b is NonNullable<typeof b> => b !== null)),
    getChangelogEntries(),
  ]);

  const stall = getStallStatus(brief);
  const dueDelta = getDueDelta(brief.due_date);
  const briefVerdict = computeBriefVerdict(brief);

  const changeNames: Record<string, string> = {};
  for (const item of brief.checklist) {
    if (item.linked_changelog_id) {
      const change = changelogEntries.find(
        (c) => c.id === item.linked_changelog_id,
      );
      if (change) changeNames[change.id] = change.asset_name;
    }
  }

  const primaryOpportunityId = brief.opportunity_ids[0] ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-1">
          {BRIEF_TYPE_LABELS[brief.brief_type]}
        </p>
        <h2 className="text-base font-semibold tracking-tight">
          {brief.title}
        </h2>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <BriefStatusSelect
            briefId={brief.id}
            currentStatus={brief.status}
          />
          <PriorityBadge priority={brief.priority} />
          <EffortBadge effort={brief.effort} />
          {dueDelta !== null && (
            <span
              className={cn(
                "text-[12px]",
                dueDelta < 0
                  ? "text-status-danger font-medium"
                  : dueDelta <= 3
                    ? "text-status-warning font-medium"
                    : "text-muted-foreground"
              )}
            >
              {dueDelta < 0
                ? `Overdue by ${Math.abs(dueDelta)}d`
                : dueDelta === 0
                  ? "Due today"
                  : `Due in ${dueDelta}d`}
            </span>
          )}
        </div>
      </div>

      <p className="text-[13px] text-foreground-secondary leading-relaxed">
        {brief.objective}
      </p>

      {stall.level !== "none" && <StallBanner stall={stall} />}

      {/* Field grid */}
      <div className="border-t border-border pt-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Target URL">
            <span className="font-mono text-[12px]">
              {brief.target_url ?? "—"}
            </span>
          </Field>
          <Field label="Target City">{brief.target_city ?? "—"}</Field>
          <Field label="Due Date">
            {brief.due_date ? formatDate(brief.due_date) : "—"}
          </Field>
          {brief.completed_at ? (
            <Field label="Completed">{formatDate(brief.completed_at)}</Field>
          ) : brief.started_at ? (
            <Field label="Started">{formatDate(brief.started_at)}</Field>
          ) : brief.approved_at ? (
            <Field label="Approved">{formatDate(brief.approved_at)}</Field>
          ) : (
            <Field label="Created">{formatDate(brief.created_at)}</Field>
          )}
          {brief.target_topic && (
            <Field label="Topic">{brief.target_topic}</Field>
          )}
          {brief.impact_window_ends_at && (
            <Field label="Impact Window">
              Ends {formatDate(brief.impact_window_ends_at)}
            </Field>
          )}
        </div>
      </div>

      {brief.blocked_reason && (
        <div className="rounded-md border border-status-danger/20 bg-status-danger/5 px-4 py-3">
          <p className="text-[11px] font-medium text-status-danger mb-1">
            Blocked
          </p>
          <p className="text-[13px] text-foreground-secondary">
            {brief.blocked_reason}
          </p>
        </div>
      )}

      {/* Interactive Checklist */}
      {brief.checklist.length > 0 && (
        <div className="border-t border-border pt-5">
          <InteractiveChecklist
            briefId={brief.id}
            checklist={brief.checklist}
            changeNames={changeNames}
          />
        </div>
      )}

      {/* Log Change action */}
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">Changes</h3>
          <LogChangeButton
            briefId={brief.id}
            opportunityId={primaryOpportunityId}
            defaultTopic={brief.target_topic}
            defaultCity={brief.target_city}
            defaultUrl={brief.target_url}
          />
        </div>
        {relatedChanges.length > 0 ? (
          <div className="space-y-2">
            {relatedChanges.map((change) => (
              <EntityLinkCard
                key={change.id}
                type="change"
                href={`/changes/${change.id}`}
                title={change.asset_name}
                subtitle={change.change_description}
                meta={SIGNAL_TYPE_LABELS[change.signal_type]}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No changes logged yet.
          </p>
        )}
      </div>

      {/* Results */}
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold">Results</h3>
          <RecordResultButton
            attributedChangelogIds={brief.linked_changelog_ids}
            defaultTopic={brief.target_topic}
            defaultCity={brief.target_city}
            defaultUrl={brief.target_url}
          />
        </div>
        {relatedResults.length > 0 ? (
          <div className="space-y-2">
            {relatedResults.map((result) => (
              <EntityLinkCard
                key={result.id}
                type="result"
                href={`/settings/history/${result.id}`}
                title={METRIC_TYPE_LABELS[result.metric_type]}
                subtitle={result.notes ?? undefined}
                meta={PLATFORM_LABELS[result.platform]}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No results recorded yet.
          </p>
        )}
      </div>

      {/* Prediction Accuracy */}
      {brief.expected_outcomes.length > 0 && (
        <div className="border-t border-border pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold">Prediction Accuracy</h3>
            <BriefVerdictBadge verdict={briefVerdict.verdict} />
          </div>
          <p className="text-[12px] text-muted-foreground mb-4">
            {briefVerdict.summary}
          </p>
          <InteractiveOutcomes
            briefId={brief.id}
            outcomes={brief.expected_outcomes}
          />
        </div>
      )}

      {/* Retrospective */}
      {brief.retrospective && (
        <div className="border-t border-border pt-5">
          <BriefRetrospective
            retro={brief.retrospective}
            plannedEffort={brief.effort}
          />
        </div>
      )}

      {/* Connected (remaining connections) */}
      {(sourceOpportunities.length > 0 ||
        relatedResults.length > 0 ||
        relatedBriefs.length > 0) && (
        <div className="border-t border-border pt-5 space-y-5">
          <h3 className="text-[13px] font-semibold">Connected</h3>

          {sourceOpportunities.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                Source Opportunities
              </p>
              <div className="space-y-2">
                {sourceOpportunities.map((opp) => (
                  <EntityLinkCard
                    key={opp.id}
                    type="opportunity"
                    href={`/topics/opportunity/${opp.id}`}
                    title={opp.title}
                    subtitle={opp.description ?? undefined}
                    meta={opp.topic}
                  />
                ))}
              </div>
            </div>
          )}

          {relatedResults.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                Results
              </p>
              <div className="space-y-2">
                {relatedResults.map((result) => (
                  <EntityLinkCard
                    key={result.id}
                    type="result"
                    href={`/settings/history/${result.id}`}
                    title={METRIC_TYPE_LABELS[result.metric_type]}
                    subtitle={result.notes ?? undefined}
                    meta={PLATFORM_LABELS[result.platform]}
                  />
                ))}
              </div>
            </div>
          )}

          {relatedBriefs.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                Related Briefs
              </p>
              <div className="space-y-2">
                {relatedBriefs.map((rb) => (
                  <EntityLinkCard
                    key={rb.id}
                    type="brief"
                    href={`/briefs/${rb.id}`}
                    title={rb.title}
                    subtitle={rb.objective}
                    meta={BRIEF_TYPE_LABELS[rb.brief_type]}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
