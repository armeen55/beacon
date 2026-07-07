import { describe, it, expect } from "vitest";
import { failureForReason, toOperatorFailure, isKnownReason } from "./operator-failure";

describe("failureForReason — known codes map to operator copy", () => {
  it("maps a known reason to friendly, non-jargon copy + keeps the code for logging", () => {
    const f = failureForReason("insufficient_controls");
    expect(f.kind).toBe("action_blocked");
    expect(f.title).toMatch(/comparison pages/i);
    expect(f.message).not.toMatch(/insufficient_controls/);
    expect(f.technicalCode).toBe("insufficient_controls");
  });
  it("verification_pending is retryable + not alarming", () => {
    const f = failureForReason("verification_pending");
    expect(f.kind).toBe("verification_pending");
    expect(f.retryable).toBe(true);
    expect(f.nextAction).toMatch(/check again/i);
  });
  it("plan_refreshed routes to a review action, not an error", () => {
    expect(failureForReason("plan_refreshed").kind).toBe("action_needs_review");
  });
  it("no_eligible_today is a calm cold-state, NOT the scary unexpected_error fallback", () => {
    const f = failureForReason("no_eligible_today");
    // A brand-new tenant's only Today CTA must NOT surface the generic error.
    expect(f.kind).toBe("waiting_for_source");
    expect(f.kind).not.toBe("unexpected_error");
    expect(f.message).not.toMatch(/didn.t go through/i);
    expect(f.message).toMatch(/gathering data|queued|Search Console/i);
    expect(f.technicalCode).toBe("no_eligible_today");
    expect(isKnownReason("no_eligible_today")).toBe(true);
  });
});

describe("raw-code suppression — unknown/raw codes never leak", () => {
  it("an unknown internal code falls back to safe copy, code preserved only in technicalCode", () => {
    const f = failureForReason("PGRST204");
    expect(f.kind).toBe("unexpected_error");
    expect(f.message).not.toMatch(/PGRST/);
    expect(f.title).not.toMatch(/PGRST/);
    expect(f.technicalCode).toBe("PGRST204");
    expect(f.message).toMatch(/data is safe/i);
  });
  it("an RPC-style name does not appear in the user-facing message", () => {
    const f = failureForReason("activate_daily_experiment_item failed: 42P01");
    expect(f.message).not.toMatch(/activate_daily_experiment_item|42P01/);
  });
  it("null/empty reason → safe fallback with null technicalCode", () => {
    const f = failureForReason(null);
    expect(f.kind).toBe("unexpected_error");
    expect(f.technicalCode).toBe(null);
  });
});

describe("toOperatorFailure — thrown errors never render raw", () => {
  it("an Error's message is kept for logging, never the primary message", () => {
    const f = toOperatorFailure(new Error("ECONNRESET at supabase.co:5432"));
    expect(f.message).not.toMatch(/ECONNRESET|supabase/);
    expect(f.technicalCode).toBe("ECONNRESET at supabase.co:5432");
    expect(f.kind).toBe("unexpected_error");
  });
  it("a thrown known reason-code string still maps to its friendly copy", () => {
    expect(toOperatorFailure("verification_failed").kind).toBe("verification_mismatch");
  });
});

describe("isKnownReason", () => {
  it("true for mapped codes, false for raw/unknown", () => {
    expect(isKnownReason("plan_not_found")).toBe(true);
    expect(isKnownReason("PGRST204")).toBe(false);
    expect(isKnownReason(null)).toBe(false);
  });
});
