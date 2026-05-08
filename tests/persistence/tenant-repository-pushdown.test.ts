/**
 * Sprint 7 Phase 7.5b Commit 1C (2026-04-25) — pushdown filter tests.
 *
 * Two layers:
 *   1. Static invariant (always runs): scans the `forTenant` body in
 *      `supabase-backend.ts` and asserts every method either uses one
 *      of the scoped helpers (`selectScoped` / `queryAllPagedScoped`)
 *      or carries an explicit `.eq("tenant_id", tenantId)` predicate.
 *   2. Live (env-gated): hits real Supabase with a nonexistent tenant
 *      and asserts every Tier A method returns an empty array. Plus a
 *      cross-tenant rec_id collision test on `recommended_edits` that
 *      proves the widened unique index (Phase 7.5a) lets two tenants
 *      hold the same `rec_id` without leaking on read.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Static invariant — `forTenant` block in supabase-backend.ts must scope every
// query. Catches regressions where someone adds a method that forgets `.eq`.
// ---------------------------------------------------------------------------

describe("Sprint 7 Phase 7.5b Commit 1C — pushdown invariant", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../../src/lib/persistence/repositories/supabase-backend.ts"),
    "utf8",
  );

  it("forTenant block uses scoped helpers or an explicit tenant predicate for every method", () => {
    // Slice the forTenant method body. Anchor on the comment that opens the
    // block so the test fails loudly if the block is renamed or moved.
    const start = SRC.indexOf("Phase 7.5b Commit 1C (2026-04-25) — tenant-bound facade");
    expect(start).toBeGreaterThan(0);

    const fnStart = SRC.indexOf("forTenant(tenantId", start);
    expect(fnStart).toBeGreaterThan(start);

    // Match `},` at the start of a line — the close of the forTenant method.
    const fnEnd = SRC.indexOf("\n  },", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);

    const body = SRC.slice(fnStart, fnEnd);

    // Each method in the body either calls a scoped helper OR carries an
    // explicit tenant predicate. The default is `.eq("tenant_id", tenantId)`;
    // the documented exception is `tracked_prompts` / `tracked_entities`,
    // whose schema uses `account_id text NOT NULL` (the slug), not
    // `tenant_id`. The customer-2 isolation fix (operator audit, 2026-05-06)
    // resolves the slug via getTenant(tenantId) and filters with
    // `.eq("account_id", tenant.slug)`. Both forms are tenant-scoped — the
    // invariant accepts either.
    const selects = [...body.matchAll(/\.select\(/g)];
    expect(selects.length).toBeGreaterThan(0);

    for (const m of selects) {
      // EGRESS-P0 (2026-05-07) — widened the look-ahead window from 200
      // → 1200 chars. The page_snapshots projection is now a
      // multi-line .select("id, page_id, ...") that's ~600 chars long;
      // the `.eq("tenant_id", tenantId)` lives just past it.
      const window = body.slice(m.index ?? 0, (m.index ?? 0) + 1200);
      const hasTenantIdEq =
        window.includes('.eq("tenant_id", tenantId)') ||
        window.includes(".eq('tenant_id', tenantId)");
      // Customer-2 fix exception: tracked_prompts / tracked_entities are
      // scoped via the slug column (account_id), resolved through getTenant.
      const hasAccountSlugEq =
        window.includes('.eq("account_id", tenant.slug)') ||
        window.includes(".eq('account_id', tenant.slug)");
      const hasTenantEq = hasTenantIdEq || hasAccountSlugEq;
      expect(
        hasTenantEq,
        `unscoped .select( in forTenant body at offset ${m.index}: ${window.slice(0, 120)}`,
      ).toBe(true);
    }

    // Spot-check: helpers themselves must scope. They live OUTSIDE forTenant,
    // so check the whole file.
    expect(SRC).toMatch(/async function selectScoped[\s\S]*?\.eq\("tenant_id", tenantId\)/);
    expect(SRC).toMatch(/async function queryAllPagedScoped[\s\S]*?\.eq\("tenant_id", tenantId\)/);
  });
});

// ---------------------------------------------------------------------------
// Live integration — env-gated (same pattern as tests/migrations/sprint6a-1-schema.test.ts)
// ---------------------------------------------------------------------------

function loadDotEnvLocalIfPresent(): void {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      if (process.env[key] == null) process.env[key] = trimmed.slice(eq + 1);
    }
  }
}

function makeSupabaseAdminIfAvailable(): SupabaseClient | null {
  loadDotEnvLocalIfPresent();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const sb = makeSupabaseAdminIfAvailable();
const describeLive = sb ? describe : describe.skip;

const FAKE_TENANT = "tenant-pushdown-test-zzz-no-rows";

describeLive("Sprint 7 Phase 7.5b Commit 1C — live Supabase pushdown filters", () => {
  // Ensure DATA_SOURCE=supabase so getRepository() returns the Supabase backend.
  // The schema invariant test above (which always runs) verifies the static
  // shape; this live block exercises the runtime against real Supabase rows.

  let getRepository: typeof import("@/lib/persistence/repositories").getRepository;

  beforeAll(async () => {
    process.env.DATA_SOURCE = "supabase";
    ({ getRepository } = await import("@/lib/persistence/repositories"));
  });

  // The 15 Tier A methods on TenantRepository. For a nonexistent tenant,
  // every method must return an empty array — the proof that .eq filtered
  // correctly without falling through to unscoped reads.
  const methods: ReadonlyArray<{
    name: string;
    fn: (
      repo: ReturnType<ReturnType<typeof getRepository>["forTenant"]>,
    ) => Promise<unknown[]>;
  }> = [
    { name: "getImportRuns", fn: (r) => r.getImportRuns() },
    { name: "getResults", fn: (r) => r.getResults() },
    { name: "getChangelogEntries", fn: (r) => r.getChangelogEntries() },
    { name: "getPages", fn: (r) => r.getPages() },
    { name: "getPageSnapshots", fn: (r) => r.getPageSnapshots() },
    { name: "getGuardrailAlerts", fn: (r) => r.getGuardrailAlerts() },
    { name: "getObservationRuns", fn: (r) => r.getObservationRuns() },
    { name: "getScanFindings", fn: (r) => r.getScanFindings() },
    { name: "getPendingScanFindings", fn: (r) => r.getPendingScanFindings() },
    { name: "getRecommendationResponses", fn: (r) => r.getRecommendationResponses() },
    { name: "getUrlChangeOutcomes", fn: (r) => r.getUrlChangeOutcomes() },
    { name: "getRecommendedEdits", fn: (r) => r.getRecommendedEdits() },
    { name: "getPageElementInventory", fn: (r) => r.getPageElementInventory() },
    { name: "getPromptAnswerObservations", fn: (r) => r.getPromptAnswerObservations() },
    { name: "getDailyMetricSnapshots", fn: (r) => r.getDailyMetricSnapshots() },
  ];

  for (const m of methods) {
    it(`${m.name} scoped to nonexistent tenant returns empty`, async () => {
      const repo = getRepository().forTenant(FAKE_TENANT);
      const rows = await m.fn(repo);
      expect(rows).toEqual([]);
    });
  }

  it("Ritz tenant has rows on representative methods (sanity that filter doesn't over-scope)", async () => {
    const repo = getRepository().forTenant("tenant-ritz-founder");
    const pages = await repo.getPages();
    const recs = await repo.getRecommendedEdits();
    expect(pages.length).toBeGreaterThan(0);
    expect(recs.length).toBeGreaterThan(0);
    // Spot-check: every returned row carries the right tenant.
    for (const p of pages) {
      expect((p as { tenant_id: string }).tenant_id).toBe("tenant-ritz-founder");
    }
    for (const r of recs) {
      expect((r as { tenant_id: string }).tenant_id).toBe("tenant-ritz-founder");
    }
  });

  it("recommended_edits cross-tenant rec_id collision: same (rec_id, action_type, target_element_key) under two tenants is allowed and isolated on read", async () => {
    const tenantA = `test-c1c-${Date.now()}-a`;
    const tenantB = `test-c1c-${Date.now()}-b`;
    const recId = `rec-c1c-${Date.now()}`;
    const elementKey = `title[0]:sha256(c1c)`;
    const baseRow = {
      rec_id: recId,
      action_type: "edit_title" as const,
      target_url: "/foo",
      target_element_key: elementKey,
      why: "why",
      evidence: ["e"] as never,
      difficulty: "low",
      confidence: "medium",
      source: "deterministic",
    };

    try {
      // Insert under tenant A.
      const a = await sb!
        .from("recommended_edits")
        .insert([{ ...baseRow, id: `${tenantA}-1`, tenant_id: tenantA } as never]);
      expect(a.error).toBeNull();

      // Insert SAME (rec_id, action_type, target_element_key) under tenant B.
      // Pre-7.5a this would have failed the unique constraint; post-7.5a the
      // constraint is widened to include tenant_id, so both rows coexist.
      const b = await sb!
        .from("recommended_edits")
        .insert([{ ...baseRow, id: `${tenantB}-1`, tenant_id: tenantB } as never]);
      expect(b.error).toBeNull();

      // Read via the pushdown forTenant. Each tenant sees only its own row.
      const repo = getRepository();
      const rowsA = await repo.forTenant(tenantA).getRecommendedEdits();
      const rowsB = await repo.forTenant(tenantB).getRecommendedEdits();
      expect(rowsA.length).toBe(1);
      expect(rowsB.length).toBe(1);
      expect((rowsA[0] as { tenant_id: string }).tenant_id).toBe(tenantA);
      expect((rowsB[0] as { tenant_id: string }).tenant_id).toBe(tenantB);
      // Same rec_id on both — the collision is real, not just a name match.
      expect((rowsA[0] as { rec_id: string }).rec_id).toBe(recId);
      expect((rowsB[0] as { rec_id: string }).rec_id).toBe(recId);
    } finally {
      await sb!.from("recommended_edits").delete().eq("tenant_id", tenantA);
      await sb!.from("recommended_edits").delete().eq("tenant_id", tenantB);
    }
  });
});
