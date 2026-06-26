import { describe, it, expect } from "vitest";
import { extractWinnerSignals, compareToWinners, type WinnerSignals } from "./winner-patterns";

const sig = (over: Partial<WinnerSignals> = {}): WinnerSignals => ({
  wordCount: 1000,
  hasAuthorByline: false,
  hasAuthorCredentials: false,
  hasPublishedDate: false,
  hasUpdatedDate: false,
  outboundCitations: 0,
  hasReviewSchema: false,
  hasFaq: false,
  ...over,
});

describe("extractWinnerSignals", () => {
  it("detects byline, credentials, dates, citations, review schema, FAQ", () => {
    const html = `
      <html><body>
        <span class="author">By Jane Smith, MD</span>
        <time datetime="2026-01-01">Jan 1</time>
        <meta property="article:modified_time" content="2026-06-01">
        <p>${"word ".repeat(500)}</p>
        <a href="https://nih.gov/x">ref</a><a href="https://harvard.edu/y">ref</a><a href="https://who.int/z">ref</a>
        <a href="https://www.mysite.com/internal">internal</a>
        <script type="application/ld+json">{"@type":"AggregateRating","ratingValue":4.8}</script>
        <details>q1</details><details>q2</details>
      </body></html>`;
    const s = extractWinnerSignals(html, { ownHost: "mysite.com" });
    expect(s.hasAuthorByline).toBe(true);
    expect(s.hasAuthorCredentials).toBe(true);
    expect(s.hasPublishedDate).toBe(true);
    expect(s.hasUpdatedDate).toBe(true);
    expect(s.outboundCitations).toBe(3); // own host excluded
    expect(s.hasReviewSchema).toBe(true);
    expect(s.hasFaq).toBe(true);
    expect(s.wordCount).toBeGreaterThan(400);
  });

  it("fail-closed on empty/junk html", () => {
    const s = extractWinnerSignals("");
    expect(s.wordCount).toBe(0);
    expect(s.hasAuthorByline).toBe(false);
    expect(s.outboundCitations).toBe(0);
  });
});

describe("compareToWinners", () => {
  it("names signals the majority of winners have that you lack", () => {
    const winners = [sig({ hasAuthorByline: true, hasFaq: true }), sig({ hasAuthorByline: true, hasFaq: true }), sig({ hasAuthorByline: true })];
    const yours = sig({ hasAuthorByline: false, hasFaq: false });
    const gaps = compareToWinners(yours, winners);
    const sigs = gaps.map((g) => g.signal);
    expect(sigs).toContain("hasAuthorByline"); // 3/3
    expect(sigs).toContain("hasFaq"); // 2/3 = majority
  });

  it("does not flag a signal you already have", () => {
    const winners = [sig({ hasFaq: true }), sig({ hasFaq: true })];
    const gaps = compareToWinners(sig({ hasFaq: true }), winners);
    expect(gaps.find((g) => g.signal === "hasFaq")).toBeUndefined();
  });

  it("flags a thin page vs the winners' median word count", () => {
    const winners = [sig({ wordCount: 2000 }), sig({ wordCount: 2200 }), sig({ wordCount: 1800 })];
    const gaps = compareToWinners(sig({ wordCount: 500 }), winners);
    expect(gaps.find((g) => g.signal === "wordCount")).toBeDefined();
  });

  it("fail-closed with no winners", () => {
    expect(compareToWinners(sig(), [])).toEqual([]);
    expect(compareToWinners(null, [sig()])).toEqual([]);
  });
});
