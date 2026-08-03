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
  loadGscPageSignalsForTenant, loadGscWeeklyLens, readAiObservations, type AiObservationRecord,
  type ClassifiedDomain, type CompetitorKind, type GscPageSignal } from "@/domains/evidence";
import { monthDayLabel } from "@/components/data/receipt-line";
import { aiTrend } from "../results/results-presentation";
import { ScoreboardSection } from "../scoreboard-section";
import { AnswerJourney } from "./answers-client";
import { VisibilityTabs } from "./visibility-tabs";
import { aiView, answerView, googleView, type AnswerRow, type GoogleViewInput, type VisBlock } from "./visibility-view";

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
  const cites = r.journey?.cited_sources ?? null, got = r.journey?.retrieved_results ?? null;
  const mine = (h: string) => !!owned && (h === owned || h.endsWith(`.${owned}`));
  const creditedUrls = new Set((cites ?? []).map((c) => c.url));
  // `answer_text` is absent on the LIST projection by design and arrives only when this ONE row is asked
  // for by itself. READ AND CREDITED ARE DIFFERENT CLAIMS, so what it read without crediting rides alone.
  return {
    id: r.id, day: r.reporting_day, answerText: r.answer_text ?? null,
    promptId: r.prompt_id, promptText: r.prompt_text, engine: r.engine, slot: r.sample_slot, answered: r.status === "observed",
    mentioned: settled && mention != null ? mention.mentioned === true : null, fanOuts: r.journey?.fan_outs ?? null,
    cited: cites == null ? null : cites.some((c) => mine(host(c.domain || c.url))),
    citations: cites == null ? null : cites.map((c) => { const h = host(c.domain || c.url); return { url: c.url, domain: h, owned: mine(h), ...(c.passage ? { passage: c.passage } : {}) }; }),
    retrievedNotCited: got == null ? null : got.filter((c) => !creditedUrls.has(c.url)).map((c) => c.url),
    modelRequested: r.model_requested ?? null, modelServed: r.model_served ?? null, mode: r.observation_mode ?? null,
    askedAt: r.requested_at ?? null, answeredAt: r.completed_at ?? null, receipt: r.cache_key ?? null,
    costUsd: r.cost_usd ?? null, failureReason: r.failure_reason ?? null,
    reading: settled ? "read" : r.analysis != null ? "part" : "unread",
  };
}

/** ONE screen of a day's readings; the day itself is unbounded from here. A cursor is the last row already
 *  in hand, in the store's own keyset order, and it is opaque to the client. */
const ANSWERS_PAGE = 25;
const cursorOf = (rows: AiObservationRecord[]): string | null =>
  rows.length < ANSWERS_PAGE ? null : `${rows[rows.length - 1]!.requested_at}|${rows[rows.length - 1]!.id}`;
