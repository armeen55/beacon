import { describe, expect, it } from "vitest";

import {
  classifyRedirectHygiene,
  coverageSaysSoft404,
  REDIRECT_HYGIENE_MIN_IMPRESSIONS_90D,
  type RedirectHygienePageInput,
} from "./redirect-hygiene";

function page(over: Partial<RedirectHygienePageInput> = {}): RedirectHygienePageInput {
  return {
    url: "https://iranopedia.com/guides/old",
    redirectChain: [],
    coverageState: null,
    impressions90d: 300,
    ...over,
  };
}

describe("coverageSaysSoft404", () => {
  it("is true only for a soft-404 coverage state", () => {
    expect(coverageSaysSoft404("Soft 404")).toBe(true);
    expect(coverageSaysSoft404("soft 404 (page reads empty)")).toBe(true);
  });
  it("is false for null / healthy / not-found coverage", () => {
    expect(coverageSaysSoft404(null)).toBe(false);
    expect(coverageSaysSoft404("Submitted and indexed")).toBe(false);
    expect(coverageSaysSoft404("Not found (404)")).toBe(false);
  });
});

describe("classifyRedirectHygiene", () => {
  it("fires on a multi-hop redirect chain, naming hop count", () => {
    const [f] = classifyRedirectHygiene(
      page({
        redirectChain: [
          "https://iranopedia.com/guides/mid",
          "https://iranopedia.com/guides/final",
        ],
      }),
    );
    expect(f!.kind).toBe("redirect_chain");
    expect(f!.hopCount).toBe(2);
    expect(f!.finalUrl).toBe("https://iranopedia.com/guides/final");
    expect(f!.reason_copy).toContain("/guides/old");
    expect(f!.reason_copy).toContain("2 redirects");
    expect(f!.reason_copy).not.toMatch(/[–—]/);
  });

  it("fires on a soft-404 from Google's coverage verdict", () => {
    const [f] = classifyRedirectHygiene(page({ coverageState: "Soft 404" }));
    expect(f!.kind).toBe("soft_404");
    expect(f!.reason_copy).toContain("Google's index reads it as empty");
    expect(f!.reason_copy).not.toMatch(/[–—]/);
  });

  it("can emit BOTH a chain and a soft-404 for one page, chain first", () => {
    const findings = classifyRedirectHygiene(
      page({
        redirectChain: ["https://iranopedia.com/a", "https://iranopedia.com/b"],
        coverageState: "Soft 404",
      }),
    );
    expect(findings.map((f) => f.kind)).toEqual(["redirect_chain", "soft_404"]);
  });

  // ── clean / no-false-positive cases ──
  it("is empty for a page with no chain and healthy coverage", () => {
    expect(
      classifyRedirectHygiene(page({ redirectChain: [], coverageState: "Submitted and indexed" })),
    ).toEqual([]);
  });

  it("does NOT flag a single-hop redirect (a normal redirect is fine)", () => {
    expect(
      classifyRedirectHygiene(page({ redirectChain: ["https://iranopedia.com/final"] })),
    ).toEqual([]);
  });

  it("is empty below the demand floor even with a chain (no demand to protect)", () => {
    expect(
      classifyRedirectHygiene(
        page({
          redirectChain: ["https://a", "https://b"],
          impressions90d: REDIRECT_HYGIENE_MIN_IMPRESSIONS_90D - 1,
        }),
      ),
    ).toEqual([]);
  });
});
