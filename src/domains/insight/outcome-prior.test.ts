import { describe, it, expect } from "vitest";

import {
  buildOutcomePriors,
  priorFromPattern,
  outcomePriorFor,
  MIN_DECIDED_SAMPLE,
  PRIOR_MULTIPLIER_MIN,
  PRIOR_MULTIPLIER_MAX,
} from "./outcome-prior";
import type { UrlChangePattern } from "@/domains/learning/change-patterns";
import type { EditToken } from "@/domains/changelog/dedupe";
import type { AssetType } from "@/lib/constants";

function pattern(over: Partial<UrlChangePattern> = {}): UrlChangePattern {
  const helping = over.helping_count ?? 0;
  const hurting = over.hurting_count ?? 0;
  const nothing = over.nothing_yet_count ?? 0;
  const sample = helping + hurting + nothing;
  const token = (over.edit_type_token ?? "title_change") as EditToken;
  const asset = (over.asset_type ?? "city_page") as AssetType;
  return {
    id: `${token}::${asset}`,
    edit_type_token: token,
    asset_type: asset,
    sample_count: sample,
    helping_count: helping,
    hurting_count: hurting,
    nothing_yet_count: nothing,
    success_rate: sample > 0 ? helping / sample : 0,
    regress_rate: sample > 0 ? hurting / sample : 0,
    median_landing_day: over.median_landing_day ?? null,
    median_landing_z: over.median_landing_z ?? null,
    median_delta_pct: over.median_delta_pct ?? null,
    median_baseline_days: over.median_baseline_days ?? null,
    confidence_tier: sample >= 5 ? "high" : sample >= 3 ? "medium" : "low",
    computed_at: "2026-06-21T00:00:00Z",
    ...over,
  };
}

describe("priorFromPattern — neutral until proven", () => {
  it("unproven (decided < MIN) stays at neutral 1.0, even all-helping", () => {
    const p = priorFromPattern(pattern({ helping_count: 2, hurting_count: 0 }));
    expect(p.decidedSample).toBe(2);
    expect(p.proven).toBe(false);
    expect(p.multiplier).toBe(1.0);
    expect(p.tag).toBe(""); // no claim when not proven
  });

  it("NEVER penalizes the unproven: thin all-hurting sample is still 1.0", () => {
    const p = priorFromPattern(pattern({ helping_count: 0, hurting_count: 2 }));
    expect(p.proven).toBe(false);
    expect(p.multiplier).toBe(1.0);
  });

  it("nothing_yet (unlanded) is excluded from decided — cannot inflate or prove", () => {
    // 1 helping + 10 not-yet-landed: decided = 1 < MIN, so still neutral.
    const p = priorFromPattern(
      pattern({ helping_count: 1, hurting_count: 0, nothing_yet_count: 10 }),
    );
    expect(p.decidedSample).toBe(1);
    expect(p.proven).toBe(false);
    expect(p.multiplier).toBe(1.0);
  });
});

describe("priorFromPattern — proven levers move, bounded", () => {
  it("strong winners (all helping, decided>=MIN) hit the cap 1.3", () => {
    const p = priorFromPattern(pattern({ helping_count: 6, hurting_count: 0 }));
    expect(p.proven).toBe(true);
    expect(p.successRate).toBe(1);
    expect(p.multiplier).toBe(PRIOR_MULTIPLIER_MAX);
    expect(p.tag).toContain("all 6");
  });

  it("strong losers (all hurting, decided>=MIN) hit the floor 0.8", () => {
    const p = priorFromPattern(pattern({ helping_count: 0, hurting_count: 4 }));
    expect(p.proven).toBe(true);
    expect(p.successRate).toBe(0);
    expect(p.multiplier).toBe(PRIOR_MULTIPLIER_MIN);
  });

  it("a 50/50 decided record is neutral (1.0)", () => {
    const p = priorFromPattern(pattern({ helping_count: 3, hurting_count: 3 }));
    expect(p.proven).toBe(true);
    expect(p.multiplier).toBe(1.0);
  });

  it("mostly-winning (5 of 6) lands above neutral, below cap", () => {
    const p = priorFromPattern(pattern({ helping_count: 5, hurting_count: 1 }));
    expect(p.successRate).toBeCloseTo(0.83, 2);
    expect(p.multiplier).toBeGreaterThan(1.0);
    expect(p.multiplier).toBeLessThan(PRIOR_MULTIPLIER_MAX);
    expect(p.tag).toContain("5 of 6");
  });

  it("mostly-losing (1 of 5) lands below neutral, above floor", () => {
    const p = priorFromPattern(pattern({ helping_count: 1, hurting_count: 4 }));
    expect(p.successRate).toBeCloseTo(0.2, 2);
    expect(p.multiplier).toBeLessThan(1.0);
    expect(p.multiplier).toBeGreaterThan(PRIOR_MULTIPLIER_MIN);
  });

  it("every multiplier stays within [0.8, 1.3] across a full sweep", () => {
    for (let helping = 0; helping <= 10; helping++) {
      for (let hurting = 0; hurting <= 10; hurting++) {
        const m = priorFromPattern(
          pattern({ helping_count: helping, hurting_count: hurting }),
        ).multiplier;
        expect(m).toBeGreaterThanOrEqual(PRIOR_MULTIPLIER_MIN);
        expect(m).toBeLessThanOrEqual(PRIOR_MULTIPLIER_MAX);
      }
    }
  });

  it("tag includes the landing-day timing when present, plain English", () => {
    const p = priorFromPattern(
      pattern({ helping_count: 4, hurting_count: 0, median_landing_day: 9 }),
    );
    expect(p.tag).toContain("title fixes");
    expect(p.tag).toContain("~9 days");
    // plain-English, no em/en dashes leaking into operator copy.
    expect(p.tag).not.toMatch(/[‒–—―]/);
  });

  it("tag discloses in-flight pages: 'settled' wording + '(N still measuring)'", () => {
    const p = priorFromPattern(
      pattern({ helping_count: 6, hurting_count: 0, nothing_yet_count: 2 }),
    );
    expect(p.tag).toContain("all 6 settled"); // not a bare "all 6" over a partial set
    expect(p.tag).toContain("2 still measuring");
  });

  it("confidence rises with decided sample (medium at MIN, high at >=5)", () => {
    expect(priorFromPattern(pattern({ helping_count: 3 })).confidence).toBe("medium");
    expect(priorFromPattern(pattern({ helping_count: 5 })).confidence).toBe("high");
    expect(priorFromPattern(pattern({ helping_count: 1 })).confidence).toBe("low");
  });
});

