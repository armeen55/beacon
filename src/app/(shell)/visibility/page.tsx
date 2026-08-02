import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/data/page-header";
import { Sparkline } from "@/components/data/sparkline";
import { currentTenantId } from "@/lib/tenant-context";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { reportingDay } from "@/lib/reporting-day";
import { requireReadyAccount, loadBusinessProfile } from "@/domains/account";
import { loadDailyTotalsForTenant } from "@/domains/decision";
import { buildScoreboard, visibilitySeries } from "@/domains/measurement";
import { researchRunStatus } from "@/domains/runtime";
import { competitorLandscape, isAnalysisSettled, loadEvidenceSnapshot, loadGscDecaySignalsForTenant,
  loadGscWeeklyLens, readAiObservations, type AiObservationRecord, type ClassifiedDomain, type CompetitorKind } from "@/domains/evidence";
import { aiTrend } from "../results/results-presentation";
import { ScoreboardSection } from "../scoreboard-section";
import { VisibilityTabs } from "./visibility-tabs";
import { aiView, googleView, type AnswerRow, type GoogleViewInput, type VisBlock } from "./visibility-view";

/**
 * Visibility (Dream V1 Phase 7) - THE one surface that answers "is my visibility moving, and why".
 * Two tabs, Google and AI answers, both rendered ENTIRELY from readings already stored: this page
 * triggers no research, calls no provider, buys nothing and crawls nothing. The shell layout's visit
 * hook recovers and resumes the daily round; looking at this page is never what causes it. No
 * composite score anywhere. Depth lives in the drill-downs and every ACTION lives in Changes.
 */
export const dynamic = "force-dynamic";
const WINDOW_DAYS = 28; // reporting days the AI side reads back

export default async function VisibilityPage() {
  const tenantId = await currentTenantId();
  const { access } = await requireReadyAccount(tenantId);
  if (access.kind === "suspended") redirect("/");
  return (
    <div className="max-w-4xl space-y-5"><PageHeader title="Visibility" description="Where you stand in Google and in AI answers, read back from what I have already collected. Every number names the day it comes from, and anything I have not read stays visibly missing." />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-border bg-surface-inset" aria-busy="true" aria-label="Loading visibility" />}>
        <VisibilityBody tenantId={tenantId} /></Suspense>
    </div>
  );
}

const host = (raw: string): string => (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";

/** ONE stored answer flattened for the view. The tri-state survives end to end: a row nobody has read
 *  closely reports null rather than false, and an engine that never said which pages it used reports
 *  null rather than "it credited nobody". `isAnalysisSettled` is the kernel's own rule, not a copy. */
function answerRow(r: AiObservationRecord): AnswerRow {
  const owned = host(r.site);
  const settled = isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysis_hash ?? null, answerHash: r.answer_hash ?? null });
  const mention = (r.analysis as { ownedBrandMention?: { mentioned?: unknown } | null } | null)?.ownedBrandMention;
  const cites = r.journey?.cited_sources ?? null;
  return {
    promptId: r.prompt_id, promptText: r.prompt_text, engine: r.engine, slot: r.sample_slot, answered: r.status === "observed",
    mentioned: settled && mention != null ? mention.mentioned === true : null, fanOuts: r.journey?.fan_outs ?? null,
    cited: cites == null ? null : cites.some((c) => { const h = host(c.domain || c.url); return !!owned && (h === owned || h.endsWith(`.${owned}`)); }),
  };
}

/** The recurring domains with the operator's own corrections applied, from cached evidence only ($0,
 *  no provider). Fail-soft to null, which the view says out loud rather than showing an empty list. */
async function landscapeFor(tenantId: string): Promise<ClassifiedDomain[]> {
  const [snapshot, profile] = await Promise.all([loadEvidenceSnapshot(tenantId), loadBusinessProfile(tenantId).catch(() => null)]);
  return competitorLandscape(snapshot, (profile?.competitors.value ?? []).filter((c) => !!c.domain)
    .map((c) => ({ domain: c.domain!, action: c.action ?? "pin", kind: c.kind as CompetitorKind | undefined })));
}

