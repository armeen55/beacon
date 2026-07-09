/**
 * War-room sections (2026-07-01, R3) - the "everything in one" intelligence bands under the
 * team's picks on Today. Each section is a thin server component over a LIVE domain loader
 * (the loaders survived the June cockpit fold; the UI did not - this restores the strongest
 * coherent version, not the old museum). Every section self-hides when it has no real data,
 * fails soft to null, and speaks operator language. No em dashes, no lab jargon.
 *
 * FP6b-3 (2026-07-02) - migrated onto the FP6a design system: Pill for every status/severity
 * chip (the six intents), tokens for every gray/border/background, and the five-size type
 * scale. Every band is a <section> (id/aria-label anchors matter here - #daily-experiments,
 * #friction-fixes, etc.), so containers use the shared CARD constant, which mirrors Card's
 * own default-variant classes exactly (same precedent as daily-experiments-section.tsx's
 * top-level <section id="daily-experiments">, not the Card component itself). The per-teammate
 * identity colors on the Demand band rows (amber=this-week spike, sky=seasonal, rose=fading,
 * emerald=heating up, violet=new page / language gap) are a deliberate exception, same
 * precedent as today-moves-card.tsx's TONE map and today-newpages-card.tsx: they mark WHICH
 * teammate/category found a thing, not a verdict, so they don't map onto the six Pill intents.
 * Kept as one-off classes with a comment at each use, dark: variants dropped to match the
 * fully-migrated siblings. No logic changed.
 */
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { routeClarityFriction, type ClarityMoveType, type ClarityMoveDecision } from "@/domains/recommendation-intelligence/clarity-move-router";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { loadEngineGapTodayLine } from "@/domains/ai-visibility/gap-store";
import { loadAiReferralSummary, aiReferralTodayLine } from "@/domains/ai-visibility/ai-referrals";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { funnelSummaryLine, type FunnelReport } from "@/domains/ai-visibility/crawl-citation-funnel";
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
import { loadRefreshQueue } from "@/domains/refresh/refresh-store";
import { briefSentences, type RefreshBrief } from "@/domains/refresh/refresh-brief";
// R17a (striking-distance portfolio, v1 267) - the demand band's "close to the
// top" line, from the SAME loader the keywords hero reads (one number, two
// surfaces). Self-hides under the query-count floor.
import { loadStrikingPortfolio } from "@/domains/gsc/load-striking-portfolio";
import { readWorklistSurface } from "./worklist-surface-store";
import { dossierHref } from "@/lib/page-dossier-link";
import { deriveStatus, statusView } from "@/domains/changes/canonical-change";
import Link from "next/link";
import { WarRoomCopyButton } from "./war-room-copy-button";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { Pill, type PillIntent } from "@/components/ui/pill";

// These sections are <section> elements (aria-label/id anchors matter here), so they can't be
// the Card component itself (always a div) - CARD mirrors Card's own "default" variant token
// classes exactly, same tokens, same radius, just on a semantic element.
const CARD = "rounded-xl border border-border bg-card p-4 beacon-rise-in";
const HEAD = "text-meta font-semibold uppercase tracking-wide text-muted-foreground";
/** Item 23 - shared visible keyboard-focus ring for interactive elements in the war-room bands. */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

function prettyPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 48 ? p.slice(0, 45) + "..." : p;
}

/** A8 (operator-experience fix batch, 2026-07-02) - below this many sessions, a
 *  percentage reads as more precise than it is (49.6% off 6 sessions). Below the
 *  floor, pair the rate with the raw count behind it so the reader can judge the
 *  sample size themselves. Pure, display-only; does not change which pages route
 *  to a fix (routeClarityFriction's own thresholds are untouched). */
const SMALL_SAMPLE_SESSION_FLOOR = 30;

/** Cold-tenant fix (2026-07-07): the friction band's "clean day" reassurance must
 *  only fire when at least one page had ENOUGH traffic to judge. This mirrors
 *  clarity-move-router's own minSessions floor (a page below it routes to null, so
 *  it is invisible to the router either way) - below it we cannot honestly say a
 *  page is clean, only that we have not seen enough visits yet. Display-only; it
 *  does not change routing, which the router still gates itself. */
const FRICTION_EVALUABLE_SESSION_FLOOR = 20;

