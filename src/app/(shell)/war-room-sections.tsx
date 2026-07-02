/**
 * War-room sections (2026-07-01, R3) - the "everything in one" intelligence bands under the
 * team's picks on Today. Each section is a thin server component over a LIVE domain loader
 * (the loaders survived the June cockpit fold; the UI did not - this restores the strongest
 * coherent version, not the old museum). Every section self-hides when it has no real data,
 * fails soft to null, and speaks operator language. No em dashes, no lab jargon.
 */
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { routeClarityFriction, type ClarityMoveType } from "@/domains/recommendation-intelligence/clarity-move-router";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { loadEngineGapTodayLine } from "@/domains/ai-visibility/gap-store";
import { loadAiReferralSummary, aiReferralTodayLine } from "@/domains/ai-visibility/ai-referrals";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { funnelSummaryLine } from "@/domains/ai-visibility/crawl-citation-funnel";
import { loadAiOverviewGapTodayLine } from "@/domains/serp/serp-history";
import { currentTenantSlug } from "@/lib/tenant-context";
import { loadDemandOpportunities } from "@/domains/demand/load-demand-opportunities";
import { loadQuerySpikes } from "@/domains/trend-radar/spike-store";
import { matchSpikeToMove, type MatchableMove } from "@/domains/trend-radar/spike-move-match";
import type { QuerySpike } from "@/domains/trend-radar/query-spikes";
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import type { SeasonalQuery } from "@/domains/seasonal/seasonality";
import { loadLanguageGaps } from "@/domains/language-gap/language-gap-store";
import type { LanguageGap } from "@/domains/language-gap/language-gaps";
import { readWorklistSurface } from "./worklist-surface-store";
import { deriveStatus, statusView } from "@/domains/changes/canonical-change";
import Link from "next/link";
import { WarRoomCopyButton } from "./war-room-copy-button";

const CARD = "rounded-2xl border border-gray-200 bg-white p-4 beacon-rise-in dark:border-neutral-800 dark:bg-neutral-900";
const HEAD = "text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-neutral-500";
/** Item 23 - shared visible keyboard-focus ring for interactive elements in the war-room bands. */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

function prettyPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 48 ? p.slice(0, 45) + "..." : p;
}

/** Item 21 - tiny decorative all-clear mark for the designed empty states. Pure decoration,
 *  hidden from screen readers (the sentence next to it carries the meaning). */
function QuietCheckIllustration() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <circle cx="20" cy="20" r="18" className="fill-emerald-50 dark:fill-emerald-950/40" />
      <circle cx="20" cy="20" r="18" fill="none" strokeWidth="1.5" className="stroke-emerald-200 dark:stroke-emerald-800" />
      <path d="M13 20.5l4.5 4.5L27 15.5" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-emerald-500 dark:stroke-emerald-400" />
    </svg>
  );
}

const CLARITY_MOVE_LABEL: Record<ClarityMoveType, string> = {
  fix_js_errors: "Fix the page errors",
  fix_dead_click: "Fix the broken click",
  fix_rage_interaction: "Fix the frustrating element",
  fix_intent_mismatch: "Match what visitors came for",
  raise_answer: "Move the answer up",
};

/** Visitor behavior (Clarity teammate): the pages where real visitors hit friction, routed to a
 *  specific fix. Self-hides only when Clarity has no page data at all; when it checked real
 *  pages and none crossed the thresholds, that is good news worth one quiet card (item 21). */
