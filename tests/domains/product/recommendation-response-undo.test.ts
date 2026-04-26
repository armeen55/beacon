/**
 * Sprint 6A.1.16 (2026-04-25) — tests for the Undo deletion path.
 *
 * Covers:
 *   - Accept upserts (existing behavior preserved).
 *   - Defer upserts (existing behavior preserved).
 *   - Dismiss upserts AS dismissed (NOT deleted).
 *   - Undo (deleteResponseByRecId) removes the row from in-memory state
 *     AND issues an explicit Supabase DELETE.
 *   - Undo for an unknown recId still issues the Supabase DELETE
 *     defensively (covers cross-lambda case where the row exists in
 *     Supabase but not in this lambda's in-memory array).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recommendationResponses,
  recordResponse,
  persistResponses,
  deleteResponseByRecId,
} from "@/domains/product/recommendation-response-store";

const supabaseMocks = vi.hoisted(() => {
  const upsertMock = vi.fn(async (..._args: unknown[]) => ({ error: null }));
  const deleteMock = vi.fn((..._args: unknown[]) => ({ error: null }));
  // Phase 7.7c (2026-04-25): the delete chain is now multi-step:
  //   .from(table).delete().eq("rec_id", recId).eq("tenant_id", tenantId)
  // Build a chainable `.eq(...)` that records every call and resolves
  // to `{ error: null }` when awaited at the end.
  type EqChain = PromiseLike<{ error: null }> & {
    eq: (col: string, val: unknown) => EqChain;
  };
  const makeEqChain = (): EqChain => {
    const chain = {
      eq: (col: string, val: unknown): EqChain => {
        deleteMock(col, val);
        return makeEqChain();
      },
      then: <T>(
        onFulfilled?: (value: { error: null }) => T | PromiseLike<T>,
      ): Promise<T> => Promise.resolve({ error: null }).then(onFulfilled),
    };
    return chain as EqChain;
  };
  const fromMock = vi.fn((_table: string) => ({
    upsert: (rows: unknown, opts: unknown) => upsertMock(rows, opts),
    delete: () => ({
      eq: (col: string, val: unknown): EqChain => {
        deleteMock(col, val);
        return makeEqChain();
      },
    }),
  }));
  return {
    fromMock,
    upsertMock,
    deleteMock,
  };
});

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: supabaseMocks.fromMock,
  }),
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(() => []),
  writeStore: vi.fn(async () => undefined),
}));

describe("Sprint 6A.1.16 — recommendation-response Undo deletion path", () => {
  beforeEach(() => {
    process.env.DUAL_WRITE = "true";
    recommendationResponses.length = 0;
    supabaseMocks.fromMock.mockClear();
    supabaseMocks.upsertMock.mockClear();
    supabaseMocks.upsertMock.mockResolvedValue({ error: null });
    supabaseMocks.deleteMock.mockClear();
    supabaseMocks.deleteMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    delete process.env.DUAL_WRITE;
    vi.restoreAllMocks();
  });

  it("Accept upserts (legacy path preserved)", async () => {
    recordResponse("rec-accept-1", "accepted", { targetPageUrl: "/a" });
    await persistResponses("tenant-ritz-founder");
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("recommendation_responses");
    expect(supabaseMocks.upsertMock).toHaveBeenCalled();
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Defer upserts (legacy path preserved)", async () => {
    recordResponse("rec-defer-1", "deferred");
    await persistResponses("tenant-ritz-founder");
    expect(supabaseMocks.upsertMock).toHaveBeenCalled();
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Dismiss upserts AS dismissed (NOT deleted)", async () => {
    recordResponse("rec-dismiss-1", "dismissed");
    await persistResponses("tenant-ritz-founder");
    // Dismiss must persist as a row with status=dismissed so the rec
    // is suppressed on subsequent renders. Deleting the row would
    // make the rec re-appear in the queue.
    const stored = recommendationResponses.find(
      (r) => r.recId === "rec-dismiss-1",
    );
    expect(stored?.status).toBe("dismissed");
    expect(supabaseMocks.upsertMock).toHaveBeenCalled();
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Undo removes the row from in-memory state", async () => {
    recordResponse("rec-undo-1", "accepted");
    expect(
      recommendationResponses.find((r) => r.recId === "rec-undo-1"),
    ).toBeDefined();
    const removed = await deleteResponseByRecId("rec-undo-1", "tenant-ritz-founder");
    expect(removed).toBe(true);
    expect(
      recommendationResponses.find((r) => r.recId === "rec-undo-1"),
    ).toBeUndefined();
  });

  it("Undo issues an explicit Supabase DELETE filtered by BOTH rec_id and tenant_id", async () => {
    // Phase 7.7c (2026-04-25): the delete chain must carry both filters
    // so cross-tenant rec_id collisions never let one tenant's Undo
    // wipe another tenant's response.
    recordResponse("rec-undo-2", "accepted");
    supabaseMocks.deleteMock.mockClear();
    await deleteResponseByRecId("rec-undo-2", "tenant-ritz-founder");
    expect(supabaseMocks.deleteMock).toHaveBeenCalled();
    // The from() call before the delete chain targets the right table.
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith(
      "recommendation_responses",
    );
    // First .eq carries the rec_id.
    const recIdCall = supabaseMocks.deleteMock.mock.calls.find(
      (call) => call[0] === "rec_id" && call[1] === "rec-undo-2",
    );
    expect(recIdCall).toBeDefined();
    // Second .eq carries the tenant_id.
    const tenantCall = supabaseMocks.deleteMock.mock.calls.find(
      (call) => call[0] === "tenant_id" && call[1] === "tenant-ritz-founder",
    );
    expect(tenantCall).toBeDefined();
  });

  it("Undo with tenant A does not delete the same rec_id under tenant B", async () => {
    // Cross-tenant isolation invariant. The Supabase delete must filter
    // by tenant_id; if a future regression drops that filter, the
    // assertion below fails because the call would not include the
    // tenant_id eq.
    supabaseMocks.deleteMock.mockClear();
    await deleteResponseByRecId("rec-collision", "tenant-A");
    // The collision-prone rec_id is the same; the tenant_id filter is
    // the only thing that prevents the delete from reaching tenant B.
    const tenantBCall = supabaseMocks.deleteMock.mock.calls.find(
      (call) => call[0] === "tenant_id" && call[1] === "tenant-B",
    );
    expect(tenantBCall).toBeUndefined();
    const tenantACall = supabaseMocks.deleteMock.mock.calls.find(
      (call) => call[0] === "tenant_id" && call[1] === "tenant-A",
    );
    expect(tenantACall).toBeDefined();
  });

  it("Undo issues Supabase DELETE even when the recId isn't in this lambda's in-memory array", async () => {
    // Cross-lambda case: another lambda wrote the row to Supabase but
    // this lambda's in-memory cache doesn't know about it. Undo must
    // still attempt the delete so the row doesn't outlive the
    // operator's intent.
    expect(
      recommendationResponses.find((r) => r.recId === "rec-other-lambda"),
    ).toBeUndefined();
    const removed = await deleteResponseByRecId(
      "rec-other-lambda",
      "tenant-ritz-founder",
    );
    expect(removed).toBe(false);
    expect(supabaseMocks.deleteMock).toHaveBeenCalled();
  });

  it("Undo is a no-op against Supabase when DUAL_WRITE is off", async () => {
    delete process.env.DUAL_WRITE;
    recordResponse("rec-no-dualwrite", "accepted");
    supabaseMocks.deleteMock.mockClear();
    await deleteResponseByRecId("rec-no-dualwrite", "tenant-ritz-founder");
    // In-memory removal still happens.
    expect(
      recommendationResponses.find((r) => r.recId === "rec-no-dualwrite"),
    ).toBeUndefined();
    // But Supabase delete was NOT called (dual-write gate).
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Undo throws when tenantId is empty (fail-loud guard)", async () => {
    // Phase 7.7c (2026-04-25): empty tenantId is a misuse — refuse to
    // run an unscoped delete. Note: the throw fires inside
    // deleteRecommendationResponseByRecId, AFTER the in-memory splice +
    // writeStore have already happened. That asymmetry is by design —
    // see the helper docstring's "best-effort" posture.
    recordResponse("rec-empty-tenant", "accepted");
    await expect(
      deleteResponseByRecId("rec-empty-tenant", ""),
    ).rejects.toThrow(/tenantId must be a non-empty string/);
  });
});
