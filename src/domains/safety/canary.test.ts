import { describe, it, expect } from "vitest";

import { runCanaries, isOwnTenantUrl, buildHoldReason, type CanaryMove } from "./canary";

const OWN = "iranopedia.com";

function move(over: Partial<CanaryMove> = {}): CanaryMove {
  return {
    id: "m1",
    targetUrl: "https://iranopedia.com/persian-food",
    proposedText: "The best Persian food guide in Los Angeles.",
    evidenceCount: 2,
    ...over,
  };
}

const cleanCtx = { tenantDomain: OWN, spendTripped: false } as const;

describe("runCanaries - clean batch is never held (byte-identical downstream)", () => {
  it("passes a clean batch", () => {
    const v = runCanaries([move(), move({ id: "m2" })], cleanCtx);
    expect(v.held).toBe(false);
    if (!v.held) expect(v.checked).toBe(2);
  });
  it("an EMPTY batch is never held (nothing to check)", () => {
    const v = runCanaries([], cleanCtx);
    expect(v.held).toBe(false);
  });
});

describe("runCanaries - each invariant HOLDS the whole batch", () => {
  it("1. banned dash in a draft", () => {
    const v = runCanaries([move(), move({ id: "m2", proposedText: "Tehran — the capital" })], cleanCtx);
    expect(v.held).toBe(true);
    if (v.held) {
      expect(v.failures.some((f) => f.canary === "banned_dash")).toBe(true);
      expect(v.holdReason).toContain("Nothing was published.");
    }
  });

  it("2. empty required field (missing title)", () => {
    const v = runCanaries([move({ id: "m2", proposedText: "  " })], cleanCtx);
    expect(v.held).toBe(true);
    if (v.held) expect(v.failures[0]!.canary).toBe("empty_field");
  });

  it("2b. empty required field (missing target url)", () => {
    const v = runCanaries([move({ id: "m2", targetUrl: "" })], cleanCtx);
    expect(v.held).toBe(true);
    if (v.held) expect(v.failures[0]!.canary).toBe("empty_field");
  });

  it("3. off-tenant URL", () => {
    const v = runCanaries([move({ id: "m2", targetUrl: "https://competitor.com/page" })], cleanCtx);
    expect(v.held).toBe(true);
    if (v.held) expect(v.failures.some((f) => f.canary === "off_tenant_url")).toBe(true);
  });

  it("4. spend over the global breaker", () => {
    const v = runCanaries([move()], { tenantDomain: OWN, spendTripped: true, spendReason: "at the ceiling" });
    expect(v.held).toBe(true);
    if (v.held) {
      expect(v.failures[0]!.canary).toBe("over_global_spend");
      expect(v.holdReason).toContain("at the ceiling");
    }
  });

  it("5. a move with no evidence", () => {
    const v = runCanaries([move({ id: "m2", evidenceCount: 0 })], cleanCtx);
    expect(v.held).toBe(true);
    if (v.held) expect(v.failures.some((f) => f.canary === "no_evidence")).toBe(true);
  });

  it("counts across the batch and lists every failing canary", () => {
    const v = runCanaries(
      [
        move({ id: "a", proposedText: "clause — separator" }), // dash
        move({ id: "b", evidenceCount: 0 }), // no evidence
        move({ id: "c", targetUrl: "https://elsewhere.com/x" }), // off-tenant
      ],
      cleanCtx,
    );
    expect(v.held).toBe(true);
    if (v.held) {
      const kinds = v.failures.map((f) => f.canary).sort();
      expect(kinds).toEqual(["banned_dash", "no_evidence", "off_tenant_url"]);
    }
  });

  it("the hold reason never carries a banned dash itself (the copy is clean even when reporting a dash)", () => {
    const v = runCanaries([move({ proposedText: "Tehran — capital" })], cleanCtx);
    if (v.held) expect(v.holdReason).not.toMatch(/[‒–—―]/);
  });
});

describe("isOwnTenantUrl", () => {
  it("matches the tenant domain and its subdomains", () => {
    expect(isOwnTenantUrl("https://iranopedia.com/x", OWN)).toBe(true);
    expect(isOwnTenantUrl("https://blog.iranopedia.com/x", OWN)).toBe(true);
    expect(isOwnTenantUrl("www.iranopedia.com/x", OWN)).toBe(true);
  });
  it("rejects a different domain and a suffix look-alike", () => {
    expect(isOwnTenantUrl("https://competitor.com/x", OWN)).toBe(false);
    expect(isOwnTenantUrl("https://notiranopedia.com/x", OWN)).toBe(false);
  });
  it("cannot confirm ownership with no tenant domain", () => {
    expect(isOwnTenantUrl("https://iranopedia.com/x", null)).toBe(false);
    expect(isOwnTenantUrl("https://iranopedia.com/x", "")).toBe(false);
  });
});

describe("buildHoldReason", () => {
  it("empty on no failures", () => {
    expect(buildHoldReason([])).toBe("");
  });
  it("joins failure reasons and ends with the reassurance", () => {
    const r = buildHoldReason([{ canary: "empty_field", reason: "2 drafts were missing a title or a target page." }]);
    expect(r).toBe("I held today's batch: 2 drafts were missing a title or a target page. Nothing was published.");
  });
});
