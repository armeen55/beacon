import "server-only";

/**
 * ask/fact-assembly (BEACON_500 item 59) - the bounded, $0 dossier builder for /ask.
 * ONE function per question class, each composing EXISTING cached loaders (never new
 * query logic) into a short list of AskFact rows, exactly like page-dossier-data.ts
 * (item 54) composes the /page dossier. Every source read is wrapped in its own catch
 * so one failing source never blanks the others - the dossier always returns SOMETHING,
 * an honest empty list rather than a crashed page.
 *
 * Every fact carries {value, source, href} - the composer (composer.ts) may only cite
 * numbers that appear verbatim in one of these values, and every answer links back to
 * the href so a claim is always one click from its proof.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { loadPageDossier, type PageDossier } from "@/app/(shell)/page/[...path]/page-dossier-data";
import { loadDailyTotalsForTenant, type DailyTotals } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { detectChangepoints, type DailyPoint } from "@/domains/proof-gsc/changepoint";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { countLedgerLifecycle, excludeRevertBookkeeping } from "@/domains/changes/lifecycle-counts";
import { proofMaturityLabel } from "@/domains/proof-gsc/measure-lifecycle";
import { deriveMeasurementMaturity, basisDayOf } from "@/domains/proof-gsc/measurement-maturity";
import { gradeVerdictReliability } from "@/domains/proof-gsc/verdict-reliability";
import { getAnswerIntelligenceIndexForTenant } from "@/domains/answer-intelligence/store";
import { getAcceptedPlan, getLatestPreviewPlan } from "@/domains/experiments/daily-experiment-plan-store";
import { loadNativeIntelForTenant } from "@/domains/ai-visibility/native-intel-loader";
import { loadKeywordLibraryForTenant } from "@/domains/research/keyword-library";
import { loadCronHealthView } from "@/domains/ops/cron-health-view";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { readPublishHealth } from "@/domains/push/publish-canary-store";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { resolveOwner } from "@/domains/ownership/registry";
import { plainChangeKind } from "@/lib/plain-language";
import type { RoutedQuestion, RankingMetric } from "./router";
import type { AskDossier, AskFact } from "./types";

const MAX_FACTS = 10;

function fact(value: string, source: AskFact["source"], href: string): AskFact {
  return { value, source, href };
}

function pct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n * 100)}%`;
}

// ── page_specific: reuse the item-54 dossier loader wholesale ───────────────────────

// W9 slice 1 (2026-07-09) - exported so src/domains/ask/providers/registry.ts can wrap
// each of these AS-IS (thin adapters, behavior-identical) instead of duplicating the
// composition logic. No function body below changed for the registry - export only.
export async function assemblePageFacts(tenantId: string, pagePath: string): Promise<AskFact[]> {
  let dossier: PageDossier;
  try {
    dossier = await loadPageDossier(pagePath);
  } catch {
    return [];
  }
  const href = `/page${pagePath}`;
  const facts: AskFact[] = [];

  if (dossier.teamReads.demand) {
    const d = dossier.teamReads.demand;
    facts.push(
      fact(
        `${dossier.pageLabel} (${pagePath}) had ${d.clicks90d} clicks and ${d.impressions90d} impressions over the last 90 days, ${Math.round(d.ctr90d * 1000) / 10}% click rate, average position ${Math.round(d.position90d * 10) / 10}.`,
        "gsc",
        href,
      ),
    );
  }

  if (dossier.chart.daily.length >= 14) {
    const points: DailyPoint[] = dossier.chart.daily.map((d) => ({ date: d.date, value: d.clicks }));
    const changes = detectChangepoints(points);
    for (const c of changes.slice(-2)) {
      facts.push(
        fact(
          `${dossier.pageLabel} had a sustained clicks ${c.direction === "down" ? "drop" : "rise"} of about ${Math.round(c.magnitude * 100)}% starting ${c.date}.`,
          "gsc",
          href,
        ),
      );
    }
  }

  if (dossier.queries.topQueries.length > 0) {
    const top = dossier.queries.topQueries.slice(0, 3);
    facts.push(
      fact(
        `Top searches sending clicks to ${pagePath}: ${top.map((q) => `"${q.query}" (${q.clicks} clicks)`).join(", ")}.`,
        "gsc",
        href,
      ),
    );
    // N2 (2026-07-02) - one-line ownership-registry cite: name the registry's
    // owner for this page's top query, and say so plainly when a DIFFERENT
    // page actually owns it (the honest "you may be fighting yourself" answer).
    try {
      const registry = await loadOwnershipRegistryForTenant(tenantId);
      const topQuery = top[0]?.query;
      const entry = topQuery ? resolveOwner(registry, topQuery) : null;
      if (entry?.owner) {
        facts.push(
          entry.owner === pagePath || entry.owner.endsWith(pagePath)
            ? fact(`My ownership registry confirms ${pagePath} owns "${entry.key}" (${entry.basis === "gsc_ranks" ? "Google sends it the most impressions" : "a SERP-overlap cluster ranks it best"}).`, "gsc", href)
            : fact(`My ownership registry says ${entry.owner} owns "${entry.key}", not ${pagePath} - that is worth checking before editing this page for that query.`, "gsc", href),
        );
      }
    } catch {
      /* additive fact only - never affect the rest of the dossier */
    }
  }

  if (dossier.teamReads.funnel) {
    const f = dossier.teamReads.funnel;
    facts.push(
      fact(
        `${dossier.pageLabel}: AI crawlers visited ${f.crawled.count} times, AI answers cited it ${f.cited.count} times, and it sent ${f.aiClicks.sessions} visits from AI sources.`,
        "profound",
        href,
      ),
    );
  }

  if (dossier.teamReads.friction) {
    const fr = dossier.teamReads.friction;
    facts.push(
      fact(
        `Visitor behavior on ${pagePath}: ${fr.sessions} sessions, ${fr.rageClicks} rage clicks, ${fr.deadClicks} dead clicks, ${fr.quickbacks} quick-backs.`,
        "clarity",
        href,
      ),
    );
  }

  if (dossier.history.length > 0) {
    const recent = dossier.history.slice(0, 3);
    // FP4 (2026-07-03) - plainChangeKind: never leak raw action-type keys
    // ("edit_meta", "add_answer_block") into a rendered answer.
    facts.push(
      fact(
        `Changes shipped on ${pagePath}: ${recent.map((r) => `a ${plainChangeKind(r.actionType)} on ${r.shippedAt.slice(0, 10)} (${proofMaturityLabel(r.verdict, null)})`).join("; ")}.`,
        "proof",
        `/results`,
      ),
    );
  }

  if (dossier.currentMove) {
    facts.push(fact(`Current recommendation for ${pagePath}: ${dossier.currentMove.recommendation} (status: ${dossier.currentMove.status}).`, "llm", "/changes"));
  }

  if (dossier.currentPlanPick) {
    facts.push(
      fact(
        `${dossier.currentPlanPick.isAccepted ? "Accepted" : "Planned"} for ${pagePath}: a ${plainChangeKind(dossier.currentPlanPick.lever)} targeting "${dossier.currentPlanPick.targetQuery}".`,
        "llm",
        "/changes",
      ),
    );
  } else if (!dossier.currentMove) {
    // Honest "why is this page not in the plan" answer (D8): when neither a worklist
    // recommendation NOR a plan pick exists for this page, say so plainly instead of
    // staying silent - the absence itself is the answer to "why isn't this page in the
    // plan", not a gap to paper over.
    facts.push(
      fact(
        `${pagePath} has no open recommendation and no plan pick right now. Either it has no fixable gap I have found yet, or it was already shipped and is waiting to be measured.`,
        "llm",
        "/changes",
      ),
    );
  }

  return facts;
}

