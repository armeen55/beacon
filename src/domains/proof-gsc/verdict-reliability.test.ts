import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gradeVerdictReliability,
  gradeFromPresentation,
  gradeAllowsLearning,
  type VerdictReliabilityInput,
} from "./verdict-reliability";
import { buildMeasurementPresentation, type MaturityInput } from "./measurement-maturity";

/**
 * verdict-reliability.test.ts (BEACON_500 N10) - pins the grade ladder (too
 * early < shaky < decent < solid), the alignment with learningEligibility,
 * and the dash-clean rule. Every rule boundary gets its own case so a future
 * threshold tweak fails loudly here instead of silently reclassifying rows.
 */

function base(over: Partial<VerdictReliabilityInput> = {}): VerdictReliabilityInput {
  return {
    maturity: "mature_result",
    basisDay: 28,
    recrawlPending: false,
    controlContaminationFlagged: false,
    weakComparisonFlagged: false,
    weatherQuarantined: false,
    seasonalInflectionFlagged: false,
    attributionShared: false,
    controlsUsed: 3,
    baselineImpressions: 3000,
    permutationRead: null,
    interferenceFlagged: false,
    ...over,
  };
}

describe("too early", () => {
  it("not shipped yet", () => {
    const r = gradeVerdictReliability(base({ maturity: "scheduled", basisDay: null }));
    expect(r.grade).toBe("too early");
    expect(r.sentence).toMatch(/not shipped yet/);
  });

  it("recrawl pending outranks everything else, even a closed window", () => {
    const r = gradeVerdictReliability(base({ recrawlPending: true, basisDay: 7, maturity: "collecting" }));
    expect(r.grade).toBe("too early");
    expect(r.sentence).toMatch(/Google has not re-read/);
  });

  it("no checkpoint closed yet (basisDay null, still collecting)", () => {
    const r = gradeVerdictReliability(base({ basisDay: null, maturity: "collecting" }));
    expect(r.grade).toBe("too early");
    expect(r.sentence).toMatch(/no checkpoint has closed/);
  });
});

