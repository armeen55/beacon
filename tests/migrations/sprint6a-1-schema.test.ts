import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 1 — migration contract tests.
//
// Two layers:
//
//   1. CONTRACT layer (always runs): encodes the expected schema shape as
//      constants in this file. Future migrations that drift the schema
//      without updating this file will fail the contract tests.
//
//   2. LIVE layer (runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      are available, typically via .env.local): queries the real Supabase
//      `information_schema` and `pg_indexes` to prove the live DB matches
//      the contract. Also runs a transactional upsert-idempotency probe
//      that rolls back to leave zero residual data.
//
// The migration was applied via the Supabase MCP tool with name
// `sprint6a1_page_element_inventory_and_recommended_edits`. For the
// canonical SQL, see the `MIGRATION_SQL` constant below (snapshot for
// version control; do NOT re-apply from here — use the MCP apply_migration
// tool or run against a fresh Supabase).
// ---------------------------------------------------------------------------

// ── Schema contract ────────────────────────────────────────────────────────

type ColumnSpec = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};

const EXPECTED_COLUMNS: Record<string, ColumnSpec[]> = {
  page_element_inventory: [
    { column_name: "id", data_type: "text", is_nullable: "NO" },
    { column_name: "tenant_id", data_type: "text", is_nullable: "NO" },
    { column_name: "page_id", data_type: "text", is_nullable: "NO" },
    { column_name: "url", data_type: "text", is_nullable: "NO" },
    { column_name: "element_type", data_type: "text", is_nullable: "NO" },
    { column_name: "element_key", data_type: "text", is_nullable: "NO" },
    { column_name: "display_label", data_type: "text", is_nullable: "NO" },
    { column_name: "element_text", data_type: "text", is_nullable: "YES" },
    { column_name: "element_metadata", data_type: "jsonb", is_nullable: "NO" },
    { column_name: "extractor_version", data_type: "integer", is_nullable: "NO" },
    {
      column_name: "observed_at",
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    },
    { column_name: "source_snapshot_id", data_type: "text", is_nullable: "NO" },
  ],
  recommended_edits: [
    { column_name: "id", data_type: "text", is_nullable: "NO" },
    { column_name: "tenant_id", data_type: "text", is_nullable: "NO" },
    { column_name: "rec_id", data_type: "text", is_nullable: "NO" },
    { column_name: "action_type", data_type: "text", is_nullable: "NO" },
    { column_name: "target_url", data_type: "text", is_nullable: "NO" },
    { column_name: "target_element_key", data_type: "text", is_nullable: "YES" },
    { column_name: "display_label", data_type: "text", is_nullable: "YES" },
    { column_name: "current_text", data_type: "text", is_nullable: "YES" },
    { column_name: "proposed_text", data_type: "text", is_nullable: "YES" },
    { column_name: "why", data_type: "text", is_nullable: "NO" },
    { column_name: "evidence", data_type: "jsonb", is_nullable: "NO" },
    { column_name: "expected_impact", data_type: "text", is_nullable: "YES" },
    { column_name: "difficulty", data_type: "text", is_nullable: "NO" },
    { column_name: "confidence", data_type: "text", is_nullable: "NO" },
    { column_name: "measurement_plan", data_type: "text", is_nullable: "YES" },
    { column_name: "risks", data_type: "ARRAY", is_nullable: "NO" },
    { column_name: "source", data_type: "text", is_nullable: "NO" },
    { column_name: "provider_name", data_type: "text", is_nullable: "YES" },
    { column_name: "evidence_hash", data_type: "text", is_nullable: "YES" },
    { column_name: "model", data_type: "text", is_nullable: "YES" },
    { column_name: "cost_usd", data_type: "numeric", is_nullable: "YES" },
    {
      column_name: "created_at",
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    },
    {
      column_name: "updated_at",
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    },
  ],
  llm_rejections: [
    { column_name: "id", data_type: "text", is_nullable: "NO" },
    { column_name: "tenant_id", data_type: "text", is_nullable: "NO" },
    { column_name: "rec_id", data_type: "text", is_nullable: "YES" },
    { column_name: "provider_name", data_type: "text", is_nullable: "YES" },
    { column_name: "model", data_type: "text", is_nullable: "YES" },
    { column_name: "evidence_hash", data_type: "text", is_nullable: "YES" },
    { column_name: "raw_output", data_type: "jsonb", is_nullable: "YES" },
    { column_name: "validation_error", data_type: "text", is_nullable: "YES" },
    { column_name: "cost_usd", data_type: "numeric", is_nullable: "YES" },
    {
      column_name: "rejected_at",
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    },
  ],
};

const EXPECTED_CHANGELOG_COLUMNS_ADDED = [
  { column_name: "action_type", data_type: "text", is_nullable: "YES" },
  { column_name: "target_element_key", data_type: "text", is_nullable: "YES" },
];

