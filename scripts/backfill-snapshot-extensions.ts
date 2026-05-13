/**
 * Backfill: populate Phase 2A read-model columns on historical
 * `daily_metric_snapshots` rows.
 *
 * Phase 2A added three nullable columns to `daily_metric_snapshots`:
 *   - cited_or_mentioned_count          (platform-scope rows)
 *   - position_weighted_citation_count  (owned-brand entity-scope rows)
 *   - mentioned_obs_count               (entity-scope rows)
 *
 * New snapshot rows produced by the poll pipeline populate these
 * automatically. Historical rows produced BEFORE the Phase 2A deploy
 * have these columns NULL. This script walks historical rows, re-reads
 * the source `prompt_answer_observations`, rebuilds the snapshot
 * row's computed values via the same `buildDailySnapshotsFromObservations`
 * helper the poll pipeline uses, and UPDATEs only the three new
 * columns on matching rows.
 *
 * Safety contract (operator-locked):
 *   • Default mode is DRY-RUN. Writes require explicit `--commit`.
 *   • Only the three new columns are touched. Existing fields
 *     (mention_count, citation_count, visibility_score, etc.) are
 *     NEVER overwritten — the legacy formulas keep their values.
 *   • Idempotent: rerunning with the same fixture produces identical
 *     UPDATEs. Same-value writes are harmless.
 *   • No paid APIs. No polls. No scans. No new Supabase data created.
 *   • No deletes. No drops. No schema changes.
 *   • Per-tenant + date range scoping — operator decides which slice
 *     to backfill first; can run incrementally.
 *
 * Usage:
 *   npx tsx scripts/backfill-snapshot-extensions.ts \
 *     [--tenant=<tenant_id>] \
 *     [--since=YYYY-MM-DD] \
 *     [--until=YYYY-MM-DD] \
 *     [--commit]
 *
 * Examples:
 *   # Dry-run for one tenant, last 30 days (default — safe)
 *   npx tsx scripts/backfill-snapshot-extensions.ts \
 *     --tenant=tenant-ritz-founder --since=2026-04-19
 *
 *   # Commit after dry-run review
 *   npx tsx scripts/backfill-snapshot-extensions.ts \
 *     --tenant=tenant-ritz-founder --since=2026-04-19 --commit
 *
 *   # Backfill all tenants for the full default window
 *   npx tsx scripts/backfill-snapshot-extensions.ts
 *
 * Exit codes:
 *   0 — completed (dry-run or commit) with no errors
 *   1 — argument parse / env / Supabase error
 *   2 — backfill ran but encountered per-tuple errors (count printed)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildDailySnapshotsFromObservations } from "@/domains/daily-metric-snapshots/build-from-observations";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Env + Supabase client (same pattern as scripts/backfill-to-supabase.ts)
// ─────────────────────────────────────────────────────────────────────

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      process.env[key] ??= val;
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Ensure .env.local exists with the correct values.",
  );
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────

type Args = {
  tenant: string | null;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  commit: boolean;
};

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  const defaultSince = new Date(Date.now() - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const out: Args = {
    tenant: null,
    since: defaultSince,
    until: today,
    commit: false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === "--commit") {
      out.commit = true;
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      console.warn(`[backfill] ignoring unknown flag: ${raw}`);
      continue;
    }
    const k = raw.slice(0, eq);
    const v = raw.slice(eq + 1);
    if (k === "--tenant") out.tenant = v;
    else if (k === "--since") out.since = v;
    else if (k === "--until") out.until = v;
    else console.warn(`[backfill] ignoring unknown flag: ${k}`);
  }

  // Validate date format
  for (const [label, value] of [
    ["--since", out.since],
    ["--until", out.until],
  ] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      console.error(`Invalid ${label}=${value} — expected YYYY-MM-DD`);
      process.exit(1);
    }
  }
  if (out.since > out.until) {
    console.error(`--since (${out.since}) cannot be after --until (${out.until})`);
    process.exit(1);
  }

  return out;
}

const ARGS = parseArgs(process.argv);

// ─────────────────────────────────────────────────────────────────────
// Tenant + tuple resolution
// ─────────────────────────────────────────────────────────────────────

type SnapshotTuple = {
  tenant_id: string;
  date: string;
  platform: string;
  /** PK ids of existing rows (entity + topic + platform scopes) for this group. */
  existingIds: string[];
};

/**
 * Resolve which (tenant, date, platform) tuples to process. Reads
 * `daily_metric_snapshots` for rows that have at least one Phase 2A
 * column NULL — those are the rows the backfill is for. Rows already
 * populated get skipped automatically (idempotent re-run friendly).
 */
