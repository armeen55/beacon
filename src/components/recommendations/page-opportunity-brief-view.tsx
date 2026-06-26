/**
 * PageOpportunityBriefView (2026-06-17) — the operator-visible surface for the
 * Page Opportunity Brief: ONE page, what we know across every source, the
 * edit-vs-create call, and the few atomic changes worth making — each with
 * evidence, hypothesis, risk, before/after, pushability, and a measurement
 * plan. This is the "better than a pro SEO" artifact made visible.
 *
 * PURE presentational (no hooks, no I/O) — a function of its `brief` prop, so
 * the render contract is SSR-testable without a DOM or the database. Honesty is
 * inherited from the brief: a non-actionable change shows "Review only", never
 * a one-tap Accept; pushability + confidence are the gate's, not invented here.
 */

import type {
  PageOpportunityBrief,
  AtomicChange,
  BriefEvidenceReceipt,
} from "@/domains/recommendations/page-opportunity-brief";

const DECISION_LABEL: Record<PageOpportunityBrief["decision"], string> = {
  edit_existing: "Edit this page",
  create_new: "Create a new page",
  leave_as_is: "Leave as-is for now",
};

const DECISION_TONE: Record<PageOpportunityBrief["decision"], string> = {
  edit_existing: "bg-status-success/10 text-status-success",
  create_new: "bg-accent-primary/10 text-accent-primary",
  leave_as_is: "bg-muted-foreground/10 text-muted-foreground",
};

const CONFIDENCE_LABEL: Record<AtomicChange["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Needs review",
  needs_more_evidence: "Needs more evidence",
  rejected: "Rejected by QA",
};

const CONFIDENCE_TONE: Record<AtomicChange["confidence"], string> = {
  high: "bg-status-success/10 text-status-success",
  medium: "bg-status-warning/10 text-status-warning",
  low: "bg-status-warning/10 text-status-warning",
  needs_more_evidence: "bg-muted-foreground/10 text-muted-foreground",
  rejected: "bg-status-warning/10 text-status-warning",
};

function EvidenceReceipt({ e }: { e: BriefEvidenceReceipt }) {
  const chips: Array<{ key: string; label: string; value: string }> = [];
  if (e.gsc) {
    chips.push({
      key: "gsc",
      label: "Google Search",
      value: `${e.gsc.impressions90d.toLocaleString()} impr · ${e.gsc.clicks90d.toLocaleString()} clicks${
        e.gsc.position90d != null ? ` · pos ${e.gsc.position90d}` : ""
      }${e.gsc.topQuery ? ` · “${e.gsc.topQuery}”` : ""}`,
    });
  }
  if (e.clarity) {
    chips.push({
      key: "clarity",
      label: "Visitor behaviour",
      value: `${e.clarity.sessions.toLocaleString()} sessions${
        e.clarity.frictionRate != null ? ` · ${Math.round(e.clarity.frictionRate * 100)}% friction` : ""
      }`,
    });
  }
  if (e.ga4) {
    chips.push({ key: "ga4", label: "Website traffic", value: `${e.ga4.sessions.toLocaleString()} sessions` });
  }
  if (e.aiAnswers && e.aiAnswers.observations > 0) {
    chips.push({ key: "aeo", label: "AI answers", value: `${e.aiAnswers.observations} analyzed` });
  }
  if (chips.length === 0) {
    return (
      <p
        className="text-[12px] text-muted-foreground"
        data-brief-evidence-empty="true"
      >
        No connected-source data for this page yet — connect Google or Clarity
        or refresh to deepen the evidence.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2" data-brief-evidence="true">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex flex-col rounded-md border border-border/50 bg-surface-inset/30 px-3 py-1.5"
          data-brief-evidence-family={c.key}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {c.label}
          </span>
          <span className="text-[12px] text-foreground/90">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

function AtomicChangeCard({ c }: { c: AtomicChange }) {
  return (
    <li
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
      data-brief-atomic-change="true"
      data-brief-change-kind={c.kind}
      data-brief-change-actionable={c.actionable ? "true" : "false"}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-foreground" data-brief-change-title="true">
          {c.title}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${CONFIDENCE_TONE[c.confidence]}`}
          >
            {CONFIDENCE_LABEL[c.confidence]}
          </span>
          <span
            className="inline-flex items-center rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
            data-brief-pushability={c.pushability}
          >
            {c.pushability}
          </span>
        </span>
      </div>

      {(c.before != null || c.after != null) && (
        <div className="mb-1.5 text-[12px]" data-brief-change-diff="true">
          {c.before != null && (
            <p className="text-muted-foreground line-through">{c.before}</p>
          )}
          {c.after != null && <p className="text-foreground">{c.after}</p>}
        </div>
      )}

      {c.hypothesis && (
        <p className="text-[12px] text-foreground/80 leading-snug">
          <span className="text-muted-foreground">Why: </span>
          {c.hypothesis}
        </p>
      )}
      {c.risk && (
        <p className="mt-1 text-[12px] text-status-warning/90 leading-snug" data-brief-change-risk="true">
          <span className="font-semibold">⚠ Risk: </span>
          {c.risk}
        </p>
      )}
      {c.evidence.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1" data-brief-change-evidence="true">
          {c.evidence.map((ev, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded bg-accent-primary/[0.07] px-1.5 py-0.5 text-[10px] text-accent-primary"
            >
              {ev}
            </span>
          ))}
        </p>
      )}
      {c.measurement && (
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
          <span className="font-medium">Measure: </span>
          {c.measurement}
        </p>
      )}

      <div className="mt-2 text-[12px] font-semibold" data-brief-change-cta={c.actionable ? "accept" : "review"}>
        {c.actionable ? (
          <span className="text-accent-primary">Make this change →</span>
        ) : (
          <span className="text-muted-foreground">Review only →</span>
        )}
      </div>
    </li>
  );
}

export function PageOpportunityBriefView({ brief }: { brief: PageOpportunityBrief }) {
  return (
    <section className="space-y-4" data-page-opportunity-brief="true" data-brief-decision={brief.decision}>
      <header className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${DECISION_TONE[brief.decision]}`}
            data-brief-decision-badge="true"
          >
            {DECISION_LABEL[brief.decision]}
          </span>
          <h2 className="text-[16px] font-semibold text-foreground" data-brief-page-label="true">
            {brief.pageLabel}
          </h2>
        </div>
        <p className="text-[13px] text-foreground/90" data-brief-summary="true">
          {brief.summary}
        </p>
        <p className="text-[12px] text-muted-foreground leading-snug" data-brief-decision-reason="true">
          {brief.decisionReason}
        </p>
      </header>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          What we know about this page
        </p>
        <EvidenceReceipt e={brief.evidence} />
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {brief.actionableCount > 0
            ? `${brief.actionableCount} change${brief.actionableCount === 1 ? "" : "s"} worth making`
            : "Atomic changes considered"}
        </p>
        {brief.atomicChanges.length === 0 ? (
          <p className="text-[12px] text-muted-foreground" data-brief-no-changes="true">
            No atomic changes for this page right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {brief.atomicChanges.map((c, i) => (
              <AtomicChangeCard key={`${c.kind}-${i}`} c={c} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
