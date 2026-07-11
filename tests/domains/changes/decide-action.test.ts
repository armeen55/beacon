/**
 * decide-action (Wave 3C) - THE single decision authority. Every input dimension the spec names
 * (RecommendationAction / UnifiedKind / changeFamily) maps to exactly ONE of the six decisions,
 * and the cannibalization directive is always a single action, never a "X or Y" fork.
 */
import { describe, expect, it } from "vitest";
import {
  decideChangeAction,
  decisionFromRecommendationAction,
  decisionFromUnifiedKind,
  decisionFromChangeFamily,
  decisionFromCannibalization,
  cannibalizationDirective,
  DECISION_CTA,
  DECISION_LABEL,
  ACT_DECISIONS,
  isActDecision,
  type ChangeDecision,
} from "@/domains/changes/decide-action";
import type { RecommendationAction } from "@/domains/recommendations/resolved-types";
import type { UnifiedKind } from "@/domains/allocator/unified-list";
import type { CanonicalChange } from "@/domains/changes/canonical-change";

const SIX: ReadonlySet<ChangeDecision> = new Set<ChangeDecision>([
  "do_nothing", "watch", "edit_existing", "consolidate", "create_new_page", "prune_redirect",
]);

describe("decisionFromRecommendationAction - every action maps to one of the six", () => {
  const cases: Array<[RecommendationAction, ChangeDecision]> = [
    ["watch", "watch"],
    ["needs_review", "watch"],
    ["strengthen_existing_page", "edit_existing"],
    ["expand_existing_page", "edit_existing"],
    ["add_section_or_faq", "edit_existing"],
    ["create_new_page", "create_new_page"],
    ["merge_or_dedupe", "consolidate"],
    ["split_or_separate_page", "edit_existing"], // no demand -> cheaper edit in place
  ];
  for (const [action, expected] of cases) {
    it(`${action} -> ${expected}`, () => {
      const d = decisionFromRecommendationAction(action);
      expect(SIX.has(d)).toBe(true);
      expect(d).toBe(expected);
    });
  }
  it("split_or_separate_page with real demand -> create_new_page", () => {
    expect(decisionFromRecommendationAction("split_or_separate_page", { hasDemand: true })).toBe("create_new_page");
  });
});

describe("decisionFromUnifiedKind - every kind maps to one of the six", () => {
  const cases: Array<[UnifiedKind, ChangeDecision]> = [
    ["edit", "edit_existing"],
    ["link", "edit_existing"],
    ["fix", "edit_existing"],
    ["promote", "edit_existing"],
    ["create", "create_new_page"],
  ];
  for (const [kind, expected] of cases) {
    it(`${kind} -> ${expected}`, () => {
      const d = decisionFromUnifiedKind(kind);
      expect(SIX.has(d)).toBe(true);
      expect(d).toBe(expected);
    });
  }
});

describe("decisionFromChangeFamily - every family maps to one of the six", () => {
  for (const family of ["meta", "title", "h1", "answer", "link", "schema", "cro", "other", "new_page", "hub"]) {
    it(`${family} -> ${family === "new_page" || family === "hub" ? "create_new_page" : "edit_existing"}`, () => {
      const d = decisionFromChangeFamily(family);
      expect(SIX.has(d)).toBe(true);
      expect(d).toBe(family === "new_page" || family === "hub" ? "create_new_page" : "edit_existing");
    });
  }
});

function cc(over: Partial<CanonicalChange>): CanonicalChange {
  return {
    id: "x", tenantId: "t", pagePath: "/x", pageUrl: "https://s/x", pageLabel: "x",
    opportunityType: "Capture clicks", changeType: "edit_meta", changeFamily: "meta",
    status: "suggested", recommendation: "r", exactInstructions: null, before: null, after: null,
    rationale: "why", estimatedEffortMinutes: 2, impactScore: 10, upside: null, expectedOutcome: null,
    riskLevel: "low", evidenceStrength: "directional", measurementMethod: "m", selectedForToday: false,
    activeExperiment: false, protectedControl: false, blockedReason: null, result: null,
    measurementHeadline: null, measurementDetail: null, nextCheckpoint: null, attributionLimited: false,
    sourceIds: [], alternateOpportunities: [], ...over,
  } as CanonicalChange;
}