async function VisibilityBody({ tenantId }: { tenantId: string }) {
  // Stage one: every stored read that depends on nothing else, bounded, deadline raced and
  // fail-soft, so one slow read narrows one section instead of stranding the page.
  const [days, decay, segments, run, landscape, weekly] = await Promise.all([
    valueWithDeadline(loadDailyTotalsForTenant(tenantId, 84).catch(() => []), []),
    valueWithDeadline(loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()), new Map()),
    valueWithDeadline(visibilitySeries(tenantId, WINDOW_DAYS).catch(() => []), []),
    valueWithDeadline(researchRunStatus(tenantId).catch(() => null), null, 1500),
    valueWithDeadline(landscapeFor(tenantId).catch(() => null) as Promise<ClassifiedDomain[] | null>, null),
    valueWithDeadline(loadGscWeeklyLens(tenantId).catch(() => null), null),
  ]);

  // Stage two: the newest day that holds readings, then that ONE day's answers in full, so the
  // drill-down shows what was asked, what came back and what each credited. One day on purpose: a
  // month of whole answers is megabytes nobody reads.
  const dayRows = segments.flatMap((s) => s.days).filter((d) => d.observed > 0);
  const latestDay = dayRows[dayRows.length - 1]?.day ?? reportingDay(new Date());
  const latest = await valueWithDeadline(
    readAiObservations(tenantId, { day: latestDay }).then((rows) => rows.map(answerRow)).catch(() => [] as AnswerRow[]),
    [] as AnswerRow[],
  );

  const decayRows = Array.from((decay as Map<string, GoogleViewInput["decay"][number] & { windowNowEnd?: string }>).values());
  const google = googleView({
    hasData: days.length > 0, board: buildScoreboard(days, []), decay: decayRows, windowEnd: decayRows[0]?.windowNowEnd ?? null,
    weekly: weekly && { weekEnd: weekly.weekEnd, lines: [weekly.deviceLine, weekly.countryLine, weekly.appearanceLine, weekly.appearanceDropLine].filter((l): l is string => !!l) },
  });
  const ai = aiView({
    segments, trend: aiTrend(segments), windowDays: WINDOW_DAYS, landscape,
    checks: { done: run?.counters.aiChecksDone, total: run?.counters.aiChecksIntended, answered: run?.counters.aiChecksAnswered,
      unavailable: run?.counters.aiChecksUnavailable, unsupported: run?.counters.aiChecksUnsupported },
    latest: { day: dayRows.length > 0 ? latestDay : null, rows: latest },
  });

  // The clicks picture with every change you shipped marked on it is drawn by the SAME section Today
  // draws, so the two surfaces can never disagree about your traffic. It self-hides under two weeks
  // of history rather than drawing a line out of nothing.
  return (
    <VisibilityTabs
      google={google.limitation ? (
        <Block b={{ title: "Google", notes: [google.limitation], rows: [], chips: [], runs: [] }}>
          <Link href="/settings/connectors" className="text-[13px] font-semibold text-accent-primary underline underline-offset-2">Open Connections</Link></Block>
      ) : (
        <div className="space-y-4">
          {google.blocks.map((b) => <Block key={b.title} b={b} />)}
          <ScoreboardSection tenantId={tenantId} />
        </div>
      )}
      ai={<div className="space-y-4">{ai.empty
        ? <Block b={{ title: "AI answers", notes: [ai.empty], rows: [], chips: [], runs: [] }} />
        : ai.blocks.map((b) => <Block key={b.title} b={b} />)}</div>}
    />
  );
}

/**
 * ONE section, whatever it holds. The runs are the honest part: a model or mode change ENDS the line
 * and a new one starts beside a named break, because joining two instruments into a single line
 * would sell a change of model as a win or a loss.
 */
function Block({ b, children }: { b: VisBlock; children?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised px-4 py-3" data-visibility-block={b.title}>
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-foreground/70">{b.title}</h2>
      <div className="mt-1.5 space-y-1.5">
        {b.notes.map((n) => <p key={n} className="text-[13px] tabular-nums text-muted-foreground">{n}</p>)}
        {b.runs.length === 0 ? null : (
          <div className="flex flex-wrap items-end gap-3">
            {b.runs.map((r, i) => (
              <div key={i} className="border-l border-amber-400 pl-3 first:border-l-0 first:pl-0" data-trend-run="true">
                {r.breakLabel ? <p className="mb-1 max-w-[300px] text-[11px] text-amber-800">{r.breakLabel}</p> : null}
                <Sparkline points={r.points} width={140} height={28} />
                <p className="text-[10px] tabular-nums text-muted-foreground">{r.span ?? "Nobody has read an answer from this stretch closely enough for me to plot it."}</p>
              </div>
            ))}
          </div>
        )}
        {b.rows.length + b.chips.length === 0 ? null : (
          <ul className={b.chips.length > 0 ? "flex flex-wrap gap-1.5" : "space-y-1"}>
            {b.rows.map((r, i) => (
              <li key={`${r.head}-${i}`} className="text-[12px] tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{r.head}</span>: {r.body}</li>
            ))}
            {b.chips.map((c) => <li key={c} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground">{c}</li>)}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}
