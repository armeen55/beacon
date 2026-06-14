/**
 * CRITICAL ISOLATION REGRESSION GUARD (2026-06-14).
 *
 * dualWriteTruncate + clearAllImportTables previously issued
 * `.delete().gte("id", "")` — an UNFILTERED delete that wiped EVERY
 * tenant's rows (a single tenant's "Reset import" deleted import_runs/
 * results/changelog_entries/opportunities/competitors/attribution_decisions/
 * candidate_links for all tenants). These tests pin that every truncate
 * delete is scoped to the caller's tenant via `.eq("tenant_id", …)` and
 * that an empty tenantId is refused (never an unscoped wipe).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Op = [string, ...unknown[]];
const fromCalls: Array<{ table: string; ops: Op[] }> = [];

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const rec = { table, ops: [] as Op[] };
      fromCalls.push(rec);
      const builder: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => {
        rec.ops.push([name, ...args]);
        return builder;
      };
      builder.delete = chain("delete");
      builder.eq = chain("eq");
      builder.gte = chain("gte");
      builder.insert = () => Promise.resolve({ error: null });
      // Thenable so `await sb.from(t).delete().eq(...)` resolves {error:null}.
      builder.then = (resolve: (x: { error: null }) => void) =>
        resolve({ error: null });
      return builder;
    },
  }),
}));

import {
  dualWriteTruncate,
  clearAllImportTables,
} from "@/lib/persistence/dual-write";

const TENANT = "tenant-iranopedia";

function deleteOpsFor(table: string): Op[] {
  const rec = fromCalls.find((c) => c.table === table);
  return rec ? rec.ops : [];
}

beforeEach(() => {
  fromCalls.length = 0;
  process.env.DUAL_WRITE = "true";
});

describe("dualWriteTruncate — tenant-scoped delete", () => {
  it("filters the delete by tenant_id (never an unfiltered wipe)", async () => {
    await dualWriteTruncate("results", TENANT);
    const ops = deleteOpsFor("results");
    expect(ops).toContainEqual(["delete"]);
    expect(ops).toContainEqual(["eq", "tenant_id", TENANT]);
    // The old catastrophic predicate must be gone.
    expect(ops).not.toContainEqual(["gte", "id", ""]);
  });

  it("REFUSES to truncate with an empty tenantId (no delete issued)", async () => {
    await dualWriteTruncate("results", "");
    expect(fromCalls).toHaveLength(0);
  });
});

describe("clearAllImportTables — every table scoped to the tenant", () => {
  const TABLES = [
    "import_runs",
    "results",
    "changelog_entries",
    "opportunities",
    "competitors",
    "attribution_decisions",
    "candidate_links",
  ];

  it("scopes the delete on all 7 import tables to the caller's tenant", async () => {
    await clearAllImportTables(TENANT);
    expect(fromCalls.map((c) => c.table).sort()).toEqual([...TABLES].sort());
    for (const t of TABLES) {
      expect(deleteOpsFor(t)).toContainEqual(["eq", "tenant_id", TENANT]);
    }
  });

  it("REFUSES with an empty tenantId (no table touched)", async () => {
    await clearAllImportTables("");
    expect(fromCalls).toHaveLength(0);
  });
});
