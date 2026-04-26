/**
 * Sprint 7 dual-write tenant validation infrastructure tests.
 *
 * Phase 7.7a (2026-04-25):
 *   - assertRowsScopedToTenant
 *   - dualWriteUpsertScoped
 *   - GLOBAL_TABLES
 *
 * Phase 7.7b Commit 1 (2026-04-25):
 *   - tenantizeRows  (lenient stamping helper for transitional callers)
 *
 * These tests don't touch Supabase. The validation layer fires before
 * any I/O — that's the contract — so the assertions can be tested
 * standalone with `DUAL_WRITE` unset (the vitest default).
 */

import { describe, it, expect } from "vitest";
import {
  assertRowsScopedToTenant,
  dualWriteUpsertScoped,
  GLOBAL_TABLES,
  tenantizeRows,
} from "@/lib/persistence/dual-write";

const TENANT = "tenant-ritz-founder";
const OTHER = "tenant-other";

describe("Phase 7.7a — assertRowsScopedToTenant", () => {
  it("throws when tenantId is empty", () => {
    expect(() =>
      assertRowsScopedToTenant([{ tenant_id: TENANT }], "", "results"),
    ).toThrow(/tenantId must be a non-empty string/);
  });

  it("throws when a row.tenant_id doesn't match", () => {
    const rows = [{ tenant_id: TENANT }, { tenant_id: OTHER }];
    expect(() => assertRowsScopedToTenant(rows, TENANT, "results")).toThrow(
      /tenant mismatch/,
    );
  });

  it("error message includes both the bad and the expected tenant", () => {
    expect(() =>
      assertRowsScopedToTenant([{ tenant_id: OTHER }], TENANT, "results"),
    ).toThrow(/tenant-other.*tenant-ritz-founder/);
  });

  it("treats null tenant_id as a mismatch", () => {
    expect(() =>
      assertRowsScopedToTenant([{ tenant_id: null }], TENANT, "results"),
    ).toThrow(/tenant mismatch/);
  });

  it("treats undefined tenant_id as a mismatch", () => {
    expect(() =>
      assertRowsScopedToTenant([{}], TENANT, "results"),
    ).toThrow(/tenant mismatch/);
  });

  it("succeeds when every row matches", () => {
    expect(() =>
      assertRowsScopedToTenant(
        [{ tenant_id: TENANT }, { tenant_id: TENANT }],
        TENANT,
        "results",
      ),
    ).not.toThrow();
  });

  it("succeeds with an empty rows array", () => {
    expect(() =>
      assertRowsScopedToTenant([], TENANT, "results"),
    ).not.toThrow();
  });

  it("includes the context label in error messages", () => {
    expect(() =>
      assertRowsScopedToTenant([{ tenant_id: OTHER }], TENANT, "page_snapshots"),
    ).toThrow(/\[dual-write\/page_snapshots\]/);
  });
});

