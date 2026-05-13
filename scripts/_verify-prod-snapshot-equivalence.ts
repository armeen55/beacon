/**
 * Production-data equivalence check (one-shot, read-only).
 *
 * For each (date, platform) in a window, compute the four visibility
 * pieces from raw observations directly AND from the newly-backfilled
 * snapshot columns, then report drift. This is the real-data
 * counterpart to the fixture harness at
 * `src/domains/today/visibility-read-model-equivalence.test.ts`.
 *
 * Pieces compared:
 *   1. brand chart mention_rate per (date, platform)
 *      obs:  count(tracked_brand_mentioned || mentions ⊇ slug)  / total_obs × 100
 *      snap: mentioned_obs_count                                / total_possible × 100
 *
 *   2. brand chart citation_rate per (date, platform)
 *      obs:  count(tracked_brand_cited)                         / total_obs × 100
 *      snap: citation_count                                     / total_possible × 100
 *
 *   3. per-platform brand union rate
 *      obs:  count(tracked_brand_cited || tracked_brand_mentioned) / total_obs × 100
 *      snap: cited_or_mentioned_count                             / total_possible × 100
 *
 *   4. leaderboard brand citation_rate (position-weighted)
 *      obs:  sum(citationPositionWeight(obs.position) where cited) / total × 100
 *      snap: position_weighted_citation_count                      / total_possible × 100
 *
 * No writes. No paid APIs. No polls/scans. Pure verification.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq)] ??= t.slice(eq + 1);
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const TENANT = "tenant-ritz-founder";
const BRAND_NAME = "Ritz Builders";
const BRAND_SCOPE_ID = "ritzbuilders";
const SINCE = "2026-03-13";
const UNTIL = "2026-05-13";

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
const BRAND_SLUG = slugify(BRAND_NAME);

function positionWeight(position: number | null | undefined): number {
  if (position == null) return 0.5;
  if (position <= 3) return 1.0;
  if (position <= 6) return 0.5;
  return 0.25;
}

function obsPlatformLabels(snapshotPlatform: string): string[] {
  const lower = snapshotPlatform.toLowerCase();
  if (lower === "chatgpt") return ["chatgpt", "ChatGPT"];
  if (lower === "perplexity") return ["perplexity", "Perplexity"];
  return Array.from(new Set([snapshotPlatform, lower]));
}

async function pagedFrom<T>(
  table: string,
  build: (q: ReturnType<typeof sb.from>) => unknown,
): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const out: T[] = [];
  for (;;) {
    const q = (build(sb.from(table)) as ReturnType<typeof sb.from.prototype.select>)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

type Obs = {
  platform: string;
  tracked_brand_mentioned: boolean | null;
  tracked_brand_cited: boolean | null;
  mentions: string[];
  position: number | null;
  observed_at: string;
};

type Snap = {
  date: string;
  scope_type: string;
  scope_id: string;
  platform: string;
  mention_count: number;
  mentioned_obs_count: number | null;
  citation_count: number;
  cited_or_mentioned_count: number | null;
  position_weighted_citation_count: number | string | null;
  total_possible: number | null;
};

async function fetchObsForDate(
  date: string,
  platforms: string[],
): Promise<Obs[]> {
  const start = `${date}T00:00:00.000Z`;
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString();
  return pagedFrom<Obs>("prompt_answer_observations", (q) =>
    q
      .select("platform, tracked_brand_mentioned, tracked_brand_cited, mentions, position, observed_at")
      .eq("tenant_id", TENANT)
      .in("platform", platforms)
      .gte("observed_at", start)
      .lt("observed_at", end),
  );
}

async function fetchSnapsForDate(date: string): Promise<Snap[]> {
  return pagedFrom<Snap>("daily_metric_snapshots", (q) =>
    q
      .select(
        "date, scope_type, scope_id, platform, mention_count, mentioned_obs_count, citation_count, cited_or_mentioned_count, position_weighted_citation_count, total_possible",
      )
      .eq("tenant_id", TENANT)
      .eq("source_type", "derived")
      .eq("date", date),
  );
}

// Per-(date, platform) drift measurements.
type Verdict = {
  date: string;
  platform: string;
  total: number;
  obs_mention_rate: number;
  snap_mention_rate: number;
  drift_mention: number;
  obs_citation_rate: number;
  snap_citation_rate: number;
  drift_citation: number;
  obs_union_rate: number;
  snap_union_rate: number;
  drift_union: number;
  obs_pos_weighted_rate: number;
  snap_pos_weighted_rate: number;
  drift_pos_weighted: number;
};

async function main() {
  // Walk every date in the window that has snapshot rows. Paged read
  // because raw SELECT hits PostgREST's 1000-row default cap and we
  // have ~7800 rows in the 60d window — limiting to 1000 returns only
  // the earliest ~7 dates.
  const dateRows = await pagedFrom<{ date: string }>(
    "daily_metric_snapshots",
    (q) =>
      q
        .select("date")
        .eq("tenant_id", TENANT)
        .eq("source_type", "derived")
        .gte("date", SINCE)
        .lte("date", UNTIL),
  );
  const uniqueDates = Array.from(new Set(dateRows.map((r) => r.date))).sort();
  console.log(`[equiv-prod] checking ${uniqueDates.length} dates × all platforms over [${SINCE} .. ${UNTIL}]`);

  const verdicts: Verdict[] = [];

  for (const date of uniqueDates) {
    const snaps = await fetchSnapsForDate(date);
    const platforms = Array.from(
      new Set(snaps.filter((s) => s.scope_type === "platform").map((s) => s.platform)),
    );
    if (platforms.length === 0) continue;
    const allLabels = platforms.flatMap(obsPlatformLabels);
    const obs = await fetchObsForDate(date, allLabels);

    for (const platform of platforms) {
      const platformLabels = new Set(obsPlatformLabels(platform));
      const obsForPlatform = obs.filter((o) => platformLabels.has(o.platform));
      const total = obsForPlatform.length;
      if (total === 0) continue;

      // ── Obs-derived numbers ─────────────────────────────────────
      let obsMentioned = 0;
      let obsCited = 0;
      let obsUnion = 0;
      let obsPosWeightedSum = 0;
      for (const o of obsForPlatform) {
        const cited = o.tracked_brand_cited === true;
        // Chart's mentionsBrand: flag OR alias slug-match.
        let mentioned = o.tracked_brand_mentioned === true;
        if (!mentioned && Array.isArray(o.mentions)) {
          for (const m of o.mentions) {
            if (slugify(m) === BRAND_SLUG) {
              mentioned = true;
              break;
            }
          }
        }
        if (mentioned) obsMentioned++;
        if (cited) {
          obsCited++;
          obsPosWeightedSum += positionWeight(o.position);
        }
        if (mentioned || cited) obsUnion++;
      }
      const obs_mention_rate = (obsMentioned / total) * 100;
      const obs_citation_rate = (obsCited / total) * 100;
      const obs_union_rate = (obsUnion / total) * 100;
      const obs_pos_weighted_rate = (obsPosWeightedSum / total) * 100;

      // ── Snapshot-derived numbers ────────────────────────────────
      const platformSnap = snaps.find(
        (s) => s.scope_type === "platform" && s.platform === platform,
      );
      const brandSnap = snaps.find(
        (s) =>
          s.scope_type === "entity" &&
          s.scope_id === BRAND_SCOPE_ID &&
          s.platform === platform,
      );
      const snapTotal = platformSnap?.total_possible ?? 0;
      const snap_union_rate =
        snapTotal > 0
          ? ((platformSnap?.cited_or_mentioned_count ?? 0) / snapTotal) * 100
          : 0;
      const snap_citation_rate =
        snapTotal > 0
          ? ((platformSnap?.citation_count ?? 0) / snapTotal) * 100
          : 0;
      const snapBrandTotal = brandSnap?.total_possible ?? snapTotal;
      const snap_mention_rate =
        snapBrandTotal > 0
          ? ((brandSnap?.mentioned_obs_count ?? 0) / snapBrandTotal) * 100
          : 0;
      const snapPosWeighted = Number(
        brandSnap?.position_weighted_citation_count ?? 0,
      );
      const snap_pos_weighted_rate =
        snapBrandTotal > 0 ? (snapPosWeighted / snapBrandTotal) * 100 : 0;

      verdicts.push({
        date,
        platform,
        total,
        obs_mention_rate,
        snap_mention_rate,
        drift_mention: Math.abs(obs_mention_rate - snap_mention_rate),
        obs_citation_rate,
        snap_citation_rate,
        drift_citation: Math.abs(obs_citation_rate - snap_citation_rate),
        obs_union_rate,
        snap_union_rate,
        drift_union: Math.abs(obs_union_rate - snap_union_rate),
        obs_pos_weighted_rate,
        snap_pos_weighted_rate,
        drift_pos_weighted: Math.abs(obs_pos_weighted_rate - snap_pos_weighted_rate),
      });
    }
  }

  // Aggregate stats.
  const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
  const avgOf = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const TOL = 0.01;

  const drift = {
    mention: verdicts.map((v) => v.drift_mention),
    citation: verdicts.map((v) => v.drift_citation),
    union: verdicts.map((v) => v.drift_union),
    posWeighted: verdicts.map((v) => v.drift_pos_weighted),
  };

  console.log(`\n[equiv-prod] verdicts: ${verdicts.length} (date, platform) tuples`);
  console.log(`[equiv-prod] mention_rate drift:        max=${maxOf(drift.mention).toFixed(3)}pp · avg=${avgOf(drift.mention).toFixed(4)}pp · over_tol=${drift.mention.filter((d) => d > TOL).length}`);
  console.log(`[equiv-prod] citation_rate drift:       max=${maxOf(drift.citation).toFixed(3)}pp · avg=${avgOf(drift.citation).toFixed(4)}pp · over_tol=${drift.citation.filter((d) => d > TOL).length}`);
  console.log(`[equiv-prod] union_rate drift:          max=${maxOf(drift.union).toFixed(3)}pp · avg=${avgOf(drift.union).toFixed(4)}pp · over_tol=${drift.union.filter((d) => d > TOL).length}`);
  console.log(`[equiv-prod] pos_weighted_rate drift:   max=${maxOf(drift.posWeighted).toFixed(3)}pp · avg=${avgOf(drift.posWeighted).toFixed(4)}pp · over_tol=${drift.posWeighted.filter((d) => d > TOL).length}`);

  // Top offenders for each metric, if any.
  for (const [label, key] of [
    ["mention", "drift_mention"],
    ["citation", "drift_citation"],
    ["union", "drift_union"],
    ["pos_weighted", "drift_pos_weighted"],
  ] as const) {
    const offenders = verdicts
      .filter((v) => (v as unknown as Record<string, number>)[key] > TOL)
      .sort((a, b) =>
        ((b as unknown as Record<string, number>)[key] ?? 0) -
        ((a as unknown as Record<string, number>)[key] ?? 0),
      )
      .slice(0, 5);
    if (offenders.length > 0) {
      console.log(`\n[equiv-prod] top ${label} drift cases:`);
      for (const o of offenders) {
        console.log(
          `  ${o.date} ${o.platform}: ${(o as unknown as Record<string, number>)[key].toFixed(3)}pp  (total=${o.total})`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(`fatal: ${e instanceof Error ? e.message : e}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
