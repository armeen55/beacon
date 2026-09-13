/** Signature-specific learning through real ranking and Results consumers on two synthetic accounts. */
import { describe, expect, it } from "vitest";
import { learningFromShipments } from "@/domains/measurement";
import { rankProposals } from "@/domains/decision";
import type { ChangeProposal } from "@/domains/decision";
import { SHIPMENT_PROOF } from "@/domains/measurement/proof-gsc/shipment-proof";

const SHIPPED = "2026-07-01T00:00:00.000Z", VERIFIED = { status: "verified" as const, checkedAt: "2026-07-02T00:00:00.000Z", components: [] };
/** Two unrelated accounts; losing and winning bets in the same family. */
const SITES = [
  { t: "acct-tide", page: "/tide-pools", q: "tide pool safety" },
  { t: "acct-bordado", page: "/bordado", q: "puntadas de bordado" },
];
type Row = Parameters<typeof learningFromShipments>[0][number];
const read = (lift: number, treatment: string | null): Row => { const r = {
  page: "https://fixture.example/page", before: null,
  actionType: "internal_links", after: "A sentence pointing readers at the other page.", implementedAt: SHIPPED, verification: VERIFIED,
  operatorVerdictOverride: null, pinnedRead: null, componentsApplied: null,
  treatmentStamp: { signature: { family: "internal_links", treatment, field: null, cause: null }, overlapAtShip: 0 },
  baseline: { clicks: 200, impressions: 4000, windowDays: 28, capturedAt: SHIPPED },
  controlsReceipt: [{ path: "/a", reasons: [] }, { path: "/b", reasons: [] }, { path: "/c", reasons: [] }],
  windows: [{ day: 28, ran: true, adjustedLift: lift, controlsUsed: 3, checkOn: "2026-07-29", treatedDelta: 0, controlDelta: 0 }],
} as unknown as Row; return { ...r, verification: { ...VERIFIED, checkerContract: SHIPMENT_PROOF.contract, proof: SHIPMENT_PROOF.of(r, "Inspected page"), components: [{ kind: "internal_links", state: "verified", note: null }] } }; };
/** Nine losing readings of one treatment and three winning readings of another, in one family. */
const LEDGER: Row[] = [...Array(9).fill(0).map(() => read(-20, "technical_reachability")), ...Array(3).fill(0).map(() => read(30, "internal_link_or_navigation"))];

const card = (s: (typeof SITES)[number], treatment: string | null, id: string): ChangeProposal => ({
  id: `${s.t}::${s.page}::existing_edit::${id}`, tenantId: s.t, kind: "existing_edit", pagePath: s.page, pageUrl: `https://${s.t}.example${s.page}`,
  pageLabel: "A page", primaryQuery: s.q, opportunityType: "Capture clicks", changeFamily: "internal_links", status: "ready", researchOnly: false,
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "One sentence pointing readers at the other page." },
  ...(treatment ? { treatment } : {}), whyItMatters: "This page loses clicks.", estimatedEffortMinutes: 5, riskLevel: "low", confidence: "high",
  limitations: [], evidence: { query: s.q, hints: [], evidenceRefCount: 3 }, impactScore: 400, upsidePerMonth: null, publish: "manual",
  createdAt: SHIPPED, // no cause is named on these two, so what is riding on them is the measured shortfall itself and the history factor is genuinely reached
} as unknown as ChangeProposal);
const historyOf = (p: ChangeProposal): string => (p.rankingReceipt?.factors ?? []).find((f) => f.name === "history")?.input ?? "";

describe("what a record teaches is read off the work's own signature, and the family answers only where that is silent", () => {
  for (const s of SITES) {
    it(`${s.t}: a losing family record does not discount a bet of its own that is winning`, () => {
      const map = learningFromShipments(LEDGER);
      expect([map.get("link")?.readings, map.get("link::technical_reachability")?.readings, map.get("link::internal_link_or_navigation")?.readings],
        "the one map is keyed both ways off one pass of the ledger: the whole family, and each bet inside it").toEqual([12, 9, 3]);
      const [winning, losing] = [card(s, "internal_link_or_navigation", "a"), card(s, "technical_reachability", "b")];
      const ranked = rankProposals([losing, winning], { familyHistory: map });
      expect(ranked[0]!.id, "the bet whose own readings finished ahead ranks above the one whose own readings finished behind, and the family they share separates them by nothing").toBe(winning.id);
      expect([historyOf(ranked[0]!).includes("This exact kind of change"), historyOf(ranked[1]!).includes("This exact kind of change")],
        "and both receipts say the record they read is this exact kind of change and not the family").toEqual([true, true]);
      expect([historyOf(ranked[1]!), historyOf(ranked[0]!)], "the losing bet is discounted on its own nine readings and the winning one on its own three, and neither is judged on the twelve the family holds").toEqual([expect.stringContaining("116 clicks down across 9 readings here"), expect.stringContaining("34 clicks up across 3 readings here")]);
    });

    it(`${s.t}: a change whose own kind has no readings falls back to the family, and the receipt says which spoke`, () => {
      const unknown = card(s, "consolidate_or_differentiate", "c"); // a bet this account has never shipped
      const [ranked] = rankProposals([unknown], { familyHistory: learningFromShipments(LEDGER) });
      expect(historyOf(ranked!), "with no record of its own it is judged on the whole family, and the sentence says so rather than passing the family off as this exact work").toContain("This whole family of changes is");
      expect(historyOf(ranked!)).toContain("12 readings here");
    });

    it(`${s.t}: with no ledger at all nothing is discounted, and the receipt says that too`, () => {
      const [ranked] = rankProposals([card(s, "internal_link_or_navigation", "a")], { familyHistory: learningFromShipments([]) });
      expect(historyOf(ranked!), "an account with no closed readings is told there are too few, and no record is invented for it").toContain("too few readings of this kind of change have closed here");
    });
  }

  it("the queue and Results read ONE map, so the two can never disagree about the same ledger", async () => {
    await import("@/app/(shell)/results/results-presentation"); // the presentation module and the line library import each other; loading the pair through the entry the surface uses is what keeps the shared constants defined
    const { RESULT_LINES } = await import("@/app/(shell)/results/results-lines");
    const map = learningFromShipments(LEDGER);
    // The page asks the same map the same way: this exact kind of work first, the family only where that holds nothing.
    const rowOf = (treatment: string | null) => ({ read: { id: "r", path: "/p", page: "https://x.example/p", actionType: "internal_links", verdict: "no_clear_movement", metric: "clicks", windows: [], overlappingIds: [], learning: {} }, implementedAt: SHIPPED, verification: VERIFIED, baseline: null, learning: read(0, treatment) } as never);
    expect([RESULT_LINES.fundingFor(map, rowOf("technical_reachability")), RESULT_LINES.fundingFor(map, rowOf("consolidate_or_differentiate"))],
      "the page reads this exact bet's own nine readings where they exist and the family's twelve where they do not, off the same map the ranking eats").toEqual([
        { readings: 9, netLift: -116, of: "kind" }, { readings: 12, netLift: -64, of: "family" }]);
    expect(RESULT_LINES.fundingLine(RESULT_LINES.fundingFor(map, rowOf("technical_reachability"))), "and it says which record spoke, in the funding door's own rule").toBe(
      "9 closed readings of this exact kind of change here are 116 clicks down between them, so the next one is funded below the rest until one finishes ahead.");
  });
});
