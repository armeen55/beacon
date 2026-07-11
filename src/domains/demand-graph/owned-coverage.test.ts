/**
 * owned-coverage.test - the detector that closes the position-52 blind spot. The
 * blind holdout benchmark failed because Iranopedia's /nowruz page (title "Nowruz -
 * Persian New Year", ranking ~52 for "persian new year") already targeted a cluster
 * the New Pages board recommended building from scratch ("nowruz persian new year",
 * 14,800/mo). Neither the AI-citation gate nor the ownership registry caught it
 * (no citation, no cannibalization case, no top-10 cluster). These tests pin the two
 * signals that DO catch it: GSC serving at ANY position, and title/H1/slug content
 * matching with exact-phrase containment in both directions.
 */
import { describe, expect, it } from "vitest";
import {
  detectOwnedCoverageForTopic,
  detectOwnedCoverageForCard,
  acknowledgeSentence,
  topicsOverlap,
  ownedPagePath,
  type OwnedCoverageInput,
} from "./owned-coverage";

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

const NOWRUZ_URL = "https://iranopedia.com/nowruz";

/** The nowruz-shaped fixture: an owned page titled "Persian New Year" ranking at
 *  position 52, and the gap cluster "nowruz persian new year". */
const servingFixture: OwnedCoverageInput = {
  serving: [{ query: "persian new year", ownerPage: NOWRUZ_URL, position: 52 }],
  ownedPages: [],
};
const contentFixture: OwnedCoverageInput = {
  serving: [],
  ownedPages: [{ url: NOWRUZ_URL, title: "Nowruz - Persian New Year", h1: "Nowruz - Persian New Year" }],
};

describe("ownedPagePath", () => {
  it("reduces a full owned URL to its display path", () => {
    expect(ownedPagePath("https://iranopedia.com/nowruz")).toBe("/nowruz");
    expect(ownedPagePath("iranopedia.com/nowruz/")).toBe("/nowruz");
    expect(ownedPagePath("https://iranopedia.com/guide/persian-new-year")).toBe("/guide/persian-new-year");
  });
});

describe("topicsOverlap - exact containment both directions", () => {
  it("matches 'persian new year' against a title containing 'Persian New Year'", () => {
    expect(topicsOverlap("persian new year", "Nowruz - Persian New Year")).toBe(true);
    expect(topicsOverlap("Nowruz - Persian New Year", "persian new year")).toBe(true);
  });
  it("matches the longer gap cluster against the shorter owned title", () => {
    expect(topicsOverlap("nowruz persian new year 2026 guide", "Persian New Year")).toBe(true);
  });
  it("does NOT match a genuinely distinct topic that only shares one token", () => {
    // "nowruz" is the only shared word; neither phrase contains the other.
    expect(topicsOverlap("nowruz activities usa", "Persian New Year")).toBe(false);
    expect(topicsOverlap("kashan rug prices", "Persian New Year")).toBe(false);
  });
});

describe("detectOwnedCoverageForTopic - GSC serving (any position)", () => {
  it("finds the owned page Google already serves the query to, even at position 52", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", servingFixture);
    expect(m).not.toBeNull();
    expect(m!.basis).toBe("gsc_serving");
    expect(m!.ownedUrl).toBe(NOWRUZ_URL);
    expect(m!.ownedPath).toBe("/nowruz");
    expect(m!.position).toBe(52);
    expect(m!.sentence).toBe(
      "You already have /nowruz for this topic. I would improve that page before building a new one.",
    );
    expect(m!.detail).toContain("position 52");
    expect(BANNED_DASH.test(m!.sentence)).toBe(false);
    expect(BANNED_DASH.test(m!.detail)).toBe(false);
  });
});

describe("detectOwnedCoverageForTopic - content targeting", () => {
  it("finds an owned page whose title/H1 targets the cluster when GSC is silent", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", contentFixture);
    expect(m).not.toBeNull();
    expect(m!.basis).toBe("content");
    expect(m!.ownedUrl).toBe(NOWRUZ_URL);
    expect(m!.sentence).toBe(
      "You already have /nowruz for this topic. I would improve that page before building a new one.",
    );
    // The detail names the owned title so the operator can see the evidence.
    expect(m!.detail).toContain("Persian New Year");
    expect(BANNED_DASH.test(m!.detail)).toBe(false);
  });

  it("matches on the URL slug when there is no title or H1", () => {
    const m = detectOwnedCoverageForTopic("kashan rugs buying guide", {
      serving: [],
      ownedPages: [{ url: "https://iranopedia.com/kashan-rugs", title: null, h1: null }],
    });
    expect(m).not.toBeNull();
    expect(m!.ownedPath).toBe("/kashan-rugs");
  });

  it("prefers GSC serving over a content match", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", {
      serving: servingFixture.serving,
      ownedPages: contentFixture.ownedPages,
    });
    expect(m!.basis).toBe("gsc_serving");
  });
});

describe("detectOwnedCoverageForTopic - genuine gaps stay uncovered", () => {
  it("returns null when nothing of mine targets the topic (regression guard)", () => {
    const input: OwnedCoverageInput = {
      serving: [{ query: "persian wedding traditions", ownerPage: "https://iranopedia.com/persian-wedding", position: 4 }],
      ownedPages: [{ url: "https://iranopedia.com/persian-wedding", title: "Persian Wedding Traditions", h1: "Persian Wedding" }],
    };
    expect(detectOwnedCoverageForTopic("chelow kabab recipe", input)).toBeNull();
  });
});

describe("detectOwnedCoverageForCard", () => {
  it("demotes when a CORE topic (the demand-driving keyword) is owned", () => {
    const verdict = detectOwnedCoverageForCard({
      coreTopics: ["Nowruz Activities USA", "nowruz persian new year"],
      alsoCovers: ["Nowruz Activities Kids", "Nowruz Persian New Year"],
      serving: servingFixture.serving,
      ownedPages: [],
    });
    expect(verdict.primary).not.toBeNull();
    expect(verdict.primary!.ownedPath).toBe("/nowruz");
    // A demoted card needs no per-topic "Also covers" stripping list.
    expect(verdict.coveredAlsoCovers).toEqual([]);
  });

  it("keeps a distinct card but flags the owned 'Also covers' topic (case b)", () => {
    const verdict = detectOwnedCoverageForCard({
      coreTopics: ["Nowruz Activities USA"],
      alsoCovers: ["Nowruz Persian New Year", "Nowruz Table Setting"],
      serving: servingFixture.serving,
      ownedPages: [],
    });
    expect(verdict.primary).toBeNull();
    expect(verdict.coveredAlsoCovers.map((c) => c.topic)).toEqual(["Nowruz Persian New Year"]);
  });

  it("leaves a genuinely uncovered card untouched", () => {
    const verdict = detectOwnedCoverageForCard({
      coreTopics: ["Chelow Kabab Recipe"],
      alsoCovers: ["Kabab Koobideh"],
      serving: servingFixture.serving,
      ownedPages: contentFixture.ownedPages,
    });
    expect(verdict.primary).toBeNull();
    expect(verdict.coveredAlsoCovers).toEqual([]);
  });
});

describe("acknowledgeSentence", () => {
  it("names the owned page and the covered topics, first person, no dashes", () => {
    const m = detectOwnedCoverageForTopic("nowruz persian new year", servingFixture)!;
    const s = acknowledgeSentence(m, ["Nowruz Persian New Year"]);
    expect(s).toContain("/nowruz");
    expect(s).toContain("Nowruz Persian New Year");
    expect(BANNED_DASH.test(s)).toBe(false);
  });
});
