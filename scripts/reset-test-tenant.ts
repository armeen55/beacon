/**
 * reset-test-tenant — Friend-test QA (Gap F.1, 2026-05-07).
 *
 * DELETEs all rows for a single TEST tenant across tracked_prompts,
 * tenant_members, and tenants. Never touches Ritz. Defaults to a
 * dry-run that prints what WOULD be deleted; --confirm executes.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/reset-test-tenant.ts --slug=8c9d2f4a
 *     # → dry-run, prints plan only
 *
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/reset-test-tenant.ts --slug=8c9d2f4a --confirm
 *     # → executes the deletes
 *
 * Safety guards (pinned by architecture invariants):
 *   - Refuses any slug containing "ritz" (case-insensitive) OR
 *     starting with "tenant-ritz-".
 *   - Requires --slug=<slug>.
 *   - Defaults to dry-run; --confirm required to execute.
 *   - Refuses if tenant.status is paused or cancelled (operator-set
 *     states are off-limits for this script).
 *   - Refuses if tenant has more than MAX_OBSERVATIONS_FOR_RESET
 *     prompt_answer_observations rows — heuristic that the tenant
 *     looks like a real customer, not a test artifact.
 *   - Only touches three tables: tracked_prompts, tenant_members,
 *     tenants. Never touches observations / snapshots / changelog /
 *     recommended_edits — those are operator-cleanup-only.
 *   - Never touches auth.users (requires admin auth API; operator
 *     can clean up the auth row via Supabase Dashboard if needed).
 *   - No paid API calls. No OpenAI. No external HTTP beyond Supabase.
 *
 * Failure mode: any error short-circuits the script. Partial-state
 * is acceptable on retry — the script is idempotent (.delete().eq()
 * is safe to re-run).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Safety constants (pinned by tests) ────────────────────────────────

/** Slug patterns this script refuses to delete. */
export const RITZ_FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /ritz/i,
  /^tenant-ritz-/,
];

/** Tenant statuses the script will reset. Other states (paused,
 *  cancelled) are operator-set and off-limits. */
export const RESETTABLE_STATUSES: ReadonlySet<string> = new Set([
  "pending_onboarding",
  "active",
]);

/** If the tenant has more observations than this, refuse to reset
 *  (looks like a real customer, not a test artifact). */
export const MAX_OBSERVATIONS_FOR_RESET = 100;

/** Tables the script is allowed to delete from. Defense in depth. */
export const ALLOWED_DELETE_TABLES: ReadonlySet<string> = new Set([
  "tracked_prompts",
  "tenant_members",
  "tenants",
]);

// ── Pure helpers (testable) ───────────────────────────────────────────

/**
 * True if the slug matches any of the Ritz-forbidden patterns.
 * Used as the primary safety check before any DB call.
 */
export function isProtectedSlug(slug: string): boolean {
  if (typeof slug !== "string" || slug.length === 0) return false;
  for (const re of RITZ_FORBIDDEN_PATTERNS) {
    if (re.test(slug)) return true;
  }
  return false;
}

/**
 * Parse `--name=value` and `--name` style arguments. Returns the
 * value for `--name=value`, the literal string `"true"` for bare
 * `--name`, or null when the flag is absent.
 */
export function parseArg(argv: ReadonlyArray<string>, name: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name) return "true";
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────

type ResetReason =
  | "no_slug"
  | "protected_slug"
  | "no_supabase_env"
  | "tenant_fetch_failed"
  | "tenant_not_found"
  | "tenant_status_off_limits"
  | "too_many_observations"
  | "delete_failed";

function fail(reason: ResetReason, detail: string): never {
  console.error(`reset-test-tenant: ${reason}: ${detail}`);
  process.exit(1);
}

