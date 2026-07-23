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

import { readRecommendedEditsLocal } from "../src/domains/changes/recommended-edits-persistence";
import { getUrlChangeOutcomes } from "../src/domains/attribution/url-change-outcome";
import type { RecommendedEditRow, ImplementationStatus } from "../src/domains/changes/recommended-edits-persistence";
import { normalizeUrl } from "../src/lib/url/normalize";
import { getChangelogEntries } from "../src/lib/seed-data.server";
import type { ChangelogEntry } from "../src/domains/changelog/types";

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
  // CORE 100K (2026-07-21): the "derived" T4.4 confidence dimension was
  // removed together with derived-confidence.ts — the customer-facing pill
  // that consumed it died with the /recommendations surfaces. Only the
  // persisted `confidence` column remains reportable.

  const persisted: Record<string, { total: number; reviewed: number; shipped: number; ship_rate_of_reviewed: string }> = {};
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
    persisted[conf] = {
      total: subset.length,
      reviewed,
      shipped,
      ship_rate_of_reviewed: pct(shipped, reviewed),
    };
  }

  return {
    persisted,
    note:
      "Persisted is the legacy `confidence` column on recommended_edits.json — intentionally NOT mutated by T4.4. The derived T4.4 label dimension was removed with derived-confidence.ts (CORE 100K, 2026-07-21).",
  };
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
 * T7.1 — sample-size threshold below which the analyzer labels the
 * causal join "insufficient sample" rather than reporting it as a
 * trustworthy signal. Pre-T7.1 the analyzer would silently report
 * 0% / 100% / etc. on N=1 or N=2 samples. Post-T7.1 it surfaces
 * "insufficient sample (N<5)" so the brain doesn't overfit on tiny
 * Ritz-only data.
 */
const CAUSAL_SAMPLE_SIZE_FLOOR = 5;

type CausalRecOutcomeJoin = {
  /** Total persisted rec rows analyzed. */
  total_recs: number;
  /** Distinct rec stable-keys (rec.rec_id) from those rec rows. */
  distinct_rec_ids: number;
  /** Changelog rows that carry source_rec_id (Sprint 6A.1 stamping). */
  causal_stamped_changelog_rows: number;
  /** Of those, how many were produced by a rec that's still in the queue. */
  causal_stamped_with_matching_rec: number;
  /** Of those, how many have a corresponding url_change_outcomes row. */
  causal_with_outcome: number;
  /** Of those with outcome, distribution by verdict. */
  causal_by_verdict: Record<string, number>;
  /** Per-action-type × verdict on the CAUSAL chain only. */
  causal_by_action_x_verdict: Record<string, Record<string, number>>;
  /** Sample-size warning. */
  sample_size_warning: string | null;
  notes: string[];
};

/**
 * URL → path normalizer. T6.6 (2026-05-06) consolidated this onto the
 * canonical helper at `src/lib/url/normalize.ts` so a single source of
 * truth handles full URL → path, trailing slash, query/hash stripping,
 * and host-prefix stripping.
 */
function urlToPath(u: string | null | undefined): string {
  return normalizeUrl(u) ?? "";
}

/**
 * T6.3 + T6.6 join: URL-LEVEL CONTEXT, NOT CAUSAL.
 *
 * Joins recs to outcomes via shared `target_url` path. This is NOT a
 * causal link — recs that target a URL with helping verdicts may be
 * benefiting from OTHER changelog rows on the same URL (operator-
 * entered, scanner-detected, legacy import). Use the causal join
 * (`analyzeCausalRecChain`) for true rec → outcome attribution.
 */
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
      "URL-LEVEL CONTEXT, NOT CAUSAL: this join shares only `target_url` between recs and outcomes. Recs that target a URL with helping verdicts may be benefiting from OTHER changelog rows on the same URL (operator-entered, scanner-detected, legacy import). Use the causal join (Section 6.B) for true rec → outcome attribution.",
      "URL normalization is consistent post-T6.6: both sides flow through `src/lib/url/normalize.ts`. A rec → outcome causal link uses `changelog.source_rec_id` (Sprint 6A.1 typed-edit attribution) — see Section 6.B.",
      "Recs whose target_url path has no outcome row have either not been shipped yet OR target a URL the verdict engine has not evaluated (e.g., the URL is excluded from owned-URL tracking, or no changelog row was produced).",
    ],
  };
}

