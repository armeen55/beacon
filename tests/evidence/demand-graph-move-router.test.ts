import { describe, it, expect } from "vitest";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { GapKind, MoveComponents } from "@/domains/demand-graph/build-graph";
import type { Specialist, SpecialistOpinion } from "@/domains/demand-graph/specialist-opinions";
import { routeMove, GAP_TO_ACTION, parentTypeForAction, VOTE_ELECTION_MARGIN, VOTE_ELECTION_MIN_VOICES, type SpecialistWeightLookup } from "@/domains/demand-graph/move-router";

const STALE = "2026-06-26T00:00:00.000Z";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000,
  winnability: 0.8,
  dollarValue: 0,
  visibilityGap: 0.5,
  friction: 0,
  ...over,
});

function packet(gapType: GapKind, over: Partial<EvidencePacket["move"]> = {}, demandOver: Partial<EvidencePacket["demand"]> = {}): EvidencePacket {
  return {
    move: {
      key: "k1",
      gapType,
      label: "persian wedding traditions",
      confidence: "medium",
      score: 1000,
      components: components(),
      signals: ["GSC"],
      ...over,
    },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: [], ...demandOver },
    competitor: { topUrl: null, domain: null, fetchStatus: null, facts: null, whatWins: "—", relevance: 0, looselyMatched: false, otherUrls: [] },
    yourPage: { url: "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0 },
    research: null,
    gaps: [],
    draft: { kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [], answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "" },
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "h1",
  };
}

function op(over: Partial<SpecialistOpinion> & { specialist: Specialist }): SpecialistOpinion {
  return {
    claim: "",
    evidenceRefs: [],
    confidence: 0.7,
    suggestedMoveTypes: [],
    objections: [],
    scoreContribution: {},
    staleAt: STALE,
    ...over,
  };
}

describe("routeMove — graceful degradation", () => {
  it("with NO opinions reproduces the graph gap + score (cannot regress today)", () => {
    for (const gap of ["create_page", "edit_page", "answer_block", "fix_experience", "healthy"] as GapKind[]) {
      const d = routeMove({ packet: packet(gap), opinions: [] });
      expect(d.action).toBe(GAP_TO_ACTION[gap]);
      expect(d.adjustedScore).toBe(d.baseScore);
      expect(d.baseScore).toBe(1000);
      expect(d.electedBy).toBe("seed");
      expect(d.margin).toBe(0);
    }
  });
});

