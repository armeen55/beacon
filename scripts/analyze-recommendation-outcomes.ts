/**
 * analyze-recommendation-outcomes — Trust Sprint Mini-Phase T6.3.
 *
 * Read-only diagnostic. Surfaces what learnings are POSSIBLE from the
 * current rec queue + URL-outcome verdict store. No engine changes.
 * No paid APIs. No mutations. Pure compute.
 *
 * Six analysis dimensions:
 *   1. Funnel by implementation_status (recommended → accepted → verified_live)
 *   2. Funnel by source (deterministic vs openai)
 *   3. Funnel by confidence (low / medium / high)
 *   4. Time-to-live distribution for verified_live recs
 *   5. Cost vs outcome — $/shipped rec for LLM source
 *   6. Rec → URL outcome join (target_url → url-change-outcomes.verdict)
 *
 * Output:
 *   • Markdown to stdout
 *   • JSON snapshot to .data/_reports/rec-outcome-analysis-{ts}.json
 *   • Honest gaps section: where the join can't be made and why
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/analyze-recommendation-outcomes.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
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

import { readRecommendedEditsLocal } from "../src/domains/recommendations/recommended-edits-persistence";
import { getUrlChangeOutcomes } from "../src/domains/attribution/url-change-outcome";
import type { RecommendedEditRow, ImplementationStatus } from "../src/domains/recommendations/recommended-edits-persistence";

const REPO_ROOT = resolve(__dirname, "..");
const REPORTS_DIR = join(REPO_ROOT, ".data", "_reports");

type Counter<K extends string> = Map<K, number>;

function inc<K extends string>(m: Counter<K>, k: K): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function statusOf(r: RecommendedEditRow): ImplementationStatus {
  return r.implementation_status ?? "recommended";
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ── Analysis dimensions ────────────────────────────────────────────────

function analyzeStatusFunnel(recs: RecommendedEditRow[]) {
  const byStatus = new Map<string, number>();
  for (const r of recs) inc(byStatus, statusOf(r));
  return {
    total: recs.length,
    by_status: Object.fromEntries(byStatus),
  };
}

function analyzeSourceFunnel(recs: RecommendedEditRow[]) {
  const sources = new Map<string, { total: number; reviewed: number; accepted: number; verified_live: number; dismissed: number }>();
  for (const r of recs) {
    const s = r.source ?? "unknown";
    let row = sources.get(s);
    if (!row) {
      row = { total: 0, reviewed: 0, accepted: 0, verified_live: 0, dismissed: 0 };
      sources.set(s, row);
    }
    row.total += 1;
    const st = statusOf(r);
    if (st === "accepted" || st === "verified_live" || st === "verified_live_modified" || st === "dismissed") row.reviewed += 1;
    if (st === "accepted") row.accepted += 1;
    if (st === "verified_live" || st === "verified_live_modified") row.verified_live += 1;
    if (st === "dismissed") row.dismissed += 1;
  }
  const out: Record<string, unknown> = {};
  for (const [s, row] of sources) {
    out[s] = {
      ...row,
      ship_rate_of_reviewed: pct(row.accepted + row.verified_live, row.reviewed),
      ship_rate_of_total: pct(row.accepted + row.verified_live, row.total),
    };
  }
  return out;
}

function analyzeConfidenceFunnel(recs: RecommendedEditRow[]) {
  const out: Record<string, { total: number; reviewed: number; shipped: number; ship_rate_of_reviewed: string }> = {};
  for (const conf of ["high", "medium", "low"] as const) {
    const subset = recs.filter((r) => r.confidence === conf);
    const reviewed = subset.filter((r) => {
      const st = statusOf(r);
      return st === "accepted" || st === "verified_live" || st === "verified_live_modified" || st === "dismissed";
    }).length;
    const shipped = subset.filter((r) => {
      const st = statusOf(r);
      return st === "accepted" || st === "verified_live" || st === "verified_live_modified";
    }).length;
    out[conf] = {
      total: subset.length,
      reviewed,
      shipped,
      ship_rate_of_reviewed: pct(shipped, reviewed),
    };
  }
  return out;
}

function analyzeTimeToLive(recs: RecommendedEditRow[]) {
  const live = recs.filter((r) => r.live_at && r.created_at);
  if (live.length === 0) {
    return {
      verified_live_count: 0,
      median_days_to_live: null,
      distribution: {},
      note: "No verified_live rows with both created_at + live_at populated.",
    };
  }
  const days = live
    .map((r) => {
      const created = new Date(r.created_at).getTime();
      const livedAt = new Date(r.live_at!).getTime();
      return (livedAt - created) / (24 * 3600 * 1000);
    })
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  const median = days.length > 0 ? days[Math.floor(days.length / 2)] : null;
  const buckets = {
    "same_day": days.filter((d) => d < 1).length,
    "1-3_days": days.filter((d) => d >= 1 && d < 3).length,
    "3-7_days": days.filter((d) => d >= 3 && d < 7).length,
    "7-14_days": days.filter((d) => d >= 7 && d < 14).length,
    "14+_days": days.filter((d) => d >= 14).length,
  };
  return {
    verified_live_count: live.length,
    median_days_to_live: median !== null ? Number(median.toFixed(2)) : null,
    distribution: buckets,
    note: null,
  };
}

function analyzeCostVsShip(recs: RecommendedEditRow[]) {
  const llm = recs.filter((r) => r.source === "openai" || r.source === "anthropic");
  const totalCost = llm.reduce((acc, r) => acc + (r.cost_usd ?? 0), 0);
  const shipped = llm.filter((r) => {
    const st = statusOf(r);
    return st === "accepted" || st === "verified_live" || st === "verified_live_modified";
  });
  const reviewed = llm.filter((r) => {
    const st = statusOf(r);
    return st === "accepted" || st === "verified_live" || st === "verified_live_modified" || st === "dismissed";
  });
  return {
    llm_recs: llm.length,
    total_cost_usd: Number(totalCost.toFixed(4)),
    avg_cost_per_rec_usd: llm.length > 0 ? Number((totalCost / llm.length).toFixed(4)) : 0,
    shipped: shipped.length,
    reviewed: reviewed.length,
    cost_per_shipped_usd: shipped.length > 0 ? Number((totalCost / shipped.length).toFixed(4)) : null,
    cost_per_reviewed_usd: reviewed.length > 0 ? Number((totalCost / reviewed.length).toFixed(4)) : null,
  };
}

type RecOutcomeJoin = {
  recs_with_target_url: number;
  recs_with_url_outcome_present: number;
  recs_join_rate: string;
  by_verdict: Record<string, number>;
  by_action_type_x_verdict: Record<string, Record<string, number>>;
  notes: string[];
};

/**
 * Normalize URL to "path only" form ("/design-studio") for cross-store
 * join. recommended_edits.target_url is full URL; url_change_outcomes.url
 * is path-only — found 2026-05-06 during T6.3 preflight. Until that
 * data-flow inconsistency is resolved, normalize at read-time so the
 * join works.
 */