// ── site_trend: sitewide daily totals + changepoints ────────────────────────────────

export async function assembleSiteTrendFacts(tenantId: string): Promise<AskFact[]> {
  let daily: DailyTotals[] = [];
  try {
    daily = await loadDailyTotalsForTenant(tenantId, 90);
  } catch {
    daily = [];
  }
  if (daily.length === 0) return [];

  const facts: AskFact[] = [];
  const last7 = daily.slice(-7);
  const prior7 = daily.slice(-14, -7);
  const last7Clicks = last7.reduce((s, d) => s + d.clicks, 0);
  const prior7Clicks = prior7.reduce((s, d) => s + d.clicks, 0);
  facts.push(fact(`Sitewide clicks over the last 7 reported days: ${last7Clicks}.`, "gsc", "/"));
  if (prior7Clicks > 0) {
    const delta = (last7Clicks - prior7Clicks) / prior7Clicks;
    facts.push(fact(`That is ${pct(delta)} versus the prior 7 days (${prior7Clicks} clicks).`, "gsc", "/"));
  }

  if (daily.length >= 21) {
    const points: DailyPoint[] = daily.map((d) => ({ date: d.date, value: d.clicks }));
    const changes = detectChangepoints(points);
    for (const c of changes.slice(-2)) {
      facts.push(fact(`Sitewide clicks had a sustained ${c.direction === "down" ? "drop" : "rise"} of about ${Math.round(c.magnitude * 100)}% starting ${c.date}, which lines up with a possible Google algorithm shift.`, "gsc", "/results"));
    }
  }

  return facts;
}

