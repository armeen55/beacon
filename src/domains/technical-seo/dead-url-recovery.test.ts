import { describe, expect, it } from "vitest";

import {
  classifyDeadUrl,
  coverageSaysGone,
  DEAD_URL_MIN_IMPRESSIONS_90D,
  type DeadUrlPageInput,
} from "./dead-url-recovery";

function page(over: Partial<DeadUrlPageInput> = {}): DeadUrlPageInput {
  return {
    url: "https://iranopedia.com/old-nowruz-guide",
    httpStatus: 404,
    coverageState: null,
    impressions90d: 300,
    clicks90d: 12,
    ...over,
  };
}

describe("coverageSaysGone", () => {
  it("returns false for null / empty / healthy coverage", () => {
    expect(coverageSaysGone(null)).toBe(false);
    expect(coverageSaysGone("")).toBe(false);
    expect(coverageSaysGone("Submitted and indexed")).toBe(false);
  });

  it("returns true for gone-family coverage states", () => {
    expect(coverageSaysGone("Not found (404)")).toBe(true);
    expect(coverageSaysGone("Submitted URL not found (404)")).toBe(true);
    expect(coverageSaysGone("URL is unknown to Google")).toBe(true);
    expect(coverageSaysGone("Crawled - currently not indexed")).toBe(true);
    expect(coverageSaysGone("Page removed")).toBe(true);
  });

  it("does NOT treat a soft 404 as gone (redirect-hygiene owns that)", () => {
    expect(coverageSaysGone("Soft 404")).toBe(false);
  });
});

describe("classifyDeadUrl", () => {
  it("fires on a 404 with real demand (recovery Move)", () => {
    const f = classifyDeadUrl(page({ httpStatus: 404 }));
    expect(f).not.toBeNull();
    expect(f!.reason).toBe("http_not_found");
    expect(f!.reason_copy).toContain("/old-nowruz-guide");
    expect(f!.reason_copy).toContain("Not Found");
    expect(f!.reason_copy).toContain("Restore the page");
    // dash-free
    expect(f!.reason_copy).not.toMatch(/[–—]/);
  });

  it("fires on a 410 Gone with the 'taken down' framing", () => {
    const f = classifyDeadUrl(page({ httpStatus: 410 }));
    expect(f!.reason).toBe("http_gone");
    expect(f!.reason_copy).toContain("taken down");
  });

  it("fires on index_dropped: a loading (200) page Google's index treats as gone", () => {
    const f = classifyDeadUrl(
      page({ httpStatus: 200, coverageState: "Not found (404)" }),
    );
    expect(f!.reason).toBe("index_dropped");
    expect(f!.reason_copy).toContain("Google's index has dropped");
  });

  it("mentions clicks when the dead page still gets clicks", () => {
    const f = classifyDeadUrl(page({ httpStatus: 404, clicks90d: 20 }));
    expect(f!.reason_copy).toContain("clicked through");
  });

  it("omits the clicks clause when clicks are zero", () => {
    const f = classifyDeadUrl(page({ httpStatus: 404, clicks90d: 0 }));
    expect(f!.reason_copy).not.toContain("clicked through");
  });

  // ── clean / no-false-positive cases ──
  it("is empty for a healthy 200 page with no gone verdict", () => {
    expect(classifyDeadUrl(page({ httpStatus: 200, coverageState: "Submitted and indexed" }))).toBeNull();
  });

  it("is empty for a dead page BELOW the demand floor (no demand to protect)", () => {
    expect(
      classifyDeadUrl(page({ httpStatus: 404, impressions90d: DEAD_URL_MIN_IMPRESSIONS_90D - 1 })),
    ).toBeNull();
  });

  it("does NOT fire on a redirect (that is redirect-hygiene's job)", () => {
    expect(classifyDeadUrl(page({ httpStatus: 301 }))).toBeNull();
    expect(classifyDeadUrl(page({ httpStatus: 308 }))).toBeNull();
  });

  it("does NOT fire on a 200 whose coverage is a soft 404 (redirect-hygiene owns it)", () => {
    expect(classifyDeadUrl(page({ httpStatus: 200, coverageState: "Soft 404" }))).toBeNull();
  });

  it("does NOT fire on a 500 (a server error is not a 'gone' page - technical-demand covers it)", () => {
    // 500 is neither 404 nor 410 and coverage is null, so dead-url-recovery abstains.
    expect(classifyDeadUrl(page({ httpStatus: 500, coverageState: null }))).toBeNull();
  });
});
