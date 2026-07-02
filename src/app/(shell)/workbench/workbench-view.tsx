import Link from "next/link";

import { PageBriefButton } from "./page-brief-button";
import type { WorkbenchData } from "./workbench-data";
import type { DiagnosisStatus } from "@/domains/insight/diagnosis-matrix";
import type {
  AtomicChangePack,
  ArtifactPushability,
  PushMethod,
} from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ChangeArtifact } from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";
import type { WorkbenchLeverRow } from "@/domains/insight/workbench-matrix";
import { decideVerdict, type VerdictChip } from "@/domains/insight/workbench-priority";
import type {
  OptimizerBuckets,
  OptimizerCandidate,
} from "@/domains/insight/workbench-optimizer";
import { CopyButton } from "./copy-button";
import { DraftWithAi } from "./draft-with-ai";
import { ResolveSerp } from "./resolve-serp";

/**
 * Workbench view (operator-OS rebuild, Phase 2, v1), presentational, read-only.
 * Renders one locked page: what Beacon sees, what it thinks, why, and the next
 * safe action. NO publish controls. Server component (the page gates + loads).
 */

const STATUS_META: Record<
  DiagnosisStatus,
  { dot: string; label: string; text: string }
> = {
  attention: { dot: "bg-rose-500", label: "Needs fixing", text: "text-rose-700" },
  monitor: { dot: "bg-amber-500", label: "Double-check", text: "text-amber-700" },
  ok: { dot: "bg-emerald-500", label: "Looking good", text: "text-emerald-700" },
  unknown: { dot: "bg-muted-foreground/40", label: "Not enough info yet", text: "text-muted-foreground" },
};

