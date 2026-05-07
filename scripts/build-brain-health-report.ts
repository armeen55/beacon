/**
 * build-brain-health-report — Trust Sprint Mini-Phase T6.1 (2026-05-06).
 *
 * Operator-only single-page brain health report. Pure compute. No paid
 * APIs. No mutations. Reads canonical stores + verdict store + integrity
 * surface, grades 5 health dimensions A → D, rolls up to one Brain
 * Readiness grade, and emits the 3 highest-leverage trust fixes.
 *
 * Five sections:
 *   1. Data Health — are observations landing? sampling consistent?
 *   2. Score Health — visibility populated? owned URLs cited?
 *   3. Recommendation Health — queue alive? LLM recs surviving?
 *   4. Attribution Health — verdict store sane? drift count?
 *   5. Brain Readiness Grade — composite roll-up + next 3 fixes
 *
 * Internal-only. No customer surface. No external strings. The brief's
 * "internally rigorous, externally confident" principle applies — this
 * report is the internal half.
 *
 * Default: prints markdown to stdout AND writes a JSON snapshot to
 *   .data/_reports/brain-health-{ts}.json
 * for trend tracking. Pass --no-persist to skip the JSON write.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-brain-health-report.ts
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/build-brain-health-report.ts --no-persist
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import {
  getPromptAnswerObservations,
  getDailyMetricSnapshots,
} from "../src/storage/canonical-store";
import { readRecommendedEditsLocal } from "../src/domains/recommendations/recommended-edits-persistence";
import { getUrlChangeOutcomes } from "../src/domains/attribution/url-change-outcome";
import { getCitationEvidenceIndex } from "../src/domains/pages/citation-evidence-store";
import { getChangelogEntries } from "../src/lib/seed-data.server";
import { computeUrlVerdict } from "../src/domains/attribution/url-verdict";
import {
  buildUrlCitationHistory,
  denseSeries,
} from "../src/domains/product/url-citation-history";
import {
  buildSamplingStatusByDate,
  resolveChangeDate,
  stampSamplingStatus,
} from "../src/domains/attribution/url-change-outcome";
import { isLifecycleVerdictEnabled } from "../src/lib/flags";
import type { ChangelogEntry } from "../src/domains/changelog/types";

type Grade = "A" | "B" | "C" | "D";

type Metric = {
  label: string;
  value: string;
  grade: Grade;
  reason: string;
};

type Section = {
  name: string;
  grade: Grade;
  metrics: Metric[];
};

type Fix = {
  rank: number;
  what: string;
  why: string;
  surface: string;
};

type BrainHealthReport = {
  generated_at: string;
  tenant_id: string;
  brain_readiness_grade: Grade;
  one_line_summary: string;
  sections: Section[];
  next_three_fixes: Fix[];
};

const REPO_ROOT = resolve(__dirname, "..");
const REPORTS_DIR = join(REPO_ROOT, ".data", "_reports");
const PERSIST = !process.argv.includes("--no-persist");
const TENANT_ID = process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";

// ── Grade helpers ──────────────────────────────────────────────────────

function gradeFromTiers(value: number, tiers: { A: number; B: number; C: number }): Grade {
  if (value >= tiers.A) return "A";
  if (value >= tiers.B) return "B";
  if (value >= tiers.C) return "C";
  return "D";
}

function worstGrade(grades: Grade[]): Grade {
  if (grades.includes("D")) return "D";
  if (grades.includes("C")) return "C";
  if (grades.includes("B")) return "B";
  return "A";
}

function rollUp(sectionGrades: Grade[]): Grade {
  if (sectionGrades.includes("D")) return "D";
  const cCount = sectionGrades.filter((g) => g === "C").length;
  if (cCount >= 2) return "C";
  if (cCount === 1) return "B";
  if (sectionGrades.every((g) => g === "A")) return "A";
  return "B";
}

function gradeBadge(g: Grade): string {
  if (g === "A") return "A — strong";
  if (g === "B") return "B — solid";
  if (g === "C") return "C — gap";
  return "D — blocker";
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Section 1 — Data Health ────────────────────────────────────────────

async function buildDataHealth(): Promise<Section> {
  const obs = await getPromptAnswerObservations();
  const cutoff = daysAgoISO(7);
  const recent = obs.filter((o) => (o.observed_at ?? "").slice(0, 10) >= cutoff);

  const totalRecent = recent.length;
  const totalGrade = gradeFromTiers(totalRecent, { A: 600, B: 300, C: 100 });

  // Daily consistency
  const byDate = new Map<string, number>();
  for (const o of recent) byDate.set((o.observed_at ?? "").slice(0, 10), (byDate.get((o.observed_at ?? "").slice(0, 10)) ?? 0) + 1);
  const counts = [...byDate.values()];
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1);
  const sd = Math.sqrt(
    counts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(counts.length, 1),
  );
  const cv = mean > 0 ? sd / mean : 1;
  const consistencyGrade: Grade = cv < 0.3 ? "A" : cv < 0.5 ? "B" : cv < 0.7 ? "C" : "D";

  // Platform coverage
  const platforms = new Set(recent.map((o) => o.platform));
  const hasPerplexity = platforms.has("perplexity");
  const hasChatGPT = platforms.has("chatgpt");
  const platformGrade: Grade = hasPerplexity && hasChatGPT ? "A" : hasPerplexity || hasChatGPT ? "C" : "D";

  // Sampling status (per-day rollup, not per-row, since status is a day-level tag)
  let fullDays = 0;
  let totalDays = 0;
  for (const [, c] of byDate) {
    totalDays += 1;
    if (c >= 80) fullDays += 1;
  }
  const fullPct = totalDays > 0 ? fullDays / totalDays : 0;
  const samplingGrade = gradeFromTiers(fullPct * 100, { A: 80, B: 60, C: 40 });

  return {
    name: "Data Health",
    grade: worstGrade([totalGrade, consistencyGrade, platformGrade, samplingGrade]),
    metrics: [
      {
        label: "observations (last 7d)",
        value: String(totalRecent),
        grade: totalGrade,
        reason: `expects ≥600 / 7d for healthy 100-prompt × 2-platform polling`,
      },
      {
        label: "daily consistency (CV)",
        value: cv.toFixed(2),
        grade: consistencyGrade,
        reason: `coefficient-of-variation across ${counts.length} polled days; <0.30 = A`,
      },
      {
        label: "platform coverage",
        value: [...platforms].sort().join(", ") || "(none)",
        grade: platformGrade,
        reason: "expects perplexity + chatgpt both present in last 7d",
      },
      {
        label: "full-coverage poll days",
        value: `${fullDays}/${totalDays} (${(fullPct * 100).toFixed(0)}%)`,
        grade: samplingGrade,
        reason: "≥80 obs/day = full coverage; <40% full days = D",
      },
    ],
  };
}

// ── Section 2 — Score Health ────────────────────────────────────────────

async function buildScoreHealth(): Promise<Section> {
  const snapshots = await getDailyMetricSnapshots();
  const cidx = await getCitationEvidenceIndex();

  // CitationEvidenceIndex is keyed by `by_page_and_topic` — one row per
  // (page × topic). Aggregate owned pages by URL.
  const rollups = (cidx?.by_page_and_topic ?? []) as Array<{
    is_owned: boolean;
    page_url: string;
    total_citations: number;
  }>;
  const ownedByUrl = new Map<string, number>();
  for (const r of rollups) {
    if (!r.is_owned) continue;
    ownedByUrl.set(r.page_url, (ownedByUrl.get(r.page_url) ?? 0) + (r.total_citations ?? 0));
  }
  const owned = [...ownedByUrl.entries()].map(([url, c]) => ({ url, total_citations: c }));

  const cutoff = daysAgoISO(7);
  const recentSnaps = snapshots.filter((s) => s.date >= cutoff);
  const platformSnaps = recentSnaps.filter((s) => s.scope_type === "platform");
  const platformsCovered = new Set(platformSnaps.map((s) => s.scope_id));
  const visibilityGrade: Grade = platformsCovered.size >= 2 ? "A" : platformsCovered.size === 1 ? "C" : "D";

  const ownedCited = owned.filter((u) => u.total_citations > 0).length;
  const ownedGrade = gradeFromTiers(ownedCited, { A: 10, B: 5, C: 2 });

  const topOwned = [...owned].sort((a, b) => b.total_citations - a.total_citations)[0];
  const topCitations = topOwned?.total_citations ?? 0;
  const topGrade = gradeFromTiers(topCitations, { A: 50, B: 20, C: 5 });

  return {
    name: "Score Health",
    grade: worstGrade([visibilityGrade, ownedGrade, topGrade]),
    metrics: [
      {
        label: "platform snapshots (last 7d)",
        value: [...platformsCovered].sort().join(", ") || "(none)",
        grade: visibilityGrade,
        reason: "≥2 platforms with derived snapshots in last 7d = A",
      },
      {
        label: "owned URLs with citations",
        value: String(ownedCited),
        grade: ownedGrade,
        reason: `${owned.length} owned URLs in citation index; ≥10 cited = A`,
      },
      {
        label: "top owned URL citations",
        value: topOwned?.url ? `${topCitations}× — ${topOwned.url}` : "(none)",
        grade: topGrade,
        reason: "top-cited owned page: ≥50 = A, ≥20 = B, ≥5 = C",
      },
    ],
  };
}

// ── Section 3 — Recommendation Health ──────────────────────────────────

async function buildRecommendationHealth(): Promise<Section> {
  const recs = await readRecommendedEditsLocal();
  const totalGrade = gradeFromTiers(recs.length, { A: 10, B: 5, C: 2 });

  const cutoffStale = daysAgoISO(7);
  // "recommended" is the initial post-engine status (operator hasn't acted yet).
  // Stale = rec sat in "recommended" >7d without operator action.
  const stale = recs.filter(
    (r) => r.implementation_status === "recommended" && (r.created_at ?? "") < cutoffStale,
  );
  const staleGrade: Grade = stale.length === 0 ? "A" : stale.length <= 3 ? "B" : stale.length <= 9 ? "C" : "D";

  const llmRecs = recs.filter((r) => r.source === "openai" || r.source === "anthropic");
  // "Reviewed" = operator has acted on the rec (not still pending in queue).
  // "Accepted" = ship-rate proxy (accepted or verified_live).
  // Grade reflects operator-response quality, not absolute queue depth.
  const llmReviewed = llmRecs.filter(
    (r) =>
      r.implementation_status === "accepted" ||
      r.implementation_status === "verified_live" ||
      r.implementation_status === "dismissed",
  ).length;
  const llmAccepted = llmRecs.filter(
    (r) => r.implementation_status === "accepted" || r.implementation_status === "verified_live",
  ).length;
  const llmAcceptPctOfReviewed = llmReviewed > 0 ? (llmAccepted / llmReviewed) * 100 : 0;
  const llmGrade: Grade =
    llmRecs.length === 0 ? "B" // not surprising; deterministic-only era
    : llmReviewed === 0 ? "B" // queue fresh; no signal yet
    : llmAcceptPctOfReviewed >= 50 ? "A"
    : llmAcceptPctOfReviewed >= 25 ? "B"
    : llmAcceptPctOfReviewed >= 10 ? "C"
    : "D";

  const statusBreakdown = new Map<string, number>();
  for (const r of recs) {
    const k = r.implementation_status ?? "(none)";
    statusBreakdown.set(k, (statusBreakdown.get(k) ?? 0) + 1);
  }
  const statusStr = [...statusBreakdown.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return {
    name: "Recommendation Health",
    grade: worstGrade([totalGrade, staleGrade, llmGrade]),
    metrics: [
      {
        label: "queue size",
        value: `${recs.length} (${statusStr})`,
        grade: totalGrade,
        reason: "≥10 active recs = A; <2 = D (queue starved)",
      },
      {
        label: "stale proposed (>7d)",
        value: String(stale.length),
        grade: staleGrade,
        reason: "proposed >7d is operator-pressure; 0 = A, ≥10 = D",
      },
      {
        label: "LLM-source ship-rate (of reviewed)",
        value: `${llmAccepted}/${llmReviewed} of ${llmRecs.length} reviewed (${llmAcceptPctOfReviewed.toFixed(0)}%)`,
        grade: llmGrade,
        reason: "LLM ship-rate AMONG operator-reviewed recs; queue-pending recs don't count against it; ≥50% = A",
      },
    ],
  };
}

// ── Section 4 — Attribution Health ─────────────────────────────────────

async function buildAttributionHealth(): Promise<Section & { drift: number; weakSignal: number }> {
  const persisted = await getUrlChangeOutcomes();
  const totalGrade = gradeFromTiers(persisted.length, { A: 50, B: 25, C: 10 });

  // Verdict distribution
  const dist = new Map<string, number>();
  for (const v of persisted) dist.set(v.verdict, (dist.get(v.verdict) ?? 0) + 1);
  const distStr = [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ");
  const helpingPct = ((dist.get("helping") ?? 0) / Math.max(persisted.length, 1)) * 100;
  // Healthy verdict mix: 30-60% helping. Higher than 95% = clearly contaminated.
  const mixGrade: Grade =
    helpingPct >= 30 && helpingPct <= 60 ? "A"
    : helpingPct >= 20 && helpingPct <= 80 ? "B"
    : helpingPct <= 95 ? "C"
    : "D";

  // weak_signal emergence
  const weakSignal = dist.get("weak_signal") ?? 0;

  // Drift detection (re-run integrity logic in-process)
  let drift = 0;
  try {
    const history = await buildUrlCitationHistory({ ownedOnly: true });
    const changes = (await getChangelogEntries()) as ChangelogEntry[];
    let samplingStatusByDate: Awaited<ReturnType<typeof buildSamplingStatusByDate>> = new Map();
    try {
      const obs = await getPromptAnswerObservations();
      samplingStatusByDate = buildSamplingStatusByDate(obs);
    } catch {
      // back-compat: untagged points → all "full"
    }
    const useFlag = isLifecycleVerdictEnabled();
    const changeById = new Map(changes.map((c) => [c.id, c]));
    for (const row of persisted) {
      const change = changeById.get(row.change_id);
      if (!change) continue;
      const anchor = resolveChangeDate(change, useFlag);
      if (!anchor) continue;
      const entry = history.series.find(
        (e) => e.url === row.url || (e.raw_urls ?? []).includes(row.url),
      );
      if (!entry) continue;
      const range = { first: history.date_range.first ?? "", last: history.date_range.last ?? "" };
      if (!range.first || !range.last) continue;
      const denseRaw = denseSeries(entry, range);
      const series = stampSamplingStatus(denseRaw, samplingStatusByDate);
      const r = computeUrlVerdict({
        series,
        changeDate: anchor,
        asOfDate: history.date_range.last ?? undefined,
      });
      if (r.verdict !== row.verdict) drift += 1;
    }
  } catch (err) {
    console.warn("(attribution drift check failed; treating as 0)", err instanceof Error ? err.message : err);
  }
  const driftGrade: Grade = drift === 0 ? "A" : drift <= 3 ? "B" : drift <= 9 ? "C" : "D";

  return {
    name: "Attribution Health",
    grade: worstGrade([totalGrade, mixGrade, driftGrade]),
    drift,
    weakSignal,
    metrics: [
      {
        label: "persisted verdicts",
        value: `${persisted.length} (${distStr})`,
        grade: totalGrade,
        reason: "≥50 verdicts feed the attribution surface; <10 = D",
      },
      {
        label: "verdict mix (helping %)",
        value: `${helpingPct.toFixed(1)}%`,
        grade: mixGrade,
        reason: "30–60% helping = healthy; >95% = clearly contaminated",
      },
      {
        label: "T5.2 drift (recompute disagreement)",
        value: String(drift),
        grade: driftGrade,
        reason: "rows whose persisted verdict disagrees with T5.2 recompute; 0 = A; ≥10 = D",
      },
      {
        label: "weak_signal emergence",
        value: `${weakSignal} rows`,
        grade: "B", // informational only — don't fail on this
        reason: "T5.2 tier — informational; presence = engine working",
      },
    ],
  };
}

// ── Section 5 — Brain Readiness Grade + Next 3 Fixes ───────────────────

function deriveNextFixes(sections: Section[], drift: number, weakSignal: number): Fix[] {
  const fixes: Fix[] = [];

  // Highest-leverage = anything graded D, then C, sorted by section priority:
  // Data > Attribution > Recommendation > Score (because data quality is upstream of all others)
  const priority: Record<string, number> = {
    "Data Health": 1,
    "Attribution Health": 2,
    "Recommendation Health": 3,
    "Score Health": 4,
  };

  const allMetrics: Array<{ section: string; metric: Metric; sectionPriority: number }> = [];
  for (const s of sections) {
    for (const m of s.metrics) {
      allMetrics.push({ section: s.name, metric: m, sectionPriority: priority[s.name] ?? 99 });
    }
  }

  const ranked = allMetrics
    .filter((x) => x.metric.grade === "C" || x.metric.grade === "D")
    .sort((a, b) => {
      const gOrder: Record<Grade, number> = { D: 0, C: 1, B: 2, A: 3 };
      const ga = gOrder[a.metric.grade] - gOrder[b.metric.grade];
      if (ga !== 0) return ga;
      return a.sectionPriority - b.sectionPriority;
    });

  for (let i = 0; i < Math.min(3, ranked.length); i += 1) {
    const r = ranked[i];
    fixes.push({
      rank: i + 1,
      what: `${r.section} — ${r.metric.label} (${r.metric.grade})`,
      why: r.metric.reason,
      surface: r.section,
    });
  }

  // Pad with positive forward-look items if fewer than 3 issues
  if (fixes.length < 3) {
    if (drift > 0 && !fixes.some((f) => f.what.includes("drift"))) {
      fixes.push({
        rank: fixes.length + 1,
        what: `Attribution Health — T5.2 drift (${drift} row${drift === 1 ? "" : "s"})`,
        why: "Materializer is one-way; persisted helping verdicts whose T5.2 recompute lands non-terminal don't demote. Documented at T5.3.",
        surface: "Attribution Health",
      });
    }
    if (fixes.length < 3 && weakSignal === 0) {
      fixes.push({
        rank: fixes.length + 1,
        what: "Attribution Health — weak_signal tier hasn't emerged yet",
        why: "T5.2 added the tier; expect first emergence after the next 07:00 UTC cron rematerialization on a row with z ∈ [1.2, 2.0).",
        surface: "Attribution Health",
      });
    }
    if (fixes.length < 3) {
      fixes.push({
        rank: fixes.length + 1,
        what: "Brain readiness — continue T6.2 (local AEO database foundation)",
        why: "Every health dimension currently has data; next leverage is derived intelligence (daily/weekly platform summaries, competitor trajectories) so the brain has materialized signals, not just raw observations.",
        surface: "Brain Readiness",
      });
    }
  }

  return fixes;
}

// ── Renderer ───────────────────────────────────────────────────────────

function renderReport(report: BrainHealthReport): string {
  const lines: string[] = [];
  lines.push(`# Brain Health Report — ${report.tenant_id}`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push(`## Brain Readiness Grade: ${gradeBadge(report.brain_readiness_grade)}`);
  lines.push(report.one_line_summary);
  lines.push("");
  for (const s of report.sections) {
    lines.push(`### ${s.name} — ${gradeBadge(s.grade)}`);
    for (const m of s.metrics) {
      lines.push(`  • [${m.grade}] ${m.label}: ${m.value}`);
      lines.push(`        ${m.reason}`);
    }
    lines.push("");
  }
  lines.push(`### Next 3 highest-leverage trust fixes`);
  for (const f of report.next_three_fixes) {
    lines.push(`  ${f.rank}. ${f.what}`);
    lines.push(`     why: ${f.why}`);
    lines.push(`     surface: ${f.surface}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("build-brain-health-report — Trust Sprint T6.1");
  console.log("Pure compute. Operator-only. No paid APIs. No mutations.\n");

  const dataHealth = await buildDataHealth();
  const scoreHealth = await buildScoreHealth();
  const recHealth = await buildRecommendationHealth();
  const attribHealthFull = await buildAttributionHealth();
  const { drift, weakSignal, ...attribHealth } = attribHealthFull;

  const sections = [dataHealth, scoreHealth, recHealth, attribHealth as Section];
  const sectionGrades = sections.map((s) => s.grade);
  const overall = rollUp(sectionGrades);

  const summary =
    overall === "A"
      ? "Brain is in good shape. Internal rigor high; recommend continuing T6.2."
      : overall === "B"
        ? "Brain is solid with one or two non-blocking gaps. Address fixes below in order."
        : overall === "C"
          ? "Brain has multiple gaps. Two areas need attention before customer-2."
          : "Trust blocker present. Resolve the D-graded section before continuing.";

  const fixes = deriveNextFixes(sections, drift, weakSignal);

  const report: BrainHealthReport = {
    generated_at: new Date().toISOString(),
    tenant_id: TENANT_ID,
    brain_readiness_grade: overall,
    one_line_summary: summary,
    sections,
    next_three_fixes: fixes,
  };

  const rendered = renderReport(report);
  console.log(rendered);

  if (PERSIST) {
    const ts = report.generated_at.replace(/[:.]/g, "-").slice(0, 19);
    const reportPath = join(REPORTS_DIR, `brain-health-${ts}.json`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\nReport snapshot → ${reportPath}`);
  } else {
    console.log("\n(--no-persist set; snapshot skipped)");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("build-brain-health-report crashed:", err);
  process.exit(2);
});
