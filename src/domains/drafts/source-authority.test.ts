import { describe, it, expect } from "vitest";
import {
  classifySourceAuthority,
  stampSourceAuthority,
  hasQualifyingAuthoritativeSource,
  extractDomain,
  claimTokens,
  findSupportingSpan,
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
    const sources = [{ domain: "britannica.com", claim: "the museum's collection includes thousands of artifacts", verified: true }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(true);
  });

  it("true via a tenant allowlist domain, only when that allowlist is supplied", () => {
    const sources = [{ domain: "sample-museum.org", claim: "the collection catalog lists over 3000 artifacts", verified: true }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, sources, ["sample-museum.org"])).toBe(true);
  });

  it("false when the source has a real domain but no claim (a bare URL is not a source)", () => {
    const sources = [{ domain: "britannica.com", verified: true }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });

  // W5 P0-1 (2026-07-09): the headline fix - an authoritative + on-topic source
  // that was NEVER generation-time verified does NOT qualify (a hallucinated
  // .gov/.edu URL cannot earn authoritative on domain class alone).
  it("false when an authoritative, on-topic source is not verified", () => {
    const sources = [{ domain: "britannica.com", claim: "the museum's collection includes thousands of artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false); // verified defaults undefined
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...sources[0]!, verified: false }])).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...sources[0]!, verified: true }])).toBe(true);
  });

  it("false for a hallucinated .gov URL that was not verified (domain class alone never passes)", () => {
    const sources = [{ url: "https://www.example.gov/made-up-page", claim: "the museum's collection includes thousands of artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
    // Only a generation-time verified fetch flips it.
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...sources[0]!, verified: true }])).toBe(true);
  });
});

// W5 stop-ship F2 (2026-07-09): the SPAN-LEVEL claim verifier that replaced the
// old whole-page token-share check. A claim must be entailed by ONE localized
// span (a sentence or an adjacent pair), not merely scattered across the page.
describe("findSupportingSpan (W5 stop-ship F2) - the span quartet", () => {
  const claim = "The Sample Museum holds 3000 artifacts.";

  it("1. finds a supporting sentence and returns its excerpt + a content hash", () => {
    const page =
      "The Sample Museum in the old district holds 3000 artifacts spanning several centuries. It opens daily to visitors.";
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(true);
    expect(r.excerpt).toContain("Sample Museum");
    expect(r.excerpt).toContain("3000");
    expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
    // The excerpt is a real slice of the page, never the claim itself.
    expect(page).toContain(r.excerpt!);
  });

  it("2. is UNSUPPORTED when the claim's tokens are scattered across the page but never colocated", () => {
    const page =
      "The Sample Museum is a lovely place. Many old buildings hold local history. Somewhere in town there are 3000 items counted. Artifacts fill the halls.";
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(false);
    expect(r.excerpt).toBeNull();
    expect(r.contentHash).toBeNull();
  });

  it("3. is UNSUPPORTED when a protected number is missing from the matching span", () => {
    const page = "The Sample Museum holds 5000 artifacts spanning several centuries.";
    // The claim's 3000 never appears; the page's 5000 does not satisfy it.
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(false);
  });

  it("4. is UNSUPPORTED when a protected entity is missing from the matching span", () => {
    const page = "The Tehran Museum holds 3000 artifacts spanning several centuries.";
    // "Sample Museum" never appears, so the number+coverage alone must not pass.
    const r = findSupportingSpan("The Sample Museum holds 3000 artifacts.", page);
    expect(r.supported).toBe(false);
  });

  it("supports a claim across an adjacent-sentence pair, not just a single sentence", () => {
    const page =
      "The Sample Museum opened in the old district. It holds 3000 artifacts spanning several centuries of regional history.";
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(true);
    expect(r.excerpt).toContain("Sample Museum");
    expect(r.excerpt).toContain("3000");
  });

  it("returns unsupported for an empty page or empty claim", () => {
    expect(findSupportingSpan(claim, "")).toEqual({ supported: false, excerpt: null, contentHash: null });
    expect(findSupportingSpan("", "some page text with words")).toEqual({
      supported: false,
      excerpt: null,
      contentHash: null,
    });
  });

  it("coverage boundary: exactly 0.6 (3 of 5 central tokens) passes; the step below (2 of 5) fails", () => {
    // The claim carries exactly 5 central tokens (museum, collection, displays,
    // ancient, artifacts): all lowercase (no protected entities), no numbers -
    // so ONLY the coverage rule decides. Single-sentence pages keep exactly one
    // candidate span (no adjacent pair can inflate coverage).
    const boundaryClaim = "museum collection displays ancient artifacts";

    // 3 of 5 tokens colocated -> coverage 0.6, exactly AT the inclusive bar.
    const atBar = findSupportingSpan(boundaryClaim, "the museum collection holds artifacts year round.");
    expect(atBar.supported).toBe(true);
    expect(atBar.excerpt).toContain("museum collection");

    // 2 of 5 tokens -> coverage 0.4, the nearest possible step below the bar.
    const belowBar = findSupportingSpan(boundaryClaim, "the museum collection stays open late.");
    expect(belowBar.supported).toBe(false);
    expect(belowBar.excerpt).toBeNull();
  });
});
