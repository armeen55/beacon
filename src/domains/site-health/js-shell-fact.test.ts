import { describe, expect, it } from "vitest";

import { detectJsShellFact } from "./js-shell-fact";
import type { JsShellPageInput } from "@/domains/lifecycle/js-shell";

/** A real, healthy page: plenty of source-HTML body text. */
function realPage(over: Partial<JsShellPageInput> = {}): JsShellPageInput {
  return {
    url: "https://example.com/guide",
    wordCount: 800,
    bodyExcerptCount: 12,
    hasTitle: true,
    hasH1: true,
    httpStatus: 200,
    impressions90d: 500,
    ...over,
  };
}

/** A JS-shell page: near-empty source body behind a real destination + demand. */
function shellPage(over: Partial<JsShellPageInput> = {}): JsShellPageInput {
  return {
    url: "https://example.com/app",
    wordCount: 4,
    bodyExcerptCount: 0,
    hasTitle: true,
    hasH1: false,
    httpStatus: 200,
    impressions90d: 300,
    ...over,
  };
}

describe("detectJsShellFact", () => {
  it("returns null for a page that renders real HTML (empty-safe)", () => {
    expect(detectJsShellFact(realPage())).toBeNull();
  });

  it("returns null for a near-empty page below the demand floor", () => {
    expect(detectJsShellFact(shellPage({ impressions90d: 10 }))).toBeNull();
  });

  it("returns null for a broken page (status >= 400, a status fix not a shell)", () => {
    expect(detectJsShellFact(shellPage({ httpStatus: 404 }))).toBeNull();
  });

  it("fires on a near-empty-body page that has demand and a real title", () => {
    const fact = detectJsShellFact(shellPage({ url: "https://example.com/app" }));
    expect(fact).not.toBeNull();
    expect(fact!.path).toBe("/app");
    expect(fact!.headline).toContain("loads almost empty until JavaScript runs");
    expect(fact!.headline).toContain("Google and AI assistants");
    expect(fact!.headline).toContain("Add server-rendered text so they can read it.");
  });

  it("carries an operator-evidence trace that is honest about the heuristic", () => {
    const fact = detectJsShellFact(shellPage());
    expect(fact!.operatorEvidence).toContain("word_count=4");
    expect(fact!.operatorEvidence).toContain("body_excerpt_count=0");
    expect(fact!.operatorEvidence).toContain("smell only, no headless render");
  });

  it("emits no em or en dashes", () => {
    const fact = detectJsShellFact(shellPage());
    expect(fact!.headline).not.toMatch(/[–—]/);
  });
});
