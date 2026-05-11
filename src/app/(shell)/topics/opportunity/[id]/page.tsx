import { notFound } from "next/navigation";
import { PriorityBadge } from "@/components/display/priority-badge";
import { ScoreRing } from "@/components/display/score-ring";
import { FreshnessDot } from "@/components/display/freshness-dot";
import { ThreatBadge } from "@/components/display/threat-badge";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import { GuidancePanel } from "@/components/data/guidance-panel";
import { CompetitiveLandscape } from "@/components/data/competitive-landscape";
import { ScoreDimensions } from "@/components/data/score-dimensions";
import { OpportunityStatusSelect } from "@/components/forms/status-select";
import { CreateBriefButton } from "@/components/forms/create-brief-sheet";
import {
  CaptureOpportunityAction,
  DeferOpportunityAction,
  CloseOpportunityAction,
} from "@/components/forms/lifecycle-actions";
import {
  getOpportunities,
  getCompetitors,
  getCompetitorSnapshots,
} from "@/lib/seed-data.server";
import {
  getBriefsForOpportunity,
  getChangesForOpportunity,
  getResultsForOpportunity,
  getRelatedOpportunities,
} from "@/lib/lookups";
import { computeOpportunityScore } from "@/domains/opportunities/scoring";
import { getFreshnessStatus } from "@/domains/opportunities/freshness";
import { getOpportunityGuidance } from "@/domains/opportunities/guidance";
import { computeCompetitiveLandscape } from "@/domains/opportunities/competitive";
import { formatPlatforms } from "@/domains/opportunities/utils";
import { computeAttribution } from "@/domains/attribution/compute";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import {
  PLATFORM_LABELS,
  METRIC_TYPE_LABELS,
  BRIEF_TYPE_LABELS,
  SIGNAL_TYPE_LABELS,
  CONFIDENCE_LEVEL_LABELS,
  OPPORTUNITY_SOURCE_LABELS,
} from "@/lib/constants";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { opportunityCompetitorBasis } from "@/domains/competitors/opportunity-basis";

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-semibold mb-3">{children}</h3>
  );
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [opportunities, competitors, competitorSnapshots] = await Promise.all([
    getOpportunities(),
    getCompetitors(),
    getCompetitorSnapshots(),
  ]);
  const opp = opportunities.find((o) => o.id === id);
  if (!opp) notFound();

  const [linkedBriefs, linkedChanges, linkedResults, relatedOpps] = await Promise.all([
    getBriefsForOpportunity(opp.id),
    getChangesForOpportunity(opp.id),
    getResultsForOpportunity(opp.id),
    getRelatedOpportunities(opp.id),
  ]);

  const score = computeOpportunityScore(opp, linkedBriefs, competitorSnapshots);
  const freshness = getFreshnessStatus(opp);
  const landscape = computeCompetitiveLandscape(opp, competitors, competitorSnapshots);
  const guidance = getOpportunityGuidance(opp, linkedBriefs, freshness, score);
  const compBasis = opportunityCompetitorBasis(
    opp,
    competitors,
    await loadCompetitorUniverseRuntime()
  );

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold tracking-tight">{opp.title}</h2>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <OpportunityStatusSelect
            opportunityId={opp.id}
            currentStatus={opp.current_status}
          />
          <PriorityBadge priority={opp.priority} />
          <span className="text-[12px] text-muted-foreground">
            {formatPlatforms(opp.platforms)}
          </span>
          <FreshnessDot
            level={freshness.level}
            daysSinceActivity={freshness.daysSinceActivity}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface-raised/25 px-3 py-2.5 text-[11px]">
        <p className="font-semibold text-foreground">{compBasis.headline}</p>
        <p className="text-muted-foreground mt-1 leading-snug">{compBasis.detail}</p>
      </div>

      {/* Score + Guidance */}
      <div className="flex gap-6 items-start">
        <ScoreRing score={score.total} label={score.label} size="lg" />
        <div className="flex-1 min-w-0">
          {guidance.length > 0 ? (
            <div>
              <SectionTitle>What Next</SectionTitle>
              <GuidancePanel items={guidance} />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground pt-4">
              No recommended actions at this time.
            </p>
          )}
        </div>
      </div>

      {opp.description && (
        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          {opp.description}
        </p>
      )}

      {/* Competitive Threat */}
      {landscape.threats.length > 0 && (
        <div className="border-t border-border pt-5">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Competitive Landscape</SectionTitle>
            <ThreatBadge level={landscape.overallThreatLevel} />
          </div>
          <CompetitiveLandscape threats={landscape.threats} />
        </div>
      )}

      {/* Score Breakdown */}
      <div className="border-t border-border pt-5">
        <SectionTitle>Score Breakdown</SectionTitle>
        <ScoreDimensions dimensions={score.dimensions} />
      </div>

      {/* Details Grid */}
      <div className="border-t border-border pt-5">
        <SectionTitle>Details</SectionTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Query">
            <p className="font-mono text-[12px] bg-surface-inset px-2.5 py-1.5 rounded-md inline-block">
              {opp.query_text}
            </p>
          </Field>
          <Field label="Topic">{opp.topic}</Field>
          <Field label="City">{opp.city ?? "—"}</Field>
          <Field label="Intent">
            <span className="capitalize">{opp.intent_type}</span>
          </Field>
          <Field label="Impact">
            <span className="capitalize">{opp.estimated_impact}</span>
          </Field>
          <Field label="Effort">
            <span className="capitalize">{opp.effort}</span>
          </Field>
          <Field label="Confidence">
            {CONFIDENCE_LEVEL_LABELS[opp.confidence]}
          </Field>
          <Field label="Source">
            {OPPORTUNITY_SOURCE_LABELS[opp.source]}
          </Field>
          <Field label="Baseline Position">
            {opp.baseline_position ?? "Not ranked"}
          </Field>
          <Field label="Target Position">
            {opp.target_position ?? "—"}
          </Field>
          {opp.target_url && (
            <Field label="Target URL">
              <span className="font-mono text-[12px]">{opp.target_url}</span>
            </Field>
          )}
          {opp.tags.length > 0 && (
            <Field label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {opp.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-surface-inset text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Field>
          )}
        </div>
      </div>

      {/* Status timeline */}
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Status</SectionTitle>
          {!["captured", "closed"].includes(opp.current_status) && (
            <div className="flex items-center gap-2">
              <CaptureOpportunityAction opportunityId={opp.id} />
              {opp.current_status !== "deferred" && (
                <DeferOpportunityAction opportunityId={opp.id} />
              )}
              <CloseOpportunityAction opportunityId={opp.id} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {[
            { label: "Identified", date: opp.identified_at },
            { label: "Activated", date: opp.activated_at },
            { label: "Captured", date: opp.captured_at },
            { label: "Deferred", date: opp.deferred_at },
            { label: "Closed", date: opp.closed_at },
            { label: "Regressed", date: opp.regressed_at },
            { label: "Last Verified", date: opp.last_verified_at },
            { label: "Last Assessed", date: opp.assessed_at },
          ]
            .filter((item) => item.date !== null)
            .map((item) => (
              <Field key={item.label} label={item.label}>
                {new Date(item.date!).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Field>
            ))}
          {opp.close_reason && (
            <Field label="Close Reason">
              <span className="capitalize">{opp.close_reason}</span>
            </Field>
          )}
          {opp.deferred_until && (
            <Field label="Deferred Until">
              {new Date(opp.deferred_until).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Field>
          )}
        </div>
      </div>

      {/* Execution (always shown, with Create Brief action) */}
      <div className="border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Execution</SectionTitle>
          <CreateBriefButton
            opportunityId={opp.id}
            defaultTitle={`Brief: ${opp.title}`}
            defaultPriority={opp.priority}
            defaultTargetUrl={opp.target_url}
            defaultCity={opp.city}
            defaultTopic={opp.topic}
          />
        </div>
        {linkedBriefs.length > 0 ? (
          <div className="space-y-2">
            {linkedBriefs.map((brief) => {
              const done = brief.checklist.filter((c) => c.status === "done").length;
              const total = brief.checklist.length;
              return (
                <EntityLinkCard
                  key={brief.id}
                  type="brief"
                  href={`/briefs/${brief.id}`}
                  title={brief.title}
                  subtitle={
                    total > 0
                      ? `${done}/${total} tasks complete`
                      : brief.objective
                  }
                  meta={BRIEF_TYPE_LABELS[brief.brief_type]}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No briefs yet. Create one to start planning execution.
          </p>
        )}
      </div>

      {/* Evidence & Results */}
      {linkedResults.length > 0 && (
        <div className="border-t border-border pt-5">
          <SectionTitle>Evidence &amp; Results</SectionTitle>
          <div className="space-y-2">
            {linkedResults.map((result) => {
              const linkedChange = linkedChanges.find((c) =>
                result.attributed_changelog_ids.includes(c.id)
              );
              const attribution = linkedChange
                ? computeAttribution(linkedChange, result, opportunities)
                : null;
              return (
                <div key={result.id} className="space-y-1">
                  <EntityLinkCard
                    type="result"
                    href={`/settings/history/${result.id}`}
                    title={METRIC_TYPE_LABELS[result.metric_type]}
                    subtitle={result.notes ?? undefined}
                    meta={PLATFORM_LABELS[result.platform]}
                  />
                  {attribution && (
                    <div className="ml-4">
                      <ConfidenceBadge
                        confidence={attribution.confidence}
                        explanation={attribution.explanation}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Changes */}
      {linkedChanges.length > 0 && (
        <div className="border-t border-border pt-5">
          <SectionTitle>Changes</SectionTitle>
          <div className="space-y-2">
            {linkedChanges.map((change) => (
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
        </div>
      )}

      {/* Related Opportunities */}
      {relatedOpps.length > 0 && (
        <div className="border-t border-border pt-5">
          <SectionTitle>Related Opportunities</SectionTitle>
          <div className="space-y-2">
            {relatedOpps.map((related) => (
              <EntityLinkCard
                key={related.id}
                type="opportunity"
                href={`/topics/opportunity/${related.id}`}
                title={related.title}
                subtitle={related.description ?? undefined}
                meta={related.topic}
              />
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {opp.notes && (
        <div className="border-t border-border pt-5">
          <SectionTitle>Notes</SectionTitle>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md p-3">
            {opp.notes}
          </p>
        </div>
      )}
    </div>
  );
}
