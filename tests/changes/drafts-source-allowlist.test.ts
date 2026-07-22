/**
 * Source authority + tenant allowlist (Core 100K Phase 6 merge of
 * src/domains/drafts/source-authority.test.ts + tenant-source-allowlist.test.ts,
 * trimmed to boundary cases).
 *
 * Pins J-69's deterministic authority ladder: only a VERIFIED source on an
 * authoritative (or tenant-allowlisted) domain whose excerpt ENTAILS the
 * draft's protected claims counts; the LLM's own proposed authority is never
 * trusted; a hallucinated .gov URL never passes on domain class alone;
 * negation parity; the span-level 0.6 coverage boundary; superlative parity;
 * Persian/Arabic-Indic numerals are protected too.
 */
import { describe, it, expect } from "vitest";
import {
  classifySourceAuthority,
  stampSourceAuthority,
  hasQualifyingAuthoritativeSource,
  draftFactsCoveredBySources,
  pageEntailsDraftClaims,
  extractDomain,
  findSupportingSpan,
  ungroundedSuperlatives,
  isEntityRichTopic,
  looksLikeListOrIndexUrl,
} from "@/domains/drafts/source-authority";
import { getCuratedSourceDomains } from "@/domains/drafts/tenant-source-allowlist";

describe("classifySourceAuthority (W5, J-69)", () => {
  it(".gov/.edu and named encyclopedic/press domains (incl. subdomains) are authoritative with no configuration", () => {
    expect(classifySourceAuthority({ url: "https://www.loc.gov/item/x", claim: "the record dates to 1850" })).toBe("authoritative");
    expect(classifySourceAuthority({ domain: "stanford.edu", claim: "the study found X" })).toBe("authoritative");
    expect(classifySourceAuthority({ domain: "www.britannica.com", claim: "Nowruz marks the new year" })).toBe("authoritative");
  });

  it("an ordinary domain with a real claim is weak, not authoritative", () => {
    expect(classifySourceAuthority({ domain: "some-blog.example", claim: "the site says X" })).toBe("weak");
  });

  it("a bare URL with no claim counts as no source (unverified), regardless of domain", () => {
    expect(classifySourceAuthority({ domain: "britannica.com", claim: "" })).toBe("unverified");
    expect(classifySourceAuthority({ url: "https://www.loc.gov/item/x" })).toBe("unverified");
    expect(classifySourceAuthority({ claim: "something" })).toBe("unverified");
  });

  it("a tenant allowlist domain (incl. subdomains) is authoritative ONLY when that allowlist is supplied", () => {
    const source = { domain: "sample-museum.org", claim: "the collection has 3000 artifacts" };
    expect(classifySourceAuthority(source)).toBe("weak");
    expect(classifySourceAuthority(source, ["sample-museum.org"])).toBe("authoritative");
    expect(classifySourceAuthority(source, ["some-other-domain.org"])).toBe("weak");
    expect(classifySourceAuthority({ domain: "archive.sample-museum.org", claim: "x" }, ["sample-museum.org"])).toBe("authoritative");
  });

  it("never trusts the LLM's own proposed authority value", () => {
    const source = { domain: "some-blog.example", claim: "x", authority: "authoritative" as const };
    expect(classifySourceAuthority(source)).toBe("weak");
  });
});

describe("extractDomain + stampSourceAuthority", () => {
  it("prefers the explicit domain field, extracts from URL otherwise, empty for malformed", () => {
    expect(extractDomain({ domain: "www.Example.com", url: "https://other.com" })).toBe("example.com");
    expect(extractDomain({ url: "https://www.britannica.com/topic/x" })).toBe("britannica.com");
    expect(extractDomain({ url: "britannica.com/topic/x" })).toBe("britannica.com");
    expect(extractDomain({})).toBe("");
  });

  it("stampSourceAuthority overwrites the authority field with the deterministic classification", () => {
    const input = [
      { domain: "britannica.com", claim: "x", authority: "unverified" as const },
      { domain: "some-blog.example", claim: "y", authority: "authoritative" as const },
    ];
    const stamped = stampSourceAuthority(input);
    expect(stamped[0]!.authority).toBe("authoritative");
    expect(stamped[1]!.authority).toBe("weak");
  });
});

