import { describe, expect, it } from "vitest";

import {
  classifyJsShell,
  looksLikeJsShell,
  JS_SHELL_MIN_IMPRESSIONS_90D,
  JS_SHELL_MAX_BODY_WORDS,
  type JsShellPageInput,
} from "./js-shell";

function page(over: Partial<JsShellPageInput> = {}): JsShellPageInput {
  return {
    url: "https://x.com/app-page",
    wordCount: 5,
    bodyExcerptCount: 0,
    hasTitle: true,
    hasH1: true,
    httpStatus: 200,
    impressions90d: 300,
    ...over,
  };
}

describe("looksLikeJsShell", () => {
  it("true for a demand page with a title but a near-empty source body", () => {
    expect(looksLikeJsShell(page())).toBe(true);
  });

  it("false when the page has real source body text (word_count over ceiling)", () => {
    expect(looksLikeJsShell(page({ wordCount: JS_SHELL_MAX_BODY_WORDS + 1 }))).toBe(false);
  });

  it("false when the extractor did pull paragraphs (bodyExcerptCount > 0)", () => {
    expect(looksLikeJsShell(page({ bodyExcerptCount: 3 }))).toBe(false);
  });

  it("DEMAND GATE: false below the impressions floor", () => {
    expect(looksLikeJsShell(page({ impressions90d: JS_SHELL_MIN_IMPRESSIONS_90D - 1 }))).toBe(false);
  });

  it("fires exactly at the demand floor", () => {
    expect(looksLikeJsShell(page({ impressions90d: JS_SHELL_MIN_IMPRESSIONS_90D }))).toBe(true);
  });

  it("false for a dead page (status >= 400)", () => {
    expect(looksLikeJsShell(page({ httpStatus: 404 }))).toBe(false);
  });

  it("false when the page has neither a title nor an H1 (a truly blank URL, not a shell)", () => {
    expect(looksLikeJsShell(page({ hasTitle: false, hasH1: false }))).toBe(false);
  });

  it("true with only an H1 (no title) - still a real destination", () => {
    expect(looksLikeJsShell(page({ hasTitle: false, hasH1: true }))).toBe(true);
  });
});

describe("classifyJsShell", () => {
  it("returns a finding with honest heuristic copy for a shell page", () => {
    const f = classifyJsShell(page({ url: "https://x.com/persian-cities" }));
    expect(f).not.toBeNull();
    expect(f!.url).toBe("https://x.com/persian-cities");
    expect(f!.reason).toContain("/persian-cities");
    expect(f!.reason).toContain("only appears after JavaScript runs");
    expect(f!.reason).toContain("may see an empty page");
    // Honest: it tells the operator to verify, never claims certainty.
    expect(f!.reason).toContain("view its page source");
    expect(f!.reason).not.toMatch(/[—–]/);
    expect(f!.evidence).toContain("smell only, no headless render");
  });

  it("returns null when the page does not smell like a shell", () => {
    expect(classifyJsShell(page({ wordCount: 800, bodyExcerptCount: 10 }))).toBeNull();
  });
});
