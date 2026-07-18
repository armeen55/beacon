import { describe, expect, it } from "vitest";
import { classifyStore } from "./store-classification";

/**
 * Findings A + E (2026-07-18) leak-hardening pins.
 */
describe("classifyStore — leak hardening", () => {
  it("answer-texts is now TENANT_SCOPED, never global/flat (finding A)", () => {
    expect(classifyStore("answer-texts")).toBe("per-tenant");
    expect(classifyStore("answer-texts")).not.toBe("global");
    expect(classifyStore("answer-texts")).not.toBe("unknown");
  });

  it("an unregistered store name classifies as 'unknown' (the fail-loud signal, finding E)", () => {
    // classifyStore stays pure (the migration CLI + store tests depend on the
    // 'unknown' return). The runtime read/write helpers throw on 'unknown', so
    // no runtime path can silently bind an unclassified store to a tenant-blind
    // flat file — it surfaces as an error instead of a cross-tenant leak.
    expect(classifyStore("this-store-does-not-exist-xyz")).toBe("unknown");
  });
});
