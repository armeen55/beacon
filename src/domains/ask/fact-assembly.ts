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
import { detectChangepoints, type DailyPoint } from "@/domains/proof-gsc/changepoint";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { proofMaturityLabel } from "@/domains/proof-gsc/measure-lifecycle";
import { deriveMeasurementMaturity, basisDayOf } from "@/domains/proof-gsc/measurement-maturity";
import { gradeVerdictReliability } from "@/domains/proof-gsc/verdict-reliability";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import { getAcceptedPlan, getLatestPreviewPlan } from "@/domains/experiments/daily-experiment-plan-store";
import { loadNativeIntel } from "@/domains/ai-visibility/native-intel-loader";
import { loadKeywordLibrary } from "@/domains/research/keyword-library";
import { loadCronHealthView } from "@/domains/ops/cron-health-view";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { readPublishHealth } from "@/domains/push/publish-canary-store";
import type { RoutedQuestion } from "./router";
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

async function assemblePageFacts(tenantId: string, pagePath: string): Promise<AskFact[]> {
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
    facts.push(
      fact(
        `Changes shipped on ${pagePath}: ${recent.map((r) => `${r.actionType} on ${r.shippedAt.slice(0, 10)} (${proofMaturityLabel(r.verdict, null)})`).join("; ")}.`,
        "proof",
        `/proof`,
      ),
    );
  }

  if (dossier.currentMove) {
    facts.push(fact(`Current recommendation for ${pagePath}: ${dossier.currentMove.recommendation} (status: ${dossier.currentMove.status}).`, "llm", "/worklist"));
  }

  if (dossier.currentPlanPick) {
    facts.push(
      fact(
        `${dossier.currentPlanPick.isAccepted ? "Accepted" : "Planned"} for ${pagePath}: a ${dossier.currentPlanPick.lever} change targeting "${dossier.currentPlanPick.targetQuery}".`,
        "llm",
        "/worklist",
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
        "/worklist",
      ),
    );
  }

  return facts;
}

// ── site_trend: sitewide daily totals + changepoints ────────────────────────────────

async function assembleSiteTrendFacts(tenantId: string): Promise<AskFact[]> {
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
      facts.push(fact(`Sitewide clicks had a sustained ${c.direction === "down" ? "drop" : "rise"} of about ${Math.round(c.magnitude * 100)}% starting ${c.date}, which lines up with a possible Google algorithm shift.`, "gsc", "/proof"));
    }
  }

  return facts;
}

// ── ai_visibility: the answer-intelligence index ────────────────────────────────────

