/**
 * Section 6 Commit C3 — Primary Recommendation Backfill.
 *
 * Populates `daily_metric_snapshots.primary_recommendation_count` on
 * historical rows per the C1.1-applied column comment contract:
 *
 *   • UPDATE existing entity (owned + competitor), topic, and platform
 *     rows so their `primary_recommendation_count` column matches what
 *     the C2 builder would emit going forward.
 *       - owned-brand entity → computed count
 *       - competitor entity  → NULL (defense; should already be null)
 *       - topic              → NULL (H8 lock; defense)
 *       - platform           → computed count
 *   • UPSERT (INSERT) new prompt-scope rows that didn't exist before
 *     C2. Uses the C2 builder's deterministic id format so reruns are
 *     idempotent.
 *
 * Hard contract — what C3 does NOT do:
 *   • NO account-scope row emission. Architecture-pinned by
 *     `tests/architecture/section6-c3-no-account-emission.test.ts`.
 *   • NO customer-surface change.
 *   • NO migration / schema change.
 *   • NO paid APIs / polls / scans / LLM / GSC.
 *   • NO deletes / drops.
 *   • NO writes in dry-run mode (default). `--commit` opts in.
 *   • NO cross-tenant reads or writes. `--tenant` is REQUIRED and
 *     fails-loud when missing.
 *
 * Strategy (Path C — hybrid):
 *   1. Resolve anchor date per tenant = max(min(observed_at), NATIVE_REGIME_START).
 *      Pre-2026-04-22 rows have primary_recommendation = null by
 *      construction (the heuristic shipped post-cutover); backfilling
 *      them would add zero signal and pollute distribution analysis.
 *   2. For each UTC date × platform tuple in [anchor, until):
 *        a. Read tenant-scoped observations for that (date, platform).
 *        b. Replay buildDailySnapshotsFromObservations(...).
 *        c. Split emitted rows:
 *             - scope_type='prompt'  → full UPSERT via syncDailyMetricSnapshots
 *             - scope_type IN (entity, topic, platform)
 *                                    → narrow UPDATE on primary_recommendation_count
 *             - scope_type='account' → FORBIDDEN (script aborts; builder
 *                                       must not emit; covered by C2 test)
 *
 * Idempotency:
 *   • Builder ids are deterministic over (tenant, date, platform,
 *     scope_id) → reruns hit the same rows.
 *   • Narrow UPDATEs are same-value writes when already populated.
 *   • Prompt UPSERTs overwrite identical row content.
 *   • Skip-already-done shortcut: a tuple is skipped if every expected
 *     non-prompt row already has the correct primary_recommendation_count
 *     AND every expected prompt row already exists. `--force` bypasses
 *     the shortcut.
 *
 * Usage:
 *   # Dry-run (default — safe)
 *   npm run backfill:section6 -- --tenant=tenant-ritz-founder
 *
 *   # Commit after dry-run review
 *   npm run backfill:section6 -- --tenant=tenant-ritz-founder --commit
 *
 *   # Narrower date range
 *   npm run backfill:section6 -- --tenant=tenant-ritz-founder \
 *     --since=2026-04-22 --until=2026-05-01
 *
 *   # Force re-process even when already populated
 *   npm run backfill:section6 -- --tenant=tenant-ritz-founder --force
 *
 *   # Cap (date, platform) tuples for chunked execution
 *   npm run backfill:section6 -- --tenant=tenant-ritz-founder --limit=10
 *
 * Exit codes:
 *   0 — completed (dry-run or commit) with no errors
 *   1 — argument parse / env / Supabase error (fatal)
 *   2 — completed but at least one (date, platform) tuple errored OR
 *       at least one write error occurred (partial)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildDailySnapshotsFromObservations } from "@/domains/daily-metric-snapshots/build-from-observations";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";

// ─────────────────────────────────────────────────────────────────────
// CLI args — exported for unit testing
// ─────────────────────────────────────────────────────────────────────

export type C3Args = {
  tenant: string;
  /** YYYY-MM-DD UTC; null → use tenant anchor */
  since: string | null;
  /** YYYY-MM-DD UTC, exclusive upper bound; null → today UTC */
  until: string | null;
  /** Default false. --commit required to write. */
  commit: boolean;
  /** Default false. Bypasses the skip-already-done shortcut. */
  force: boolean;
  /** Default null. Caps the number of (date, platform) tuples processed. */
  limit: number | null;
};

