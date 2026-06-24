import { describe, it, expect } from "vitest";
import { inferAssetKind, buildAssetSpec } from "@/domains/demand-graph/asset-spec";

describe("asset-spec (Step 5, deterministic, no LLM)", () => {
  it("infers the asset kind from generic intent cues", () => {
    expect(inferAssetKind("adu cost calculator")).toBe("calculator");
    expect(inferAssetKind("custom home cost")).toBe("calculator");
    expect(inferAssetKind("farsi to gregorian date")).toBe("converter");
    expect(inferAssetKind("jalali calendar")).toBe("converter");
    expect(inferAssetKind("persian baby name generator")).toBe("generator");
    expect(inferAssetKind("persian boy names")).toBe("generator");
    expect(inferAssetKind("which iranian city are you quiz")).toBe("quiz");
    expect(inferAssetKind("nowruz haft-sin checklist")).toBe("checklist");
    expect(inferAssetKind("list of iranian singers")).toBe("interactive_table");
    expect(inferAssetKind("history of persia")).toBe("tool"); // no cue → generic
  });

  it("competitor title can disambiguate the kind", () => {
    expect(inferAssetKind("persian wedding", "Persian Wedding Cost Calculator")).toBe("calculator");
  });

  it("buildAssetSpec is grounded + deterministic", () => {
    const a = buildAssetSpec("adu cost", "Ritz Builders", { competitorDomain: "buildzoom.com" });
    expect(a.kind).toBe("calculator");
    expect(a.title).toContain("Calculator");
    expect(a.rationale).toContain("buildzoom.com");
    expect(a.buildPath.toLowerCase()).toContain("wix");
    expect(a.briefForLLM).toContain("adu cost");
    expect(buildAssetSpec("adu cost", "Ritz Builders")).toEqual(buildAssetSpec("adu cost", "Ritz Builders"));
  });
});
