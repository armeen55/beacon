/**
 * Behavioral tests — Gap C.1 profile-validation (2026-05-07).
 *
 * Pure unit tests, no I/O. Pin the validation contract that the
 * /onboard/business server action depends on.
 */

import { describe, expect, it } from "vitest";
import {
  BUSINESS_NAME_MAX_LENGTH,
  normalizeDomain,
  validateBusinessProfile,
} from "./profile-validation";

describe("normalizeDomain", () => {
  it("strips https:// scheme", () => {
    expect(normalizeDomain("https://acme.com")).toBe("acme.com");
  });

  it("strips http:// scheme", () => {
    expect(normalizeDomain("http://acme.com")).toBe("acme.com");
  });

  it("preserves www. (we don't auto-collapse to apex)", () => {
    expect(normalizeDomain("https://www.acme.com")).toBe("www.acme.com");
  });

  it("strips paths", () => {
    expect(normalizeDomain("https://www.acme.com/about")).toBe("www.acme.com");
    expect(normalizeDomain("acme.com/about/team")).toBe("acme.com");
  });

  it("strips query strings + fragments", () => {
    expect(normalizeDomain("https://acme.com/?utm_source=x")).toBe("acme.com");
    expect(normalizeDomain("acme.com#anchor")).toBe("acme.com");
  });

  it("lowercases", () => {
    expect(normalizeDomain("ACME.COM")).toBe("acme.com");
    expect(normalizeDomain("HTTPS://Acme.Com")).toBe("acme.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDomain("  acme.com  ")).toBe("acme.com");
    expect(normalizeDomain("\tacme.com\n")).toBe("acme.com");
  });

  it("strips port + user:pass@", () => {
    expect(normalizeDomain("https://acme.com:8080")).toBe("acme.com");
    expect(normalizeDomain("https://user:pass@acme.com")).toBe("acme.com");
  });

  it("accepts multi-label TLDs", () => {
    expect(normalizeDomain("https://acme.co.uk")).toBe("acme.co.uk");
    expect(normalizeDomain("acme.com.au/path")).toBe("acme.com.au");
  });

  it("rejects single-label inputs (require a TLD)", () => {
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });

  it("rejects empty / whitespace-only input", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("rejects javascript: / data: / mailto: schemes (XSS hardening)", () => {
    expect(normalizeDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeDomain("data:text/html,<script>")).toBeNull();
    expect(normalizeDomain("mailto:joe@acme.com")).toBeNull();
  });

  it("rejects bare IP addresses (no letter in TLD)", () => {
    expect(normalizeDomain("192.168.1.1")).toBeNull();
    expect(normalizeDomain("https://10.0.0.1/admin")).toBeNull();
  });

  it("rejects labels with leading/trailing dashes", () => {
    expect(normalizeDomain("-acme.com")).toBeNull();
    expect(normalizeDomain("acme-.com")).toBeNull();
    expect(normalizeDomain("acme.-com")).toBeNull();
  });

  it("rejects labels with invalid characters", () => {
    expect(normalizeDomain("ac me.com")).toBeNull();
    expect(normalizeDomain("acme!.com")).toBeNull();
    expect(normalizeDomain("acme.com$")).toBeNull();
  });

  it("rejects non-string input safely", () => {
    expect(normalizeDomain(undefined as unknown as string)).toBeNull();
    expect(normalizeDomain(null as unknown as string)).toBeNull();
    expect(normalizeDomain(123 as unknown as string)).toBeNull();
  });
});

describe("validateBusinessProfile", () => {
  it("accepts a clean business name + domain", () => {
    const r = validateBusinessProfile({
      businessName: "Acme Builders",
      domain: "acme.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.businessName).toBe("Acme Builders");
      expect(r.normalized.domain).toBe("acme.com");
    }
  });

  it("trims business name whitespace", () => {
    const r = validateBusinessProfile({
      businessName: "  Acme Builders  ",
      domain: "acme.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.businessName).toBe("Acme Builders");
    }
  });

  it("normalizes domain (strip protocol + path)", () => {
    const r = validateBusinessProfile({
      businessName: "Acme",
      domain: "https://www.acme.com/about?utm=x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.domain).toBe("www.acme.com");
    }
  });

  it("rejects empty business name", () => {
    const r = validateBusinessProfile({ businessName: "", domain: "acme.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.businessName).toBeTruthy();
      expect(r.errors.domain).toBeUndefined();
    }
  });

  it("rejects whitespace-only business name", () => {
    const r = validateBusinessProfile({ businessName: "   ", domain: "acme.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.businessName).toBeTruthy();
    }
  });

  it("rejects business name longer than 80 chars", () => {
    const longName = "A".repeat(BUSINESS_NAME_MAX_LENGTH + 1);
    const r = validateBusinessProfile({ businessName: longName, domain: "acme.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.businessName).toBeTruthy();
  });

  it("accepts business name at the 80-char boundary", () => {
    const okName = "A".repeat(BUSINESS_NAME_MAX_LENGTH);
    const r = validateBusinessProfile({ businessName: okName, domain: "acme.com" });
    expect(r.ok).toBe(true);
  });

  it("rejects empty domain", () => {
    const r = validateBusinessProfile({ businessName: "Acme", domain: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.domain).toBeTruthy();
      expect(r.errors.businessName).toBeUndefined();
    }
  });

  it("rejects malformed domain (single label)", () => {
    const r = validateBusinessProfile({ businessName: "Acme", domain: "localhost" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.domain).toBeTruthy();
  });

  it("rejects javascript: domain (XSS hardening)", () => {
    const r = validateBusinessProfile({
      businessName: "Acme",
      domain: "javascript:alert(1)",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.domain).toBeTruthy();
  });

  it("returns BOTH errors when both fields are invalid", () => {
    const r = validateBusinessProfile({ businessName: "", domain: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.businessName).toBeTruthy();
      expect(r.errors.domain).toBeTruthy();
    }
  });

  it("handles missing keys safely (no throw on undefined)", () => {
    const r = validateBusinessProfile({} as { businessName: string; domain: string });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.businessName).toBeTruthy();
      expect(r.errors.domain).toBeTruthy();
    }
  });
});