/**
 * W9 slice 1 - the freshness date for GSC daily totals, reused by the registry's
 * site-trend provider (providers/registry.ts) to state "data through <date>" in the
 * rendered answer without re-parsing fact strings. Additive: assembleSiteTrendFacts
 * above stays untouched; this is a second, tiny read of the same tenant-scoped table.
 */
export async function latestGscDailyDate(tenantId: string): Promise<string | null> {
  try {
    const daily = await loadDailyTotalsForTenant(tenantId, 90);
    return daily.length > 0 ? daily[daily.length - 1]!.date : null;
  } catch {
    return null;
  }
}

// ── page_ranking: rank pages by a metric (money / traffic) with real per-page numbers ──

/** Short, human page label from a stored URL or path. */
function shortPageLabel(url: string): string {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    return path === "/" || path === "" ? "the home page" : path;
  } catch {
    return url;
  }
}

/** Internal deep link to a page's dossier (same convention as assemblePageFacts: /page<path>). */
function pageDossierHref(url: string): string {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    return path && path !== "/" ? `/page${path.startsWith("/") ? path : `/${path}`}` : "/results";
  } catch {
    return "/results";
  }
}

/**
 * "Which page makes the most money / drives the most traffic / is bleeding the most" - a
 * RANKING across the tenant's pages using the real per-page tables (GA4 value, GSC clicks).
 * Honest about revenue: with no conversions/revenue set up, it says so and ranks by the
 * closest proxy (engaged visitors) rather than inventing a dollar figure. Fail-soft to a
 * plain "connect X" fact so Ask never dead-ends.
 */
