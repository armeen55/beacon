/**
 * list-active-tenants — Gap A (2026-05-07).
 *
 * Emits a JSON array of active tenants in the EXACT shape the cron's
 * compute-matrix step expects:
 *
 *   [{ tenantId, slug, siteDomain, enabled: true }, ...]
 *
 * Source-of-truth precedence (DB-preferred, JSON-fallback):
 *
 *   1. If NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
 *      query the Supabase `tenants` table for rows with status='active'.
 *      This is the path the production cron will use once env vars are
 *      configured in GitHub Actions secrets.
 *
 *   2. Else (or on DB error), read `ops/active-tenants.json` and return
 *      its enabled rows. Logs a structured WARN line so the operator
 *      can see fallback fired in workflow logs.
 *
 * Why both: this is the architectural unblock for self-serve onboarding
 * (Phase 1, Gap A in the customer-onboarding plan). Until customers can
 * sign up via UI and have the cron pick them up automatically without
 * a git commit, scaling past customer #2 means manual ops work per
 * sign-up. The DB-preferred path closes that gap; the JSON fallback
 * preserves today's behavior in CI environments where Supabase env
 * isn't yet wired (transitional safety).
 *
 * Hard contracts:
 *   - Returns ONLY the 4 fields the matrix needs (tenantId/slug/
 *     siteDomain/enabled) plus OPTIONAL per-tenant ops overrides
 *     (today: `scanMaxPages`, the crawl ceiling consumed by the
 *     daily-scan matrix — sourced from ops/active-tenants.json even
 *     when the tenant list itself comes from Supabase, so operational
 *     tuning never requires a DB migration). Extra DB columns
 *     (business_name, daily_budget_usd, etc.) are omitted — the
 *     workflow doesn't read them and exposing them in matrix output
 *     is unnecessary surface.
 *   - Refuses to return rows with empty/null tenantId, slug, or
 *     siteDomain (would break the matrix's downstream curl/CLI calls).
 *   - Fail-loud: exits non-zero with a structured `::error` line if
 *     ZERO active tenants are found, regardless of source. Stops the
 *     workflow before it can silently skip everyone.
 *   - Pure read. No paid APIs. No mutations. No second-tenant injection.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/list-active-tenants.ts
 *
 * Output (stdout): a single line of compact JSON.
 * Output (stderr): structured log lines (info/warn/error) for the workflow.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Optional .env.local for local dev. CI sets env via secrets directly.
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

const REPO_ROOT = resolve(__dirname, "..");
const FALLBACK_PATH = join(REPO_ROOT, "ops/active-tenants.json");

/** The exact matrix entry shape the cron's compute-matrix step expects. */
export type MatrixTenant = {
  tenantId: string;
  slug: string;
  siteDomain: string;
  enabled: true;
  /**
   * Optional per-tenant crawl ceiling for the daily scan (pages per run).
   * Operational override carried from ops/active-tenants.json — NOT a DB
   * column. Omitted unless the ops file sets a positive number.
   */
  scanMaxPages?: number;
};

/** Coerce an ops-file value into a usable crawl ceiling, or undefined. */
export function parseScanMaxPages(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : undefined;
}

/**
 * Read per-tenant operational overrides (today: scanMaxPages) from the
 * ops file, keyed by tenantId. Tolerant: returns {} when the file is
 * missing/invalid — overrides are tuning, never a reason to fail the
 * matrix when the tenant list itself came from Supabase.
 */
export function readOpsOverrides(raw: unknown): Map<string, { scanMaxPages?: number }> {
  const out = new Map<string, { scanMaxPages?: number }>();
  if (!Array.isArray(raw)) return out;
  for (const row of raw as Array<Record<string, unknown>>) {
    if (typeof row.tenantId !== "string" || row.tenantId.length === 0) continue;
    const scanMaxPages = parseScanMaxPages(row.scanMaxPages);
    if (scanMaxPages !== undefined) out.set(row.tenantId, { scanMaxPages });
  }
  return out;
}

/** Validates a candidate row against the matrix-entry contract. */
export function isValidEntry(t: unknown): t is MatrixTenant {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.tenantId === "string" &&
    o.tenantId.length > 0 &&
    typeof o.slug === "string" &&
    o.slug.length > 0 &&
    typeof o.siteDomain === "string" &&
    o.siteDomain.length > 0
  );
}

function logInfo(msg: string): void {
  process.stderr.write(`[list-active-tenants] INFO  ${msg}\n`);
}

function logWarn(msg: string): void {
  process.stderr.write(`[list-active-tenants] WARN  ${msg}\n`);
}

function logError(msg: string): void {
  process.stderr.write(`[list-active-tenants] ERROR ${msg}\n`);
  process.stderr.write(`::error::list-active-tenants: ${msg}\n`);
}

/**
 * Source 1 — Supabase tenants table query.
 *
 * Returns null on any failure (env missing, network error, query
 * failed) so the caller can fall back to the JSON file. Logs WARN.
 */
