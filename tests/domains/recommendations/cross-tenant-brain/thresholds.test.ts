/**
 * Phase A.2 Step 1 — cross-tenant brain threshold constants tests.
 *
 * Locked values from Section 3 Decision Lock:
 *   • E3: BRAIN_SAMPLE_THRESHOLDS = { llm_packet: 5,
 *     customer_tile: 10, threshold_replacement: 20 }
 *   • E5: BRAIN_PACKET_CAP = 5
 *   • E2 — helping-rate floor + band: HELPING_RATE_FLOOR = 0.6,
 *     HELPING_RATE_BAND = "within_median_days"
 *
 * The `as const` literal-type lock is exercised at compile time via
 * the `Expect<Equal<…>>` assertions below — the test file itself is
 * typechecked under `npx tsc --noEmit`, so any drift in the
 * exported literal types trips typecheck.
 */

import { describe, expect, it } from "vitest";

import {
  BRAIN_PACKET_CAP,
  BRAIN_SAMPLE_THRESHOLDS,
  HELPING_RATE_BAND,
  HELPING_RATE_FLOOR,
} from "@/domains/recommendations/cross-tenant-brain/thresholds";

// ─────────────────────────────────────────────────────────────────────
// Compile-time literal-type assertions. These ensure `as const` is
// preserved on every exported constant — drifting to `number` /
// `string` widens the type and fails the assertions below at
// `npx tsc --noEmit`.
// ─────────────────────────────────────────────────────────────────────

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

// llm_packet locked to literal 5.
type _T1 = Expect<Equal<typeof BRAIN_SAMPLE_THRESHOLDS.llm_packet, 5>>;
// customer_tile locked to literal 10.
type _T2 = Expect<Equal<typeof BRAIN_SAMPLE_THRESHOLDS.customer_tile, 10>>;
// threshold_replacement locked to literal 20.
type _T3 = Expect<
  Equal<typeof BRAIN_SAMPLE_THRESHOLDS.threshold_replacement, 20>
>;
// BRAIN_PACKET_CAP locked to literal 5.
type _T4 = Expect<Equal<typeof BRAIN_PACKET_CAP, 5>>;
// HELPING_RATE_FLOOR locked to literal 0.6.
type _T5 = Expect<Equal<typeof HELPING_RATE_FLOOR, 0.6>>;
// HELPING_RATE_BAND locked to the exact sentinel string.
type _T6 = Expect<Equal<typeof HELPING_RATE_BAND, "within_median_days">>;

// Suppress unused-type warnings — the type aliases above ARE the
// assertions; they don't need runtime references.
void (0 as unknown as _T1);
void (0 as unknown as _T2);
void (0 as unknown as _T3);
void (0 as unknown as _T4);
void (0 as unknown as _T5);
void (0 as unknown as _T6);

// ─────────────────────────────────────────────────────────────────────
// Runtime value assertions
// ─────────────────────────────────────────────────────────────────────

describe("BRAIN_SAMPLE_THRESHOLDS", () => {
  it("llm_packet === 5 (E3 lock)", () => {
    expect(BRAIN_SAMPLE_THRESHOLDS.llm_packet).toBe(5);
  });

  it("customer_tile === 10 (E3 lock)", () => {
    expect(BRAIN_SAMPLE_THRESHOLDS.customer_tile).toBe(10);
  });

  it("threshold_replacement === 20 (E3 lock)", () => {
    expect(BRAIN_SAMPLE_THRESHOLDS.threshold_replacement).toBe(20);
  });

  it("has exactly three keys (no silent additions)", () => {
    expect(Object.keys(BRAIN_SAMPLE_THRESHOLDS).sort()).toEqual(
      ["customer_tile", "llm_packet", "threshold_replacement"],
    );
  });
});

describe("BRAIN_PACKET_CAP", () => {
  it("equals 5 (E5 lock)", () => {
    expect(BRAIN_PACKET_CAP).toBe(5);
  });
});

describe("HELPING_RATE_FLOOR", () => {
  it("equals 0.6", () => {
    expect(HELPING_RATE_FLOOR).toBe(0.6);
  });

  it("is a finite number in [0, 1]", () => {
    expect(Number.isFinite(HELPING_RATE_FLOOR)).toBe(true);
    expect(HELPING_RATE_FLOOR).toBeGreaterThanOrEqual(0);
    expect(HELPING_RATE_FLOOR).toBeLessThanOrEqual(1);
  });
});

describe("HELPING_RATE_BAND", () => {
  it('equals the locked sentinel "within_median_days" (E2 lock)', () => {
    expect(HELPING_RATE_BAND).toBe("within_median_days");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Single-source-of-truth contract: this module exports exactly the 4
// names above. A future "let's add a helper here" PR that broadens
// the export surface trips this assertion. Architecture invariant in
// `tests/architecture/brain-config-and-thresholds-provenance.test.ts`
// pins the module's purity + canonical path; this test pins its
// exported surface so accidental widening fails loud.
// ─────────────────────────────────────────────────────────────────────

describe("module export surface", () => {
  it("exports exactly the four locked constants and nothing else", async () => {
    const mod = (await import(
      "@/domains/recommendations/cross-tenant-brain/thresholds"
    )) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual(
      [
        "BRAIN_PACKET_CAP",
        "BRAIN_SAMPLE_THRESHOLDS",
        "HELPING_RATE_BAND",
        "HELPING_RATE_FLOOR",
      ].sort(),
    );
  });
});