export async function assemblePageRankingFacts(tenantId: string, metric: RankingMetric): Promise<AskFact[]> {
  const facts: AskFact[] = [];
  const TOP_N = 5;

  if (metric === "money") {
    let values: Awaited<ReturnType<typeof loadGa4PageValuesForTenant>> | null = null;
    try {
      values = await loadGa4PageValuesForTenant(tenantId);
    } catch {
      values = null;
    }
    const rows = values ? [...values.values()] : [];
    if (rows.length === 0) {
      facts.push(fact(
        "I do not have per-page analytics yet, so I cannot rank pages by value. Once Google Analytics is syncing I rank by conversions (and by revenue if you set up ecommerce or key-event values).",
        "ga4",
        "/settings/connectors",
      ));
      return facts;
    }
    const anyConversions = rows.some((r) => r.conversions28d > 0);
    if (anyConversions) {
      facts.push(fact(
        "You have not set up revenue values in Google Analytics, so I rank by conversions (key events) over the last 28 days, not actual dollars.",
        "ga4",
        "/results",
      ));
      for (const r of [...rows].sort((a, b) => b.conversions28d - a.conversions28d).filter((r) => r.conversions28d > 0).slice(0, TOP_N)) {
        facts.push(fact(
          `${shortPageLabel(r.page)}: ${r.conversions28d} conversion${r.conversions28d === 1 ? "" : "s"} from ${r.sessions28d} sessions (28 days).`,
          "ga4",
          pageDossierHref(r.page),
        ));
      }
    } else {
      facts.push(fact(
        "No conversions or revenue are set up in Google Analytics, so I honestly cannot tell you which page makes the most money yet. The closest I have is engaged visitors over the last 28 days, so here are your pages by that:",
        "ga4",
        "/results",
      ));
      for (const r of [...rows].sort((a, b) => b.engaged28d - a.engaged28d).filter((r) => r.engaged28d > 0).slice(0, TOP_N)) {
        facts.push(fact(
          `${shortPageLabel(r.page)}: ${r.engaged28d} engaged of ${r.sessions28d} sessions (28 days).`,
          "ga4",
          pageDossierHref(r.page),
        ));
      }
    }
    return facts;
  }

  // traffic: rank by GSC clicks
  let signals: Awaited<ReturnType<typeof loadGscPageSignalsForTenant>> | null = null;
  try {
    signals = await loadGscPageSignalsForTenant(tenantId);
  } catch {
    signals = null;
  }
  const rows = signals ? [...signals.values()] : [];
  if (rows.length === 0) {
    facts.push(fact(
      "I do not have per-page Search Console data yet, so I cannot rank pages by clicks. Once Search Console is syncing I can.",
      "gsc",
      "/settings/connectors",
    ));
    return facts;
  }
  facts.push(fact("Your pages by Google clicks over the last 90 days, most first:", "gsc", "/results"));
  for (const r of [...rows].sort((a, b) => b.clicks90d - a.clicks90d).filter((r) => r.clicks90d > 0).slice(0, TOP_N)) {
    facts.push(fact(
      `${shortPageLabel(r.page)}: ${r.clicks90d} clicks from ${r.impressions90d} impressions (90 days).`,
      "gsc",
      pageDossierHref(r.page),
    ));
  }
  return facts;
}

// ── ai_visibility: the answer-intelligence index ────────────────────────────────────

export async function assembleAiVisibilityFacts(tenantId: string): Promise<AskFact[]> {
  let index;
  try {
    index = await getAnswerIntelligenceIndexForTenant(tenantId);
  } catch {
    index = null;
  }
  if (!index) return [];

  const facts: AskFact[] = [];
  facts.push(fact(`Across ${index.total_observations} tracked AI answers, ${index.total_with_answer_text} had readable answer text.`, "profound", "/prompts"));

  const topics = index.brand_positioning.slice(0, 3);
  for (const t of topics) {
    facts.push(
      fact(
        `For "${t.topic}": mentioned in ${Math.round(t.mention_rate * 100)}% of AI answers, cited in ${Math.round(t.citation_rate * 100)}% (${t.mention_count} of ${t.total_observations} tracked answers).`,
        "profound",
        "/prompts",
      ),
    );
  }

  const competitors = index.co_citation.competitors.slice(0, 3);
  for (const c of competitors) {
    facts.push(
      fact(
        `${c.domain} appears in AI answers ${c.total_answer_appearances} times, ${c.when_owned_absent} of those when we were NOT cited (${Math.round(c.displacement_ratio * 100)}% displacement risk).`,
        "profound",
        "/prompts",
      ),
    );
  }

  const shifts = index.narrative_shifts.slice(0, 2);
  for (const s of shifts) {
    facts.push(fact(`On "${s.topic}" (${s.platform}): ${s.detail}`, "profound", "/prompts"));
  }

  return facts;
}

