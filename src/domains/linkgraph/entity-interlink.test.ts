import { describe, expect, it } from "vitest";

import {
  interlinkCandidatesForPage,
  topicMentionedInBody,
  type InterlinkDestination,
  type InterlinkSourcePage,
} from "./entity-interlink";

describe("topicMentionedInBody", () => {
  it("matches when all the topic's distinguishing tokens appear in the body", () => {
    const matched = topicMentionedInBody(
      "Our guide covers Chaharshanbe Suri, the fire festival celebrated before Nowruz.",
      "Chaharshanbe Suri",
    );
    expect(matched).toContain("chaharshanbe");
    expect(matched).toContain("suri");
  });

  it("does NOT match when only some of a multi-token topic appears", () => {
    // "Nowruz" alone should not match the full "Nowruz Traditions Table" topic.
    expect(topicMentionedInBody("We talk about Nowruz here.", "Nowruz Traditions Table")).toEqual([]);
  });

  it("rejects an all-generic topic (no distinguishing tokens)", () => {
    // topicTokens strips brand/generic words like "iran"/"persian"/"best".
    expect(topicMentionedInBody("Best Iranian guide about Persian things.", "best persian iran")).toEqual([]);
  });

  it("returns empty on no body text", () => {
    expect(topicMentionedInBody(null, "Chaharshanbe Suri")).toEqual([]);
    expect(topicMentionedInBody("   ", "Chaharshanbe Suri")).toEqual([]);
  });
});

describe("interlinkCandidatesForPage", () => {
  const source: InterlinkSourcePage = {
    url: "https://x.com/nowruz",
    bodyText:
      "Nowruz is the Persian New Year. Many families also celebrate Chaharshanbe Suri and set a Haft Sin table.",
    linkedOwnedUrls: [],
  };

  const destinations: InterlinkDestination[] = [
    { ownerUrl: "https://x.com/chaharshanbe-suri", topicLabel: "Chaharshanbe Suri" },
    { ownerUrl: "https://x.com/haft-sin", topicLabel: "Haft Sin table" },
    { ownerUrl: "https://x.com/yalda", topicLabel: "Yalda Night" }, // not mentioned
  ];

  it("proposes links only to owners whose topic the body mentions", () => {
    const out = interlinkCandidatesForPage(source, destinations);
    const dests = out.map((c) => c.destinationUrl);
    expect(dests).toContain("https://x.com/chaharshanbe-suri");
    expect(dests).toContain("https://x.com/haft-sin");
    expect(dests).not.toContain("https://x.com/yalda"); // never mentioned
  });

  it("suggests the topic label as the descriptive anchor", () => {
    const out = interlinkCandidatesForPage(source, destinations);
    const chahar = out.find((c) => c.destinationUrl === "https://x.com/chaharshanbe-suri")!;
    expect(chahar.suggestedAnchor).toBe("Chaharshanbe Suri");
  });

  it("never proposes a link the source already has", () => {
    const withLink: InterlinkSourcePage = {
      ...source,
      linkedOwnedUrls: ["https://x.com/chaharshanbe-suri"],
    };
    const out = interlinkCandidatesForPage(withLink, destinations);
    expect(out.map((c) => c.destinationUrl)).not.toContain("https://x.com/chaharshanbe-suri");
    expect(out.map((c) => c.destinationUrl)).toContain("https://x.com/haft-sin");
  });

  it("never proposes a self-link", () => {
    const selfDest: InterlinkDestination[] = [
      { ownerUrl: source.url, topicLabel: "Nowruz" },
    ];
    expect(interlinkCandidatesForPage(source, selfDest)).toEqual([]);
  });

  it("OWNER not contender: the caller passes only owners, so a contender URL is never a target", () => {
    // The core links to whatever destinations the loader passes; the loader
    // passes ONLY resolved owners (N2). This asserts the core does not invent a
    // destination not in the passed set.
    const out = interlinkCandidatesForPage(source, [
      { ownerUrl: "https://x.com/haft-sin", topicLabel: "Haft Sin table" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.destinationUrl).toBe("https://x.com/haft-sin");
  });

  it("caps at maxPerPage, most-matched-tokens first", () => {
    const many: InterlinkDestination[] = [
      { ownerUrl: "https://x.com/a", topicLabel: "Chaharshanbe Suri fire" }, // 3 tokens
      { ownerUrl: "https://x.com/b", topicLabel: "Haft Sin" }, // 2 tokens
      { ownerUrl: "https://x.com/c", topicLabel: "Nowruz" }, // 1 token
    ];
    const richBody: InterlinkSourcePage = {
      url: "https://x.com/nowruz",
      bodyText: "Chaharshanbe Suri fire jumping precedes Nowruz; set a Haft Sin.",
      linkedOwnedUrls: [],
    };
    const out = interlinkCandidatesForPage(richBody, many, { maxPerPage: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.matchedTokens.length).toBeGreaterThanOrEqual(out[1]!.matchedTokens.length);
  });

  it("BYTE-IDENTICAL EMPTY: no destinations or no body -> []", () => {
    expect(interlinkCandidatesForPage(source, [])).toEqual([]);
    expect(interlinkCandidatesForPage({ ...source, bodyText: null }, destinations)).toEqual([]);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(interlinkCandidatesForPage(source, destinations));
    const b = JSON.stringify(interlinkCandidatesForPage(source, destinations));
    expect(a).toBe(b);
  });
});
