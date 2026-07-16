/**
 * worklist-row-render (R23 P13) - render pins for the two Changes-list P13 components that produce
 * DOM: the word-level diff (v1 349/397) and the not-now durations + re-draft menu (v1 350/351).
 * We render each with renderToStaticMarkup and assert the EXACT operator-facing copy, so the
 * rendered surface is what a paying customer actually reads (Beacon voice, dash-free).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WordLevelDiff, NotNowMenu } from "./changes-list-client";

const BANNED_DASH = /[‒–—―]/; // figure, en, em, horizontal bar

describe("WordLevelDiff - see exactly what changes", () => {
  const html = renderToStaticMarkup(
    <WordLevelDiff before="Best Persian food in Los Angeles" after="Best Persian restaurants in Los Angeles" />,
  );

  it("strikes through the removed word and emphasizes the added one", () => {
    // The removed word carries line-through + a "Removed" title; the added word is bold + "Added".
    expect(html).toContain("line-through");
    expect(html).toContain('title="Removed"');
    expect(html).toContain('title="Added"');
    expect(html).toContain("food"); // removed
    expect(html).toContain("restaurants"); // added
  });

  it("shows a plain legend so the diff reads without relying on color", () => {
    expect(html).toContain("Struck-through words go away, bold words are new.");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });

  it("renders nothing when there is no change to show", () => {
    expect(renderToStaticMarkup(<WordLevelDiff before="same" after="same" />)).toBe("");
  });
});

describe("NotNowMenu - one compact defer/dismiss menu", () => {
  const html = renderToStaticMarkup(
    <NotNowMenu canRedraft onSnooze={() => {}} onDismiss={() => {}} onRedraft={() => {}} />,
  );

  it("labels the collapsed control 'Not now'", () => {
    expect(html).toContain("Not now");
  });

  it("emits no banned dash", () => {
    expect(BANNED_DASH.test(html)).toBe(false);
  });
});