// ── competitor: co-citation + narrative shifts (same index, competitor framing) ────

export async function assembleCompetitorFacts(tenantId: string): Promise<AskFact[]> {
  const [index, native] = await Promise.all([
    getAnswerIntelligenceIndexForTenant(tenantId).catch(() => null),
    loadNativeIntelForTenant(tenantId).catch(() => null),
  ]);

  const facts: AskFact[] = [];

  if (index) {
    const competitors = [...index.co_citation.competitors].sort((a, b) => b.total_answer_appearances - a.total_answer_appearances).slice(0, 5);
    for (const c of competitors) {
      facts.push(
        fact(
          `${c.domain}: appears in AI answers ${c.total_answer_appearances} times total (${c.when_owned_present} alongside us, ${c.when_owned_absent} instead of us).`,
          "dataforseo",
          "/prompts",
        ),
      );
    }

    for (const topic of index.co_citation.by_topic.slice(0, 3)) {
      const topWhenAbsent = topic.top_when_absent.slice(0, 2).map((c) => c.domain).join(", ");
      if (topWhenAbsent) {
        facts.push(fact(`On "${topic.topic}", when we are not cited AI most often cites: ${topWhenAbsent}.`, "dataforseo", "/prompts"));
      }
    }
  }

  // D8: the native 4-engine poll (recurring domains + presence matrix) is a second,
  // independent read on "who does AI recommend instead of me" - name the domains that
  // keep showing up across distinct prompts, and how many prompts we are absent from
  // everywhere, so the answer is not limited to the borrowed Profound account alone.
  if (native && native.rowsScanned > 0) {
    const topDomains = native.recurringDomains.slice(0, 5);
    for (const d of topDomains) {
      facts.push(
        fact(
          `${d.domain} was cited by AI across ${d.distinctPrompts} different prompts I track (${d.citationCount} citations total, on ${d.engines.join(", ")}).`,
          "profound",
          "/prompts",
        ),
      );
    }
    if (native.presence.totals.absent > 0) {
      facts.push(
        fact(
          `Out of ${native.presence.totals.promptsChecked} prompts I track, AI never mentions or cites us on ${native.presence.totals.absent} of them.`,
          "profound",
          "/prompts",
        ),
      );
    }
  }

  return facts;
}

// ── measurement: the proof ledger ───────────────────────────────────────────────────