async function resolveTuples(args: Args): Promise<SnapshotTuple[]> {
  // Paged read — PostgREST caps single queries at 1000 rows by default
  // (the daily_metric_snapshots table is well over that for a 60-day
  // window). Without pagination we'd silently truncate to the first
  // 1000 rows and miss most of the table; the first dry-run + commit
  // pass missed ~5070 entity rows + ~156 platform rows because of this.
  const PAGE = 1000;
  const all: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (;;) {
    let query = sb
      .from("daily_metric_snapshots")
      .select("*")
      .eq("source_type", "derived")
      .gte("date", args.since)
      .lte("date", args.until)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (args.tenant) query = query.eq("tenant_id", args.tenant);

    const { data, error } = await query;
    if (error) {
      console.error(`[backfill] query daily_metric_snapshots failed: ${error.message}`);
      process.exit(1);
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  // Shape the rest of the function expects.
  const data = all;

  // Phase 2A column presence detection — first row tells us whether
  // the migration has run. Helpful diagnostic for the operator.
  const sampleRow = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (sampleRow) {
    const hasPhase2aColumns = "cited_or_mentioned_count" in sampleRow;
    if (!hasPhase2aColumns) {
      console.log(
        `[backfill] note: Phase 2A columns absent from daily_metric_snapshots. ` +
          `Apply migration 2026-05-19_phase2a_today_visibility_readmodel_extensions.sql ` +
          `BEFORE running with --commit. Dry-run will still compute the would-be values.`,
      );
    }
  }

  // Group existing rows by (tenant_id, date, platform). Only include
  // a tuple if AT LEAST ONE row in the group is missing the Phase 2A
  // fields (idempotency: fully populated groups skip).
  type RowProbe = {
    id: string;
    tenant_id: string;
    date: string;
    platform: string;
    scope_type: string;
    // Phase 2A columns are read via index access so the script doesn't
    // crash if the columns aren't yet in the schema.
    [key: string]: unknown;
  };

  const tuples = new Map<string, SnapshotTuple>();
  for (const row of (data ?? []) as RowProbe[]) {
    // Treat missing column (undefined) the same as null for "needs
    // backfill" detection. If the migration has not yet been applied,
    // every row falls into the "needs backfill" bucket — exactly what
    // we want for the first post-migration pass.
    const citedOrMentioned = row.cited_or_mentioned_count as
      | number
      | null
      | undefined;
    const positionWeighted = row.position_weighted_citation_count as
      | number
      | null
      | undefined;
    const mentionedObs = row.mentioned_obs_count as
      | number
      | null
      | undefined;
    const needsBackfill =
      (row.scope_type === "platform" &&
        (citedOrMentioned === null || citedOrMentioned === undefined)) ||
      (row.scope_type === "entity" &&
        ((mentionedObs === null || mentionedObs === undefined) ||
          (positionWeighted === null || positionWeighted === undefined)));

    const key = `${row.tenant_id}|${row.date}|${row.platform}`;
    if (needsBackfill) {
      let existing = tuples.get(key);
      if (!existing) {
        existing = {
          tenant_id: row.tenant_id,
          date: row.date,
          platform: row.platform,
          existingIds: [],
        };
        tuples.set(key, existing);
      }
      existing.existingIds.push(row.id);
    }
  }
  return Array.from(tuples.values()).sort((a, b) => {
    if (a.tenant_id !== b.tenant_id) return a.tenant_id.localeCompare(b.tenant_id);
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.platform.localeCompare(b.platform);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Per-tuple rebuild + update
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a snapshot row's platform label to the matching observation-level
 * platform label(s). The two layers don't agree on casing:
 *
 *   Snapshot (`daily_metric_snapshots.platform`):  TitleCase
 *     "Perplexity" / "ChatGPT" / "Google AI Overviews"
 *
 *   Observation (`prompt_answer_observations.platform`): lowercase for
 *     native polls (post-mapping fix), TitleCase for older / Profound-
 *     imported rows. Both can coexist in the same tenant.
 *
 * To find ALL obs for a given snapshot platform-day, query the union
 * of both casings. Without this, the original first backfill pass
 * silently returned zero obs for Perplexity / ChatGPT (the obs are
 * stored lowercase) and zeroed mentioned_obs_count + position_weighted_
 * citation_count on every row. The same casing footgun zeroed 37 entity
 * rows on 2026-04-23 (run-poll.ts:215 comment).
 */
function obsPlatformLabels(snapshotPlatform: string): string[] {
  const lower = snapshotPlatform.toLowerCase();
  if (lower === "chatgpt") return ["chatgpt", "ChatGPT"];
  if (lower === "perplexity") return ["perplexity", "Perplexity"];
  // Default: both as-is and lowercase — Google AI Overviews etc.
  return Array.from(new Set([snapshotPlatform, lower]));
}

async function fetchObsForTuple(tuple: SnapshotTuple): Promise<PromptAnswerObservation[]> {
  // observed_at is a timestamptz column; the snapshot row's `date` is
  // the UTC calendar date the poll covered. Filter on
  // observed_at >= date AND observed_at < date+1.
  const startISO = `${tuple.date}T00:00:00.000Z`;
  const nextDay = new Date(`${tuple.date}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endISO = nextDay.toISOString();

  const labels = obsPlatformLabels(tuple.platform);
  const { data, error } = await sb
    .from("prompt_answer_observations")
    .select("*")
    .eq("tenant_id", tuple.tenant_id)
    .in("platform", labels)
    .gte("observed_at", startISO)
    .lt("observed_at", endISO);
  if (error) {
    throw new Error(`fetch obs (${tuple.tenant_id}, ${tuple.date}, ${tuple.platform}): ${error.message}`);
  }
  return (data ?? []) as PromptAnswerObservation[];
}

async function fetchEntitiesForTenant(tenantId: string): Promise<TrackedEntity[]> {
  // `tracked_entities` uses account_id (slug) for tenant scoping in
  // some installs; we filter on both for safety.
  const { data, error } = await sb
    .from("tracked_entities")
    .select("*")
    .or(`tenant_id.eq.${tenantId},account_id.eq.${tenantId}`);
  if (error) {
    throw new Error(`fetch tracked_entities (${tenantId}): ${error.message}`);
  }
  return (data ?? []) as TrackedEntity[];
}

type BackfillRowUpdate = {
  id: string;
  cited_or_mentioned_count: number | null;
  position_weighted_citation_count: number | null;
  mentioned_obs_count: number | null;
};

async function processTuple(
  tuple: SnapshotTuple,
  trackedEntitiesByTenant: Map<string, TrackedEntity[]>,
): Promise<{ updates: BackfillRowUpdate[]; missingExisting: number; missingBuilt: number }> {
  const observations = await fetchObsForTuple(tuple);
  let trackedEntities = trackedEntitiesByTenant.get(tuple.tenant_id);
  if (!trackedEntities) {
    trackedEntities = await fetchEntitiesForTenant(tuple.tenant_id);
    trackedEntitiesByTenant.set(tuple.tenant_id, trackedEntities);
  }

  // Build using the same helper the poll pipeline uses. Need an
  // observation_run_id — backfill emits a deterministic synthetic one
  // so re-runs don't generate different metadata.
  const builtRows = buildDailySnapshotsFromObservations({
    tenantId: tuple.tenant_id,
    platform: tuple.platform,
    observations,
    trackedEntities,
    date: tuple.date,
    observationRunId: `backfill-${tuple.date}-${tuple.platform}`,
  });

  // Match built rows to existing rows by `id` — the builder uses
  // deterministic IDs (`derived-{date}-{scope-id}-{platform}` etc.)
  // so this is a direct lookup. Rows missing on either side are
  // logged.
  const existingIds = new Set(tuple.existingIds);
  const builtById = new Map<string, DailyMetricSnapshot>();
  for (const r of builtRows) builtById.set(r.id, r);

  const updates: BackfillRowUpdate[] = [];
  let missingBuilt = 0;
  for (const id of existingIds) {
    const built = builtById.get(id);
    if (!built) {
      missingBuilt += 1;
      continue;
    }
    updates.push({
      id,
      cited_or_mentioned_count: built.cited_or_mentioned_count ?? null,
      position_weighted_citation_count:
        built.position_weighted_citation_count ?? null,
      mentioned_obs_count: built.mentioned_obs_count ?? null,
    });
  }

  let missingExisting = 0;
  for (const id of builtById.keys()) {
    if (!existingIds.has(id)) missingExisting += 1;
  }

  return { updates, missingExisting, missingBuilt };
}

async function applyUpdates(updates: BackfillRowUpdate[]): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = [];
  let written = 0;
  // Update one row at a time. Volume is bounded (entities × platforms ×
  // dates) and Supabase's PostgREST UPDATE-by-PK is cheap. Batching via
  // RPC would marginally help but adds complexity; keep it explicit.
  for (const u of updates) {
    const { error } = await sb
      .from("daily_metric_snapshots")
      .update({
        cited_or_mentioned_count: u.cited_or_mentioned_count,
        position_weighted_citation_count: u.position_weighted_citation_count,
        mentioned_obs_count: u.mentioned_obs_count,
      })
      .eq("id", u.id);
    if (error) {
      errors.push(`${u.id}: ${error.message}`);
    } else {
      written += 1;
    }
  }
  return { written, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = ARGS.commit ? "COMMIT" : "DRY-RUN";
  console.log(`[backfill] mode=${mode}`);
  console.log(`[backfill] tenant=${ARGS.tenant ?? "(all)"}`);
  console.log(`[backfill] since=${ARGS.since}  until=${ARGS.until}`);

  const tuples = await resolveTuples(ARGS);
  console.log(
    `[backfill] resolved ${tuples.length} (tenant, date, platform) tuples needing backfill`,
  );
  if (tuples.length === 0) {
    console.log(`[backfill] nothing to do — exiting`);
    return;
  }

  const trackedEntitiesByTenant = new Map<string, TrackedEntity[]>();
  const allUpdates: BackfillRowUpdate[] = [];
  const tupleErrors: string[] = [];
  let processedTuples = 0;
  let totalMissingBuilt = 0;
  let totalMissingExisting = 0;

  for (const tuple of tuples) {
    try {
      const result = await processTuple(tuple, trackedEntitiesByTenant);
      allUpdates.push(...result.updates);
      totalMissingBuilt += result.missingBuilt;
      totalMissingExisting += result.missingExisting;
      processedTuples += 1;
      if (processedTuples % 25 === 0) {
        console.log(
          `[backfill] processed ${processedTuples}/${tuples.length} tuples · queued ${allUpdates.length} updates`,
        );
      }
    } catch (err) {
      tupleErrors.push(
        `${tuple.tenant_id}|${tuple.date}|${tuple.platform}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`[backfill] processed ${processedTuples}/${tuples.length} tuples`);
  console.log(`[backfill] queued ${allUpdates.length} row updates`);
  if (totalMissingBuilt > 0) {
    console.log(
      `[backfill] note: ${totalMissingBuilt} existing snapshot row(s) had no corresponding ` +
        `built row (entity may have been deactivated after the original poll)`,
    );
  }
  if (totalMissingExisting > 0) {
    console.log(
      `[backfill] note: ${totalMissingExisting} built row(s) had no existing match ` +
        `(entity added after the original poll — not a backfill concern)`,
    );
  }
  if (tupleErrors.length > 0) {
    console.error(`[backfill] ${tupleErrors.length} tuple(s) errored:`);
    for (const e of tupleErrors.slice(0, 10)) console.error(`  - ${e}`);
    if (tupleErrors.length > 10) console.error(`  ... and ${tupleErrors.length - 10} more`);
  }

  if (allUpdates.length === 0) {
    console.log(`[backfill] no updates to apply — exiting`);
    process.exit(tupleErrors.length > 0 ? 2 : 0);
  }

  // Sample preview — top 10 updates printed regardless of mode for review.
  console.log(`[backfill] preview (first 10 updates):`);
  for (const u of allUpdates.slice(0, 10)) {
    console.log(
      `  ${u.id}: cited_or_mentioned=${u.cited_or_mentioned_count} · pos_weighted=${u.position_weighted_citation_count} · mentioned_obs=${u.mentioned_obs_count}`,
    );
  }

  if (!ARGS.commit) {
    console.log(
      `[backfill] DRY-RUN complete. Would update ${allUpdates.length} row(s). ` +
        `Pass --commit to apply.`,
    );
    process.exit(tupleErrors.length > 0 ? 2 : 0);
  }

  console.log(`[backfill] applying ${allUpdates.length} updates to Supabase ...`);
  const { written, errors: writeErrors } = await applyUpdates(allUpdates);
  console.log(`[backfill] wrote ${written}/${allUpdates.length} rows`);
  if (writeErrors.length > 0) {
    console.error(`[backfill] ${writeErrors.length} write error(s):`);
    for (const e of writeErrors.slice(0, 10)) console.error(`  - ${e}`);
  }

  // Freshness/cache hardening (2026-05-13) — after a successful commit,
  // invalidate the Today read-model cache tag for each tenant whose
  // snapshots were just rewritten. Mirrors the post-syncSnaps hook in
  // run-poll.ts. CLI script context: `revalidateTag` writes a cache
  // invalidation marker via Next's cache infrastructure; if the
  // import / call fails (e.g. running outside a Next runtime), we
  // log + continue — the read-model loader's 300s TTL is the safety
  // net.
  if (written > 0) {
    const tenantsWritten = new Set(
      allUpdates
        .filter((_, i) => i < written)
        .map((_) => ARGS.tenant)
        .filter((t): t is string => !!t),
    );
    for (const t of tenantsWritten) {
      try {
        const { revalidateTag } = await import("next/cache");
        const { buildTodayReadModelCacheTag } = await import(
          "@/domains/today/visibility-read-model"
        );
        revalidateTag(buildTodayReadModelCacheTag(t), "default");
        console.log(`[backfill] revalidated today-readmodel cache for ${t}`);
      } catch (invalErr) {
        console.error(
          `[backfill] revalidateTag failed for ${t} (non-fatal, cache TTL is safety net):`,
          invalErr,
        );
      }
    }
  }

  process.exit(writeErrors.length > 0 || tupleErrors.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(`[backfill] fatal: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
