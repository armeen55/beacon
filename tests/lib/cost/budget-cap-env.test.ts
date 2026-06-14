/**
 * audit #5 (2026-06-14) — budget cap env vars must FAIL LOUD on a
 * non-numeric / negative value instead of silently disabling the cap.
 * The prior `env ? parseFloat(env) : default` turned "disabled" / "$10"
 * into NaN, and `spent >= NaN` is always false → runaway-spend cap off
 * with zero signal. A cap of exactly 0 ("block all spend") stays valid.
 */

import { describe, it, expect, afterEach } from "vitest";

import { readCapEnvUsd } from "@/lib/cost/budget";

const KEY = "BEACON_TEST_CAP_USD_FIXTURE";

afterEach(() => {
  delete process.env[KEY];
});

describe("readCapEnvUsd", () => {
  it("returns the fallback when the env var is unset or blank", () => {
    expect(readCapEnvUsd(KEY, 10)).toBe(10);
    process.env[KEY] = "   ";
    expect(readCapEnvUsd(KEY, 7.5)).toBe(7.5);
  });

  it("parses a valid positive number", () => {
    process.env[KEY] = "12.5";
    expect(readCapEnvUsd(KEY, 10)).toBe(12.5);
  });

  it("allows 0 (a valid 'block all spend' fail-CLOSED setting)", () => {
    process.env[KEY] = "0";
    expect(readCapEnvUsd(KEY, 10)).toBe(0);
  });

  it.each(["disabled", "$10", "10 USD", "NaN", "abc", "-5", "Infinity"])(
    "THROWS on the dangerous fail-open value %j (never silently disables)",
    (bad) => {
      process.env[KEY] = bad;
      expect(() => readCapEnvUsd(KEY, 10)).toThrow(/invalid cap env/);
    },
  );
});
