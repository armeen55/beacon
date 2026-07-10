import { describe, it, expect } from "vitest";
import {
  classifySourceAuthority,
  stampSourceAuthority,
  hasQualifyingAuthoritativeSource,
  draftFactsCoveredBySources,
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

  it("false when the only source is authoritative + verified but its excerpt does not entail the draft's claim", () => {
    const sources = [
      { domain: "britannica.com", claim: "the ancient trade routes crossed a mountain pass", verified: true },
    ];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });

  it("false when the source overlaps the draft's claim but is not authoritative", () => {
    const sources = [{ domain: "some-blog.example", claim: "the museum collection includes thousands of artifacts" }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
  });

  it("true when an authoritative, verified source's excerpt actually entails the draft's claim", () => {
    const sources = [
      {
        domain: "britannica.com",
        claim: "the Sample Museum's collection catalog lists over 3000 artifacts",
        verified: true,
        supportingExcerpt:
          "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.",
      },
    ];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(true);
  });

  it("true via a tenant allowlist domain, only when that allowlist is supplied", () => {
    const sources = [
      {
        domain: "sample-museum.org",
        claim: "the collection catalog lists over 3000 artifacts",
        verified: true,
        supportingExcerpt:
          "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.",
      },
    ];
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
    const sources = [
      {
        domain: "britannica.com",
        claim: "the Sample Museum's collection catalog lists over 3000 artifacts",
        supportingExcerpt:
          "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.",
      },
    ];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false); // verified defaults undefined
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...sources[0]!, verified: false }])).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...sources[0]!, verified: true }])).toBe(true);
  });

  it("false for a hallucinated .gov URL that was not verified (domain class alone never passes)", () => {
    const sources = [
      {
        url: "https://www.example.gov/made-up-page",
        claim: "the Sample Museum's collection catalog lists over 3000 artifacts",
        supportingExcerpt:
          "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.",
      },
    ];
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

// trust-230 (Codex P1): the fix for the vacuous single-token bug. Every
// PROTECTED claim in a draft (a non-structural number, a named entity, or a
// superlative) must be entailed by a verified authoritative source's excerpt,
// not merely share one topic word with it. The operator's coverage suite.
describe("draftFactsCoveredBySources (trust-230, Codex P1) - the operator's coverage suite", () => {
  /** A verified, authoritative (britannica.com) source whose fetched passage is
   *  `excerpt`. This is the shape the real gate consumes. */
  const src = (excerpt: string, extra: Record<string, unknown> = {}) => ({
    domain: "britannica.com",
    claim: excerpt,
    verified: true as const,
    supportingExcerpt: excerpt,
    ...extra,
  });

  // 1. one true source + two unsupported claims -> covered:false
  it("1. one true source covering one of three protected claims -> covered:false, the other two uncovered", () => {
    const draft =
      "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998. The Old Mill closed for repairs.";
    const r = draftFactsCoveredBySources(draft, [
      src("The Northgate Museum holds 3000 artifacts in its permanent collection."),
    ]);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toContain("The Riverside Gallery opened in 1998.");
    expect(r.uncovered).toContain("The Old Mill closed for repairs.");
    expect(r.uncovered).not.toContain("The Northgate Museum holds 3000 artifacts.");
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0]!.claim).toBe("The Northgate Museum holds 3000 artifacts.");
    expect(r.receipts[0]!.sourceUrl).toBe("britannica.com");
    expect(r.receipts[0]!.excerpt).toContain("3000");
  });

  // 2. single-token overlap ("Iran") -> false (the headline defect)
  it("2. a source that only shares one generic topic word never vacuously qualifies", () => {
    const draft = "The Northgate Museum displays 4200 artifacts from the region.";
    // Shares the token "northgate" but backs nothing about the 4200 artifacts.
    const r = draftFactsCoveredBySources(draft, [src("The Northgate district is a lively neighborhood.")]);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([draft]);
  });

  // 3. same entity, different number -> false
  it("3. same entity but a different number -> covered:false", () => {
    const draft = "The Northgate Museum holds 3000 artifacts.";
    const r = draftFactsCoveredBySources(draft, [src("The Northgate Museum holds 5000 artifacts.")]);
    expect(r.covered).toBe(false);
  });

  // 4. same number, different entity -> false
  it("4. same number but a different entity -> covered:false", () => {
    const draft = "The Northgate Museum holds 3000 artifacts.";
    const r = draftFactsCoveredBySources(draft, [src("The Southgate Museum holds 3000 artifacts.")]);
    expect(r.covered).toBe(false);
  });

  // 5. negated claim vs affirmative source -> false (negation-parity guard)
  it("5. a negated claim is NOT covered by an affirmative source (negation parity)", () => {
    const negated = "The Northgate Museum does not hold 3000 artifacts.";
    const affirmativeSource = [src("The Northgate Museum does hold 3000 artifacts.")];
    expect(draftFactsCoveredBySources(negated, affirmativeSource).covered).toBe(false);
    // The identical claim WITHOUT the negation is covered by the same source,
    // proving it is the polarity mismatch (not a token/number miss) that blocks.
    const affirmed = "The Northgate Museum does hold 3000 artifacts.";
    expect(draftFactsCoveredBySources(affirmed, affirmativeSource).covered).toBe(true);
  });

  // 6. two sources cover two claims -> true
  it("6. two sources, one per claim -> covered:true with two receipts", () => {
    const draft = "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998.";
    const r = draftFactsCoveredBySources(draft, [
      src("The Northgate Museum holds 3000 artifacts in its permanent collection."),
      src("The Riverside Gallery opened in 1998 downtown."),
    ]);
    expect(r.covered).toBe(true);
    expect(r.uncovered).toEqual([]);
    expect(r.receipts).toHaveLength(2);
  });

  // 7. one source, multiple claims -> true only if EACH is supported
  it("7. one source covers multiple claims only when its excerpt entails each one", () => {
    const draft = "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998.";
    const bothCovered = draftFactsCoveredBySources(draft, [
      src("The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998."),
    ]);
    expect(bothCovered.covered).toBe(true);
    const missesOne = draftFactsCoveredBySources(draft, [src("The Northgate Museum holds 3000 artifacts.")]);
    expect(missesOne.covered).toBe(false);
    expect(missesOne.uncovered).toEqual(["The Riverside Gallery opened in 1998."]);
  });

  // 8. appending an unsourced sentence turns the whole draft false
  it("8. appending one unsourced protected sentence flips the whole draft to covered:false", () => {
    const source = [src("The Northgate Museum holds 3000 artifacts in its permanent collection.")];
    const before = "The Northgate Museum holds 3000 artifacts.";
    expect(draftFactsCoveredBySources(before, source).covered).toBe(true);
    const after = "The Northgate Museum holds 3000 artifacts. The Old Mill closed in 1975.";
    const r = draftFactsCoveredBySources(after, source);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual(["The Old Mill closed in 1975."]);
  });

  // 10. tenant-neutral: two structurally-identical fixtures with different
  //     vocabulary behave BYTE-identically (no hardcoded tenant vocabulary).
  it("10. an Iranopedia-flavored and a Ritz-flavored fixture behave identically", () => {
    // Same shape: one protected sentence (entity + 5000), source excerpt entails it.
    const iranopedia = draftFactsCoveredBySources("The Nowruz festival drew 5000 visitors in Shiraz.", [
      src("The Nowruz festival drew 5000 visitors in Shiraz."),
    ]);
    const ritz = draftFactsCoveredBySources("The Lakeside project added 5000 square feet in Fremont.", [
      src("The Lakeside project added 5000 square feet in Fremont."),
    ]);
    expect(iranopedia.covered).toBe(true);
    expect(ritz.covered).toBe(iranopedia.covered);
    expect(ritz.receipts.length).toBe(iranopedia.receipts.length);
    expect(ritz.uncovered.length).toBe(iranopedia.uncovered.length);

    // And the negative parallel: an off-topic source fails identically for both.
    const iranopediaMiss = draftFactsCoveredBySources("The Nowruz festival drew 5000 visitors in Shiraz.", [
      src("An unrelated statement about mountain trade routes."),
    ]);
    const ritzMiss = draftFactsCoveredBySources("The Lakeside project added 5000 square feet in Fremont.", [
      src("An unrelated statement about mountain trade routes."),
    ]);
    expect(iranopediaMiss.covered).toBe(false);
    expect(ritzMiss.covered).toBe(iranopediaMiss.covered);
    expect(ritzMiss.uncovered.length).toBe(iranopediaMiss.uncovered.length);
  });
});

