/**
 * audit-3 #5 (2026-06-22) — cron-sync must gate freshness POSITIVELY on the
 * engines' real success shape.
 *
 * Every read-sync engine returns `{ synced: false, reason } | { synced: true }`.
 * The prior `resultLooksFailed` checked `value.ok === false` — a key the
 * engines never emit — so a `{ synced: false }` failure passed the gate, got
 * `last_synced_at` stamped fresh, and was reported `ok: true`. The connector
 * card then claimed a pull that never happened.
 */
import { describe, expect, it } from "vitest";

import { syncSucceeded } from "@/lib/connectors/cron-sync";

describe("cron-sync syncSucceeded (audit-3 #5)", () => {
  it("treats { synced: true } as success", () => {
    expect(syncSucceeded({ synced: true, rows_upserted: 12 })).toEqual({ ok: true });
  });

  it("treats { synced: false } as failure and surfaces the reason", () => {
    const v = syncSucceeded({ synced: false, reason: "no_token" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_token");
  });

  it("regression: the old { ok: false } shape is NOT treated as success", () => {
    // Pre-fix this passed the gate (ok !== false reads as 'not failed').
    const v = syncSucceeded({ ok: false });
    expect(v.ok).toBe(false);
  });

  it("an unrecognized shape is NOT a success (don't stamp freshness we can't confirm)", () => {
    expect(syncSucceeded({}).ok).toBe(false);
    expect(syncSucceeded(null).ok).toBe(false);
    expect(syncSucceeded(undefined).ok).toBe(false);
    expect(syncSucceeded("synced").ok).toBe(false);
  });
});