describe("hasQualifyingAuthoritativeSource", () => {
  const draft =
    "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history.";

  it("false with no sources, a bare URL, or a non-entailing excerpt", () => {
    expect(hasQualifyingAuthoritativeSource(draft, undefined)).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, [{ domain: "britannica.com", verified: true }])).toBe(false);
    expect(
      hasQualifyingAuthoritativeSource(draft, [
        { domain: "britannica.com", claim: "the ancient trade routes crossed a mountain pass", verified: true },
      ]),
    ).toBe(false);
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
        supportingExcerpt: draft,
      },
    ];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(true);
  });

  it("false for an unverified authoritative source or a hallucinated .gov URL (domain class alone never passes)", () => {
    const onTopic = {
      domain: "britannica.com",
      claim: "the Sample Museum's collection catalog lists over 3000 artifacts",
      supportingExcerpt: draft,
    };
    expect(hasQualifyingAuthoritativeSource(draft, [onTopic])).toBe(false); // verified defaults undefined
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...onTopic, verified: false }])).toBe(false);
    const fakeGov = {
      url: "https://www.example.gov/made-up-page",
      claim: "the Sample Museum's collection catalog lists over 3000 artifacts",
      supportingExcerpt: draft,
    };
    expect(hasQualifyingAuthoritativeSource(draft, [fakeGov])).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, [{ ...fakeGov, verified: true }])).toBe(true);
  });

  it("true via a tenant allowlist domain, only when that allowlist is supplied", () => {
    const sources = [
      {
        domain: "sample-museum.org",
        claim: "the collection catalog lists over 3000 artifacts",
        verified: true,
        supportingExcerpt: draft,
      },
    ];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(false);
    expect(hasQualifyingAuthoritativeSource(draft, sources, ["sample-museum.org"])).toBe(true);
  });
});

describe("findSupportingSpan (W5 stop-ship F2) - the span quartet", () => {
  const claim = "The Sample Museum holds 3000 artifacts.";

  it("finds a supporting sentence and returns its excerpt + a content hash", () => {
    const page =
      "The Sample Museum in the old district holds 3000 artifacts spanning several centuries. It opens daily to visitors.";
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(true);
    expect(r.excerpt).toContain("Sample Museum");
    expect(r.excerpt).toContain("3000");
    expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(page).toContain(r.excerpt!);
  });

  it("is UNSUPPORTED when the claim's tokens are scattered across the page but never colocated", () => {
    const page =
      "The Sample Museum is a lovely place. Many old buildings hold local history. Somewhere in town there are 3000 items counted. Artifacts fill the halls.";
    const r = findSupportingSpan(claim, page);
    expect(r.supported).toBe(false);
    expect(r.excerpt).toBeNull();
  });

  it("is UNSUPPORTED when a protected number or entity is missing from the matching span", () => {
    expect(findSupportingSpan(claim, "The Sample Museum holds 5000 artifacts spanning several centuries.").supported).toBe(false);
    expect(findSupportingSpan(claim, "The Tehran Museum holds 3000 artifacts spanning several centuries.").supported).toBe(false);
  });

  it("coverage boundary: exactly 0.6 (3 of 5 central tokens) passes; the step below (2 of 5) fails", () => {
    const boundaryClaim = "museum collection displays ancient artifacts";
    const atBar = findSupportingSpan(boundaryClaim, "the museum collection holds artifacts year round.");
    expect(atBar.supported).toBe(true);
    const belowBar = findSupportingSpan(boundaryClaim, "the museum collection stays open late.");
    expect(belowBar.supported).toBe(false);
  });
});