describe("buildOutcomePriors", () => {
  it("empty input -> empty map", () => {
    expect(buildOutcomePriors([]).size).toBe(0);
  });

  it("keys by pattern id and keeps one prior per pattern", () => {
    const priors = buildOutcomePriors([
      pattern({ edit_type_token: "title_change", helping_count: 6 }),
      pattern({ edit_type_token: "meta_description", asset_type: "homepage", helping_count: 0, hurting_count: 4 }),
    ]);
    expect(priors.size).toBe(2);
    expect(priors.get("title_change::city_page")!.multiplier).toBe(1.3);
    expect(priors.get("meta_description::homepage")!.multiplier).toBe(0.8);
  });
});

describe("outcomePriorFor — lookup the ranking consumers use", () => {
  const patterns = [
    pattern({ edit_type_token: "title_change", asset_type: "city_page", helping_count: 6 }),
    pattern({ edit_type_token: "schema_added", asset_type: "city_page", helping_count: 1, hurting_count: 0, nothing_yet_count: 5 }),
  ];

  it("no tokens -> null", () => {
    expect(outcomePriorFor([], "city_page", patterns)).toBeNull();
  });

  it("no matching bucket -> null", () => {
    expect(outcomePriorFor(["h1_change"], "city_page", patterns)).toBeNull();
    expect(outcomePriorFor(["title_change"], "homepage", patterns)).toBeNull();
  });

  it("returns the matching prior for the lever+asset", () => {
    const p = outcomePriorFor(["title_change"], "city_page", patterns);
    expect(p?.leverKey).toBe("title_change::city_page");
    expect(p?.multiplier).toBe(1.3);
  });

  it("when multiple tokens match, prefers the bucket with the most DECIDED evidence", () => {
    // title_change has 6 decided (proven, 1.3); schema_added has 1 decided (unproven, 1.0).
    const p = outcomePriorFor(["schema_added", "title_change"], "city_page", patterns);
    expect(p?.token).toBe("title_change");
    expect(p?.multiplier).toBe(1.3);
  });

  it("a strongly-PROVEN lower-volume bucket beats a neutral (50/50) higher-volume one", () => {
    // title: 2 helping + 2 hurting = decided 4, 50/50 -> proven but NEUTRAL 1.0.
    // schema: 3 helping = decided 3, all-helping -> proven, strong 1.3.
    // Decided-first sort would wrongly pick the neutral title (4 > 3); the fixed
    // comparator prefers the stronger directional tilt among proven buckets.
    const ps = [
      pattern({ edit_type_token: "title_change", asset_type: "city_page", helping_count: 2, hurting_count: 2 }),
      pattern({ edit_type_token: "schema_added", asset_type: "city_page", helping_count: 3, hurting_count: 0 }),
    ];
    const p = outcomePriorFor(["title_change", "schema_added"], "city_page", ps);
    expect(p?.token).toBe("schema_added");
    expect(p?.multiplier).toBe(1.3);
  });
});
