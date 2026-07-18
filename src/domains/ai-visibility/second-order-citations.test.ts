import { describe, it, expect } from "vitest";
import {
  classifyDomain,
  cleanTopicPhrase,
  isRealisticOutreachTarget,
  rankSecondOrderDomains,
  suggestedActionFor,
  citationRowToInput,
  type SecondOrderCitationInput,
} from "./second-order-citations";

describe("classifyDomain, deterministic URL/host pattern classification", () => {
  it("classifies reference sites (wikipedia etc.)", () => {
    expect(classifyDomain("en.wikipedia.org", "https://en.wikipedia.org/wiki/Example")).toBe("reference");
    expect(classifyDomain("wikidata.org", "https://wikidata.org/wiki/Q1")).toBe("reference");
  });

  it("classifies UGC/community domains (reddit, quora, forums)", () => {
    expect(classifyDomain("reddit.com", "https://reddit.com/r/example/comments/abc")).toBe("ugc_community");
    expect(classifyDomain("quora.com", "https://quora.com/What-is-example")).toBe("ugc_community");
    expect(classifyDomain("forum.example.com", "https://forum.example.com/thread/1")).toBe("ugc_community");
  });

  it("classifies media/press domains", () => {
    expect(classifyDomain("forbes.com", "https://forbes.com/sites/x/example")).toBe("media_press");
    expect(classifyDomain("techcrunch.com", "https://techcrunch.com/2026/example")).toBe("media_press");
  });

  it("classifies directory-shaped URLs", () => {
    expect(classifyDomain("example-directory.com", "https://example-directory.com/directory/listing/example")).toBe("directory");
    expect(classifyDomain("example-vendors.com", "https://example-vendors.com/vendors/example-co")).toBe("directory");
  });

  it("classifies listicle-shaped URLs", () => {
    expect(classifyDomain("example-blog.com", "https://example-blog.com/best-example-tools")).toBe("listicle");
    expect(classifyDomain("example-blog.com", "https://example-blog.com/top-10-example")).toBe("listicle");
  });

  it("falls back to other when nothing matches", () => {
    expect(classifyDomain("randomsite.example", "https://randomsite.example/some/page")).toBe("other");
  });
});

describe("isRealisticOutreachTarget, directories/listicles/media yes, reference/UGC different playbook", () => {
  it("marks directory, listicle, media_press as outreach targets", () => {
    expect(isRealisticOutreachTarget("directory")).toBe(true);
    expect(isRealisticOutreachTarget("listicle")).toBe(true);
    expect(isRealisticOutreachTarget("media_press")).toBe(true);
  });

  it("marks reference and ugc_community as NOT outreach targets", () => {
    expect(isRealisticOutreachTarget("reference")).toBe(false);
    expect(isRealisticOutreachTarget("ugc_community")).toBe(false);
  });

  it("marks other as not an outreach target", () => {
    expect(isRealisticOutreachTarget("other")).toBe(false);
  });
});

describe("suggestedActionFor, plain English, class-appropriate, never auto-send", () => {
  it("pitches directories as a listing step", () => {
    const action = suggestedActionFor("directory", "example-directory.com", "widgets");
    expect(action).toContain("listing");
    expect(action).not.toMatch(/[–—]/); // no em/en dashes
  });

  it("flags reference sites as a different playbook", () => {
    const action = suggestedActionFor("reference", "en.wikipedia.org", "widgets");
    expect(action.toLowerCase()).toContain("different playbook");
  });

  it("flags UGC/community as a different playbook, not a pitch", () => {
    const action = suggestedActionFor("ugc_community", "reddit.com", "widgets");
    expect(action.toLowerCase()).toContain("different playbook");
  });

  it("D5: 'other' class names the real citation count and threshold instead of a flat non-answer", () => {
    const action = suggestedActionFor("other", "randomsite.example", "widgets", 3);
    expect(action).toContain("cited 3 times so far");
    expect(action).toMatch(/after about \d+ citations I can name the exact page to pitch/);
    expect(action).not.toBe(
      "Worth a look: randomsite.example keeps getting cited on widgets. I don't have enough signal yet to say exactly how to get listed there.",
    );
    expect(action).not.toMatch(/[–—]/);
  });
});