async function readFromSupabase(): Promise<MatrixTenant[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    logWarn("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY); skipping DB lookup");
    return null;
  }
  try {
    // Lazy-import so missing dependency doesn't crash the JSON-fallback path.
    const { createClient } = await import("@supabase/supabase-js");
    const supa = createClient(url, key);
    const { data, error } = await supa
      .from("tenants")
      .select("id, slug, domain, status")
      .eq("status", "active");
    if (error) {
      logWarn(`Supabase query failed: ${error.message}`);
      return null;
    }
    if (!Array.isArray(data)) {
      logWarn("Supabase returned non-array result");
      return null;
    }
    // Map DB columns → matrix-entry shape.
    const mapped: MatrixTenant[] = [];
    for (const row of data as Array<{
      id?: string | null;
      slug?: string | null;
      domain?: string | null;
      status?: string | null;
    }>) {
      const candidate = {
        tenantId: row.id ?? "",
        slug: row.slug ?? "",
        siteDomain: row.domain ?? "",
        enabled: true as const,
      };
      if (isValidEntry(candidate)) {
        mapped.push(candidate);
      } else {
        logWarn(
          `Supabase row dropped — missing required fields: id=${row.id ?? "(null)"} slug=${row.slug ?? "(null)"} domain=${row.domain ?? "(null)"}`,
        );
      }
    }
    logInfo(`Supabase lookup: ${mapped.length} valid active tenant(s) returned`);
    return mapped;
  } catch (err) {
    logWarn(`Supabase lookup crashed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Source 2 — `ops/active-tenants.json` fallback.
 *
 * Same shape the workflow used pre-Gap-A. Filters to enabled === true.
 * Throws on missing/invalid file (the operator-friendly path is to
 * keep this file alive even after DB takes over, so its absence is
 * a real problem worth surfacing).
 *
 * Pure: takes the raw JSON content + a logger so unit tests can drive
 * it without filesystem I/O.
 */
export function parseJsonFallback(
  raw: unknown,
  log: (msg: string) => void = logWarn,
): MatrixTenant[] {
  if (!Array.isArray(raw)) {
    throw new Error(`active-tenants source must be a JSON array; got ${typeof raw}`);
  }
  const enabled: MatrixTenant[] = [];
  for (const row of raw as Array<Record<string, unknown>>) {
    if (row.enabled !== true) continue;
    const scanMaxPages = parseScanMaxPages(row.scanMaxPages);
    const candidate = {
      tenantId: typeof row.tenantId === "string" ? row.tenantId : "",
      slug: typeof row.slug === "string" ? row.slug : "",
      siteDomain: typeof row.siteDomain === "string" ? row.siteDomain : "",
      enabled: true as const,
      ...(scanMaxPages !== undefined ? { scanMaxPages } : {}),
    };
    if (isValidEntry(candidate)) {
      enabled.push(candidate);
    } else {
      log(
        `row dropped — missing required fields: tenantId=${row.tenantId ?? "(null)"} slug=${row.slug ?? "(null)"} siteDomain=${row.siteDomain ?? "(null)"}`,
      );
    }
  }
  return enabled;
}

function readFromJson(): MatrixTenant[] {
  if (!existsSync(FALLBACK_PATH)) {
    throw new Error(
      `Fallback file not found at ${FALLBACK_PATH}. Either restore ops/active-tenants.json or wire Supabase env vars.`,
    );
  }
  const raw = JSON.parse(readFileSync(FALLBACK_PATH, "utf-8")) as unknown;
  const enabled = parseJsonFallback(raw, logWarn);
  logInfo(`JSON fallback: ${enabled.length} valid active tenant(s) returned`);
  return enabled;
}

/**
 * Pure mapping helper: Supabase row shape → matrix-entry shape.
 * Exported for unit tests; production code uses readFromSupabase().
 */
export function mapDbRowToMatrixEntry(row: {
  id?: string | null;
  slug?: string | null;
  domain?: string | null;
}): MatrixTenant | null {
  const candidate = {
    tenantId: row.id ?? "",
    slug: row.slug ?? "",
    siteDomain: row.domain ?? "",
    enabled: true as const,
  };
  return isValidEntry(candidate) ? candidate : null;
}

async function main(): Promise<void> {
  // 1. Try DB first (production target after onboarding ships).
  let active = await readFromSupabase();

  // 2. Fall back to JSON file (today's source until DB env wired in CI).
  if (active === null) {
    logWarn("Falling back to ops/active-tenants.json source");
    try {
      active = readFromJson();
    } catch (err) {
      logError(`JSON fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // 2.5 Merge per-tenant ops overrides (scanMaxPages) onto the rows.
  // Applies on BOTH paths: DB rows have no override column, and the
  // JSON-fallback path is a no-op re-stamp of the same values. Tolerant
  // of a missing/invalid ops file — overrides are tuning, not identity.
  try {
    if (existsSync(FALLBACK_PATH)) {
      const overrides = readOpsOverrides(
        JSON.parse(readFileSync(FALLBACK_PATH, "utf-8")) as unknown,
      );
      for (const t of active) {
        const o = overrides.get(t.tenantId);
        if (o?.scanMaxPages !== undefined) t.scanMaxPages = o.scanMaxPages;
      }
    }
  } catch (err) {
    logWarn(
      `ops overrides skipped (unreadable ops file): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Fail loud if zero active tenants from either source.
  if (active.length === 0) {
    logError("No active tenants found in either Supabase or ops/active-tenants.json — refusing to run cron with empty matrix");
    process.exit(1);
  }

  // 4. Stable sort by tenantId so matrix order is deterministic.
  active.sort((a, b) => a.tenantId.localeCompare(b.tenantId));

  // 5. Emit compact JSON to stdout (the workflow captures this).
  process.stdout.write(JSON.stringify(active));
  process.stdout.write("\n");
  process.exit(0);
}

// Only auto-invoke main() when this file is run directly as a CLI
// (e.g. `tsx scripts/list-active-tenants.ts`). When imported by a
// vitest test that exercises the pure helpers above, main() must NOT
// run — its `process.exit(1)` on no-Supabase-connection bubbles up to
// vitest as an unhandled rejection and fails the suite even though
// every actual test passes. Guard checks `process.argv[1]` matches
// this file's basename (works for tsx + node + ts-node alike).
const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /(?:^|\/)list-active-tenants\.[cm]?[jt]s$/.test(process.argv[1]);

if (invokedAsCli) {
  main().catch((err) => {
    logError(`crashed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
