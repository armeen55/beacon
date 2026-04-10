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

const MODEL_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Model: stronger fit",
  medium: "Model: moderate",
  low: "Model: weaker fit",
};

export default function ExpansionPage() {
  const experimentActive = hasActiveExperiment();

  if (!experimentActive) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-[14px] font-medium mb-1">
          No active experiment
        </p>
        <p className="text-[12px] text-muted-foreground mb-3">
          Experimental backlog only. After import + Review activity, model-suggested
          topics may appear here — not part of the daily workflow.
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
        <p className="text-[10px] font-semibold text-muted-foreground mb-1">
          Experimental
        </p>
        <h2 className="text-[15px] font-semibold mb-1">
          Draft ideas (not in default workflow)
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Model-inferred topics or locations from imported data. Hidden from the
          main nav story — backlog only, not nightly operating truth.
        </p>
        <p className="text-[10px] text-status-warning mt-1">
          Hypotheses only · Not checked against your real pipeline or leads
        </p>
        <p className="text-[10px] text-muted-foreground mt-2 border border-border rounded px-2 py-1.5 bg-surface-inset/50">
          “Add draft opportunity” creates an editable row for your backlog — it does not validate market demand, zoning, or SEO outcome. Review every idea before publishing pages.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatBlock label="Total Candidates" value={summary.total} />
        <StatBlock label="New (not yet in list)" value={summary.new} />
        <StatBlock label="Model: stronger fit" value={summary.high} />
        <StatBlock label="Model: moderate fit" value={summary.medium} />
        <StatBlock label="Adjacent Cities" value={summary.adjacent} />
        <StatBlock label="Topic Expansion" value={summary.expansion} />
      </div>

      {/* High confidence */}
      {highConf.length > 0 && (
        <Section title="Draft backlog — model scored higher" count={highConf.length}>
          <div className="space-y-2">
            {highConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Medium confidence */}
      {medConf.length > 0 && (
        <Section title="Draft backlog — model scored moderate" count={medConf.length}>
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
            Recurring patterns in your data that are not reflected on current
            opportunity rows yet.
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
        <Section title="Draft backlog — model scored lower" count={lowConf.length} collapsed>
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
            Ideas appear after you have enough imported results and Review
            decisions for Beacon to infer patterns. Try Import and Review first.
          </p>
        </div>
      )}

      {/* Methodology */}
      <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
        <p className="text-[11px] font-semibold mb-1 text-muted-foreground">
          How candidates are generated
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-0.5">
          <li>
            <strong>Adjacent cities:</strong> Suggestions near locations you
            already show up for — needs local research before you ship pages.
          </li>
          <li>
            <strong>Topic expansion:</strong> Related themes from your existing
            prompts and results — not keyword research tools.
          </li>
          <li>
            <strong>Coverage gaps:</strong> Patterns that show up in data but
            are missing from your current opportunity list.
          </li>
          <li>
            <strong>Scoring:</strong> Internal weighted blend (pattern, context,
            clusters, gaps, recency) — directional ranking only.
          </li>
        </ul>
        <p className="text-[10px] text-muted-foreground/80 mt-2">
          Every suggestion still needs your judgment, unique copy, and compliance
          with how you actually sell and build. Beacon does not validate market
          demand or ROI.
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
              className={`text-[10px] font-semibold ${CANDIDATE_TYPE_COLORS[candidate.opportunityType]}`}
            >
              {CANDIDATE_TYPE_LABELS[candidate.opportunityType]}
            </span>
            <span
              className={`text-[10px] font-medium ${CANDIDATE_CONFIDENCE_COLORS[candidate.confidence]}`}
            >
              {MODEL_CONFIDENCE_LABEL[candidate.confidence] ?? candidate.confidence}
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
            <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
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
              <p className="text-[10px] font-semibold text-status-warning mb-0.5">
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
          <div className="mt-2 rounded border border-border bg-surface-inset/60 px-3 py-1.5">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-[10px] font-semibold text-muted-foreground">
                Pattern-derived (not page-specific proof)
              </span>
              <span className="font-medium">
                {candidate.sourcePatternLabel}
              </span>
            </div>
          </div>

          {/* Detail strip */}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
            <span className="tabular-nums">
              Internal rank {candidate.expectedImpact}
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
