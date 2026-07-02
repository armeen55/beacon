import { describe, it, expect } from "vitest";
import { routeQuestion, extractPagePath } from "./router";

describe("ask/router - extractPagePath", () => {
  it("extracts an explicit slash path", () => {
    expect(extractPagePath("why did clicks drop on /cheetah")).toBe("/cheetah");
  });

  it("extracts a nested explicit path", () => {
    expect(extractPagePath("what happened to /cities/tehran last week")).toBe("/cities/tehran");
  });

  it("extracts a named page phrase", () => {
    expect(extractPagePath("why did clicks drop on the cheetah page")).toBe("/cheetah");
  });

  it("extracts a possessive named page phrase", () => {
    expect(extractPagePath("did the cheetah page's AI citations change")).toBe("/cheetah");
  });

  it("extracts a bare 'on <slug>' mention", () => {
    expect(extractPagePath("clicks dropped on cheetah this month")).toBe("/cheetah");
  });

  it("does not treat common stop words after 'on' as a page", () => {
    expect(extractPagePath("how are we doing on google")).toBeNull();
    expect(extractPagePath("how did we do on average this week")).toBeNull();
  });

  it("returns null when no page is named", () => {
    expect(extractPagePath("what did we ship this week")).toBeNull();
  });

  it("strips trailing punctuation", () => {
    expect(extractPagePath("what happened on /cheetah?")).toBe("/cheetah");
  });
});

describe("ask/router - routeQuestion", () => {
  it("routes a page-specific question with gsc as the speaker", () => {
    const r = routeQuestion("why did clicks drop on the cheetah page");
    expect(r.questionClass).toBe("page_specific");
    expect(r.pagePath).toBe("/cheetah");
    expect(r.speaker).toBe("gsc");
  });

  it("routes a site-trend question with no page named", () => {
    const r = routeQuestion("did our traffic drop sitewide this week");
    expect(r.questionClass).toBe("site_trend");
    expect(r.pagePath).toBeNull();
    expect(r.speaker).toBe("gsc");
  });

  it("routes an AI-visibility question to the profound voice", () => {
    const r = routeQuestion("who is beating me in ChatGPT's answers");
    expect(r.questionClass).toBe("ai_visibility");
    expect(r.speaker).toBe("profound");
  });

  it("routes an answer-box question to ai_visibility", () => {
    const r = routeQuestion("who is beating me on Google's answer box");
    expect(r.questionClass).toBe("ai_visibility");
  });

  it("routes a measurement question to the proof voice", () => {
    const r = routeQuestion("did the title change on the homepage actually work");
    expect(r.questionClass).toBe("measurement");
    expect(r.speaker).toBe("proof");
  });

  it("routes a 'what did we ship' question to measurement", () => {
    const r = routeQuestion("what did we ship this week");
    expect(r.questionClass).toBe("measurement");
  });

  it("routes a competitor question to the dataforseo voice", () => {
    const r = routeQuestion("which competitor is outranking me for cheetah facts");
    expect(r.questionClass).toBe("competitor");
    expect(r.speaker).toBe("dataforseo");
  });

  it("routes a plan question to the llm/strategist voice", () => {
    const r = routeQuestion("what are we planning to ship tonight");
    expect(r.questionClass).toBe("plan");
    expect(r.speaker).toBe("llm");
  });

  it("prefers page_specific over other cues when a real page is named", () => {
    const r = routeQuestion("why did AI citations drop on /cheetah this week");
    expect(r.questionClass).toBe("page_specific");
    expect(r.pagePath).toBe("/cheetah");
  });

  it("defaults an ambiguous question with no cues to site_trend", () => {
    const r = routeQuestion("how are things going");
    expect(r.questionClass).toBe("site_trend");
  });

  it("handles an empty question without throwing", () => {
    const r = routeQuestion("");
    expect(r.questionClass).toBe("site_trend");
    expect(r.pagePath).toBeNull();
  });
});