describe("draftFactsCoveredBySources (trust-230) - per-claim coverage", () => {
  const src = (excerpt: string, extra: Record<string, unknown> = {}) => ({
    domain: "britannica.com",
    claim: excerpt,
    verified: true as const,
    supportingExcerpt: excerpt,
    ...extra,
  });

  it("one true source covering one of three protected claims -> covered:false, the other two uncovered", () => {
    const draft =
      "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998. The Old Mill closed for repairs.";
    const r = draftFactsCoveredBySources(draft, [
      src("The Northgate Museum holds 3000 artifacts in its permanent collection."),
    ]);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toContain("The Riverside Gallery opened in 1998.");
    expect(r.uncovered).not.toContain("The Northgate Museum holds 3000 artifacts.");
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0]!.excerpt).toContain("3000");
  });

  it("a source that only shares one generic topic word never vacuously qualifies", () => {
    const draft = "The Northgate Museum displays 4200 artifacts from the region.";
    const r = draftFactsCoveredBySources(draft, [src("The Northgate district is a lively neighborhood.")]);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([draft]);
  });

  it("a negated claim is NOT covered by an affirmative source (negation parity)", () => {
    const negated = "The Northgate Museum does not hold 3000 artifacts.";
    const affirmativeSource = [src("The Northgate Museum does hold 3000 artifacts.")];
    expect(draftFactsCoveredBySources(negated, affirmativeSource).covered).toBe(false);
    expect(draftFactsCoveredBySources("The Northgate Museum does hold 3000 artifacts.", affirmativeSource).covered).toBe(true);
  });

  it("two sources, one per claim -> covered:true; appending one unsourced protected sentence flips it back", () => {
    const draft = "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened in 1998.";
    const sources = [
      src("The Northgate Museum holds 3000 artifacts in its permanent collection."),
      src("The Riverside Gallery opened in 1998 downtown."),
    ];
    expect(draftFactsCoveredBySources(draft, sources).covered).toBe(true);
    const appended = `${draft} The Old Mill closed in 1975.`;
    const r = draftFactsCoveredBySources(appended, sources);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual(["The Old Mill closed in 1975."]);
  });

  it("a WEAK or UNVERIFIED source never contributes, even with a covering excerpt", () => {
    const draft = "The Northgate Museum holds 3000 artifacts.";
    const covering = "The Northgate Museum holds 3000 artifacts in its permanent collection.";
    expect(
      draftFactsCoveredBySources(draft, [
        { domain: "some-blog.example", claim: covering, verified: true, supportingExcerpt: covering },
      ]).covered,
    ).toBe(false);
    expect(
      draftFactsCoveredBySources(draft, [
        { domain: "britannica.com", claim: covering, verified: false, supportingExcerpt: covering },
      ]).covered,
    ).toBe(false);
  });

  it("a factual draft with no isolable protected sentence still requires >= 1 qualifying source", () => {
    const definitional = "the gathering is a shared meal enjoyed by neighbors every season.";
    expect(draftFactsCoveredBySources(definitional, []).covered).toBe(false);
    expect(
      draftFactsCoveredBySources(definitional, [
        {
          domain: "britannica.com",
          claim: definitional,
          verified: true,
          supportingExcerpt: definitional,
        },
      ]).covered,
    ).toBe(true);
  });

  it("a superlative alone makes a sentence protected (it needs a source too)", () => {
    expect(draftFactsCoveredBySources("it remains the best value around.", []).covered).toBe(false);
  });

  it("a Persian/Arabic-Indic numeral claim is protected: not covered by a different number, covered when the numeral is backed", () => {
    const claim = "The reserve holds ۳۰۰۰ species of rare plants.";
    const wrongNumber = draftFactsCoveredBySources(claim, [
      src("The reserve holds 500 species of rare plants."),
    ]);
    expect(wrongNumber.covered).toBe(false);
    const backed = draftFactsCoveredBySources(claim, [
      src("The reserve holds ۳۰۰۰ species of rare plants in its annual survey."),
    ]);
    expect(backed.covered).toBe(true);
  });

  it("boolean wrapper parity: hasQualifyingAuthoritativeSource === draftFactsCoveredBySources(...).covered", () => {
    const draft = "The Northgate Museum holds 3000 artifacts.";
    const covering = "The Northgate Museum holds 3000 artifacts in its permanent collection.";
    const sources = [src(covering)];
    expect(hasQualifyingAuthoritativeSource(draft, sources)).toBe(draftFactsCoveredBySources(draft, sources).covered);
    expect(hasQualifyingAuthoritativeSource(draft, [])).toBe(draftFactsCoveredBySources(draft, []).covered);
  });
});

