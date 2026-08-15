import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { reportingDay } from "@/lib/reporting-day";
import { requireReadyAccount, loadBusinessProfile } from "@/domains/account";
import { loadDailyTotalsForTenant } from "@/domains/decision";
import { visibilitySeries } from "@/domains/measurement";
import { researchPermission, researchRunStatus } from "@/domains/runtime";
import { answerIntelOf, canonicalPairOf, citesOwnSite, competitorLandscape, isAnalysisSettled, loadEvidenceSnapshot, loadGscDecaySignalsForTenant,
  loadGscPageSignalsForTenant, observationReceiptCost, readAiObservations, type AiObservationRecord,
  type ClassifiedDomain, type CompetitorKind, type GscDecaySignal, type GscPageSignal } from "@/domains/evidence";
import { GoogleWorkspace } from "./google-view";
import { AiWorkspace } from "./ai-view";
import { aiView, answerDetail, googleView, type AnswerRow } from "./visibility-view";

/**
 * Visibility - THE one surface that answers "where do I stand, and why", in Google and in AI answers.
 * Both sides are rendered ENTIRELY from readings already stored: this page triggers no research, calls no
 * provider, buys nothing and crawls nothing. Every choice a customer makes here (which side, which stretch,
 * which assistant, which question, which run) lives in the address bar, so a screen can be sent to somebody
 * and comes back the same. No composite score anywhere. Every ACTION lives in Changes.
 */
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, key: string): string | null => { const v = p[key]; return typeof v === "string" && v.trim() ? v.trim() : null; };

export default async function VisibilityPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const tenantId = await currentTenantId();
  const { access } = await requireReadyAccount(tenantId);
  if (access.kind === "suspended") redirect("/");
  const params = (await searchParams) ?? {};
  const side = one(params, "view") === "ai" ? "ai" : "google";
  return (
    <div className="space-y-4">
      <PageHeader title="Visibility" description="Where you stand in Google and in AI answers, read back from what has already been collected. Every number names the days it was counted over, and anything unread stays visibly missing." />
      <div className="inline-flex items-center rounded-full bg-surface-inset/60 p-0.5 ring-1 ring-border/40">
        {[{ key: "google", label: "Google" }, { key: "ai", label: "AI answers" }].map((t) => (
          <Link key={t.key} href={`?view=${t.key}`} aria-current={side === t.key ? "true" : undefined}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${side === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <Suspense key={`${side}|${JSON.stringify(params)}`} fallback={<Skeleton />}>
        {side === "ai" ? <AiBody tenantId={tenantId} params={params} /> : <GoogleBody tenantId={tenantId} params={params} />}
      </Suspense>
    </div>
  );
}

/** The shape of the answer, held while it loads, so nothing on the page jumps when the numbers land. */
function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading visibility">
      <div className="rounded-2xl border border-border bg-surface-raised px-4 py-3.5">
        <div className="h-3 w-40 animate-pulse rounded bg-surface-inset" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-inset" />)}
        </div>
        <div className="mt-3 h-48 animate-pulse rounded-xl bg-surface-inset" />
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-surface-inset" />
    </div>
  );
}

// ── Google ───────────────────────────────────────────────────────────────────────────────────────

async function GoogleBody({ tenantId, params }: { tenantId: string; params: Params }) {
  const range = [7, 28, 84].includes(Number(one(params, "range"))) ? Number(one(params, "range")) : 28;
  const metric = (["clicks", "impressions", "ctr"] as const).find((m) => m === one(params, "metric")) ?? "clicks";
  // Every read is bounded, deadline raced and fail-soft, so one slow store narrows one table instead of
  // stranding the page. None of them calls Google: these are rows my daily round already synced.
  const [days, decay, pages] = await Promise.all([
    valueWithDeadline(loadDailyTotalsForTenant(tenantId, 84).catch(() => []), []),
    valueWithDeadline(loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()), new Map()),
    valueWithDeadline(loadGscPageSignalsForTenant(tenantId).catch(() => new Map()), new Map()),
  ]);
  const view = googleView({ days, rangeDays: range, metric,
    decay: Array.from((decay as Map<string, GscDecaySignal>).values()), pages: pages as Map<string, GscPageSignal> });
  return <GoogleWorkspace view={view} range={range} metric={metric} />;
}

// ── AI answers ───────────────────────────────────────────────────────────────────────────────────

