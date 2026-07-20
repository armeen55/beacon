import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * confirmation-reads-store (Lane P2, protocol 4.2). Pins the append-only,
 * idempotent-upsert contract on the file mirror (the path a pre-migration /
 * no-Supabase-env window uses): same key written twice = ONE row, first result
 * wins, never an update. Plus the registration pin that makes the store real.
 *
 * getSupabaseAdmin is mocked to THROW so every call deterministically exercises
 * the file mirror (readStore/writeStore mocked in-memory), independent of env.
 */

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => stored),
  writeStore: vi.fn(async (_name: string, data: unknown[]) => {
    stored = data;
  }),
}));

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("no supabase env in test -> file mirror");
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordConfirmationRead,
  loadConfirmationReads,
  buildConfirmationReadRow,
  __testing,
} from "./confirmation-reads-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import { readStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

beforeEach(() => {
  stored = [];
});

describe("registration pin", () => {
  it("confirmation-reads is a registered (GLOBAL) store so readStore/writeStore never throw", () => {
    expect(classifyStore("confirmation-reads")).toBe("global");
  });
});

describe("buildConfirmationReadRow (pure)", () => {
  it("maps the input to the snake_case row and defaults read_at to now", () => {
    const row = buildConfirmationReadRow(
      {
        tenantId: "t",
        proofId: "p1",
        windowDays: 28,
        computationVersion: "c4@v1",
        result: { verdict: "won" },
      },
      new Date("2026-07-13T00:00:00.000Z"),
    );
    expect(row).toEqual({
      tenant_id: "t",
      proof_id: "p1",
      window_days: 28,
      computation_version: "c4@v1",
      read_at: "2026-07-13T00:00:00.000Z",
      result: { verdict: "won" },
    });
  });

  it("honors an explicit readAt", () => {
    const row = buildConfirmationReadRow({
      tenantId: "t",
      proofId: "p1",
      windowDays: 7,
      computationVersion: "c4@v1",
      result: {},
      readAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.read_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("recordConfirmationRead - append-only + idempotent (first result wins)", () => {
  it("records one read and reads it back for the tenant", async () => {
    await recordConfirmationRead({
      tenantId: "t",
      proofId: "p1",
      windowDays: 28,
      computationVersion: "c4@v1",
      result: { verdict: "won" },
    });
    const rows = await loadConfirmationReads("t");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proofId).toBe("p1");
    expect(rows[0]!.windowDays).toBe(28);
    expect(rows[0]!.result).toEqual({ verdict: "won" });
  });

  it("PROPERTY: the same key upserted twice yields ONE row and the FIRST result wins", async () => {
    const key = { tenantId: "t", proofId: "p1", windowDays: 28, computationVersion: "c4@v1" };
    await recordConfirmationRead({ ...key, result: { verdict: "won", n: 1 } });
    // A retry under the same key with a DIFFERENT payload must NOT overwrite.
    await recordConfirmationRead({ ...key, result: { verdict: "lost", n: 2 } });
    const rows = await loadConfirmationReads("t", { proofId: "p1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toEqual({ verdict: "won", n: 1 });
  });

  it("PROPERTY: re-recording an identical write is a no-op (still one row)", async () => {
    const input = {
      tenantId: "t",
      proofId: "p1",
      windowDays: 56,
      computationVersion: "c4@v1",
      result: { held: true },
      readAt: "2026-07-13T00:00:00.000Z",
    };
    await recordConfirmationRead(input);
    await recordConfirmationRead(input);
    await recordConfirmationRead(input);
    expect(await loadConfirmationReads("t")).toHaveLength(1);
  });

  it("distinct window_days, computation_version, proof_id, or tenant are SEPARATE rows", async () => {
    const base = { tenantId: "t", proofId: "p1", computationVersion: "c4@v1", result: {} };
    await recordConfirmationRead({ ...base, windowDays: 7 });
    await recordConfirmationRead({ ...base, windowDays: 28 }); // different window
    await recordConfirmationRead({ ...base, windowDays: 28, computationVersion: "c4@v2" }); // different version
    await recordConfirmationRead({ ...base, windowDays: 28, proofId: "p2" }); // different proof
    await recordConfirmationRead({ ...base, windowDays: 28, tenantId: "t2" }); // different tenant

    expect(await loadConfirmationReads("t")).toHaveLength(4);
    expect(await loadConfirmationReads("t2")).toHaveLength(1);
  });
});

describe("loadConfirmationReads - filtering", () => {
  it("filters by tenant and optionally by proof", async () => {
    await recordConfirmationRead({ tenantId: "t", proofId: "p1", windowDays: 28, computationVersion: "v", result: {} });
    await recordConfirmationRead({ tenantId: "t", proofId: "p2", windowDays: 28, computationVersion: "v", result: {} });
    await recordConfirmationRead({ tenantId: "other", proofId: "p1", windowDays: 28, computationVersion: "v", result: {} });

    expect(await loadConfirmationReads("t")).toHaveLength(2);
    expect(await loadConfirmationReads("t", { proofId: "p1" })).toHaveLength(1);
    expect(await loadConfirmationReads("")).toHaveLength(0);
  });
});

describe("readFile failure", () => {
  it("a file read failure returns [] AND logs (never a silent empty ledger)", async () => {
    vi.mocked(readStore).mockRejectedValueOnce(new Error("file read failed"));
    vi.mocked(log.warn).mockClear();
    // getSupabaseAdmin throws in this suite, so loadConfirmationReads takes the
    // file-mirror path -> readFile(), which now logs on failure.
    const rows = await loadConfirmationReads("t");
    expect(rows).toEqual([]);
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![0]).toContain("confirmation-reads-store");
  });
});

describe("__testing.samePk", () => {
  it("is true only when all four key parts match", () => {
    const a = { tenant_id: "t", proof_id: "p", window_days: 28, computation_version: "v", read_at: "", result: {} };
    expect(__testing.samePk(a, { ...a })).toBe(true);
    expect(__testing.samePk(a, { ...a, window_days: 56 })).toBe(false);
    expect(__testing.samePk(a, { ...a, computation_version: "v2" })).toBe(false);
    expect(__testing.samePk(a, { ...a, proof_id: "p2" })).toBe(false);
    expect(__testing.samePk(a, { ...a, tenant_id: "t2" })).toBe(false);
  });
});