export async function FrictionFixesSection({ tenantId }: { tenantId: string }) {
  try {
    const signals = await loadClarityPageSignalsForTenant(tenantId);
    if (signals.size === 0) return null;
    const rows = [...signals.values()]
      .map((s) => ({ s, d: routeClarityFriction(s) }))
      .filter((x): x is { s: (typeof x)["s"]; d: NonNullable<(typeof x)["d"]> } => x.d != null)
      .sort((a, b) => (a.d.severity === b.d.severity ? b.s.sessions - a.s.sessions : a.d.severity === "high" ? -1 : 1))
      .slice(0, 4);
    if (rows.length === 0) {
      // Item 21 - designed empty state: Clarity watched real visitor sessions this week
      // and no page cleared the friction thresholds. Say so instead of leaving a gap.
      return (
        <section aria-label="Visitor friction fixes" className={CARD}>
          <div className="flex items-center gap-3">
            <QuietCheckIllustration />
            <div className="min-w-0">
              <div className={HEAD}>Visitor behavior</div>
              <p className="mt-0.5 text-[13px] text-gray-600 dark:text-neutral-300">No friction found this week. Clean pages.</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">I watched sessions on {signals.size.toLocaleString()} page{signals.size === 1 ? "" : "s"} from the last 28 days.</p>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section aria-label="Visitor friction fixes" className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <div className={HEAD}>Visitor behavior found friction</div>
          <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">{rows.length} page{rows.length === 1 ? "" : "s"} · sessions from the last 28 days</span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Real visitor sessions on these pages hit problems. Fixing them protects every click the other changes win.</p>
        <div className="mt-2 space-y-2">
          {rows.map(({ s, d }) => (
            <div key={s.url} className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-neutral-800/60">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${d.severity === "high" ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                  {CLARITY_MOVE_LABEL[d.moveType]}
                </span>
                <span className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">{prettyPath(s.url)}</span>
                <span className="text-[11px] text-gray-400 dark:text-neutral-500">{d.evidence}</span>
                <WarRoomCopyButton text={`${CLARITY_MOVE_LABEL[d.moveType]} on ${s.url}\nEvidence: ${d.evidence}\nWhy: ${d.reason}`} />
              </div>
              <p className="mt-0.5 text-[12px] text-gray-600 dark:text-neutral-300">{d.reason}</p>
            </div>
          ))}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}

/** AI visibility (Profound teammate): are AI assistants crawling you and sending visitors?
 *  Self-hides when neither feed has data. */
export async function AiCrawlerSection({ tenantId }: { tenantId: string }) {
  try {
    const slug = await currentTenantSlug().catch(() => "");
    const [sig, llmMentions, engineGapLine, referralSummary, funnel, aiOverviewGapLine] = await Promise.all([
      loadBotReferralSignals(tenantId),
      readAllCachedLlmMentions().catch(() => []),
      // Item 4: one honest line from last night's 4-engine question check ($0 store read).
      loadEngineGapTodayLine(tenantId).catch(() => null),
      // Item 6: real GA4 sessions that arrived FROM an AI assistant ($0 table read).
      loadAiReferralSummary(tenantId).catch(() => null),
      // Item 7: the per-page crawl to citation to visitors funnel ($0 joins of synced rows).
      slug ? loadCrawlCitationFunnel(tenantId, slug).catch(() => null) : Promise.resolve(null),
      // Item 20: Google AI Overview citation gap vs organic rank ($0 history read).
      loadAiOverviewGapTodayLine(tenantId).catch(() => null),
    ]);
    const referralLine = referralSummary ? aiReferralTodayLine(referralSummary) : null;
    const funnelLine = funnel && funnel.hasData ? funnelSummaryLine(funnel) : null;
    const funnelRows = funnel && funnel.hasData ? funnel.stalled.slice(0, 3) : [];
    if (
      !sig.hasData &&
      llmMentions.length === 0 &&
      !engineGapLine &&
      !referralLine &&
      !funnelLine &&
      funnelRows.length === 0 &&
      !aiOverviewGapLine
    )
      return null;
    const topBots = sig.botSummary.topBots.slice(0, 3);
    const topSources = sig.referralSummary.topSources.slice(0, 3);
    const trendWord =
      sig.referralTrend.direction === "rising" ? "rising" : sig.referralTrend.direction === "declining" ? "falling" : "steady";
    return (
      <section aria-label="AI crawlers and referrals" className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <div className={HEAD}>AI is reading your site</div>
          {sig.latestDate ? <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">through {sig.latestDate}</span> : null}
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {referralLine ? (
            <p className="rounded-xl bg-emerald-50/70 px-3 py-2 text-[12px] font-medium text-emerald-800 sm:col-span-2 dark:bg-emerald-950/30 dark:text-emerald-200">
              {referralLine}
            </p>
          ) : null}
          {engineGapLine ? (
            <p className="rounded-xl bg-amber-50/70 px-3 py-2 text-[12px] font-medium text-amber-800 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-200">
              {engineGapLine}
            </p>
          ) : null}
          {aiOverviewGapLine ? (
            <p className="rounded-xl bg-amber-50/70 px-3 py-2 text-[12px] font-medium text-amber-800 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-200">
              {aiOverviewGapLine}
            </p>
          ) : null}
          {funnelLine || funnelRows.length > 0 ? (
            <div className="rounded-xl bg-gray-50 px-3 py-2 sm:col-span-2 dark:bg-neutral-800/60">
              <div className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">Where pages stall on the way to AI visitors</div>
              {funnelLine ? <p className="mt-0.5 text-[12px] text-gray-500 dark:text-neutral-400">{funnelLine}</p> : null}
              {funnelRows.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {funnelRows.map((f) => (
                    <p key={f.pagePath} className="text-[12px] text-gray-600 dark:text-neutral-300">
                      <span className="font-semibold text-gray-800 dark:text-neutral-200">{prettyPath(f.pagePath)}:</span> {f.bottleneckSentence}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {sig.hasBotData ? (
            <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-neutral-800/60">
              <div className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">
                AI crawlers read {sig.botSummary.pages} page{sig.botSummary.pages === 1 ? "" : "s"} ({sig.botSummary.totalHits.toLocaleString()} visits)
              </div>
              {topBots.length > 0 ? (
                <p className="mt-0.5 text-[12px] text-gray-500 dark:text-neutral-400">
                  Most active: {topBots.map((b: { bot: string; hits: number }) => `${b.bot} (${b.hits.toLocaleString()})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {sig.hasReferralData ? (
            <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-neutral-800/60">
              <div className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">
                AI answers sent {sig.referralSummary.totalVisits.toLocaleString()} visitor{sig.referralSummary.totalVisits === 1 ? "" : "s"} ({trendWord})
              </div>
              {topSources.length > 0 ? (
                <p className="mt-0.5 text-[12px] text-gray-500 dark:text-neutral-400">
                  From: {topSources.map((s: { source: string; visits: number }) => `${s.source} (${s.visits.toLocaleString()})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {llmMentions.length > 0 ? (
            <div className="rounded-xl bg-gray-50 px-3 py-2 sm:col-span-2 dark:bg-neutral-800/60">
              <div className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">What AI answers cite for your topics (live check)</div>
              <div className="mt-1 space-y-0.5">
                {llmMentions.slice(0, 4).map((r) => {
                  const us = slug ? r.mentions.some((m) => m.domain.includes(slug)) : false;
                  const rivals = r.mentions.filter((m) => !slug || !m.domain.includes(slug)).slice(0, 3);
                  return (
                    <p key={r.topic} className="text-[12px] text-gray-600 dark:text-neutral-300">
                      <span className="font-semibold text-gray-800 dark:text-neutral-200">{r.topic}:</span>{" "}
                      {us ? <span className="font-medium text-emerald-700 dark:text-emerald-300">cites you</span> : <span className="font-medium text-amber-700 dark:text-amber-300">does not cite you</span>}
                      {rivals.length > 0 ? <span className="text-gray-500 dark:text-neutral-400"> · also {rivals.map((m) => m.domain).join(", ")}</span> : null}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}

/** Item 14 - this week's query spikes ($0 store read from last night's radar pass),
 *  each deep-linked to its matching worklist change when one exists. The match runs
 *  against the cached WORKLIST SURFACE rows (the exact rows /worklist renders, $0
 *  read, no compute on miss) and only rows in the default To do / Ready views, so
 *  the "See the matching change" link can never land on an empty filter. Fail-soft
 *  to sentence-only rows; silence when nothing is spiking. */
async function loadSpikeRows(tenantId: string): Promise<Array<{ spike: QuerySpike; searchTerm: string | null }>> {
  const spikes = (await loadQuerySpikes(tenantId).catch(() => [])).slice(0, 2);
  if (spikes.length === 0) return [];
  const surface = await readWorklistSurface().catch(() => null);
  const moves: MatchableMove[] = (surface?.data.moves ?? [])
    .filter((m) => {
      const view = statusView(
        deriveStatus({ proofStatus: m.proofStatus, alreadyMeasuring: m.alreadyMeasuring, pageMeasuring: m.pageMeasuring }),
      );
      return view === "todo" || view === "ready";
    })
    .map((m) => ({ label: m.pageLabel, query: m.query, ownedUrl: m.targetUrl }));
  return spikes.map((spike) => ({ spike, searchTerm: matchSpikeToMove(spike, moves)?.searchTerm ?? null }));
}

/** Master plan item 21 - the single most urgent upcoming seasonal window ($0 store read from
 *  last night's seasonality pass over the permanent GSC monthly archive). Seasonal windows
 *  arrive ranked soonest-prep-deadline-first, so the first row is the one this slot shows;
 *  null when nothing is due (the row stays silent, never a placeholder). */
async function loadTopSeasonalRow(tenantId: string): Promise<SeasonalQuery | null> {
  const seasonal = await loadSeasonalQueries(tenantId).catch(() => [] as SeasonalQuery[]);
  return seasonal[0] ?? null;
}

/** Master plan item 24 - the single biggest Farsi/Finglish language gap ($0 store read
 *  from last night's language-gap matrix pass). Gaps arrive ranked biggest-impressions-
 *  first, so the first row is the one this slot shows; null when nothing is found (the
 *  row stays silent, never a placeholder). */
async function loadTopLanguageGapRow(tenantId: string): Promise<LanguageGap | null> {
  const gaps = await loadLanguageGaps(tenantId).catch(() => [] as LanguageGap[]);
  return gaps[0] ?? null;
}

/** Market demand (DataForSEO teammate): real search demand you don't own yet, from the cached
 *  keyword universe, PLUS this week's query spikes from your own Google data (item 14).
 *  Self-hides until keyword research has run AND nothing is spiking; once research HAS run and
 *  found no gap, that is a finding worth one quiet card (item 21), never a blank space. */
export async function DemandOpportunitiesSection({ tenantId }: { tenantId: string }) {
  try {
    const [res, spikeRows, seasonalRow, languageGapRow] = await Promise.all([
      loadDemandOpportunities(tenantId, { limit: 5 }),
      loadSpikeRows(tenantId),
      loadTopSeasonalRow(tenantId),
      loadTopLanguageGapRow(tenantId),
    ]);
    // Research never ran and nothing is spiking, seasonal, or a language gap: nothing
    // honest to say yet, stay silent.
    if (res.keywordsConsidered === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow) return null;
    if (res.opportunities.length === 0 && res.trends.length === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow) {
      // Item 21 - designed empty state: keyword research DID run and found no new gap.
      return (
        <section aria-label="Demand opportunities" className={CARD}>
          <div className="flex items-center gap-3">
            <QuietCheckIllustration />
            <div className="min-w-0">
              <div className={HEAD}>Demand you do not own yet</div>
              <p className="mt-0.5 text-[13px] text-gray-600 dark:text-neutral-300">No new demand gaps this week. Your pages already cover what people search for.</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">I checked {res.keywordsConsidered.toLocaleString()} keywords against your pages.</p>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section aria-label="Demand opportunities" className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <div className={HEAD}>Demand you do not own yet</div>
          {res.keywordsConsidered > 0 ? (
            <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">{res.keywordsConsidered.toLocaleString()} keywords researched</span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">
          {spikeRows.length > 0
            ? "Searches moving this week in your own Google data, then gaps from keyword research."
            : "Real monthly searches (DataForSEO) where no page of yours is the answer today."}
        </p>
        <div className="mt-2 space-y-1.5">
          {/* Item 14 - this week's query spikes: time-boxed demand from last night's radar pass. */}
          {spikeRows.map(({ spike, searchTerm }) => (
            <div key={`s-${spike.query}`} className="rounded-xl bg-amber-50/70 px-3 py-2 dark:bg-amber-950/30">
              <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">{spike.sentence}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-amber-800/90 dark:text-amber-300/90">
                {spike.topPage ? <span>Your best matching page: {prettyPath(spike.topPage)}.</span> : null}
                <span>Worth a same-week answer.</span>
                {searchTerm ? (
                  <Link
                    href={`/worklist?search=${encodeURIComponent(searchTerm)}`}
                    className={`rounded-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 ${FOCUS}`}
                  >
                    See the matching change
                  </Link>
                ) : null}
              </p>
            </div>
          ))}
          {/* Master plan item 21 - the single most urgent upcoming seasonal window, from the
              permanent GSC monthly archive. Below the spikes; silent when nothing is due. */}
          {seasonalRow ? (
            <div key={`season-${seasonalRow.query}`} className="rounded-xl bg-sky-50/70 px-3 py-2 dark:bg-sky-950/30">
              <p className="text-[13px] font-medium text-sky-900 dark:text-sky-200">{seasonalRow.sentence}</p>
              {seasonalRow.topPage ? (
                <p className="mt-0.5 text-[12px] text-sky-800/90 dark:text-sky-300/90">Your best matching page: {prettyPath(seasonalRow.topPage)}.</p>
              ) : null}
            </div>
          ) : null}
          {/* Master plan item 24 - the single biggest Farsi/Finglish language gap, from last
              night's language-gap matrix pass. Below the seasonal row; silent when none found. */}
          {languageGapRow ? (
            <div key={`lang-${languageGapRow.page}`} className="rounded-xl bg-violet-50/70 px-3 py-2 dark:bg-violet-950/30">
              <p className="text-[13px] font-medium text-violet-900 dark:text-violet-200">{languageGapRow.sentence}</p>
              <p className="mt-0.5 text-[12px] text-violet-800/90 dark:text-violet-300/90">Page: {prettyPath(languageGapRow.page)}.</p>
            </div>
          ) : null}
          {res.opportunities.slice(0, 5).map((o) => (
            <div key={o.id} className="flex flex-wrap items-baseline gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-neutral-800/60">
              <span className="text-[13px] font-semibold text-gray-800 dark:text-neutral-200">{o.primaryKeyword}</span>
              {o.estDemand > 0 ? (
                <span className="text-[11px] text-gray-500 dark:text-neutral-400">{o.estDemand.toLocaleString()} searches/mo</span>
              ) : null}
              <Link href="#new-pages" className={`ml-auto rounded-sm text-[11px] font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400 ${FOCUS}`}>
                {String(o.action).replace(/_/g, " ")} below
              </Link>
            </div>
          ))}
          {res.trends.slice(0, 2).map((t) => (
            <div key={`t-${t.id}`} className="flex flex-wrap items-baseline gap-2 rounded-xl bg-emerald-50/60 px-3 py-2 dark:bg-emerald-950/30">
              <span className="text-[13px] font-semibold text-gray-800 dark:text-neutral-200">{t.query}</span>
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300">{t.seasonal ? "seasonal, peak coming" : `trend ${String(t.trend)}`}</span>
              {typeof t.estDemand === "number" && t.estDemand > 0 ? (
                <span className="text-[11px] text-gray-500 dark:text-neutral-400">{t.estDemand.toLocaleString()} searches/mo</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    );
  } catch {
    return null;
  }
}

/** Item 49 - the war room self-summarizes when quiet. Re-runs the same presence checks the
 *  sections above rely on and renders ONE line only when every band would stay fully silent
 *  (render null, not even a designed empty state), so a clean day reads as a deliberate
 *  "all clear" instead of a heading over nothing.
 *
 *  COST: this adds no real work to the request. loadClarityPageSignalsForTenant and
 *  loadBotReferralSignals are react.cache request-memoized, so the section components have
 *  already paid for these exact calls in this same request and we get the memoized results
 *  for free; readAllCachedLlmMentions and loadDemandOpportunities are $0 local-cache reads
 *  (no paid API call ever happens on render, and the demand graph read inside is react.cache
 *  memoized too). Each check fails soft to "quiet", matching how the sections fail soft to null. */
export async function WarRoomQuietLine({ tenantId }: { tenantId: string }) {
  const [clarityQuiet, aiQuiet, demandQuiet] = await Promise.all([
    // Friction band renders something whenever Clarity has page signals (rows or the
    // item-21 empty state), so quiet = no signals at all.
    loadClarityPageSignalsForTenant(tenantId)
      .then((signals) => signals.size === 0)
      .catch(() => true),
    // AI band renders when any of its six feeds has data.
    Promise.all([
      loadBotReferralSignals(tenantId),
      readAllCachedLlmMentions().catch(() => []),
      loadEngineGapTodayLine(tenantId).catch(() => null),
      loadAiReferralSummary(tenantId).catch(() => null),
      // Item 7: react cache shares this read with the AI band above, so it is free here.
      currentTenantSlug()
        .then((slug) => (slug ? loadCrawlCitationFunnel(tenantId, slug) : null))
        .catch(() => null),
      // Item 20: react cache shares this read with the AI band above, so it is free here.
      loadAiOverviewGapTodayLine(tenantId).catch(() => null),
    ])
      .then(
        ([sig, mentions, gapLine, referrals, funnel, aiOverviewGapLine]) =>
          !sig.hasData &&
          mentions.length === 0 &&
          !gapLine &&
          !(referrals && referrals.hasData) &&
          !(funnel && funnel.hasData) &&
          !aiOverviewGapLine,
      )
      .catch(() => true),
    // Demand band renders whenever keyword research has run (gaps or the item-21 empty
    // state) OR a query spike exists (item 14, a $0 store read) OR a seasonal window is
    // due (master plan item 21, a $0 store read) OR a language gap is found (master plan
    // item 24, a $0 store read), so quiet = research never ran, nothing surfaced, nothing
    // is spiking, nothing seasonal is due, and no language gap was found.
    Promise.all([
      loadDemandOpportunities(tenantId, { limit: 5 }),
      loadQuerySpikes(tenantId).catch(() => []),
      loadTopSeasonalRow(tenantId).catch(() => null),
      loadTopLanguageGapRow(tenantId).catch(() => null),
    ])
      .then(
        ([res, spikes, seasonalRow, languageGapRow]) =>
          res.keywordsConsidered === 0 &&
          res.opportunities.length === 0 &&
          res.trends.length === 0 &&
          spikes.length === 0 &&
          !seasonalRow &&
          !languageGapRow,
      )
      .catch(() => true),
  ]);
  if (!clarityQuiet || !aiQuiet || !demandQuiet) return null;
  return (
    <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-2.5 text-[13px] text-gray-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
      The team found nothing urgent beyond tonight&apos;s picks. Clean day.
    </p>
  );
}
