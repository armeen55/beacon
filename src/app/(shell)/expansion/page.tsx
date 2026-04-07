import Link from "next/link";
import {
  results,
  changelogEntries,
  opportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { candidateLinks } from "@/domains/attribution/store";
import { computeOpportunityCandidates } from "@/domains/opportunity-candidates/compute";
import {
  newCandidates,
  candidatesByConfidence,
  summarizeCandidates,
} from "@/domains/opportunity-candidates/selectors";
import {
  CANDIDATE_TYPE_LABELS,
  CANDIDATE_TYPE_COLORS,
  CANDIDATE_CONFIDENCE_COLORS,
} from "@/domains/opportunity-candidates/types";
import { PromoteCandidateButton } from "@/components/data/promote-candidate";

export default function ExpansionPage() {
  const experimentActive = hasActiveExperiment();

  if (!experimentActive) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-[14px] font-medium mb-1">
          No active experiment
        </p>
        <p className="text-[12px] text-muted-foreground mb-3">
          Import a workbook to generate expansion opportunities from pattern
          intelligence.
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

  const allCandidates = computeOpportunityCandidates(
    results,
    changelogEntries,
    opportunities,
    candidateLinks
  );
  const summary = summarizeCandidates(allCandidates);
  const fresh = newCandidates(allCandidates);
  const highConf = candidatesByConfidence(fresh, "high");
  const medConf = candidatesByConfidence(fresh, "medium");
  const lowConf = candidatesByConfidence(fresh, "low");

  const gapCandidates = allCandidates.filter(
    (c) => c.opportunityType === "gap" && !c.alreadyExists
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold mb-1">
          Expansion Candidates
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Hypothetical expansion opportunities derived from pattern analysis. These are suggestions, not confirmed strategies — review caveats before acting.
        </p>
        <p className="text-[10px] text-status-warning mt-1">
          Secondary analysis · Candidates are unvalidated hypotheses
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatBlock label="Total Candidates" value={summary.total} />
        <StatBlock
          label="New Opportunities"
          value={summary.new}
          variant="success"
        />
        <StatBlock label="High Confidence" value={summary.high} variant="success" />
        <StatBlock label="Medium" value={summary.medium} variant="warning" />
        <StatBlock label="Adjacent Cities" value={summary.adjacent} />
        <StatBlock label="Topic Expansion" value={summary.expansion} />
      </div>

      {/* High confidence */}
      {highConf.length > 0 && (
        <Section title="High Confidence" count={highConf.length}>
          <div className="space-y-2">
            {highConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Medium confidence */}
      {medConf.length > 0 && (
        <Section title="Medium Confidence" count={medConf.length}>
          <div className="space-y-2">
            {medConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Coverage gaps */}
      {gapCandidates.length > 0 && (
        <Section title="Coverage Gaps" count={gapCandidates.length}>
          <p className="text-[11px] text-muted-foreground mb-2">
            Proven patterns not yet applied to existing opportunities.
          </p>
          <div className="space-y-2">
            {gapCandidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Low confidence */}
      {lowConf.length > 0 && (
        <Section title="Lower Confidence" count={lowConf.length} collapsed>
          <div className="space-y-2">
            {lowConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {allCandidates.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium mb-1">
            No expansion candidates yet
          </p>
          <p className="text-[12px] text-muted-foreground">
            Expansion opportunities are generated from proven patterns with
            attributed events. Resolve more events in the review queue to
            generate patterns.
          </p>
        </div>
      )}

      {/* Methodology */}
      <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
        <p className="text-[11px] font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
          How candidates are generated
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-0.5">
          <li>
            <strong>Adjacent Cities:</strong> Proven patterns expanded to
            nearby serviceable cities with unique local context
          </li>
          <li>
            <strong>Topic Expansion:</strong> Semantically adjacent topics
            based on proven keyword/content patterns
          </li>
          <li>
            <strong>Coverage Gaps:</strong> Proven patterns not yet applied
            to existing opportunities
          </li>
          <li>
            <strong>Scoring:</strong> Pattern score (40%) + context
            similarity (20%) + cluster strength (20%) + gap size (10%) +
            recency (10%)
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground/80 mt-2">
          All strategies fact-checked: geographic adjacency, topic expansion,
          coverage gaps, and pattern replication are all PARTIALLY VALID
          strategies that require unique content per target and should be
          treated as hypotheses, not guarantees.
        </p>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number | string;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const color =
    variant === "success"
      ? "text-status-success"
      : variant === "warning"
        ? "text-status-warning"
        : variant === "danger"
          ? "text-status-danger"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
      <p className={`text-[18px] font-semibold tabular-nums ${color}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  collapsed,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer mb-3">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            ({count})
          </span>
        </summary>
        {children}
      </details>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          ({count})
        </span>
      </div>
      {children}
    </div>
  );
}

function CandidateCard({
  candidate,
}: {
  candidate: import("@/domains/opportunity-candidates/types").OpportunityCandidate;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Type + confidence tags */}
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${CANDIDATE_TYPE_COLORS[candidate.opportunityType]}`}
            >
              {CANDIDATE_TYPE_LABELS[candidate.opportunityType]}
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wider ${CANDIDATE_CONFIDENCE_COLORS[candidate.confidence]}`}
            >
              {candidate.confidence}
            </span>
            {candidate.targetCity && (
              <span className="text-[10px] text-muted-foreground">
                {candidate.targetCity}
              </span>
            )}
          </div>

          {/* Label */}
          <p className="text-[13px] font-medium">{candidate.label}</p>

          {/* Reasoning */}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {candidate.reasoning}
          </p>

          {/* Evidence */}
          <div className="mt-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              Evidence
            </p>
            <ul className="text-[10px] text-muted-foreground space-y-0.5">
              {candidate.supportingEvidence.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          </div>

          {/* Caveats */}
          {candidate.caveats.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-status-warning mb-0.5">
                Caveats
              </p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5">
                {candidate.caveats.map((c, i) => (
                  <li key={i}>⚠ {c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Pattern source */}
          <div className="mt-2 rounded border border-accent-primary/20 bg-accent-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-primary">
                Source Pattern
              </span>
              <span className="font-medium">
                {candidate.sourcePatternLabel}
              </span>
            </div>
          </div>

          {/* Detail strip */}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
            <span className="tabular-nums">
              Score {candidate.expectedImpact}
            </span>
            <span>·</span>
            <span>Query: {candidate.queryTemplate}</span>
            {candidate.targetPlatform !== "all" && (
              <>
                <span>·</span>
                <span>{candidate.targetPlatform}</span>
              </>
            )}
          </div>
        </div>

        {/* Promote button */}
        <div className="flex-shrink-0 mt-1">
          <PromoteCandidateButton candidate={candidate} />
        </div>
      </div>
    </div>
  );
}