describe("Phase 7.7a — dualWriteUpsertScoped", () => {
  it("no-ops on empty rows array", async () => {
    await expect(
      dualWriteUpsertScoped("results", [], "id", TENANT),
    ).resolves.toBeUndefined();
  });

  it("throws when the table is in GLOBAL_TABLES", async () => {
    const rows = [{ tenant_id: TENANT, id: "x" }];
    await expect(
      dualWriteUpsertScoped("tenants", rows, "id", TENANT),
    ).rejects.toThrow(/is a global table/);
  });

  it("throws on global table even with empty tenantId — global-table check is first only when rows is non-empty", async () => {
    // Empty-rows fast-path: no validation, no throw. Documents the
    // contract so future refactors don't accidentally "fix" the empty
    // fast-path to throw on bad input.
    await expect(
      dualWriteUpsertScoped("tenants", [], "id", TENANT),
    ).resolves.toBeUndefined();
  });

  it("throws when row.tenant_id doesn't match tenantId", async () => {
    const rows = [{ tenant_id: OTHER, id: "r1" }];
    await expect(
      dualWriteUpsertScoped("results", rows, "id", TENANT),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("throws when tenantId is empty", async () => {
    const rows = [{ tenant_id: TENANT, id: "r1" }];
    await expect(
      dualWriteUpsertScoped("results", rows, "id", ""),
    ).rejects.toThrow(/tenantId must be a non-empty string/);
  });

  it("throws when row.tenant_id is missing", async () => {
    const rows = [{ id: "r1" }];
    await expect(
      dualWriteUpsertScoped("results", rows, "id", TENANT),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("succeeds (no-op via dualWriteUpsert) when valid and DUAL_WRITE is off", async () => {
    // DUAL_WRITE is unset in vitest env → dualWriteUpsert no-ops, silent success.
    const rows = [{ tenant_id: TENANT, id: "r1" }];
    await expect(
      dualWriteUpsertScoped("results", rows, "id", TENANT),
    ).resolves.toBeUndefined();
  });

  it("validates BEFORE attempting any I/O", async () => {
    // Even with the dual-write engine disabled, the helper is a
    // leak-prevention contract — it must throw on bad input rather than
    // silently swallow it.
    const rows = [{ tenant_id: OTHER, id: "r1" }];
    await expect(
      dualWriteUpsertScoped("results", rows, "id", TENANT),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("checks global-table membership before tenant validation", async () => {
    // Sanity: global tables fail with the global-table message even
    // when rows would otherwise fail tenant validation. Documents
    // ordering so the error message stays the same on real misuse.
    const rows = [{ tenant_id: OTHER, id: "x" }];
    await expect(
      dualWriteUpsertScoped("business_config", rows, "id", TENANT),
    ).rejects.toThrow(/is a global table/);
  });
});

describe("Phase 7.7a — GLOBAL_TABLES", () => {
  it("includes the tenants registry itself", () => {
    expect(GLOBAL_TABLES.has("tenants")).toBe(true);
  });

  it("includes single-row config tables", () => {
    expect(GLOBAL_TABLES.has("business_config")).toBe(true);
    expect(GLOBAL_TABLES.has("citation_evidence_index")).toBe(true);
    expect(GLOBAL_TABLES.has("answer_intelligence_index")).toBe(true);
  });

  it("includes operator-shared config tables", () => {
    expect(GLOBAL_TABLES.has("tracked_prompts")).toBe(true);
    expect(GLOBAL_TABLES.has("tracked_entities")).toBe(true);
    expect(GLOBAL_TABLES.has("answer_texts")).toBe(true);
  });

  it("includes global learning tables", () => {
    expect(GLOBAL_TABLES.has("change_patterns")).toBe(true);
    expect(GLOBAL_TABLES.has("triage_rules")).toBe(true);
    expect(GLOBAL_TABLES.has("confidence_calibration")).toBe(true);
  });

  it("does NOT include per-tenant data tables", () => {
    // Sanity — these MUST be tenant-scoped, not global.
    expect(GLOBAL_TABLES.has("results")).toBe(false);
    expect(GLOBAL_TABLES.has("page_snapshots")).toBe(false);
    expect(GLOBAL_TABLES.has("recommended_edits")).toBe(false);
    expect(GLOBAL_TABLES.has("page_element_inventory")).toBe(false);
    expect(GLOBAL_TABLES.has("changelog_entries")).toBe(false);
    expect(GLOBAL_TABLES.has("change_outcomes")).toBe(false);
    expect(GLOBAL_TABLES.has("recommendation_responses")).toBe(false);
    expect(GLOBAL_TABLES.has("guardrail_alerts")).toBe(false);
    expect(GLOBAL_TABLES.has("observation_runs")).toBe(false);
    expect(GLOBAL_TABLES.has("scan_findings")).toBe(false);
    expect(GLOBAL_TABLES.has("import_runs")).toBe(false);
    expect(GLOBAL_TABLES.has("pages")).toBe(false);
  });
});

describe("Phase 7.7b Commit 1 — tenantizeRows", () => {
  it("throws when tenantId is empty", () => {
    expect(() =>
      tenantizeRows([{ tenant_id: TENANT }], "", "results"),
    ).toThrow(/tenantId must be a non-empty string/);
  });

  it("error message for empty tenantId includes the context label", () => {
    expect(() =>
      tenantizeRows([{ tenant_id: TENANT }], "", "page_snapshots"),
    ).toThrow(/\[dual-write\/page_snapshots\]/);
  });

  it("stamps tenant_id when input row has empty string", () => {
    const result = tenantizeRows(
      [{ id: "r1", tenant_id: "" }],
      TENANT,
      "results",
    );
    expect(result).toEqual([{ id: "r1", tenant_id: TENANT }]);
  });

  it("stamps tenant_id when input row has null", () => {
    const result = tenantizeRows(
      [{ id: "r1", tenant_id: null }],
      TENANT,
      "results",
    );
    expect(result).toEqual([{ id: "r1", tenant_id: TENANT }]);
  });

  it("stamps tenant_id when input row has undefined (field absent)", () => {
    const result = tenantizeRows([{ id: "r1" }], TENANT, "results");
    expect(result).toEqual([{ id: "r1", tenant_id: TENANT }]);
  });

  it("preserves valid matching tenant_id (no-op stamp)", () => {
    const result = tenantizeRows(
      [{ id: "r1", tenant_id: TENANT }],
      TENANT,
      "results",
    );
    expect(result).toEqual([{ id: "r1", tenant_id: TENANT }]);
  });

  it("throws on non-empty mismatched tenant_id", () => {
    expect(() =>
      tenantizeRows(
        [{ id: "r1", tenant_id: OTHER }],
        TENANT,
        "results",
      ),
    ).toThrow(/tenant mismatch/);
  });

  it("error message on mismatch includes both bad and expected tenant", () => {
    expect(() =>
      tenantizeRows(
        [{ id: "r1", tenant_id: OTHER }],
        TENANT,
        "results",
      ),
    ).toThrow(/tenant-other.*tenant-ritz-founder/);
  });

  it("error message on mismatch includes the context label", () => {
    expect(() =>
      tenantizeRows(
        [{ id: "r1", tenant_id: OTHER }],
        TENANT,
        "scan_findings",
      ),
    ).toThrow(/\[dual-write\/scan_findings\]/);
  });

  it("does not mutate input rows", () => {
    const originalRow = { id: "r1", tenant_id: "" };
    const inputCopy = { ...originalRow };
    const inputArray = [originalRow];

    tenantizeRows(inputArray, TENANT, "results");

    // The original row reference is unchanged.
    expect(originalRow).toEqual(inputCopy);
    expect(originalRow.tenant_id).toBe("");
    // The input array is unchanged.
    expect(inputArray).toHaveLength(1);
    expect(inputArray[0]).toBe(originalRow);
  });

  it("returns a new array (not the same reference)", () => {
    const input = [{ id: "r1", tenant_id: TENANT }];
    const result = tenantizeRows(input, TENANT, "results");
    expect(result).not.toBe(input);
  });

  it("returns an empty array when input is empty (and validates tenantId still)", () => {
    expect(tenantizeRows([], TENANT, "results")).toEqual([]);
    // Empty input still requires a non-empty tenantId.
    expect(() => tenantizeRows([], "", "results")).toThrow(
      /tenantId must be a non-empty string/,
    );
  });

  it("handles a mix of empty and matching tenant_id values without throwing", () => {
    const result = tenantizeRows(
      [
        { id: "r1", tenant_id: "" },
        { id: "r2", tenant_id: TENANT },
        { id: "r3", tenant_id: null },
        { id: "r4" },
      ],
      TENANT,
      "results",
    );
    expect(result).toEqual([
      { id: "r1", tenant_id: TENANT },
      { id: "r2", tenant_id: TENANT },
      { id: "r3", tenant_id: TENANT },
      { id: "r4", tenant_id: TENANT },
    ]);
  });

  it("throws on the first mismatched row even when later rows are valid", () => {
    expect(() =>
      tenantizeRows(
        [
          { id: "r1", tenant_id: "" },
          { id: "r2", tenant_id: OTHER },
          { id: "r3", tenant_id: TENANT },
        ],
        TENANT,
        "results",
      ),
    ).toThrow(/tenant mismatch.*tenant-other/);
  });

  it("preserves all non-tenant_id fields", () => {
    const result = tenantizeRows(
      [
        {
          id: "r1",
          tenant_id: "",
          metric_value: 42,
          notes: "hello",
          nested: { a: 1, b: [2, 3] },
        },
      ],
      TENANT,
      "results",
    );
    expect(result[0]).toEqual({
      id: "r1",
      tenant_id: TENANT,
      metric_value: 42,
      notes: "hello",
      nested: { a: 1, b: [2, 3] },
    });
  });
});
