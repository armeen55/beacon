import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { MatchFactors } from "@/components/display/match-factors";
import { changelogEntries, results, opportunities } from "@/lib/seed-data.server";
import { eventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { computeChangeImpact } from "@/domains/attribution/change-impact";
import type { EventAttribution, TrustSource } from "@/domains/attribution/scorecard";
import type { AttributionConfidence, ImpactConfidence, ImpactDirection } from "@/domains/attribution/types";
import type { EvidenceTier } from "@/domains/pages/types";
import {
  SIGNAL_TYPE_LABELS,
  ASSET_TYPE_LABELS,
} from "@/lib/constants";

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  google_aio: "Google AI Overviews",
  perplexity: "Perplexity",
};

const CONF_LABELS: Record<AttributionConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  uncertain: "Uncertain",
};

const TIER_LABELS: Record<EvidenceTier, string> = {
  exact: "Exact — verified page in registry",
  probable: "Probable — structural URL or strong description",
  weak: "Weak — vague description or no URL",
  inferred: "Inferred — reconstructed from patterns",
};

const TIER_COLORS: Record<EvidenceTier, string> = {
  exact: "text-status-success bg-status-success/10 border-status-success/20",
  probable: "text-foreground-secondary bg-surface-inset border-border",
  weak: "text-status-warning bg-status-warning/10 border-status-warning/20",
  inferred: "text-muted-foreground bg-surface-inset border-border",
};

const ROLE_LABELS: Record<string, string> = {
  primary: "Primary Cause",
  contributing: "Contributing Factor",
  candidate: "Unresolved Candidate",
};

const ROLE_BORDER: Record<string, string> = {
  primary: "border-l-status-success",
  contributing: "border-l-status-warning",
  candidate: "border-l-muted-foreground",
};

const TRUST_LABELS: Record<TrustSource, string> = {
  operator_confirmed: "Confirmed in Review",
  auto_cleared: "Auto-cleared",
  system_primary: "System pick",
  contributing: "Contributing",
  candidate: "Needs review",
  operator_rejected: "Rejected in Review",
};

const TRUST_DOT: Record<TrustSource, string> = {
  operator_confirmed: "bg-status-success",
  auto_cleared: "bg-accent-primary",
  system_primary: "bg-accent-primary",
  contributing: "bg-status-warning",
  candidate: "bg-muted-foreground/50",
  operator_rejected: "bg-status-danger",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  first_appearance: "First Appearance",
  visibility_regained: "Visibility Regained",
  mention_surge: "Mention Surge",
  visibility_lost: "Visibility Lost",
  mention_decline: "Mention Decline",
};