function smallSampleCount(d: ClarityMoveDecision, sessions: number): string | null {
  if (sessions >= SMALL_SAMPLE_SESSION_FLOOR || sessions <= 0) return null;
  const numeratorFor: Record<ClarityMoveType, keyof ClarityPageSignal | null> = {
    fix_dead_click: "deadClicks",
    fix_rage_interaction: "rageClicks",
    fix_js_errors: "scriptErrors",
    fix_intent_mismatch: "quickbacks",
    raise_answer: null, // scroll depth has no clean "N of M" numerator
  };
  const key = numeratorFor[d.moveType];
  if (!key) return null;
  const n = Math.round(sessions * parseRateFromEvidence(d.evidence));
  return `${n} of ${sessions} visitor${sessions === 1 ? "" : "s"}`;
}

/** Pulls the leading "NN.N%" (or "NN%") out of an evidence sentence like
 *  "49.6% dead-click rate" back into a 0-1 fraction. Falls back to 0 (renders
 *  "0 of N") rather than throwing if the evidence format ever changes shape. */
function parseRateFromEvidence(evidence: string): number {
  const m = evidence.match(/^([\d.]+)%/);
  if (!m) return 0;
  const pct = Number(m[1]);
  return Number.isFinite(pct) ? pct / 100 : 0;
}

/** Task A (2026-07-02, operator-experience) - one horizontal stage of the crawl-to-conversion
 *  funnel. Pure display shape derived from data the AI band already loaded (funnel.pages /
 *  funnel.stageCounts); no new reads. */
type FunnelStageBlock = {
  key: string;
  label: string;
  count: number;
  /** true on the stage where the count first drops below the previous stage - the
   *  honest "this is where it stalls" highlight. */
  isStall: boolean;
};

/** Turns the already-loaded funnel report into the 4 named stages (Crawled -> Cited ->
 *  Visited -> Converted) PLUS the one honest stall sentence, using ONLY fields the AI band
 *  already fetched (funnel.pages, funnel.stageCounts, funnel.feeds). Since PageFunnel.stage is
 *  the FURTHEST proven step for a page, each later stage's count is a subset of the one before
 *  it, so these four numbers are genuinely cumulative (a real funnel, not four independent
 *  tallies). The stall is the first stage whose count is strictly less than the one before it
 *  and less than the very first stage (so a flat "0 crawled" funnel does not highlight amber
 *  everywhere) - that is where the drop-off actually starts. PURE, no I/O. */
function deriveFunnelStages(funnel: FunnelReport): { stages: FunnelStageBlock[]; stallLine: string | null } {
  const crawled = funnel.pages.length; // every page in the report was seen by at least one AI feed
  const cited = funnel.stageCounts.cited_no_clicks + funnel.stageCounts.converting;
  const visited = funnel.stageCounts.converting;
  const converted = funnel.pages.filter((p) => p.stage === "converting" && p.aiClicks.keyEvents > 0).length;

  const raw: Array<{ key: string; label: string; count: number }> = [
    { key: "crawled", label: "Crawled", count: crawled },
    { key: "cited", label: "Cited", count: cited },
    { key: "visited", label: "Visited", count: visited },
    { key: "converted", label: "Converted", count: converted },
  ];

  let stallKey: string | null = null;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].count < raw[i - 1].count) {
      stallKey = raw[i].key;
      break;
    }
  }

  const stages: FunnelStageBlock[] = raw.map((r) => ({ ...r, isStall: r.key === stallKey }));

  // The honest one-liner: reuse the exact bottleneck sentence the pure funnel module already
  // wrote for the worst-ranked stalled page (same $0 data, no new copy invented here). Prefer a
  // stalled page whose stage matches the stall we just highlighted so the sentence explains the
  // SAME gap the bars show.
  const stallStageName = stallKey === "cited" ? "cited_no_clicks" : stallKey === "visited" ? "crawled_not_cited" : stallKey === "converted" ? "converting" : null;
  const stallPage =
    (stallStageName ? funnel.stalled.find((p) => p.stage === stallStageName) : null) ?? funnel.stalled[0] ?? null;
  const stallLine = stallPage ? stallPage.bottleneckSentence : null;

  return { stages, stallLine };
}

/** Item 21 - tiny decorative all-clear mark for the designed empty states. Pure decoration,
 *  hidden from screen readers (the sentence next to it carries the meaning). */