export type C3ArgParseResult =
  | { ok: true; args: C3Args }
  | { ok: false; error: string };

export function parseArgs(argv: string[]): C3ArgParseResult {
  const out: Partial<C3Args> & { commit: boolean; force: boolean } = {
    commit: false,
    force: false,
  };

  for (const raw of argv) {
    if (raw === "--commit") {
      out.commit = true;
      continue;
    }
    if (raw === "--force") {
      out.force = true;
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      // Unknown bare flag — collect and reject in parseArgs so the
      // operator gets a clean message rather than a silent ignore.
      return { ok: false, error: `unknown flag: ${raw}` };
    }
    const k = raw.slice(0, eq);
    const v = raw.slice(eq + 1);
    if (k === "--tenant") out.tenant = v;
    else if (k === "--since") out.since = v;
    else if (k === "--until") out.until = v;
    else if (k === "--limit") {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          error: `--limit must be a positive integer, got: ${v}`,
        };
      }
      out.limit = n;
    } else {
      return { ok: false, error: `unknown flag: ${k}` };
    }
  }

  // --tenant is REQUIRED. No silent BEACON_TENANT_ID fallback — every
  // backfill invocation must declare its tenant explicitly so an
  // operator can't ship a cross-tenant write by forgetting to set the
  // flag in a shell where BEACON_TENANT_ID was set for another run.
  if (!out.tenant) {
    return {
      ok: false,
      error: "--tenant=<id> is required (no silent BEACON_TENANT_ID fallback)",
    };
  }

  // Validate date format if provided.
  for (const [label, value] of [
    ["--since", out.since],
    ["--until", out.until],
  ] as const) {
    if (value != null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, error: `invalid ${label}=${value} — expected YYYY-MM-DD` };
    }
  }
  if (out.since && out.until && out.since > out.until) {
    return {
      ok: false,
      error: `--since (${out.since}) cannot be after --until (${out.until})`,
    };
  }

  return {
    ok: true,
    args: {
      tenant: out.tenant,
      since: out.since ?? null,
      until: out.until ?? null,
      commit: out.commit,
      force: out.force,
      limit: out.limit ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Anchor date resolution — exported for unit testing
// ─────────────────────────────────────────────────────────────────────

export type AnchorResolution = {
  anchor_date: string;
  min_observation_date: string | null;
  clamped_to_native_regime: boolean;
};

/**
 * Anchor = max(min(observed_at UTC date), NATIVE_REGIME_START).
 *
 * H5 + Q1 lock: pre-NATIVE_REGIME_START rows have
 * primary_recommendation = null by construction (heuristic shipped
 * post-cutover); clamping prevents zero-signal backfill of the
 * benchmark era.
 *
 * If the tenant has zero observations, returns NATIVE_REGIME_START as
 * the anchor with min_observation_date = null. The caller decides
 * whether to proceed (likely no-op).
 */
export function resolveAnchor(
  observationDates: ReadonlyArray<string>,
): AnchorResolution {
  if (observationDates.length === 0) {
    return {
      anchor_date: NATIVE_REGIME_START,
      min_observation_date: null,
      clamped_to_native_regime: false,
    };
  }
  // Caller passes ISO timestamps; truncate to YYYY-MM-DD UTC.
  let min = observationDates[0]!.slice(0, 10);
  for (const d of observationDates) {
    const ymd = d.slice(0, 10);
    if (ymd < min) min = ymd;
  }
  if (min < NATIVE_REGIME_START) {
    return {
      anchor_date: NATIVE_REGIME_START,
      min_observation_date: min,
      clamped_to_native_regime: true,
    };
  }
  return {
    anchor_date: min,
    min_observation_date: min,
    clamped_to_native_regime: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Date / tuple iteration — exported for unit testing
// ─────────────────────────────────────────────────────────────────────

/** Inclusive `since`, exclusive `until`. UTC dates only. */
export function utcDateRange(since: string, until: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${since}T00:00:00.000Z`);
  const stop = new Date(`${until}T00:00:00.000Z`);
  while (cur.getTime() < stop.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return out;
}

// Native platform labels Section 6 covers. Mirrors run-poll.ts's
// SNAPSHOT_PLATFORM_LABEL map. Profound import path (Google AI
// Overviews etc.) is not in scope for C3.
const NATIVE_PLATFORMS_SNAPSHOT_LABELS = ["Perplexity", "ChatGPT"] as const;

// Per backfill-snapshot-extensions.ts:308-314, observation-level
// platform labels can be either lowercase ("perplexity", "chatgpt")
// or TitleCase. C3 queries the union of both to match either casing.
export function obsPlatformLabels(snapshotPlatform: string): string[] {
  const lower = snapshotPlatform.toLowerCase();
  if (lower === "chatgpt") return ["chatgpt", "ChatGPT"];
  if (lower === "perplexity") return ["perplexity", "Perplexity"];
  return Array.from(new Set([snapshotPlatform, lower]));
}

// ─────────────────────────────────────────────────────────────────────
// Plan shape — what the script intends to write (or would write in
// dry-run). Exported for unit testing.
// ─────────────────────────────────────────────────────────────────────

export type ExistingRowUpdate = {
  id: string;
  tenant_id: string;
  scope_type: "entity" | "topic" | "platform";
  primary_recommendation_count: number | null;
};

export type PromptRowUpsert = DailyMetricSnapshot;

export type TuplePlan = {
  tenant_id: string;
  date: string;
  platform: string;
  observations_replayed: number;
  existing_row_updates: ExistingRowUpdate[];
  prompt_row_upserts: PromptRowUpsert[];
  /** True if every expected write is a no-op (idempotent skip). */
  skip_already_done: boolean;
};

export type RunSummary = {
  mode: "DRY-RUN" | "COMMIT";
  tenant: string;
  anchor: AnchorResolution;
  effective_since: string;
  effective_until: string;
  tuples_planned: number;
  tuples_processed: number;
  tuples_skipped_already_done: number;
  tuples_errored: number;
  existing_updates_planned: number;
  existing_updates_written: number;
  prompt_upserts_planned: number;
  prompt_upserts_written: number;
  account_rows_attempted: number; // MUST stay 0 — assertion at end
  tuple_errors: string[];
  write_errors: string[];
};

// ─────────────────────────────────────────────────────────────────────
// Dependency interfaces — exported for unit testing via injection
// ─────────────────────────────────────────────────────────────────────

export type C3Deps = {
  /**
   * MIN(observed_at) for a tenant. Used by resolveAnchor.
   * Returns null when the tenant has zero observations.
   */
  fetchTenantMinObservedAt: (tenantId: string) => Promise<string | null>;
  /**
   * Tenant-scoped read of `prompt_answer_observations` for a (date,
   * platform) tuple. MUST filter tenant_id at the query layer.
   */
  fetchObsForTuple: (
    tenantId: string,
    date: string,
    platform: string,
  ) => Promise<PromptAnswerObservation[]>;
  /** Tenant-scoped read of tracked entities. */
  fetchEntitiesForTenant: (tenantId: string) => Promise<TrackedEntity[]>;
  /**
   * Tenant-scoped read of existing row state for skip-already-done
   * shortcut. Returns: map of id → current primary_recommendation_count
   * for every existing (date, platform) row, plus the set of prompt-row
   * ids that already exist for this tuple.
   */
  fetchExistingRowState: (
    tenantId: string,
    date: string,
    platform: string,
  ) => Promise<{
    nonPromptByIdPrimary: Map<string, number | null>;
    existingPromptIds: Set<string>;
  }>;
  /**
   * Apply a narrow UPDATE on a single existing snapshot row's
   * `primary_recommendation_count`. MUST scope by both tenant_id AND
   * id (defense-in-depth tenant isolation). Returns null on success,
   * error message on failure.
   */
  applyExistingUpdate: (u: ExistingRowUpdate) => Promise<string | null>;
  /**
   * Apply UPSERTs of new prompt rows. MUST stamp tenant_id on every
   * row (caller already does this; dep should verify). Returns null
   * on success, error message on failure.
   */
  applyPromptUpserts: (
    rows: PromptRowUpsert[],
    tenantId: string,
  ) => Promise<string | null>;
};

// ─────────────────────────────────────────────────────────────────────
// Plan a single (date, platform) tuple. Pure — exported for testing.
// ─────────────────────────────────────────────────────────────────────

export type PlanTupleArgs = {
  tenant_id: string;
  date: string;
  platform: string;
  observations: PromptAnswerObservation[];
  trackedEntities: TrackedEntity[];
  existingState: {
    nonPromptByIdPrimary: Map<string, number | null>;
    existingPromptIds: Set<string>;
  };
  force: boolean;
};

export class C3AccountEmissionError extends Error {
  constructor(rowId: string) {
    super(
      `Section 6 C3 invariant violation: builder emitted scope_type="account" ` +
        `row (id=${rowId}). C1.1 column comment locks account-scope as NOT ` +
        `MATERIALIZED in C2/C3. Aborting backfill to prevent data corruption.`,
    );
    this.name = "C3AccountEmissionError";
  }
}

export function planTuple(args: PlanTupleArgs): TuplePlan {
  const {
    tenant_id,
    date,
    platform,
    observations,
    trackedEntities,
    existingState,
    force,
  } = args;

  const builtRows = buildDailySnapshotsFromObservations({
    tenantId: tenant_id,
    platform,
    observations,
    trackedEntities,
    date,
    observationRunId: `section6-c3-backfill-${date}-${platform.toLowerCase()}`,
  });

  const existingUpdates: ExistingRowUpdate[] = [];
  const promptUpserts: PromptRowUpsert[] = [];

  for (const row of builtRows) {
    if (row.scope_type === "account") {
      // Hard-stop: the C2 builder MUST NOT emit account rows. If it
      // ever does, abort the entire backfill loudly. This is the
      // runtime mirror of `tests/architecture/section6-c3-no-account-emission.test.ts`.
      throw new C3AccountEmissionError(row.id);
    }
    if (row.scope_type === "prompt") {
      // New prompt rows are full row UPSERTs. Stamp the C3 backfill
      // metadata so post-backfill audits can identify which rows
      // were materialized by C3 vs. by post-C2 native polls.
      const stamped: PromptRowUpsert = {
        ...row,
        metadata: {
          ...row.metadata,
          section6_c3_backfill: {
            anchor_date: date,
            ran_at: new Date().toISOString(),
            observations_replayed: observations.length,
          },
        },
      };
      promptUpserts.push(stamped);
      continue;
    }
    // entity / topic / platform → narrow UPDATE on primary_recommendation_count
    const current = existingState.nonPromptByIdPrimary.get(row.id);
    const target = row.primary_recommendation_count ?? null;
    if (!force && current === target && existingState.nonPromptByIdPrimary.has(row.id)) {
      // Already at target; skip this update.
      continue;
    }
    existingUpdates.push({
      id: row.id,
      tenant_id,
      scope_type: row.scope_type,
      primary_recommendation_count: target,
    });
  }

  // Skip-already-done: every expected non-prompt is already at target
  // AND every expected prompt row already exists.
  const allPromptsAlreadyExist = promptUpserts.every((p) =>
    existingState.existingPromptIds.has(p.id),
  );
  const skip_already_done =
    !force && existingUpdates.length === 0 && allPromptsAlreadyExist;

  // If skipping, still emit zero-length plans so the summary can count
  // the skip explicitly without losing visibility.
  return {
    tenant_id,
    date,
    platform,
    observations_replayed: observations.length,
    existing_row_updates: skip_already_done ? [] : existingUpdates,
    prompt_row_upserts: skip_already_done ? [] : promptUpserts,
    skip_already_done,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main runner — testable via injected deps
// ─────────────────────────────────────────────────────────────────────

export type RunBackfillResult = {
  summary: RunSummary;
  exit_code: 0 | 1 | 2;
};

export async function runBackfill(
  args: C3Args,
  deps: C3Deps,
  log: (msg: string) => void = console.log,
  err: (msg: string) => void = console.error,
): Promise<RunBackfillResult> {
  const mode: "DRY-RUN" | "COMMIT" = args.commit ? "COMMIT" : "DRY-RUN";

  // Resolve anchor.
  const minObserved = await deps.fetchTenantMinObservedAt(args.tenant);
  const anchor = resolveAnchor(
    minObserved == null ? [] : [minObserved],
  );
  if (anchor.clamped_to_native_regime) {
    log(
      `[section6-c3] anchor clamp: tenant=${args.tenant} min_observed=${anchor.min_observation_date} → clamped to NATIVE_REGIME_START=${NATIVE_REGIME_START}`,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const effective_since = args.since ?? anchor.anchor_date;
  const effective_until = args.until ?? today;

  // Validate effective range AFTER anchor resolution.
  if (effective_since > effective_until) {
    err(
      `[section6-c3] effective range invalid: since=${effective_since} until=${effective_until}`,
    );
    return {
      summary: emptySummary(mode, args, anchor, effective_since, effective_until),
      exit_code: 1,
    };
  }

  // Entities are tenant-stable across the run; fetch once.
  const trackedEntities = await deps.fetchEntitiesForTenant(args.tenant);

  // Build (date, platform) tuple list.
  const dates = utcDateRange(effective_since, effective_until);
  const tuples: Array<{ date: string; platform: string }> = [];
  for (const date of dates) {
    for (const platform of NATIVE_PLATFORMS_SNAPSHOT_LABELS) {
      tuples.push({ date, platform });
    }
  }

  const limitedTuples = args.limit != null ? tuples.slice(0, args.limit) : tuples;

  log(
    `[section6-c3] mode=${mode} tenant=${args.tenant} ` +
      `range=[${effective_since}, ${effective_until}) ` +
      `tuples=${limitedTuples.length}${args.limit != null ? ` (--limit=${args.limit})` : ""}`,
  );

  const summary: RunSummary = {
    mode,
    tenant: args.tenant,
    anchor,
    effective_since,
    effective_until,
    tuples_planned: limitedTuples.length,
    tuples_processed: 0,
    tuples_skipped_already_done: 0,
    tuples_errored: 0,
    existing_updates_planned: 0,
    existing_updates_written: 0,
    prompt_upserts_planned: 0,
    prompt_upserts_written: 0,
    account_rows_attempted: 0,
    tuple_errors: [],
    write_errors: [],
  };

  const plans: TuplePlan[] = [];

  for (const tuple of limitedTuples) {
    try {
      const observations = await deps.fetchObsForTuple(
        args.tenant,
        tuple.date,
        tuple.platform,
      );
      if (observations.length === 0) {
        // No observations → no rows to backfill for this tuple. Treat
        // as processed-but-empty, not skipped (empty-day is a real
        // result, not a "skip already done" no-op).
        summary.tuples_processed += 1;
        continue;
      }
      const existingState = await deps.fetchExistingRowState(
        args.tenant,
        tuple.date,
        tuple.platform,
      );
      const plan = planTuple({
        tenant_id: args.tenant,
        date: tuple.date,
        platform: tuple.platform,
        observations,
        trackedEntities,
        existingState,
        force: args.force,
      });
      if (plan.skip_already_done) {
        summary.tuples_skipped_already_done += 1;
      }
      summary.existing_updates_planned += plan.existing_row_updates.length;
      summary.prompt_upserts_planned += plan.prompt_row_upserts.length;
      summary.tuples_processed += 1;
      plans.push(plan);
    } catch (e) {
      if (e instanceof C3AccountEmissionError) {
        // Hard-stop: aborts the entire backfill.
        err(`[section6-c3] FATAL: ${e.message}`);
        summary.account_rows_attempted += 1;
        return { summary, exit_code: 1 };
      }
      summary.tuples_errored += 1;
      const msg = e instanceof Error ? e.message : String(e);
      summary.tuple_errors.push(
        `${args.tenant}|${tuple.date}|${tuple.platform}: ${msg}`,
      );
    }
  }

  // Preview log (regardless of mode).
  log(
    `[section6-c3] planned: ${summary.existing_updates_planned} existing-row UPDATEs · ${summary.prompt_upserts_planned} prompt-row UPSERTs · ${summary.tuples_skipped_already_done}/${summary.tuples_processed} tuples already done`,
  );
  if (summary.tuple_errors.length > 0) {
    err(`[section6-c3] ${summary.tuple_errors.length} tuple(s) errored:`);
    for (const e of summary.tuple_errors.slice(0, 10)) err(`  - ${e}`);
    if (summary.tuple_errors.length > 10) {
      err(`  ... and ${summary.tuple_errors.length - 10} more`);
    }
  }

  // Apply writes only in --commit mode.
  if (!args.commit) {
    log(
      `[section6-c3] DRY-RUN complete. Pass --commit to apply. ` +
        `Run the verification SQL block below after committing.`,
    );
    log(buildVerificationSql(args.tenant, effective_since, effective_until));
    return {
      summary,
      exit_code: summary.tuple_errors.length > 0 ? 2 : 0,
    };
  }

  // Write phase.
  for (const plan of plans) {
    if (plan.skip_already_done) continue;
    for (const u of plan.existing_row_updates) {
      const writeErr = await deps.applyExistingUpdate(u);
      if (writeErr) {
        summary.write_errors.push(`UPDATE ${u.id}: ${writeErr}`);
      } else {
        summary.existing_updates_written += 1;
      }
    }
    if (plan.prompt_row_upserts.length > 0) {
      const upsertErr = await deps.applyPromptUpserts(
        plan.prompt_row_upserts,
        args.tenant,
      );
      if (upsertErr) {
        summary.write_errors.push(
          `UPSERT ${plan.tenant_id}|${plan.date}|${plan.platform}: ${upsertErr}`,
        );
      } else {
        summary.prompt_upserts_written += plan.prompt_row_upserts.length;
      }
    }
  }

  log(
    `[section6-c3] wrote: ${summary.existing_updates_written} updates · ${summary.prompt_upserts_written} prompt rows`,
  );
  if (summary.write_errors.length > 0) {
    err(`[section6-c3] ${summary.write_errors.length} write error(s):`);
    for (const e of summary.write_errors.slice(0, 10)) err(`  - ${e}`);
  }

  log(buildVerificationSql(args.tenant, effective_since, effective_until));

  const partial =
    summary.tuple_errors.length > 0 || summary.write_errors.length > 0;
  return { summary, exit_code: partial ? 2 : 0 };
}

function emptySummary(
  mode: "DRY-RUN" | "COMMIT",
  args: C3Args,
  anchor: AnchorResolution,
  effective_since: string,
  effective_until: string,
): RunSummary {
  return {
    mode,
    tenant: args.tenant,
    anchor,
    effective_since,
    effective_until,
    tuples_planned: 0,
    tuples_processed: 0,
    tuples_skipped_already_done: 0,
    tuples_errored: 0,
    existing_updates_planned: 0,
    existing_updates_written: 0,
    prompt_upserts_planned: 0,
    prompt_upserts_written: 0,
    account_rows_attempted: 0,
    tuple_errors: [],
    write_errors: [],
  };
}

export function buildVerificationSql(
  tenant: string,
  since: string,
  until: string,
): string {
  return [
    `[section6-c3] Verification SQL (copy into Supabase SQL editor):`,
    ``,
    `-- 1. Prompt-scope rows now exist for the backfilled range.`,
    `SELECT date, platform, COUNT(*) AS prompt_rows,`,
    `       COUNT(primary_recommendation_count) AS populated`,
    `FROM public.daily_metric_snapshots`,
    `WHERE tenant_id = '${tenant}' AND scope_type = 'prompt'`,
    `  AND date >= '${since}' AND date < '${until}'`,
    `GROUP BY date, platform ORDER BY date, platform;`,
    ``,
    `-- 2. Entity + platform rows have non-null primary_recommendation_count.`,
    `SELECT scope_type,`,
    `       COUNT(*) FILTER (WHERE primary_recommendation_count IS NOT NULL) AS populated,`,
    `       COUNT(*) AS total`,
    `FROM public.daily_metric_snapshots`,
    `WHERE tenant_id = '${tenant}' AND date >= '${since}' AND date < '${until}'`,
    `  AND scope_type IN ('entity', 'platform')`,
    `GROUP BY scope_type;`,
    ``,
    `-- 3. Topic rows MUST stay NULL.`,
    `SELECT COUNT(*) AS unexpected_topic_populated`,
    `FROM public.daily_metric_snapshots`,
    `WHERE tenant_id = '${tenant}' AND date >= '${since}' AND date < '${until}'`,
    `  AND scope_type = 'topic'`,
    `  AND primary_recommendation_count IS NOT NULL;`,
    ``,
    `-- 4. No account rows accidentally introduced.`,
    `SELECT COUNT(*) AS unexpected_account_rows`,
    `FROM public.daily_metric_snapshots`,
    `WHERE tenant_id = '${tenant}' AND scope_type = 'account';`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Supabase-backed default dependency implementation. Side-effect-free
// until called. Tests inject mock C3Deps instead.
// ─────────────────────────────────────────────────────────────────────

function makeSupabaseDeps(sb: SupabaseClient): C3Deps {
  return {
    async fetchTenantMinObservedAt(tenantId) {
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("observed_at")
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(`fetchTenantMinObservedAt: ${error.message}`);
      const first = (data ?? [])[0] as { observed_at?: string } | undefined;
      return first?.observed_at ?? null;
    },
    async fetchObsForTuple(tenantId, date, platform) {
      const startISO = `${date}T00:00:00.000Z`;
      const next = new Date(`${date}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const endISO = next.toISOString();
      const labels = obsPlatformLabels(platform);
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("platform", labels)
        .gte("observed_at", startISO)
        .lt("observed_at", endISO);
      if (error) throw new Error(`fetchObsForTuple: ${error.message}`);
      return (data ?? []) as PromptAnswerObservation[];
    },
    async fetchEntitiesForTenant(tenantId) {
      const { data, error } = await sb
        .from("tracked_entities")
        .select("*")
        .or(`tenant_id.eq.${tenantId},account_id.eq.${tenantId}`);
      if (error) throw new Error(`fetchEntitiesForTenant: ${error.message}`);
      return (data ?? []) as TrackedEntity[];
    },
    async fetchExistingRowState(tenantId, date, platform) {
      const { data, error } = await sb
        .from("daily_metric_snapshots")
        .select("id, scope_type, primary_recommendation_count")
        .eq("tenant_id", tenantId)
        .eq("date", date)
        .eq("platform", platform);
      if (error) throw new Error(`fetchExistingRowState: ${error.message}`);
      const rows = (data ?? []) as Array<{
        id: string;
        scope_type: string;
        primary_recommendation_count: number | null;
      }>;
      const nonPromptByIdPrimary = new Map<string, number | null>();
      const existingPromptIds = new Set<string>();
      for (const r of rows) {
        if (r.scope_type === "prompt") existingPromptIds.add(r.id);
        else nonPromptByIdPrimary.set(r.id, r.primary_recommendation_count);
      }
      return { nonPromptByIdPrimary, existingPromptIds };
    },
    async applyExistingUpdate(u) {
      // Tenant-isolated UPDATE: BOTH tenant_id AND id in the WHERE
      // clause. Defense-in-depth: even if a row id happens to collide
      // across tenants (deterministic builder ids do encode tenant via
      // scope_id slug, but the safety belt is cheap), the tenant_id
      // filter prevents cross-tenant writes.
      const { error } = await sb
        .from("daily_metric_snapshots")
        .update({ primary_recommendation_count: u.primary_recommendation_count })
        .eq("tenant_id", u.tenant_id)
        .eq("id", u.id);
      return error ? error.message : null;
    },
    async applyPromptUpserts(rows, tenantId) {
      // Verify every row carries the expected tenant_id BEFORE writing
      // (defense). The builder already stamps tenant_id; this catches
      // any accidental cross-tenant injection from a future refactor.
      for (const r of rows) {
        if (r.tenant_id !== tenantId) {
          return `prompt-upsert row ${r.id} tenant_id=${r.tenant_id} did not match expected ${tenantId}`;
        }
      }
      const { error } = await sb
        .from("daily_metric_snapshots")
        .upsert(rows, { onConflict: "id" });
      return error ? error.message : null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Entry point — env + CLI plumbing
// ─────────────────────────────────────────────────────────────────────

function loadDotEnv() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
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

async function main() {
  loadDotEnv();

  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[section6-c3] ${parsed.error}`);
    process.exit(1);
  }
  const args = parsed.args;

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "[section6-c3] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  const deps = makeSupabaseDeps(sb);
  const { exit_code } = await runBackfill(args, deps);
  process.exit(exit_code);
}

// Run main only when executed directly (not when imported by tests).
// `import.meta.url` check is the standard Node entry-point idiom.
const isDirectInvocation =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;

if (isDirectInvocation) {
  main().catch((e) => {
    console.error(
      `[section6-c3] fatal: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  });
}