describe("rankSecondOrderDomains, ranking by citation frequency", () => {
  const rows: SecondOrderCitationInput[] = [
    { domain: "example-directory.com", url: "https://example-directory.com/directory/listing/widgets-co", topic: "widgets", count: 5 },
    { domain: "example-directory.com", url: "https://example-directory.com/directory/listing/widgets-co", topic: "widgets", count: 3 },
    { domain: "example-blog.com", url: "https://example-blog.com/best-widget-tools", topic: "widgets", count: 4 },
    { domain: "reddit.com", url: "https://reddit.com/r/widgets/comments/xyz", topic: "widgets", count: 20 },
  ];

  it("ranks domains by total citation count, descending", () => {
    const ranked = rankSecondOrderDomains(rows);
    // reddit is excluded as a noise domain (reused evidence-relevance list),
    // so example-directory.com (8) should outrank example-blog.com (4).
    expect(ranked.map((r) => r.domain)).toEqual(["example-directory.com", "example-blog.com"]);
    expect(ranked[0].citationCount).toBe(8);
  });

  it("excludes the tenant's own domain", () => {
    const ownRows: SecondOrderCitationInput[] = [
      ...rows,
      { domain: "www.owned-example.com", url: "https://owned-example.com/page", topic: "widgets", count: 99 },
    ];
    const ranked = rankSecondOrderDomains(ownRows, { ownDomain: "owned-example.com" });
    expect(ranked.some((r) => r.domain.includes("owned-example.com"))).toBe(false);
  });

  it("excludes noise domains via the reused evidence-relevance list", () => {
    const ranked = rankSecondOrderDomains(rows);
    expect(ranked.some((r) => r.domain === "reddit.com")).toBe(false);
  });

  it("attaches topTopics, exampleCitedUrl, and a class per domain", () => {
    const ranked = rankSecondOrderDomains(rows);
    const directory = ranked.find((r) => r.domain === "example-directory.com")!;
    expect(directory.topTopics).toContain("widgets");
    expect(directory.exampleCitedUrl).toBe("https://example-directory.com/directory/listing/widgets-co");
    expect(directory.class).toBe("directory");
    expect(directory.isOutreachTarget).toBe(true);
  });

  it("uses a real prompt hint when available, falls back to a cleaned topic phrase otherwise", () => {
    const withHint = rankSecondOrderDomains(rows, {
      promptHints: [{ domain: "example-directory.com", question: "What are the best widget makers?" }],
    });
    const directory = withHint.find((r) => r.domain === "example-directory.com")!;
    expect(directory.examplePrompt).toBe("What are the best widget makers?");

    const withoutHint = rankSecondOrderDomains(rows);
    const blog = withoutHint.find((r) => r.domain === "example-blog.com")!;
    expect(blog.examplePrompt).toBe("It wins answers about widgets.");
  });

  it("D3: never renders 'A question about <raw slug>' framing, and hides the line when the topic is all junk", () => {
    const junkRows: SecondOrderCitationInput[] = [
      { domain: "example-directory.com", url: "https://example-directory.com/directory/listing/x", topic: "wiki chaharshanbe suri 2026", count: 1 },
      { domain: "example-blog.com", url: "https://example-blog.com/best-x", topic: "wiki 2026", count: 1 },
    ];
    const ranked = rankSecondOrderDomains(junkRows);
    const directory = ranked.find((r) => r.domain === "example-directory.com")!;
    expect(directory.examplePrompt).toBe("It wins answers about chaharshanbe suri.");
    expect(directory.examplePrompt).not.toMatch(/^A question about/);

    // "wiki 2026" strips to nothing meaningful - hide the line entirely.
    const blog = ranked.find((r) => r.domain === "example-blog.com")!;
    expect(blog.examplePrompt).toBeNull();
  });

  it("cleanTopicPhrase strips junk slug tokens and bare numbers, nulls out an all-junk label", () => {
    expect(cleanTopicPhrase("wiki chaharshanbe suri 2026")).toBe("chaharshanbe suri");
    expect(cleanTopicPhrase("wiki 2026")).toBeNull();
    expect(cleanTopicPhrase("")).toBeNull();
    expect(cleanTopicPhrase(null)).toBeNull();
    expect(cleanTopicPhrase("widgets")).toBe("widgets");
  });

  it("links outreach pipeline status by domain key without auto-sending anything", () => {
    const ranked = rankSecondOrderDomains(rows, {
      outreachDomains: new Map([["example-directory.com", { inOutreachPipeline: true, status: "draft" }]]),
    });
    const directory = ranked.find((r) => r.domain === "example-directory.com")!;
    expect(directory.outreach.inOutreachPipeline).toBe(true);
    expect(directory.outreach.status).toBe("draft");

    const blog = ranked.find((r) => r.domain === "example-blog.com")!;
    expect(blog.outreach.inOutreachPipeline).toBe(false);
  });

  it("returns an empty list for empty input", () => {
    expect(rankSecondOrderDomains([])).toEqual([]);
  });

  it("never emits em or en dashes in generated copy", () => {
    const ranked = rankSecondOrderDomains(rows);
    for (const r of ranked) {
      expect(r.suggestedAction).not.toMatch(/[–—]/);
      if (r.examplePrompt) expect(r.examplePrompt).not.toMatch(/[–—]/);
    }
  });
});

describe("citationRowToInput", () => {
  it("preserves the stored aggregate citation count instead of flattening it to one", () => {
    expect(citationRowToInput({
      root_domain: "example.com",
      url: "https://example.com/nowruz-guide",
      category_id: "nowruz traditions",
      citation_count: 37,
    }).count).toBe(37);
  });
});