describe("shaky", () => {
  it("contamination unresolved", () => {
    const r = gradeVerdictReliability(base({ controlContaminationFlagged: true, maturity: "mature_result", basisDay: 28 }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/comparison page changed/);
  });

  it("weak comparison group", () => {
    const r = gradeVerdictReliability(base({ weakComparisonFlagged: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/not moving like this page/);
  });

  it("shock/weather window overlap", () => {
    const r = gradeVerdictReliability(base({ weatherQuarantined: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/Google update or a sitewide shift/);
  });

  it("seasonal inflection overlap", () => {
    const r = gradeVerdictReliability(base({ seasonalInflectionFlagged: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/seasonal demand swing/);
  });

  it("shared attribution (accidental overlap or intentional package)", () => {
    const r = gradeVerdictReliability(base({ attributionShared: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/another change touches this page/);
  });

  it("sample below floor (controls)", () => {
    const r = gradeVerdictReliability(base({ controlsUsed: 1 }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/too thin/);
  });

  it("sample below floor (baseline impressions)", () => {
    const r = gradeVerdictReliability(base({ baselineImpressions: 100 }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/too thin/);
  });

  it("permutation read disagrees (looks like noise)", () => {
    const r = gradeVerdictReliability(base({ permutationRead: { nGreater: 10, nTotal: 60 } }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/normal noise/);
  });

  it("stacks multiple reasons when more than one problem is present", () => {
    const r = gradeVerdictReliability(base({ controlContaminationFlagged: true, weakComparisonFlagged: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.length).toBe(2);
  });

  it("interference guard (N14): a significant interference edge demotes an otherwise-clean mature result", () => {
    const r = gradeVerdictReliability(base({ interferenceFlagged: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/linked or same-family page/);
  });

  it("interference guard stacks with other shaky reasons", () => {
    const r = gradeVerdictReliability(base({ interferenceFlagged: true, controlContaminationFlagged: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.length).toBe(2);
  });

  it("fixed query panel disagreement (P4 R10a, v1 150) demotes an otherwise-clean mature result", () => {
    const r = gradeVerdictReliability(base({ panelDisagrees: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/targeted moved the opposite way from the page total/);
  });

  it("novelty decay (P4 R10a, v1 378) demotes an otherwise-clean mature result", () => {
    const r = gradeVerdictReliability(base({ noveltyDecay: true }));
    expect(r.grade).toBe("shaky");
    expect(r.reasons.join(" ")).toMatch(/novelty, not a lasting win/);
  });

  it("panel disagreement and novelty decay stack with other shaky reasons", () => {
    const r = gradeVerdictReliability(
      base({ panelDisagrees: true, noveltyDecay: true, controlContaminationFlagged: true }),
    );
    expect(r.grade).toBe("shaky");
    expect(r.reasons.length).toBe(3);
  });

  it("earlyDecisive never rescues a shaky read (a disqualifier always wins)", () => {
    const r = gradeVerdictReliability(
      base({ maturity: "early_checkpoint", basisDay: 7, controlContaminationFlagged: true, earlyDecisive: true }),
    );
    expect(r.grade).toBe("shaky");
  });
});

describe("decent", () => {
  it("early checkpoint, otherwise clean", () => {
    const r = gradeVerdictReliability(base({ maturity: "early_checkpoint", basisDay: 7 }));
    expect(r.grade).toBe("decent");
    expect(r.sentence).toMatch(/7 days in/);
  });

  it("interim checkpoint, otherwise clean", () => {
    const r = gradeVerdictReliability(base({ maturity: "interim_checkpoint", basisDay: 14 }));
    expect(r.grade).toBe("decent");
    expect(r.sentence).toMatch(/14 days in/);
  });

  it("mature but sample is adequate, not deep (thin controls)", () => {
    const r = gradeVerdictReliability(base({ controlsUsed: 2, baselineImpressions: 3000 }));
    expect(r.grade).toBe("decent");
    expect(r.sentence).toMatch(/not deep enough/);
  });

  it("mature but sample is adequate, not deep (thin baseline)", () => {
    const r = gradeVerdictReliability(base({ controlsUsed: 5, baselineImpressions: 500 }));
    expect(r.grade).toBe("decent");
  });

  it("boundary: exactly at the decent floor reads solid, not decent", () => {
    const r = gradeVerdictReliability(base({ controlsUsed: 3, baselineImpressions: 3000 }));
    expect(r.grade).toBe("solid");
  });

  it("boundary: one short of the floor on either axis reads decent", () => {
    expect(gradeVerdictReliability(base({ controlsUsed: 2, baselineImpressions: 3000 })).grade).toBe("decent");
    expect(gradeVerdictReliability(base({ controlsUsed: 3, baselineImpressions: 2999 })).grade).toBe("decent");
  });

  it("earlyDecisive (P4 R10a, v1 288) strengthens the decent sentence at an early checkpoint", () => {
    const r = gradeVerdictReliability(base({ maturity: "early_checkpoint", basisDay: 7, earlyDecisive: true }));
    expect(r.grade).toBe("decent");
    expect(r.sentence).toMatch(/do not need the full 28 days/);
    expect(r.sentence).toMatch(/full 28-day read still waits for the window to close/);
  });

  it("earlyDecisive NEVER upgrades a read past decent before maturity (the clock is inviolable)", () => {
    for (const [maturity, basisDay] of [["early_checkpoint", 7], ["interim_checkpoint", 14]] as const) {
      const r = gradeVerdictReliability(base({ maturity, basisDay, earlyDecisive: true }));
      expect(r.grade).toBe("decent");
      expect(r.grade).not.toBe("solid");
    }
  });

  it("earlyDecisive is ignored at a mature result (the 28-day read speaks for itself)", () => {
    const withFlag = gradeVerdictReliability(base({ earlyDecisive: true }));
    const withoutFlag = gradeVerdictReliability(base());
    expect(withFlag).toEqual(withoutFlag);
    expect(withFlag.grade).toBe("solid");
  });
});

describe("solid", () => {
  it("mature, clean, adequate sample, no permutation read wired", () => {
    const r = gradeVerdictReliability(base());
    expect(r.grade).toBe("solid");
    expect(r.sentence).toBe(
      "I would treat this read as solid: 28 days mature, clean comparisons, enough traffic to mean something.",
    );
  });

  it("mature, clean, adequate sample, permutation read agrees", () => {
    const r = gradeVerdictReliability(base({ permutationRead: { nGreater: 1, nTotal: 60 } }));
    expect(r.grade).toBe("solid");
    expect(r.sentence).toMatch(/pages I did not touch rarely moved this much/);
  });

  it("permutation read at exactly the 5% noise threshold still counts as agreeing", () => {
    const r = gradeVerdictReliability(base({ permutationRead: { nGreater: 3, nTotal: 60 } }));
    expect(r.grade).toBe("solid");
  });
});

describe("gradeAllowsLearning alignment with MeasurementPresentation.learningEligibility", () => {
  const NOW = new Date("2026-07-02T12:00:00Z");

  function maturityInput(over: Partial<MaturityInput>): MaturityInput {
    return {
      shippedAt: "2026-06-01",
      now: NOW,
      latestGscDate: "2026-06-30",
      windows: [
        { day: 7, ran: true },
        { day: 14, ran: true },
        { day: 28, ran: true },
      ],
      verdict: "won",
      controlsUsed: 3,
      baselineImpressions: 3000,
      overlap: null,
      live: true,
      ...over,
    };
  }

  function checkAlignment(over: Partial<MaturityInput>) {
    const pres = buildMeasurementPresentation(maturityInput(over));
    const grade = gradeFromPresentation(
      pres,
      { controlsUsed: over.controlsUsed ?? 3, baselineImpressions: over.baselineImpressions ?? 3000 },
      null,
    );
    // The grade must never be MORE permissive than learningEligibility: whenever
    // learningEligibility is true, the grade must allow learning too. The grade
    // may be stricter (e.g. thin-sample "decent" cases that predate a mature
    // gate check are already excluded by construction), but never looser.
    if (pres.learningEligibility) {
      expect(gradeAllowsLearning(grade.grade)).toBe(true);
    } else {
      // Every disqualifier learningEligibility checks is also a shaky/too-early
      // disqualifier here, so when learningEligibility is false the grade must
      // be shaky or too early, not solid.
      expect(grade.grade).not.toBe("solid");
    }
    return { pres, grade };
  }

  it("clean mature result: both allow learning", () => {
    checkAlignment({});
  });

  it("weak comparison veto: both exclude", () => {
    checkAlignment({ controlMatchWeak: undefined, weakComparison: true } as Partial<MaturityInput>);
  });

  it("recrawl pending: both exclude", () => {
    checkAlignment({ recrawlPending: true });
  });

  it("control contamination: both exclude", () => {
    checkAlignment({ controlContaminated: true });
  });

  it("seasonal inflection: both exclude", () => {
    checkAlignment({ seasonalInflection: true });
  });

  it("accidental overlap (attribution_limited): both exclude", () => {
    checkAlignment({ overlap: { kind: "overlap", otherChangeCount: 1 } });
  });

  it("intentional package (compound attribution): both exclude", () => {
    checkAlignment({ overlap: { kind: "compound", otherChangeCount: 1 } });
  });

  it("early checkpoint (not mature): both exclude, but grade still reads decent not shaky", () => {
    const { pres, grade } = checkAlignment({
      windows: [
        { day: 7, ran: true },
        { day: 14, ran: false },
        { day: 28, ran: false },
      ],
    });
    expect(pres.learningEligibility).toBe(false);
    expect(grade.grade).toBe("decent");
  });

  it("weakComparison directly on the presentation input still aligns", () => {
    checkAlignment({ weakComparison: true });
  });

  it("interference guard (N14): gradeFromPresentation demotes a clean mature result when interferenceFlagged is passed", () => {
    const pres = buildMeasurementPresentation(maturityInput({}));
    expect(pres.learningEligibility).toBe(true); // presentation itself is unaware of N14 - unaffected
    const withoutInterference = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, false);
    const withInterference = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, true);
    expect(withoutInterference.grade).toBe("solid");
    expect(withInterference.grade).toBe("shaky");
    expect(gradeAllowsLearning(withInterference.grade)).toBe(false);
  });

  it("interference guard omitted entirely is byte-identical to before the parameter existed", () => {
    const pres = buildMeasurementPresentation(maturityInput({}));
    const withDefault = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null);
    expect(withDefault.grade).toBe("solid");
  });

  it("P4 R10a extras: panelDisagrees and noveltyDecay demote via gradeFromPresentation; omitting extras is byte-identical", () => {
    const pres = buildMeasurementPresentation(maturityInput({}));
    const clean = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null);
    const withEmptyExtras = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, {});
    expect(clean.grade).toBe("solid");
    expect(withEmptyExtras).toEqual(clean);
    const withPanel = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, { panelDisagrees: true });
    expect(withPanel.grade).toBe("shaky");
    const withDecay = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, { noveltyDecay: true });
    expect(withDecay.grade).toBe("shaky");
    expect(gradeAllowsLearning(withDecay.grade)).toBe(false);
  });

  it("P4 R10a extras: earlyDecisive reaches the decent branch through gradeFromPresentation", () => {
    const pres = buildMeasurementPresentation(
      maturityInput({
        windows: [
          { day: 7, ran: true },
          { day: 14, ran: false },
          { day: 28, ran: false },
        ],
      }),
    );
    const grade = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, { earlyDecisive: true });
    expect(grade.grade).toBe("decent");
    expect(grade.sentence).toMatch(/do not need the full 28 days/);
  });

  it("P4 R10b (v1 289): a proven-neutral 28 day read grades solid THROUGH the inconclusive maturity, the whole point", () => {
    // A proven neutral's stored verdict is not won/lost, so its maturity reads
    // "inconclusive" - without the flag that is a decent directional read;
    // with it the lesson is solid-for-learning, distinct from not knowing.
    const pres = buildMeasurementPresentation(maturityInput({ verdict: "inconclusive" }));
    expect(pres.maturity).toBe("inconclusive");
    const without = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null);
    expect(without.grade).toBe("decent");
    const withProof = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, { provenNeutral: true });
    expect(withProof.grade).toBe("solid");
    expect(withProof.sentence).toMatch(/genuinely did nothing/);
    expect(withProof.sentence).toMatch(/different from not knowing/);
    expect(gradeAllowsLearning(withProof.grade)).toBe(true);
  });

  it("P4 R10b (v1 291): fdrCaution demotes a would-be solid win to decent with the pool count in the sentence", () => {
    const pres = buildMeasurementPresentation(maturityInput({}));
    const clean = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null);
    expect(clean.grade).toBe("solid");
    const cautioned = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null, undefined, { fdrCaution: true, fdrPoolSize: 12 });
    expect(cautioned.grade).toBe("decent");
    expect(cautioned.sentence).toContain("with 12 changes measured at once");
    expect(cautioned.sentence).toContain("holding the champagne");
    expect(gradeAllowsLearning(cautioned.grade)).toBe(true);
  });
});

describe("P4 R10b: provenNeutral (v1 289) and fdrCaution (v1 291) in the grade ladder", () => {
  it("provenNeutral on a clean mature 28 day read grades solid with the honest close", () => {
    const r = gradeVerdictReliability(base({ provenNeutral: true }));
    expect(r.grade).toBe("solid");
    expect(r.sentence).toBe(
      "I would treat this read as solid: this change genuinely did nothing, and I can prove that now; that is different from not knowing. The lesson still counts.",
    );
    expect(r.reasons.join(" ")).toMatch(/reliable even though the change did not win/);
  });

  it("provenNeutral trumps the thin-sample decent path (tight bounds ARE the depth evidence)", () => {
    // controlsUsed 2 / baseline 800: adequate but not deep -> decent without
    // the flag, solid with it.
    const thin = { controlsUsed: 2, baselineImpressions: 800 };
    expect(gradeVerdictReliability(base(thin)).grade).toBe("decent");
    expect(gradeVerdictReliability(base({ ...thin, provenNeutral: true })).grade).toBe("solid");
  });

  it("provenNeutral never rescues a shaky read (contamination, weather, inadequate traffic)", () => {
    expect(gradeVerdictReliability(base({ provenNeutral: true, controlContaminationFlagged: true })).grade).toBe("shaky");
    expect(gradeVerdictReliability(base({ provenNeutral: true, weatherQuarantined: true })).grade).toBe("shaky");
    expect(gradeVerdictReliability(base({ provenNeutral: true, controlsUsed: 1 })).grade).toBe("shaky");
  });

  it("provenNeutral is gated on a closed 28 day window, never an early checkpoint", () => {
    const r = gradeVerdictReliability(
      base({ provenNeutral: true, maturity: "early_checkpoint", basisDay: 7 }),
    );
    expect(r.grade).toBe("decent");
    expect(r.sentence).not.toMatch(/genuinely did nothing/);
  });

  it("fdrCaution demotes solid to decent; without a pool size the sentence stays honest but generic", () => {
    const withPool = gradeVerdictReliability(base({ fdrCaution: true, fdrPoolSize: 9 }));
    expect(withPool.grade).toBe("decent");
    expect(withPool.sentence).toContain("with 9 changes measured at once");
    const withoutPool = gradeVerdictReliability(base({ fdrCaution: true }));
    expect(withoutPool.grade).toBe("decent");
    expect(withoutPool.sentence).toContain("with several changes measured at once");
    expect(withoutPool.sentence).toContain("holding the champagne");
  });

  it("fdrCaution never upgrades or rescues anything: shaky stays shaky, thin-sample decent stays decent", () => {
    expect(gradeVerdictReliability(base({ fdrCaution: true, weatherQuarantined: true })).grade).toBe("shaky");
    const thinDecent = gradeVerdictReliability(base({ fdrCaution: true, controlsUsed: 2, baselineImpressions: 800 }));
    expect(thinDecent.grade).toBe("decent");
    // The thin-sample reason wins the sentence (it fired first in the ladder).
    expect(thinDecent.sentence).toMatch(/not deep enough/);
  });

  it("omitting both flags is byte-identical to the pre-R10b grade", () => {
    const before = gradeVerdictReliability(base());
    const after = gradeVerdictReliability(base({ provenNeutral: false, fdrCaution: false }));
    expect(after).toEqual(before);
  });
});

describe("N4 behavior corroboration - demotes wins, never upgrades anything", () => {
  it("demotes a would-be solid win to decent with the behavior reason named", () => {
    const clean = gradeVerdictReliability(base());
    expect(clean.grade).toBe("solid");
    const r = gradeVerdictReliability(base({ behaviorContradictsWin: true }));
    expect(r.grade).toBe("decent");
    expect(r.reasons.join(" ")).toMatch(/visitors behaved worse on the page after the change/);
    expect(r.sentence).toMatch(/look like a win over 28 days/);
    expect(r.sentence).toMatch(/holding it at decent until behavior agrees/);
  });

  it("also demotes a permutation-confirmed would-be solid win", () => {
    const r = gradeVerdictReliability(
      base({ behaviorContradictsWin: true, permutationRead: { nGreater: 1, nTotal: 60 } }),
    );
    expect(r.grade).toBe("decent");
  });

  it("never rescues or worsens a shaky read (the disqualifiers already returned)", () => {
    const withoutBehavior = gradeVerdictReliability(base({ controlContaminationFlagged: true }));
    const withBehavior = gradeVerdictReliability(
      base({ controlContaminationFlagged: true, behaviorContradictsWin: true }),
    );
    expect(withBehavior.grade).toBe("shaky");
    expect(withBehavior).toEqual(withoutBehavior);
  });

  it("never upgrades: there is no behavior-better input, and false/omitted is byte-identical", () => {
    const before = gradeVerdictReliability(base());
    const after = gradeVerdictReliability(base({ behaviorContradictsWin: false }));
    expect(after).toEqual(before);
    // An immature decent read stays decent regardless of the flag - behavior
    // can never push a read past the 28-day clock.
    const early = gradeVerdictReliability(
      base({ maturity: "early_checkpoint", basisDay: 7, behaviorContradictsWin: false }),
    );
    expect(early.grade).toBe("decent");
  });

  it("does not touch the thin-sample decent path (already decent, thin reason wins the sentence)", () => {
    const r = gradeVerdictReliability(
      base({ controlsUsed: 2, baselineImpressions: 800, behaviorContradictsWin: true }),
    );
    expect(r.grade).toBe("decent");
    expect(r.sentence).toMatch(/not deep enough/);
  });

  it("does not touch the proven-neutral solid (a proven did-nothing is not a win)", () => {
    const r = gradeVerdictReliability(base({ provenNeutral: true, behaviorContradictsWin: false }));
    expect(r.grade).toBe("solid");
    expect(r.sentence).toMatch(/genuinely did nothing/);
  });

  it("a behavior-demoted win still allows learning (decent trains priors)", () => {
    const r = gradeVerdictReliability(base({ behaviorContradictsWin: true }));
    expect(gradeAllowsLearning(r.grade)).toBe(true);
  });

  it("gradeFromPresentation passes the extra through; omitting it is byte-identical", () => {
    const pres = buildMeasurementPresentation({
      shippedAt: "2026-06-01",
      now: new Date("2026-07-02T12:00:00Z"),
      latestGscDate: "2026-06-30",
      windows: [
        { day: 7, ran: true },
        { day: 14, ran: true },
        { day: 28, ran: true },
      ],
      verdict: "won",
      controlsUsed: 3,
      baselineImpressions: 3000,
      overlap: null,
      live: true,
    });
    const clean = gradeFromPresentation(pres, { controlsUsed: 3, baselineImpressions: 3000 }, null);
    expect(clean.grade).toBe("solid");
    const withEmptyExtras = gradeFromPresentation(
      pres,
      { controlsUsed: 3, baselineImpressions: 3000 },
      null,
      undefined,
      {},
    );
    expect(withEmptyExtras).toEqual(clean);
    const demoted = gradeFromPresentation(
      pres,
      { controlsUsed: 3, baselineImpressions: 3000 },
      null,
      undefined,
      { behaviorContradictsWin: true },
    );
    expect(demoted.grade).toBe("decent");
    expect(demoted.sentence).toMatch(/visitors behaved worse/);
  });

  it("the behavior demotion sentence is dash-clean", () => {
    const r = gradeVerdictReliability(base({ behaviorContradictsWin: true }));
    expect(r.sentence).not.toMatch(/[–—]/);
    for (const reason of r.reasons) expect(reason).not.toMatch(/[–—]/);
  });
});

describe("copy guard - dash-clean, no em or en dashes in source", () => {
  it("verdict-reliability.ts contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "verdict-reliability.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("every generated sentence across the grade matrix is dash-clean", () => {
    const cases: VerdictReliabilityInput[] = [
      base({ maturity: "scheduled", basisDay: null }),
      base({ recrawlPending: true }),
      base({ basisDay: null, maturity: "collecting" }),
      base({ controlContaminationFlagged: true }),
      base({ weakComparisonFlagged: true }),
      base({ weatherQuarantined: true }),
      base({ seasonalInflectionFlagged: true }),
      base({ attributionShared: true }),
      base({ interferenceFlagged: true }),
      base({ controlsUsed: 1 }),
      base({ permutationRead: { nGreater: 10, nTotal: 60 } }),
      base({ maturity: "early_checkpoint", basisDay: 7 }),
      base({ maturity: "interim_checkpoint", basisDay: 14 }),
      base({ controlsUsed: 2, baselineImpressions: 3000 }),
      base(),
      base({ permutationRead: { nGreater: 1, nTotal: 60 } }),
      base({ panelDisagrees: true }),
      base({ noveltyDecay: true }),
      base({ maturity: "early_checkpoint", basisDay: 7, earlyDecisive: true }),
      base({ provenNeutral: true }),
      base({ fdrCaution: true, fdrPoolSize: 9 }),
      base({ fdrCaution: true }),
    ];
    for (const c of cases) {
      const r = gradeVerdictReliability(c);
      expect(r.sentence).not.toMatch(/[–—]/);
      for (const reason of r.reasons) {
        expect(reason).not.toMatch(/[–—]/);
      }
    }
  });
});