function urlToPath(u: string | null | undefined): string {
  if (!u) return "";
  if (u.startsWith("/")) return u;
  try {
    const parsed = new URL(u);
    return parsed.pathname || "/";
  } catch {
    return u;
  }
}

function analyzeRecToOutcomeJoin(
  recs: RecommendedEditRow[],
  outcomes: Awaited<ReturnType<typeof getUrlChangeOutcomes>>,
): RecOutcomeJoin {
  const outcomeByUrl = new Map<string, string[]>(); // path → list of verdicts
  for (const o of outcomes) {
    const path = urlToPath(o.url);
    const list = outcomeByUrl.get(path) ?? [];
    list.push(o.verdict);
    outcomeByUrl.set(path, list);
  }
  const withUrl = recs.filter((r) => !!r.target_url);
  const matched = withUrl.filter((r) => outcomeByUrl.has(urlToPath(r.target_url)));
  const byVerdict = new Map<string, number>();
  const byActionXVerdict = new Map<string, Map<string, number>>();
  for (const r of matched) {
    const verdicts = outcomeByUrl.get(urlToPath(r.target_url)) ?? [];
    // Use the FIRST verdict (each URL may have many; the join is best-effort
    // many-to-many — recs aren't 1:1 with changelog rows).
    const verdict = verdicts[0] ?? "(unknown)";
    inc(byVerdict, verdict);
    const action = r.action_type ?? "(none)";
    let m = byActionXVerdict.get(action);
    if (!m) {
      m = new Map();
      byActionXVerdict.set(action, m);
    }
    inc(m, verdict);
  }
  const byActionXVerdictObj: Record<string, Record<string, number>> = {};
  for (const [a, m] of byActionXVerdict) byActionXVerdictObj[a] = Object.fromEntries(m);
  return {
    recs_with_target_url: withUrl.length,
    recs_with_url_outcome_present: matched.length,
    recs_join_rate: pct(matched.length, withUrl.length),
    by_verdict: Object.fromEntries(byVerdict),
    by_action_type_x_verdict: byActionXVerdictObj,
    notes: [
      "URL normalization mismatch surfaced during T6.3 preflight: recommended_edits.target_url is a full URL (https://ritzbuilders.com/locations/los-altos) while url_change_outcomes.url is path-only (/design-studio). This analyzer normalizes both to path-only at read-time. Long-term, normalize at write-time so the join is structural, not analyzer-side.",
      "Join is many-to-many on URL alone: a single path may have multiple verdicts (one per changelog × URL pair). This summary picks the first verdict per URL. A rec → outcome causal link requires the changelog row the rec produced; today's recs persistence does not stamp the changelog id on the rec row directly. Stamping rec_id ↔ change_id at accept-time would make this join 1:1.",
      "Recs whose target_url path has no outcome row have either not been shipped yet OR target a URL the verdict engine has not evaluated (e.g., the URL is excluded from owned-URL tracking, or no changelog row was produced).",
    ],
  };
}

// ── Markdown renderer ──────────────────────────────────────────────────

