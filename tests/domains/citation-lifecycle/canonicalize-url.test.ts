/**
 * Phase A.1 Step 3 — citation-lifecycle URL canonicalizer tests.
 *
 * Locked behavior per Section 2 Decision Lock D3. Each test pins one
 * shape of input ↔ canonical-output mapping. The canonicalizer is
 * applied on both sides of the citation ↔ target_url comparison in
 * Step 4, so every test case here is also implicitly a future
 * compute-time-to-citation correctness pin.
 */

import { describe, expect, it } from "vitest";

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

describe("canonicalizeCitationUrl — Phase A.1 §2.3 / D3 locked behavior", () => {
  // ─────────────────────────────────────────────────────────────────
  // Happy path — clean canonical inputs
  // ─────────────────────────────────────────────────────────────────

  it("case 1: full clean URL returns canonical full URL", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/services/whole-home-remodel"),
    ).toBe("https://ritzbuilders.com/services/whole-home-remodel");
  });

  // ─────────────────────────────────────────────────────────────────
  // Host normalization
  // ─────────────────────────────────────────────────────────────────

  it("case 2: leading www. is stripped", () => {
    expect(
      canonicalizeCitationUrl("https://www.ritzbuilders.com/services"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 3: uppercase host is lowercased", () => {
    expect(
      canonicalizeCitationUrl("https://RitzBuilders.com/services"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 3b: mixed-case host with www. lowercases AND strips", () => {
    expect(
      canonicalizeCitationUrl("https://WWW.RitzBuilders.COM/services"),
    ).toBe("https://ritzbuilders.com/services");
  });

  // ─────────────────────────────────────────────────────────────────
  // Scheme normalization
  // ─────────────────────────────────────────────────────────────────

  it("case 4: http:// normalized to https://", () => {
    expect(
      canonicalizeCitationUrl("http://ritzbuilders.com/services"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 4b: http + www both normalized in one pass", () => {
    expect(
      canonicalizeCitationUrl("http://www.ritzbuilders.com/services"),
    ).toBe("https://ritzbuilders.com/services");
  });

  // ─────────────────────────────────────────────────────────────────
  // Trailing slash
  // ─────────────────────────────────────────────────────────────────

  it("case 5: trailing slash on a sub-path is stripped", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/services/"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 5b: multiple trailing slashes collapse to none", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/services///"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 6: root slash is preserved", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/"),
    ).toBe("https://ritzbuilders.com/");
  });

  it("case 6b: URL with no path keeps root slash", () => {
    // The URL constructor synthesizes `pathname: "/"` even when the
    // input has no path. Verify the canonicalizer emits the root form.
    expect(canonicalizeCitationUrl("https://ritzbuilders.com")).toBe(
      "https://ritzbuilders.com/",
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Query + fragment stripping
  // ─────────────────────────────────────────────────────────────────

  it("case 7: all query params are stripped, not just utm_*", () => {
    expect(
      canonicalizeCitationUrl(
        "https://ritzbuilders.com/services?utm_source=ai&id=42&ref=home",
      ),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 7b: non-utm query alone is stripped", () => {
    // This is the D3-vs-normalizePageUrl divergence — D3 strips ALL
    // query params, normalizePageUrl preserves non-utm. Pin the D3
    // behavior here.
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/services?source=ai"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 8: fragment is stripped", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/services#section-3"),
    ).toBe("https://ritzbuilders.com/services");
  });

  it("case 9: query + fragment stripped together", () => {
    expect(
      canonicalizeCitationUrl(
        "https://ritzbuilders.com/services?utm_source=ai&id=42#section-3",
      ),
    ).toBe("https://ritzbuilders.com/services");
  });

  // ─────────────────────────────────────────────────────────────────
  // Path case preservation
  // ─────────────────────────────────────────────────────────────────

  it("case 10: uppercase path case is preserved", () => {
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/Services/Whole-Home-Remodel"),
    ).toBe("https://ritzbuilders.com/Services/Whole-Home-Remodel");
  });

  // ─────────────────────────────────────────────────────────────────
  // m. NOT stripped (D3 deliberately excludes mobile-host stripping)
  // ─────────────────────────────────────────────────────────────────

  it("case 11: m. mobile-host prefix is NOT stripped (host preserved verbatim, lowercased only)", () => {
    expect(
      canonicalizeCitationUrl("https://m.ritzbuilders.com/services"),
    ).toBe("https://m.ritzbuilders.com/services");
  });

  it("case 11b: other subdomain prefixes also preserved (blog., shop., etc.)", () => {
    expect(
      canonicalizeCitationUrl("https://blog.ritzbuilders.com/post-123"),
    ).toBe("https://blog.ritzbuilders.com/post-123");
  });

  // ─────────────────────────────────────────────────────────────────
  // needs_new_page sentinel — returns null
  // ─────────────────────────────────────────────────────────────────

  it("case 12: needs_new_page sentinel returns null", () => {
    expect(canonicalizeCitationUrl("needs_new_page")).toBeNull();
  });

  it("case 12b: needs_new_page is also rejected after whitespace trimming", () => {
    expect(canonicalizeCitationUrl("  needs_new_page  ")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Non-http(s) schemes — all return null
  // ─────────────────────────────────────────────────────────────────

  it("case 13: mailto: returns null", () => {
    expect(canonicalizeCitationUrl("mailto:hello@ritzbuilders.com")).toBeNull();
  });

  it("case 14: javascript: returns null", () => {
    expect(canonicalizeCitationUrl("javascript:alert(1)")).toBeNull();
  });

  it("case 15: data: returns null", () => {
    expect(canonicalizeCitationUrl("data:text/plain;base64,SGVsbG8=")).toBeNull();
  });

  it("case 15b: ftp: returns null (only http / https accepted)", () => {
    expect(canonicalizeCitationUrl("ftp://ritzbuilders.com/file.pdf")).toBeNull();
  });

  it("case 16: fragment-only input returns null", () => {
    expect(canonicalizeCitationUrl("#section-3")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Malformed / unparseable input — return null without throwing
  // ─────────────────────────────────────────────────────────────────

  it("case 17: malformed URLs return null without throwing", () => {
    // Each input is something the URL constructor either rejects
    // outright OR parses to a non-credible hostname that the
    // credibility guard then rejects. `https:///just-path` IS in this
    // list — WHATWG parses it as host=`just-path`, but the credibility
    // guard rejects single-label hostnames.
    const malformed = [
      "https://", // empty everything → URL throws
      "://broken", // no scheme name → URL throws
      "not a url at all", // no scheme → URL throws
      "ritzbuilders.com/services", // no scheme; URL throws (path-only is rejected too)
      "/locations/atherton", // path-only → URL throws
      "  ", // whitespace; trimmed → empty → null
      "https:///just-path", // WHATWG parses host=just-path; credibility guard rejects single-label host
    ];
    for (const input of malformed) {
      expect(() => canonicalizeCitationUrl(input)).not.toThrow();
      expect(canonicalizeCitationUrl(input)).toBeNull();
    }
  });

  it("case 17b: hostname credibility guard rejects `https:///just-path` (single-label host)", () => {
    // Explicit single-case pin for the WHATWG edge case the credibility
    // guard exists to defend against. A real public web URL is
    // multi-label; the canonicalizer enforces that minimum.
    expect(canonicalizeCitationUrl("https:///just-path")).toBeNull();
  });

  it("case 17c: hostname credibility guard rejects other single-label / malformed hostnames", () => {
    // Each of these would parse via WHATWG (or trip the parse failure)
    // but produce a non-credible public hostname. Pin them as null so
    // a future relaxation of the guard can't silently accept them.
    expect(canonicalizeCitationUrl("https://localhost/foo")).toBeNull();
    expect(canonicalizeCitationUrl("https://intranet/foo")).toBeNull();
    expect(canonicalizeCitationUrl("https://www./foo")).toBeNull(); // www. strip → empty host
    // `https://.com/foo` is rejected by the URL constructor itself on
    // current Node/Chromium (invalid host), so it hits the URL.throw
    // path — guard not strictly required, but pin the null contract.
    expect(canonicalizeCitationUrl("https://.com/foo")).toBeNull();
  });

  it("case 17d: credible multi-label public hosts still canonicalize", () => {
    // Positive coverage proving the credibility guard isn't
    // over-restrictive. Includes the deploy host so the Beacon
    // production URL pattern is explicitly pinned.
    expect(
      canonicalizeCitationUrl("https://ritzbuilders.com/foo"),
    ).toBe("https://ritzbuilders.com/foo");
    expect(
      canonicalizeCitationUrl("https://beacon-bice.vercel.app/foo"),
    ).toBe("https://beacon-bice.vercel.app/foo");
    // Deeper public TLDs (.co.uk etc.) survive — labels = ["sub",
    // "example", "co", "uk"], all non-empty.
    expect(
      canonicalizeCitationUrl("https://sub.example.co.uk/foo"),
    ).toBe("https://sub.example.co.uk/foo");
  });

  // ─────────────────────────────────────────────────────────────────
  // null / undefined / empty / whitespace
  // ─────────────────────────────────────────────────────────────────

  it("case 18: null returns null", () => {
    expect(canonicalizeCitationUrl(null)).toBeNull();
  });

  it("case 18b: undefined returns null", () => {
    expect(canonicalizeCitationUrl(undefined)).toBeNull();
  });

  it("case 18c: empty string returns null", () => {
    expect(canonicalizeCitationUrl("")).toBeNull();
  });

  it("case 18d: whitespace-only returns null", () => {
    expect(canonicalizeCitationUrl("   ")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Idempotency
  // ─────────────────────────────────────────────────────────────────

  it("case 19: f(f(x)) === f(x) for a range of inputs", () => {
    const inputs = [
      "https://ritzbuilders.com/services/whole-home-remodel",
      "https://www.RitzBuilders.com/Services/?utm_source=ai#x",
      "http://www.ritzbuilders.com/",
      "https://m.ritzbuilders.com/services",
      "https://ritzbuilders.com",
      "https://ritzbuilders.com/Path/With/Mixed-Case",
      "https://ritzbuilders.com/services///",
    ];
    for (const input of inputs) {
      const once = canonicalizeCitationUrl(input);
      expect(once).not.toBeNull();
      const twice = canonicalizeCitationUrl(once);
      expect(twice).toBe(once);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Cross-cut: the full D3 happy-path pipeline in a single input
  // ─────────────────────────────────────────────────────────────────

  it("compound: http + uppercase www host + uppercase path + query + fragment + trailing slash collapses to clean https/lowercase-host/case-preserved-path", () => {
    expect(
      canonicalizeCitationUrl(
        "HTTP://WWW.RitzBuilders.COM/Services/Whole-Home-Remodel/?utm=x&id=42#act-3",
      ),
    ).toBe("https://ritzbuilders.com/Services/Whole-Home-Remodel");
  });
});
