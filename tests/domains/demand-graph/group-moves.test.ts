import { describe, it, expect } from "vitest";
import { groupMovesByOwnedPage, secondaryGapPhrase } from "@/domains/demand-graph/group-moves";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

function move(p: Partial<MoveCandidate> & { gap: MoveCandidate["gap"]; demandKey: string }): MoveCandidate {
  return {
    demandKey: p.demandKey, label: p.label ?? "x", gap: p.gap, score: p.score ?? 100,
    components: p.components ?? { demand: 100, winnability: 0.5, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: p.confidence ?? "high", signals: p.signals ?? [], ownedUrl: p.ownedUrl ?? null,
    competitorUrls: p.competitorUrls ?? [], fanoutSeeds: p.fanoutSeeds ?? [], rationale: p.rationale ?? "",
  };
}

describe("groupMovesByOwnedPage — one primary per page", () => {
  it("collapses same-page Moves to one primary + secondary (highest score wins)", () => {
    const groups = groupMovesByOwnedPage([
      move({ gap: "answer_block", demandKey: "a", ownedUrl: "https://x.com/iran-flag", score: 4000 }),
      move({ gap: "fix_experience", demandKey: "b", ownedUrl: "https://x.com/iran-flag", score: 3900 }),
      move({ gap: "edit_page", demandKey: "c", ownedUrl: "https://x.com/cities", score: 500 }),
    ]);
    expect(groups).toHaveLength(2); // iran-flag collapsed, cities separate
    const flag = groups.find((g) => g.primary.ownedUrl === "https://x.com/iran-flag")!;
    expect(flag.primary.gap).toBe("answer_block"); // higher score is primary
    expect(flag.secondary.map((s) => s.gap)).toEqual(["fix_experience"]);
  });

  it("never merges create_page (no owned URL) — each stays standalone", () => {
    const groups = groupMovesByOwnedPage([
      move({ gap: "create_page", demandKey: "a", ownedUrl: null }),
      move({ gap: "create_page", demandKey: "b", ownedUrl: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.secondary.length === 0)).toBe(true);
  });

  it("orders groups by primary score", () => {
    const groups = groupMovesByOwnedPage([
      move({ gap: "edit_page", demandKey: "lo", ownedUrl: "https://x.com/a", score: 100 }),
      move({ gap: "edit_page", demandKey: "hi", ownedUrl: "https://x.com/b", score: 9000 }),
    ]);
    expect(groups[0]!.primary.demandKey).toBe("hi");
  });

  it("secondaryGapPhrase is plain English", () => {
    expect(secondaryGapPhrase("fix_experience")).toContain("friction");
    expect(secondaryGapPhrase("answer_block")).toContain("answer");
  });
});
