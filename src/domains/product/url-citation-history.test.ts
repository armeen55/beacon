import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./url-citation-history";

describe("normalizeUrl", () => {
  it("strips scheme + host + trailing slash for full URLs", () => {
    expect(normalizeUrl("https://ritzbuilders.com/locations/palo-alto/")).toBe(
      "/locations/palo-alto",
    );
    expect(normalizeUrl("http://www.ritzbuilders.com/services/foo")).toBe(
      "/services/foo",
    );
    expect(normalizeUrl("https://ritzbuilders.com/")).toBe("/");
    expect(normalizeUrl("https://ritzbuilders.com")).toBe("/");
  });

  it("leaves path-only URLs alone (normalised)", () => {
    expect(normalizeUrl("/locations/palo-alto")).toBe("/locations/palo-alto");
    expect(normalizeUrl("/locations/palo-alto/")).toBe("/locations/palo-alto");
    expect(normalizeUrl("/")).toBe("/");
  });

  it("strips host-looking segment when no leading slash", () => {
    expect(normalizeUrl("ritzbuilders.com/services/foo")).toBe("/services/foo");
    expect(normalizeUrl("www.ritzbuilders.com/locations/atherton")).toBe(
      "/locations/atherton",
    );
  });

  it("matches same page across representations", () => {
    const forms = [
      "https://ritzbuilders.com/locations/palo-alto",
      "https://ritzbuilders.com/locations/palo-alto/",
      "http://www.ritzbuilders.com/locations/palo-alto",
      "/locations/palo-alto",
      "/locations/palo-alto/",
      "ritzbuilders.com/locations/palo-alto/",
    ];
    const normalized = forms.map(normalizeUrl);
    const unique = [...new Set(normalized)];
    expect(unique).toEqual(["/locations/palo-alto"]);
  });

  it("handles null / empty / whitespace", () => {
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("lowercases the path", () => {
    expect(normalizeUrl("/Locations/Palo-Alto")).toBe("/locations/palo-alto");
    expect(normalizeUrl("https://Ritzbuilders.COM/Services")).toBe("/services");
  });

  it("handles non-standard values gracefully (e.g. Profound, GBP)", () => {
    // Non-URL tokens get treated as paths.
    expect(normalizeUrl("Profound")).toBe("/profound");
    expect(normalizeUrl("Google Business Profile")).toBe("/google business profile");
  });
});
