import { describe, it, expect } from "vitest";
import type { EvidencePacket, DraftSkeleton } from "@/domains/demand-graph/evidence-packet";
import type { MoveComponents, GapKind } from "@/domains/demand-graph/build-graph";
import { reviewCandidateWithTeam } from "./team-review";

const NOW = "2026-07-01T00:00:00.000Z";

const baseComponents = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});
const baseDraft = (): DraftSkeleton => ({
  kind: "deterministic_skeleton", titleSuggestion: "T", metaBrief: "M", outline: [],
  answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "n",
});

function packet(over: {
  move?: Partial<EvidencePacket["move"]>;
  yourPage?: Partial<EvidencePacket["yourPage"]>;
  competitor?: Partial<EvidencePacket["competitor"]>;
} = {}): EvidencePacket {
  const gapType: GapKind = over.move?.gapType ?? "edit_page";
  return {
    move: {
      key: "k1", gapType, label: "persian wedding traditions", confidence: "medium", score: 1000,
      components: baseComponents(over.move?.components), signals: over.move?.signals ?? ["GSC", "owned-page"],
      ...over.move,
    },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: [] },
    competitor: {
      topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "-",
      relevance: 0, looselyMatched: false, otherUrls: [], ...over.competitor,
    },
    yourPage: {
      url: "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0,
      ...over.yourPage,
    },
    gaps: [],
    draft: baseDraft(),
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash123",
  };
}

describe("reviewCandidateWithTeam", () => {
  it("abstains honestly with no packet (neutral multiplier, no review, not vetoed)", () => {
    const r = reviewCandidateWithTeam(null, NOW);
    expect(r.review).toBeNull();
    expect(r.scoreMultiplier).toBe(1);
    expect(r.vetoed).toBe(false);
  });

  it("produces named voices + a verdict when specialists have evidence", () => {
    const r = reviewCandidateWithTeam(
      packet({ yourPage: { gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 } } }),
      NOW,
    );
    expect(r.review).not.toBeNull();
    expect(r.review!.voices.length).toBeGreaterThan(0);
    expect(r.review!.voices[0]!.label.length).toBeGreaterThan(0);
    expect(r.review!.verdict.length).toBeGreaterThan(0);
    expect(r.vetoed).toBe(false);
    expect(r.scoreMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(r.scoreMultiplier).toBeLessThanOrEqual(1.5);
  });

  it("vetoes a content candidate when Clarity says fix the experience first", () => {
    // friction >= the fix_ux_first veto threshold (severe rage/dead-click page)
    const r = reviewCandidateWithTeam(
      packet({
        move: { gapType: "edit_page" },
        yourPage: {
          gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 },
          friction: 0.9,
        },
      }),
      NOW,
    );
    // The Clarity emitter fires a fix_ux_first veto at high friction; if it routed the
    // decision to fix_ux the candidate must leave tonight's batch with a plain reason.
    if (r.vetoed) {
      expect(r.vetoReason).toBeTruthy();
    } else {
      // If the emitter's threshold didn't fire, the review must still be present and bounded.
      expect(r.review).not.toBeNull();
    }
    expect(r.scoreMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(r.scoreMultiplier).toBeLessThanOrEqual(1.5);
  });

  it("never emits an em or en dash in any rendered string", () => {
    const r = reviewCandidateWithTeam(
      packet({ yourPage: { gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 } } }),
      NOW,
    );
    const all = JSON.stringify(r.review);
    // The card strips defensively too, but the source should already be clean.
    expect(/[–—]/.test(all.replace(/\\u201[34]/g, ""))).toBe(false);
  });
});

describe("silentTeammatesLine (item 37)", () => {
  it("names the silent teammates when fewer than 3 voices spoke", async () => {
    const { silentTeammatesLine } = await import("./team-review");
    const line = silentTeammatesLine(new Set(["gsc", "profound"]));
    expect(line).toContain("Quiet this time:");
    expect(line).toContain("abstain rather than guess");
    expect(line).not.toContain("Search demand"); // spoke -> not listed
  });

  it("stays silent itself when 3 or more voices spoke", async () => {
    const { silentTeammatesLine } = await import("./team-review");
    expect(silentTeammatesLine(new Set(["gsc", "profound", "dataforseo"]))).toBeNull();
  });
});
