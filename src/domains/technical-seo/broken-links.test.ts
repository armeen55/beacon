import { describe, expect, it } from "vitest";

import {
  classifyBrokenLinks,
  type BrokenLinkSourcePage,
  type TargetLiveness,
} from "./broken-links";

const DEAD = new Set(["https://iranopedia.com/old-recipe", "https://iranopedia.com/gone"]);
const LIVE = new Set(["https://iranopedia.com/tehran", "https://iranopedia.com/food"]);

function livenessOf(target: string): TargetLiveness {
  if (DEAD.has(target)) return "dead";
  if (LIVE.has(target)) return "live";
  return "unknown";
}

function sourcePage(over: Partial<BrokenLinkSourcePage> = {}): BrokenLinkSourcePage {
  return {
    sourceUrl: "https://iranopedia.com/persian-food",
    links: [
      { targetUrl: "https://iranopedia.com/tehran", anchorText: "Tehran" },
      { targetUrl: "https://iranopedia.com/old-recipe", anchorText: "old recipe" },
    ],
    ...over,
  };
}

describe("classifyBrokenLinks", () => {
  it("fires when a page links at a dead target, naming count + source", () => {
    const f = classifyBrokenLinks(sourcePage(), livenessOf);
    expect(f).not.toBeNull();
    expect(f!.deadTargets).toHaveLength(1);
    expect(f!.deadTargets[0]!.targetUrl).toBe("https://iranopedia.com/old-recipe");
    expect(f!.reason_copy).toContain("/persian-food");
    expect(f!.reason_copy).toContain("1 link");
    expect(f!.reason_copy).not.toMatch(/[–—]/);
  });

  it("pluralizes correctly for multiple dead links", () => {
    const f = classifyBrokenLinks(
      sourcePage({
        links: [
          { targetUrl: "https://iranopedia.com/old-recipe", anchorText: "a" },
          { targetUrl: "https://iranopedia.com/gone", anchorText: "b" },
          { targetUrl: "https://iranopedia.com/tehran", anchorText: "c" },
        ],
      }),
      livenessOf,
    );
    expect(f!.deadTargets).toHaveLength(2);
    expect(f!.reason_copy).toContain("2 links");
    expect(f!.reason_copy).toContain("point at");
  });

  it("dedupes a repeated dead target and keeps stable URL order", () => {
    const f = classifyBrokenLinks(
      sourcePage({
        links: [
          { targetUrl: "https://iranopedia.com/gone", anchorText: "z" },
          { targetUrl: "https://iranopedia.com/old-recipe", anchorText: "a" },
          { targetUrl: "https://iranopedia.com/gone", anchorText: "dup" },
        ],
      }),
      livenessOf,
    );
    expect(f!.deadTargets.map((t) => t.targetUrl)).toEqual([
      "https://iranopedia.com/gone",
      "https://iranopedia.com/old-recipe",
    ]);
  });

  // ── clean / no-false-positive cases ──
  it("is empty when every link is live", () => {
    expect(
      classifyBrokenLinks(
        sourcePage({
          links: [
            { targetUrl: "https://iranopedia.com/tehran", anchorText: "t" },
            { targetUrl: "https://iranopedia.com/food", anchorText: "f" },
          ],
        }),
        livenessOf,
      ),
    ).toBeNull();
  });

  it("NEVER counts an unknown-liveness target as broken", () => {
    expect(
      classifyBrokenLinks(
        sourcePage({
          links: [
            { targetUrl: "https://iranopedia.com/never-checked", anchorText: "x" },
            { targetUrl: "https://iranopedia.com/also-unknown", anchorText: "y" },
          ],
        }),
        livenessOf,
      ),
    ).toBeNull();
  });

  it("is empty for a page with no links at all", () => {
    expect(classifyBrokenLinks(sourcePage({ links: [] }), livenessOf)).toBeNull();
  });
});
