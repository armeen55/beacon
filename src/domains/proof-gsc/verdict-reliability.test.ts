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
    expect(r.sentence).toMatch(/final call still waits for the full window/);
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
