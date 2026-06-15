import Link from "next/link";
import {
  getResults,
  getChangelogEntries,
  getOpportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { getCandidateLinks } from "@/domains/attribution/store";
import { getBriefStates } from "@/domains/brief-generation/store";
import { getActionStates } from "@/domains/actions/store";
import { computeProposedBriefs } from "@/domains/brief-generation/compute";
import {
  readyToExecute,
  needsValidation,
  systemFixBriefs,
  riskyBriefs,
  summarizeBriefQueue,
} from "@/domains/brief-generation/selectors";
import {
  BRIEF_TYPE_LABELS,
  BRIEF_TYPE_COLORS,
  BRIEF_PRIORITY_COLORS,
} from "@/domains/brief-generation/types";
import type { ProposedBrief } from "@/domains/brief-generation/types";
import { BriefAcceptReject } from "@/components/data/brief-controls";

export default async function ProposedBriefsPage() {
  if (!(await hasActiveExperiment())) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-[14px] font-medium mb-1">No briefs yet</p>
        <p className="text-[12px] text-muted-foreground mb-3">
          A brief is a step-by-step plan for one change to make. Connect a
          data source (Search Console, GA4, Semrush) so Beacon has something
          to work from — then it can draft briefs for you. You can also
          import a spreadsheet export instead.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/settings/connectors"
            className="text-[12px] text-accent-primary hover:underline font-medium"
          >
            Connect a data source
          </Link>
          <Link
            href="/settings/import"
            className="text-[12px] text-muted-foreground hover:underline"
          >
            Import a spreadsheet
          </Link>
        </div>
      </div>
    );
  }

  const [results, changelogEntries, opportunities, candidateLinks, briefStates, actionStates] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getCandidateLinks(),
    getBriefStates(),
    getActionStates(),
  ]);
  const { briefs } = computeProposedBriefs(
    results,
    changelogEntries,
    opportunities,
    candidateLinks,
    briefStates,
    actionStates
  );

  const summary = summarizeBriefQueue(briefs);
  const ready = readyToExecute(briefs);
  const validation = needsValidation(briefs);
  const sysFix = systemFixBriefs(briefs);
  const risky = riskyBriefs(briefs);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-semibold">Proposed Briefs</h2>
          <Link
            href="/briefs"
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Accepted briefs →
          </Link>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Draft execution plans generated from action clusters and patterns.
          These are suggestions — review evidence and caveats before accepting.
        </p>
        <p className="text-[10px] text-status-warning mt-0.5">
          Proposed briefs are hypotheses until accepted. Quality depends on attribution evidence.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatBlock label="Total" value={summary.total} />
        <StatBlock label="Ready" value={summary.readyToExecute} variant="success" />
        <StatBlock label="Needs Validation" value={summary.needsValidation} variant="warning" />
        <StatBlock label="System Fixes" value={summary.systemFixes} />
        <StatBlock label="Accepted" value={summary.accepted} variant="success" />
        <StatBlock label="Rejected" value={summary.rejected} />
      </div>

      {/* Ready to Execute */}
      {ready.length > 0 && (
        <Section title="Ready to Execute" count={ready.length}>
          <div className="space-y-3">
            {ready.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        </Section>
      )}

      {/* System Fixes */}
      {sysFix.length > 0 && (
        <Section title="System Fixes" count={sysFix.length}>
          <div className="space-y-3">
            {sysFix.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        </Section>
      )}

      {/* Needs Validation */}
      {validation.length > 0 && (
        <Section title="Needs Validation" count={validation.length}>
          <div className="space-y-3">
            {validation.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        </Section>
      )}

      {/* Risky */}
      {risky.length > 0 && (
        <Section title="Risky / Low Confidence" count={risky.length}>
          <div className="space-y-3">
            {risky.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        </Section>
      )}

      {briefs.length === 0 && (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium mb-1">
            No briefs generated yet
          </p>
          <p className="text-[12px] text-muted-foreground">
            Briefs are generated from high-priority actions and promoted
            opportunities. Complete the action queue to generate execution plans.
          </p>
        </div>
      )}

      {/* Methodology */}
      <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
        <p className="text-[11px] font-semibold mb-1 text-muted-foreground">
          How briefs are generated
        </p>
        <ul className="text-[11px] text-muted-foreground space-y-0.5">
          <li>
            <strong>Source:</strong> High-priority actions (do_now, do_this_week,
            system_fix) and promoted opportunities
          </li>
          <li>
            <strong>Templates:</strong> Deterministic templates per brief type
            (coverage_expansion, faq_upgrade, measurement_fix, etc.)
          </li>
          <li>
            <strong>Caveats shape the brief:</strong> Doorway risk, cannibalization,
            and pattern decline actively lower confidence, add validation checks,
            and constrain scope
          </li>
          <li>
            <strong>Scoring:</strong> Action priority (25%) + pattern score (20%)
            + cluster confidence (15%) + expected impact (15%) + evidence (10%)
            + clarity (10%) - caveat penalty - dependency penalty
          </li>
        </ul>
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
  variant?: "default" | "success" | "warning";
}) {
  const color =
    variant === "success"
      ? "text-status-success"
      : variant === "warning"
        ? "text-status-warning"
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
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
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

function BriefCard({ brief }: { brief: ProposedBrief }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span
              className={`text-[10px] font-semibold ${BRIEF_TYPE_COLORS[brief.briefType]}`}
            >
              {BRIEF_TYPE_LABELS[brief.briefType]}
            </span>
            <span
              className={`text-[10px] font-medium ${BRIEF_PRIORITY_COLORS[brief.priority]}`}
            >
              {brief.priority}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Score {brief.score}
            </span>
          </div>
          <p className="text-[13px] font-medium">{brief.title}</p>
        </div>
        <div className="flex-shrink-0">
          <BriefAcceptReject brief={brief} />
        </div>
      </div>

      {/* Objective */}
      <p className="text-[11px] text-muted-foreground mb-2">
        {brief.objective}
      </p>

      {/* Why now */}
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
          Why this now
        </p>
        <p className="text-[11px] text-muted-foreground">{brief.whyThisNow}</p>
      </div>

      {/* Evidence */}
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
          Evidence
        </p>
        <ul className="text-[10px] text-muted-foreground space-y-0.5">
          {brief.evidenceSummary.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      </div>

      {/* Caveats */}
      {brief.caveats.length > 0 && (
        <div className="mb-2 rounded border border-status-warning/20 bg-status-warning/5 px-3 py-2">
          <p className="text-[10px] font-semibold text-status-warning mb-0.5">
            Caveats ({brief.caveats.length})
          </p>
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            {brief.caveats.map((c, i) => (
              <li key={i}>⚠ {c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended Steps */}
      <details className="group mb-2">
        <summary className="text-[10px] font-semibold text-muted-foreground cursor-pointer mb-0.5">
          Recommended Steps ({brief.recommendedSteps.length})
        </summary>
        <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside mt-1">
          {brief.recommendedSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>

      {/* Success Criteria */}
      <details className="group mb-2">
        <summary className="text-[10px] font-semibold text-muted-foreground cursor-pointer mb-0.5">
          Success Criteria ({brief.successCriteria.length})
        </summary>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
          {brief.successCriteria.map((c, i) => (
            <li key={i}>✓ {c}</li>
          ))}
        </ul>
      </details>

      {/* Validation Checks */}
      {brief.validationChecks.length > 0 && (
        <details className="group mb-2">
          <summary className="text-[10px] font-semibold text-muted-foreground cursor-pointer mb-0.5">
            Validation Checks ({brief.validationChecks.length})
          </summary>
          <ul className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
            {brief.validationChecks.map((v, i) => (
              <li key={i}>⊘ {v}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap pt-1 border-t border-border/50">
        {brief.targetTopic && <span>Topic: {brief.targetTopic}</span>}
        {brief.targetCity && <span>City: {brief.targetCity}</span>}
        {brief.targetPlatform !== "all" && (
          <span>Platform: {brief.targetPlatform}</span>
        )}
        {brief.sourceActionId && (
          <Link
            href="/"
            className="text-accent-primary hover:underline"
          >
            View Action
          </Link>
        )}
        {brief.sourceOpportunityId && (
          <Link
            href={`/topics/opportunity/${brief.sourceOpportunityId}`}
            className="text-accent-primary hover:underline"
          >
            View Opportunity
          </Link>
        )}
      </div>
    </div>
  );
}