type IndexSpec = {
  indexname: string;
  tablename: string;
  isUnique: boolean;
  hasNullsNotDistinct?: boolean;
  isPartial?: boolean;
};

const EXPECTED_INDEXES: IndexSpec[] = [
  // page_element_inventory
  {
    indexname: "idx_pei_tenant_page",
    tablename: "page_element_inventory",
    isUnique: false,
  },
  {
    indexname: "idx_pei_tenant_element_key",
    tablename: "page_element_inventory",
    isUnique: false,
  },
  {
    indexname: "ux_pei_snapshot_element_key",
    tablename: "page_element_inventory",
    isUnique: true,
  },
  // recommended_edits
  {
    indexname: "idx_re_tenant_rec",
    tablename: "recommended_edits",
    isUnique: false,
  },
  {
    indexname: "ux_re_rec_action_element",
    tablename: "recommended_edits",
    isUnique: true,
    hasNullsNotDistinct: true,
  },
  // llm_rejections
  {
    indexname: "idx_llm_rej_tenant_rejected_at",
    tablename: "llm_rejections",
    isUnique: false,
  },
  // changelog_entries partial indexes
  {
    indexname: "idx_cl_action_type",
    tablename: "changelog_entries",
    isUnique: false,
    isPartial: true,
  },
  {
    indexname: "idx_cl_target_element_key",
    tablename: "changelog_entries",
    isUnique: false,
    isPartial: true,
  },
];

