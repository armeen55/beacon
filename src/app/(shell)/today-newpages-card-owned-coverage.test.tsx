/**
 * today-newpages-card-owned-coverage - the rendered gate that stops the New Pages
 * board from pitching a brand new page for a topic an owned page already targets.
 * Pins the blind-benchmark fix: a card whose cluster is already owned demotes to the
 * watching state (names the owned page, links to its dossier, hides every create
 * control), the false "none of your pages covers it yet" line never renders, and a
 * genuinely uncovered card still renders the create flow normally.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewPageCard } from "./today-newpages-card";
import type { NewPageOpportunity } from "./today-newpages-data";

const BANNED_DASH = /[‒–—―]/;

const BASE: NewPageOpportunity = {
  id: "np-owned-coverage-test",
  topic: "Nowruz Persian New Year",
  competitorCount: 3,
  topCompetitor: "britannica.com",
  whatWins: null,
  searchVolume: 14800,
  keywordMatch: { keyword: "nowruz persian new year", volume: 14800, confidence: "exact" },
  signal: { kind: "stable", label: "Stable", evidence: null },
  score: 71,
  savedOpening: null,
  competitorDomains: ["britannica.com", "timeanddate.com"],
  preparedVerdict: null,
  preparedBrief: null,
  briefQuality: null,
  openingQuality: null,
  aeoReceipt: null,
  fullPageDraft: null,
};

const WATCHING: NewPageOpportunity = {
  ...BASE,
  ownedCoverage: {
    state: "watching",
    ownedUrl: "https://iranopedia.com/nowruz",
    ownedPath: "/nowruz",
    basis: "gsc_serving",
    sentence: "You already have /nowruz for this topic. I would improve that page before building a new one.",
    detail: 'I already show up on Google for "persian new year" at position 52, and /nowruz is the page that gets it.',
  },
};

describe("NewPageCard - owned-coverage watching state", () => {
  const html = renderToStaticMarkup(<NewPageCard o={WATCHING} ownDomain="iranopedia.com" />);

  it("renders the first-person watching sentence naming the owned page", () => {
    expect(html).toContain("You already have /nowruz for this topic. I would improve that page before building a new one.");
  });

  it("shows a Watching pill and NOT the green 'New page' pill", () => {
    expect(html).toContain(">Watching<");
    expect(html).not.toContain("New page");
  });

  it("links to the owned page's dossier", () => {
    expect(html).toContain('href="/page/nowruz"');
    expect(html).toContain("Improve /nowruz");
  });

  it("NEVER renders the false 'no page yet' sentence when a page already covers it", () => {
    expect(html).not.toContain("none of your pages covers it yet");
    expect(/no page yet/i.test(html)).toBe(false);
  });

  it("suppresses every create control (draft / Google check / plan this page)", () => {
    expect(html).not.toContain("Draft the opening");
    expect(html).not.toContain("Check live Google results");
    expect(html).not.toContain("Plan this page");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});

describe("NewPageCard - owned-coverage acknowledge state", () => {
  const ACK: NewPageOpportunity = {
    ...BASE,
    topic: "Nowruz Activities USA",
    alsoCovers: ["Nowruz Table Setting"], // the owned topic was already stripped by the loader
    ownedCoverage: {
      state: "acknowledge",
      ownedUrl: "https://iranopedia.com/nowruz",
      ownedPath: "/nowruz",
      basis: "content",
      sentence: "I already have /nowruz for Nowruz Persian New Year, so this new page should target something different and not repeat it.",
      detail: 'The title on /nowruz already reads "Nowruz - Persian New Year".',
    },
  };
  const html = renderToStaticMarkup(<NewPageCard o={ACK} ownDomain="iranopedia.com" />);

  it("keeps the create card but renders the owned-page acknowledgment", () => {
    expect(html).toContain("New page");
    expect(html).toContain("I already have /nowruz for Nowruz Persian New Year");
  });

  it("does not claim the covered cluster under 'Also covers' (only the acknowledgment names it)", () => {
    // The loader strips the owned topic from alsoCovers; the card must render only the
    // surviving topic on the "Also covers" line, never the owned cluster.
    expect(html).toContain("Also covers: Nowruz Table Setting");
    expect(html).not.toContain("Also covers: Nowruz Persian New Year");
    // The ONLY place the covered cluster may appear is the honest acknowledgment line.
    expect(html).toContain("I already have /nowruz for Nowruz Persian New Year");
  });
});

describe("NewPageCard - a genuinely uncovered card renders create normally (regression)", () => {
  const html = renderToStaticMarkup(<NewPageCard o={BASE} ownDomain="iranopedia.com" />);
  it("shows the New page pill and the create controls", () => {
    expect(html).toContain("New page");
    expect(html).toContain("Check live Google results");
    expect(html).not.toContain(">Watching<");
  });
});
