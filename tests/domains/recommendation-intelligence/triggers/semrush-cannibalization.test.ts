/**
 * Cannibalization slice (2026-06-12) — detector + trigger tests.
 */

import { describe, expect, it } from "vitest";

import { detectCannibalization } from "@/domains/recommendation-intelligence/semrush-page-signals";
import { semrushCannibalization } from "@/domains/recommendation-intelligence/triggers/semrush-cannibalization";

const row = (
  keyword: string,
  url: string,
  position: number,
  intent: string | null = "1",
  volume = 590,
) => ({ keyword, url, position, intent, volume });

describe("detectCannibalization", () => {
  it("pairs two own URLs ranking the SAME keyword with the same intent (preferred = better position)", () => {
    const cases = detectCannibalization([
      row("persian rugs", "https://x.com/rugs", 4),
      row("persian rugs", "https://x.com/blog/rugs-guide", 11),
      row("unrelated", "https://x.com/other", 3),
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.preferredUrl).toBe("https://x.com/rugs");
    expect(cases[0]!.cannibalUrl).toBe("https://x.com/blog/rugs-guide");
  });

  it("never pairs rows with DIFFERENT intent (legitimately different pages)", () => {
    const cases = detectCannibalization([
      row("persian rugs", "https://x.com/rugs", 4, "3"),
      row("persian rugs", "https://x.com/blog/rugs-guide", 11, "1"),
    ]);
    expect(cases).toEqual([]);
  });

  it("returns [] for single-URL keywords (the healthy case)", () => {
    expect(
      detectCannibalization([row("persian rugs", "https://x.com/rugs", 4)]),
    ).toEqual([]);
  });
});

describe("semrushCannibalization trigger", () => {
  it("emits operator-review advice targeting the CANNIBAL page, capped", () => {
    const cases = detectCannibalization([
      row("persian rugs", "https://x.com/rugs", 4),
      row("persian rugs", "https://x.com/blog/rugs-guide", 11),
    ]);
    const out = semrushCannibalization({
      tenantId: "tenant-a",
      cases,
      signalAt: "2026-06-12T00:00:00Z",
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("semrush_cannibalization");
    expect(c.action_type).toBe("add_internal_link");
    expect(c.target_url).toBe("https://x.com/blog/rugs-guide");
    expect(c.operator_evidence).toContain("preferred=https://x.com/rugs");
    expect(c.customer_copy).toContain("persian rugs");
  });
});
