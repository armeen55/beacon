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
import { currentTenantSlug } from "@/lib/tenant-context";
import { loadDemandOpportunities } from "@/domains/demand/load-demand-opportunities";
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
    const [sig, llmMentions, slug, engineGapLine] = await Promise.all([
      loadBotReferralSignals(tenantId),
      readAllCachedLlmMentions().catch(() => []),
      currentTenantSlug().catch(() => ""),
      // Item 4: one honest line from last night's 4-engine question check ($0 store read).
      loadEngineGapTodayLine(tenantId).catch(() => null),
    ]);
    if (!sig.hasData && llmMentions.length === 0 && !engineGapLine) return null;
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
          {engineGapLine ? (
            <p className="rounded-xl bg-amber-50/70 px-3 py-2 text-[12px] font-medium text-amber-800 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-200">
              {engineGapLine}
            </p>
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

/** Market demand (DataForSEO teammate): real search demand you don't own yet, from the cached
 *  keyword universe. Self-hides until keyword research has run; once research HAS run and
 *  found no gap, that is a finding worth one quiet card (item 21), never a blank space. */
export async function DemandOpportunitiesSection({ tenantId }: { tenantId: string }) {
  try {
    const res = await loadDemandOpportunities(tenantId, { limit: 5 });
    // Research never ran: nothing honest to say yet, stay silent.
    if (res.keywordsConsidered === 0) return null;
    if (res.opportunities.length === 0 && res.trends.length === 0) {
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
          <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">{res.keywordsConsidered.toLocaleString()} keywords researched</span>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Real monthly searches (DataForSEO) where no page of yours is the answer today.</p>
        <div className="mt-2 space-y-1.5">
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
    // AI band renders when any of its three feeds has data.
    Promise.all([
      loadBotReferralSignals(tenantId),
      readAllCachedLlmMentions().catch(() => []),
      loadEngineGapTodayLine(tenantId).catch(() => null),
    ])
      .then(([sig, mentions, gapLine]) => !sig.hasData && mentions.length === 0 && !gapLine)
      .catch(() => true),
    // Demand band renders whenever keyword research has run (gaps or the item-21 empty
    // state), so quiet = research never ran and nothing surfaced.
    loadDemandOpportunities(tenantId, { limit: 5 })
      .then((res) => res.keywordsConsidered === 0 && res.opportunities.length === 0 && res.trends.length === 0)
      .catch(() => true),
  ]);
  if (!clarityQuiet || !aiQuiet || !demandQuiet) return null;
  return (
    <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-2.5 text-[13px] text-gray-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
      The team found nothing urgent beyond tonight&apos;s picks. Clean day.
    </p>
  );
}