function renderReport(report: any): string {
  const lines: string[] = [];
  lines.push(`# Rec → Outcome Analysis (Trust Sprint T6.3 preflight)`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push(`## 1. Status funnel`);
  lines.push(`Total recs: **${report.status_funnel.total}**`);
  for (const [k, v] of Object.entries(report.status_funnel.by_status as Record<string, number>)) {
    lines.push(`  • ${k.padEnd(28)} ${v}`);
  }
  lines.push("");
  lines.push(`## 2. Source funnel`);
  for (const [src, row] of Object.entries(report.source_funnel as Record<string, any>)) {
    lines.push(`  ${src}:`);
    lines.push(`    total ${row.total}, reviewed ${row.reviewed}, accepted ${row.accepted}, verified_live ${row.verified_live}, dismissed ${row.dismissed}`);
    lines.push(`    ship-rate of reviewed: ${row.ship_rate_of_reviewed}; ship-rate of total: ${row.ship_rate_of_total}`);
  }
  lines.push("");
  lines.push(`## 3. Confidence funnel`);
  for (const [conf, row] of Object.entries(report.confidence_funnel as Record<string, any>)) {
    lines.push(`  ${conf.padEnd(8)} total ${row.total}, reviewed ${row.reviewed}, shipped ${row.shipped} (ship-rate of reviewed: ${row.ship_rate_of_reviewed})`);
  }
  lines.push("");
  lines.push(`## 4. Time to live`);
  lines.push(`  verified_live count: ${report.time_to_live.verified_live_count}`);
  lines.push(`  median days to live: ${report.time_to_live.median_days_to_live ?? "(n/a)"}`);
  for (const [bucket, count] of Object.entries(report.time_to_live.distribution as Record<string, number>)) {
    lines.push(`  • ${bucket.padEnd(12)} ${count}`);
  }
  if (report.time_to_live.note) lines.push(`  note: ${report.time_to_live.note}`);
  lines.push("");
  lines.push(`## 5. Cost vs ship (LLM source only)`);
  const c = report.cost_vs_ship;
  lines.push(`  LLM recs: ${c.llm_recs}`);
  lines.push(`  total cost: $${c.total_cost_usd.toFixed(4)}`);
  lines.push(`  avg cost per rec: $${c.avg_cost_per_rec_usd.toFixed(4)}`);
  lines.push(`  shipped: ${c.shipped} of ${c.reviewed} reviewed`);
  lines.push(`  cost per shipped: ${c.cost_per_shipped_usd === null ? "(no shipped)" : `$${c.cost_per_shipped_usd.toFixed(4)}`}`);
  lines.push(`  cost per reviewed: ${c.cost_per_reviewed_usd === null ? "(no reviewed)" : `$${c.cost_per_reviewed_usd.toFixed(4)}`}`);
  lines.push("");
  lines.push(`## 6. Rec → URL outcome join`);
  const j = report.rec_to_outcome_join;
  lines.push(`  recs with target_url: ${j.recs_with_target_url}`);
  lines.push(`  recs whose target_url has a verdict: ${j.recs_with_url_outcome_present} (join rate: ${j.recs_join_rate})`);
  if (Object.keys(j.by_verdict).length > 0) {
    lines.push(`  verdict mix on joined recs:`);
    for (const [v, n] of Object.entries(j.by_verdict as Record<string, number>)) {
      lines.push(`    • ${v.padEnd(28)} ${n}`);
    }
  }
  if (Object.keys(j.by_action_type_x_verdict).length > 0) {
    lines.push(`  by action_type × verdict:`);
    for (const [a, m] of Object.entries(j.by_action_type_x_verdict as Record<string, Record<string, number>>)) {
      const parts = Object.entries(m).map(([v, n]) => `${v}=${n}`).join(", ");
      lines.push(`    • ${a.padEnd(24)} ${parts}`);
    }
  }
  for (const note of j.notes as string[]) lines.push(`  note: ${note}`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("analyze-recommendation-outcomes — Trust Sprint T6.3 preflight");
  console.log("Read-only. No engine changes. No paid APIs. No mutations.\n");

  console.log("Loading recommended edits + URL outcomes…");
  const recs = await readRecommendedEditsLocal();
  const outcomes = await getUrlChangeOutcomes();
  console.log(`  recommended_edits: ${recs.length}`);
  console.log(`  url_change_outcomes: ${outcomes.length}\n`);

  const report = {
    generated_at: new Date().toISOString(),
    counts: {
      recommended_edits: recs.length,
      url_change_outcomes: outcomes.length,
    },
    status_funnel: analyzeStatusFunnel(recs),
    source_funnel: analyzeSourceFunnel(recs),
    confidence_funnel: analyzeConfidenceFunnel(recs),
    time_to_live: analyzeTimeToLive(recs),
    cost_vs_ship: analyzeCostVsShip(recs),
    rec_to_outcome_join: analyzeRecToOutcomeJoin(recs, outcomes),
  };

  console.log(renderReport(report));

  const ts = report.generated_at.replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = join(REPORTS_DIR, `rec-outcome-analysis-${ts}.json`);
  atomicWriteJson(reportPath, report);
  console.log(`\nReport snapshot → ${reportPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("analyze-recommendation-outcomes crashed:", err);
  process.exit(2);
});
