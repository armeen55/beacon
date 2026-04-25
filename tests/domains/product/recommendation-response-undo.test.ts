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
  const upsertMock = vi.fn(async () => ({ error: null }));
  const deleteMock = vi.fn(async () => ({ error: null }));
  const eqMock = vi.fn(() => ({ then: deleteMock, ...deleteMock() }));
  // Build a minimal `from(table)` chain that the dual-write helpers use.
  const fromMock = vi.fn((table: string) => ({
    upsert: (rows: unknown, opts: unknown) => upsertMock(rows, opts),
    delete: () => ({
      eq: (col: string, val: unknown) => {
        const result = deleteMock(col, val);
        // Return a Promise-like for `await` chains.
        return Promise.resolve(result);
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
    await persistResponses();
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("recommendation_responses");
    expect(supabaseMocks.upsertMock).toHaveBeenCalled();
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Defer upserts (legacy path preserved)", async () => {
    recordResponse("rec-defer-1", "deferred");
    await persistResponses();
    expect(supabaseMocks.upsertMock).toHaveBeenCalled();
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });

  it("Dismiss upserts AS dismissed (NOT deleted)", async () => {
    recordResponse("rec-dismiss-1", "dismissed");
    await persistResponses();
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
    const removed = await deleteResponseByRecId("rec-undo-1");
    expect(removed).toBe(true);
    expect(
      recommendationResponses.find((r) => r.recId === "rec-undo-1"),
    ).toBeUndefined();
  });

  it("Undo issues an explicit Supabase DELETE for the rec_id", async () => {
    recordResponse("rec-undo-2", "accepted");
    supabaseMocks.deleteMock.mockClear();
    await deleteResponseByRecId("rec-undo-2");
    expect(supabaseMocks.deleteMock).toHaveBeenCalled();
    // The from() call before the delete chain targets the right table.
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith(
      "recommendation_responses",
    );
    // The delete().eq() call carries the recId.
    const deleteCall = supabaseMocks.deleteMock.mock.calls.find(
      (call) => call[0] === "rec_id" && call[1] === "rec-undo-2",
    );
    expect(deleteCall).toBeDefined();
  });

  it("Undo issues Supabase DELETE even when the recId isn't in this lambda's in-memory array", async () => {
    // Cross-lambda case: another lambda wrote the row to Supabase but
    // this lambda's in-memory cache doesn't know about it. Undo must
    // still attempt the delete so the row doesn't outlive the
    // operator's intent.
    expect(
      recommendationResponses.find((r) => r.recId === "rec-other-lambda"),
    ).toBeUndefined();
    const removed = await deleteResponseByRecId("rec-other-lambda");
    expect(removed).toBe(false);
    expect(supabaseMocks.deleteMock).toHaveBeenCalled();
  });

  it("Undo is a no-op against Supabase when DUAL_WRITE is off", async () => {
    delete process.env.DUAL_WRITE;
    recordResponse("rec-no-dualwrite", "accepted");
    supabaseMocks.deleteMock.mockClear();
    await deleteResponseByRecId("rec-no-dualwrite");
    // In-memory removal still happens.
    expect(
      recommendationResponses.find((r) => r.recId === "rec-no-dualwrite"),
    ).toBeUndefined();
    // But Supabase delete was NOT called (dual-write gate).
    expect(supabaseMocks.deleteMock).not.toHaveBeenCalled();
  });
});