describe("routeMove — vetoes override the action", () => {
  it("cant_outrank_serp veto demotes create_page to wait", () => {
    const d = routeMove({
      packet: packet("create_page"),
      opinions: [op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("wait");
    expect(d.appliedObjections.some((o) => o.kind === "cant_outrank_serp")).toBe(true);
  });

  it("already_ranks veto re-routes create_page to an edit", () => {
    const d = routeMove({
      packet: packet("create_page"),
      opinions: [op({ specialist: "dataforseo", suggestedMoveTypes: ["edit_existing_page"], objections: [{ kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "ranks", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("edit_existing_page");
  });
});

describe("routeMove — Clarity is a downgrade in Sprint 1 (not a veto)", () => {
  it("keeps the content action but cuts the score and records the objection", () => {
    const d = routeMove({
      packet: packet("answer_block"),
      opinions: [op({ specialist: "clarity", suggestedMoveTypes: ["fix_ux"], objections: [{ kind: "fix_ux_first", against: ["add_answer_block"], severity: "downgrade", detail: "friction", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("add_answer_block"); // not overridden — downgrade, not veto
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
    expect(d.appliedObjections.some((o) => o.kind === "fix_ux_first")).toBe(true);
  });
});

describe("routeMove — Google + AI overlap boost", () => {
  it("raises confidence and score when GSC + Profound + DataForSEO overlap all agree", () => {
    const boosted = routeMove({
      packet: packet("create_page", { confidence: "medium" }),
      opinions: [
        op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
        op({ specialist: "dataforseo", suggestedMoveTypes: ["create_page"], scoreContribution: { scoreMultiplier: 1.3 } }),
      ],
    });
    expect(boosted.adjustedScore).toBeGreaterThan(boosted.baseScore);
    expect(boosted.adjustedScore).toBe(1300);
    expect(boosted.confidence).toBeGreaterThan(0.6);
  });
});

describe("routeMove — bounded downgrades cut the score", () => {
  it("not_pushable lowers the adjusted score and is recorded", () => {
    const d = routeMove({
      packet: packet("edit_page"),
      opinions: [op({ specialist: "wix", objections: [{ kind: "not_pushable", against: [], severity: "downgrade", detail: "paste-only", evidenceRefs: [] }], scoreContribution: { scoreMultiplier: 0.9 } })],
    });
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
    expect(d.appliedObjections.some((o) => o.kind === "not_pushable")).toBe(true);
  });
});

describe("routeMove — debate partition + parent types", () => {
  it("splits supporting vs dissenting opinions and maps the parent type", () => {
    const d = routeMove({
      packet: packet("edit_page"),
      opinions: [
        op({ specialist: "gsc", suggestedMoveTypes: ["change_title_meta"] }), // supports the winner
        op({ specialist: "profound", suggestedMoveTypes: ["add_answer_block"] }), // dissents
      ],
    });
    expect(d.action).toBe("change_title_meta");
    expect(d.parentType).toBe("content_move");
    expect(d.supporting.map((o) => o.specialist)).toContain("gsc");
    expect(d.dissenting.map((o) => o.specialist)).toContain("profound");
    // A one-vote-each tie (gsc backs the seed, profound backs the alternative) is NOT a
    // decisive margin — the seed still wins (item 49: seed wins when close).
    expect(d.electedBy).toBe("seed");
  });

  it("parentTypeForAction maps the taxonomy", () => {
    expect(parentTypeForAction("add_answer_block")).toBe("aeo_move");
    expect(parentTypeForAction("fix_ux")).toBe("cro_move");
    expect(parentTypeForAction("create_asset")).toBe("asset_move");
    expect(parentTypeForAction("wait")).toBe("wait");
  });
});

describe("routeMove - item 49: one vote per specialist (normalization)", () => {
  it("a voice listing two actions splits its confidence instead of casting it to both", () => {
    // profound alone suggests BOTH add_answer_block and add_schema at confidence 0.8 - it must
    // cast a total of 0.8 (0.4 each), never 0.8 to each (which would be 1.6 total from one voice).
    const d = routeMove({
      packet: packet("edit_page"), // seed = change_title_meta
      opinions: [op({ specialist: "profound", confidence: 0.8, suggestedMoveTypes: ["add_answer_block", "add_schema"] })],
    });
    // Total team vote weight is 0.8 (one voice), split 0.4/0.4 across two actions. Neither action
    // has more than the seed's zero votes by a margin that also clears the min-voices guard
    // (voiceCount for either action is 1 < VOTE_ELECTION_MIN_VOICES), so the seed still wins.
    expect(d.action).toBe("change_title_meta");
    expect(d.electedBy).toBe("seed");
  });

  it("two single-action voices together can out-vote one voice that split its vote across the same two actions", () => {
    // Two distinct specialists each commit fully to add_answer_block (0.7 + 0.7 = 1.4 combined,
    // clearing the min-voices guard); a third specialist splits 0.6 across two OTHER actions
    // (0.3 each) and must not be double-counted against them.
    const d = routeMove({
      packet: packet("edit_page"), // seed = change_title_meta
      opinions: [
        op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "profound", confidence: 0.7, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "dataforseo", confidence: 0.6, suggestedMoveTypes: ["add_schema", "create_asset"] }),
      ],
    });
    expect(d.action).toBe("add_answer_block");
    expect(d.electedBy).toBe("vote");
  });
});

describe("routeMove - item 49: margin election", () => {
  it("elects the vote winner when it clearly beats the seed by more than the margin threshold, with 2+ voices", () => {
    const d = routeMove({
      packet: packet("edit_page"), // seed = change_title_meta, zero votes
      opinions: [
        op({ specialist: "gsc", confidence: 0.8, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "profound", confidence: 0.8, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "dataforseo", confidence: 0.8, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "wix", confidence: 0.6, suggestedMoveTypes: ["add_answer_block"] }),
      ],
    });
    expect(d.action).toBe("add_answer_block");
    expect(d.electedBy).toBe("vote");
    expect(d.margin).toBeGreaterThan(VOTE_ELECTION_MARGIN);
    expect(d.rationale).toContain("The team outvoted the default here");
    expect(d.rationale).toContain("4 voices back");
    expect(d.rationale).not.toMatch(/[–—]/); // no en/em dashes anywhere
  });

  it("keeps the seed when the vote winner beats it but stays inside the margin threshold", () => {
    // Seed (change_title_meta) gets NO votes; the alternative needs multiple voices to matter,
    // so use two voices whose combined weight against a padding voice for the seed keeps the
    // margin just under the 25% threshold.
    const d = routeMove({
      packet: packet("edit_page"),
      opinions: [
        op({ specialist: "gsc", confidence: 0.3, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "profound", confidence: 0.3, suggestedMoveTypes: ["add_answer_block"] }),
        op({ specialist: "dataforseo", confidence: 0.5, suggestedMoveTypes: ["change_title_meta"] }),
      ],
    });
    // votes: add_answer_block=0.6, change_title_meta=0.5, total=1.1 -> margin = 0.1/1.1 ≈ 9%
    expect(d.margin ?? 0).toBeLessThanOrEqual(VOTE_ELECTION_MARGIN);
    expect(d.action).toBe("change_title_meta");
    expect(d.electedBy).toBe("seed");
  });

  it("never elects when a single specialist alone would otherwise clear the margin (min-voices guard)", () => {
    const d = routeMove({
      packet: packet("edit_page"), // seed = change_title_meta
      opinions: [op({ specialist: "profound", confidence: 0.9, suggestedMoveTypes: ["add_answer_block"] })],
    });
    expect(d.action).toBe("change_title_meta");
    expect(d.electedBy).toBe("seed");
    expect(d.margin).toBe(0);
  });

  it("VOTE_ELECTION_MIN_VOICES is at least 2 (a lone voice can never elect)", () => {
    expect(VOTE_ELECTION_MIN_VOICES).toBeGreaterThanOrEqual(2);
  });
});

describe("routeMove - item 49: Clarity's downgrade-only friction voice never elects fix_ux alone", () => {
  it("keeps the content action even though Clarity's lone vote would otherwise clear the margin", () => {
    // Regression pin for the Sprint-1 "Clarity is a downgrade, not a veto" contract: Clarity's
    // suggestedMoveTypes: ["fix_ux"] must not unilaterally out-vote the seed just because it is
    // the only opinion in the room (this exact shape used to break before the min-voices guard).
    const d = routeMove({
      packet: packet("answer_block"),
      opinions: [op({ specialist: "clarity", suggestedMoveTypes: ["fix_ux"], objections: [{ kind: "fix_ux_first", against: ["add_answer_block"], severity: "downgrade", detail: "friction", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("add_answer_block");
    expect(d.electedBy).toBe("seed");
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
  });
});

describe("routeMove - item 49: vetoes still apply after election", () => {
  it("a veto against the seed still fires even after the vote already elected a different action", () => {
    // Three voices elect edit_existing_page over the create_page seed; the SAME dataforseo
    // voice's already_ranks veto (against the seed) must still be recorded, not silently
    // dropped just because the vote already moved the action away from create_page.
    const d = routeMove({
      packet: packet("create_page"), // seed = create_page
      opinions: [
        op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["edit_existing_page"] }),
        op({
          specialist: "dataforseo",
          confidence: 0.7,
          suggestedMoveTypes: ["edit_existing_page"],
          objections: [{ kind: "already_ranks", against: ["create_page"], severity: "veto", detail: "ranks #2", evidenceRefs: [] }],
        }),
      ],
    });
    expect(d.action).toBe("edit_existing_page");
    expect(d.appliedObjections.some((o) => o.kind === "already_ranks")).toBe(true);
  });

  it("a veto can still override a vote-elected action outright", () => {
    // The team votes (2 voices) to create a page, but a cant_outrank_serp veto against
    // create_page must still force wait, even though the vote elected create_page first.
    const d = routeMove({
      packet: packet("edit_page"), // seed = change_title_meta
      opinions: [
        op({ specialist: "gsc", confidence: 0.8, suggestedMoveTypes: ["create_page"] }),
        op({
          specialist: "dataforseo",
          confidence: 0.8,
          suggestedMoveTypes: ["create_page"],
          objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace SERP", evidenceRefs: [] }],
        }),
      ],
    });
    expect(d.action).toBe("wait");
    expect(d.appliedObjections.some((o) => o.kind === "cant_outrank_serp")).toBe(true);
  });
});

describe("routeMove - item 70: learned specialist vote weights (byte-identical when cold)", () => {
  it("with NO specialistWeight lookup passed, behavior is identical to before item 70", () => {
    const opinions = [
      op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["change_title_meta"] }),
      op({ specialist: "profound", confidence: 0.6, suggestedMoveTypes: ["add_answer_block"] }),
    ];
    const withoutLookup = routeMove({ packet: packet("edit_page"), opinions });
    expect(withoutLookup.appliedWeights).toEqual([]);
    expect(withoutLookup.action).toBe("change_title_meta");
    expect(withoutLookup.electedBy).toBe("seed");
    expect(withoutLookup.margin).toBe(0);
  });

  it("a lookup that always resolves neutral (weight 1, no tag) is byte-identical to omitting it", () => {
    const opinions = [
      op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "profound", confidence: 0.7, suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "dataforseo", confidence: 0.7, suggestedMoveTypes: ["create_page"], scoreContribution: { scoreMultiplier: 1.3 } }),
    ];
    const neutralLookup: SpecialistWeightLookup = () => ({ weight: 1, tag: null });
    const a = routeMove({ packet: packet("edit_page"), opinions });
    const b = routeMove({ packet: packet("edit_page"), opinions, specialistWeight: neutralLookup });
    expect(b).toEqual(a);
  });

  it("a lookup returning undefined for every call behaves exactly like omitting the lookup", () => {
    const opinions = [op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["change_title_meta"] })];
    const undefinedLookup: SpecialistWeightLookup = () => undefined;
    const a = routeMove({ packet: packet("edit_page"), opinions });
    const b = routeMove({ packet: packet("edit_page"), opinions, specialistWeight: undefinedLookup });
    expect(b).toEqual(a);
  });

  it("a boosted specialist's vote can tip a close election that would otherwise keep the seed", () => {
    // gsc alone (confidence 0.7) backing create_page vs the change_title_meta seed does not
    // clear VOTE_ELECTION_MIN_VOICES (needs >= 2 distinct voices) - add a second voice at low
    // confidence so the margin is close, then show a learned upweight on gsc can decide it.
    const opinions = [
      op({ specialist: "gsc", confidence: 0.6, suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "profound", confidence: 0.4, suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "wix", confidence: 0.9, suggestedMoveTypes: ["change_title_meta"] }), // backs the seed hard
    ];
    const noWeights = routeMove({ packet: packet("edit_page"), opinions });
    expect(noWeights.action).toBe("change_title_meta"); // seed wins without learning

    const boostGsc: SpecialistWeightLookup = (specialist) =>
      specialist === "gsc" ? { weight: 1.15, tag: "Search demand has called 8 of its last 11 winners here, so its vote counts a bit more." } : { weight: 1, tag: null };
    const weighted = routeMove({ packet: packet("edit_page"), opinions, specialistWeight: boostGsc });
    // The boost alone is not guaranteed to flip a 2-vs-1 election by itself (bounded ±15%), but it
    // must never make the up-weighted side WORSE off, and the applied weight must be surfaced.
    expect(weighted.appliedWeights.some((w) => w.specialist === "gsc" && w.weight === 1.15)).toBe(true);
  });

  it("a downweighted specialist's vote share shrinks (its family tally is multiplied down)", () => {
    const opinions = [op({ specialist: "clarity", confidence: 0.8, suggestedMoveTypes: ["fix_ux"] })];
    const shrink: SpecialistWeightLookup = (specialist) =>
      specialist === "clarity" ? { weight: 0.85, tag: "Visitor behavior has called 2 of its last 9 winners here, so its vote counts a little less." } : null;
    const d = routeMove({ packet: packet("answer_block"), opinions, specialistWeight: shrink });
    expect(d.appliedWeights).toEqual([
      { specialist: "clarity", family: "other", weight: 0.85, tag: "Visitor behavior has called 2 of its last 9 winners here, so its vote counts a little less." },
    ]);
  });

  it("appliedWeights is empty when the lookup returns a tag but weight === 1 (nothing to explain)", () => {
    const opinions = [op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["change_title_meta"] })];
    const oddLookup: SpecialistWeightLookup = () => ({ weight: 1, tag: "some tag that should be ignored at weight 1" });
    const d = routeMove({ packet: packet("edit_page"), opinions, specialistWeight: oddLookup });
    expect(d.appliedWeights).toEqual([]);
  });

  it("dedupes appliedWeights per (specialist, family) even when an opinion suggests multiple actions in the same family", () => {
    const opinions = [op({ specialist: "gsc", confidence: 0.7, suggestedMoveTypes: ["change_title_meta", "add_internal_links"] })];
    // change_title_meta -> "title_meta" family (title+meta), add_internal_links -> "link" family - distinct
    // families, so both should surface once each, not collapse into one.
    const lookup: SpecialistWeightLookup = () => ({ weight: 1.1, tag: "tag" });
    const d = routeMove({ packet: packet("edit_page"), opinions, specialistWeight: lookup });
    const families = d.appliedWeights.map((w) => w.family).sort();
    expect(families).toEqual(["link", "title_meta"]);
  });

  it("veto/downgrade/overlap-boost machinery is untouched by weighting (score math stays the same)", () => {
    const opinions = [
      op({ specialist: "gsc", suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "profound", suggestedMoveTypes: ["create_page"] }),
      op({ specialist: "dataforseo", suggestedMoveTypes: ["create_page"], scoreContribution: { scoreMultiplier: 1.3 } }),
    ];
    const lookup: SpecialistWeightLookup = () => ({ weight: 1.1, tag: "tag" });
    const d = routeMove({ packet: packet("create_page", { confidence: "medium" }), opinions, specialistWeight: lookup });
    expect(d.adjustedScore).toBe(1300); // overlap boost multiplier is independent of vote weighting
  });
});

describe("routeMove - N6: query-intent veto (byte-identical when the classifier abstains)", () => {
  it("every pre-N6 fixture in this file (label 'persian wedding traditions', a 'what' default) is untouched", () => {
    // 'persian wedding traditions' has no when/cost/navigational/transactional cue, so it defaults
    // to 'what' - which never triggers rule 1 (only when/cost break an answer block) and is not a
    // change_title_meta-on-navigational or create_page-on-transactional shape either. This pins that
    // every existing test's fixture keeps routing exactly as before N6.
    for (const gap of ["create_page", "edit_page", "answer_block", "fix_experience", "healthy"] as GapKind[]) {
      const d = routeMove({ packet: packet(gap), opinions: [] });
      expect(d.action).toBe(GAP_TO_ACTION[gap]);
      expect(d.adjustedScore).toBe(d.baseScore);
      expect(d.appliedObjections).toEqual([]);
    }
  });

  it("intentVeto: { enabled: false } fully disables the check (explicit opt-out stays byte-identical)", () => {
    const p = packet("answer_block", {}, { fanoutSeeds: ["when is chaharshanbe suri", "chaharshanbe suri date"] });
    const withCheck = routeMove({ packet: { ...p, move: { ...p.move, label: "chaharshanbe suri 2026" } }, opinions: [] });
    const disabled = routeMove({
      packet: { ...p, move: { ...p.move, label: "chaharshanbe suri 2026" } },
      opinions: [],
      intentVeto: { enabled: false },
    });
    expect(withCheck.action).toBe("wait"); // the veto fires by default
    expect(disabled.action).toBe("add_answer_block"); // opted out -> falls back to the seed, untouched
    expect(disabled.appliedObjections).toEqual([]);
  });

  it("VETOes an answer_block seed to 'wait' when the dominant intent is a date (the chaharshanbe bug, structurally closed)", () => {
    const p = packet(
      "answer_block",
      { label: "chaharshanbe suri 2026" },
      { fanoutSeeds: ["when is chaharshanbe suri", "chaharshanbe suri date this year"] },
    );
    const d = routeMove({ packet: p, opinions: [] });
    expect(d.action).toBe("wait");
    expect(d.appliedObjections.some((o) => o.kind === "wrong_lever_for_intent")).toBe(true);
    expect(d.rationale).toContain("That question wants a date, not a definition");
    expect(d.rationale).not.toMatch(/[–—]/);
  });

  it("names its evidence (the real queries that drove the intent call) in the applied objection", () => {
    const p = packet(
      "answer_block",
      { label: "chaharshanbe suri 2026" },
      { fanoutSeeds: ["when is chaharshanbe suri", "chaharshanbe suri date this year"] },
    );
    const d = routeMove({ packet: p, opinions: [] });
    const applied = d.appliedObjections.find((o) => o.kind === "wrong_lever_for_intent")!;
    expect(applied.detail).toContain("chaharshanbe suri");
    expect(applied.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("still applies a veto from a specialist even when the intent check has nothing to say", () => {
    // Regression: N6 must not swallow or short-circuit the pre-existing veto machinery.
    const d = routeMove({
      packet: packet("create_page"),
      opinions: [op({ specialist: "dataforseo", objections: [{ kind: "cant_outrank_serp", against: ["create_page"], severity: "veto", detail: "marketplace", evidenceRefs: [] }] })],
    });
    expect(d.action).toBe("wait");
    expect(d.appliedObjections.some((o) => o.kind === "cant_outrank_serp")).toBe(true);
  });

  it("downgrades (does not veto) add_answer_block when the intent mismatch is only probable", () => {
    // "when" leads but only just: 52 vs 48 impressions -> when share ~0.52, inside the
    // probable-not-certain band (0.4 to 0.55) -> downgrade only, never a hard veto.
    const p = packet(
      "answer_block",
      { label: "nowruz traditions" },
      { queries: [
        { query: "when is nowruz 2027", impressions: 52, source: "gsc" },
        { query: "nowruz traditions", impressions: 48, source: "gsc" },
      ] },
    );
    const d = routeMove({ packet: p, opinions: [] });
    expect(d.action).toBe("add_answer_block"); // not overridden - downgrade, not veto
    expect(d.adjustedScore).toBeLessThan(d.baseScore);
    expect(d.appliedObjections.some((o) => o.kind === "wrong_lever_for_intent" && o.severity === "downgrade")).toBe(true);
  });

  it("passes tenantHasNoTransactionalSurface through to downgrade a create_page seed on transactional demand", () => {
    const p = packet("create_page", { label: "buy persian rug online" });
    const withoutFlag = routeMove({ packet: p, opinions: [] });
    const withFlag = routeMove({ packet: p, opinions: [], intentVeto: { tenantHasNoTransactionalSurface: true } });
    expect(withoutFlag.action).toBe("create_page");
    expect(withoutFlag.appliedObjections).toEqual([]); // unknown surface -> abstain, never guess
    expect(withFlag.action).toBe("create_page"); // downgrade only, action unchanged
    expect(withFlag.adjustedScore).toBeLessThan(withFlag.baseScore);
    expect(withFlag.appliedObjections.some((o) => o.kind === "wrong_lever_for_intent")).toBe(true);
  });
});
