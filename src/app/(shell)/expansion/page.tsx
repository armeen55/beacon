import Link from "next/link";
import {
  getResults,
  getChangelogEntries,
  getOpportunities,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { getCandidateLinks } from "@/domains/attribution/store";
import { computeOpportunityCandidates } from "@/domains/opportunity-candidates/compute";
import {
  newCandidates,
  candidatesByConfidence,
  summarizeCandidates,
} from "@/domains/opportunity-candidates/selectors";
import {
  CANDIDATE_TYPE_COLORS,
  CANDIDATE_CONFIDENCE_COLORS,
} from "@/domains/opportunity-candidates/types";
import type { OpportunityCandidateType } from "@/domains/opportunity-candidates/types";
import { PromoteCandidateButton } from "@/components/data/promote-candidate";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";

/** Expansion-only labels: explicit hypothesis / backlog framing (not product recommendations). */
const EXPANSION_TYPE_LABEL: Record<OpportunityCandidateType, string> = {
  adjacent: "Nearby geography · hypothesis",
  missing: "Missing coverage · hypothesis",
  expansion: "Topic angle · hypothesis",
  gap: "Pattern gap · hypothesis",
};

const MODEL_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Model fit: stronger (still directional)",
  medium: "Model fit: moderate",
  low: "Model fit: weaker",
};