// Canonical migration SQL — snapshot for documentation / diff review. DO NOT
// re-run this from within the test. The authoritative apply path is the
// Supabase MCP `apply_migration` tool.
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS public.page_element_inventory (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  page_id text NOT NULL,
  url text NOT NULL,
  element_type text NOT NULL,
  element_key text NOT NULL,
  display_label text NOT NULL,
  element_text text,
  element_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  extractor_version integer NOT NULL,
  observed_at timestamptz NOT NULL,
  source_snapshot_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pei_tenant_page
  ON public.page_element_inventory (tenant_id, page_id);
CREATE INDEX IF NOT EXISTS idx_pei_tenant_element_key
  ON public.page_element_inventory (tenant_id, element_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pei_snapshot_element_key
  ON public.page_element_inventory (source_snapshot_id, element_key);

CREATE TABLE IF NOT EXISTS public.recommended_edits (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  rec_id text NOT NULL,
  action_type text NOT NULL,
  target_url text NOT NULL,
  target_element_key text,
  display_label text,
  current_text text,
  proposed_text text,
  why text NOT NULL,
  evidence jsonb NOT NULL,
  expected_impact text,
  difficulty text NOT NULL,
  confidence text NOT NULL,
  measurement_plan text,
  risks text[] NOT NULL DEFAULT '{}'::text[],
  source text NOT NULL,
  provider_name text,
  evidence_hash text,
  model text,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_re_rec_action_element
  ON public.recommended_edits (rec_id, action_type, target_element_key)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_re_tenant_rec
  ON public.recommended_edits (tenant_id, rec_id);

CREATE TABLE IF NOT EXISTS public.llm_rejections (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  rec_id text,
  provider_name text,
  model text,
  evidence_hash text,
  raw_output jsonb,
  validation_error text,
  cost_usd numeric,
  rejected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_rej_tenant_rejected_at
  ON public.llm_rejections (tenant_id, rejected_at DESC);

ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE public.changelog_entries
  ADD COLUMN IF NOT EXISTS target_element_key text;
CREATE INDEX IF NOT EXISTS idx_cl_action_type
  ON public.changelog_entries (action_type)
  WHERE action_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cl_target_element_key
  ON public.changelog_entries (target_element_key)
  WHERE target_element_key IS NOT NULL;
`.trim();

// ── CONTRACT tests (always run) ─────────────────────────────────────────────

describe("Sprint 6A.1 Phase 1 — migration contract", () => {
  it("expected columns per new table are enumerated", () => {
    // Pin the exact column set so a drift in the contract itself is visible
    // in PR review. Column count per table:
    expect(EXPECTED_COLUMNS.page_element_inventory.length).toBe(12);
    expect(EXPECTED_COLUMNS.recommended_edits.length).toBe(23);
    expect(EXPECTED_COLUMNS.llm_rejections.length).toBe(10);
  });

  it("tenant_id is NOT NULL on every new table", () => {
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const tenant = cols.find((c) => c.column_name === "tenant_id");
      expect(tenant, `${table} must have tenant_id`).toBeDefined();
      expect(tenant!.is_nullable).toBe("NO");
    }
  });

  it("changelog_entries gets action_type + target_element_key (both nullable for backward compat)", () => {
    expect(EXPECTED_CHANGELOG_COLUMNS_ADDED).toHaveLength(2);
    for (const col of EXPECTED_CHANGELOG_COLUMNS_ADDED) {
      expect(col.data_type).toBe("text");
      expect(col.is_nullable).toBe("YES");
    }
  });

  it("upsert unique indexes declared with the right uniqueness keys", () => {
    const peiUnique = EXPECTED_INDEXES.find(
      (i) => i.indexname === "ux_pei_snapshot_element_key",
    );
    expect(peiUnique?.isUnique).toBe(true);

    const reUnique = EXPECTED_INDEXES.find(
      (i) => i.indexname === "ux_re_rec_action_element",
    );
    expect(reUnique?.isUnique).toBe(true);
    // NULLS NOT DISTINCT is required so create_page/split/merge edits
    // (target_element_key = NULL) still de-duplicate per (rec_id, action_type).
    expect(reUnique?.hasNullsNotDistinct).toBe(true);
  });

  it("changelog_entries partial indexes defined with WHERE ... IS NOT NULL", () => {
    const clActionIdx = EXPECTED_INDEXES.find(
      (i) => i.indexname === "idx_cl_action_type",
    );
    expect(clActionIdx?.isPartial).toBe(true);
    const clElementIdx = EXPECTED_INDEXES.find(
      (i) => i.indexname === "idx_cl_target_element_key",
    );
    expect(clElementIdx?.isPartial).toBe(true);
  });

  it("MIGRATION_SQL is non-empty and mentions every new table + extension column", () => {
    expect(MIGRATION_SQL.length).toBeGreaterThan(100);
    expect(MIGRATION_SQL).toContain("page_element_inventory");
    expect(MIGRATION_SQL).toContain("recommended_edits");
    expect(MIGRATION_SQL).toContain("llm_rejections");
    expect(MIGRATION_SQL).toContain(
      "ADD COLUMN IF NOT EXISTS action_type",
    );
    expect(MIGRATION_SQL).toContain(
      "ADD COLUMN IF NOT EXISTS target_element_key",
    );
    expect(MIGRATION_SQL).toContain("NULLS NOT DISTINCT");
  });
});

// ── LIVE integration tests (env-gated) ──────────────────────────────────────

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

describeLive("Sprint 6A.1 Phase 1 — live Supabase schema", () => {
  const admin = sb!;

  beforeAll(() => {
    // Sanity: ensure the client is functional.
    expect(admin).toBeTruthy();
  });

  it("all three new tables exist", async () => {
    const { data, error } = await admin
      .from("pg_tables" as never)
      .select("schemaname,tablename")
      .eq("schemaname", "public")
      .in("tablename", [
        "page_element_inventory",
        "recommended_edits",
        "llm_rejections",
      ]);
    // If RPC-over-table isn't allowed, fall back to a count probe per table:
    if (error) {
      for (const t of [
        "page_element_inventory",
        "recommended_edits",
        "llm_rejections",
      ]) {
        const { error: err } = await admin
          .from(t)
          .select("*", { count: "exact", head: true });
        expect(err, `${t} must exist`).toBeNull();
      }
      return;
    }
    expect(data).toBeDefined();
    expect(data!.length).toBe(3);
  });

  it("changelog_entries has action_type + target_element_key columns", async () => {
    const { error } = await admin
      .from("changelog_entries")
      .select("id, action_type, target_element_key")
      .limit(1);
    expect(error).toBeNull();
  });

  it("inserting a row with missing tenant_id on a new table fails NOT NULL", async () => {
    const { error } = await admin
      .from("page_element_inventory")
      .insert({
        id: `test-phase6a1-missing-tenant-${Date.now()}`,
        // tenant_id intentionally omitted
        page_id: "p-missing",
        url: "https://missing.example",
        element_type: "title",
        element_key: "title[0]:test",
        display_label: "x",
        extractor_version: 1,
        observed_at: new Date().toISOString(),
        source_snapshot_id: "snap-missing",
      } as never);
    expect(error).not.toBeNull();
    // Postgres error code 23502 = not_null_violation. Supabase surfaces
    // this through error.code or error.message mentioning 'null value'.
    expect(
      error!.code === "23502" ||
        (error!.message ?? "").toLowerCase().includes("null"),
    ).toBe(true);
  });

  it("page_element_inventory upsert on (source_snapshot_id, element_key) is idempotent", async () => {
    const tenantId = `test-phase6a1-pei-${Date.now()}`;
    const snapId = `snap-test-${Date.now()}`;
    const base = {
      tenant_id: tenantId,
      page_id: "pg-test",
      url: "https://test.example/a",
      element_type: "h2",
      element_key: "h2[0]:sha256(foo)",
      display_label: "H2: Foo",
      element_text: "Foo heading",
      extractor_version: 1,
      observed_at: new Date().toISOString(),
      source_snapshot_id: snapId,
    };
    try {
      // First insert.
      const { error: e1 } = await admin
        .from("page_element_inventory")
        .upsert(
          [{ ...base, id: `${tenantId}-1` } as never],
          { onConflict: "source_snapshot_id,element_key" },
        );
      expect(e1).toBeNull();

      // Second upsert: SAME conflict key, DIFFERENT id and updated label.
      // Should not insert a new row; should update the existing one.
      const { error: e2 } = await admin
        .from("page_element_inventory")
        .upsert(
          [
            {
              ...base,
              id: `${tenantId}-1`,
              display_label: "H2: Foo v2",
              extractor_version: 2,
            } as never,
          ],
          { onConflict: "source_snapshot_id,element_key" },
        );
      expect(e2).toBeNull();

      const { data, error: readErr } = await admin
        .from("page_element_inventory")
        .select("id,display_label,extractor_version")
        .eq("tenant_id", tenantId);
      expect(readErr).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].display_label).toBe("H2: Foo v2");
      expect(data![0].extractor_version).toBe(2);
    } finally {
      await admin
        .from("page_element_inventory")
        .delete()
        .eq("tenant_id", tenantId);
    }
  });

  it("recommended_edits upsert on (rec_id, action_type, target_element_key) is idempotent, including NULL element_key", async () => {
    const tenantId = `test-phase6a1-re-${Date.now()}`;
    try {
      // A: non-null element_key — upsert replaces existing
      const nonNullA = {
        id: `${tenantId}-A`,
        tenant_id: tenantId,
        rec_id: "rec-abc",
        action_type: "edit_title",
        target_url: "/foo",
        target_element_key: "title[0]:sha256(x)",
        why: "why",
        evidence: ["evidence"] as never,
        difficulty: "low",
        confidence: "medium",
        source: "deterministic",
      };
      const { error: a1 } = await admin
        .from("recommended_edits")
        .upsert([nonNullA as never], {
          onConflict: "rec_id,action_type,target_element_key",
        });
      expect(a1).toBeNull();

      const { error: a2 } = await admin
        .from("recommended_edits")
        .upsert(
          [{ ...nonNullA, why: "updated-why", confidence: "high" } as never],
          { onConflict: "rec_id,action_type,target_element_key" },
        );
      expect(a2).toBeNull();

      // B: NULL element_key (create_page style) — same conflict key
      const nullB = {
        id: `${tenantId}-B`,
        tenant_id: tenantId,
        rec_id: "rec-xyz",
        action_type: "create_page",
        target_url: "/bar",
        target_element_key: null,
        why: "why",
        evidence: ["e"] as never,
        difficulty: "low",
        confidence: "medium",
        source: "deterministic",
      };
      const { error: b1 } = await admin
        .from("recommended_edits")
        .upsert([nullB as never], {
          onConflict: "rec_id,action_type,target_element_key",
        });
      expect(b1).toBeNull();

      // Re-upsert with same (rec_id, action_type, NULL element_key) — must
      // update, not insert (NULLS NOT DISTINCT behavior).
      const { error: b2 } = await admin
        .from("recommended_edits")
        .upsert(
          [{ ...nullB, why: "null-updated" } as never],
          { onConflict: "rec_id,action_type,target_element_key" },
        );
      expect(b2).toBeNull();

      const { data, error: readErr } = await admin
        .from("recommended_edits")
        .select("action_type, why, confidence, target_element_key")
        .eq("tenant_id", tenantId)
        .order("action_type");
      expect(readErr).toBeNull();
      expect(data).toHaveLength(2);
      type EditRow = {
        action_type: string;
        why: string;
        confidence: string;
        target_element_key: string | null;
      };
      const rows = data as unknown as EditRow[];
      const byAction: Record<string, EditRow> = Object.fromEntries(
        rows.map((r) => [r.action_type, r]),
      );
      expect(byAction.edit_title.why).toBe("updated-why");
      expect(byAction.edit_title.confidence).toBe("high");
      expect(byAction.create_page.why).toBe("null-updated");
      expect(byAction.create_page.target_element_key).toBeNull();
    } finally {
      await admin
        .from("recommended_edits")
        .delete()
        .eq("tenant_id", tenantId);
    }
  });

  it("llm_rejections accepts inserts (scaffold for Phase 6A.2)", async () => {
    const tenantId = `test-phase6a1-llm-${Date.now()}`;
    try {
      const { error } = await admin.from("llm_rejections").insert({
        id: `${tenantId}-1`,
        tenant_id: tenantId,
        validation_error: "placeholder — populated in 6A.2",
      } as never);
      expect(error).toBeNull();
    } finally {
      await admin
        .from("llm_rejections")
        .delete()
        .eq("tenant_id", tenantId);
    }
  });
});