describe("draftFactsCoveredBySources - what does and does not contribute", () => {
  const draft = "The Northgate Museum holds 3000 artifacts.";
  const covering = "The Northgate Museum holds 3000 artifacts in its permanent collection.";

  it("a WEAK source (ordinary domain) never contributes, even verified with a covering excerpt", () => {
    const r = draftFactsCoveredBySources(draft, [
      { domain: "some-blog.example", claim: covering, verified: true, supportingExcerpt: covering },
    ]);
    expect(r.covered).toBe(false);
  });

  it("an UNVERIFIED authoritative source never contributes, even with a covering excerpt", () => {
    const r = draftFactsCoveredBySources(draft, [
      { domain: "britannica.com", claim: covering, verified: false, supportingExcerpt: covering },
    ]);
    expect(r.covered).toBe(false);
  });

  it("with NO excerpt, the source falls back to its `claim` as the evidence text", () => {
    const r = draftFactsCoveredBySources(draft, [
      { domain: "britannica.com", claim: covering, verified: true },
    ]);
    expect(r.covered).toBe(true);
  });

  it("an authoritative + verified source with neither excerpt nor claim contributes nothing", () => {
    const r = draftFactsCoveredBySources(draft, [
      { url: "https://www.example.gov/x", verified: true },
    ]);
    expect(r.covered).toBe(false);
  });

  // Detector-mismatch closure (trust-230 follow-up): a FACTUAL draft with no
  // individually-isolable protected sentence (a lowercase definitional
  // assertion - no capitalized entity, no number, no superlative) must NOT be
  // waved through. The function is only reached once the caller established the
  // draft is factual, so it still requires >= 1 qualifying source.
  it("a factual draft with no isolable protected sentence still requires a source (zero sources -> covered:false)", () => {
    const definitional = "the gathering is a shared meal enjoyed by neighbors every season.";
    const r = draftFactsCoveredBySources(definitional, []);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([]);
  });

  it("the SAME no-isolable-claim draft is covered once one qualifying authoritative verified source is attached", () => {
    const definitional = "the gathering is a shared meal enjoyed by neighbors every season.";
    const r = draftFactsCoveredBySources(definitional, [
      {
        domain: "britannica.com",
        claim: "the gathering is a shared meal enjoyed by neighbors every season",
        verified: true,
        supportingExcerpt: "the gathering is a shared meal enjoyed by neighbors every season",
      },
    ]);
    expect(r.covered).toBe(true);
    expect(r.receipts).toHaveLength(1);
  });

  it("a superlative alone makes a sentence protected (it needs a source too)", () => {
    const superlative = "it remains the best value around.";
    expect(draftFactsCoveredBySources(superlative, []).covered).toBe(false);
  });

  it("boolean wrapper parity: hasQualifyingAuthoritativeSource === draftFactsCoveredBySources(...).covered", () => {
    const sources = [{ domain: "britannica.com", claim: covering, verified: true, supportingExcerpt: covering }];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(draftFactsCoveredBySources(draft, sources).covered);
    expect(hasQualifyingAuthoritativeSource(draft, [])).toBe(draftFactsCoveredBySources(draft, []).covered);
    const offTopic = [{ domain: "britannica.com", claim: "unrelated", verified: true, supportingExcerpt: "unrelated" }];
    expect(hasQualifyingAuthoritativeSource(draft, offTopic)).toBe(draftFactsCoveredBySources(draft, offTopic).covered);
  });
});

