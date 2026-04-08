import Link from "next/link";
import { notFound } from "next/navigation";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import { AttributionCard } from "@/components/data/attribution-card";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { RecordResultButton } from "@/components/forms/record-result-sheet";
import { changelogEntries, results } from "@/lib/seed-data.server";
import {
  getBriefForChange,
  getOpportunityForChange,
  getChangeVerdictData,
} from "@/lib/lookups";
import { computeAttribution } from "@/domains/attribution/compute";
import { opportunities } from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import {
  SIGNAL_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  BRIEF_TYPE_LABELS,
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

export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = changelogEntries.find((c) => c.id === id);
  if (!entry) notFound();

  const linkedBrief = getBriefForChange(entry.id);
  const linkedOpportunity = getOpportunityForChange(entry.id);
  const verdictData = getChangeVerdictData(entry.id);

  const attributedResults = results.filter((r) =>
    r.attributed_changelog_ids.includes(entry.id)
  );

  const hasConnections =
    linkedBrief !== null || linkedOpportunity !== null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          {entry.asset_name}
        </h2>
        <div className="flex items-center gap-3 mt-2 text-[12px] text-muted-foreground">
          <span>{SIGNAL_TYPE_LABELS[entry.signal_type]}</span>
          <span className="text-border">·</span>
          <span>{ASSET_TYPE_LABELS[entry.asset_type]}</span>
          <span className="text-border">·</span>
          <span>
            {new Date(entry.timestamp).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold mb-2">Change Description</h3>
        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          {entry.change_description}
        </p>
      </div>

      <div className="border-t border-border pt-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="URL">
            <span className="font-mono text-[12px]">{entry.url ?? "—"}</span>
          </Field>
          <Field label="Topic">{entry.topic_targeted}</Field>
          <Field label="City">{entry.city_targeted ?? "—"}</Field>
          <Field label="Expected Impact">
            {entry.expected_impact_window ?? "—"}
          </Field>
        </div>
      </div>

      {/* Hypothesis + Verdict */}
      {entry.hypothesis && (
        <div className="border-t border-border pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Hypothesis</h3>
            <ChangeVerdictBadge verdict={verdictData.verdict} />
          </div>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md p-3">
            {entry.hypothesis}
          </p>
          {verdictData.verdict !== "pending" && (
            <p className="text-[12px] text-muted-foreground">
              {verdictData.summary}
            </p>
          )}
        </div>
      )}

      {/* Operator Decisions */}
      {(() => {
        const decisions = eventDecisions.filter(
          (d) => d.cause_type === "change" && d.primary_change_id === entry.id
        );
        if (decisions.length === 0) return null;
        const CONF_LABELS = { high: "sure", medium: "best guess", low: "unsure" } as const;
        return (
          <div className="border-t border-border pt-5 space-y-3">
            <h3 className="text-[13px] font-semibold">
              Confirmed as cause ({decisions.length})
            </h3>
            <div className="space-y-1.5">
              {decisions.map((d) => (
                <Link
                  key={d.id}
                  href={`/results/${d.result_id}`}
                  className="block rounded-md border border-status-success/20 bg-status-success/5 px-3 py-2 hover:bg-status-success/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium truncate">{d.event_id}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {CONF_LABELS[d.operator_confidence]}
                    </span>
                  </div>
                  {d.operator_note && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{d.operator_note}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Results + Record */}
      <div className="border-t border-border pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Results</h3>
          <RecordResultButton
            attributedChangelogIds={[entry.id]}
            defaultTopic={entry.topic_targeted}
            defaultCity={entry.city_targeted}
            defaultUrl={entry.url}
          />
        </div>
        {attributedResults.length > 0 ? (
          <div className="space-y-2">
            {attributedResults.map((result) => {
              const attr = computeAttribution(
                entry,
                result,
                opportunities
              );
              return (
                <AttributionCard
                  key={result.id}
                  attribution={attr}
                  change={entry}
                  result={result}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No results linked to this change yet.
          </p>
        )}
      </div>

      {/* Connected */}
      {hasConnections && (
        <div className="border-t border-border pt-5 space-y-5">
          <h3 className="text-[13px] font-semibold">Connected</h3>

          {linkedOpportunity && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Source Opportunity
              </p>
              <EntityLinkCard
                type="opportunity"
                href={`/opportunities/${linkedOpportunity.id}`}
                title={linkedOpportunity.title}
                subtitle={linkedOpportunity.description ?? undefined}
                meta={linkedOpportunity.topic}
              />
            </div>
          )}

          {linkedBrief && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Source Brief
              </p>
              <EntityLinkCard
                type="brief"
                href={`/briefs/${linkedBrief.id}`}
                title={linkedBrief.title}
                subtitle={linkedBrief.objective}
                meta={BRIEF_TYPE_LABELS[linkedBrief.brief_type]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