export default async function ExpansionPage() {
  const experimentActive = await hasActiveExperiment();

  if (!experimentActive) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          title="Expansion backlog"
          description="Quarantined hypothesis list — not part of the default operating story. It only appears when experiments are active."
        />
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
          <p className="text-foreground font-medium">Nothing to show yet</p>
          <p className="mt-2 leading-relaxed">
            Directional ideas from pattern inference can surface here after enough import and Review
            signal. This page is intentionally secondary so Beacon never reads as a page factory.
          </p>
          <p className="mt-3">
            <Link
              href="/settings/import"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Import
            </Link>
            {" · "}
            <Link
              href="/changes?tab=attribution"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Review
            </Link>
            {" · "}
            <Link
              href="/competitors#opportunities"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Opportunities
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const [results, changelogEntries, opportunities] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
  ]);
  // #149-family (2026-06-11): geo-expansion uses the TENANT'S cities.
  // De-vert (2026-06-15): topic-expansion adjacency uses the TENANT'S services.
  let expansionCities: string[] | undefined;
  let expansionServices: string[] | undefined;
  try {
    const { getBusinessConfigForCurrentTenant } = await import(
      "@/lib/business-config"
    );
    const cfg = await getBusinessConfigForCurrentTenant();
    expansionCities = cfg.locations;
    expansionServices = cfg.services;
  } catch {
    expansionCities = undefined; // founder default
    expansionServices = undefined; // no synthetic topic expansion
  }
  const allCandidates = computeOpportunityCandidates(
    results,
    changelogEntries,
    opportunities,
    await getCandidateLinks(),
    expansionCities,
    expansionServices,
  );
  const summary = summarizeCandidates(allCandidates);
  const fresh = newCandidates(allCandidates);
  const freshNonAdjacent = fresh.filter((c) => c.opportunityType !== "adjacent");
  const adjacentOnly = fresh.filter((c) => c.opportunityType === "adjacent");

  const highConf = candidatesByConfidence(freshNonAdjacent, "high");
  const medConf = candidatesByConfidence(freshNonAdjacent, "medium");
  const lowConf = candidatesByConfidence(freshNonAdjacent, "low");

  const gapCandidates = allCandidates.filter(
    (c) => c.opportunityType === "gap" && !c.alreadyExists
  );

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Expansion backlog"
        description="Speculative hypotheses from imported signal — not recommendations, not validated demand, and not a shortcut to publishing pages."
      />

      <p className="-mt-4 text-sm text-muted-foreground leading-relaxed">
        Your operating loop stays on{" "}
        <Link href="/" className="text-foreground underline-offset-4 hover:underline">
          Today
        </Link>
        ,{" "}
        <Link href="/competitors#opportunities" className="text-foreground underline-offset-4 hover:underline">
          Opportunities
        </Link>
        , and{" "}
        <Link href="/changes?tab=attribution" className="text-foreground underline-offset-4 hover:underline">
          Review
        </Link>
        . Use this list only to capture ideas worth researching. Refresh evidence via{" "}
        <Link href="/settings/import" className="text-foreground underline-offset-4 hover:underline">
          Import
        </Link>
        .
      </p>

      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm">
        <p className="font-medium text-foreground">Quarantined surface</p>
        <p className="mt-1.5 text-muted-foreground leading-relaxed">
          Nothing here is an instruction to ship location pages or scale templated content. Treat every
          row as a backlog note — validate fit, copy, and compliance before any build.
        </p>
      </div>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">At a glance</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Directional hypotheses" value={summary.total} />
          <StatCard label="New in queue" value={summary.new} />
          <StatCard label="Stronger model fit" value={summary.high} />
          <StatCard label="Moderate model fit" value={summary.medium} />
        </div>
        <details className="mt-4 border-t border-border/40 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground hover:underline">
            Counts by hypothesis shape
          </summary>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Geographic-adjacent ideas are easiest to misuse; they are listed separately below and
            collapsed by default.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Nearby geography</dt>
              <dd className="font-semibold tabular-nums">{summary.adjacent}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Topic angle</dt>
              <dd className="font-semibold tabular-nums">{summary.expansion}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">All candidates (incl. tracked)</dt>
              <dd className="font-semibold tabular-nums">{allCandidates.length}</dd>
            </div>
          </dl>
        </details>
      </section>

      {highConf.length > 0 && (
        <Section
          title="Backlog — stronger model fit (non-geographic)"
          subtitle="Topic, gap, and coverage-style hypotheses only. Not verified for search demand."
          count={highConf.length}
        >
          <div className="space-y-2">
            {highConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {medConf.length > 0 && (
        <Section
          title="Backlog — moderate model fit (non-geographic)"
          subtitle="Lower prior than the section above — still not a recommendation."
          count={medConf.length}
        >
          <div className="space-y-2">
            {medConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {gapCandidates.length > 0 && (
        <Section
          title="Pattern gaps in your data"
          subtitle="Recurring signal not yet reflected on opportunity rows — triage before promoting."
          count={gapCandidates.length}
        >
          <div className="space-y-2">
            {gapCandidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {lowConf.length > 0 && (
        <Section
          title="Backlog — weaker model fit (non-geographic)"
          subtitle="Collapsed by default — skim before discarding."
          count={lowConf.length}
          collapsed
        >
          <div className="space-y-2">
            {lowConf.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </Section>
      )}

      {adjacentOnly.length > 0 && (
        <details className="group rounded-lg border border-border/60 bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">
                Nearby geography hypotheses
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                ({adjacentOnly.length}) · collapsed by default
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Highest misuse risk: easy to read as “spin up city pages.” Open only when you intend to
              research local demand, differentiation, and compliance — not to batch-publish.
            </p>
          </summary>
          <div className="border-t border-border/40 px-4 py-4 space-y-2">
            {adjacentOnly.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </details>
      )}

      {allCandidates.length === 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">No hypotheses in queue</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Ideas appear after enough imported results and Review decisions for pattern inference.
            Start with Import and Review — not this page.
          </p>
        </div>
      )}

      <details className="rounded-lg border border-border/60 bg-muted/10">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/20 rounded-lg list-none [&::-webkit-details-marker]:hidden">
          How hypotheses are produced
        </summary>
        <div className="border-t border-border/40 px-4 py-4 text-sm text-muted-foreground space-y-3 leading-relaxed">
          <p>
            <span className="font-medium text-foreground">Nearby geography</span> — proximity to
            locations already in your data. Requires local research; never treat as automatic SEO
            scope.
          </p>
          <p>
            <span className="font-medium text-foreground">Topic angle</span> — related themes from
            prompts and results. Not a substitute for keyword or demand research.
          </p>
          <p>
            <span className="font-medium text-foreground">Pattern gaps</span> — signal present in data
            but missing from current opportunity rows.
          </p>
          <p>
            <span className="font-medium text-foreground">Ranking</span> — internal weighted blend
            (patterns, context, clusters, recency). Directional ordering only.
          </p>
          <p className="text-xs border-t border-border/40 pt-3">
            Every row needs your judgment, unique copy, and real-world checks. Beacon does not
            validate market demand, leads, or ROI.
          </p>
        </div>
      </details>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
  collapsed,
}: {
  title: string;
  subtitle?: string;
  count: number;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  const heading = (
    <span className="text-sm font-semibold text-foreground">{title}</span>
  );
  const countEl = (
    <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
  );

  if (collapsed) {
    return (
      <details className="group rounded-lg border border-border/60 bg-card">
        <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="flex flex-wrap items-center gap-2">
            {heading}
            {countEl}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
          )}
        </summary>
        <div className="border-t border-border/40 px-4 py-4">{children}</div>
      </details>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {heading}
          {countEl}
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function CandidateCard({
  candidate,
}: {
  candidate: import("@/domains/opportunity-candidates/types").OpportunityCandidate;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={`text-xs font-medium ${CANDIDATE_TYPE_COLORS[candidate.opportunityType]}`}
            >
              {EXPANSION_TYPE_LABEL[candidate.opportunityType]}
            </span>
            <span
              className={`text-xs font-medium ${CANDIDATE_CONFIDENCE_COLORS[candidate.confidence]}`}
            >
              {MODEL_CONFIDENCE_LABEL[candidate.confidence] ?? candidate.confidence}
            </span>
            {candidate.targetCity && (
              <span className="text-xs text-muted-foreground">{candidate.targetCity}</span>
            )}
          </div>

          <p className="text-sm font-medium text-foreground">{candidate.label}</p>

          <details className="mt-2 group/ev">
            <summary className="cursor-pointer text-xs font-medium text-foreground hover:underline list-none [&::-webkit-details-marker]:hidden">
              Why Beacon surfaced this · evidence · caveats
            </summary>
            <div className="mt-2 space-y-3 border-t border-border/40 pt-3">
              <p className="text-sm text-muted-foreground leading-relaxed">{candidate.reasoning}</p>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Evidence</p>
                <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                  {candidate.supportingEvidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>

              {candidate.caveats.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Caveats</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                    {candidate.caveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Pattern-derived</span> — not
                  page-specific proof. {candidate.sourcePatternLabel}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular-nums">Internal rank {candidate.expectedImpact}</span>
                <span aria-hidden>·</span>
                <span>Query template: {candidate.queryTemplate}</span>
                {candidate.targetPlatform !== "all" && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{candidate.targetPlatform}</span>
                  </>
                )}
              </div>
            </div>
          </details>
        </div>

        <div className="shrink-0 pt-0.5">
          <PromoteCandidateButton
            candidate={candidate}
            actionLabel="Stage draft in Opportunities"
            pendingLabel="Staging…"
            successLabel="Staged — validate before use"
          />
        </div>
      </div>
    </div>
  );
}
