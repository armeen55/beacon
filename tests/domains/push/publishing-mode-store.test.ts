/**
 * Armed publishing — durable per-site mode store (2026-06-16).
 *
 * Pins the SAFETY-CRITICAL posture:
 *   • default (no record) → `staged` (the safe, review-gated default),
 *   • arm → get round-trips through Supabase (armed + armed_at stamped),
 *   • disarm clears it (back to staged, armed_at null),
 *   • TENANT ISOLATION (arming tenant A never arms tenant B),
 *   • FILE FALLBACK when Supabase env is absent OR the table isn't migrated
 *     (42P01) — local dev + the pre-apply window keep working,
 *   • FAIL-SAFE: an unexpected read error resolves to `staged`, NEVER armed.
 *
 * A fake in-memory Supabase admin (supporting .select().eq().maybeSingle() +
 * .upsert()) simulates real per-tenant persistence, mirroring the
 * mappings-store test posture.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "no_env" | "no_table" | "read_error",
  rows: [] as Array<Record<string, unknown>>,
  tenant: "tenant-default",
  files: new Map<string, unknown[]>(),
}));

const undef = { code: "42P01", message: "undefined_table" };
const otherErr = { code: "57014", message: "statement timeout" };

function fakeAdmin() {
  return {
    from(_table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: unknown) {
              return {
                maybeSingle: async () => {
                  if (mockState.mode === "no_table") return { data: null, error: undef };
                  if (mockState.mode === "read_error") return { data: null, error: otherErr };
                  const row = mockState.rows.find((r) => r[col] === val) ?? null;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        upsert(row: Record<string, unknown>, opts?: { onConflict?: string }) {
          if (mockState.mode === "no_table") return Promise.resolve({ error: undef });
          const key = opts?.onConflict ?? "tenant_id";
          const idx = mockState.rows.findIndex((r) => r[key] === row[key]);
          if (idx >= 0) mockState.rows[idx] = { ...row };
          else mockState.rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (mockState.mode === "no_env") throw new Error("no supabase env");
    return fakeAdmin();
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => mockState.tenant,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => mockState.files.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    mockState.files.set(name, data);
  },
}));

import {
  getPublishingMode,
  setPublishingMode,
} from "@/domains/push/publishing-mode-store";

beforeEach(() => {
  mockState.mode = "ok";
  mockState.rows = [];
  mockState.tenant = "tenant-default";
  mockState.files = new Map();
});

describe("publishing-mode-store — durable per-site mode", () => {
  it("default (no record) → staged", async () => {
    const s = await getPublishingMode();
    expect(s.mode).toBe("staged");
    expect(s.armedAt).toBeNull();
  });

  it("arm → get round-trips through Supabase (armed + armed_at stamped)", async () => {
    mockState.tenant = "tenant-a";
    const set = await setPublishingMode({ mode: "armed", armedBy: "u1", now: new Date("2026-06-16T12:00:00Z") });
    expect(set.mode).toBe("armed");
    expect(set.armedAt).toBe("2026-06-16T12:00:00.000Z");
    const got = await getPublishingMode();
    expect(got.mode).toBe("armed");
    expect(got.armedBy).toBe("u1");
  });

  it("disarm clears it (staged, armed_at null)", async () => {
    mockState.tenant = "tenant-a";
    await setPublishingMode({ mode: "armed" });
    const dis = await setPublishingMode({ mode: "staged" });
    expect(dis.mode).toBe("staged");
    expect(dis.armedAt).toBeNull();
    expect((await getPublishingMode()).mode).toBe("staged");
  });

  it("TENANT ISOLATION — arming tenant A never arms tenant B", async () => {
    mockState.tenant = "tenant-a";
    await setPublishingMode({ mode: "armed" });
    mockState.tenant = "tenant-b";
    expect((await getPublishingMode()).mode).toBe("staged");
  });

  it("FILE FALLBACK (no Supabase env) round-trips via the file store", async () => {
    mockState.mode = "no_env";
    await setPublishingMode({ mode: "armed" });
    expect((await getPublishingMode()).mode).toBe("armed");
  });

  it("FILE FALLBACK (table not migrated, 42P01) round-trips via the file store", async () => {
    mockState.mode = "no_table";
    await setPublishingMode({ mode: "armed" });
    expect((await getPublishingMode()).mode).toBe("armed");
  });

  it("FAIL-SAFE — an unexpected read error resolves to staged, never armed", async () => {
    mockState.mode = "read_error";
    expect((await getPublishingMode()).mode).toBe("staged");
  });
});
