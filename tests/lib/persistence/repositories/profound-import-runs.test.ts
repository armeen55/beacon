/**
 * Section 5 precursor (2026-05-16) — `getProfoundImportRuns()`
 * explicit-tenant-scoped read.
 *
 * Verifies the locked contract that `forTenant(tenantId).
 * getProfoundImportRuns()` scopes by the explicit `tenantId`
 * argument — NOT by ambient `currentTenantSlug()` routing.
 *
 * Pattern: real-disk fixtures under a per-test tmpdir reached via
 * `process.chdir`, plus a mocked `getTenant` to supply slug
 * mappings without touching the real tenants registry. This mirrors
 * the existing test pattern for `getDataDir`/`getTenant`-aware code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { ObservationRun } from "@/domains/observations/types";
import type { BeaconTenant } from "@/domains/tenants/types";

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

let tenantMap: Map<string, BeaconTenant> = new Map();

vi.mock("@/domains/tenants/store", () => ({
  getTenant: vi.fn(async (id: string) => tenantMap.get(id) ?? null),
  getTenantOrThrow: vi.fn(),
  listTenants: vi.fn(async () => []),
}));

// Mock dotdata-json so unrelated tenant-repo paths don't touch disk.
vi.mock("@/lib/persistence/dotdata-json", () => ({
  readDotDataJson: vi.fn(async () => null),
  writeDotDataJson: vi.fn(async () => {}),
}));

import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type { SeedDataRepository } from "@/lib/persistence/repositories/types";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_A_ID = "tenant-a-id";
const TENANT_A_SLUG = "tenant-a-slug";
const TENANT_B_ID = "tenant-b-id";
const TENANT_B_SLUG = "tenant-b-slug";

function makeTenant(id: string, slug: string): BeaconTenant {
  // Tests only consume id + slug. The rest of the BeaconTenant
  // surface is asserted-cast so future schema additions don't
  // force every test fixture to backfill unrelated fields.
  return { id, slug } as unknown as BeaconTenant;
}

function profoundRow(over: Partial<ProfoundImportRun> = {}): ProfoundImportRun {
  return {
    id: over.id ?? "profound-1",
    account_id: over.account_id ?? "default-account",
    import_run_id: over.import_run_id ?? null,
    run_date: over.run_date ?? "2026-05-15",
    platform: over.platform ?? "chatgpt",
    model: over.model ?? null,
    geo: over.geo ?? null,
    locale: over.locale ?? null,
    source_type: over.source_type ?? "beacon_native",
    status: over.status ?? "completed",
    prompt_count: over.prompt_count ?? 25,
    metadata: over.metadata ?? {},
    created_at: over.created_at ?? "2026-05-15T07:00:00.000Z",
  };
}

function websiteCrawlRow(): ObservationRun {
  return {
    run_id: "obs-verify-1",
    run_type: "website_verify",
    source: "test",
    status: "completed",
    started_at: "2026-05-15T07:00:00.000Z",
    completed_at: "2026-05-15T07:10:00.000Z",
    scope_label: "test",
    parser_version: "page-snapshot-v1",
    pages_scanned: 1,
    pages_changed: 0,
    pages_with_errors: 0,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
    tenant_id: TENANT_A_ID,
  };
}

function stubBase(): SeedDataRepository {
  const notImpl = () => {
    throw new Error("not impl in test stub");
  };
  return new Proxy({} as SeedDataRepository, {
    get(_t, prop) {
      if (prop === "forTenant") return notImpl;
      return notImpl;
    },
  });
}

function seedFile(cwd: string, slug: string, rows: unknown[]): void {
  const dir = join(cwd, ".data", "tenants", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "observation-runs.json"),
    JSON.stringify(rows),
    "utf-8",
  );
}

// ─────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────

let originalCwd: string;
let tmpDir: string;
let savedEnv: { id?: string; slug?: string };

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), "profound-import-runs-test-"));
  process.chdir(tmpDir);
  tenantMap = new Map();
  savedEnv = {
    id: process.env.BEACON_TENANT_ID,
    slug: process.env.BEACON_TENANT_SLUG,
  };
  delete process.env.BEACON_TENANT_ID;
  delete process.env.BEACON_TENANT_SLUG;
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv.id !== undefined) process.env.BEACON_TENANT_ID = savedEnv.id;
  if (savedEnv.slug !== undefined) process.env.BEACON_TENANT_SLUG = savedEnv.slug;
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("getProfoundImportRuns — explicit-tenant scoping", () => {
  it("two-tenant isolation: forTenant(A) returns A's rows; forTenant(B) returns B's rows", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    tenantMap.set(TENANT_B_ID, makeTenant(TENANT_B_ID, TENANT_B_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [
      profoundRow({ id: "a-1", run_date: "2026-05-10" }),
      profoundRow({ id: "a-2", run_date: "2026-05-11" }),
    ]);
    seedFile(tmpDir, TENANT_B_SLUG, [
      profoundRow({ id: "b-1", run_date: "2026-05-12" }),
    ]);

    const repoA = buildTenantRepo(stubBase(), TENANT_A_ID);
    const repoB = buildTenantRepo(stubBase(), TENANT_B_ID);

    const outA = await repoA.getProfoundImportRuns();
    const outB = await repoB.getProfoundImportRuns();

    expect(outA.map((r) => r.id).sort()).toEqual(["a-1", "a-2"]);
    expect(outB.map((r) => r.id)).toEqual(["b-1"]);
  });

  it("ambient mismatch: explicit tenantId wins even when env points to a different slug", async () => {
    // Ambient context (env) points at tenant-b; the explicit
    // forTenant(tenant-a-id) call must still return tenant-a's data.
    process.env.BEACON_TENANT_ID = TENANT_B_ID;
    process.env.BEACON_TENANT_SLUG = TENANT_B_SLUG;
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    tenantMap.set(TENANT_B_ID, makeTenant(TENANT_B_ID, TENANT_B_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [
      profoundRow({ id: "a-explicit", run_date: "2026-05-10" }),
    ]);
    seedFile(tmpDir, TENANT_B_SLUG, [
      profoundRow({ id: "b-ambient", run_date: "2026-05-12" }),
    ]);

    const repoA = buildTenantRepo(stubBase(), TENANT_A_ID);
    const outA = await repoA.getProfoundImportRuns();

    expect(outA.map((r) => r.id)).toEqual(["a-explicit"]);
    expect(outA.find((r) => r.id === "b-ambient")).toBeUndefined();
  });

  it("missing tenant: no registry entry and env doesn't match → returns []", async () => {
    // tenantMap empty; env unset by beforeEach.
    seedFile(tmpDir, TENANT_A_SLUG, [profoundRow({ id: "a-1" })]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    expect(await repo.getProfoundImportRuns()).toEqual([]);
  });

  it("operator-bootstrap fallback: tenantId === BEACON_TENANT_ID + BEACON_TENANT_SLUG set → reads env slug path", async () => {
    process.env.BEACON_TENANT_ID = TENANT_A_ID;
    process.env.BEACON_TENANT_SLUG = TENANT_A_SLUG;
    // Registry intentionally empty — mirrors the Vercel posture
    // where `.data/global/tenants.json` is gitignored.
    seedFile(tmpDir, TENANT_A_SLUG, [
      profoundRow({ id: "a-via-env", run_date: "2026-05-10" }),
    ]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    const out = await repo.getProfoundImportRuns();
    expect(out.map((r) => r.id)).toEqual(["a-via-env"]);
  });

  it("operator-bootstrap fallback does NOT fire for non-bootstrap tenantIds", async () => {
    // env identifies tenant-a-id as the bootstrap. Caller asks for
    // tenant-b-id (no registry entry). Fallback must NOT activate.
    process.env.BEACON_TENANT_ID = TENANT_A_ID;
    process.env.BEACON_TENANT_SLUG = TENANT_A_SLUG;
    seedFile(tmpDir, TENANT_A_SLUG, [profoundRow({ id: "a-1" })]);
    seedFile(tmpDir, TENANT_B_SLUG, [profoundRow({ id: "b-1" })]);
    const repo = buildTenantRepo(stubBase(), TENANT_B_ID);
    expect(await repo.getProfoundImportRuns()).toEqual([]);
  });

  it("missing file: tenant resolved but per-tenant directory not seeded → returns []", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    // No seedFile call — directory absent.
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    expect(await repo.getProfoundImportRuns()).toEqual([]);
  });

  it("drops website-crawl ObservationRun rows from a mixed file", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [
      websiteCrawlRow(),
      profoundRow({ id: "p-1", run_date: "2026-05-15" }),
      websiteCrawlRow(),
      profoundRow({ id: "p-2", run_date: "2026-05-16" }),
    ]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    const out = await repo.getProfoundImportRuns();
    expect(out).toHaveLength(2);
    for (const row of out) {
      expect(row.run_date).toBeDefined();
      expect(row.source_type).toBeDefined();
      expect((row as unknown as Record<string, unknown>).run_type).toBeUndefined();
    }
  });

  it("filters defensively on malformed rows (missing run_date or source_type)", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [
      { id: "missing-rd", source_type: "beacon_native" },
      { id: "missing-st", run_date: "2026-05-15" },
      { id: "non-string-rd", run_date: 12345, source_type: "beacon_native" },
      profoundRow({ id: "valid" }),
      null,
      "not-an-object",
    ]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    const out = await repo.getProfoundImportRuns();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("valid");
  });

  it("preserves every documented source_type and status combination", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [
      profoundRow({ id: "native-completed", source_type: "beacon_native", status: "completed" }),
      profoundRow({ id: "native-failed", source_type: "beacon_native", status: "failed" }),
      profoundRow({ id: "native-running", source_type: "beacon_native", status: "running" }),
      profoundRow({ id: "manual-completed", source_type: "manual_import", status: "completed" }),
      profoundRow({ id: "api-completed", source_type: "api_import", status: "completed" }),
    ]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    const out = await repo.getProfoundImportRuns();
    expect(out.map((r) => r.id).sort()).toEqual([
      "api-completed",
      "manual-completed",
      "native-completed",
      "native-failed",
      "native-running",
    ]);
  });

  it("malformed JSON file → returns [] (fail-soft)", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    const dir = join(tmpDir, ".data", "tenants", TENANT_A_SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "observation-runs.json"), "not valid json {{", "utf-8");
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    expect(await repo.getProfoundImportRuns()).toEqual([]);
  });

  it("non-array root → returns [] (defensive)", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    const dir = join(tmpDir, ".data", "tenants", TENANT_A_SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "observation-runs.json"),
      JSON.stringify({ accidentally: "an object" }),
      "utf-8",
    );
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    expect(await repo.getProfoundImportRuns()).toEqual([]);
  });

  it("type contract — return type is ProfoundImportRun[], NOT ObservationRun[]", async () => {
    tenantMap.set(TENANT_A_ID, makeTenant(TENANT_A_ID, TENANT_A_SLUG));
    seedFile(tmpDir, TENANT_A_SLUG, [profoundRow({ id: "t-1" })]);
    const repo = buildTenantRepo(stubBase(), TENANT_A_ID);
    const out: ProfoundImportRun[] = await repo.getProfoundImportRuns();
    expect(out[0].run_date).toBe("2026-05-15");
    const _check: ProfoundImportRun = out[0];
    expect(_check.source_type).toBeDefined();
  });
});