function Section({
  title,
  subtitle,
  id,
  children,
}: {
  title: string;
  subtitle?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-xl border border-border/60 bg-background p-5">
      <div className="mb-3">
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[18px] font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function fmtPct(ctr: number): string {
  return `${(ctr * 100).toFixed(2)}%`;
}

const VERDICT_META: Record<VerdictChip, string> = {
  "Ship this now": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Hold this": "border-amber-300 bg-amber-50 text-amber-700",
  "Needs SERP check": "border-amber-300 bg-amber-50 text-amber-800",
  "Needs Wix mapping": "border-sky-300 bg-sky-50 text-sky-700",
  "Manual only": "border-slate-300 bg-slate-50 text-slate-700",
  "Do not touch": "border-border bg-muted text-muted-foreground",
};

// Plain-English wording shown to the operator for each verdict (display only).
const VERDICT_DISPLAY: Record<VerdictChip, string> = {
  "Ship this now": "Do this now",
  "Hold this": "Wait",
  "Needs SERP check": "Check Google results first",
  "Needs Wix mapping": "We can't reach this part of Wix yet",
  "Manual only": "You'll edit this by hand",
  "Do not touch": "Leave it alone",
};

function pushMethodText(m: PushMethod): string {
  switch (m) {
    case "wix_cms_field":
      return "we can update it automatically on Wix";
    case "manual_cms_edit":
      return "you'll edit it by hand";
    case "no_write_path":
      return "you'll edit the page text by hand";
    case "blocked_no_mapping":
      return "we can't reach this part of Wix yet";
    case "not_applicable":
      return "not applicable";
  }
}

const BLOCKER_LABEL: Record<NonNullable<OptimizerCandidate["blockedBy"]>, string> = {
  serp: "Check Google results first",
  wix: "We can't reach this part of Wix yet",
  data: "Needs a draft first",
  measuring: "Still measuring an earlier change",
};

function UpsideLine({ c }: { c: OptimizerCandidate }) {
  if (c.estClicksAtStake == null) return null;
  return (
    <span className="text-[11px] text-muted-foreground">
      Could win back about {c.estClicksAtStake.toLocaleString()} more visits, {c.upsideConfidence} chance it helps
    </span>
  );
}

/** One optimizer candidate card. `tone` lifts the headline (best next move). */
function CandidateCard({
  role,
  c,
  tone = "normal",
}: {
  role: string;
  c: OptimizerCandidate;
  tone?: "lead" | "normal" | "hold";
}) {
  const border =
    tone === "lead"
      ? "border-foreground/40 bg-surface-inset/40"
      : tone === "hold"
        ? "border-border/50 bg-muted/20"
        : "border-border/60 bg-background";
  return (
    <div className={`rounded-lg border p-3 ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {role}
        </span>
        <span className="text-[13px] font-semibold text-foreground">{c.label}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_META[c.verdict]}`}>
          {VERDICT_DISPLAY[c.verdict]}
        </span>
        {c.blockedBy ? (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            {BLOCKER_LABEL[c.blockedBy]}
          </span>
        ) : null}
        <UpsideLine c={c} />
      </div>
      <p className="mt-1 text-[12px] text-foreground/80">{c.evidence}</p>
      {c.draft ? (
        <div className="mt-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Draft</span>
            <CopyButton value={c.draft} />
          </div>
          <blockquote className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap rounded border-l-2 border-border bg-muted/30 p-2.5 text-[12px] leading-relaxed text-foreground/85">
            {c.draft}
          </blockquote>
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{c.reason}</p>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        How we'll check it: {c.measurementMetric} · {pushMethodText(c.wixPushMethod)} · to undo: {c.rollbackType.replace(/_/g, " ")}
      </p>
    </div>
  );
}

/**
 * TASK 3, the per-page command center: the six operator moves scored over the
 * lever matrix + proof ledger + SERP. Best next move leads; the rest help the
 * operator weigh safe-now vs bigger-later and avoid touching what's measuring.
 */
function OptimizerView({ buckets }: { buckets: OptimizerBuckets }) {
  const { bestNextMove, safestChange, highestUpside, fastestMeasurable, holdDoNotTouch, biggerSwingLater } =
    buckets;
  const anyMove =
    bestNextMove || safestChange || highestUpside || fastestMeasurable || biggerSwingLater;

  // Healthy / blocked-only page: nothing to do now, only Hold entries.
  if (!anyMove) {
    return (
      <Section title="Best next move" subtitle="What to do first on this page.">
        {holdDoNotTouch.length > 0 ? (
          <div className="space-y-2">
            {holdDoNotTouch.map((c) => (
              <CandidateCard key={c.lever} role="Hold" c={c} tone="hold" />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No action warranted right now. This page looks healthy for its position, monitor and
            revisit if rankings slip.
          </p>
        )}
      </Section>
    );
  }

  // Secondary picks, deduped against the lead lever so we do not repeat it.
  const leadLever = bestNextMove?.lever;
  const secondary: Array<{ role: string; c: OptimizerCandidate }> = [
    { role: "Quickest win", c: safestChange! },
    { role: "Biggest potential", c: highestUpside! },
    { role: "Easiest to track", c: fastestMeasurable! },
  ].filter((s) => s.c && s.c.lever !== leadLever);

  return (
    <Section
      title="Best next move"
      subtitle="The best things you could do to this page, ranked. Start at the top."
    >
      <div className="space-y-2.5">
        {bestNextMove ? <CandidateCard role="Best next move" c={bestNextMove} tone="lead" /> : null}

        {secondary.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {secondary.map((s) => (
              <CandidateCard key={`${s.role}-${s.c.lever}`} role={s.role} c={s.c} />
            ))}
          </div>
        ) : null}

        {biggerSwingLater ? (
          <CandidateCard role="Worth doing later" c={biggerSwingLater} />
        ) : null}

        {holdDoNotTouch.length > 0 ? (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hold / do not touch
            </div>
            <ul className="space-y-1.5">
              {holdDoNotTouch.map((c) => (
                <li key={c.lever} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                  <span className="font-medium text-foreground">{c.label}</span>
                  {c.blockedBy ? (
                    <span className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[9px] font-medium text-amber-800">
                      {BLOCKER_LABEL[c.blockedBy]}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{c.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function ProposedBlock({ row }: { row: WorkbenchLeverRow }) {
  if (row.proposedSource === "n/a") {
    return (
      <p className="mt-1 text-[11px] text-fuchsia-700">
        Structural cluster fix: pick one lead page for this query and point the other pages&rsquo;
        internal links at it. Beacon never merges or deletes pages automatically.
      </p>
    );
  }
  if (row.proposedSource === "needs_endpoint" || !row.proposed) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        We can&rsquo;t write the exact wording yet. Connect AI in Settings to draft it. Nothing
        goes live.
      </p>
    );
  }
  const tag = row.proposedSource === "deterministic" ? "Proposed (auto)" : "Proposed";
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{tag}</span>
        <CopyButton value={row.proposed} />
      </div>
      <blockquote className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap rounded border-l-2 border-border bg-muted/30 p-2.5 text-[12px] leading-relaxed text-foreground/85">
        {row.proposed}
      </blockquote>
    </div>
  );
}

function LeverRow({ row }: { row: WorkbenchLeverRow }) {
  const verdict = decideVerdict(row);
  const sm = STATUS_META[row.status];
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${sm.dot}`} />
        <span className="text-[13px] font-semibold text-foreground">{row.label}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_META[verdict]}`}
        >
          {VERDICT_DISPLAY[verdict]}
        </span>
        {row.benefit ? (
          <span className="text-[11px] text-muted-foreground">
            Could win back about {row.benefit.estClicksAtStake.toLocaleString()} more visits,{" "}
            {row.benefit.confidence} chance it helps
            {row.benefit.serpGuardLabel ? ` · ${row.benefit.serpGuardLabel}` : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-foreground/75">{row.whyNeeded}</p>
      {row.current ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Current:</span> {row.current}
        </p>
      ) : null}
      <ProposedBlock row={row} />
      <p className="mt-1.5 text-[10px] text-muted-foreground/70">
        To make it live, {pushMethodText(row.pushMethod)}
        {row.rollbackReady ? ", and it's easy to undo" : ""}
      </p>
    </div>
  );
}

/** The per-page SEO action matrix: one row per lever (slice 1 output). */
function LeverMatrix({ rows }: { rows: WorkbenchLeverRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Section
      title="All the fixes for this page"
      subtitle="Every possible fix for this page: what it needs, the change, the expected benefit, and how it would go live. Nothing publishes from here."
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <LeverRow key={r.lever} row={r} />
        ))}
      </div>
    </Section>
  );
}

export function WorkbenchView({ data }: { data: WorkbenchData }) {
  if (!data.found) {
    return (
      <div className="max-w-4xl space-y-4">
        <header>
          <h1 className="text-[20px] font-semibold text-foreground">A close look at one page</h1>
          <p className="mt-1 text-[12px] text-muted-foreground/80">{data.path}</p>
        </header>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-6 text-[13px] text-muted-foreground">
          We haven&rsquo;t looked at this page yet, so there&rsquo;s nothing to review. Scan
          your website to add it, then come back to this page.
        </div>
      </div>
    );
  }

  const {
    identity,
    opportunity,
    topQueries,
    strikingDistance,
    cannibalization,
    diagnosis,
    matrix,
    optimizer,
    pack,
    packStatus,
    proof,
  } = data;

  // Server component, read the key here so the Draft-with-AI panel can tell the
  // operator whether it'll run the real model or the deterministic fallback.
  const hasOpenAi = (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;

  return (
    <div className="max-w-4xl space-y-4">
      {/* ── Page briefing ── */}
      <header className="rounded-xl border border-border/60 bg-background p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              A close look at one page of your website
            </div>
            <h1 className="mt-1 truncate text-[20px] font-semibold text-foreground">
              {identity.title || data.path}
            </h1>
            {data.canonUrl ? (
              <a
                href={data.canonUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-block text-[11px] text-accent-primary hover:underline"
              >
                {data.path} ↗
              </a>
            ) : (
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">{data.path}</p>
            )}
            {/* Hand-off to the proof recorder with the page prefilled, so once
                the operator pastes a change into Wix they record + measure it in
                one step (the Change Pack auto-fills action/before/after/queries). */}
            <Link
              href={`/proof?page=${encodeURIComponent(data.path)}`}
              prefetch={false}
              className="mt-1 inline-block text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Already updated this page on your site? Check results &rarr;
            </Link>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <PrimaryCta data={data} />
            <PageBriefButton
              brief={{
                path: data.path,
                canonUrl: data.canonUrl,
                title: identity.title,
                h1: identity.h1,
                metaDescription: identity.metaDescription,
                topQueries: topQueries.map((q) => ({
                  query: q.query,
                  impressions: q.impressions,
                  clicks: q.clicks,
                  position: q.position,
                })),
                strikingDistance: strikingDistance.map((s) => ({
                  keyword: s.keyword,
                  volume: s.volume,
                  position: s.position,
                })),
                bestMove: optimizer.bestNextMove
                  ? `${optimizer.bestNextMove.label}: ${optimizer.bestNextMove.evidence}`
                  : null,
              }}
            />
          </div>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Title (the blue link in Google)" value={identity.title} />
          <Field label="Main headline on the page" value={identity.h1} />
          <Field label="The blurb Google shows under the link" value={identity.metaDescription} />
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {identity.crawlFetchedAt
            ? `We last read this page ${identity.crawlAgeDays ?? "?"} day(s) ago`
            : "We haven't read this page yet"}
          {identity.staleCrawl ? (
            <span className="ml-1.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              it may have changed since
            </span>
          ) : null}
          {identity.extractionCertainty === "uncertain" ? (
            <span className="ml-1.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              we couldn&rsquo;t read this page cleanly
            </span>
          ) : null}
        </p>
      </header>

      {/* ── Best next move (TASK 3 optimizer: the six operator moves) ── */}
      <OptimizerView buckets={optimizer} />

      {/* ── SEO action matrix (per-lever supporting detail) ── */}
      <LeverMatrix rows={matrix.rows} />

      {/* ── Opportunity summary ── */}
      {opportunity ? (
        <Section title="What this page could gain" subtitle="Last 90 days, from Google.">
          <div className="flex flex-wrap gap-8">
            <Stat label="impressions" value={opportunity.impressions.toLocaleString()} />
            <Stat label="clicks" value={opportunity.clicks.toLocaleString()} />
            <Stat label="CTR" value={fmtPct(opportunity.ctr)} />
            <Stat label="avg position" value={opportunity.avgPosition.toFixed(1)} />
          </div>
          {opportunity.estClicksLabel ? (
            <p className="mt-3 text-[13px] font-medium text-foreground">
              ~{opportunity.estClicksAtStake.toLocaleString()}{" "}
              <span className="font-normal text-muted-foreground">
                est. clicks at stake over {opportunity.estWindow} · {opportunity.estConfidence}{" "}
                chance it helps · {opportunity.serpStatusChip}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">
              No recoverable click gap at the current rank, this is not a CTR-leak page.
            </p>
          )}
          {opportunity.serpGuardLabel ? (
            <p className="mt-2 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              ⚠ {opportunity.serpGuardLabel}
            </p>
          ) : null}
        </Section>
      ) : null}

      {/* ── SERP check (TASK 2), resolve "SERP unknown" on demand for this
          locked page. Bounded synthetic hypothesis (no live fetch / paid API);
          the broad Opportunity Map stays conservative and never runs this. ── */}
      <Section
        id="serp"
        title="Google results check"
        subtitle="See what Google shows for your search terms. This helps you decide if a new title would help."
      >
        <ResolveSerp path={data.path} hasOpenAi={hasOpenAi} />
      </Section>

      {/* ── Cannibalization (same-query page competition) ── */}
      {cannibalization.length > 0 ? (
        <Section
          title="Pages competing with each other"
          subtitle="Two or more of your pages are competing for the same Google search. Better to combine or link them than to retitle one."
        >
          <div className="space-y-4">
            {cannibalization.map((c) => (
              <div
                key={c.query}
                className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    Competing pages
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">
                    &ldquo;{c.query}&rdquo;
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.competitors.length} pages · {c.totalImpressions.toLocaleString()}{" "}
                    impressions · {c.totalClicks.toLocaleString()} click
                    {c.totalClicks === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="mt-2.5 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="font-medium">Page</th>
                      <th className="font-medium">Google rank</th>
                      <th className="font-medium">Times shown</th>
                      <th className="font-medium">Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.competitors.map((u) => (
                      <tr
                        key={u.path}
                        className={u.isThisPage ? "text-foreground" : "text-muted-foreground"}
                      >
                        <td className="py-0.5">
                          {u.path}
                          {u.isLead ? (
                            <span className="ml-1.5 rounded border border-emerald-300 bg-emerald-50 px-1 py-0.5 text-[9px] font-medium text-emerald-700">
                              lead
                            </span>
                          ) : null}
                          {u.isThisPage ? (
                            <span className="ml-1.5 rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-medium">
                              this page
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular-nums">#{u.position.toFixed(1)}</td>
                        <td className="tabular-nums">{u.impressions.toLocaleString()}</td>
                        <td className="tabular-nums">{u.clicks.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                <div className="mt-3 rounded-md border border-border/50 bg-background/70 p-2.5">
                  <div className="text-[11px] font-semibold text-foreground/80">
                    Recommended (operator review, nothing publishes):
                  </div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-foreground/75">
                    <li>
                      Choose <span className="font-medium">{c.leadPath}</span> as the lead page
                      for this query (best current rank #
                      {(
                        c.competitors.find((u) => u.isLead)?.position ??
                        c.competitors[0]?.position ??
                        0
                      ).toFixed(1)}
                      {c.thisPageIsLead ? ", which is this page" : ""}).
                    </li>
                    <li>Point the other pages&apos; internal links for this term at the lead page.</li>
                    <li>
                      Tone down the other pages so they stop competing for the same search.
                    </li>
                    <li>
                      Consolidate the pages only if they are genuinely the same topic and it is
                      safe to do so.
                    </li>
                  </ol>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    Structural / cluster fix, not a title rewrite. Beacon never merges or deletes
                    pages automatically.
                  </p>
                </div>

                <p className="mt-2 text-[10px] text-muted-foreground/70">
                  Proof plan: judge this at the cluster level (combined clicks{" "}
                  {c.totalClicks.toLocaleString()} + impressions{" "}
                  {c.totalImpressions.toLocaleString()} across all {c.competitors.length} pages,
                  plus the lead page&apos;s rank), not any single page alone.
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── Top queries + striking distance ── */}
      {(topQueries.length > 0 || strikingDistance.length > 0) && (
        <Section
          title="What people search"
          subtitle="The searches you already show up for, plus close-by searches you are almost ranking for."
        >
          {topQueries.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Search</th>
                    <th className="px-3 py-2 text-right font-medium">Times shown</th>
                    <th className="px-3 py-2 text-right font-medium">Visits</th>
                    <th className="px-3 py-2 text-right font-medium">Click rate</th>
                    <th className="px-3 py-2 text-right font-medium">Google rank</th>
                  </tr>
                </thead>
                <tbody>
                  {topQueries.map((q) => (
                    <tr key={q.query} className="border-t border-border/40">
                      <td className="px-3 py-1.5 text-foreground">{q.query}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {q.impressions.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {q.clicks.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmtPct(q.ctr)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {q.position.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">No Search query data for this page.</p>
          )}

          {strikingDistance.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Almost on page 1
              </div>
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                Google shows this page this many times a month for these, and you are close to
                ranking. Worth targeting.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {strikingDistance.map((k) => (
                  <li
                    key={k.keyword}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                  >
                    {k.keyword} · #{k.position} · shown {k.volume.toLocaleString()}/mo
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      )}

      {/* ── Diagnosis matrix ── */}
      <Section
        title="Health check"
        subtitle="What Beacon looks at on every page. When it cannot check something, it says “Not enough info yet,” never “looking good.”"
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Needs fixing</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Double-check</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Looking good</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" /> Not enough info yet (this is normal)</span>
        </div>
        <ul className="divide-y divide-border/40">
          {diagnosis.map((d) => {
            const m = STATUS_META[d.status];
            return (
              <li key={d.key} className="flex items-start gap-3 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground">{d.label}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${m.text}`}>
                      {m.label}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">{d.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ── Current Change Pack ── */}
      <Section
        id="change-pack"
        title="Suggested edits"
        subtitle={
          packStatus === "pack"
            ? "Beacon's drafted plan for this page. Review-only, nothing publishes here."
            : "Draft this page's exact change with the analysis model. Review-only."
        }
      >
        <div className="space-y-3">
          {/* Draft with AI (#6, 2026-06-22), on-demand LLM draft for this page,
              operator-gated + cached, fails soft to the deterministic plan. */}
          <DraftWithAi path={data.path} hasOpenAi={hasOpenAi} />
          {packStatus === "pack" && pack ? (
            <ChangePackBody pack={pack} />
          ) : packStatus === "evidence_only" ? (
            <p className="text-[12px] text-muted-foreground">
              People are searching for this page on Google, but Beacon has no
              suggested edits saved yet. Click &ldquo;Draft with AI&rdquo; above
              to create them.
            </p>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              No suggested edits yet. Click &ldquo;Draft with AI&rdquo; above to
              create them from what Beacon knows about this page.
            </p>
          )}
        </div>
      </Section>

      {/* ── Wix readiness ── */}
      <Section
        title="Can this go live?"
        subtitle="Can an approved change actually ship, and roll back?"
      >
        {packStatus === "pack" && pack && pack.pushability.length > 0 ? (
          <WixReadiness pack={pack} />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Nothing to check yet. Once there are suggested edits, each one shows whether Beacon
            can publish it to your Wix site in one click, whether it needs a manual edit, and
            whether it can be undone.
          </p>
        )}
      </Section>

      {/* ── Proof plan ── */}
      <Section
        title="How we will measure it"
        subtitle="We record where things stand now, then check again after 1, 2, and 4 weeks against similar pages we did not change."
      >
        {proof ? (
          <div className="space-y-3 text-[12px]">
            <div className="flex flex-wrap gap-2">
              <Window label="7-day check" date={proof.windows.checkIn7} />
              <Window label="14-day check" date={proof.windows.checkIn14} />
              <Window label="28-day check" date={proof.windows.checkIn28} />
            </div>
            {proof.metricsToCheck.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Baseline metrics
                </div>
                <ul className="space-y-0.5">
                  {proof.metricsToCheck.map((mt, i) => (
                    <li key={i} className="flex justify-between gap-2 text-foreground">
                      <span className="text-muted-foreground">{mt.label}</span>
                      <span className="tabular-nums">{mt.baseline}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {proof.controlPaths.length > 0 ? (
              <p className="text-muted-foreground">
                Controls: {proof.controlPaths.join(", ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No proof plan yet, it appears once a change for this page is reviewed and approved,
            so Beacon can measure the before/after against comparable pages.
          </p>
        )}
      </Section>

      {/* ── History ── */}
      {pack && (pack.history.length > 0 || pack.reviewDecision) ? (
        <Section title="History" subtitle="How this page's suggestions and reviews have changed over time.">
          {pack.reviewDecision ? (
            <p className="mb-2 text-[12px]">
              <span className="font-medium text-foreground">Latest review:</span>{" "}
              <span className="text-muted-foreground">
                {pack.reviewDecision.verdict}
                {pack.reviewDecision.note ? `, “${pack.reviewDecision.note}”` : ""} (
                {pack.reviewDecision.created_at.slice(0, 10)})
              </span>
            </p>
          ) : null}
          {pack.history.length > 0 ? (
            <ul className="space-y-1 text-[12px] text-muted-foreground">
              {pack.history.slice(0, 8).map((h) => (
                <li key={h.evidence_hash} className="flex justify-between gap-2">
                  <span>{h.headline_action}</span>
                  <span className="tabular-nums">{h.created_at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function PrimaryCta({ data }: { data: WorkbenchData }) {
  if (data.primaryCta.kind === "review_pack") {
    return (
      <Link
        href="#change-pack"
        className="shrink-0 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
      >
        {data.primaryCta.label} ↓
      </Link>
    );
  }
  // Draft Change Pack, now ENABLED (#6): jumps to the Draft-with-AI panel.
  return (
    <Link
      href="#change-pack"
      className="shrink-0 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
    >
      Write a suggested fix (won&rsquo;t go live) ↓
    </Link>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[12px] text-foreground">
        {value ? value : <span className="text-muted-foreground/60">empty (nothing set yet)</span>}
      </dd>
    </div>
  );
}

function Window({ label, date }: { label: string; date: string }) {
  return (
    <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
      {label}: <span className="font-medium text-foreground">{date}</span>
    </span>
  );
}

function ChangePackBody({ pack }: { pack: AtomicChangePack }) {
  const artifacts: ChangeArtifact[] = [
    ...(pack.bundle.primary ? [pack.bundle.primary] : []),
    ...pack.bundle.supporting,
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted-foreground">
          {pack.headlineAction}
        </span>
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">
          {pack.confidence} chance it helps
        </span>
        <span
          className={
            "rounded border px-1.5 py-0.5 font-medium " +
            (pack.qa.pass
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-800")
          }
        >
          {pack.qa.pass ? "QA passed" : "QA withheld"}
        </span>
        {pack.qa.factCheckRequired ? (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
            fact-check advised
          </span>
        ) : null}
      </div>

      {pack.operatorInsight ? (
        <p className="text-[12px] text-foreground/80">{pack.operatorInsight}</p>
      ) : null}

      {artifacts.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No content change, this page is healthy (monitor only).
        </p>
      ) : (
        <ul className="space-y-2.5">
          {artifacts.map((a, i) => (
            <li key={`${a.action}-${i}`} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {i === 0 ? "Primary" : "Supporting"}
                </span>
                <span className="text-[13px] font-medium text-foreground">{a.label}</span>
              </div>
              {a.after ? (
                <p className="mt-1 text-[12px] text-foreground">
                  <span className="text-muted-foreground">Proposed:</span> {a.after}
                </p>
              ) : a.instruction ? (
                <p className="mt-1 text-[12px] text-foreground">
                  <span className="text-muted-foreground">Do:</span> {a.instruction}
                </p>
              ) : null}
              {a.before ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Current: {a.before}</p>
              ) : null}
              {a.measurement ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">Measure: {a.measurement}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pack.bundle.deferred.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          + {pack.bundle.deferred.length} follow-up change(s) deferred for later.
        </p>
      ) : null}
    </div>
  );
}

const PUSH_METHOD_LABEL: Record<ArtifactPushability["method"], string> = {
  wix_cms_field: "We can update this automatically on your Wix site",
  manual_cms_edit: "You'll need to edit this by hand",
  no_write_path: "You'll edit this by hand (easy to undo)",
  blocked_no_mapping: "We can't reach this part of your Wix site yet",
  not_applicable: "Not applicable",
};

function WixReadiness({ pack }: { pack: AtomicChangePack }) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {pack.pushability.map((p, i) => (
          <li key={`${p.action}-${i}`} className="flex items-start justify-between gap-3 text-[12px]">
            <div className="min-w-0">
              <span className="font-medium text-foreground">{p.action}</span>
              <p className="text-muted-foreground">{p.reason}</p>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={
                  "text-[11px] font-medium " +
                  (p.method === "wix_cms_field"
                    ? "text-emerald-700"
                    : p.method === "blocked_no_mapping"
                      ? "text-rose-700"
                      : "text-muted-foreground")
                }
              >
                {PUSH_METHOD_LABEL[p.method]}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {p.rollbackReady ? "easy to undo" : "undo may be tricky"}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {pack.publishBlockers.length > 0 ? (
        <p className="text-[11px] text-amber-800">
          Blockers: {pack.publishBlockers.join("; ")}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Nothing goes live from this page. This only shows whether an approved change could go live
        and be undone.
      </p>
    </div>
  );
}
