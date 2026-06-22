import Link from "next/link";

import type { WorkbenchData } from "./workbench-data";
import type { DiagnosisStatus } from "@/domains/insight/diagnosis-matrix";
import type {
  AtomicChangePack,
  ArtifactPushability,
} from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ChangeArtifact } from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";

/**
 * Workbench view (operator-OS rebuild, Phase 2, v1) — presentational, read-only.
 * Renders one locked page: what Beacon sees, what it thinks, why, and the next
 * safe action. NO publish controls. Server component (the page gates + loads).
 */

const STATUS_META: Record<
  DiagnosisStatus,
  { dot: string; label: string; text: string }
> = {
  attention: { dot: "bg-rose-500", label: "Act", text: "text-rose-700" },
  monitor: { dot: "bg-amber-500", label: "Verify", text: "text-amber-700" },
  ok: { dot: "bg-emerald-500", label: "OK", text: "text-emerald-700" },
  unknown: { dot: "bg-muted-foreground/40", label: "No data", text: "text-muted-foreground" },
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

export function WorkbenchView({ data }: { data: WorkbenchData }) {
  if (!data.found) {
    return (
      <div className="max-w-4xl space-y-4">
        <header>
          <h1 className="text-[20px] font-semibold text-foreground">Workbench</h1>
          <p className="mt-1 font-mono text-[12px] text-muted-foreground/80">{data.path}</p>
        </header>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-6 text-[13px] text-muted-foreground">
          Beacon has no crawl or Search data for this page yet, so there&rsquo;s nothing to
          audit. Run a website scan to add it to the inventory, then reopen the Workbench.
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
    pack,
    packStatus,
    proof,
  } = data;

  return (
    <div className="max-w-4xl space-y-4">
      {/* ── Page briefing ── */}
      <header className="rounded-xl border border-border/60 bg-background p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Workbench, locked page
            </div>
            <h1 className="mt-1 truncate text-[20px] font-semibold text-foreground">
              {identity.title || data.path}
            </h1>
            {data.canonUrl ? (
              <a
                href={data.canonUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-block font-mono text-[11px] text-accent-primary hover:underline"
              >
                {data.path} ↗
              </a>
            ) : (
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{data.path}</p>
            )}
          </div>
          <PrimaryCta data={data} />
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Current title" value={identity.title} />
          <Field label="Current H1" value={identity.h1} />
          <Field label="Meta description" value={identity.metaDescription} />
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {identity.crawlFetchedAt
            ? `Crawled ${identity.crawlAgeDays ?? "?"} day(s) ago`
            : "Not crawled yet"}
          {identity.staleCrawl ? (
            <span className="ml-1.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
              stale crawl, live page may have drifted
            </span>
          ) : null}
          {identity.extractionCertainty === "uncertain" ? (
            <span className="ml-1.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              crawl extraction uncertain
            </span>
          ) : null}
        </p>
      </header>

      {/* ── Opportunity summary ── */}
      {opportunity ? (
        <Section title="Opportunity summary" subtitle="Last 90 days, from Search.">
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
                confidence · {opportunity.serpStatusChip}
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

      {/* ── Cannibalization (same-query page competition) ── */}
      {cannibalization.length > 0 ? (
        <Section
          title="Cannibalization"
          subtitle="Two or more of your pages compete for the same query. A structural cluster fix, not a title rewrite."
        >
          <div className="space-y-4">
            {cannibalization.map((c) => (
              <div
                key={c.query}
                className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-fuchsia-300 bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-fuchsia-700">
                    Cannibalization
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

                <table className="mt-2.5 w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="font-medium">Page</th>
                      <th className="font-medium">Rank</th>
                      <th className="font-medium">Impr</th>
                      <th className="font-medium">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.competitors.map((u) => (
                      <tr
                        key={u.path}
                        className={u.isThisPage ? "text-foreground" : "text-muted-foreground"}
                      >
                        <td className="py-0.5 font-mono">
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
                      De-optimize or clarify the duplicate pages so they stop targeting the same
                      query.
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
          subtitle="Top Search queries (where you already rank) and SEMrush page-2 terms within striking distance."
        >
          {topQueries.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Query</th>
                    <th className="px-3 py-2 text-right font-medium">Impr.</th>
                    <th className="px-3 py-2 text-right font-medium">Clicks</th>
                    <th className="px-3 py-2 text-right font-medium">CTR</th>
                    <th className="px-3 py-2 text-right font-medium">Pos.</th>
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
                Striking distance (SEMrush, page-2)
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {strikingDistance.map((k) => (
                  <li
                    key={k.keyword}
                    className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
                  >
                    {k.keyword} · #{k.position} · {k.volume.toLocaleString()}/mo
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      )}

      {/* ── Diagnosis matrix ── */}
      <Section
        title="Diagnosis matrix"
        subtitle="What Beacon checks on every page. v1 is deterministic, dimensions it can't evaluate cheaply say “No data,” not “fine.”"
      >
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
        title="Current Change Pack"
        subtitle={
          packStatus === "pack"
            ? "Beacon's drafted plan for this page. Review-only, nothing publishes here."
            : "No drafted plan for this page yet."
        }
      >
        {packStatus === "pack" && pack ? (
          <ChangePackBody pack={pack} />
        ) : packStatus === "evidence_only" ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-[12px] text-muted-foreground">
            This page has Search demand but no drafted Change Pack yet. Drafting runs the
            deterministic gate + analysis model, that endpoint isn&rsquo;t configured, so
            drafting is disabled here for now.
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">No plan available.</p>
        )}
      </Section>

      {/* ── Wix readiness ── */}
      <Section
        title="Wix readiness"
        subtitle="Can an approved change actually ship, and roll back?"
      >
        {packStatus === "pack" && pack && pack.pushability.length > 0 ? (
          <WixReadiness pack={pack} />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No change to assess yet. Once a Change Pack exists, each artifact shows whether it
            maps to a Wix CMS field (one-click), needs a manual CMS edit, or has no write path,
            plus rollback readiness.
          </p>
        )}
      </Section>

      {/* ── Proof plan ── */}
      <Section
        title="Proof plan"
        subtitle="Baseline now, then measured at 7 / 14 / 28 days vs control pages."
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
        <Section title="History" subtitle="How this page's plan + reviews have evolved.">
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
  // Draft Change Pack — present but DISABLED in v1 (no analysis endpoint).
  return (
    <span
      title="Drafting needs the analysis endpoint, which isn't configured yet. No spend happens here."
      className="shrink-0 cursor-not-allowed rounded-md border border-border bg-muted px-3 py-1.5 text-[12px] font-medium text-muted-foreground"
    >
      {data.primaryCta.label} (not configured)
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[12px] text-foreground">
        {value ? value : <span className="text-muted-foreground/60">- none -</span>}
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
          {pack.confidence} confidence
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
  wix_cms_field: "Wix CMS field, one-click ready",
  manual_cms_edit: "Manual CMS edit",
  no_write_path: "No automated write path (reversible)",
  blocked_no_mapping: "Blocked, no Wix mapping",
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
                {p.rollbackReady ? "rollback ready" : "rollback best-effort"}
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
        Nothing publishes from the Workbench, this only shows whether an approved change could
        ship and be rolled back.
      </p>
    </div>
  );
}
