/**
 * onboard-tenant — MMVP customer-2 onboarding scaffold.
 *
 * Creates the on-disk skeleton needed for a second tenant: appends the
 * tenant registry row, scaffolds the per-tenant directory under
 * `.data/tenants/<slug>/`, seeds empty store files, and prints the
 * follow-up checklist (env vars, optional `tenant_members` SQL, next
 * steps). Does NOT touch Supabase, does NOT call any LLM, does NOT
 * mutate Ritz data.
 *
 * --dry-run is the DEFAULT — pass `--apply` to actually write.
 *
 * Usage:
 *   npx tsx scripts/onboard-tenant.ts \
 *     --slug=acme-builders \
 *     --tenant-id=tenant-acme \
 *     --name="Acme Custom Builders" \
 *     --domain=acmebuilders.com \
 *     [--user-id=<supabase-auth-user-uuid>] \
 *     [--apply]   # actually write (default is dry-run)
 *     [--force]   # overwrite if files / registry row already exist
 *
 * Tests:
 *   tests/scripts/onboard-tenant.test.ts — uses mkdtempSync to point
 *   `--data-root` at a tmpdir; never touches the real `.data/`.
 *
 * OUT OF SCOPE (deferred to later bundles):
 *   - Multi-tenant daily cron wiring.
 *   - Onboarding UI.
 *   - Billing.
 *   - RLS tenant-member policies for the other 35 tables.
 *   - Brand-assertions UI.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ── Validation regexes ──────────────────────────────────────────────

/**
 * Slug: lowercase letters, digits, single dashes between tokens.
 * No leading/trailing dash. 2..40 chars (the trailing alpha-num
 * char is required, so the minimum is 2).
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * Tenant id: must start with `tenant-` followed by lowercase token
 * (lowercase letters/digits/dashes). 8..50 chars total.
 */
export const TENANT_ID_RE = /^tenant-[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;

/**
 * Domain: lowercase apex (e.g. `acmebuilders.com`). Conservative shape:
 * one or more labels separated by dots; at least one dot; final TLD ≥ 2 chars.
 * No protocol, no path, no port.
 */
export const DOMAIN_RE =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Supabase-auth UUID (RFC 4122 8-4-4-4-12 hex, lowercase).
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Per-tenant store files seeded as empty `[]` ─────────────────────

/**
 * The 14 per-tenant store files the MMVP scaffold seeds. Mirrors the
 * operator-brief list exactly. Some of these (raw-poll-chunks,
 * changelog-entries) are Supabase-canonical in production today, but
 * seeding them as empty arrays on disk is harmless and matches the
 * file-backend's expected shape when a tenant has zero data yet.
 */
export const TENANT_STORE_FILES = [
  "tracked-prompts.json",
  "tracked-entities.json",
  "daily-metric-snapshots.json",
  "prompt-answer-observations.json",
  "observation-runs.json",
  "raw-poll-chunks.json",
  "pages.json",
  "page-snapshots.json",
  "page-snapshots-prev.json",
  "page-element-inventory.json",
  "scan-findings.json",
  "recommended-edits.json",
  "recommendation-responses.json",
  "changelog-entries.json",
] as const;

// ── Public types ────────────────────────────────────────────────────

export type OnboardTenantOptions = {
  slug: string;
  tenantId: string;
  name: string;
  domain: string;
  userId?: string;
  /** When false (the default), no files / registry rows are touched. */
  apply?: boolean;
  /** When true, overwrite existing tenant + tenant directory files. */
  force?: boolean;
  /** Override `.data/` location for tests. Defaults to `<cwd>/.data`. */
  dataRoot?: string;
  /** Override the now-clock for deterministic created_at / updated_at. */
  now?: Date;
  /** Custom logger; defaults to writing to console. Tests pass a sink. */
  log?: (line: string) => void;
};

export type OnboardTenantResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Files the script intends to create. */
  filesPlanned: string[];
  /** Files actually written this run. Empty when `apply` is false. */
  filesWritten: string[];
  /** Files skipped because they already exist (force=false). */
  filesSkipped: string[];
  /** Did the registry row get appended/updated this run? */
  registryUpdated: boolean;
  /** Whether the tenant already existed in `.data/global/tenants.json`. */
  preexistingRegistryRow: boolean;
  /** The (validated, normalised) tenant payload. */
  tenant: BeaconTenantSeed | null;
  /** Path of the per-tenant directory. */
  tenantDir: string | null;
  /** Path of the registry file. */
  registryPath: string | null;
  /** SQL string to insert tenant_members row, or null when no userId. */
  tenantMembersSql: string | null;
  /** Lines emitted to the logger (in order). Useful for tests. */
  output: string[];
};

