/**
 * 2026-05-19 — Slice 9.A2γ.1 — normalize-page-path.ts unit tests.
 *
 * Pins the pure helper behavior:
 *   • Path-only input + domain → full URL
 *   • Trailing slash preserved
 *   • Already-full URL pass-through (http or https)
 *   • Domain hygiene (www. / scheme / trailing slash / case)
 *   • Empty / null / whitespace pagePath → ""
 *   • Empty / null / whitespace domain → path-only soft-fail
 *   • Malformed (no leading /) → trimmed input
 *   • Whitespace edges trimmed
 *   • Never throws on any input
 *   • Deterministic on input (pure)
 */

import { describe, it, expect } from "vitest";
import {
  normalizeGa4PagePathToFullUrl,
  __testing,
} from "@/lib/connectors/ga4/normalize-page-path";

// ─────────────────────────────────────────────────────────────────────
// Path-only + domain → full URL (the central case)
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — path-only + domain", () => {
  it("prefixes a simple path-only input with https://{domain}", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/services/whole-home-remodel");
  });

  it("preserves trailing slash on the path", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel/",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/services/whole-home-remodel/");
  });

  it("handles multi-segment paths", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/admin/projects/abc123",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/admin/projects/abc123");
  });

  it("handles root path", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Already-full URL pass-through
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — already-full URL", () => {
  it("returns https URL unchanged", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "https://ritzbuilders.com/services/whole-home-remodel",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/services/whole-home-remodel");
  });

  it("returns http URL unchanged (does NOT silently upgrade to https)", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "http://example.com/foo",
        domain: "ritzbuilders.com",
      }),
    ).toBe("http://example.com/foo");
  });

  it("returns full URL unchanged even when domain is empty", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "https://ritzbuilders.com/foo",
        domain: "",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("preserves query + fragment on full URLs (canonicalizer handles strip later)", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "https://ritzbuilders.com/foo?utm_source=x#section",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/foo?utm_source=x#section");
  });

  it("treats scheme case-insensitively", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "HTTPS://example.com/foo",
        domain: "ritzbuilders.com",
      }),
    ).toBe("HTTPS://example.com/foo");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Domain hygiene
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — domain hygiene", () => {
  it("strips leading www. from domain", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "www.ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("strips leading https:// from domain", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "https://ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("strips leading http:// from domain", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "http://ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("strips trailing slash from domain", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "ritzbuilders.com/",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("lowercases domain (host is case-insensitive)", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "RitzBuilders.COM",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("strips a combined scheme + www. + trailing slash", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "https://www.ritzbuilders.com/",
      }),
    ).toBe("https://ritzbuilders.com/foo");
  });

  it("__testing.cleanDomain is exposed for direct testing of edge cases", () => {
    expect(__testing.cleanDomain("WWW.Example.COM/")).toBe("example.com");
    expect(__testing.cleanDomain("  ")).toBe("");
    expect(__testing.cleanDomain(null)).toBe("");
    expect(__testing.cleanDomain(undefined)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty / null / whitespace pagePath
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — empty pagePath", () => {
  it("returns empty string for null pagePath", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: null,
        domain: "ritzbuilders.com",
      }),
    ).toBe("");
  });

  it("returns empty string for undefined pagePath", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: undefined,
        domain: "ritzbuilders.com",
      }),
    ).toBe("");
  });

  it("returns empty string for empty pagePath", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "",
        domain: "ritzbuilders.com",
      }),
    ).toBe("");
  });

  it("returns empty string for whitespace-only pagePath", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "   \t  ",
        domain: "ritzbuilders.com",
      }),
    ).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Missing / empty domain → soft-fail (path-only preserved)
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — missing domain (soft-fail)", () => {
  it("returns path-only unchanged when domain is null", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel",
        domain: null,
      }),
    ).toBe("/services/whole-home-remodel");
  });

  it("returns path-only unchanged when domain is undefined", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel",
        domain: undefined,
      }),
    ).toBe("/services/whole-home-remodel");
  });

  it("returns path-only unchanged when domain is empty string", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel",
        domain: "",
      }),
    ).toBe("/services/whole-home-remodel");
  });

  it("returns path-only unchanged when domain is whitespace-only", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel",
        domain: "   ",
      }),
    ).toBe("/services/whole-home-remodel");
  });

  it("preserves trailing slash on soft-fail", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/services/whole-home-remodel/",
        domain: "",
      }),
    ).toBe("/services/whole-home-remodel/");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Whitespace trimming
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — whitespace trimming", () => {
  it("trims whitespace from pagePath edges", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "  /services/foo  ",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/services/foo");
  });

  it("trims tabs + newlines", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "\t/services/foo\n",
        domain: "ritzbuilders.com",
      }),
    ).toBe("https://ritzbuilders.com/services/foo");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Malformed inputs (defensive)
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — malformed inputs", () => {
  it("returns trimmed input unchanged when pagePath has no leading /", () => {
    // Defensive: GA4 should never emit this shape for pagePath, but
    // the helper is total — Mode A's upstream canonicalizer will
    // reject these consistently.
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "services/foo",
        domain: "ritzbuilders.com",
      }),
    ).toBe("services/foo");
  });

  it("returns scheme-only string unchanged", () => {
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "javascript:foo",
        domain: "ritzbuilders.com",
      }),
    ).toBe("javascript:foo");
  });

  it("returns empty-host-after-clean unchanged when domain reduces to empty", () => {
    // Edge case: domain that's literally just "https://" reduces to
    // "" after cleaning, triggering the soft-fail path.
    expect(
      normalizeGa4PagePathToFullUrl({
        pagePath: "/foo",
        domain: "https://",
      }),
    ).toBe("/foo");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure / total / never-throws
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — purity invariants", () => {
  it("does not throw on bizarre inputs", () => {
    expect(() =>
      normalizeGa4PagePathToFullUrl({ pagePath: "\0\x01\x02", domain: "x" }),
    ).not.toThrow();
    expect(() =>
      normalizeGa4PagePathToFullUrl({ pagePath: "/" + "a".repeat(10_000), domain: "x.com" }),
    ).not.toThrow();
    expect(() =>
      normalizeGa4PagePathToFullUrl({ pagePath: undefined, domain: undefined }),
    ).not.toThrow();
  });

  it("is deterministic on input (same args → same output)", () => {
    const args = { pagePath: "/foo", domain: "bar.com" };
    const a = normalizeGa4PagePathToFullUrl(args);
    const b = normalizeGa4PagePathToFullUrl(args);
    const c = normalizeGa4PagePathToFullUrl(args);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end Mode A matchability (the actual goal of this slice)
// ─────────────────────────────────────────────────────────────────────

describe("normalizeGa4PagePathToFullUrl — Mode A matchability", () => {
  // The point of the helper is that after normalization, the stored
  // url is structurally the same as `recommended_edits.target_url`
  // (modulo trailing slash, which the canonicalizer strips later).
  it("whole-home-remodel: path-only + trailing slash → full URL matching the verified-live edit's target_url shape", () => {
    const target = "https://ritzbuilders.com/services/whole-home-remodel";
    const fromGa4WithSlash = normalizeGa4PagePathToFullUrl({
      pagePath: "/services/whole-home-remodel/",
      domain: "ritzbuilders.com",
    });
    const fromGa4WithoutSlash = normalizeGa4PagePathToFullUrl({
      pagePath: "/services/whole-home-remodel",
      domain: "ritzbuilders.com",
    });
    // Both Mode A canonicalizer pass-throughs strip the trailing
    // slash, so both variants will reconcile to `target` after the
    // canonicalizer runs at read time. The persist helper does NOT
    // need to also strip the slash — that's the canonicalizer's job.
    expect(fromGa4WithSlash.startsWith(target)).toBe(true);
    expect(fromGa4WithoutSlash).toBe(target);
  });
});