// Re-audit P2 (2026-07-10): a factual claim written with Persian/Arabic-Indic
// numerals was invisible to the ASCII-only protected-sentence number check, so
// it fell into the weaker zero-protected branch that never checks a number
// against any source excerpt - any qualifying source (even one describing a
// different number) satisfied it. Generic/tenant-neutral subject on purpose.
describe("draftFactsCoveredBySources - non-ASCII numeral coverage (re-audit P2)", () => {
  const claimWithPersianNumeral = "The reserve holds ۳۰۰۰ species of rare plants.";

  it("a Persian/Arabic-Indic numeral claim is NOT covered by a source that does not back that number", () => {
    const r = draftFactsCoveredBySources(claimWithPersianNumeral, [
      {
        domain: "britannica.com",
        claim: "The reserve holds 500 species of rare plants.",
        verified: true,
        supportingExcerpt: "The reserve holds 500 species of rare plants.",
      },
    ]);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([claimWithPersianNumeral]);
  });

  it("the SAME Persian/Arabic-Indic numeral claim IS covered once a qualifying source's excerpt carries that numeral", () => {
    const r = draftFactsCoveredBySources(claimWithPersianNumeral, [
      {
        domain: "britannica.com",
        claim: "The reserve holds ۳۰۰۰ species of rare plants in its annual survey.",
        verified: true,
        supportingExcerpt:
          "The reserve holds ۳۰۰۰ species of rare plants in its annual survey.",
      },
    ]);
    expect(r.covered).toBe(true);
    expect(r.receipts).toHaveLength(1);
  });

  it("boolean wrapper parity holds for the Persian-numeral claim too", () => {
    const noBacker = [
      {
        domain: "britannica.com",
        claim: "The reserve holds 500 species of rare plants.",
        verified: true,
        supportingExcerpt: "The reserve holds 500 species of rare plants.",
      },
    ];
    expect(hasQualifyingAuthoritativeSource(claimWithPersianNumeral, noBacker)).toBe(
      draftFactsCoveredBySources(claimWithPersianNumeral, noBacker).covered,
    );
  });
});