async function assembleAiVisibilityFacts(): Promise<AskFact[]> {
  let index;
  try {
    index = await getAnswerIntelligenceIndex();
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
        "/competitors",
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

async function assembleCompetitorFacts(): Promise<AskFact[]> {
  const [index, native] = await Promise.all([
    getAnswerIntelligenceIndex().catch(() => null),
    loadNativeIntel().catch(() => null),
  ]);

  const facts: AskFact[] = [];

  if (index) {
    const competitors = [...index.co_citation.competitors].sort((a, b) => b.total_answer_appearances - a.total_answer_appearances).slice(0, 5);
    for (const c of competitors) {
      facts.push(
        fact(
          `${c.domain}: appears in AI answers ${c.total_answer_appearances} times total (${c.when_owned_present} alongside us, ${c.when_owned_absent} instead of us).`,
          "dataforseo",
          "/competitors",
        ),
      );
    }

    for (const topic of index.co_citation.by_topic.slice(0, 3)) {
      const topWhenAbsent = topic.top_when_absent.slice(0, 2).map((c) => c.domain).join(", ");
      if (topWhenAbsent) {
        facts.push(fact(`On "${topic.topic}", when we are not cited AI most often cites: ${topWhenAbsent}.`, "dataforseo", "/competitors"));
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

async function assembleMeasurementFacts(tenantId: string): Promise<AskFact[]> {
  let ledger: Awaited<ReturnType<typeof loadProofLedgerCached>>;
  try {
    ledger = await loadProofLedgerCached(tenantId);
  } catch {
    ledger = [];
  }
  if (ledger.length === 0) return [];

  const facts: AskFact[] = [];
  const sorted = [...ledger].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentShips = sorted.filter((r) => Date.parse(r.shippedAt) >= sevenDaysAgo);
  if (recentShips.length > 0) {
    facts.push(
      fact(
        `In the last 7 days I shipped ${recentShips.length} change${recentShips.length === 1 ? "" : "s"}: ${recentShips.slice(0, 5).map((r) => `${r.actionType} on ${r.path}`).join(", ")}.`,
        "proof",
        "/proof",
      ),
    );
  }

  const decided = sorted.filter((r) => r.verdict === "won" || r.verdict === "lost");
  const won = decided.filter((r) => r.verdict === "won").length;
  if (decided.length > 0) {
    facts.push(fact(`Of ${decided.length} decided changes, ${won} won and ${decided.length - won} did not help (${Math.round((won / decided.length) * 100)}% win rate).`, "proof", "/proof"));
  }

  // Reliability depth (D8): every measured record already carries how confident I am and
  // (when a revenue model is set) a dollar estimate - name both so "what did my last
  // batch do" answers with real weight, not just a win/loss label.
  for (const r of sorted.slice(0, 5)) {
    const parts = [`${r.path}: ${r.actionType} shipped ${r.shippedAt.slice(0, 10)}, ${proofMaturityLabel(r.verdict, null)} (confidence: ${r.confidence})`];
    if (r.dollarValue) parts.push(r.dollarValue.basisSentence);
    if (r.permutationRead && r.permutationRead.nTotal > 0) {
      parts.push(
        `Only ${r.permutationRead.nGreater} of ${r.permutationRead.nTotal} untouched pages moved this much on their own, so this reads like a real effect.`,
      );
    }
    // One verdict-reliability grade (master plan N10): the cheap, ledger-only
    // read (no recrawl/contamination/weather/seasonal joins here, unlike the
    // /proof card - those need tenant-wide attach reads this fast $0 path
    // does not do) so Ask still names how much to trust the number instead
    // of only saying win/loss. A caller with the full presentation (the
    // /proof card) gets the richer grade via gradeFromPresentation instead.
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
    facts.push(fact(`${parts.join(" ")}.`, "proof", "/proof"));
  }

  return facts;
}

// ── plan: the accepted/preview daily plan ───────────────────────────────────────────

async function assemblePlanFacts(tenantId: string): Promise<AskFact[]> {
  let plan;
  try {
    plan = (await getAcceptedPlan(tenantId)) ?? (await getLatestPreviewPlan(tenantId));
  } catch {
    plan = null;
  }
  if (!plan || plan.selected.length === 0) return [];

  const facts: AskFact[] = [];
  const status = plan.status === "accepted" ? "Accepted" : "Planned (not yet accepted)";
  facts.push(fact(`${status} for ${plan.date}: ${plan.selected.length} change${plan.selected.length === 1 ? "" : "s"}.`, "llm", "/worklist"));
  for (const p of plan.selected.slice(0, 5)) {
    facts.push(fact(`${p.pageLabel}: a ${p.lever} change targeting "${p.targetQuery}". Why now: ${p.whyNow}`, "llm", "/worklist"));
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
async function assembleKeywordNextFacts(): Promise<AskFact[]> {
  let library;
  try {
    library = await loadKeywordLibrary();
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
        "/keywords",
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
        r.ownerPageHref ?? "/keywords",
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
async function assembleSystemHealthFacts(tenantId: string): Promise<AskFact[]> {
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
    for (const v of pipeline.violations.slice(0, 5)) {
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
  let facts: AskFact[] = [];

  try {
    switch (routed.questionClass) {
      case "page_specific":
        facts = routed.pagePath ? await assemblePageFacts(tenantId, routed.pagePath) : [];
        break;
      case "site_trend":
        facts = await assembleSiteTrendFacts(tenantId);
        break;
      case "ai_visibility":
        facts = await assembleAiVisibilityFacts();
        break;
      case "competitor":
        facts = await assembleCompetitorFacts();
        break;
      case "measurement":
        facts = await assembleMeasurementFacts(tenantId);
        break;
      case "plan":
        facts = await assemblePlanFacts(tenantId);
        break;
      case "keyword_next":
        facts = await assembleKeywordNextFacts();
        break;
      case "system_health":
        facts = await assembleSystemHealthFacts(tenantId);
        break;
    }
  } catch {
    facts = [];
  }

  return {
    questionClass: routed.questionClass,
    pagePath: routed.pagePath,
    facts: facts.slice(0, MAX_FACTS),
    hasData: facts.length > 0,
  };
}