export async function assembleMeasurementFacts(tenantId: string): Promise<AskFact[]> {
  let ledger: Awaited<ReturnType<typeof loadProofLedgerCached>>;
  try {
    ledger = await loadProofLedgerCached(tenantId);
  } catch {
    ledger = [];
  }
  if (ledger.length === 0) return [];

  // audit #10 (2026-07-09): drop revert bookkeeping rows before Ask counts ANYTHING, exactly
  // like every other surface (Bug #14). A revert's own revert_* row is not a distinct change.
  const realLedger = excludeRevertBookkeeping(ledger);
  if (realLedger.length === 0) return [];

  const facts: AskFact[] = [];
  const sorted = [...realLedger].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentShips = sorted.filter((r) => Date.parse(r.shippedAt) >= sevenDaysAgo);
  if (recentShips.length > 0) {
    facts.push(
      fact(
        `In the last 7 days I shipped ${recentShips.length} change${recentShips.length === 1 ? "" : "s"}: ${recentShips.slice(0, 5).map((r) => `a ${plainChangeKind(r.actionType)} on ${r.path}`).join(", ")}.`,
        "proof",
        "/results",
      ),
    );
  }

  // audit #9/#11 (2026-07-09): "decided" must mean a MATURE (28-day) final verdict and obey the
  // ONE-COUNT RULE, not a raw verdict-field filter that also counts early 7/14-day checkpoints.
  // Route through the SAME canonical counter Results and Today use so Ask can never disagree
  // with them (it applies measurement maturity, overlap capping, and revert exclusion).
  const lifecycle = countLedgerLifecycle(realLedger);
  if (lifecycle.decided > 0) {
    const notWon = lifecycle.decided - lifecycle.won;
    facts.push(fact(`Of ${lifecycle.decided} decided changes, ${lifecycle.won} won and ${notWon} did not help (${Math.round((lifecycle.won / lifecycle.decided) * 100)}% win rate).`, "proof", "/results"));
  }

  // Reliability depth (D8): every measured record already carries how confident I am and
  // (when a revenue model is set) a dollar estimate - name both so "what did my last
  // batch do" answers with real weight, not just a win/loss label.
  for (const r of sorted.slice(0, 5)) {
    const parts = [`${r.path}: a ${plainChangeKind(r.actionType)} shipped ${r.shippedAt.slice(0, 10)}, ${proofMaturityLabel(r.verdict, null)} (confidence: ${r.confidence})`];
    if (r.dollarValue) parts.push(r.dollarValue.basisSentence);
    if (r.permutationRead && r.permutationRead.nTotal > 0) {
      parts.push(
        `Only ${r.permutationRead.nGreater} of ${r.permutationRead.nTotal} untouched pages moved this much on their own, so this reads like a real effect.`,
      );
    }
    // One verdict-reliability grade (master plan N10): the cheap, ledger-only
    // read (no recrawl/contamination/weather/seasonal joins here, unlike the
    // /results card - those need tenant-wide attach reads this fast $0 path
    // does not do) so Ask still names how much to trust the number instead
    // of only saying win/loss. A caller with the full presentation (the
    // /results card) gets the richer grade via gradeFromPresentation instead.
    const basisDay = basisDayOf(r.windows ?? []);
    const controlsUsed = r.windows?.find((w) => w.day === basisDay)?.controlsUsed ?? r.controlPages.length;
    const baselineImpressions = r.baseline?.impressions ?? 0;
    const grade = gradeVerdictReliability({
      maturity: deriveMeasurementMaturity({
        shippedAt: r.shippedAt,
        now: new Date(),
        latestGscDate: null,
        windows: r.windows ?? [],
        verdict: r.verdict,
        controlsUsed,
        baselineImpressions,
      }),
      basisDay,
      recrawlPending: false,
      controlContaminationFlagged: false,
      weakComparisonFlagged: r.controlMatchWeak === true,
      weatherQuarantined: false,
      seasonalInflectionFlagged: false,
      attributionShared: false,
      controlsUsed,
      baselineImpressions,
      permutationRead: r.permutationRead && r.permutationRead.nTotal > 0 ? r.permutationRead : null,
    });
    parts.push(`I would grade this read as ${grade.grade}.`);
    facts.push(fact(`${parts.join(" ")}.`, "proof", "/results"));
  }

  return facts;
}

// ── plan: the accepted/preview daily plan ───────────────────────────────────────────

export async function assemblePlanFacts(tenantId: string): Promise<AskFact[]> {
  let plan;
  try {
    plan = (await getAcceptedPlan(tenantId)) ?? (await getLatestPreviewPlan(tenantId));
  } catch {
    plan = null;
  }
  if (!plan || plan.selected.length === 0) return [];

  const facts: AskFact[] = [];
  const status = plan.status === "accepted" ? "Accepted" : "Planned (not yet accepted)";
  facts.push(fact(`${status} for ${plan.date}: ${plan.selected.length} change${plan.selected.length === 1 ? "" : "s"}.`, "llm", "/changes"));
  for (const p of plan.selected.slice(0, 5)) {
    facts.push(fact(`${p.pageLabel}: a ${plainChangeKind(p.lever)} targeting "${p.targetQuery}". Why now: ${p.whyNow}`, "llm", "/changes"));
  }

  return facts;
}

