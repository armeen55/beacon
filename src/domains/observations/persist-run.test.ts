/**
 * 2026-07-02 D1 ground-truth fix - pins appendObservationRunSync's Supabase
 * upsert payload for observation_runs.
 *
 * Root cause: observation_runs has a NOT NULL check
 * (observation_runs_tenant_id_nonempty_chk). ObservationRun.tenant_id is
 * required and every caller populates it, but upsertObservationRunToDb built
 * its Supabase payload with an explicit column list that never included
 * tenant_id, so every dual-write upsert violated the constraint and failed -
 * caught and logged as "non-fatal", which made the failure silent. This test
 * pins that the field is now carried through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ObservationRun } from "./types";

const upsertMock = vi.fn(async (_payload: Record<string, unknown>, _opts?: unknown) => ({ error: null }));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({ upsert: upsertMock }),
  }),
}));

describe("appendObservationRunSync - observation_runs tenant_id", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    process.env.VERCEL = "1"; // skip the local FS write path entirely
    process.env.DUAL_WRITE = "true";
  });

  const RUN: ObservationRun = {
    run_id: "aiengines-chatgpt-2026-07-02-tenant-iranopedia",
    run_type: "citation_sample_import",
    source: "ai-engines-openai",
    status: "completed",
    started_at: "2026-07-02T09:00:00Z",
    completed_at: "2026-07-02T09:01:00Z",
    scope_label: "ai engines nightly chatgpt - 5/5 questions",
    pages_scanned: 0,
    pages_changed: 0,
    pages_with_errors: 0,
    guardrail_alerts: 0,
    critical_count: 0,
    regression_count: 0,
    improvement_count: 0,
    tenant_id: "tenant-iranopedia",
  };

  it("carries tenant_id through to the Supabase upsert payload", async () => {
    const { appendObservationRunSync } = await import("./persist-run");
    appendObservationRunSync(RUN);
    // The dual-write upsert is fired-and-forgotten (not awaited by the
    // caller); flush microtasks so the .catch handler chain resolves.
    await new Promise((r) => setTimeout(r, 0));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0];
    expect(payload.tenant_id).toBe("tenant-iranopedia");
    expect(payload.run_id).toBe(RUN.run_id);
  });

  it("carries the exact tenant_id for a different tenant (no cross-tenant bleed)", async () => {
    const { appendObservationRunSync } = await import("./persist-run");
    appendObservationRunSync({ ...RUN, run_id: "aiengines-chatgpt-2026-07-02-tenant-ritz-founder", tenant_id: "tenant-ritz-founder" });
    await new Promise((r) => setTimeout(r, 0));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0];
    expect(payload.tenant_id).toBe("tenant-ritz-founder");
  });
});
