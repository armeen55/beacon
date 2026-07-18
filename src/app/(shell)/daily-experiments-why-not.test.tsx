/**
 * WhyNotOthers (R14a) - render pins for the quiet "Why not the others?" expander on
 * the daily card: the plan record's own frozen exclusions, plain sentences only,
 * capped at 8, self-hiding when the planner excluded nothing.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WhyNotOthers } from "./daily-experiments-section";
import { leverFieldToActionType } from "@/domains/experiments/build-today-preview";
import type { ExcludedPickRecord } from "@/domains/experiments/daily-plan-types";
import {
  planDependencies,
  dependencyHoldLookup,
  type DependencyCandidate,
} from "@/domains/experiments/dependency-planner";

describe("WhyNotOthers (R14a)", () => {
  it("self-hides when the planner excluded nothing (and on pre-R14a plans)", () => {
    expect(renderToStaticMarkup(<WhyNotOthers excluded={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<WhyNotOthers excluded={[]} />)).toBe("");
  });

  it("renders the planner's own frozen sentence and the code translation, never a raw code", () => {
    const excluded: ExcludedPickRecord[] = [
      {
        url: "https://iranopedia.com/persian-cat",
        actionFamily: "meta",
        reason: "query_overlap_hold",
        plainReason:
          "I am holding this because it competes for the same searches as today's pick for /persian-cats.",
      },
      { url: "https://iranopedia.com/iran-flags", actionFamily: "meta", reason: "budget_full" },
    ];
    const html = renderToStaticMarkup(<WhyNotOthers excluded={excluded} />);
    expect(html).toContain("Why not the others?");
    expect(html).toContain(
      "I am holding this because it competes for the same searches as today&#x27;s pick for /persian-cats.",
    );
    expect(html).toContain("Today&#x27;s time budget was already full.");
    expect(html).not.toContain("query_overlap_hold");
    expect(html).not.toContain("budget_full");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("caps the rendered list at 8", () => {
    const excluded: ExcludedPickRecord[] = Array.from({ length: 12 }, (_, i) => ({
      url: `https://iranopedia.com/p${i}`,
      reason: "over_max",
    }));
    const html = renderToStaticMarkup(<WhyNotOthers excluded={excluded} />);
    expect(html).toContain("/p7");
    expect(html).not.toContain("/p8");
  });
});

describe("N45 dependency holds live (leverFieldToActionType + planDependencies -> WhyNotOthers)", () => {
  it("maps each daily lever field to the canonical ActionType dependency-planner reasons over", () => {
    expect(leverFieldToActionType("title")).toBe("edit_title");
    expect(leverFieldToActionType("meta")).toBe("edit_meta");
    expect(leverFieldToActionType("h1")).toBe("change_h1");
    expect(leverFieldToActionType("internal_link")).toBe("add_internal_link");
    expect(leverFieldToActionType("answer_block")).toBe("add_answer_block");
    expect(leverFieldToActionType("refresh")).toBe("full_rewrite");
    expect(leverFieldToActionType("seasonal_prep")).toBe("full_rewrite");
  });

  it("a dependent candidate's prerequisite_pending hold RENDERS in the inspector (the full live chain)", () => {
    // The exact batch the wire-in builds: an internal-link candidate pointing at a page that is
    // ITSELF a not-yet-shipped create_page candidate in the same batch (build_hub_page).
    const candidates: DependencyCandidate[] = [
      { id: "https://s.com/blog", url: "https://s.com/blog", actionType: "add_internal_link", linkDestinationUrl: "https://s.com/hub" },
      { id: "https://s.com/hub", url: "https://s.com/hub", actionType: "create_page" },
    ];
    const holdById = dependencyHoldLookup(planDependencies(candidates));
    expect(holdById.size).toBe(1);
    const plainReason = holdById.get("https://s.com/blog");
    expect(plainReason).toBeTruthy();

    // That plainReason flows through the planner as a prerequisite_pending exclusion and is
    // frozen on the plan record; the R14a inspector renders it verbatim.
    const excluded: ExcludedPickRecord[] = [
      { url: "https://s.com/blog", actionFamily: "link", reason: "prerequisite_pending", plainReason },
    ];
    const html = renderToStaticMarkup(<WhyNotOthers excluded={excluded} />);
    expect(html).toContain("Why not the others?");
    expect(html).toContain("Build /hub first.");
    expect(html).not.toContain("prerequisite_pending");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("BYTE-IDENTICAL when no dependency exists: empty holds, nothing extra rendered", () => {
    // Two independent content edits, no prerequisite relationship between them.
    const candidates: DependencyCandidate[] = [
      { id: "https://s.com/a", url: "https://s.com/a", actionType: "edit_meta" },
      { id: "https://s.com/b", url: "https://s.com/b", actionType: "edit_title" },
    ];
    const holdById = dependencyHoldLookup(planDependencies(candidates));
    expect(holdById.size).toBe(0);
    // No prerequisite_pending exclusion is produced, so the inspector shows nothing for it.
    const html = renderToStaticMarkup(<WhyNotOthers excluded={[]} />);
    expect(html).toBe("");
  });

  it("even with a prerequisite ALREADY shipped, nothing is held (byte-identical)", () => {
    const candidates: DependencyCandidate[] = [
      { id: "https://s.com/blog", url: "https://s.com/blog", actionType: "add_internal_link", linkDestinationUrl: "https://s.com/hub" },
      { id: "https://s.com/hub", url: "https://s.com/hub", actionType: "create_page", alreadyShipped: true },
    ];
    expect(dependencyHoldLookup(planDependencies(candidates)).size).toBe(0);
  });
});