// ── keyword_next: the keyword library, ranked by real demand with no owner ─────────

/**
 * "Which keyword should I chase next" (D8): read the fused keyword library (GSC +
 * DataForSEO volume + ownership) and surface the highest-volume keywords that either
 * have no owning page yet, or where we rank weakly (position worse than 10) - the
 * concrete, real-volume gaps an operator can act on today. Falls back to naming the
 * library's own coverage line when nothing qualifies, so the answer is never silent.
 */
export async function assembleKeywordNextFacts(tenantId: string): Promise<AskFact[]> {
  let library;
  try {
    library = await loadKeywordLibraryForTenant(tenantId);
  } catch {
    library = null;
  }
  if (!library || library.rows.length === 0) return [];

  const facts: AskFact[] = [];
  const candidates = library.rows
    .filter((r) => (r.searchesPerMo ?? 0) > 0 && (!r.ownerPage || (r.yourPosition ?? 999) > 10))
    .sort((a, b) => (b.searchesPerMo ?? 0) - (a.searchesPerMo ?? 0))
    .slice(0, 5);

  if (candidates.length === 0) {
    facts.push(
      fact(
        `I have ${library.total} keywords in my library with real search-volume data for ${library.volumeCoverage} of them, and every high-volume one already has an owning page ranking well.`,
        "dataforseo",
        "/research/keywords",
      ),
    );
    return facts;
  }

  for (const r of candidates) {
    const owned = r.ownerPage ? `currently owned by ${r.ownerPage}, ranking around position ${Math.round((r.yourPosition ?? 0) * 10) / 10}` : "no page of ours owns this yet";
    facts.push(
      fact(
        `"${r.keyword}": about ${r.searchesPerMo} searches a month, ${owned}.`,
        "dataforseo",
        r.ownerPageHref ?? "/research/keywords",
      ),
    );
  }

  return facts;
}

// ── system_health: cron reliability + pipeline invariants + publish canary ─────────

/**
 * "Is anything broken right now" (D8): fuse the three health surfaces that already
 * exist but never fed Ask - nightly cron success/failure streaks, the pipeline
 * invariant check (are GSC/GA4/Profound rows actually landing), and the Wix publish
 * canary (can we still push live). Every source is read independently and fails soft,
 * so one outage narrows the answer instead of blanking it. When all three are clean,
 * says so plainly instead of staying silent.
 */
export async function assembleSystemHealthFacts(tenantId: string): Promise<AskFact[]> {
  const [cronJobs, pipeline, publish] = await Promise.all([
    loadCronHealthView().catch(() => []),
    readPipelineHealth(tenantId).catch(() => null),
    readPublishHealth(tenantId).catch(() => null),
  ]);

  const facts: AskFact[] = [];

  for (const job of cronJobs) {
    if (job.failureStreaks.length > 0) {
      for (const s of job.failureStreaks.slice(0, 3)) {
        facts.push(
          fact(
            `${job.label}: ${s.label} has failed ${s.consecutiveFailures} nights in a row${s.lastFailureDetail ? ` (${s.lastFailureDetail})` : ""}.`,
            "llm",
            "/settings/connectors",
          ),
        );
      }
    } else if (job.lastRun && !job.lastRun.ok) {
      facts.push(fact(`${job.label}: ${job.headline}`, "llm", "/settings/connectors"));
    }
  }

  if (pipeline && pipeline.violations.length > 0) {
    // Only ALARM-level violations are "something is broken". Info-level ones (a connected
    // source that synced fine but is simply quiet, e.g. a dormant AI feed) must NOT make
    // Ask answer "yes, the pipe is broken" - that was the false alarm on a dead Profound
    // account. Their honest sentence still exists in the data; we just don't feed it here
    // as a problem fact. (2026-07-08)
    const alarms = pipeline.violations.filter((v) => v.severity !== "info");
    for (const v of alarms.slice(0, 5)) {
      facts.push(fact(v.sentence, "llm", "/diagnostics"));
    }
  }

  if (publish) {
    if (publish.tokenOk === false || publish.urlMapOk === false || publish.dryRunOk === false) {
      facts.push(
        fact(
          publish.fixHint ? `Publishing check: ${publish.fixHint}` : `Publishing check failed as of ${publish.whenIso.slice(0, 10)}${publish.error ? `: ${publish.error}` : "."}`,
          "wix",
          "/settings/connectors",
        ),
      );
    }
  }

  if (facts.length === 0) {
    // cron-health-view.ts ALWAYS returns one entry per job in the static CRON_SCHEDULE_MAP,
    // even for a tenant with zero real runs - so `cronJobs.length > 0` alone would falsely
    // read as "checked and clean" for a brand-new tenant. Only count a job as an actual
    // check when it has a real lastRun timestamp.
    const cronsActuallyRan = cronJobs.some((j) => j.lastRun !== null);
    const checkedAny = cronsActuallyRan || pipeline !== null || publish !== null;
    facts.push(
      fact(
        checkedAny
          ? "Every health check I have run recently came back clean: crons are showing up, data is landing, and publishing checks out."
          : "I do not have a recent health check yet to tell you if anything is broken.",
        "llm",
        "/settings/connectors",
      ),
    );
  }

  return facts;
}