describe("decideChangeAction - the CanonicalChange entry always returns one of six + a one-to-one CTA", () => {
  it("a blocked change is do_nothing (off the command path), never a confident action", () => {
    const { decision, cta } = decideChangeAction(cc({ status: "blocked" }));
    expect(decision).toBe("do_nothing");
    expect(cta).toBeNull();
  });
  it("a quality-flagged change is watched, never presented as ready", () => {
    const { decision, cta } = decideChangeAction(cc({ status: "suggested", qualityDecision: "flagged" }));
    expect(decision).toBe("watch");
    expect(cta).toBe("Why I'm waiting");
  });
  it("a new_page family change is a create", () => {
    expect(decideChangeAction(cc({ changeFamily: "new_page", changeType: "create_new_page" })).decision).toBe("create_new_page");
  });
  it("a plain meta edit is edit_existing with the See-the-edit CTA", () => {
    const { decision, cta } = decideChangeAction(cc({ changeFamily: "meta", changeType: "edit_meta" }));
    expect(decision).toBe("edit_existing");
    expect(cta).toBe(DECISION_CTA.edit_existing);
  });
  it("a merge changeType is a consolidate", () => {
    expect(decideChangeAction(cc({ changeType: "merge_or_dedupe" })).decision).toBe("consolidate");
  });
  it("the source move's cannibalization decision wins over the type/family default", () => {
    const move = { cannibalization: [{ isLead: true, decision: "prune_redirect" as ChangeDecision }] };
    expect(decideChangeAction(cc({ changeFamily: "meta" }), move).decision).toBe("prune_redirect");
  });
  it("every decision has a defined label and a defined (or null) CTA", () => {
    for (const d of SIX) {
      expect(DECISION_LABEL[d]).toBeTruthy();
      expect(DECISION_CTA).toHaveProperty(d);
    }
    expect([...ACT_DECISIONS].every((d) => isActDecision(d))).toBe(true);
    expect(isActDecision("watch")).toBe(false);
    expect(isActDecision("do_nothing")).toBe(false);
  });
});

describe("cannibalizationDirective - always ONE action, never a two-action fork", () => {
  const inputs = [
    { decision: "consolidate" as ChangeDecision, isLead: true },
    { decision: "edit_existing" as ChangeDecision, isLead: true },
    { decision: "edit_existing" as ChangeDecision, isLead: false },
    { decision: "prune_redirect" as ChangeDecision, isLead: true },
    { decision: "prune_redirect" as ChangeDecision, isLead: false },
  ];
  for (const i of inputs) {
    it(`${i.decision}/${i.isLead ? "lead" : "follower"} is a single directive with no " or " fork`, () => {
      const s = cannibalizationDirective({ ...i, leadPage: "Best Page", otherPages: ["Other Page"], query: "iran flag" });
      expect(s).not.toMatch(/\b(redirect|link|edit|create|merge|differentiate|update|fold)\s+or\s+/i);
      expect(s).not.toMatch(/[–—]/); // no em/en dash
      expect(s.length).toBeGreaterThan(0);
    });
  }
  it("decisionFromCannibalization: dead followers on a lead page get a redirect, live ones an edit", () => {
    expect(decisionFromCannibalization({ isLead: true, followerHasDemand: false })).toBe("prune_redirect");
    expect(decisionFromCannibalization({ isLead: true, followerHasDemand: true })).toBe("edit_existing");
    expect(decisionFromCannibalization({ isLead: false })).toBe("edit_existing");
    expect(decisionFromCannibalization({ isLead: false, leadIsHome: true })).toBe("edit_existing");
  });
});