/**
 * T7.1 — true causal rec → changelog → outcome chain via
 * `changelog.source_rec_id` (Sprint 6A.1 typed-edit attribution).
 *
 * Architecture: an accepted rec produces N changelog rows, each
 * stamped with `source_rec_id = rec.rec_id`. The materializer then
 * computes a `url_change_outcomes` row keyed on `change_id`. This
 * function traverses that chain end-to-end, distinct from the URL-
 * level "context" join above which is correlation, not causation.
 *
 * Legacy CSV/PDF imports + scanner-detection rows lack
 * `source_rec_id` (correctly — there's no rec to link). They are
 * EXCLUDED from this causal count.
 *
 * Sample-size warning fires when `causal_with_outcome` <
 * CAUSAL_SAMPLE_SIZE_FLOOR — at that point the brain shouldn't
 * over-interpret per-action-type results.
 */
function analyzeCausalRecChain(
  recs: RecommendedEditRow[],
  changelogRows: ChangelogEntry[],
  outcomes: Awaited<ReturnType<typeof getUrlChangeOutcomes>>,
): CausalRecOutcomeJoin {
  // Build rec_id → recs map (a single rec_id may have multiple edits).
  const recIdSet = new Set(recs.map((r) => r.rec_id));

  // Filter changelog rows that carry source_rec_id stamping.
  const stamped = changelogRows.filter((c) => Boolean(c.source_rec_id));
  // Among stamped rows, which ones link to a rec still in the queue?
  const stampedMatched = stamped.filter((c) => recIdSet.has(c.source_rec_id ?? ""));

  // Outcomes keyed by change_id (the materializer's primary key half).
  const outcomeByChangeId = new Map<string, string>();
  for (const o of outcomes) {
    if (!outcomeByChangeId.has(o.change_id)) outcomeByChangeId.set(o.change_id, o.verdict);
  }

  // For each stamped+matched changelog row, look up its outcome.
  const causalWithOutcome: ChangelogEntry[] = [];
  const byVerdict = new Map<string, number>();
  const byActionXVerdict = new Map<string, Map<string, number>>();
  for (const c of stampedMatched) {
    const verdict = outcomeByChangeId.get(c.id);
    if (!verdict) continue;
    causalWithOutcome.push(c);
    inc(byVerdict, verdict);
    const action = c.action_type ?? "(none)";
    let m = byActionXVerdict.get(action);
    if (!m) {
      m = new Map();
      byActionXVerdict.set(action, m);
    }
    inc(m, verdict);
  }
  const byActionXVerdictObj: Record<string, Record<string, number>> = {};
  for (const [a, m] of byActionXVerdict) byActionXVerdictObj[a] = Object.fromEntries(m);

  const sampleWarning =
    causalWithOutcome.length < CAUSAL_SAMPLE_SIZE_FLOOR
      ? `INSUFFICIENT SAMPLE (N=${causalWithOutcome.length} < ${CAUSAL_SAMPLE_SIZE_FLOOR}) — do not draw per-action-type conclusions. Brain should label results "directional" at best until N≥${CAUSAL_SAMPLE_SIZE_FLOOR}.`
      : null;

  return {
    total_recs: recs.length,
    distinct_rec_ids: recIdSet.size,
    causal_stamped_changelog_rows: stamped.length,
    causal_stamped_with_matching_rec: stampedMatched.length,
    causal_with_outcome: causalWithOutcome.length,
    causal_by_verdict: Object.fromEntries(byVerdict),
    causal_by_action_x_verdict: byActionXVerdictObj,
    sample_size_warning: sampleWarning,
    notes: [
      "CAUSAL JOIN: rec.rec_id → changelog.source_rec_id → url_change_outcomes.change_id. Built on Sprint 6A.1 typed-edit attribution + Lifecycle OS Phase 1 stamping. This IS the per-rec, per-action-type learning chain.",
      "Legacy CSV/PDF imports + scanner-detection rows lack `source_rec_id` (correctly — there's no rec to link). They are EXCLUDED from this count.",
      "Stamped rows without a matching outcome are NOT YET SHIPPED (live_at null, materializer hasn't computed verdict) OR the materializer skipped them (no resolvable anchor). T7.2 preflight tracks this.",
    ],
  };
}