function QuietCheckIllustration() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <circle cx="20" cy="20" r="18" className="fill-status-success-bg" />
      <circle cx="20" cy="20" r="18" fill="none" strokeWidth="1.5" className="stroke-status-success/25" />
      <path d="M13 20.5l4.5 4.5L27 15.5" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-status-success" />
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
    // FP1 (2026-07-02) - deadline-bounded so this band's pulse skeleton can never strand.
    const raced = await loadWithDeadline(loadClarityPageSignalsForTenant(tenantId));
    if (raced.timedOut) return <HonestDelay />;
    const signals = raced.data;
    if (signals.size === 0) return null;
    const allRouted = [...signals.values()]
      .map((s) => ({ s, d: routeClarityFriction(s) }))
      .filter((x): x is { s: (typeof x)["s"]; d: NonNullable<(typeof x)["d"]> } => x.d != null)
      .sort((a, b) => (a.d.severity === b.d.severity ? b.s.sessions - a.s.sessions : a.d.severity === "high" ? -1 : 1));
    // A3 (operator-experience fix batch, 2026-07-02) - the total here (allRouted.length) is the
    // SAME number the team standup's "Behavior" chip reports (both call routeClarityFriction over
    // every signal), so this card's "showing N of M" always agrees with that chip instead of the
    // two silently disagreeing (this card only ever showed its top 4 with no total).
    const totalFriction = allRouted.length;
    const rows = allRouted.slice(0, 4);
    if (rows.length === 0) {
      // Cold-tenant fix (2026-07-07): a page below the session floor routes to null
      // the same as a page above it with no friction pattern, so an empty router
      // result alone cannot tell "clean" from "too few visits to judge". Only assert
      // a clean day when at least one page had enough traffic to actually evaluate.
      const evaluablePages = [...signals.values()].filter(
        (s) => (s.sessions ?? 0) >= FRICTION_EVALUABLE_SESSION_FLOOR,
      ).length;
      if (evaluablePages === 0) {
        // Honest low-traffic state: I watched, but no page has enough visits yet to
        // call its experience good or bad. Do not claim a win we cannot see.
        return (
          <section id="friction-fixes" aria-label="Visitor friction fixes" className={CARD}>
            <div className="min-w-0">
              <div className={HEAD}>Visitor behavior</div>
              <p className="mt-0.5 text-body text-foreground-secondary">Not enough visits yet to judge page experience.</p>
              <p className="mt-0.5 text-meta tabular-nums text-muted-foreground">I watched sessions on {signals.size.toLocaleString()} page{signals.size === 1 ? "" : "s"} from the last 28 days, but none has enough traffic to call yet. I will flag any friction as soon as one does.</p>
            </div>
          </section>
        );
      }
      // Item 21 - designed empty state: real pages cleared the traffic floor and none
      // crossed the friction thresholds. That is a genuine clean day worth saying.
      return (
        <section id="friction-fixes" aria-label="Visitor friction fixes" className={CARD}>
          <div className="flex items-center gap-3">
            <QuietCheckIllustration />
            <div className="min-w-0">
              <div className={HEAD}>Visitor behavior</div>
              <p className="mt-0.5 text-body text-foreground-secondary">No friction found this week. Clean pages.</p>
              <p className="mt-0.5 text-meta tabular-nums text-muted-foreground">I watched sessions on {signals.size.toLocaleString()} page{signals.size === 1 ? "" : "s"} from the last 28 days, {evaluablePages.toLocaleString()} with enough traffic to judge.</p>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section id="friction-fixes" aria-label="Visitor friction fixes" className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <div className={HEAD}>Visitor behavior found friction</div>
          <span className="text-meta tabular-nums text-muted-foreground">
            {totalFriction > rows.length ? `showing ${rows.length} of ${totalFriction} pages` : `${rows.length} page${rows.length === 1 ? "" : "s"}`} · sessions from the last 28 days
          </span>
        </div>
        {/* Task B (2026-07-02) - one compact line per page instead of a repeated paragraph:
            page link, a severity bar (width = rate, amber -> red as severity rises), the rate
            + small-sample raw count, and the existing Copy-the-fix button. The explainer
            sentence that used to repeat on every row now appears once, as a footnote below. */}
        <div className="mt-2 space-y-1.5">
          {rows.map(({ s, d }) => {
            // A8 - a rate off a small sample reads as more precise than it is (e.g. "49.6%"
            // from 6 sessions). Below 30 sessions, add the raw count alongside the percent so
            // the reader can judge the sample size for themselves.
            const rawCount = smallSampleCount(d, s.sessions);
            const rate = parseRateFromEvidence(d.evidence);
            const barPct = Math.max(Math.round(rate * 100), rate > 0 ? 4 : 0);
            const href = dossierHref(s.url);
            // Severity is a real verdict (high = act now, medium = queued), so it rides the
            // matching Pill intent colors (attention/waiting) instead of a one-off palette class.
            const severityIntent: PillIntent = d.severity === "high" ? "attention" : "waiting";
            const barColor = d.severity === "high" ? "bg-status-danger" : "bg-status-warning";
            return (
              <div key={s.url} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface-raised px-3 py-2">
                <Pill intent={severityIntent} className="shrink-0">{CLARITY_MOVE_LABEL[d.moveType]}</Pill>
                {href ? (
                  <Link href={href} className={`shrink-0 text-body font-medium text-foreground-secondary underline underline-offset-2 hover:text-foreground ${FOCUS}`}>
                    {prettyPath(s.url)}
                  </Link>
                ) : (
                  <span className="shrink-0 text-body font-medium text-foreground-secondary">{prettyPath(s.url)}</span>
                )}
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-status-neutral-bg" aria-hidden="true">
                  <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
                </span>
                <span className="text-meta text-muted-foreground">
                  {d.evidence}
                  {rawCount ? ` (${rawCount})` : ""}
                </span>
                <WarRoomCopyButton text={`${CLARITY_MOVE_LABEL[d.moveType]} on ${s.url}\nEvidence: ${d.evidence}${rawCount ? ` (${rawCount})` : ""}\nWhy: ${d.reason}`} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-meta text-muted-foreground">Real visitor sessions on these pages hit problems. Fixing them protects every click the other changes win.</p>
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
    // FP1 (2026-07-02) - the whole feed bundle is deadline-bounded so this band's
    // pulse skeleton can never strand while one wedged feed holds the stream open.
    const raced = await loadWithDeadline(
      (async () => {
        const tenantSlug = await currentTenantSlug().catch(() => "");
        const feeds = await Promise.all([
          loadBotReferralSignals(tenantId),
          readAllCachedLlmMentions().catch(() => []),
          // Item 4: one honest line from last night's 4-engine question check ($0 store read).
          loadEngineGapTodayLine(tenantId).catch(() => null),
          // Item 6: real GA4 sessions that arrived FROM an AI assistant ($0 table read).
          loadAiReferralSummary(tenantId).catch(() => null),
          // Item 7: the per-page crawl to citation to visitors funnel ($0 joins of synced rows).
          tenantSlug ? loadCrawlCitationFunnel(tenantId, tenantSlug).catch(() => null) : Promise.resolve(null),
          // Item 20: Google AI Overview citation gap vs organic rank ($0 history read).
          loadAiOverviewGapTodayLine(tenantId).catch(() => null),
        ] as const);
        return { tenantSlug, feeds };
      })(),
    );
    if (raced.timedOut) return <HonestDelay />;
    const { tenantSlug: slug, feeds } = raced.data;
    const [sig, llmMentions, engineGapLine, referralSummary, funnel, aiOverviewGapLine] = feeds;
    const referralLine = referralSummary ? aiReferralTodayLine(referralSummary) : null;
    const funnelLine = funnel && funnel.hasData ? funnelSummaryLine(funnel) : null;
    const funnelRows = funnel && funnel.hasData ? funnel.stalled.slice(0, 3) : [];
    // Task A (2026-07-02) - the 4-stage horizontal funnel shape, derived purely from the
    // same `funnel` report (no new reads). Empty stage list when the funnel has no data so
    // the section falls back to the pre-existing text-only presence checks below unchanged.
    const { stages: funnelStages, stallLine: funnelStallLine } =
      funnel && funnel.hasData ? deriveFunnelStages(funnel) : { stages: [], stallLine: null };
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
          {sig.latestDate ? <span className="text-meta tabular-nums text-muted-foreground">through {sig.latestDate}</span> : null}
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {referralLine ? (
            <p className="rounded-xl bg-status-success-bg px-3 py-2 text-body font-medium text-status-success sm:col-span-2">
              {referralLine}
            </p>
          ) : null}
          {engineGapLine ? (
            <p className="rounded-xl bg-status-warning-bg px-3 py-2 text-body font-medium text-status-warning sm:col-span-2">
              {engineGapLine}
            </p>
          ) : null}
          {aiOverviewGapLine ? (
            <p className="rounded-xl bg-status-warning-bg px-3 py-2 text-body font-medium text-status-warning sm:col-span-2">
              {aiOverviewGapLine}
            </p>
          ) : null}
          {funnelLine || funnelRows.length > 0 ? (
            <div className="rounded-xl bg-surface-raised px-3 py-3 sm:col-span-2">
              <div className="text-body font-medium text-foreground-secondary">Where pages stall on the way to AI visitors</div>
              {/* Task A (2026-07-02) - a real 4-stage horizontal funnel (Crawled -> Cited ->
                  Visited -> Converted) instead of prose rows. Widths step down with the actual
                  count so the shape of the drop-off is visible at a glance; the stage where the
                  count first falls is highlighted amber with its honest one-liner underneath. */}
              <div className="mt-2 flex items-stretch gap-1.5">
                {funnelStages.map((stage) => {
                  const pct = funnelStages[0].count > 0 ? Math.max((stage.count / funnelStages[0].count) * 100, stage.count > 0 ? 14 : 6) : 6;
                  return (
                    <div key={stage.key} className="flex-1" style={{ flexGrow: Math.max(pct, 6) }}>
                      <div
                        className={`flex h-14 flex-col items-center justify-center rounded-lg border text-center ${
                          stage.isStall
                            ? "border-status-warning/30 bg-status-warning-bg"
                            : "border-border bg-card"
                        }`}
                        style={{ opacity: stage.count > 0 ? Math.max(pct / 100, 0.35) + 0.35 : 0.45 }}
                      >
                        <span
                          className={`text-sub font-semibold tabular-nums ${stage.isStall ? "text-status-warning" : "text-foreground-secondary"}`}
                        >
                          {stage.count.toLocaleString()}
                        </span>
                        <span
                          className={`text-meta font-medium uppercase tracking-wide ${stage.isStall ? "text-status-warning" : "text-muted-foreground"}`}
                        >
                          {stage.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {funnelStallLine ? (
                <p className="mt-1.5 rounded-lg bg-status-warning-bg px-2.5 py-1.5 text-body text-status-warning">{funnelStallLine}</p>
              ) : funnelLine ? (
                <p className="mt-1.5 text-body text-muted-foreground">{funnelLine}</p>
              ) : null}
              {funnelRows.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
                  {funnelRows.map((f) => {
                    const href = dossierHref(f.pagePath);
                    return href ? (
                      <Link
                        key={f.pagePath}
                        href={href}
                        className={`rounded-sm text-body font-medium text-foreground-secondary underline underline-offset-2 hover:text-foreground ${FOCUS}`}
                      >
                        {prettyPath(f.pagePath)}
                      </Link>
                    ) : (
                      <span key={f.pagePath} className="text-body font-medium text-muted-foreground">
                        {prettyPath(f.pagePath)}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
          {sig.hasBotData ? (
            <div className="rounded-xl bg-surface-raised px-3 py-2">
              <div className="text-body font-medium text-foreground-secondary">
                AI crawlers read {sig.botSummary.pages} page{sig.botSummary.pages === 1 ? "" : "s"} ({sig.botSummary.totalHits.toLocaleString()} visits)
              </div>
              {topBots.length > 0 ? (
                <p className="mt-0.5 text-body text-muted-foreground">
                  Most active: {topBots.map((b: { bot: string; hits: number }) => `${b.bot} (${b.hits.toLocaleString()})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {sig.hasReferralData ? (
            <div className="rounded-xl bg-surface-raised px-3 py-2">
              <div className="text-body font-medium text-foreground-secondary">
                AI answers sent {sig.referralSummary.totalVisits.toLocaleString()} visitor{sig.referralSummary.totalVisits === 1 ? "" : "s"} ({trendWord})
              </div>
              {topSources.length > 0 ? (
                <p className="mt-0.5 text-body text-muted-foreground">
                  From: {topSources.map((s: { source: string; visits: number }) => `${s.source} (${s.visits.toLocaleString()})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {llmMentions.length > 0 ? (
            <div className="rounded-xl bg-surface-raised px-3 py-2 sm:col-span-2">
              <div className="text-body font-medium text-foreground-secondary">What AI answers cite for your topics (live check)</div>
              <div className="mt-1 space-y-0.5">
                {llmMentions.slice(0, 4).map((r) => {
                  const us = slug ? r.mentions.some((m) => m.domain.includes(slug)) : false;
                  const rivals = r.mentions.filter((m) => !slug || !m.domain.includes(slug)).slice(0, 3);
                  return (
                    <p key={r.topic} className="text-body text-foreground-secondary">
                      <span className="font-semibold text-foreground-secondary">{r.topic}:</span>{" "}
                      {us ? <span className="font-medium text-status-success">cites you</span> : <span className="font-medium text-status-warning">does not cite you</span>}
                      {rivals.length > 0 ? <span className="text-muted-foreground"> · also {rivals.map((m) => m.domain).join(", ")}</span> : null}
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
 *  against the cached WORKLIST SURFACE rows (the exact rows /changes renders, $0
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

/** Master plan item 56 - the single worst FADING page ($0 store read from last night's
 *  refresh-queue pass over quarter-over-quarter GSC clicks). The queue arrives ranked
 *  worst-lost-clicks-first, so the first row is the one this slot shows; null when nothing
 *  is fading (the row stays silent, never a placeholder). The nightly plan builder reads the
 *  same queue, so the worst fades also arrive as ready-to-ship refresh picks (max 2/night). */
async function loadTopFadingRow(tenantId: string): Promise<RefreshBrief | null> {
  const queue = await loadRefreshQueue(tenantId).catch(() => [] as RefreshBrief[]);
  return queue[0] ?? null;
}

/** R17a (v1 267) - the demand band shows the striking-distance portfolio line
 *  only when MORE than this many searches qualify (a real portfolio, not a
 *  couple of rows the worklist already covers one by one). */
const STRIKING_BAND_MIN_QUERIES = 10;

/** Market demand (DataForSEO teammate): real search demand you don't own yet, from the cached
 *  keyword universe, PLUS this week's query spikes from your own Google data (item 14).
 *  Self-hides until keyword research has run AND nothing is spiking; once research HAS run and
 *  found no gap, that is a finding worth one quiet card (item 21), never a blank space. */
export async function DemandOpportunitiesSection({ tenantId }: { tenantId: string }) {
  try {
    // FP1 (2026-07-02) - deadline-bounded so this band's pulse skeleton can never strand.
    const raced = await loadWithDeadline(
      Promise.all([
        loadDemandOpportunities(tenantId, { limit: 5 }),
        loadSpikeRows(tenantId),
        loadTopSeasonalRow(tenantId),
        loadTopLanguageGapRow(tenantId),
        loadTopFadingRow(tenantId),
        // R17a (v1 267) - the striking-distance portfolio line, gated below to
        // a real portfolio (more than STRIKING_BAND_MIN_QUERIES searches).
        loadStrikingPortfolio(tenantId).catch(() => null),
      ] as const),
    );
    if (raced.timedOut) return <HonestDelay />;
    const [res, spikeRows, seasonalRow, languageGapRow, fadingRow, portfolioRaw] = raced.data;
    const strikingPortfolio =
      portfolioRaw && portfolioRaw.queryCount > STRIKING_BAND_MIN_QUERIES ? portfolioRaw : null;
    // Research never ran and nothing is spiking, seasonal, a language gap, fading,
    // or close to the top: nothing honest to say yet, stay silent.
    if (res.keywordsConsidered === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow && !fadingRow && !strikingPortfolio) return null;
    if (res.opportunities.length === 0 && res.trends.length === 0 && spikeRows.length === 0 && !seasonalRow && !languageGapRow && !fadingRow && !strikingPortfolio) {
      // Item 21 - designed empty state: keyword research DID run and found no new gap.
      return (
        <section aria-label="Demand opportunities" className={CARD}>
          <div className="flex items-center gap-3">
            <QuietCheckIllustration />
            <div className="min-w-0">
              <div className={HEAD}>Demand you do not own yet</div>
              <p className="mt-0.5 text-body text-foreground-secondary">No new demand gaps this week. Your pages already cover what people search for.</p>
              <p className="mt-0.5 text-meta tabular-nums text-muted-foreground">I checked {res.keywordsConsidered.toLocaleString()} keywords against your pages.</p>
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
            <span className="text-meta tabular-nums text-muted-foreground">{res.keywordsConsidered.toLocaleString()} keywords researched</span>
          ) : null}
        </div>
        <p className="mt-1 text-meta text-muted-foreground">
          {spikeRows.length > 0
            ? "Searches moving this week in your own Google data, then gaps from keyword research."
            : "Real monthly searches from keyword research where no page of yours is the answer today."}
        </p>
        {/* UX4 item 4 - the stream splits into its distinct tools under mini-headers instead of
            one long unlabeled list, so each teammate's kind of finding reads as its own idea:
            time-boxed movement this week, longer-running keyword-research gaps, and language
            gaps. A cluster with nothing to show renders no header at all.
            Below, each row cluster (this-week spikes, seasonal, fading, research gaps, heating-up
            trends, language gaps) keeps a DELIBERATE per-teammate identity hue (amber/sky/rose/
            gray/emerald/violet) instead of a Pill verdict - same precedent as today-moves-card.tsx's
            TONE map: these mark WHICH teammate found the row, not a live/waiting/won verdict. */}
        <div className="mt-2 space-y-3">
          {/* R17a (v1 267) - the striking-distance portfolio: searches already
              ranking just below the top, added up. Same number the keywords
              hero shows (one loader). Token-only row (no identity hue - this is
              your own Google data, not a teammate's external find). */}
          {strikingPortfolio ? (
            <div className="space-y-1.5">
              <p className="px-0.5 text-meta font-semibold text-muted-foreground">Close to the top already</p>
              <div className="rounded-xl bg-surface-raised px-3 py-2">
                <p className="text-body font-medium text-foreground-secondary tabular-nums">{strikingPortfolio.headline}</p>
                {strikingPortfolio.sizingLine ? (
                  <p className="mt-0.5 text-meta text-muted-foreground tabular-nums">{strikingPortfolio.sizingLine}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {(spikeRows.length > 0 || seasonalRow || fadingRow) ? (
            <div className="space-y-1.5">
              <p className="px-0.5 text-meta font-semibold text-muted-foreground">Searches moving this week</p>
              {/* Item 14 - this week's query spikes: time-boxed demand from last night's radar
                  pass. Identity color: amber marks "search demand" rows. */}
              {spikeRows.map(({ spike, searchTerm }) => (
                <div key={`s-${spike.query}`} className="rounded-xl bg-amber-50/70 px-3 py-2">
                  <p className="text-body font-medium text-amber-900">{spike.sentence}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-meta text-amber-800/90">
                    {spike.topPage ? <span>Your best matching page: {prettyPath(spike.topPage)}.</span> : null}
                    <span>Worth a same-week answer.</span>
                    {searchTerm ? (
                      <Link
                        href={`/changes?search=${encodeURIComponent(searchTerm)}`}
                        className={`rounded-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 ${FOCUS}`}
                      >
                        See the matching change
                      </Link>
                    ) : null}
                  </p>
                </div>
              ))}
              {/* Master plan item 21 - the single most urgent upcoming seasonal window, from the
                  permanent GSC monthly archive. Below the spikes; silent when nothing is due.
                  Identity color: sky marks "seasonal calendar" rows. */}
              {seasonalRow ? (
                <div key={`season-${seasonalRow.query}`} className="rounded-xl bg-sky-50/70 px-3 py-2">
                  <p className="text-body font-medium text-sky-900">{seasonalRow.sentence}</p>
                  {seasonalRow.topPage ? (
                    <p className="mt-0.5 text-meta text-sky-800/90">Your best matching page: {prettyPath(seasonalRow.topPage)}.</p>
                  ) : null}
                </div>
              ) : null}
              {/* Master plan item 56 - the single worst FADING page, from last night's refresh-queue
                  pass (quarter-over-quarter GSC clicks). Below the seasonal row; silent when
                  nothing is fading. The same queue feeds the nightly plan, so the fix is a plan
                  pick away, not a separate workflow. Identity color: rose marks "losing ground". */}
              {fadingRow ? (
                <div key={`fade-${fadingRow.page}`} className="rounded-xl bg-rose-50/70 px-3 py-2">
                  <p className="text-body font-medium text-rose-900">
                    {prettyPath(fadingRow.page)}: {fadingRow.rank.sentence}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-meta text-rose-800/90">
                    {briefSentences(fadingRow)[0] ? <span>{briefSentences(fadingRow)[0]}</span> : null}
                    <span>I put a refresh in tonight&apos;s plan when there is a concrete section to add.</span>
                    <Link
                      href="#daily-experiments"
                      className={`rounded-sm font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900 ${FOCUS}`}
                    >
                      See tonight&apos;s picks
                    </Link>
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          {(res.opportunities.length > 0 || res.trends.length > 0) ? (
            <div className="space-y-1.5">
              <p className="px-0.5 text-meta font-semibold text-muted-foreground">Research gaps</p>
              {res.opportunities.slice(0, 5).map((o) => (
                <div key={o.id} className="flex flex-wrap items-baseline gap-2 rounded-xl bg-surface-raised px-3 py-2">
                  <span className="text-body font-semibold text-foreground-secondary">{o.primaryKeyword}</span>
                  {o.estDemand > 0 ? (
                    <span className="text-meta text-muted-foreground">{o.estDemand.toLocaleString()} searches/mo</span>
                  ) : null}
                  {/* Identity color: violet marks "new page to build" rows (same hue as the
                      New Pages board it links into). */}
                  <Link href="#new-pages" className={`ml-auto rounded-sm text-meta font-medium text-violet-600 underline-offset-2 hover:underline ${FOCUS}`}>
                    {String(o.action).replace(/_/g, " ")} below
                  </Link>
                </div>
              ))}
              {/* Operator-experience checkpoint (2026-07-02, roasts #4/#16): the trends
                  block sat under the opportunities list with no heading and could repeat
                  the SAME keyword with a different demand number from a different source,
                  reading as the app contradicting itself. Dedupe against the keywords
                  already shown above and label the block so it reads as its own idea. */}
              {(() => {
                const shownKeywords = new Set(
                  res.opportunities.slice(0, 5).map((o) => o.primaryKeyword.trim().toLowerCase()),
                );
                const freshTrends = res.trends
                  .filter((t) => !shownKeywords.has(t.query.trim().toLowerCase()))
                  .slice(0, 2);
                if (freshTrends.length === 0) return null;
                return (
                  <>
                    <p className="mt-1 px-3 text-meta font-medium text-muted-foreground">
                      Heating up right now
                    </p>
                    {/* Identity color: emerald marks "climbing right now" rows. */}
                    {freshTrends.map((t) => (
                      <div key={`t-${t.id}`} className="flex flex-wrap items-baseline gap-2 rounded-xl bg-emerald-50/60 px-3 py-2">
                        <span className="text-body font-semibold text-foreground-secondary">{t.query}</span>
                        <span className="text-meta text-emerald-700">{t.seasonal ? "seasonal, peak coming" : "searches climbing"}</span>
                        {typeof t.estDemand === "number" && t.estDemand > 0 ? (
                          <span className="text-meta text-muted-foreground">{t.estDemand.toLocaleString()} searches/mo</span>
                        ) : null}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          ) : null}
          {/* Master plan item 24 - the single biggest Farsi/Finglish language gap, from last
              night's language-gap matrix pass; silent when none found. Identity color: violet
              marks "language gap" rows (a different shade family than the new-page violet link
              above, so it reads as its own row kind while the two never appear adjacent). */}
          {languageGapRow ? (
            <div className="space-y-1.5">
              <p className="px-0.5 text-meta font-semibold text-muted-foreground">Language gaps</p>
              <div key={`lang-${languageGapRow.page}`} className="rounded-xl bg-violet-50/70 px-3 py-2">
                <p className="text-body font-medium text-violet-900">{languageGapRow.sentence}</p>
                <p className="mt-0.5 text-meta text-violet-800/90">Page: {prettyPath(languageGapRow.page)}.</p>
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
  // FP1 (2026-07-02) - deadline-bounded (Suspense fallback is null, so a timeout
  // renders nothing; the "all clear" line simply stays silent this visit).
  // Operator spec 2026-07-09 B-9: the AI-crawlers band is off Today, so the quiet
  // check only considers the two bands that still render (friction + demand), and
  // the copy is first person - no "team", no "tonight's picks".
  const raced = await loadWithDeadline(loadQuietChecks(tenantId));
  if (raced.timedOut) return null;
  const [clarityQuiet, , demandQuiet] = raced.data;
  if (!clarityQuiet || !demandQuiet) return null;
  return (
    <p className="rounded-xl border border-border-subtle bg-surface-raised/60 px-4 py-2.5 text-body text-muted-foreground">
      I found nothing else that needs you today. Clean day.
    </p>
  );
}

function loadQuietChecks(tenantId: string): Promise<[boolean, boolean, boolean]> {
  return Promise.all([
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
    // item 24, a $0 store read) OR a page is fading (master plan item 56, a $0 store
    // read), so quiet = research never ran, nothing surfaced, nothing is spiking,
    // nothing seasonal is due, no language gap was found, and nothing is fading.
    Promise.all([
      loadDemandOpportunities(tenantId, { limit: 5 }),
      loadQuerySpikes(tenantId).catch(() => []),
      loadTopSeasonalRow(tenantId).catch(() => null),
      loadTopLanguageGapRow(tenantId).catch(() => null),
      loadTopFadingRow(tenantId).catch(() => null),
      // R17a (v1 267): react cache shares this read with the demand band above,
      // so it is free here. Same gate as the band (> STRIKING_BAND_MIN_QUERIES).
      loadStrikingPortfolio(tenantId).catch(() => null),
    ])
      .then(
        ([res, spikes, seasonalRow, languageGapRow, fadingRow, portfolio]) =>
          res.keywordsConsidered === 0 &&
          res.opportunities.length === 0 &&
          res.trends.length === 0 &&
          spikes.length === 0 &&
          !seasonalRow &&
          !languageGapRow &&
          !fadingRow &&
          !(portfolio && portfolio.queryCount > STRIKING_BAND_MIN_QUERIES),
      )
      .catch(() => true),
  ]);
}
