/**
 * autonomous-run-claim.test.ts
 *
 * Pins the cross-instance atomic lock for the on-visit autonomous cycle:
 *   - a fresh INSERT wins ("claimed"),
 *   - a duplicate primary key loses on the unique-violation ("already-claimed"),
 *   - no Supabase / missing table / transport error falls back ("unavailable"),
 *   - and the release-then-reclaim lifecycle that keeps a FAILED run retryable
 *     while a concurrent duplicate is impossible while a row exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getSupabaseAdminMock = vi.fn();
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => getSupabaseAdminMock(),
}));

import { claimAutonomousRun, releaseAutonomousRun } from "./autonomous-run-claim";

const T = "tenant-iranopedia";
const DAY = "2026-07-18";

/** A minimal in-memory stand-in for the service-role admin client that models
 * the (tenant_id, day_key) primary key: INSERT of an existing key returns 23505,
 * DELETE removes the key. Enough to exercise the whole claim/release lifecycle. */
function makeAdmin(rows = new Set<string>()) {
  const key = (t: unknown, d: unknown) => `${t}|${d}`;
  return {
    rows,
    from() {
      return {
        insert(row: { tenant_id: string; day_key: string }) {
          const k = key(row.tenant_id, row.day_key);
          if (rows.has(k)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key value" } });
          }
          rows.add(k);
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            then(resolve: (v: { error: null }) => unknown) {
              rows.delete(key(filters.tenant_id, filters.day_key));
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  };
}

/** An admin whose insert always returns a given error object. */
function makeErroringAdmin(error: unknown) {
  return {
    from() {
      return { insert: () => Promise.resolve({ error }) };
    },
  };
}

beforeEach(() => {
  getSupabaseAdminMock.mockReset();
});

describe("claimAutonomousRun", () => {
  it("claims a fresh (tenant, day) with an atomic insert", async () => {
    getSupabaseAdminMock.mockReturnValue(makeAdmin());
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
  });

  it("loses the race on a duplicate key (concurrent instance already owns today)", async () => {
    const admin = makeAdmin();
    getSupabaseAdminMock.mockReturnValue(admin);
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
    // A second instance inserting the same key hits the unique violation.
    expect(await claimAutonomousRun(T, DAY)).toBe("already-claimed");
  });

  it("falls back to unavailable when Supabase is not configured", async () => {
    getSupabaseAdminMock.mockImplementation(() => {
      throw new Error("Missing required environment variable");
    });
    expect(await claimAutonomousRun(T, DAY)).toBe("unavailable");
  });

  it("falls back to unavailable when the table is not migrated in yet (PGRST205)", async () => {
    getSupabaseAdminMock.mockReturnValue(makeErroringAdmin({ code: "PGRST205", message: "Could not find the table" }));
    expect(await claimAutonomousRun(T, DAY)).toBe("unavailable");
  });

  it("falls back to unavailable on a transport error", async () => {
    getSupabaseAdminMock.mockReturnValue(makeErroringAdmin({ message: "net::ERR_FAILED" }));
    expect(await claimAutonomousRun(T, DAY)).toBe("unavailable");
  });

  it("returns unavailable for empty inputs without touching the client", async () => {
    getSupabaseAdminMock.mockImplementation(() => {
      throw new Error("should not be called");
    });
    expect(await claimAutonomousRun("", DAY)).toBe("unavailable");
    expect(await claimAutonomousRun(T, "")).toBe("unavailable");
  });
});

describe("release/retry lifecycle", () => {
  it("a released claim can be re-claimed, so a failed run retries while a duplicate cannot double-run", async () => {
    const rows = new Set<string>();
    const admin = makeAdmin(rows);
    getSupabaseAdminMock.mockReturnValue(admin);

    // First instance wins the day.
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
    // Any concurrent instance is locked out WHILE the row exists.
    expect(await claimAutonomousRun(T, DAY)).toBe("already-claimed");

    // The owner's run FAILED, so it releases the lock in its finally.
    await releaseAutonomousRun(T, DAY);
    expect(rows.size).toBe(0);

    // A later visit can now re-own the day and retry (the receipt cooldown, not
    // this row, is what decides whether research actually re-runs).
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
  });

  it("release never throws when Supabase is unavailable", async () => {
    getSupabaseAdminMock.mockImplementation(() => {
      throw new Error("no env");
    });
    await expect(releaseAutonomousRun(T, DAY)).resolves.toBeUndefined();
  });
});