describe("G6 roundup full-text coverage + pageEntailsDraftClaims", () => {
  const page = (fullText: string, domain = "britannica.com") => ({
    domain,
    claim: fullText.slice(0, 120),
    verified: true as const,
    supportingExcerpt: fullText.slice(0, 200),
    fetchedText: fullText,
  });

  const roundup =
    "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened downtown. " +
    "The Old Mill served the valley farmers. The Harbor Lighthouse guided passing ships. " +
    "The Grand Theatre staged classical operas. The Central Library preserved rare manuscripts.";

  it("a 6-entity roundup fully covered by 2 qualifying source PAGES passes; with 2 uncovered entities it HOLDS, naming them", () => {
    const pageA = page(
      "The Northgate Museum holds 3000 artifacts in its permanent collection. " +
        "The Riverside Gallery opened downtown near the plaza. " +
        "The Old Mill served the valley farmers for a century.",
    );
    const pageB = page(
      "The Harbor Lighthouse guided passing ships into the bay. " +
        "The Grand Theatre staged classical operas each winter. " +
        "The Central Library preserved rare manuscripts from the region.",
    );
    const full = draftFactsCoveredBySources(roundup, [pageA, pageB]);
    expect(full.covered).toBe(true);
    expect(full.receipts).toHaveLength(6);

    const partialA = page(
      "The Northgate Museum holds 3000 artifacts in its permanent collection. " +
        "The Riverside Gallery opened downtown near the plaza.",
    );
    const partialB = page(
      "The Harbor Lighthouse guided passing ships into the bay. " +
        "The Grand Theatre staged classical operas each winter.",
    );
    const held = draftFactsCoveredBySources(roundup, [partialA, partialB]);
    expect(held.covered).toBe(false);
    expect(held.uncovered).toContain("The Old Mill served the valley farmers.");
    expect(held.uncovered).toContain("The Central Library preserved rare manuscripts.");
  });

  it("full-text coverage honors the tenant allowlist (a wikipedia.org list page covers names only when allowlisted)", () => {
    const wikiPage = {
      domain: "wikipedia.org",
      claim: "list of iranian singers",
      verified: true as const,
      fetchedText:
        "The Northgate Museum holds 3000 artifacts in its permanent collection. The Riverside Gallery opened downtown near the plaza.",
    };
    const draft = "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened downtown.";
    expect(draftFactsCoveredBySources(draft, [wikiPage]).covered).toBe(false);
    expect(draftFactsCoveredBySources(draft, [wikiPage], ["wikipedia.org"]).covered).toBe(true);
  });

  it("pageEntailsDraftClaims: entails on a covering page (partial backing counts), never on unrelated/negated/empty", () => {
    const draft = "The Northgate Museum holds 3000 artifacts. The Riverside Gallery opened downtown.";
    const pageText = "The Northgate Museum holds 3000 artifacts in its permanent collection.";
    const r = pageEntailsDraftClaims(draft, pageText);
    expect(r.entails).toBe(true);
    expect(r.contentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(pageEntailsDraftClaims(draft, "This page is about unrelated kitchen appliance reviews and shipping policies only.").entails).toBe(false);
    expect(pageEntailsDraftClaims("The Northgate Museum does not hold 3000 artifacts.", pageText).entails).toBe(false);
    expect(pageEntailsDraftClaims("", pageText).entails).toBe(false);
    expect(pageEntailsDraftClaims(draft, "").entails).toBe(false);
  });
});

describe("ungroundedSuperlatives - G4 superlative-parity", () => {
  const verifiedSrc = (excerpt: string) => ({
    domain: "britannica.com",
    claim: excerpt,
    verified: true as const,
    supportingExcerpt: excerpt,
  });

  it("a superlative ASSERTED by a qualifying verified source is grounded (empty result)", () => {
    const draft = "Googoosh is the most famous Iranian pop singer.";
    const src = verifiedSrc("Googoosh is widely regarded as the most famous Iranian pop singer of her generation.");
    expect(ungroundedSuperlatives(draft, [src])).toEqual([]);
  });

  it("a source that mentions the entity but asserts NO superlative does not ground it", () => {
    const draft = "Googoosh is the most famous Iranian pop singer.";
    const src = verifiedSrc("Googoosh is an Iranian pop singer who recorded many albums.");
    expect(ungroundedSuperlatives(draft, [src]).some((p) => p.includes("famous"))).toBe(true);
  });

  it("a WEAK or UNVERIFIED source never grounds a superlative even with a matching excerpt", () => {
    const draft = "Googoosh is the most famous Iranian pop singer.";
    const weak = { domain: "some-blog.example", claim: "x", verified: true as const, supportingExcerpt: draft };
    const unverified = { domain: "britannica.com", claim: "x", verified: false as const, supportingExcerpt: draft };
    expect(ungroundedSuperlatives(draft, [weak]).some((p) => p.includes("famous"))).toBe(true);
    expect(ungroundedSuperlatives(draft, [unverified]).some((p) => p.includes("famous"))).toBe(true);
  });
});

describe("entity-rich topics + list/index URL filter (pilot loop 4)", () => {
  it("a roundup naming 3+ distinct entities is entity-rich; single-fact and possessive-duplicate topics are not", () => {
    expect(isEntityRichTopic(["famous iranian singers", "Googoosh", "Vigen", "Mohammad-Reza Shajarian", "Hayedeh"])).toBe(true);
    expect(isEntityRichTopic(["what is the national animal of Iran", "The Asiatic Cheetah is Iran's national animal"])).toBe(false);
    expect(isEntityRichTopic(["Iran", "Iran's national animal"])).toBe(false);
    expect(isEntityRichTopic(["Googoosh", "Vigen", "Shajarian"], 4)).toBe(false);
  });

  it("flags List_of_/index pages, never an entity's own biography page or a name containing 'list'", () => {
    expect(looksLikeListOrIndexUrl("https://en.wikipedia.org/wiki/List_of_Iranian_singers")).toBe(true);
    expect(looksLikeListOrIndexUrl("https://example.com/singers/index.html")).toBe(true);
    expect(looksLikeListOrIndexUrl("https://en.wikipedia.org/wiki/Googoosh")).toBe(false);
    expect(looksLikeListOrIndexUrl("https://en.wikipedia.org/wiki/Liston")).toBe(false);
    expect(looksLikeListOrIndexUrl("")).toBe(false);
  });
});

describe("getCuratedSourceDomains (G7)", () => {
  it("returns Iranopedia's curated allowlist, undefined for non-curated tenants, and a fresh copy each call", () => {
    const list = getCuratedSourceDomains("tenant-iranopedia");
    for (const d of ["wikipedia.org", "britannica.com", "unesco.org", "iranicaonline.org"]) {
      expect(list).toContain(d);
    }
    expect(getCuratedSourceDomains("tenant-other")).toBeUndefined();
    expect(getCuratedSourceDomains("tenant-ritz-founder")).toBeUndefined();
    const a = getCuratedSourceDomains("tenant-iranopedia")!;
    a.push("attacker.example");
    expect(getCuratedSourceDomains("tenant-iranopedia")).not.toContain("attacker.example");
  });
});
