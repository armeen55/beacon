/**
 * Behavioral tests — reset-test-tenant safety helpers (Gap F.1 QA).
 *
 * Pure unit tests on the exported helpers. The full delete flow lives
 * inside main() and is not unit-tested (would require a Supabase mock
 * + a full process.argv harness); the architecture invariant test
 * pins the source-level safety contracts instead.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_DELETE_TABLES,
  MAX_OBSERVATIONS_FOR_RESET,
  RESETTABLE_STATUSES,
  RITZ_FORBIDDEN_PATTERNS,
  isProtectedSlug,
  parseArg,
} from "../../scripts/reset-test-tenant";

describe("isProtectedSlug — refuses Ritz patterns", () => {
  it("refuses tenant-ritz-founder (the production tenant id)", () => {
    expect(isProtectedSlug("tenant-ritz-founder")).toBe(true);
  });

  it("refuses ritz-builders (the production tenant slug)", () => {
    expect(isProtectedSlug("ritz-builders")).toBe(true);
  });

  it("refuses any case-mismatched ritz token", () => {
    expect(isProtectedSlug("RITZ")).toBe(true);
    expect(isProtectedSlug("Ritz")).toBe(true);
    expect(isProtectedSlug("RiTz-Builders")).toBe(true);
    expect(isProtectedSlug("not-ritz")).toBe(true);
    expect(isProtectedSlug("xritzx")).toBe(true);
  });

  it("refuses any tenant-ritz-* prefix variant", () => {
    expect(isProtectedSlug("tenant-ritz-anything")).toBe(true);
    expect(isProtectedSlug("tenant-ritz-")).toBe(true);
  });

  it("accepts a fresh test slug shape (8-char hex from auth UUID)", () => {
    expect(isProtectedSlug("8c9d2f4a")).toBe(false);
  });

  it("accepts a friend-test slug like 'acme-test'", () => {
    expect(isProtectedSlug("acme-test")).toBe(false);
    expect(isProtectedSlug("test-tenant-1")).toBe(false);
    expect(isProtectedSlug("friend-1")).toBe(false);
  });

  it("accepts an empty string but does not match — caller must check separately", () => {
    expect(isProtectedSlug("")).toBe(false);
  });

  it("safely handles non-string inputs", () => {
    expect(isProtectedSlug(undefined as unknown as string)).toBe(false);
    expect(isProtectedSlug(null as unknown as string)).toBe(false);
    expect(isProtectedSlug(42 as unknown as string)).toBe(false);
  });
});

describe("parseArg — flag parsing", () => {
  it("returns the value for --name=value", () => {
    expect(parseArg(["--slug=acme-test"], "--slug")).toBe("acme-test");
  });

  it("returns 'true' for bare --name", () => {
    expect(parseArg(["--confirm"], "--confirm")).toBe("true");
  });

  it("returns null when the flag is absent", () => {
    expect(parseArg(["--slug=acme"], "--confirm")).toBeNull();
    expect(parseArg([], "--slug")).toBeNull();
  });

  it("handles values containing '='", () => {
    // "--slug=foo=bar" → "foo=bar"
    expect(parseArg(["--slug=foo=bar"], "--slug")).toBe("foo=bar");
  });

  it("returns the FIRST occurrence when the flag is repeated", () => {
    expect(parseArg(["--slug=first", "--slug=second"], "--slug")).toBe("first");
  });

  it("does not match a different flag with similar prefix", () => {
    expect(parseArg(["--slugs=many"], "--slug")).toBeNull();
  });
});

describe("safety constants — pinned values", () => {
  it("RITZ_FORBIDDEN_PATTERNS contains the two expected patterns", () => {
    expect(RITZ_FORBIDDEN_PATTERNS.length).toBe(2);
  });

  it("RESETTABLE_STATUSES allows pending_onboarding + active only", () => {
    expect(RESETTABLE_STATUSES.size).toBe(2);
    expect(RESETTABLE_STATUSES.has("pending_onboarding")).toBe(true);
    expect(RESETTABLE_STATUSES.has("active")).toBe(true);
    // Operator-set states are off-limits.
    expect(RESETTABLE_STATUSES.has("paused")).toBe(false);
    expect(RESETTABLE_STATUSES.has("cancelled")).toBe(false);
  });

  it("MAX_OBSERVATIONS_FOR_RESET is conservatively low (test artifact, not real customer)", () => {
    expect(MAX_OBSERVATIONS_FOR_RESET).toBeLessThanOrEqual(200);
    expect(MAX_OBSERVATIONS_FOR_RESET).toBeGreaterThanOrEqual(1);
  });

  it("ALLOWED_DELETE_TABLES is exactly { tracked_prompts, tenant_members, tenants }", () => {
    expect(ALLOWED_DELETE_TABLES.size).toBe(3);
    expect(ALLOWED_DELETE_TABLES.has("tracked_prompts")).toBe(true);
    expect(ALLOWED_DELETE_TABLES.has("tenant_members")).toBe(true);
    expect(ALLOWED_DELETE_TABLES.has("tenants")).toBe(true);
    // Defense in depth: enumerate forbidden tables.
    expect(ALLOWED_DELETE_TABLES.has("prompt_answer_observations")).toBe(false);
    expect(ALLOWED_DELETE_TABLES.has("daily_metric_snapshots")).toBe(false);
    expect(ALLOWED_DELETE_TABLES.has("recommended_edits")).toBe(false);
    expect(ALLOWED_DELETE_TABLES.has("changelog_entries")).toBe(false);
    expect(ALLOWED_DELETE_TABLES.has("tracked_entities")).toBe(false);
  });
});