/**
 * T7.5 — Recommendation learning score v0 (causal-aware).
 *
 * Per-action-type aggregation built on the CAUSAL chain (T7.1):
 * `rec.rec_id → changelog.source_rec_id → url_change_outcomes.change_id`.
 *
 * Reports for each action_type:
 *   - shipped count                    (causal chain completed)
 *   - causal outcome count             (= shipped that have a verdict)
 *   - helping / weak_signal / nothing_yet / hurting verdict counts
 *   - sample size                      (causal outcome count)
 *   - confidence_label                 ("insufficient sample" / "directional"
 *                                       / "credible") gated by sample size
 *
 * Rules:
 *   - Sample size < 5  → "insufficient sample" — do NOT use for ranking.
 *   - 5 ≤ N < 15       → "directional" — informational only.
 *   - N ≥ 15           → "credible" — safe to feed into rec ranking once
 *                        operator opts in.
 *
 * The score does NOT mutate any rec rows. It does NOT change ranking
 * automatically. It is operator-readable + brain-health-readable.
 */

const LEARNING_SCORE_DIRECTIONAL_FLOOR = 5;
const LEARNING_SCORE_CREDIBLE_FLOOR = 15;

type LearningScoreRow = {
  action_type: string;
  /** changelog rows stamped with source_rec_id matching a live rec, with action_type set */
  shipped_causal_count: number;
  /** subset of shipped_causal_count that has a matching url_change_outcomes row */
  causal_outcome_count: number;
  causal_helping: number;
  causal_weak_signal: number;
  causal_nothing_yet: number;
  causal_hurting: number;
  causal_too_early: number;
  causal_other: number;
  sample_size: number;
  confidence_label: "insufficient_sample" | "directional" | "credible";
};

type LearningScoreV0 = {
  generated_at: string;
  rows: LearningScoreRow[];
  notes: string[];
};