async function loadAdminClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail(
      "no_supabase_env",
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env (source .env.local).",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slug = parseArg(argv, "--slug");
  const confirm = parseArg(argv, "--confirm") !== null;

  if (!slug) {
    fail(
      "no_slug",
      "usage: --slug=<slug> [--confirm]. Without --confirm this is a dry-run.",
    );
  }

  if (isProtectedSlug(slug)) {
    fail(
      "protected_slug",
      `refusing to reset Ritz-shaped slug "${slug}". Manual SQL required for any tenant whose slug contains "ritz" or starts with "tenant-ritz-".`,
    );
  }

  const admin = await loadAdminClient();

  // 1. Fetch tenant by slug.
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id, slug, business_name, status, created_at")
    .eq("slug", slug)
    .maybeSingle();
  if (tErr) {
    fail("tenant_fetch_failed", tErr.message);
  }
  if (!tenant) {
    console.log(`No tenant with slug="${slug}". Nothing to reset.`);
    return;
  }

  // 2. Status guard.
  if (!RESETTABLE_STATUSES.has(tenant.status)) {
    fail(
      "tenant_status_off_limits",
      `tenant.status="${tenant.status}". Only ${[...RESETTABLE_STATUSES].join("/")} allowed. Operator-set states (paused/cancelled) require manual SQL.`,
    );
  }

  // 3. Observation-count guard (heuristic: real tenant vs test artifact).
  const { count: obsCount, error: obsErr } = await admin
    .from("prompt_answer_observations")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id);
  if (obsErr) {
    fail("tenant_fetch_failed", `prompt_answer_observations count: ${obsErr.message}`);
  }
  const obsCountVal = obsCount ?? 0;
  if (obsCountVal > MAX_OBSERVATIONS_FOR_RESET) {
    fail(
      "too_many_observations",
      `tenant has ${obsCountVal} observations (> ${MAX_OBSERVATIONS_FOR_RESET}). Looks like a real customer. Manual SQL review required.`,
    );
  }

  // 4. Prompt + member counts (informational).
  const { count: promptCount } = await admin
    .from("tracked_prompts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", tenant.slug);
  const { count: memberCount } = await admin
    .from("tenant_members")
    .select("user_id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id);

  console.log("Reset plan");
  console.log(`  tenant id:                   ${tenant.id}`);
  console.log(`  tenant slug:                 ${tenant.slug}`);
  console.log(`  business_name:               ${tenant.business_name}`);
  console.log(`  status:                      ${tenant.status}`);
  console.log(`  created_at:                  ${tenant.created_at}`);
  console.log(`  tracked_prompts rows:        ${promptCount ?? 0} (will DELETE)`);
  console.log(`  tenant_members rows:         ${memberCount ?? 0} (will DELETE)`);
  console.log(`  tenants row:                 1 (will DELETE)`);
  console.log(
    `  prompt_answer_observations:  ${obsCountVal} (will NOT delete; manual cleanup if needed)`,
  );
  console.log(`  auth.users row for the user: NOT touched (clean up via Supabase Dashboard)`);

  if (!confirm) {
    console.log("\nDRY RUN. Re-run with --confirm to execute.");
    return;
  }

  // 5. Execute deletes in safe order: prompts → members → tenants.
  //    Order matters only loosely (no FK cascades enforce it), but
  //    leaves the tenant row last so a partial failure leaves a
  //    visible orphan rather than a dangling member/prompt.

  const { error: pErr } = await admin
    .from("tracked_prompts")
    .delete()
    .eq("account_id", tenant.slug);
  if (pErr) {
    fail("delete_failed", `tracked_prompts: ${pErr.message}`);
  }
  console.log(`✓ Deleted ${promptCount ?? 0} tracked_prompts rows.`);

  const { error: mErr } = await admin
    .from("tenant_members")
    .delete()
    .eq("tenant_id", tenant.id);
  if (mErr) {
    fail("delete_failed", `tenant_members: ${mErr.message}`);
  }
  console.log(`✓ Deleted ${memberCount ?? 0} tenant_members rows.`);

  const { error: tDelErr } = await admin
    .from("tenants")
    .delete()
    .eq("id", tenant.id);
  if (tDelErr) {
    fail("delete_failed", `tenants: ${tDelErr.message}`);
  }
  console.log(`✓ Deleted tenants row id=${tenant.id}.`);

  console.log(
    "\nReset complete. To clean up the auth user, open Supabase Dashboard → Auth → Users and delete the corresponding row manually.",
  );
}

// Only run when invoked directly (not when imported by tests).
const isDirectRun =
  typeof require !== "undefined" && require.main === module;
if (isDirectRun) {
  main().catch((err) => {
    console.error("reset-test-tenant: unexpected error:", err);
    process.exit(1);
  });
}
