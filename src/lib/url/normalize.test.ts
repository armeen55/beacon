/**
 * Trust Sprint T6.6 (2026-05-06) — canonical URL normalizer behavioral
 * contract. Pins the helper against the exact contract callers expect:
 *
 *   - full Ritz URL → path
 *   - path stays path
 *   - trailing slash normalized
 *   - query stripped
 *   - hash stripped
 *   - external (competitor) URLs become path-only too — caller must do
 *     ownership classification SEPARATELY (helper is a path-normalizer,
 *     not an ownership check)
 *   - null/undefined/empty → null
 *   - URL parse failure falls back to string parse
 */

import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize";

describe("normalizeUrl", () => {
  describe("full Ritz URL → path", () => {
    it("https://ritzbuilders.com/locations/los-altos → /locations/los-altos", () => {
      expect(normalizeUrl("https://ritzbuilders.com/locations/los-altos")).toBe(
        "/locations/los-altos",
      );
    });

    it("https://www.ritzbuilders.com/services/whole-home-remodel → /services/whole-home-remodel", () => {
      expect(
        normalizeUrl("https://www.ritzbuilders.com/services/whole-home-remodel"),
      ).toBe("/services/whole-home-remodel");
    });

    it("http://ritzbuilders.com/locations/atherton → /locations/atherton", () => {
      expect(normalizeUrl("http://ritzbuilders.com/locations/atherton")).toBe(
        "/locations/atherton",
      );
    });
  });

  describe("path stays path", () => {
    it("/locations/los-altos → /locations/los-altos", () => {
      expect(normalizeUrl("/locations/los-altos")).toBe("/locations/los-altos");
    });

    it("/ → /", () => {
      expect(normalizeUrl("/")).toBe("/");
    });
  });

  describe("trailing slash normalization", () => {
    it("https://ritzbuilders.com/locations/los-altos/ → /locations/los-altos", () => {
      expect(
        normalizeUrl("https://ritzbuilders.com/locations/los-altos/"),
      ).toBe("/locations/los-altos");
    });

    it("/locations/los-altos/ → /locations/los-altos", () => {
      expect(normalizeUrl("/locations/los-altos/")).toBe("/locations/los-altos");
    });

    it("/locations/los-altos//// → /locations/los-altos (collapses repeated)", () => {
      expect(normalizeUrl("/locations/los-altos////")).toBe(
        "/locations/los-altos",
      );
    });

    it("https://ritzbuilders.com/ → /", () => {
      expect(normalizeUrl("https://ritzbuilders.com/")).toBe("/");
    });
  });

  describe("query and hash stripping", () => {
    it("https://ritzbuilders.com/path?query=1 → /path", () => {
      expect(normalizeUrl("https://ritzbuilders.com/path?query=1")).toBe("/path");
    });

    it("https://ritzbuilders.com/path#hash → /path", () => {
      expect(normalizeUrl("https://ritzbuilders.com/path#hash")).toBe("/path");
    });

    it("https://ritzbuilders.com/path?q=1#h → /path", () => {
      expect(normalizeUrl("https://ritzbuilders.com/path?q=1#h")).toBe("/path");
    });

    it("/path?query=1 → /path (string fallback strips query)", () => {
      expect(normalizeUrl("/path?query=1")).toBe("/path");
    });

    it("/path#hash → /path (string fallback strips hash)", () => {
      expect(normalizeUrl("/path#hash")).toBe("/path");
    });
  });

  describe("external (non-owned) URLs are still normalized to path", () => {
    it("https://demattei.com/services → /services (caller must do ownership classification)", () => {
      expect(normalizeUrl("https://demattei.com/services")).toBe("/services");
    });

    it("https://houzz.com/professionals → /professionals", () => {
      expect(normalizeUrl("https://houzz.com/professionals")).toBe(
        "/professionals",
      );
    });
  });

  describe("host-prefix without protocol", () => {
    it("ritzbuilders.com/locations → /locations", () => {
      expect(normalizeUrl("ritzbuilders.com/locations")).toBe("/locations");
    });

    it("ritzbuilders.com/locations/ → /locations", () => {
      expect(normalizeUrl("ritzbuilders.com/locations/")).toBe("/locations");
    });

    it("ritzbuilders.com/locations?q=1 → /locations (string fallback)", () => {
      expect(normalizeUrl("ritzbuilders.com/locations?q=1")).toBe("/locations");
    });
  });

  describe("empty / null / undefined", () => {
    it("null → null", () => {
      expect(normalizeUrl(null)).toBeNull();
    });

    it("undefined → null", () => {
      expect(normalizeUrl(undefined)).toBeNull();
    });

    it("empty string → null", () => {
      expect(normalizeUrl("")).toBeNull();
    });

    it("whitespace-only → null", () => {
      expect(normalizeUrl("   ")).toBeNull();
    });
  });

  describe("idempotency", () => {
    it("normalizeUrl(normalizeUrl(x)) === normalizeUrl(x)", () => {
      const inputs = [
        "https://ritzbuilders.com/locations/los-altos/",
        "/locations/los-altos",
        "ritzbuilders.com/locations?q=1",
        "/",
        "https://demattei.com/services?q=1#h",
      ];
      for (const input of inputs) {
        const once = normalizeUrl(input);
        const twice = normalizeUrl(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe("case normalization", () => {
    it("https://Ritzbuilders.com/Locations/Los-Altos → /locations/los-altos", () => {
      expect(
        normalizeUrl("https://Ritzbuilders.com/Locations/Los-Altos"),
      ).toBe("/locations/los-altos");
    });
  });

  describe("never throws", () => {
    it("malformed inputs return a path or null, never throw", () => {
      // The helper's contract is "always return a normalized path or
      // null, never throw". WHATWG URL parsing edge cases (empty host,
      // double-encoded, etc.) are not part of the public contract — we
      // just pin that they do NOT crash the analysis pipeline.
      const inputs = [
        "https:///just-path",
        "https://",
        "://broken",
        "javascript:void(0)",
        "data:text/plain,hello",
      ];
      for (const input of inputs) {
        expect(() => normalizeUrl(input)).not.toThrow();
      }
    });
  });
});