/**
 * Assemble the bounded fact dossier for one routed question. Dispatches on
 * `questionClass`; page_specific ALSO includes a light site-trend fact so a page
 * question that turns out to be part of a sitewide shift still surfaces that context.
 * Every branch is fail-soft - an assembly error reads as "no facts found", never a throw.
 */
export async function assembleAskDossier(routed: RoutedQuestion): Promise<AskDossier> {
  const tenantId = await currentTenantId().catch(() => "");
  // Codex P2 (2026-07-09): FAIL CLOSED on an unresolved tenant. Every assembler
  // is tenant-scoped; proceeding with an empty tenantId would let the underlying
  // loaders resolve the wrong (or the founder) tenant. An empty dossier reads as
  // an honest "no data" answer, never another tenant's facts.
  if (tenantId === "") return buildAskDossier(routed, []);
  let facts: AskFact[] = [];

  try {
    switch (routed.questionClass) {
      case "page_specific":
        facts = routed.pagePath ? await assemblePageFacts(tenantId, routed.pagePath) : [];
        break;
      case "page_ranking":
        facts = await assemblePageRankingFacts(tenantId, routed.rankingMetric ?? "traffic");
        break;
      case "site_trend":
        facts = await assembleSiteTrendFacts(tenantId);
        break;
      case "ai_visibility":
        facts = await assembleAiVisibilityFacts(tenantId);
        break;
      case "competitor":
        facts = await assembleCompetitorFacts(tenantId);
        break;
      case "measurement":
        facts = await assembleMeasurementFacts(tenantId);
        break;
      case "plan":
        facts = await assemblePlanFacts(tenantId);
        break;
      case "keyword_next":
        facts = await assembleKeywordNextFacts(tenantId);
        break;
      case "system_health":
        facts = await assembleSystemHealthFacts(tenantId);
        break;
    }
  } catch {
    facts = [];
  }

  return buildAskDossier(routed, facts);
}

/**
 * W9 slice 1 - the same bounding/hasData rule assembleAskDossier applies above,
 * exposed so a caller can build a dossier from facts gathered a different way (the
 * fact-provider registry, providers/registry.ts) without duplicating the MAX_FACTS
 * cap or the hasData contract. Pure, no I/O.
 */
export function buildAskDossier(routed: RoutedQuestion, facts: AskFact[]): AskDossier {
  return {
    questionClass: routed.questionClass,
    pagePath: routed.pagePath,
    facts: facts.slice(0, MAX_FACTS),
    hasData: facts.length > 0,
  };
}
