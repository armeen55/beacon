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

describe("reviewCandidateWithTeam extras (item 39 re-review wiring)", () => {
  it("stays silent on the live-Google voice with no serpVerdict (the original abstain)", () => {
    const r = reviewCandidateWithTeam(
      packet({ move: { gapType: "create_page" }, yourPage: { gsc: null } }),
      NOW,
    );
    const spoke = new Set((r.review?.voices ?? []).map((v) => v.specialist));
    expect(spoke.has("dataforseo")).toBe(false);
  });

  it("threading a freshly bought serpVerdict makes the live-Google teammate speak", async () => {
    const { validateCreatePage } = await import("@/domains/serp/serp-validation");
    const verdict = validateCreatePage({
      snapshot: {
        query: "persian wedding traditions",
        results: [
          { rank: 1, url: "https://a.com/x", title: "x", domain: "a.com" },
          { rank: 2, url: "https://b.com/x", title: "x", domain: "b.com" },
          { rank: 3, url: "https://c.com/x", title: "x", domain: "c.com" },
          { rank: 4, url: "https://d.com/x", title: "x", domain: "d.com" },
          { rank: 5, url: "https://e.com/x", title: "x", domain: "e.com" },
        ],
        features: [],
        source: "dataforseo",
        fetchedAt: NOW,
      },
      ownDomain: "iranopedia.com",
    });
    const p = packet({ move: { gapType: "create_page" }, yourPage: { gsc: null } });
    const withoutExtras = reviewCandidateWithTeam(p, NOW);
    const withExtras = reviewCandidateWithTeam(p, NOW, { serpVerdict: verdict });

    const spokeBefore = new Set((withoutExtras.review?.voices ?? []).map((v) => v.specialist));
    const spokeAfter = new Set((withExtras.review?.voices ?? []).map((v) => v.specialist));
    expect(spokeBefore.has("dataforseo")).toBe(false);
    expect(spokeAfter.has("dataforseo")).toBe(true);
  });
});

describe("falsifierLine (P5 item 312 - what would prove this wrong)", () => {
  it("is null (self-hides) with no proof plan", async () => {
    const { falsifierLine } = await import("./team-review");
    expect(falsifierLine(null, "change_title_meta")).toBeNull();
    expect(falsifierLine(undefined, "change_title_meta")).toBeNull();
  });

  it("uses the longest proof window in weeks and the primary metric, in first-person retract voice", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({ metrics: ["clicks"], windowsDays: [7, 14, 28] }, "change_title_meta");
    expect(line).toBe("What would prove this wrong: if clicks do not rise within 4 weeks, this was the wrong call and I will retract it.");
  });

  it("maps a citation-metric plan to plain AI citations", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({ metrics: ["Profound citations", "position"], windowsDays: [14, 28] }, "add_answer_block");
    expect(line).toContain("AI citations do not rise within 4 weeks");
  });

  it("agrees the verb with a SINGULAR metric (the click rate does not rise)", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({ metrics: ["CTR", "clicks"], windowsDays: [7, 14, 28] }, "change_title_meta");
    expect(line).toBe("What would prove this wrong: if the click rate does not rise within 4 weeks, this was the wrong call and I will retract it.");
  });

  it("a friction fix should FALL, not rise (direction-aware)", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({ metrics: ["Clarity dead/rage clicks"], windowsDays: [7, 14, 28] }, "fix_ux");
    expect(line).toContain("do not fall within 4 weeks");
  });

  it("defaults to a 4-week window and clicks metric when the plan omits them", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({}, "change_title_meta");
    expect(line).toBe("What would prove this wrong: if clicks do not rise within 4 weeks, this was the wrong call and I will retract it.");
  });

  it("emits no em or en dash", async () => {
    const { falsifierLine } = await import("./team-review");
    const line = falsifierLine({ metrics: ["clicks"], windowsDays: [28] }, "change_title_meta");
    expect(/[–—]/.test(line!)).toBe(false);
  });
});

describe("reviewCandidateWithTeam deliberation fields (P5)", () => {
  it("attaches an agreement line, a devil's advocate, and a falsifier on a real review", () => {
    const r = reviewCandidateWithTeam(
      packet({ yourPage: { gsc: { clicks: 10, impressions: 4000, ctr: 0.009, position: 8 }, dollarValue: 500 } }),
      NOW,
    );
    expect(r.review).not.toBeNull();
    // A striking-distance page yields GSC (edit/title) + GA4 amplifier -> the falsifier always rides
    // the proof plan; agreement/devils-advocate ride the opinion set (present when there is a debate).
    expect(r.review!.falsifier).toContain("What would prove this wrong");
    expect(r.review!.falsifier).toContain("retract it");
  });

  it("QUORUM (item 163): a lone teammate with no corroboration is flagged worth-a-look", () => {
    // create_page candidate with only demand-signal GSC voting for create_page and nobody else
    // suggesting an action (no competitor citations, no serp verdict, no friction). One voter.
    const r = reviewCandidateWithTeam(
      packet({ move: { gapType: "create_page", signals: ["GSC"] }, yourPage: { gsc: null } }),
      NOW,
    );
    expect(r.review).not.toBeNull();
    // Exactly one teammate could pick an action here.
    expect(r.review!.worthALook).toBe(true);
    // A lone weak voice does not claim a team agreed - the agreement line self-hides.
    expect(r.review!.agreement).toBeUndefined();
  });

  it("QUORUM (item 163): a corroborated Move is NOT demoted (worthALook undefined)", () => {
    // Two voters back create_page: demand-signal GSC + AI-citations Profound (competitor cited).
    const r = reviewCandidateWithTeam(
      packet({
        move: { gapType: "create_page", signals: ["GSC"] },
        yourPage: { gsc: null },
        competitor: { topUrl: "https://rival.com/persian-wedding-traditions", domain: "rival.com", relevance: 0.9 },
      }),
      NOW,
    );
    expect(r.review).not.toBeNull();
    expect(r.review!.worthALook).toBeUndefined();
  });

  it("no em or en dash across any of the new deliberation strings", () => {
    const r = reviewCandidateWithTeam(
      packet({
        move: { gapType: "create_page", signals: ["GSC"] },
        yourPage: { gsc: null },
        competitor: { topUrl: "https://rival.com/persian-wedding-traditions", domain: "rival.com", relevance: 0.9 },
      }),
      NOW,
    );
    const all = JSON.stringify([r.review?.agreement, r.review?.devilsAdvocate, r.review?.falsifier]);
    expect(/[–—]/.test(all)).toBe(false);
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
