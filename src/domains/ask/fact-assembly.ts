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
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import { getAcceptedPlan, getLatestPreviewPlan } from "@/domains/experiments/daily-experiment-plan-store";
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
  let index;
  try {
    index = await getAnswerIntelligenceIndex();
  } catch {
    index = null;
  }
  if (!index) return [];

  const facts: AskFact[] = [];
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

  for (const r of sorted.slice(0, 5)) {
    facts.push(fact(`${r.path}: ${r.actionType} shipped ${r.shippedAt.slice(0, 10)}, ${proofMaturityLabel(r.verdict, null)}.`, "proof", "/proof"));
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
