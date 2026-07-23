/**
 * Citation-lifecycle URL canonicalizer — locked behavior per Decision Lock D3.
 * The canonicalizer runs on both sides of the citation ↔ target_url compare,
 * so every mapping here is also a compute-time-to-citation correctness pin.
 * Boundary-grouped (Core 100K): one test per behavior family, every edge kept.
 */

import { describe, expect, it } from "vitest";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

describe("canonicalizeCitationUrl — D3 locked behavior", () => {
  it("host normalization: strips www., lowercases host, keeps path case", () => {
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services/whole-home-remodel")).toBe(
      "https://ritzbuilders.com/services/whole-home-remodel",
    );
    expect(canonicalizeCitationUrl("https://www.ritzbuilders.com/services")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://WWW.RitzBuilders.COM/services")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/Services/Whole-Home-Remodel")).toBe(
      "https://ritzbuilders.com/Services/Whole-Home-Remodel",
    );
  });

  it("scheme normalization: http:// becomes https:// (with www. in one pass)", () => {
    expect(canonicalizeCitationUrl("http://ritzbuilders.com/services")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("http://www.ritzbuilders.com/services")).toBe("https://ritzbuilders.com/services");
  });

  it("trailing slash: stripped on sub-paths (incl. multiples), preserved at root", () => {
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services/")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services///")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/")).toBe("https://ritzbuilders.com/");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com")).toBe("https://ritzbuilders.com/");
  });

  it("query + fragment: ALL params stripped (D3 divergence from normalizePageUrl), fragment stripped", () => {
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services?utm_source=ai&id=42&ref=home")).toBe(
      "https://ritzbuilders.com/services",
    );
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services?source=ai")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services#section-3")).toBe("https://ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/services?utm_source=ai&id=42#section-3")).toBe(
      "https://ritzbuilders.com/services",
    );
  });

  it("subdomain prefixes (m., blog., shop.) are preserved verbatim, lowercased only", () => {
    expect(canonicalizeCitationUrl("https://m.ritzbuilders.com/services")).toBe("https://m.ritzbuilders.com/services");
    expect(canonicalizeCitationUrl("https://blog.ritzbuilders.com/post-123")).toBe("https://blog.ritzbuilders.com/post-123");
  });

  it("needs_new_page sentinel returns null (even after whitespace trim)", () => {
    expect(canonicalizeCitationUrl("needs_new_page")).toBeNull();
    expect(canonicalizeCitationUrl("  needs_new_page  ")).toBeNull();
  });

  it("non-http(s) schemes and fragment-only input return null", () => {
    for (const input of [
      "mailto:hello@ritzbuilders.com",
      "javascript:alert(1)",
      "data:text/plain;base64,SGVsbG8=",
      "ftp://ritzbuilders.com/file.pdf",
      "#section-3",
    ]) {
      expect(canonicalizeCitationUrl(input)).toBeNull();
    }
  });

  it("malformed / null / undefined / empty / whitespace return null without throwing", () => {
    for (const input of [
      "https://",
      "://broken",
      "not a url at all",
      "ritzbuilders.com/services",
      "/locations/atherton",
      "  ",
      null,
      undefined,
      "",
    ]) {
      expect(() => canonicalizeCitationUrl(input)).not.toThrow();
      expect(canonicalizeCitationUrl(input)).toBeNull();
    }
  });

  it("hostname credibility guard rejects single-label / non-public hosts, accepts multi-label", () => {
    for (const bad of ["https:///just-path", "https://localhost/foo", "https://intranet/foo", "https://www./foo", "https://.com/foo"]) {
      expect(canonicalizeCitationUrl(bad)).toBeNull();
    }
    expect(canonicalizeCitationUrl("https://ritzbuilders.com/foo")).toBe("https://ritzbuilders.com/foo");
    expect(canonicalizeCitationUrl("https://beacon-bice.vercel.app/foo")).toBe("https://beacon-bice.vercel.app/foo");
    expect(canonicalizeCitationUrl("https://sub.example.co.uk/foo")).toBe("https://sub.example.co.uk/foo");
  });

  it("idempotent: f(f(x)) === f(x)", () => {
    for (const input of [
      "https://www.RitzBuilders.com/Services/?utm_source=ai#x",
      "http://www.ritzbuilders.com/",
      "https://m.ritzbuilders.com/services",
      "https://ritzbuilders.com",
      "https://ritzbuilders.com/services///",
    ]) {
      const once = canonicalizeCitationUrl(input);
      expect(once).not.toBeNull();
      expect(canonicalizeCitationUrl(once)).toBe(once);
    }
  });

  it("compound: the full D3 pipeline collapses in one pass", () => {
    expect(
      canonicalizeCitationUrl("HTTP://WWW.RitzBuilders.COM/Services/Whole-Home-Remodel/?utm=x&id=42#act-3"),
    ).toBe("https://ritzbuilders.com/Services/Whole-Home-Remodel");
  });
});
