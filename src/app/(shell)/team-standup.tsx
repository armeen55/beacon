/**
 * TeamStandup (2026-07-01, FINAL PREMIUM PLAN item 43) - the teammates, at a glance, at the top
 * of Today: each specialist's identity chip with its one-line daily report. This is the "cool
 * teamwork" moment on first paint. Server component; every line is independently fail-soft and
 * honest (a teammate with nothing new says so; a teammate with no data says that). Reuses the
 * request-cached loaders the page already touches, so the strip costs almost nothing extra.
 */
import Link from "next/link";
import { teammateOf } from "@/domains/team/identity";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { routeClarityFriction } from "@/domains/recommendation-intelligence/clarity-move-router";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { readCachedSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { loadBotReferralSignals } from "@/domains/profound-deep/load-bot-referral-signals";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { loadTeamScoreboardView, loadActiveSpecialistWeights } from "@/domains/team-scoreboard/load-team-scoreboard";
import { recordLine } from "@/domains/team-scoreboard/brier";
import { buildCalibrationLine } from "@/domains/team-scoreboard/calibration";
import { currentTenantSlug } from "@/lib/tenant-context";
import { loadTeammateFreshness, type TeammateFreshnessMap } from "@/domains/team/source-freshness";
import { loadRecentDriftEvents, type DriftEventWithMatch } from "@/domains/ai-visibility/answer-drift-loader";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

type StandupLine = { key: string; line: string; active: boolean; title?: string; brief?: TeammateBrief };

/** Item 47 (2026-07-02) - the pill's inline briefing when the operator opens it: what this
 *  teammate watched, its key number, its current read, and one link to where its work lives.
 *  Built ONLY from data buildLines already loaded for the one-line chip text (zero new I/O). */
type TeammateBrief = {
  watched: string;
  number: string;
  concern: string;
  href: string;
  linkLabel: string;
};

/** Item 46 (2026-07-02, CARRY-OVER 115) - "honest degradation everywhere": the amber/red dot
 *  color for a teammate whose backing data source is stale or dead. Fresh (or no freshness claim
 *  for this teammate, e.g. the strategist has no connector) keeps the existing identity-color dot
 *  untouched. Pure presentational mapping, no new detection logic - source-freshness.ts already
 *  did the honest read. */
const FRESHNESS_DOT_COLOR: Record<"stale" | "dead", string> = { stale: "#d97706", dead: "#dc2626" };

/** A4 (operator-experience fix batch, 2026-07-02) - below this many topics checked, a
 *  "cite you on N of M" ratio reads as more confident than one sample deserves (1 of 1
 *  looks like a 100 percent finding). Report the raw count instead until there is a real
 *  sample to rate. */
const MIN_TOPICS_FOR_RATIO = 3;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Item 38 (2026-07-02) - "5 of 6" style record suffix for a chip, when that specialist has any
 *  settled votes in the last-computed scoreboard. Trivially additive: a lookup map built once from
 *  loadTeamScoreboardView, keyed by the same specialist id the chip already uses. Empty map when
 *  the scoreboard has never run (chips render exactly as before). */
function recordSuffixFor(records: Map<string, string>, key: string): string {
  const r = records.get(key);
  return r ? ` (${r})` : "";
}

/** Item 77 - "the answer changed this week" line for one drift event, treated like a
 *  lost or won ranking (the same plain, first-person, concrete voice the rest of the
 *  standup uses). A brand_dropped event reads as a loss; brand_added as a win;
 *  descriptor_changed as a neutral "here is what changed" note. Every field runs
 *  through stripBannedDashes since prompt text and answer sentences come from live
 *  AI output the operator never wrote. Pure string building, no I/O. */
function driftEventSentence(e: DriftEventWithMatch): string {
  const prompt = stripBannedDashes(e.promptText).trim();
  const engine = stripBannedDashes(e.engine).trim();
  const pageNote = e.relatedMoveLabel ? ` I already have an open move for ${stripBannedDashes(e.relatedMoveLabel).trim()}.` : "";
  if (e.kind === "brand_dropped") {
    const replacement = e.afterSentence ? stripBannedDashes(e.afterSentence).trim() : null;
    return (
      `${engine} stopped mentioning you on the question "${prompt}" this week.` +
      (replacement ? ` Here is the sentence that replaced you: "${replacement}"` : "") +
      pageNote
    );
  }
  if (e.kind === "brand_added") {
    return `${engine} started recommending you for "${prompt}" this week.` + pageNote;
  }
  const before = e.beforeSentence ? stripBannedDashes(e.beforeSentence).trim() : null;
  const after = e.afterSentence ? stripBannedDashes(e.afterSentence).trim() : null;
  return (
    `${engine} changed how it describes you on "${prompt}" this week.` +
    (before && after ? ` Before: "${before}" Now: "${after}"` : "") +
    pageNote
  );
}

async function buildLines(
  tenantId: string,
  picksTonight: number,
  records: Map<string, string>,
  calibrations: Map<string, string>,
  measuringCount: number,
): Promise<StandupLine[]> {
  const [daily, clarity, ga4, serp, keywords, aeo, ledger, llmMentions, slug] = await Promise.all([
    safe(() => loadDailyTotalsForTenant(tenantId, 21), []),
    safe(() => loadClarityPageSignalsForTenant(tenantId), new Map()),
    safe(() => loadGa4PageValuesForTenant(tenantId), new Map()),
    safe(() => readCachedSerpPatterns(), new Map()),
    safe(() => readAllCachedKeywordDemand(), []),
    safe(() => loadBotReferralSignals(tenantId), null),
    safe(() => loadShippedChanges(), []),
    safe(() => readAllCachedLlmMentions(), []),
    safe(() => currentTenantSlug(), ""),
  ]);

  const lines: StandupLine[] = [];

  // Search demand: last-7 vs prior-7 from whatever days exist.
  if (daily.length >= 14) {
    const last7 = daily.slice(-7).reduce((s, d) => s + d.clicks, 0);
    const prior7 = daily.slice(-14, -7).reduce((s, d) => s + d.clicks, 0);
    const delta = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;
    lines.push({
      key: "gsc",
      line: `${last7.toLocaleString()} clicks this week${delta != null ? ` (${delta >= 0 ? "+" : ""}${delta}%)` : ""}${recordSuffixFor(records, "gsc")}`,
      active: true,
      brief: {
        watched: `I watched your Google clicks over the last ${daily.length} days.`,
        number: `${last7.toLocaleString()} clicks this week.`,
        concern:
          delta == null
            ? "Not enough history yet to compare to last week."
            : delta > 3
              ? `That is up ${delta}% from the week before. Good direction.`
              : delta < -3
                ? `That is down ${Math.abs(delta)}% from the week before. I am watching it.`
                : "That is about flat versus last week.",
        href: "#scoreboard-section",
        linkLabel: "See the chart",
      },
    });
  }

  // Visitor behavior: pages with routable friction.
  const frictionPages = [...clarity.values()].filter((s) => routeClarityFriction(s) != null).length;
  lines.push({
    key: "clarity",
    line: `${frictionPages > 0 ? `friction on ${frictionPages} page${frictionPages === 1 ? "" : "s"}` : "no new friction"}${recordSuffixFor(records, "clarity")}`,
    active: frictionPages > 0,
    brief: {
      watched: `I watched real visitor sessions on ${clarity.size.toLocaleString()} page${clarity.size === 1 ? "" : "s"}.`,
      number:
        frictionPages > 0
          ? `${frictionPages} page${frictionPages === 1 ? "" : "s"} with friction.`
          : "0 pages with friction.",
      concern:
        frictionPages > 0
          ? "People are hitting dead clicks, errors, or the wrong answer on those pages."
          : "Nothing broken this week. Clean pages.",
      href: "#friction-fixes",
      linkLabel: "See the friction fixes",
    },
  });

  // Live Google results: research coverage.
  const serpCount = serp instanceof Map ? serp.size : 0;
  const kwCount = keywords.length;
  lines.push({
    key: "dataforseo",
    line: `${kwCount > 0 ? `${kwCount.toLocaleString()} keyword volumes, ${serpCount} live searches read` : "no keyword research yet"}${recordSuffixFor(records, "dataforseo")}`,
    active: kwCount > 0,
    brief: {
      watched: "I checked live Google results and keyword volumes for your topics.",
      number:
        kwCount > 0
          ? `${kwCount.toLocaleString()} keyword volumes, ${serpCount.toLocaleString()} live searches read.`
          : "0 keywords checked yet.",
      concern:
        kwCount > 0
          ? "This is what real people search and what is already ranking for it."
          : "I have not pulled fresh keyword research yet.",
      href: "/research/keywords",
      linkLabel: "See the keyword research",
    },
  });

  // AI citations: crawler + referral reality.
  if (aeo?.hasData) {
    lines.push({
      key: "profound",
      line: `AI sent ${aeo.referralSummary.totalVisits.toLocaleString()} visits, crawled ${aeo.botSummary.pages} pages${recordSuffixFor(records, "profound")}`,
      active: true,
      brief: {
        watched: `I watched AI crawlers and referrals across ${aeo.botSummary.pages.toLocaleString()} page${aeo.botSummary.pages === 1 ? "" : "s"}.`,
        number: `${aeo.referralSummary.totalVisits.toLocaleString()} visits sent from AI.`,
        concern: "This is real traffic AI answers are sending you, not a guess.",
        href: "/prompts",
        linkLabel: "See the AI questions",
      },
    });
  } else if (llmMentions.length > 0) {
    // Owned AI-visibility (DataForSEO LLM answers): are WE cited for the topics we checked?
    const citedUs = slug
      ? llmMentions.filter((r) => r.mentions.some((m) => m.domain.includes(slug))).length
      : 0;
    // A4 (operator-experience fix batch, 2026-07-02) - "1 of 1" reads as a 100 percent
    // finding off one sample. Below MIN_TOPICS_FOR_RATIO, report the raw count checked and
    // drop the ratio so a single-topic check never implies more confidence than it earned.
    const line =
      llmMentions.length < MIN_TOPICS_FOR_RATIO
        ? `${llmMentions.length} topic${llmMentions.length === 1 ? "" : "s"} checked so far${recordSuffixFor(records, "profound")}`
        : `AI answers cite you on ${citedUs} of ${llmMentions.length} topics checked${recordSuffixFor(records, "profound")}`;
    lines.push({
      key: "profound",
      line,
      active: citedUs > 0,
      brief: {
        watched: `I asked AI ${llmMentions.length} question${llmMentions.length === 1 ? "" : "s"} people actually search for.`,
        number:
          llmMentions.length < MIN_TOPICS_FOR_RATIO
            ? `${llmMentions.length} topic${llmMentions.length === 1 ? "" : "s"} checked so far.`
            : `Cited on ${citedUs} of ${llmMentions.length} topics.`,
        concern:
          citedUs > 0
            ? "AI is naming you in at least some answers."
            : "AI is not naming you yet on the topics I checked.",
        href: "/prompts",
        linkLabel: "See the AI questions",
      },
    });
  } else {
    lines.push({
      key: "profound",
      line: "watching who AI cites for your topics",
      active: false,
      brief: {
        watched: "I am watching who AI names when people ask about your topics.",
        number: "No AI checks recorded yet.",
        concern: "Nothing to report until the first check runs.",
        href: "/prompts",
        linkLabel: "See the AI questions",
      },
    });
  }

  // Revenue: pages carrying conversion value.
  const moneyPages = [...ga4.values()].filter((v) => (v as { conversions?: number }).conversions ?? 0 > 0).length;
  lines.push({
    key: "ga4",
    line: `${ga4.size > 0 ? `tracking value on ${moneyPages > 0 ? moneyPages : ga4.size} page${ga4.size === 1 ? "" : "s"}` : "no analytics data yet"}${recordSuffixFor(records, "ga4")}`,
    active: ga4.size > 0,
    brief: {
      watched: `I watched revenue and conversions across ${ga4.size.toLocaleString()} page${ga4.size === 1 ? "" : "s"}.`,
      number:
        ga4.size > 0
          ? `${moneyPages > 0 ? moneyPages : ga4.size} page${(moneyPages > 0 ? moneyPages : ga4.size) === 1 ? "" : "s"} carrying real value.`
          : "0 pages tracked yet.",
      concern:
        ga4.size > 0
          ? "These are the pages worth protecting and growing first."
          : "I do not have analytics data to work from yet.",
      href: "/changes",
      linkLabel: "Open Changes",
    },
  });

  // Strategist: tonight + the measurement book. A2 (operator-experience fix batch,
  // 2026-07-02) - "measuring" here is the SAME canonical proof-ledger count the counts
  // tile and the measuring list use (passed in), not a locally-recomputed number, so this
  // chip never disagrees with the rest of the page on how many changes are measuring.
  const won = ledger.filter((r) => r.verdict === "won").length;
  lines.push({
    key: "llm",
    line:
      (picksTonight > 0
        ? `picked ${picksTonight} change${picksTonight === 1 ? "" : "s"} tonight, ${measuringCount} measuring${won > 0 ? `, ${won} won` : ""}`
        : measuringCount > 0
          ? `${measuringCount} change${measuringCount === 1 ? "" : "s"} measuring${won > 0 ? `, ${won} won` : ""}`
          : "reviewing the next batch") + recordSuffixFor(records, "llm"),
    active: picksTonight > 0 || measuringCount > 0,
    brief: {
      watched: "I picked tonight's changes and I am tracking every change already live.",
      number:
        picksTonight > 0
          ? `${picksTonight} change${picksTonight === 1 ? "" : "s"} picked tonight.`
          : measuringCount > 0
            ? `${measuringCount} change${measuringCount === 1 ? "" : "s"} measuring.`
            : "No picks queued yet.",
      concern:
        won > 0
          ? `${won} of my changes have already won.`
          : measuringCount > 0
            ? "Still waiting on enough days of data to call a winner."
            : "I am reviewing the next batch of ideas now.",
      href: "#daily-experiments",
      linkLabel: "See tonight's picks",
    },
  });

  // Item 43 - each chip gains its own calibration line as a hover title when that specialist has
  // enough banded observations (calibration.ts's own 5-observation minimum already gates the map).
  for (const l of lines) {
    const calibration = calibrations.get(l.key);
    if (calibration) l.title = calibration;
  }

  return lines;
}

/** Item 38 (2026-07-02) - the scoreboard view for this render: the honest one-line footer (which
 *  specialist has called the most winners right so far, with its real won/n number - silent below
 *  5 settled-and-joined picks or when no specialist clears its own sample bar) plus a per-specialist
 *  "5 of 6" record map for the chips. Item 43 (2026-07-02) adds the accountability reads: the
 *  tenant's conviction-calibration line, its objection-track-record line (each independently silent
 *  below its own 5-observation minimum - see calibration.ts), and a per-specialist calibration-line
 *  map for the chips' hover titles. Reads the last-computed scoreboard only (no recompute on render -
 *  that runs from the measure-pass tail). Fail-soft -> everything silent/empty. */
async function loadScoreboardForStandup(tenantId: string): Promise<{
  footer: string | null;
  calibrationLine: string | null;
  objectionLine: string | null;
  weightLines: string[];
  records: Map<string, string>;
  calibrations: Map<string, string>;
}> {
  const empty = {
    footer: null,
    calibrationLine: null,
    objectionLine: null,
    weightLines: [] as string[],
    records: new Map<string, string>(),
    calibrations: new Map<string, string>(),
  };
  try {
    const view = await loadTeamScoreboardView(tenantId);
    if (!view) return empty;
    const records = new Map<string, string>();
    const calibrations = new Map<string, string>();
    for (const row of view.rows) {
      const line = recordLine(row.overall);
      if (line) records.set(row.specialist, line);
      const bands = view.snapshot.specialists.find((s) => s.specialist === row.specialist)?.calibration_bands;
      if (bands) {
        const calibrationLine = buildCalibrationLine(teammateOf(row.specialist).name, bands);
        if (calibrationLine) calibrations.set(row.specialist, calibrationLine);
      }
    }
    // Item 70 - one plain-English line per specialist whose learned vote weight is currently
    // active (a non-neutral, MIN_DECIDED-cleared cell), e.g. "Search demand has called 8 of its
    // last 11 winners here, so its vote counts a bit more." De-duped to ONE line per specialist
    // (its most specific/first-resolved family cell) so a specialist proven in several families
    // doesn't spam the standup footer with repeats of the same idea.
    const weights = await loadActiveSpecialistWeights(tenantId);
    const seenSpecialists = new Set<string>();
    const weightLines: string[] = [];
    for (const w of weights) {
      if (!w.tag || seenSpecialists.has(w.specialist)) continue;
      seenSpecialists.add(w.specialist);
      weightLines.push(w.tag);
    }
    return { footer: view.footerLine, calibrationLine: view.calibrationLine, objectionLine: view.objectionLine, weightLines, records, calibrations };
  } catch {
    return empty;
  }
}

/** Item 46 - the chip's title attribute stacks the item-43 calibration line (if any) with the
 *  freshness sentence (if the source is stale/dead), so a hover never loses either fact. Fresh
 *  sources with no calibration line keep title undefined exactly as before. */
function chipTitle(calibration: string | undefined, freshness: string | undefined): string | undefined {
  const parts = [calibration, freshness].filter((s): s is string => Boolean(s && s.trim()));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export async function TeamStandup({
  tenantId,
  picksTonight,
  measuringCount,
}: {
  tenantId: string;
  picksTonight: number;
  /** A2 - the canonical (proof ledger) measuring count, shared with the counts tile and the
   *  measuring list so every widget on Today agrees on this number. */
  measuringCount: number;
}) {
  try {
    const { footer, calibrationLine, objectionLine, weightLines, records, calibrations } = await loadScoreboardForStandup(tenantId);
    const lines = await buildLines(tenantId, picksTonight, records, calibrations, measuringCount);
    // Item 77 - answer-drift alert: what changed in the last 7 days of the native AI
    // poll stream, treated like a lost/won ranking. Fail-soft to [] (a poll history
    // too shallow to compare yet, or nothing drifted, both render nothing here).
    const driftEvents = await safe(() => loadRecentDriftEvents(tenantId, 3), [] as DriftEventWithMatch[]);
    if (lines.length === 0 && driftEvents.length === 0) return null;
    // Item 46 - honest degradation: the SAME connector reads /settings/connectors and the item-10
    // pipeline-readings collector already use (getConnectorInfo, via source-freshness.ts), so a
    // teammate whose backing source is stale/dead gets an amber/red dot + a plain-English tooltip
    // instead of looking identical to a healthy one. Fail-soft to an empty map (every chip renders
    // exactly as before) - never blocks or slows the standup render.
    const freshness: TeammateFreshnessMap = await safe(() => loadTeammateFreshness(tenantId), new Map());
    // Item 43 - stack the calibration and objection lines under the item-38 footer whenever each
    // clears its own 5-observation minimum (both loaders already return null below that bar, so this
    // is a plain filter, never an extra gate). Either, both, or neither can render independently.
    // Item 70 - append one line per specialist with an active learned vote weight, same honest
    // silence-below-the-bar posture (loadActiveSpecialistWeights already returns [] until a cell
    // clears MIN_DECIDED).
    const footerLines = [footer, calibrationLine, objectionLine, ...weightLines].filter((l): l is string => Boolean(l));
    return (
      <div className="flex flex-col gap-1.5 beacon-rise-in">
        <section aria-label="Team standup" className="flex flex-wrap gap-2">
          {lines.map((l) => {
            const t = teammateOf(l.key);
            const fresh = freshness.get(l.key);
            const degraded = fresh && fresh.status !== "fresh";
            const dotColor = degraded ? FRESHNESS_DOT_COLOR[fresh.status as "stale" | "dead"] : t.color;
            const pillTitle = chipTitle(l.title, degraded ? fresh.sentence : undefined);
            return (
              <details key={l.key} className="beacon-standup-pill group">
                <summary
                  title={pillTitle}
                  className="inline-flex cursor-pointer select-none list-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
                  style={{ background: t.bg, borderColor: `${t.color}33`, color: t.text }}
                >
                  <span
                    aria-label={degraded ? `${t.name}: ${fresh.sentence}` : undefined}
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: dotColor, opacity: l.active ? 1 : 0.35 }}
                  />
                  <span className="font-semibold">{t.short}</span>
                  <span style={{ opacity: 0.85 }}>{l.line}</span>
                  {l.brief ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 12 12"
                      className="h-2.5 w-2.5 shrink-0 opacity-60 transition-transform group-open:rotate-180"
                    >
                      <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </summary>
                {l.brief ? (
                  <div
                    className="mt-1.5 max-w-xs rounded-xl border px-3 py-2 text-[12px] leading-relaxed"
                    style={{ background: t.bg, borderColor: `${t.color}33`, color: t.text }}
                  >
                    <p>{l.brief.watched}</p>
                    <p className="mt-1 font-semibold">{l.brief.number}</p>
                    <p className="mt-1" style={{ opacity: 0.85 }}>{l.brief.concern}</p>
                    <Link href={l.brief.href} className="mt-1.5 inline-block font-semibold underline underline-offset-2">
                      {l.brief.linkLabel}
                    </Link>
                  </div>
                ) : null}
              </details>
            );
          })}
        </section>
        {footerLines.map((line, i) => (
          <p key={i} className="px-1 text-[11.5px] text-slate-500">
            {line}
          </p>
        ))}
        {driftEvents.length > 0 ? (
          <section aria-label="AI answer changes this week" className="flex flex-col gap-1">
            {driftEvents.map((e, i) => {
              const isWin = e.kind === "brand_added";
              const isLoss = e.kind === "brand_dropped";
              const tone = isWin
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                : isLoss
                  ? "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-gray-200 bg-gray-50/70 text-gray-700 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300";
              return (
                <p key={i} className={`rounded-xl border px-3 py-2 text-[12.5px] font-medium ${tone}`}>
                  {driftEventSentence(e)}
                </p>
              );
            })}
          </section>
        ) : null}
      </div>
    );
  } catch {
    return null;
  }
}
