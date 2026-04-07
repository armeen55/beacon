import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import { MatchFactors } from "@/components/display/match-factors";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import { CandidateReview } from "@/components/data/candidate-review";
import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { getFullChainForResult } from "@/lib/lookups";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { truthLabels } from "@/domains/attribution/store";
import {
  PLATFORM_LABELS,
  METRIC_TYPE_LABELS,
  BRIEF_TYPE_LABELS,
  SIGNAL_TYPE_LABELS,
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
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function ChainArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

export default async function ResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = results.find((r) => r.id === id);
  if (!result) notFound();

  const isInverted =
    result.metric_type === "visibility_rank" ||
    result.metric_type === "average_position";

  const chains = getFullChainForResult(result.id);
  const primaryAttribution = chains.find(
    (c) => c.attribution?.role === "primary"
  );

  const candidates = discoverCandidates(result, changelogEntries, opportunities);
  const triage = triageCandidates(candidates);
  const allTriaged = [
    ...(triage.primary ? [triage.primary] : []),
    ...triage.contributing,
    ...triage.needsReview,
    ...triage.suppressed,
  ];
  const serializedCandidates = allTriaged.map((c) => ({
    change: {
      id: c.change.id,
      asset_name: c.change.asset_name,
      signal_type: c.change.signal_type,
      timestamp: c.change.timestamp,
      topic_targeted: c.change.topic_targeted,
      change_description: c.change.change_description,
    },
    attribution: c.attribution,
    score: c.score,
    triage: c.triage,
    triageReason: c.triageReason,
  }));

  const sourceOpportunities = [
    ...new Map(
      chains
        .filter((c) => c.opportunity !== null)
        .map((c) => [c.opportunity!.id, c.opportunity!])
    ).values(),
  ];
  const sourceBriefs = [
    ...new Map(
      chains
        .filter((c) => c.brief !== null)
        .map((c) => [c.brief!.id, c.brief!])
    ).values(),
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          {METRIC_TYPE_LABELS[result.metric_type]}
        </h2>
        <div className="flex items-center gap-3 mt-2 text-[12px] text-muted-foreground">
          <span>{PLATFORM_LABELS[result.platform]}</span>
          <span className="text-border">·</span>
          <span>
            {new Date(result.snapshot_date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* Attribution summary above fold */}
      {primaryAttribution?.attribution && (
        <div className="rounded-md border border-accent-primary/20 bg-accent-primary-light px-4 py-3">
          <ConfidenceBadge
            confidence={primaryAttribution.attribution.confidence}
            explanation={primaryAttribution.attribution.explanation}
          />
          <p className="text-[13px] font-medium mt-1">
            {primaryAttribution.change.asset_name}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {SIGNAL_TYPE_LABELS[primaryAttribution.change.signal_type]}
            {primaryAttribution.attribution.within_impact_window &&
              " · Within impact window"}
          </p>
        </div>
      )}

      <div className="border-t border-border pt-5">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Current
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {result.metric_value}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Previous
            </p>
            <p className="text-2xl font-semibold tabular-nums text-muted-foreground">
              {result.previous_value ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Change
            </p>
            <DeltaIndicator
              value={result.delta_percentage}
              invertColor={isInverted}
              className="text-lg"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Topic">{result.topic ?? "—"}</Field>
          <Field label="City">{result.city ?? "—"}</Field>
          <Field label="URL Measured">
            <span className="font-mono text-[12px]">
              {result.url_measured ?? "—"}
            </span>
          </Field>
        </div>
      </div>

      {result.notes && (
        <div>
          <h3 className="text-[13px] font-semibold mb-2">Notes</h3>
          <p className="text-[13px] text-foreground-secondary">
            {result.notes}
          </p>
        </div>
      )}

      {chains.length > 0 && (
        <div className="border-t border-border pt-5 space-y-5">
          <h3 className="text-[13px] font-semibold">Attribution Chain</h3>

          <div className="space-y-6">
            {chains.map((chain, i) => (
              <div key={chain.change.id} className="space-y-1.5">
                {chains.length > 1 && (
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Path {i + 1}
                    </p>
                    {chain.attribution && (
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        · {chain.attribution.role}
                      </span>
                    )}
                  </div>
                )}

                {chain.opportunity && (
                  <>
                    <EntityLinkCard
                      type="opportunity"
                      href={`/opportunities/${chain.opportunity.id}`}
                      title={chain.opportunity.title}
                      meta={chain.opportunity.topic}
                    />
                    <ChainArrow />
                  </>
                )}

                {chain.brief && (
                  <>
                    <EntityLinkCard
                      type="brief"
                      href={`/briefs/${chain.brief.id}`}
                      title={chain.brief.title}
                      meta={BRIEF_TYPE_LABELS[chain.brief.brief_type]}
                    />
                    <ChainArrow />
                  </>
                )}

                <div className="space-y-1.5">
                  <EntityLinkCard
                    type="change"
                    href={`/changes/${chain.change.id}`}
                    title={chain.change.asset_name}
                    subtitle={chain.change.change_description}
                    meta={SIGNAL_TYPE_LABELS[chain.change.signal_type]}
                  />
                  {chain.attribution && (
                    <div className="ml-4 space-y-1">
                      <ConfidenceBadge
                        confidence={chain.attribution.confidence}
                        explanation={chain.attribution.explanation}
                      />
                      <MatchFactors matches={chain.attribution.matches} />
                    </div>
                  )}
                </div>

                <ChainArrow />

                <div className="rounded-md border-2 border-accent-primary/20 bg-accent-primary-light p-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-accent-primary">
                    This Result
                  </span>
                  <p className="text-[13px] font-medium mt-0.5">
                    {METRIC_TYPE_LABELS[result.metric_type]}
                    {result.delta_percentage != null && (
                      <span className="ml-2 inline-flex">
                        <DeltaIndicator
                          value={result.delta_percentage}
                          invertColor={isInverted}
                        />
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CandidateReview
        resultId={result.id}
        candidates={serializedCandidates}
        truthLabelMap={Object.fromEntries(
          truthLabels
            .filter((tl) => tl.result_id === result.id)
            .map((tl) => [tl.change_id, tl.relation])
        )}
      />

      {(() => {
        const nextEntry = results
          .filter((r) => r.id !== result.id)
          .map((r) => {
            const c = discoverCandidates(r, changelogEntries, opportunities);
            const t = triageCandidates(c);
            return { result: r, reviewCount: t.needsReview.length };
          })
          .filter((e) => e.reviewCount > 0)
          .sort((a, b) => b.reviewCount - a.reviewCount)[0];

        const nextResult = nextEntry?.result ?? null;
        if (!nextResult) return null;
        return (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Link
              href="/review"
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to review queue
            </Link>
            <Link
              href={`/results/${nextResult.id}`}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-primary hover:underline"
            >
              Next unreviewed result
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        );
      })()}

      {(sourceOpportunities.length > 0 || sourceBriefs.length > 0) && (
        <div className="border-t border-border pt-5 space-y-5">
          <h3 className="text-[13px] font-semibold">Connected</h3>

          {sourceOpportunities.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Source Opportunities
              </p>
              <div className="space-y-2">
                {sourceOpportunities.map((opp) => (
                  <EntityLinkCard
                    key={opp.id}
                    type="opportunity"
                    href={`/opportunities/${opp.id}`}
                    title={opp.title}
                    subtitle={opp.description ?? undefined}
                    meta={opp.topic}
                  />
                ))}
              </div>
            </div>
          )}

          {sourceBriefs.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Source Briefs
              </p>
              <div className="space-y-2">
                {sourceBriefs.map((brief) => (
                  <EntityLinkCard
                    key={brief.id}
                    type="brief"
                    href={`/briefs/${brief.id}`}
                    title={brief.title}
                    subtitle={brief.objective}
                    meta={BRIEF_TYPE_LABELS[brief.brief_type]}
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