export default async function ChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = changelogEntries.find((c) => c.id === id);
  if (!entry) notFound();

  const allRows = computeScorecard(changelogEntries, results, opportunities, eventDecisions);
  const row = allRows.find((r) => r.change.id === id);
  if (!row) notFound();

  const impact = computeChangeImpact(row);

  const sortedAttributions = [...row.eventAttributions].sort(
    (a, b) => b.score - a.score
  );

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              {entry.asset_name}
            </h2>
            <div className="flex items-center gap-2 mt-1.5 text-[12px] text-muted-foreground flex-wrap">
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
              <span className="text-border">·</span>
              <span>{row.daysSinceChange}d ago</span>
            </div>
          </div>
          <ChangeVerdictBadge verdict={row.verdict} />
        </div>
      </div>

      {/* What changed */}
      <div className="bg-surface-inset rounded-lg px-4 py-3 space-y-2">
        <p className="text-[13px] leading-relaxed">
          {entry.change_description}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          {entry.url && (
            <span className="font-mono">{entry.url}</span>
          )}
          {entry.topic_targeted && (
            <span>Topic: {entry.topic_targeted}</span>
          )}
          {entry.city_targeted && (
            <span>City: {entry.city_targeted}</span>
          )}
        </div>
      </div>

      {/* Verdict summary */}
      <div className={`border rounded-lg px-4 py-3 ${row.operatorConfirmedCount > 0 ? "border-status-success/30 bg-status-success/5" : "border-border"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Outcome summary
              </p>
              {row.topTrust && (
                <span className="inline-flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${TRUST_DOT[row.topTrust]}`} />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {TRUST_LABELS[row.topTrust]}
                  </span>
                </span>
              )}
            </div>
            <p className="text-[13px] font-medium">{row.verdictSummary}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {row.topScore != null && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Best match score</p>
                <p className="text-[16px] font-semibold tabular-nums">
                  {Math.round(row.topScore)}
                </p>
              </div>
            )}
            {row.topConfidence && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Confidence</p>
                <p className="text-[13px] font-medium">
                  {CONF_LABELS[row.topConfidence]}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Evidence tier + platforms */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded border ${TIER_COLORS[row.evidenceTier]}`}
          >
            {TIER_LABELS[row.evidenceTier]}
          </span>
          {row.platforms.map((p) => (
            <span
              key={p}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground"
            >
              {PLATFORM_LABELS[p] ?? p}
            </span>
          ))}
        </div>
      </div>

      {/* Impact assessment */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-surface-inset/50 border-b border-border">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Impact assessment
          </p>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Confidence:</span>
              <ImpactConfidenceBadge confidence={impact.confidence} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Direction:</span>
              <DirectionBadge direction={impact.direction} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Why</p>
            <p className="text-[12px] text-foreground-secondary leading-relaxed">
              {impact.whyExplanation}
            </p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">What to do next</p>
            <p className="text-[13px] font-medium leading-relaxed">
              {impact.nextAction}
            </p>
          </div>
        </div>
      </div>

      {/* Hypothesis */}
      {entry.hypothesis && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Hypothesis
          </p>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md px-3 py-2">
            {entry.hypothesis}
          </p>
        </div>
      )}

      {/* Attribution chain */}
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Outcome Events ({sortedAttributions.length})
        </p>

        {sortedAttributions.length > 0 ? (
          <div className="space-y-2">
            {sortedAttributions.map((ea, i) => (
              <EventAttributionCard key={i} ea={ea} />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg px-4 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              {row.verdict === "too_early"
                ? `No outcome events detected yet. This change is ${row.daysSinceChange} days old — results may still emerge.`
                : "No outcome events linked to this change."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function EventAttributionCard({ ea }: { ea: EventAttribution }) {
  return (
    <Link
      href={`/results/${ea.event.anchor_result_id}`}
      className={`block border rounded-lg px-4 py-3 hover:bg-surface-inset/50 transition-colors border-l-[3px] ${ROLE_BORDER[ea.role]} ${ea.trustSource === "operator_confirmed" ? "border-status-success/30 bg-status-success/5" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-inset text-muted-foreground">
              {ROLE_LABELS[ea.role]}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${TRUST_DOT[ea.trustSource]}`} />
              <span className="text-[9px] font-medium text-muted-foreground">
                {TRUST_LABELS[ea.trustSource]}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              {EVENT_TYPE_LABELS[ea.event.type] ?? ea.event.type}
            </span>
          </div>
          <p className="text-[13px] font-medium">{ea.event.topic}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {ea.event.description}
          </p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span>{PLATFORM_LABELS[ea.event.platform] ?? ea.event.platform}</span>
            <span>·</span>
            <span>
              {new Date(ea.event.trigger_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span>·</span>
            <span>{ea.event.context.cited ? "Cited" : "Mentioned"}</span>
            <span>·</span>
            <span>
              {ea.event.context.mentions_after}/{ea.event.context.mentions_after + (ea.event.context.mentions_before ?? 0)} prompts
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-[16px] font-semibold tabular-nums">
            {Math.round(ea.score)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {CONF_LABELS[ea.confidence]}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <MatchFactors matches={ea.matches} />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 italic">
        {ea.explanation}
      </p>
    </Link>
  );
}

const IMPACT_CONF_STYLE: Record<ImpactConfidence, { label: string; className: string }> = {
  high: { label: "High", className: "text-status-success bg-status-success/10 border-status-success/20" },
  medium: { label: "Medium", className: "text-foreground-secondary bg-surface-inset border-border" },
  low: { label: "Low", className: "text-muted-foreground bg-surface-inset border-border" },
};

function ImpactConfidenceBadge({ confidence }: { confidence: ImpactConfidence }) {
  const cfg = IMPACT_CONF_STYLE[confidence];
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const DIRECTION_STYLE: Record<ImpactDirection, { label: string; className: string }> = {
  positive: { label: "Positive", className: "text-status-success" },
  negative: { label: "Decline", className: "text-status-danger" },
  mixed: { label: "Mixed", className: "text-status-warning" },
  none: { label: "No signal", className: "text-muted-foreground" },
};

function DirectionBadge({ direction }: { direction: ImpactDirection }) {
  const cfg = DIRECTION_STYLE[direction];
  return (
    <span className={`text-[11px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
