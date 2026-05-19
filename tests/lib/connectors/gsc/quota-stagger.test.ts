/**
 * 2026-05-18 — Section 8 J3 — `staggerSlotHour` + `isStaggerSlotActive`
 * + `backoffDelayMs` unit tests.
 *
 * Pure-function coverage:
 *   • Deterministic hash per tenant_id (same input → same slot)
 *   • Slot bounds ⊂ {0, 4, 8, 12, 16, 20}
 *   • Bucket coverage across the 6 slots over a diverse tenant_id set
 *   • is-in-slot truth table around the 4-hour window boundary
 *   • Empty / non-string tenant_id → slot 0
 *   • Exp-backoff schedule for retry attempts 1..N + above-cap
 */

import { describe, it, expect } from "vitest";

import {
  staggerSlotHour,
  isStaggerSlotActive,
  backoffDelayMs,
  STAGGER_BUCKETS,
  STAGGER_WINDOW_HOURS,
  MAX_RETRIES_ON_429,
} from "@/lib/connectors/gsc/quota-stagger";

// ─────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────

describe("staggerSlotHour — deterministic per tenant_id", () => {
  it("returns the same slot across repeated invocations", () => {
    const t1 = staggerSlotHour("tenant-ritz-founder");
    const t2 = staggerSlotHour("tenant-ritz-founder");
    const t3 = staggerSlotHour("tenant-ritz-founder");
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it("returns different slots for different tenant_ids (most of the time)", () => {
    // Not a guarantee, but a sanity check that the hash isn't a
    // degenerate constant. Across 20 distinct tenant_ids we expect
    // at least 4 distinct slot values out of the 6 possible.
    const tenants = Array.from({ length: 20 }, (_, i) => `tenant-fixture-${i}`);
    const slots = new Set(tenants.map(staggerSlotHour));
    expect(slots.size).toBeGreaterThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Slot bounds
// ─────────────────────────────────────────────────────────────────────

describe("staggerSlotHour — slot bounds", () => {
  it("returns one of {0, 4, 8, 12, 16, 20}", () => {
    const tenants = [
      "tenant-a",
      "tenant-b",
      "tenant-ritz-founder",
      "tenant-customer-2",
      "tenant-test-fixture",
      "tenant-very-long-id-with-lots-of-bytes",
      "a",
      "z",
    ];
    const allowed = new Set([0, 4, 8, 12, 16, 20]);
    for (const t of tenants) {
      const slot = staggerSlotHour(t);
      expect(allowed.has(slot)).toBe(true);
    }
  });

  it("uses the locked 6-bucket / 4-hour window constants", () => {
    expect(STAGGER_BUCKETS).toBe(6);
    expect(STAGGER_WINDOW_HOURS).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────

describe("staggerSlotHour — edge cases", () => {
  it("returns slot 0 for empty string", () => {
    expect(staggerSlotHour("")).toBe(0);
  });

  it("returns slot 0 for non-string input (defensive)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(staggerSlotHour(null as any)).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(staggerSlotHour(undefined as any)).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(staggerSlotHour(123 as any)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// is-in-slot — boundary truth table
// ─────────────────────────────────────────────────────────────────────

describe("isStaggerSlotActive — window boundaries", () => {
  const TENANT = "tenant-fixture-slot-zero"; // pick whatever slot the
  // hash produces — the test reads slot dynamically and constructs
  // inputs around it.
  const slot = staggerSlotHour(TENANT);

  function utcHourDate(hour: number): Date {
    return new Date(Date.UTC(2026, 4, 18, hour, 0, 0));
  }

  it("returns true at the slot start hour", () => {
    expect(isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate(slot) })).toBe(true);
  });

  it("returns true at slot+3h (last hour inside the window)", () => {
    expect(
      isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate(slot + 3) }),
    ).toBe(true);
  });

  it("returns false at slot+4h (outside the window)", () => {
    expect(
      isStaggerSlotActive({
        tenantId: TENANT,
        now: utcHourDate((slot + 4) % 24),
      }),
    ).toBe(false);
  });

  it("returns false at slot-1h", () => {
    // Use (slot+23)%24 to handle slot=0 wrap-around.
    const before = (slot + 23) % 24;
    expect(isStaggerSlotActive({ tenantId: TENANT, now: utcHourDate(before) })).toBe(false);
  });

  it("accepts number (ms since epoch) as `now`", () => {
    const ms = utcHourDate(slot).getTime();
    expect(isStaggerSlotActive({ tenantId: TENANT, now: ms })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Exponential backoff schedule
// ─────────────────────────────────────────────────────────────────────

describe("backoffDelayMs — 1000 × 2^(n−1) schedule", () => {
  it("returns 1000 for attempt 1", () => {
    expect(backoffDelayMs(1)).toBe(1000);
  });
  it("returns 2000 for attempt 2", () => {
    expect(backoffDelayMs(2)).toBe(2000);
  });
  it("returns 4000 for attempt 3", () => {
    expect(backoffDelayMs(3)).toBe(4000);
  });
  it("returns -1 above the locked max-retries cap", () => {
    expect(backoffDelayMs(MAX_RETRIES_ON_429 + 1)).toBe(-1);
    expect(backoffDelayMs(10)).toBe(-1);
  });
  it("returns -1 for invalid input", () => {
    expect(backoffDelayMs(0)).toBe(-1);
    expect(backoffDelayMs(-3)).toBe(-1);
    expect(backoffDelayMs(NaN)).toBe(-1);
  });
});
