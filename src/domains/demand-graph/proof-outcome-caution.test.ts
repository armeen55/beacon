import { describe, it, expect } from "vitest";
import {
  cautionForMove,
  applyProofOutcomeCautionToMoves,
  familyOfMoveGap,
  type ProofOutcomeRow,
} from "./proof-outcome-caution";

const row = (over: Partial<ProofOutcomeRow>): ProofOutcomeRow => ({
  id: "r1", page: "https://iranopedia.com/persian-boy-names", actionType: "title",
  verdict: "measuring", confidence: "medium", operatorVerdictOverride: null, baselineImpressions: 500, ...over,
});
const move = { ownedUrl: "https://iranopedia.com/persian-boy-names", gap: "edit_page" as const };

describe("familyOfMoveGap — Move gap → Results-linker family", () => {
  it("maps gaps to the shared family vocabulary", () => {
    expect(familyOfMoveGap("answer_block")).toBe("aeo");
    expect(familyOfMoveGap("add_schema")).toBe("aeo");
    expect(familyOfMoveGap("internal_links")).toBe("links");
    expect(familyOfMoveGap("fix_experience")).toBe("cro");
    expect(familyOfMoveGap("create_page")).toBe("new_page");
    expect(familyOfMoveGap("edit_page")).toBe("edit");
  });
});

describe("cautionForMove — conservative page-specific prior", () => {
  it("HOLDS a move whose page+family is still measuring (slight demote, no boost)", () => {
    const c = cautionForMove(move, [row({ verdict: "measuring", actionType: "title" })]);
    expect(c.kind).toBe("held_measuring");
    expect(c.multiplier).toBeLessThan(1);
    expect(c.label).toMatch(/still measuring/i);
    expect(c.evidence).toEqual(["r1"]);
  });
  it("DEMOTES a no-lift/lost repeat on the same page+family", () => {
    const c = cautionForMove(move, [row({ verdict: "lost", actionType: "title" })]);
    expect(c.kind).toBe("no_lift");
    expect(c.multiplier).toBeLessThan(0.95);
  });
  it("a no-lift loss carries a deterministic DIFFERENT-lever next action (not 'repeat the same')", () => {
    const c = cautionForMove(move, [row({ verdict: "lost", actionType: "title" })]);
    expect(c.nextLever).toBeTruthy();
    // a title/meta loss should steer AWAY from another title/meta tweak
    expect(c.nextLever!.toLowerCase()).toMatch(/answer block|internal link|ux|intent/);
    expect(c.nextLever!.toLowerCase()).not.toMatch(/another title.meta tweak instead|repeat the title/);
  });
  it("non-loss cautions carry no nextLever", () => {
    const held = cautionForMove(move, [row({ verdict: "measuring", actionType: "title" })]);
    expect(held.kind).toBe("held_measuring");
    expect(held.nextLever ?? null).toBeNull();
  });
  it("loss outranks measuring when both exist on the page", () => {
    const c = cautionForMove(move, [row({ id: "m", verdict: "measuring" }), row({ id: "l", verdict: "lost" })]);
    expect(c.kind).toBe("no_lift");
    expect(c.evidence).toEqual(["l"]);
  });
  it("modestly BOOSTS a follow-up on a page that lifted (verdict-ready, real baseline)", () => {
    const c = cautionForMove(move, [row({ verdict: "won", confidence: "high", baselineImpressions: 1200 })]);
    expect(c.kind).toBe("lifted");
    expect(c.multiplier).toBeGreaterThan(1);
  });
  it("does NOT boost a low-confidence win (conservative)", () => {
    const c = cautionForMove(move, [row({ verdict: "won", confidence: "low", baselineImpressions: 1200 })]);
    expect(c.kind).toBe("neutral");
    expect(c.multiplier).toBe(1);
  });
  it("does NOT boost a win with a tiny baseline", () => {
    const c = cautionForMove(move, [row({ verdict: "won", confidence: "high", baselineImpressions: 50 })]);
    expect(c.kind).toBe("neutral");
  });
  it("ignores inconclusive / insufficient_data (no learning)", () => {
    expect(cautionForMove(move, [row({ verdict: "inconclusive" })]).kind).toBe("neutral");
    expect(cautionForMove(move, [row({ verdict: "insufficient_data" })]).kind).toBe("neutral");
  });
  it("respects operator override = inconclusive (excluded from learning)", () => {
    expect(cautionForMove(move, [row({ verdict: "lost", operatorVerdictOverride: "inconclusive" })]).kind).toBe("neutral");
  });
  it("ignores a different page entirely", () => {
    expect(cautionForMove(move, [row({ page: "https://iranopedia.com/other" })]).kind).toBe("neutral");
  });
  it("ignores an incompatible family on the same page (new_page never bridges edit)", () => {
    const aeoMove = { ownedUrl: move.ownedUrl, gap: "answer_block" as const };
    // a 'create/new_page' ledger action is incompatible with an aeo move
    expect(cautionForMove(aeoMove, [row({ verdict: "lost", actionType: "create new page" })]).kind).toBe("neutral");
  });
});

describe("applyProofOutcomeCautionToMoves — bounded re-rank, safe rollout", () => {
  const mk = (demandKey: string, ownedUrl: string | null, gap: string, score: number) =>
    ({ demandKey, label: demandKey, gap, score, ownedUrl } as never);
  it("no rows → byte-identical order, neutral attached", () => {
    const moves = [mk("a", "https://x.com/a", "edit_page", 100), mk("b", "https://x.com/b", "edit_page", 90)];
    const out = applyProofOutcomeCautionToMoves(moves, []);
    expect(out.map((m: any) => m.demandKey)).toEqual(["a", "b"]);
    expect(out.every((m: any) => m.outcomeCaution.kind === "neutral")).toBe(true);
  });
  it("a no-lift demote is bounded (±10%) and cannot vault a far-higher-demand move", () => {
    const moves = [
      mk("hi", "https://iranopedia.com/big", "edit_page", 100),
      mk("lo", "https://iranopedia.com/small", "edit_page", 95),
    ];
    const rows = [row({ page: "https://iranopedia.com/big", verdict: "lost", actionType: "title" })];
    const out = applyProofOutcomeCautionToMoves(moves, rows);
    const hi = out.find((m: any) => m.demandKey === "hi") as any;
    expect(hi.score).toBeGreaterThanOrEqual(90); // 100 * 0.90 = 90, never below the ±10% floor
    expect(hi.outcomeCaution.kind).toBe("no_lift");
  });
});