const host = (raw: string): string => (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
const TREND_DAYS = 28; // the stretch the daily read covers, which is what the range picker may choose inside
const DAY_ROWS = 400;  // one live day is about 140 readings; this holds all of it and refuses to walk past a day

/** ONE stored reading flattened for the view. The tri-state survives end to end: a row nobody has read
 *  closely reports null rather than false, and an engine that never said which pages it used reports null
 *  rather than "it credited nobody". `isAnalysisSettled` is the kernel's own rule, not a copy here. */
function answerRow(r: AiObservationRecord): AnswerRow {
  const owned = host(r.site ?? "");
  const settled = isAnalysisSettled({ analysis: r.analysis, analysisHash: r.analysis_hash ?? null, answerHash: r.answer_hash ?? null });
  const a = (r.analysis ?? null) as { ownedBrandMention?: { mentioned?: unknown; position?: unknown } | null; competitors?: unknown; rejected?: unknown } | null;
  const mention = a?.ownedBrandMention ?? null;
  const named = settled && mention != null ? mention.mentioned === true : null;
  const cites = r.journey?.cited_sources ?? null, got = r.journey?.retrieved_results ?? null;
  // THE ONE OWNERSHIP PREDICATE (evidence/ai-visibility), not a third copy of it living on a page component.
  const mine = (h: string) => citesOwnSite([{ domain: h }], owned);
  const creditedUrls = new Set((cites ?? []).map((c) => c.url));
  return {
    id: r.id, day: r.reporting_day, promptId: r.prompt_id, promptText: r.prompt_text, engine: r.engine, slot: r.sample_slot,
    answered: r.status === "observed", mentioned: named, answerText: r.answer_text ?? null,
    position: named === true && typeof mention?.position === "number" && mention.position > 0 ? mention.position : null,
    competitors: settled && Array.isArray(a?.competitors)
      ? a.competitors.map((c) => typeof (c as { name?: unknown })?.name === "string" ? ((c as { name: string }).name).trim() : "").filter(Boolean) : [],
    fanOuts: r.journey?.fan_outs ?? null,
    cited: cites == null ? null : cites.some((c) => mine(host(c.domain || c.url))),
    citations: cites == null ? null : cites.map((c) => { const h = host(c.domain || c.url); return { url: c.url, domain: h, owned: mine(h), ...(c.passage ? { passage: c.passage } : {}) }; }),
    retrievedNotCited: got == null ? null : got.filter((c) => !creditedUrls.has(c.url)).map((c) => c.url),
    modelRequested: r.model_requested ?? null, modelServed: r.model_served ?? null, mode: r.observation_mode ?? null,
    webSearched: r.journey?.web_search_reported ?? null,
    askedAt: r.requested_at ?? null, answeredAt: r.completed_at ?? null, receipt: r.cache_key ?? null,
    // A ROW THAT PRESERVED NO COST IS UNKNOWN, NEVER FREE: zero is the absence of a receipt.
    costUsd: Number(r.cost_usd) > 0 ? Number(r.cost_usd) : null, failureReason: r.failure_reason ?? null,
    // A REFUSED READING IS STILL A SETTLED ONE, but what settled it was the deterministic look for this
    // account's own name and address, not a reading of the answer. The two are never called the same thing.
    reading: settled ? (a?.rejected === true ? "checked" : "read") : r.analysis != null && a?.rejected !== true ? "part" : "unread",
  };
}

/** The recurring domains with the operator's own corrections applied, from cached evidence only ($0, no
 *  provider). Fail-soft to null, which the view says out loud rather than showing an empty list. */
async function landscapeFor(tenantId: string): Promise<ClassifiedDomain[]> {
  const [snapshot, profile] = await Promise.all([loadEvidenceSnapshot(tenantId), loadBusinessProfile(tenantId).catch(() => null)]);
  return competitorLandscape(snapshot, (profile?.competitors.value ?? []).filter((c) => !!c.domain)
    .map((c) => ({ domain: c.domain!, action: c.action ?? "pin", kind: c.kind as CompetitorKind | undefined })));
}

async function AiBody({ tenantId, params }: { tenantId: string; params: Params }) {
  const range = Number(one(params, "range")) === 28 ? 28 : 7;
  const sub = (["prompts", "citations", "searches"] as const).find((s) => s === one(params, "sub")) ?? "prompts";
  const engine = one(params, "engine"), prompt = one(params, "prompt"), openId = one(params, "reading");
  // A READ I COULD NOT MAKE COMES BACK NULL, NEVER EMPTY. Falling back to a bare empty list told an account
  // with seven hundred stored answers that I had never read one of them, and the view says so instead.
  const [segments, run, landscape, collecting] = await Promise.all([
    // THE SPINE OF THIS TAB gets the longest rope: every headline number, the line and the question table are read off it, so losing it to a five second race costs the whole side of the surface. It asks for the OVERVIEW projection, about a third of the row: the whole answer text and the whole stored verdict are megabytes a trend never reads, and asking for them is what left this tab blank.
    valueWithDeadline(visibilitySeries(tenantId, TREND_DAYS).catch(() => null), null as Awaited<ReturnType<typeof visibilitySeries>> | null, 12_000),
    valueWithDeadline(researchRunStatus(tenantId).catch(() => null), null, 1500),
    valueWithDeadline(landscapeFor(tenantId).catch(() => null) as Promise<ClassifiedDomain[] | null>, null),
    // THE OFF SWITCH ITSELF, so no line here says checks are planned for today over an account that is paused.
    valueWithDeadline(researchPermission(tenantId).catch(() => "unreadable" as const), "unreadable" as const, 1500),
  ]);
  // The newest day that actually holds readings. WHOLE ANSWERS ARE NEVER PULLED IN BULK: the day read drops the one genuinely heavy column, and the complete text of a single run loads only when one is opened, by id, one row.
  const allDays = (segments ?? []).flatMap((s) => s.days), observedDays = allDays.filter((d) => d.observed > 0);
  const latestDay = observedDays[observedDays.length - 1]?.day ?? reportingDay(new Date());
  const leanFrom = allDays.slice(-Math.min(range * 2, TREND_DAYS))[0]?.day ?? latestDay;
  const [dayRows, windowRows, focusRows, opened] = await Promise.all([
    valueWithDeadline(readAiObservations(tenantId, { day: latestDay, limit: DAY_ROWS, projection: "list" }).catch(() => null), null as AiObservationRecord[] | null),
    valueWithDeadline(readAiObservations(tenantId, { fromDay: leanFrom, toDay: latestDay, slot: 0, projection: "outcome" }).catch(() => null), null as AiObservationRecord[] | null, 6000),
    prompt ? valueWithDeadline(readAiObservations(tenantId, { promptId: prompt, limit: 200, projection: "list" }).catch(() => []), [] as AiObservationRecord[]) : Promise.resolve([]),
    openId ? valueWithDeadline(readAiObservations(tenantId, { id: openId, limit: 1 }).catch(() => []), [] as AiObservationRecord[]) : Promise.resolve([]),
  ]);
  // WHAT THE ENGINES' OWN ANSWERS SAID, off the canonical readings of the day I read last and nothing else.
  const intel = dayRows == null || dayRows.length === 0 ? null : answerIntelOf(dayRows.filter((r) => r.sample_slot === 0).map(canonicalPairOf));
  const view = aiView({
    segments, rangeDays: range, engine, sub, landscape, intel, day: observedDays.length > 0 ? latestDay : null,
    checks: { done: run?.counters.aiChecksDone, total: run?.counters.aiChecksIntended, answered: run?.counters.aiChecksAnswered,
      unavailable: run?.counters.aiChecksUnavailable, unsupported: run?.counters.aiChecksUnsupported },
    liveness: run?.liveness?.line ?? null, collecting,
    dayRows: dayRows?.map(answerRow) ?? null, window: windowRows?.map(answerRow) ?? null,
    focus: prompt ? { promptId: prompt, rows: focusRows.map(answerRow) } : null,
  });
  // THE WHOLE OF ONE RUN, and what it cost or that I cannot prove it: the row's own preserved receipt wins,
  // and with none the exact stored receipt it names is asked. NEVER zero dollars for an answer that was paid for.
  const row = opened[0] ?? null;
  const cost = row == null ? null : Number(row.cost_usd) > 0 ? Number(row.cost_usd)
    : row.cache_key ? await observationReceiptCost(row.cache_key).catch(() => null) : null;
  const reading = openId == null ? null
    : row == null ? ["That run could not be read back just now. Close this and open it again in a moment."]
      : answerDetail(answerRow(row), new Map((landscape ?? []).map((k) => [k.domain, k.kind])), cost);
  return <AiWorkspace view={view} range={range} engine={engine} sub={sub} reading={reading} />;
}