const cursorFrom = (raw: string): { at: string; id: string } =>
  ({ at: raw.slice(0, raw.lastIndexOf("|")), id: raw.slice(raw.lastIndexOf("|") + 1) });

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
  const [days, decay, segments, run, landscape, weekly, pageSignals] = await Promise.all([
    valueWithDeadline(loadDailyTotalsForTenant(tenantId, 84).catch(() => []), []),
    valueWithDeadline(loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()), new Map()),
    valueWithDeadline(visibilitySeries(tenantId, WINDOW_DAYS).catch(() => []), []),
    valueWithDeadline(researchRunStatus(tenantId).catch(() => null), null, 1500),
    valueWithDeadline(landscapeFor(tenantId).catch(() => null) as Promise<ClassifiedDomain[] | null>, null),
    valueWithDeadline(loadGscWeeklyLens(tenantId).catch(() => null), null),
    // The searches behind each page, off rows already synced. A page that moved with no searches named
    // under it is a number the operator cannot act on.
    valueWithDeadline(loadGscPageSignalsForTenant(tenantId).catch(() => new Map()), new Map()),
  ]);

  // Stage two: the newest day that holds readings, then ONE BOUNDED PAGE of that day, without the answer
  // text. A live day is a hundred and forty readings and each answer is thousands of characters, so putting
  // the day into this render is megabytes nobody reads; the rest of the day pages in below on demand, and
  // one whole answer loads only when the operator opens that one reading.
  const dayRows = segments.flatMap((s) => s.days).filter((d) => d.observed > 0);
  const latestDay = dayRows[dayRows.length - 1]?.day ?? reportingDay(new Date());
  const stored = await valueWithDeadline(
    readAiObservations(tenantId, { day: latestDay, limit: ANSWERS_PAGE, projection: "list" }).catch(() => [] as AiObservationRecord[]),
    [] as AiObservationRecord[],
  );
  const latest = stored.map(answerRow);

  const decayRows = Array.from((decay as Map<string, GoogleViewInput["decay"][number] & { windowNowEnd?: string }>).values());
  const queriesByPage = new Map([...(pageSignals as Map<string, GscPageSignal>).entries()]
    .map(([page, sig]) => [page, sig.topQueries.map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position }))] as const));
  const google = googleView({
    hasData: days.length > 0, board: buildScoreboard(days, []), decay: decayRows, windowEnd: decayRows[0]?.windowNowEnd ?? null, queriesByPage,
    weekly: weekly && { weekEnd: weekly.weekEnd, lines: [weekly.deviceLine, weekly.countryLine, weekly.appearanceLine, weekly.appearanceDropLine].filter((l): l is string => !!l) },
  });
  const ai = aiView({
    segments, trend: aiTrend(segments), windowDays: WINDOW_DAYS, landscape,
    checks: { done: run?.counters.aiChecksDone, total: run?.counters.aiChecksIntended, answered: run?.counters.aiChecksAnswered,
      unavailable: run?.counters.aiChecksUnavailable, unsupported: run?.counters.aiChecksUnsupported },
    latest: { day: dayRows.length > 0 ? latestDay : null, rows: latest },
  });

  // THE REST OF THE DAY, AND THE WHOLE OF ONE READING. Both are reads of answers already bought and stored:
  // nothing on this page ever asks an assistant anything. Declared here so they carry this account's
  // identity from the server and can never be pointed at another one from a browser.
  async function moreAnswers(cursor: string): Promise<{ rows: ReturnType<typeof answerView>[]; cursor: string | null }> {
    "use server";
    const page = await readAiObservations(tenantId, {
      day: latestDay, limit: ANSWERS_PAGE, projection: "list", after: cursorFrom(cursor) }).catch(() => []);
    return { rows: page.map((r) => answerView(answerRow(r))), cursor: cursorOf(page) };
  }
  async function openAnswer(id: string): Promise<string[]> {
    "use server";
    const [one] = await readAiObservations(tenantId, { id, limit: 1 }).catch(() => []);
    if (!one) return ["I could not read that answer back just now. Close this and open it again in a moment."];
    const kinds = await landscapeFor(tenantId).catch(() => [] as ClassifiedDomain[]);
    return answerView(answerRow(one), new Map((kinds ?? []).map((k) => [k.domain, k.kind]))).details;
  }
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
        : <>{ai.blocks.map((b) => <Block key={b.title} b={b} />)}
          <AnswerJourney note={`${monthDayLabel(latestDay) ?? latestDay}: the questions I put to the assistants that day and what came back. Open one for the whole answer behind it.`}
            first={latest.map((r) => answerView(r))} cursor={cursorOf(stored)} more={moreAnswers} open={openAnswer} /></>}</div>}
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
                {/* THE DRILL-DOWN, server rendered and closed by default: the whole of one reading is one
                    click away and costs nothing until it is asked for. */}
                {r.details?.length ? (
                  <details data-visibility-detail="true">
                    <summary className="cursor-pointer list-item"><span className="font-medium text-foreground">{r.head}</span>: {r.body}</summary>
                    <div className="mt-1 space-y-1 border-l border-border pl-3">
                      {r.details.map((d, j) => <p key={j} className="whitespace-pre-line break-words text-[12px] text-muted-foreground">{d}</p>)}
                    </div>
                  </details>
                ) : <><span className="font-medium text-foreground">{r.head}</span>: {r.body}</>}</li>
            ))}
            {b.chips.map((c) => <li key={c} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground">{c}</li>)}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}
