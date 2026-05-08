/**
 * Behavioral tests — UX.6.2 site-findings-labels (2026-05-07).
 *
 * Pure-helper tests for the unified vocabulary module that replaces
 * three competing names ("scan diff" / "page issue" / "scan diffs to
 * review") for the same scan_findings layer. Every consumer routes
 * through these helpers so the entire vocabulary can be edited from
 * one place later.
 */

import { describe, expect, it } from "vitest";
import {
  SITE_FINDING_NOUN,
  SITE_FINDING_NOUN_PLURAL,
  siteFindingNoun,
  compactStripLabel,
  doNextHeadline,
  doNextSubtitle,
  recentSiteChangesHeading,
  RECENT_SITE_CHANGES_SUBTITLE,
} from "./site-findings-labels";

describe("siteFindingNoun — pluralization", () => {
  it("singular for count === 1", () => {
    expect(siteFindingNoun(1)).toBe(SITE_FINDING_NOUN);
    expect(siteFindingNoun(1)).toBe("site finding");
  });

  it("plural for count !== 1 (incl. 0)", () => {
    expect(siteFindingNoun(0)).toBe(SITE_FINDING_NOUN_PLURAL);
    expect(siteFindingNoun(2)).toBe(SITE_FINDING_NOUN_PLURAL);
    expect(siteFindingNoun(133)).toBe(SITE_FINDING_NOUN_PLURAL);
    expect(siteFindingNoun(775)).toBe(SITE_FINDING_NOUN_PLURAL);
    expect(siteFindingNoun(0)).toBe("site findings");
  });
});

describe("compactStripLabel — Action Queue strip copy", () => {
  it("renders the operator's example: 775 site findings · 133 important", () => {
    expect(
      compactStripLabel({ total: 775, important: 133, critical: 0 }),
    ).toBe("775 site findings · 133 important");
  });

  it("includes critical first, then important, when both > 0", () => {
    expect(
      compactStripLabel({ total: 775, important: 130, critical: 3 }),
    ).toBe("775 site findings · 3 critical · 130 important");
  });

  it("shows critical alone when important === 0", () => {
    expect(
      compactStripLabel({ total: 50, important: 0, critical: 5 }),
    ).toBe("50 site findings · 5 critical");
  });

  it("drops the trailing list when no critical/important", () => {
    expect(
      compactStripLabel({ total: 5, important: 0, critical: 0 }),
    ).toBe("5 site findings");
    expect(
      compactStripLabel({ total: 1, important: 0, critical: 0 }),
    ).toBe("1 site finding");
  });

  it("never says 'page issue' or 'scan diff' or 'urgent'", () => {
    const out = compactStripLabel({
      total: 775,
      important: 133,
      critical: 3,
    });
    expect(out).not.toMatch(/page issue/);
    expect(out).not.toMatch(/scan diff/);
    expect(out).not.toMatch(/urgent/);
  });
});

describe("doNextHeadline — Do Next card site-findings branch", () => {
  it("leads with critical when critical > 0", () => {
    expect(doNextHeadline({ critical: 3, important: 130 })).toBe(
      "3 critical site findings need review",
    );
  });

  it("singular form for 1 critical", () => {
    expect(doNextHeadline({ critical: 1, important: 0 })).toBe(
      "1 critical site finding needs review",
    );
  });

  it("falls back to important when critical === 0", () => {
    expect(doNextHeadline({ critical: 0, important: 133 })).toBe(
      "133 important site findings to review",
    );
  });

  it("singular form for 1 important", () => {
    expect(doNextHeadline({ critical: 0, important: 1 })).toBe(
      "1 important site finding to review",
    );
  });

  it("never uses 'scan diff' wording", () => {
    expect(doNextHeadline({ critical: 5, important: 0 })).not.toMatch(
      /scan diff/i,
    );
    expect(doNextHeadline({ critical: 0, important: 5 })).not.toMatch(
      /scan diff/i,
    );
  });
});

describe("doNextSubtitle — explains 133/775/7 relationship in plain English", () => {
  it("operator's exact pain: total + important + shown render together", () => {
    const out = doNextSubtitle({
      total: 775,
      critical: 0,
      important: 133,
      shownInPreview: 7,
    });
    expect(out).toContain("775 total site findings detected");
    expect(out).toContain("133 important");
    expect(out).toContain("showing 7 most recent");
  });

  it("renders both critical and important when both > 0", () => {
    const out = doNextSubtitle({
      total: 775,
      critical: 3,
      important: 130,
    });
    expect(out).toContain("3 critical");
    expect(out).toContain("130 important");
  });

  it("renders critical alone when important === 0", () => {
    const out = doNextSubtitle({
      total: 50,
      critical: 5,
      important: 0,
    });
    expect(out).toContain("5 critical");
    expect(out).not.toMatch(/\bimportant\b/);
  });

  it("omits the 'showing N most recent' tail when shownInPreview is missing or >= total", () => {
    const noShown = doNextSubtitle({ total: 10, critical: 0, important: 5 });
    expect(noShown).not.toMatch(/showing/i);
    const allShown = doNextSubtitle({
      total: 10,
      critical: 0,
      important: 5,
      shownInPreview: 10,
    });
    expect(allShown).not.toMatch(/showing/i);
  });

  it("ends with a period for natural reading", () => {
    const out = doNextSubtitle({ total: 5, critical: 0, important: 0 });
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("recentSiteChangesHeading — bottom accordion heading", () => {
  it("renders the operator's required pattern", () => {
    expect(recentSiteChangesHeading(7)).toBe("Recent site changes (7)");
  });

  it("includes the count even at zero (caller decides whether to render)", () => {
    expect(recentSiteChangesHeading(0)).toBe("Recent site changes (0)");
    expect(recentSiteChangesHeading(1)).toBe("Recent site changes (1)");
    expect(recentSiteChangesHeading(133)).toBe(
      "Recent site changes (133)",
    );
  });
});

describe("RECENT_SITE_CHANGES_SUBTITLE — accordion subtitle", () => {
  it("uses customer-safe vocabulary (no 'raw' or 'scanner')", () => {
    expect(RECENT_SITE_CHANGES_SUBTITLE).not.toMatch(/\braw\b/i);
    expect(RECENT_SITE_CHANGES_SUBTITLE).not.toMatch(/scanner/i);
  });

  it("explains the changelog/attribution contract in operator-friendly words", () => {
    expect(RECENT_SITE_CHANGES_SUBTITLE).toMatch(/changelog/i);
    expect(RECENT_SITE_CHANGES_SUBTITLE).toMatch(/attribution/i);
    expect(RECENT_SITE_CHANGES_SUBTITLE).toContain(
      "Content & structure changes",
    );
  });
});
