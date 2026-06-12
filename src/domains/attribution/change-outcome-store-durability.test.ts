/**
 * change-outcome-store durability — Supabase dual-write + hosted hydration.
 *
 * The Proof Engine's outcomes were local-json-store only: skipped on Vercel,
 * ephemeral on the cron runner, never dual-written, readStore never hydrates
 * from Supabase — so the hosted web app read EMPTY. These pins lock the fix:
 *   • DUAL_WRITE on  → persist dual-writes a correctly-shaped change_outcomes_v2
 *     row (composite id, full outcome blob); load hydrates from Supabase when
 *     the local store is empty (the hosted case).
 *   • DUAL_WRITE off → no Supabase calls at all (tests + local dev stay on disk).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let localData: unknown[] = [];
const writeStoreSpy = vi.fn(async (_name: string, data: unknown[]) => {
  localData = data;
});
vi.mock("@/lib/persistence/json-store", () => ({
  writeStore: (name: string, data: unknown[]) => writeStoreSpy(name, data),
  readStore: async () => localData,
}));

let dualWriteEnabled = false;
const dualWriteUpsertSpy = vi.fn(
  async (
    _table: string,
    _rows: Array<Record<string, unknown>>,
    _key: string,
  ) => {},
);
vi.mock("@/lib/persistence/dual-write", () => ({
  isDualWriteEnabled: () => dualWriteEnabled,
  dualWriteUpsert: (
    table: string,
    rows: Array<Record<string, unknown>>,
    key: string,
  ) => dualWriteUpsertSpy(table, rows, key),
}));

let supabaseRows: { outcome: unknown }[] = [];
const eqSpy = vi.fn(async () => ({ data: supabaseRows, error: null }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: eqSpy }) }),
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));

import {
  persistChangeOutcomes,
  loadAllChangeOutcomes,
} from "./change-outcome-store";
import type { StoredChangeOutcome } from "./change-outcome-store";

function computed(source_id: string, lift = 2): StoredChangeOutcome {
  return {
    source_id,
    classifier_version: "test",
    stored_at: "2026-05-30T00:00:00.000Z",
    taxonomy_layer: "change",
    primary_bucket: "content.faq.add",
    child_tags: [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: `/p/${source_id}`,
    url_type: "service",
    treatment_date: "2026-05-15",
    pre_window: { start: "2026-05-01", end: "2026-05-14" },
    post_window: { start: "2026-05-16", end: "2026-05-29" },
    status: "computed",
    confidence: "high",
    warnings: [],
    rationale: "test",
    computed: {
      kind: "computed",
      overall: {
        platform: "all",
        treated_pre_avg: 1,
        treated_post_avg: 1 + lift,
        control_pre_avg: 1,
        control_post_avg: 1,
        treated_delta: lift,
        control_delta: 0,
        adjusted_lift: lift,
        relative_lift: 0.5,
        controls_used: 3,
        pre_days_observed: 14,
        post_days_observed: 14,
      },
      per_platform: [],
    },
    raw: null,
    matched_control_count: 3,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-05-30T00:00:00.000Z",
  };
}

const ORIG_DATA_SOURCE = process.env.DATA_SOURCE;

beforeEach(() => {
  localData = [];
  supabaseRows = [];
  dualWriteEnabled = false;
  // Read-hydration gates on DATA_SOURCE === "supabase" (the READ condition,
  // mirroring getRepository — NOT DUAL_WRITE). Default to file mode so tests
  // stay on the local path unless a case opts into Supabase reads.
  delete process.env.DATA_SOURCE;
  writeStoreSpy.mockClear();
  dualWriteUpsertSpy.mockClear();
  eqSpy.mockClear();
});

afterEach(() => {
  if (ORIG_DATA_SOURCE === undefined) delete process.env.DATA_SOURCE;
  else process.env.DATA_SOURCE = ORIG_DATA_SOURCE;
});

describe("persistChangeOutcomes — Supabase dual-write", () => {
  it("DUAL_WRITE off → writes local only, NO Supabase call", async () => {
    await persistChangeOutcomes([computed("a")]);
    expect(writeStoreSpy).toHaveBeenCalledOnce();
    expect(dualWriteUpsertSpy).not.toHaveBeenCalled();
  });

  it("DUAL_WRITE on → dual-writes a correctly-shaped change_outcomes_v2 row", async () => {
    dualWriteEnabled = true;
    await persistChangeOutcomes([computed("rec-1")]);
    expect(dualWriteUpsertSpy).toHaveBeenCalledOnce();
    const [table, rows, key] = dualWriteUpsertSpy.mock.calls[0]!;
    expect(table).toBe("change_outcomes_v2");
    expect(key).toBe("id");
    const row = rows[0]!;
    expect(row.id).toBe("tenant-test::rec-1");
    expect(row.tenant_id).toBe("tenant-test");
    expect(row.source_id).toBe("rec-1");
    expect(row.status).toBe("computed");
    expect(row.primary_bucket).toBe("content.faq.add");
    // The full StoredChangeOutcome is preserved in the JSONB blob.
    expect((row.outcome as StoredChangeOutcome).computed?.overall?.adjusted_lift).toBe(2);
  });

  it("a Supabase sync failure never throws (local write already landed)", async () => {
    dualWriteEnabled = true;
    dualWriteUpsertSpy.mockRejectedValueOnce(new Error("supabase down"));
    await expect(persistChangeOutcomes([computed("a")])).resolves.toBeUndefined();
    expect(writeStoreSpy).toHaveBeenCalledOnce();
  });
});

describe("loadAllChangeOutcomes — hosted hydration", () => {
  it("returns local when the local store is non-empty (no Supabase read, even in supabase mode)", async () => {
    process.env.DATA_SOURCE = "supabase";
    localData = [computed("local-1")];
    const out = await loadAllChangeOutcomes();
    expect(out).toHaveLength(1);
    expect(out[0]!.source_id).toBe("local-1");
    expect(eqSpy).not.toHaveBeenCalled();
  });

  it("hydrates from Supabase when local is empty and DATA_SOURCE is supabase (the hosted web app)", async () => {
    process.env.DATA_SOURCE = "supabase";
    localData = [];
    supabaseRows = [{ outcome: computed("db-1") }, { outcome: computed("db-2") }];
    const out = await loadAllChangeOutcomes();
    expect(eqSpy).toHaveBeenCalledOnce();
    expect(out.map((o) => o.source_id).sort()).toEqual(["db-1", "db-2"]);
  });

  it("local empty + DATA_SOURCE is file mode → empty, never consults Supabase", async () => {
    // beforeEach deletes DATA_SOURCE (file mode).
    localData = [];
    const out = await loadAllChangeOutcomes();
    expect(out).toEqual([]);
    expect(eqSpy).not.toHaveBeenCalled();
  });
});
