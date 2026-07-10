import { describe, it, expect } from "vitest";
import {
  classifySourceAuthority,
  stampSourceAuthority,
  hasQualifyingAuthoritativeSource,
  extractDomain,
  claimTokens,
} from "./source-authority";

describe("classifySourceAuthority (W5, J-69)", () => {
  it("a .gov domain is authoritative with no configuration", () => {
    expect(
      classifySourceAuthority({ url: "https://www.loc.gov/item/x", claim: "the record dates to 1850" }),
    ).toBe("authoritative");
  });

  it("a .edu domain is authoritative with no configuration", () => {
    expect(
      classifySourceAuthority({ domain: "stanford.edu", claim: "the study found X" }),
    ).toBe("authoritative");
  });

  it("a small named encyclopedic/press domain is authoritative", () => {
    expect(classifySourceAuthority({ domain: "britannica.com", claim: "Nowruz marks the new year" })).toBe(
      "authoritative",
    );
    expect(classifySourceAuthority({ domain: "reuters.com", claim: "reported the figure" })).toBe("authoritative");
  });

  it("a subdomain of a named authoritative domain also counts", () => {
    expect(classifySourceAuthority({ domain: "www.britannica.com", claim: "x" })).toBe("authoritative");
  });

  it("an ordinary domain with a real claim is weak, not authoritative", () => {
    expect(classifySourceAuthority({ domain: "some-blog.example", claim: "the site says X" })).toBe("weak");
  });

  it("a bare URL with no claim counts as no source (unverified), regardless of domain", () => {
    expect(classifySourceAuthority({ domain: "britannica.com", claim: "" })).toBe("unverified");
    expect(classifySourceAuthority({ domain: "britannica.com" })).toBe("unverified");
    expect(classifySourceAuthority({ url: "https://www.loc.gov/item/x" })).toBe("unverified");
  });

  it("an unresolvable domain (no url, no domain) is unverified", () => {
    expect(classifySourceAuthority({ claim: "something" })).toBe("unverified");
  });

  // J-69 (tenant allowlist)
  it("a tenant allowlist domain is authoritative ONLY when that allowlist is supplied", () => {
    const source = { domain: "sample-museum.org", claim: "the collection has 3000 artifacts" };
    expect(classifySourceAuthority(source)).toBe("weak");
    expect(classifySourceAuthority(source, ["sample-museum.org"])).toBe("authoritative");
    expect(classifySourceAuthority(source, ["some-other-domain.org"])).toBe("weak");
  });

  it("a tenant allowlist entry matches a subdomain too", () => {
    const source = { domain: "archive.sample-museum.org", claim: "x" };
    expect(classifySourceAuthority(source, ["sample-museum.org"])).toBe("authoritative");
  });

  it("never trusts the LLM's own proposed authority value", () => {
    // A source that claims to be "authoritative" on a weak domain is still weak.
    const source = { domain: "some-blog.example", claim: "x", authority: "authoritative" as const };
    expect(classifySourceAuthority(source)).toBe("weak");
  });
});

describe("extractDomain", () => {
  it("prefers the explicit domain field", () => {
    expect(extractDomain({ domain: "www.Example.com", url: "https://other.com" })).toBe("example.com");
  });
  it("extracts a domain from a URL when domain is absent", () => {
    expect(extractDomain({ url: "https://www.britannica.com/topic/x" })).toBe("britannica.com");
  });
  it("tolerates a scheme-less URL", () => {
    expect(extractDomain({ url: "britannica.com/topic/x" })).toBe("britannica.com");
  });
  it("returns empty string for a malformed/absent URL", () => {
    expect(extractDomain({})).toBe("");
    expect(extractDomain({ url: "not a url at all" })).toBe("");
  });
});

describe("stampSourceAuthority", () => {
  it("overwrites the authority field with the deterministic classification", () => {
    const input = [
      { domain: "britannica.com", claim: "x", authority: "unverified" as const },
      { domain: "some-blog.example", claim: "y", authority: "authoritative" as const },
    ];
    const stamped = stampSourceAuthority(input);
    expect(stamped[0]!.authority).toBe("authoritative");
    expect(stamped[1]!.authority).toBe("weak");
  });

  it("does not mutate the input array", () => {
    const input = [{ domain: "britannica.com", claim: "x", authority: "unverified" as const }];
    const stamped = stampSourceAuthority(input);
    expect(input[0]!.authority).toBe("unverified");
    expect(stamped).not.toBe(input);
  });

  it("returns [] for an empty or undefined input", () => {
    expect(stampSourceAuthority(undefined)).toEqual([]);
    expect(stampSourceAuthority([])).toEqual([]);
  });
});

describe("claimTokens", () => {
  it("drops short words and stopwords, keeps significant 4+ letter words", () => {
    const tokens = claimTokens("The museum's collection has over 3000 artifacts from this region");
    expect(tokens).toContain("museum");
    expect(tokens).toContain("collection");
    expect(tokens).toContain("artifacts");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("this");
    expect(tokens).not.toContain("has");
  });
});

describe("hasQualifyingAuthoritativeSource", () => {
  const draft =
    "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.";

  it("false when there are no sources at all", () => {
    expect(hasQualifyingAuthoritativeSource(draft, undefined)).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, [])).toBe(false);
  });

  it("false when the only source is authoritative but shares no claim tokens with the draft", () => {
    const sources = [{ domain: "britannica.com", claim: "the ancient trade routes crossed a mountain pass" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });

  it("false when the source overlaps the draft's claim but is not authoritative", () => {
    const sources = [{ domain: "some-blog.example", claim: "the museum collection includes thousands of artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });

  it("true when an authoritative source's claim overlaps the draft's own claim tokens", () => {
    const sources = [{ domain: "britannica.com", claim: "the museum's collection includes thousands of artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(true);
  });

  it("true via a tenant allowlist domain, only when that allowlist is supplied", () => {
    const sources = [{ domain: "sample-museum.org", claim: "the collection catalog lists over 3000 artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, sources, ["sample-museum.org"])).toBe(true);
  });

  it("false when the source has a real domain but no claim (a bare URL is not a source)", () => {
    const sources = [{ domain: "britannica.com" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });
});