function buildLearningScoreV0(
  recs: RecommendedEditRow[],
  changelogRows: ChangelogEntry[],
  outcomes: Awaited<ReturnType<typeof getUrlChangeOutcomes>>,
): LearningScoreV0 {
  const recIdSet = new Set(recs.map((r) => r.rec_id));
  const stamped = changelogRows.filter(
    (c) => Boolean(c.source_rec_id) && recIdSet.has(c.source_rec_id ?? ""),
  );
  const outcomeByChangeId = new Map<string, string>();
  for (const o of outcomes) {
    if (!outcomeByChangeId.has(o.change_id)) outcomeByChangeId.set(o.change_id, o.verdict);
  }

  // Group stamped changelog rows by action_type. (action_type stamped
  // on changelog_entries by Sprint 6A.1.)
  type Bucket = {
    shipped: number;
    helping: number;
    weak_signal: number;
    nothing_yet: number;
    hurting: number;
    too_early: number;
    other: number;
    causalOutcomes: number;
  };
  const byAction = new Map<string, Bucket>();
  for (const c of stamped) {
    const action = c.action_type ?? "(none)";
    let b = byAction.get(action);
    if (!b) {
      b = {
        shipped: 0,
        helping: 0,
        weak_signal: 0,
        nothing_yet: 0,
        hurting: 0,
        too_early: 0,
        other: 0,
        causalOutcomes: 0,
      };
      byAction.set(action, b);
    }
    b.shipped += 1;
    const verdict = outcomeByChangeId.get(c.id);
    if (!verdict) continue;
    b.causalOutcomes += 1;
    if (verdict === "helping") b.helping += 1;
    else if (verdict === "weak_signal") b.weak_signal += 1;
    else if (verdict === "nothing_yet") b.nothing_yet += 1;
    else if (verdict === "hurting") b.hurting += 1;
    else if (verdict === "too_early") b.too_early += 1;
    else b.other += 1;
  }

  // One row per action_type that shipped through the causal chain. (The
  // derived-label / evidence-depth columns died with derived-confidence.ts,
  // CORE 100K 2026-07-21.)
  const rows: LearningScoreRow[] = [];
  for (const [action, b] of byAction) {
    const sample = b.causalOutcomes;
    const conf: LearningScoreRow["confidence_label"] =
      sample >= LEARNING_SCORE_CREDIBLE_FLOOR
        ? "credible"
        : sample >= LEARNING_SCORE_DIRECTIONAL_FLOOR
          ? "directional"
          : "insufficient_sample";
    rows.push({
      action_type: action,
      shipped_causal_count: b.shipped,
      causal_outcome_count: b.causalOutcomes,
      causal_helping: b.helping,
      causal_weak_signal: b.weak_signal,
      causal_nothing_yet: b.nothing_yet,
      causal_hurting: b.hurting,
      causal_too_early: b.too_early,
      causal_other: b.other,
      sample_size: sample,
      confidence_label: conf,
    });
  }
  rows.sort((x, y) => y.causal_outcome_count - x.causal_outcome_count);

  return {
    generated_at: new Date().toISOString(),
    rows,
    notes: [
      "v0 — uses CAUSAL chain (T7.1) only. URL-level coincidence is NOT counted as causal.",
      `confidence_label gated by sample size: <${LEARNING_SCORE_DIRECTIONAL_FLOOR} = "insufficient_sample"; <${LEARNING_SCORE_CREDIBLE_FLOOR} = "directional"; ≥${LEARNING_SCORE_CREDIBLE_FLOOR} = "credible".`,
      "Brain MUST NOT change ranking based on rows labeled `insufficient_sample`. `directional` is operator-readable only. `credible` is the floor for any future ranking change (operator opts in).",
      "Rec rows are NOT mutated by this script. Pure read.",
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
  lines.push(`### Persisted (legacy column — T4.4 intentionally leaves untouched):`);
  for (const [conf, row] of Object.entries(report.confidence_funnel.persisted as Record<string, any>)) {
    lines.push(`  ${conf.padEnd(8)} total ${row.total}, reviewed ${row.reviewed}, shipped ${row.shipped} (ship-rate of reviewed: ${row.ship_rate_of_reviewed})`);
  }
  lines.push(`  note: ${report.confidence_funnel.note}`);
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
  lines.push(`## 6.A Rec → URL outcome join (URL-LEVEL CONTEXT, NOT CAUSAL)`);
  const j = report.rec_to_outcome_join;
  lines.push(`  recs with target_url: ${j.recs_with_target_url}`);
  lines.push(`  recs whose target_url has a verdict: ${j.recs_with_url_outcome_present} (join rate: ${j.recs_join_rate})`);
  if (Object.keys(j.by_verdict).length > 0) {
    lines.push(`  verdict mix on joined recs (URL coincidence only):`);
    for (const [v, n] of Object.entries(j.by_verdict as Record<string, number>)) {
      lines.push(`    • ${v.padEnd(28)} ${n}`);
    }
  }
  if (Object.keys(j.by_action_type_x_verdict).length > 0) {
    lines.push(`  by action_type × verdict (URL coincidence only):`);
    for (const [a, m] of Object.entries(j.by_action_type_x_verdict as Record<string, Record<string, number>>)) {
      const parts = Object.entries(m).map(([v, n]) => `${v}=${n}`).join(", ");
      lines.push(`    • ${a.padEnd(24)} ${parts}`);
    }
  }
  for (const note of j.notes as string[]) lines.push(`  note: ${note}`);
  lines.push("");
  // ── Section 6.B — true causal chain (T7.1)
  lines.push(`## 6.B Rec → changelog → URL outcome (CAUSAL via source_rec_id)`);
  const cj = report.causal_rec_chain;
  lines.push(`  total recs analyzed:                  ${cj.total_recs}`);
  lines.push(`  distinct rec stable-keys:             ${cj.distinct_rec_ids}`);
  lines.push(`  causal stamped changelog rows:        ${cj.causal_stamped_changelog_rows}`);
  lines.push(`  stamped + matching live rec:          ${cj.causal_stamped_with_matching_rec}`);
  lines.push(`  stamped + with url_change_outcomes:   ${cj.causal_with_outcome}`);
  if (Object.keys(cj.causal_by_verdict).length > 0) {
    lines.push(`  causal verdict mix:`);
    for (const [v, n] of Object.entries(cj.causal_by_verdict as Record<string, number>)) {
      lines.push(`    • ${v.padEnd(28)} ${n}`);
    }
  }
  if (Object.keys(cj.causal_by_action_x_verdict).length > 0) {
    lines.push(`  causal action_type × verdict:`);
    for (const [a, m] of Object.entries(cj.causal_by_action_x_verdict as Record<string, Record<string, number>>)) {
      const parts = Object.entries(m).map(([v, n]) => `${v}=${n}`).join(", ");
      lines.push(`    • ${a.padEnd(24)} ${parts}`);
    }
  }
  if (cj.sample_size_warning) {
    lines.push(`  ⚠ ${cj.sample_size_warning}`);
  }
  for (const note of cj.notes as string[]) lines.push(`  note: ${note}`);
  lines.push("");
  // ── Section 7 — T7.5 Learning score v0
  lines.push(`## 7. Recommendation learning score v0 (CAUSAL, per action_type)`);
  const ls = report.learning_score_v0;
  if (!ls.rows || ls.rows.length === 0) {
    lines.push(`  (no action_type buckets — queue is empty)`);
  } else {
    for (const r of ls.rows as any[]) {
      const tag =
        r.confidence_label === "credible"
          ? "✓ credible"
          : r.confidence_label === "directional"
            ? "→ directional"
            : "⚠ insufficient_sample";
      lines.push(
        `  [${tag.padEnd(22)}] ${r.action_type.padEnd(24)} shipped=${r.shipped_causal_count} causal_outcomes=${r.causal_outcome_count} (helping=${r.causal_helping}, weak=${r.causal_weak_signal}, nothing_yet=${r.causal_nothing_yet})`,
      );
      lines.push(`       sample_size=${r.sample_size}`);
    }
  }
  for (const note of ls.notes as string[]) lines.push(`  note: ${note}`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("analyze-recommendation-outcomes — Trust Sprint T6.3 preflight");
  console.log("Read-only. No engine changes. No paid APIs. No mutations.\n");

  console.log("Loading recommended edits + URL outcomes + changelog…");
  const recs = await readRecommendedEditsLocal();
  const outcomes = await getUrlChangeOutcomes();
  const changelogRows = (await getChangelogEntries()) as ChangelogEntry[];
  console.log(`  recommended_edits:    ${recs.length}`);
  console.log(`  url_change_outcomes:  ${outcomes.length}`);
  console.log(`  changelog_entries:    ${changelogRows.length}\n`);

  const report = {
    generated_at: new Date().toISOString(),
    counts: {
      recommended_edits: recs.length,
      url_change_outcomes: outcomes.length,
      changelog_entries: changelogRows.length,
    },
    status_funnel: analyzeStatusFunnel(recs),
    source_funnel: analyzeSourceFunnel(recs),
    confidence_funnel: analyzeConfidenceFunnel(recs),
    time_to_live: analyzeTimeToLive(recs),
    cost_vs_ship: analyzeCostVsShip(recs),
    rec_to_outcome_join: analyzeRecToOutcomeJoin(recs, outcomes),
    causal_rec_chain: analyzeCausalRecChain(recs, changelogRows, outcomes),
    learning_score_v0: buildLearningScoreV0(recs, changelogRows, outcomes),
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