/**
 * Subset of the production `BeaconTenant` type we seed via the MMVP
 * scaffold. Production callers (page renders, repository queries) only
 * read `id`, `slug`, `business_name`, `domain` from this row today.
 * The rest are operator-editable defaults. Kept as a structural type
 * (not imported from `src/domains/tenants/types`) so the script stays
 * server-only-free and CLI-runnable without `--require mock-server-only`.
 */
export type BeaconTenantSeed = {
  id: string;
  slug: string;
  business_name: string;
  domain: string;
  segment: "local_residential_builder";
  project_mix: string[];
  cities_served: string[];
  budget_range: "under_1m" | "1m_5m" | "5m_plus" | "mixed";
  signup_date: string;
  role: "founder" | "beta_customer" | "paid_customer";
  tos_accepted_at: string | null;
  discovered_competitors: string[];
  daily_budget_usd: number;
  status: "active" | "paused" | "cancelled";
  email_frequency: "weekly" | "immediate_only" | "off";
  created_at: string;
  updated_at: string;
};

// ── Programmatic core ───────────────────────────────────────────────

export async function onboardTenant(
  opts: OnboardTenantOptions,
): Promise<OnboardTenantResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const filesPlanned: string[] = [];
  const filesWritten: string[] = [];
  const filesSkipped: string[] = [];
  const output: string[] = [];

  const log = (line: string): void => {
    output.push(line);
    if (opts.log) opts.log(line);
  };

  // ── Validate inputs ────────────────────────────────────────────
  const slug = (opts.slug ?? "").trim();
  const tenantId = (opts.tenantId ?? "").trim();
  const name = (opts.name ?? "").trim();
  const domain = (opts.domain ?? "").trim().toLowerCase();
  const userId = (opts.userId ?? "").trim();

  if (!SLUG_RE.test(slug)) {
    errors.push(
      `Invalid --slug: "${slug}". Must be lowercase letters/digits/dashes, ` +
        `2..40 chars, no leading or trailing dash.`,
    );
  }
  if (!TENANT_ID_RE.test(tenantId)) {
    errors.push(
      `Invalid --tenant-id: "${tenantId}". Must start with "tenant-" and ` +
        `be 8..50 chars of lowercase letters/digits/dashes.`,
    );
  }
  if (name.length === 0 || name.length > 120) {
    errors.push(
      `Invalid --name: must be a non-empty string under 120 chars.`,
    );
  }
  if (!DOMAIN_RE.test(domain)) {
    errors.push(
      `Invalid --domain: "${domain}". Must be a bare apex domain (e.g. ` +
        `"acmebuilders.com"). No protocol, path, or port.`,
    );
  }
  if (userId && !UUID_RE.test(userId)) {
    errors.push(
      `Invalid --user-id: "${userId}". Must be a Supabase auth UUID ` +
        `(RFC 4122 8-4-4-4-12 hex).`,
    );
  }

  if (errors.length > 0) {
    log("Onboarding aborted — validation failed:");
    for (const e of errors) log(`  • ${e}`);
    return {
      ok: false,
      errors,
      warnings,
      filesPlanned,
      filesWritten,
      filesSkipped,
      registryUpdated: false,
      preexistingRegistryRow: false,
      tenant: null,
      tenantDir: null,
      registryPath: null,
      tenantMembersSql: null,
      output,
    };
  }

  const apply = opts.apply === true;
  const force = opts.force === true;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const dataRoot = opts.dataRoot ?? join(process.cwd(), ".data");
  const registryPath = join(dataRoot, "global", "tenants.json");
  const tenantDir = join(dataRoot, "tenants", slug);

  // ── Build the new tenant payload ───────────────────────────────
  const seed: BeaconTenantSeed = {
    id: tenantId,
    slug,
    business_name: name,
    domain,
    segment: "local_residential_builder",
    project_mix: [],
    cities_served: [],
    budget_range: "mixed",
    signup_date: nowIso,
    role: "beta_customer",
    tos_accepted_at: null,
    discovered_competitors: [],
    daily_budget_usd: 5,
    status: "active",
    email_frequency: "weekly",
    created_at: nowIso,
    updated_at: nowIso,
  };

  // ── Read existing registry (if any) ────────────────────────────
  let existingRegistry: BeaconTenantSeed[] = [];
  let preexistingRegistryRow = false;

  if (existsSync(registryPath)) {
    try {
      const raw = readFileSync(registryPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existingRegistry = parsed as BeaconTenantSeed[];
      } else {
        warnings.push(
          `Registry at ${registryPath} is not an array — treating as empty.`,
        );
      }
    } catch (e) {
      errors.push(
        `Failed to parse registry at ${registryPath}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      log("Onboarding aborted — registry read error.");
      return {
        ok: false,
        errors,
        warnings,
        filesPlanned,
        filesWritten,
        filesSkipped,
        registryUpdated: false,
        preexistingRegistryRow: false,
        tenant: null,
        tenantDir: null,
        registryPath,
        tenantMembersSql: null,
        output,
      };
    }
  }

  const slugClash = existingRegistry.find((t) => t?.slug === slug);
  const idClash = existingRegistry.find((t) => t?.id === tenantId);
  if ((slugClash || idClash) && !force) {
    errors.push(
      `Tenant already exists (` +
        (slugClash ? `slug "${slug}"` : `id "${tenantId}"`) +
        `). Re-run with --force to overwrite the registry row + tenant ` +
        `directory files.`,
    );
    log("Onboarding aborted — duplicate tenant.");
    for (const e of errors) log(`  • ${e}`);
    return {
      ok: false,
      errors,
      warnings,
      filesPlanned,
      filesWritten,
      filesSkipped,
      registryUpdated: false,
      preexistingRegistryRow: Boolean(slugClash || idClash),
      tenant: null,
      tenantDir,
      registryPath,
      tenantMembersSql: null,
      output,
    };
  }
  preexistingRegistryRow = Boolean(slugClash || idClash);

  // ── Plan the file set ──────────────────────────────────────────
  for (const file of TENANT_STORE_FILES) {
    filesPlanned.push(join(tenantDir, file));
  }

  // ── Header banner ──────────────────────────────────────────────
  log(`onboard-tenant — ${apply ? "APPLY" : "DRY-RUN"}`);
  log(`  slug:        ${slug}`);
  log(`  tenant_id:   ${tenantId}`);
  log(`  name:        ${name}`);
  log(`  domain:      ${domain}`);
  if (userId) log(`  user_id:     ${userId}`);
  log(`  data root:   ${dataRoot}`);
  log("");

  // ── Apply (or print plan) ──────────────────────────────────────
  let registryUpdated = false;

  if (apply) {
    // Ensure parent directories exist.
    mkdirSync(join(dataRoot, "global"), { recursive: true });
    mkdirSync(tenantDir, { recursive: true });

    // Update / append registry row atomically.
    const nextRegistry = preexistingRegistryRow
      ? existingRegistry.map((t) =>
          t.slug === slug || t.id === tenantId
            ? { ...t, ...seed, updated_at: nowIso }
            : t,
        )
      : [...existingRegistry, seed];

    writeJsonAtomic(registryPath, nextRegistry);
    registryUpdated = true;
    log(
      preexistingRegistryRow
        ? `[apply] updated registry row for "${slug}" at ${registryPath}`
        : `[apply] appended registry row for "${slug}" at ${registryPath}`,
    );

    // Seed tenant store files. Idempotent: skip when file exists,
    // unless `--force` is set (in which case overwrite to `[]`).
    for (const file of TENANT_STORE_FILES) {
      const target = join(tenantDir, file);
      if (existsSync(target) && !force) {
        filesSkipped.push(target);
        log(`[apply] skip (already exists): ${target}`);
        continue;
      }
      writeJsonAtomic(target, []);
      filesWritten.push(target);
      log(`[apply] wrote: ${target}`);
    }
  } else {
    log(`[plan] would ${preexistingRegistryRow ? "update" : "append"} registry row at ${registryPath}`);
    for (const file of filesPlanned) {
      const verb = existsSync(file) ? "skip-existing" : "create";
      log(`[plan] would ${verb}: ${file}`);
    }
  }

  // ── Business-config payload (printed; not written) ─────────────
  const businessConfigJson: Record<string, unknown> = {
    tenant_id: tenantId,
    business_name: name,
    domain,
    segment: seed.segment,
    project_mix: seed.project_mix,
    cities_served: seed.cities_served,
    budget_range: seed.budget_range,
  };
  log("");
  log("─── BUSINESS_CONFIG payload (operator can paste into BEACON_BUSINESS_CONFIG_JSON) ───");
  log(JSON.stringify(businessConfigJson, null, 2));

  // ── tenant_members SQL (printed; never executed) ───────────────
  let tenantMembersSql: string | null = null;
  if (userId) {
    tenantMembersSql =
      `-- Run via Supabase SQL editor or apply_migration. Executes\n` +
      `-- against the public.tenant_members table whose RLS is on but\n` +
      `-- service-role bypasses (verified 2026-05-06 RLS migration).\n` +
      `INSERT INTO public.tenant_members (user_id, tenant_id, role, created_at)\n` +
      `VALUES ('${userId}', '${tenantId}', 'owner', now())\n` +
      `ON CONFLICT (user_id, tenant_id) DO NOTHING;`;
    log("");
    log("─── tenant_members SQL (operator runs in Supabase SQL editor) ───");
    log(tenantMembersSql);
  }

  // ── Vercel / GitHub env checklist ──────────────────────────────
  log("");
  log("─── Vercel / GitHub env checklist ───");
  log(`  BEACON_TENANT_ID            = ${tenantId}`);
  log(`  BEACON_TENANT_SLUG          = ${slug}`);
  log(`  BEACON_SITE_DOMAIN          = ${domain}`);
  log(`  BEACON_BUSINESS_CONFIG_JSON = (paste the JSON object above as one line)`);
  log("");
  log("  Set these in:");
  log("    • Vercel project env (Production + Preview).");
  log("    • GitHub Actions repo secrets (if a per-tenant cron is added later).");

  // ── Next-steps checklist ───────────────────────────────────────
  log("");
  log("─── Next steps ───");
  log("  1. Seed prompts:    edit `.data/tenants/" + slug + "/tracked-prompts.json`");
  log("                      (or use settings/prompts UI once the route is multi-tenant).");
  log("  2. Seed entities:   edit `.data/tenants/" + slug + "/tracked-entities.json`");
  log("                      with the brand row + known competitors.");
  log("  3. Run scan:        `npx tsx scripts/run-scheduled-scan.ts` after pointing");
  log("                      `BEACON_SITE_DOMAIN` at the new domain (env or .env.local).");
  log("  4. First poll:      manually fire `/api/poll/run` once for each platform");
  log("                      (perplexity + openai) with the new tenant_id, OR add");
  log("                      a parallel job to .github/workflows/daily-native-poll.yml.");
  log("  5. Verify /today:   sign in with the user_id above and confirm the tenant's");
  log("                      first reading renders without falling back to defaults.");
  log("  6. Multi-tenant cron + onboarding UI are out of scope for this MMVP — track");
  log("                      separately in NEXT_PHASE_EXECUTION_PLAN.md (Phase 7.9).");

  return {
    ok: true,
    errors,
    warnings,
    filesPlanned,
    filesWritten,
    filesSkipped,
    registryUpdated,
    preexistingRegistryRow,
    tenant: seed,
    tenantDir,
    registryPath,
    tenantMembersSql,
    output,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  // node:fs has no `renameSync` re-export at the top of this file;
  // require it lazily so the test harness can stub if needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(tmp, path);
}

// ── CLI parsing ─────────────────────────────────────────────────────

export function parseArgs(argv: ReadonlyArray<string>): {
  parsed: Partial<OnboardTenantOptions> & { showHelp?: boolean };
  unknown: string[];
} {
  const parsed: Partial<OnboardTenantOptions> & { showHelp?: boolean } = {};
  const unknown: string[] = [];
  for (const a of argv) {
    if (a === "--help" || a === "-h") {
      parsed.showHelp = true;
      continue;
    }
    if (a === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (a === "--dry-run") {
      parsed.apply = false;
      continue;
    }
    if (a === "--force") {
      parsed.force = true;
      continue;
    }
    const m = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(a);
    if (!m) {
      unknown.push(a);
      continue;
    }
    const [, key, value] = m;
    switch (key) {
      case "slug":
        parsed.slug = value;
        break;
      case "tenant-id":
        parsed.tenantId = value;
        break;
      case "name":
        parsed.name = value;
        break;
      case "domain":
        parsed.domain = value;
        break;
      case "user-id":
        parsed.userId = value;
        break;
      case "data-root":
        parsed.dataRoot = value;
        break;
      default:
        unknown.push(a);
    }
  }
  return { parsed, unknown };
}

const HELP = `\
onboard-tenant — MMVP customer-2 onboarding scaffold.

USAGE
  npx tsx scripts/onboard-tenant.ts \\
    --slug=<slug> \\
    --tenant-id=<tenant-id> \\
    --name="<Business Name>" \\
    --domain=<apex-domain> \\
    [--user-id=<supabase-auth-user-uuid>] \\
    [--apply] [--force] [--dry-run]

FLAGS
  --slug         Lowercase URL-safe identifier, 2..40 chars (e.g. "acme-builders").
  --tenant-id    Must start with "tenant-" (e.g. "tenant-acme").
  --name         Display name for the business (max 120 chars).
  --domain       Bare apex domain (e.g. "acmebuilders.com"); no protocol/path.
  --user-id      Optional Supabase auth UUID. When set, prints
                 tenant_members INSERT SQL (does not execute).
  --apply        Actually write files and update the registry. Default is dry-run.
  --dry-run      Default. Prints the plan without touching disk.
  --force        Overwrite existing registry row + tenant directory files.
  --data-root    Override the .data/ path (used by tests).
  --help, -h     Show this help.

OUT OF SCOPE
  No Supabase writes. No OpenAI calls. No queue mutation.
`;

// ── CLI entry point ─────────────────────────────────────────────────

async function main(): Promise<number> {
  const { parsed, unknown } = parseArgs(process.argv.slice(2));
  if (parsed.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument(s): ${unknown.join(" ")}\n\n`);
    process.stderr.write(HELP);
    return 2;
  }
  if (!parsed.slug || !parsed.tenantId || !parsed.name || !parsed.domain) {
    process.stderr.write(
      `Missing required flag(s). All four of --slug, --tenant-id, --name, --domain are required.\n\n`,
    );
    process.stderr.write(HELP);
    return 2;
  }
  const result = await onboardTenant({
    slug: parsed.slug,
    tenantId: parsed.tenantId,
    name: parsed.name,
    domain: parsed.domain,
    userId: parsed.userId,
    apply: parsed.apply ?? false,
    force: parsed.force,
    dataRoot: parsed.dataRoot,
    log: (line) => process.stdout.write(line + "\n"),
  });
  return result.ok ? 0 : 1;
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /onboard-tenant\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[onboard-tenant] unhandled:", err);
      process.exit(2);
    },
  );
}
