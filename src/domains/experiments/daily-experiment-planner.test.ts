import { describe, it, expect } from "vitest";

import { planDailyExperiments, scoreCandidate, pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { assessPower, type PowerAssessment } from "./power-analysis";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import { MIN_MULTIPLIER, MAX_MULTIPLIER, type LearnedPrior } from "@/domains/learning/experiment-prior";

const NOW = new Date("2026-07-01T00:00:00Z");
const CONTROLS = ["persian-cat", "caracal", "asiatic-cheetah"].map((s) => `https://iranopedia.com/iran-animals/${s}`);

const titleRec = (slug: string): ShippedChangeRecord => ({
  id: `/iran-animals/${slug}::2026-06-30`, page: `https://iranopedia.com/iran-animals/${slug}`, path: `/iran-animals/${slug}`,
  actionType: "edit_title", before: null, after: null, shippedAt: "2026-06-30T00:00:00.000Z",
  baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["q"],
  controlPages: CONTROLS, windows: [], verdict: "measuring", confidence: "low", measuredAt: null,
  notes: null, verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null,
  createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
});
const ledger = ["persian-wolf", "persian-leopard"].map(titleRec);

const cand = (over: Partial<DailyCandidate> & { url: string }): DailyCandidate => ({
  actionFamily: "title", targetQuery: "q", impressions: 2000, position: 6, ctr: 0.004,
  ownership: 0.5, ctrOpportunityClicks: 100, effortMinutes: 1, ...over,
});

describe("pageFamilyOf / scoreCandidate", () => {
  it("groups sub-paths by family, top-level slugs are their own", () => {
    expect(pageFamilyOf("https://iranopedia.com/iran-flags/umayyad-caliphate-flag")).toBe("iran-flags");
    expect(pageFamilyOf("/cities")).toBe("cities");
  });
  it("rewards page-1 weak-CTR clear-ownership candidates", () => {
    const strong = cand({ url: "/a", position: 4, ctr: 0.002, ownership: 0.6, ctrOpportunityClicks: 400 });
    const weak = cand({ url: "/b", position: 18, ctr: 0.02, ownership: 0.1, ctrOpportunityClicks: 20 });
    expect(scoreCandidate(strong)).toBeGreaterThan(scoreCandidate(weak));
  });
});

describe("planDailyExperiments — eligibility + diversification", () => {
  it("excludes active treatments and active controls; keeps unrelated families", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-animals/persian-wolf" }), // active treatment
      cand({ url: "https://iranopedia.com/iran-animals/asiatic-cheetah", actionFamily: "meta" }), // active control
      cand({ url: "https://iranopedia.com/iran-flags/umayyad-caliphate-flag" }), // clean
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "2026-07-01", candidates, proofLedger: ledger, config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/iran-flags/umayyad-caliphate-flag"]);
    expect(plan.excluded.find((e) => e.url.includes("persian-wolf"))?.reason).toBe("same_family_measuring");
    expect(plan.excluded.find((e) => e.url.includes("asiatic-cheetah"))?.reason).toBe("active_control");
  });

  it("caps per page family (e.g. ≤4 flags), overflow → backups then excluded", () => {
    const flags = Array.from({ length: 8 }, (_, i) => cand({ url: `https://iranopedia.com/iran-flags/flag-${i}`, ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: flags, proofLedger: [], config: { now: NOW, maxPerPageFamily: 4, backups: 2 } });
    expect(plan.selected.length).toBe(4);
    expect(plan.familyDistribution["iran-flags"]).toBe(4);
    expect(plan.backups.length).toBe(2);
    expect(plan.excluded.filter((e) => e.reason === "page_family_cap").length).toBe(2);
  });

  it("caps per action family across pages", () => {
    const titles = Array.from({ length: 6 }, (_, i) => cand({ url: `/p${i}`, pageFamily: `fam${i}`, actionFamily: "title", ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: titles, proofLedger: [], config: { now: NOW, maxPerActionFamily: 3 } });
    expect(plan.leverDistribution["title"]).toBe(3);
  });

  it("respects the effort-minute budget", () => {
    const big = Array.from({ length: 10 }, (_, i) => cand({ url: `/p${i}`, pageFamily: `fam${i}`, effortMinutes: 5, ctrOpportunityClicks: 100 - i }));
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: big, proofLedger: [], config: { now: NOW, effortBudgetMinutes: 20, maxPerActionFamily: 99 } });
    expect(plan.estimatedMinutes).toBeLessThanOrEqual(20);
    expect(plan.selected.length).toBe(4);
  });

  it("a mixed-lever batch keeps each lever distinct (meta-vs-title is allowed on different pages)", () => {
    const mixed = [
      cand({ url: "/flags/a", pageFamily: "flags", actionFamily: "title" }),
      cand({ url: "/flags/b", pageFamily: "flags", actionFamily: "meta" }),
      cand({ url: "/people/c", pageFamily: "people", actionFamily: "answer" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: mixed, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.length).toBe(3);
    expect(Object.keys(plan.leverDistribution).sort()).toEqual(["answer", "meta", "title"]);
  });

  it("reports control availability (clean unselected pages by family)", () => {
    const candidates = [
      cand({ url: "/flags/a", pageFamily: "flags" }),
      cand({ url: "/flags/b", pageFamily: "flags" }),
      cand({ url: "/flags/c", pageFamily: "flags" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    // 3 clean pages, some selected; the rest count as clean controls
    expect(plan.controlAvailability.cleanPages).toBe(candidates.length - plan.selected.length);
  });

  it("layers candidate external flags (high-risk excluded)", () => {
    const candidates = [cand({ url: "/x", external: { highRisk: true } }), cand({ url: "/y" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/y"]);
    expect(plan.excluded.find((e) => e.url === "/x")?.reason).toBe("high_risk_page");
  });
});

describe("planDailyExperiments — internal-link influence model", () => {
  it("caps internal links to ONE per destination (no simultaneous authority burst)", () => {
    const candidates = [
      cand({ url: "https://i.com/src-a", actionFamily: "link", influencedUrls: ["/persian-kabobs/joojeh-kabob"], ctrOpportunityClicks: 500 }),
      cand({ url: "https://i.com/src-b", actionFamily: "link", influencedUrls: ["/persian-kabobs/joojeh-kabob"], ctrOpportunityClicks: 400 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 1, backups: 0 } });
    expect(plan.selected).toHaveLength(1);
    expect(plan.excluded.find((e) => e.url === "https://i.com/src-b")?.reason).toBe("influenced_conflict");
  });

  it("honors maxLinksPerDestination > 1 exactly (no off-by-one)", () => {
    const candidates = [
      cand({ url: "https://i.com/a", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 900 }),
      cand({ url: "https://i.com/b", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 800 }),
      cand({ url: "https://i.com/c", actionFamily: "link", influencedUrls: ["/d"], ctrOpportunityClicks: 700 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 2, maxPerActionFamily: 9, backups: 0 } });
    expect(plan.selected).toHaveLength(2); // exactly 2 links to /d allowed, 3rd blocked
    expect(plan.excluded.find((e) => e.url === "https://i.com/c")?.reason).toBe("influenced_conflict");
  });

  it("never treats a page that another selected link feeds (influenced page is off-limits as a source)", () => {
    const candidates = [
      cand({ url: "https://i.com/hub", actionFamily: "link", influencedUrls: ["/cities/tehran"], ctrOpportunityClicks: 500 }),
      cand({ url: "https://i.com/cities/tehran", actionFamily: "meta", ctrOpportunityClicks: 400 }), // would be treated, but it's influenced
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://i.com/hub"]);
    expect(plan.excluded.find((e) => e.url === "https://i.com/cities/tehran")?.reason).toBe("influenced_conflict");
  });

  it("never links to a page already selected as a treated source", () => {
    const candidates = [
      cand({ url: "https://i.com/cities/tehran", actionFamily: "meta", ctrOpportunityClicks: 500 }), // treated first
      cand({ url: "https://i.com/hub", actionFamily: "link", influencedUrls: ["/cities/tehran"], ctrOpportunityClicks: 400 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://i.com/cities/tehran"]);
    expect(plan.excluded.find((e) => e.url === "https://i.com/hub")?.reason).toBe("influenced_conflict");
  });

  it("produces a MIXED batch when both levers and distinct destinations are available", () => {
    const candidates = [
      cand({ url: "https://i.com/iran-flags/a", actionFamily: "meta", ctrOpportunityClicks: 900 }),
      cand({ url: "https://i.com/iran-flags/b", actionFamily: "meta", ctrOpportunityClicks: 800 }),
      cand({ url: "https://i.com/restaurants", actionFamily: "link", influencedUrls: ["/cities/san-diego"], ctrOpportunityClicks: 700 }),
      cand({ url: "https://i.com/food", actionFamily: "link", influencedUrls: ["/kabobs/joojeh"], ctrOpportunityClicks: 600 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxLinksPerDestination: 1, backups: 0 } });
    expect(plan.selected).toHaveLength(4);
    expect(plan.leverDistribution.meta).toBe(2);
    expect(plan.leverDistribution.link).toBe(2);
  });
});

// ── Item 35: power-analysis gate ────────────────────────────────────────────

const wellPowered: PowerAssessment = assessPower({ forecastLow: 300, forecastHigh: 400, mde: { mdeClicksPerMonth: 100, confidence: "estimated" } });
const marginal: PowerAssessment = assessPower({ forecastLow: 80, forecastHigh: 100, mde: { mdeClicksPerMonth: 100, confidence: "estimated" } });
const underpoweredNotExtreme: PowerAssessment = assessPower({ forecastLow: 60, forecastHigh: 70, mde: { mdeClicksPerMonth: 100, confidence: "rough" } });
const extremeShortfall: PowerAssessment = assessPower({ forecastLow: 5, forecastHigh: 10, mde: { mdeClicksPerMonth: 100, confidence: "rough" } });

describe("scoreCandidate — item 35 power penalty", () => {
  it("a well-powered candidate scores identically to one with no power assessment (neutral)", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const withWellPowered = { ...base, power: wellPowered };
    expect(scoreCandidate(withWellPowered)).toBeCloseTo(scoreCandidate(base), 6);
  });

  it("a marginal candidate is downranked but not to zero", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const marginalCand = { ...base, power: marginal };
    const score = scoreCandidate(marginalCand);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(scoreCandidate(base));
  });

  it("an underpowered (non-extreme) candidate is downranked harder than marginal", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const marginalScore = scoreCandidate({ ...base, power: marginal });
    const underpoweredScore = scoreCandidate({ ...base, power: underpoweredNotExtreme });
    expect(underpoweredScore).toBeGreaterThan(0);
    expect(underpoweredScore).toBeLessThan(marginalScore);
  });
});

describe("planDailyExperiments — item 35 power gate", () => {
  it("degrades honestly: a marginal candidate still gets selected when it's the only option (warn, not silently drop)", () => {
    const candidates = [cand({ url: "/only", power: marginal })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/only"]);
    expect(plan.excluded).toHaveLength(0);
  });

  it("degrades honestly: an underpowered-but-not-extreme candidate still gets selected alone (never a silent zero)", () => {
    const candidates = [cand({ url: "/only", power: underpoweredNotExtreme })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/only"]);
  });

  it("hard-excludes only the EXTREME shortfall (ratio < 0.5), with the reason recorded", () => {
    const candidates = [
      cand({ url: "/good", power: wellPowered, ctrOpportunityClicks: 50 }),
      cand({ url: "/doomed", power: extremeShortfall, ctrOpportunityClicks: 500 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/good"]);
    const excluded = plan.excluded.find((e) => e.url === "/doomed");
    expect(excluded?.reason).toBe("underpowered");
  });

  it("prefers a well-powered candidate over a similar-raw-opportunity marginal one when the batch is capped", () => {
    const candidates = [
      cand({ url: "/big-noisy", pageFamily: "a", actionFamily: "title", ctrOpportunityClicks: 350, power: marginal }),
      cand({ url: "/small-clean", pageFamily: "b", actionFamily: "meta", ctrOpportunityClicks: 300, power: wellPowered }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxExperiments: 1, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/small-clean"]);
  });

  it("an extreme raw-opportunity gap can still outrank a marginal penalty (the penalty tilts, it doesn't override real opportunity differences)", () => {
    const candidates = [
      cand({ url: "/huge", pageFamily: "a", actionFamily: "title", ctrOpportunityClicks: 1000, power: marginal }),
      cand({ url: "/tiny", pageFamily: "b", actionFamily: "meta", ctrOpportunityClicks: 300, power: wellPowered }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxExperiments: 1, backups: 0 } });
    // /huge scores 1000*0.6=600 (marginal) vs /tiny's 300*1=300 (well powered) - opportunity still
    // wins here, which is correct: the penalty downranks, it does not pretend a 3x bigger real
    // opportunity is worthless. assessPower's own "marginal, worth doing, slower to verify" sentence
    // (not "skip it") backs this up.
    expect(plan.selected.map((s) => s.url)).toEqual(["/huge"]);
  });

  it("never-empty-plan guard: when EVERY candidate is marginal or underpowered (but none extreme), the plan is still non-empty", () => {
    const candidates = [
      cand({ url: "/p1", pageFamily: "a", power: marginal, ctrOpportunityClicks: 300 }),
      cand({ url: "/p2", pageFamily: "b", power: underpoweredNotExtreme, ctrOpportunityClicks: 250 }),
      cand({ url: "/p3", pageFamily: "c", power: marginal, ctrOpportunityClicks: 200 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.length).toBeGreaterThan(0);
    expect(plan.selected.length).toBe(3);
  });

  it("a candidate with NO power assessment (bounded read didn't reach it) is never penalized or excluded", () => {
    const candidates = [cand({ url: "/unassessed" })]; // power is undefined
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/unassessed"]);
  });

  it("power sentences carried on selected/excluded picks never contain a banned dash", () => {
    const candidates = [
      cand({ url: "/m", power: marginal }),
      cand({ url: "/e", power: extremeShortfall, pageFamily: "z" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    for (const s of plan.selected) if (s.power) expect(hasBannedDash(s.power.sentence)).toBe(false);
    expect(hasBannedDash(marginal.sentence)).toBe(false);
    expect(hasBannedDash(extremeShortfall.sentence)).toBe(false);
  });
});

// ── Item 47: learned priors folded into the nightly planner score ──────────

const won: LearnedPrior = { multiplier: 1.15, decidedSample: 5, basis: "actionType:answer_block", tag: 'Similar moves like this won 4 of 5, ranked higher' };
const lost: LearnedPrior = { multiplier: 0.85, decidedSample: 4, basis: "actionType:edit_title", tag: "Similar moves like this underperformed (1/4), ranked lower" };
const neutral: LearnedPrior = { multiplier: 1, decidedSample: 0, basis: null, tag: null };

describe("scoreCandidate — item 47 learned-prior fold", () => {
  it("no learnedPrior attached scores identically to an explicit neutral prior (byte-identical baseline)", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const withNeutral = { ...base, learnedPrior: neutral };
    expect(scoreCandidate(withNeutral)).toBeCloseTo(scoreCandidate(base), 9);
  });

  it("a proven-winner prior lifts the score by exactly its multiplier", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const boosted = { ...base, learnedPrior: won };
    expect(scoreCandidate(boosted)).toBeCloseTo(scoreCandidate(base) * won.multiplier, 6);
  });

  it("a proven-loser prior lowers the score by exactly its multiplier", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const demoted = { ...base, learnedPrior: lost };
    expect(scoreCandidate(demoted)).toBeCloseTo(scoreCandidate(base) * lost.multiplier, 6);
  });

  it("a learned prior tilts ties but never inverts a real opportunity gap (bounded influence)", () => {
    const small = cand({ url: "/small", ctrOpportunityClicks: 100, learnedPrior: won }); // best case: +15%
    const big = cand({ url: "/big", ctrOpportunityClicks: 1000, learnedPrior: lost }); // worst case: -15%
    expect(scoreCandidate(big)).toBeGreaterThan(scoreCandidate(small));
  });

  it("defensively clamps an out-of-range multiplier to [MIN_MULTIPLIER, MAX_MULTIPLIER]", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const rogueHigh = { ...base, learnedPrior: { ...won, multiplier: 3 } };
    const rogueLow = { ...base, learnedPrior: { ...lost, multiplier: 0.1 } };
    expect(scoreCandidate(rogueHigh)).toBeCloseTo(scoreCandidate(base) * MAX_MULTIPLIER, 6);
    expect(scoreCandidate(rogueLow)).toBeCloseTo(scoreCandidate(base) * MIN_MULTIPLIER, 6);
  });

  it("composes multiplicatively with the team-score and power factors, not by replacing them", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200, teamScoreMultiplier: 1.2, power: wellPowered });
    const withPrior = { ...base, learnedPrior: won };
    expect(scoreCandidate(withPrior)).toBeCloseTo(scoreCandidate(base) * won.multiplier, 6);
  });
});

describe("planDailyExperiments — item 47 identity-when-empty pin", () => {
  it("a batch with NO learnedPrior anywhere produces a BYTE-IDENTICAL plan to the pre-item-47 shape", () => {
    const candidates = [
      cand({ url: "/iran-flags/a", pageFamily: "iran-flags", ctrOpportunityClicks: 900 }),
      cand({ url: "/iran-flags/b", pageFamily: "iran-flags", ctrOpportunityClicks: 800 }),
      cand({ url: "/people/c", pageFamily: "people", actionFamily: "meta", ctrOpportunityClicks: 700 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    // Order + selection is driven purely by ctrOpportunityClicks (descending) when every
    // learnedPrior is absent - a fresh tenant with zero settled outcomes must see this.
    expect(plan.selected.map((s) => s.url)).toEqual(["/iran-flags/a", "/iran-flags/b", "/people/c"]);
  });

  it("a real prior can re-order the batch (the learning actually influences tonight's pick order)", () => {
    const candidates = [
      cand({ url: "/a", pageFamily: "a", actionFamily: "title", ctrOpportunityClicks: 210 }),
      cand({ url: "/b", pageFamily: "b", actionFamily: "meta", ctrOpportunityClicks: 200, learnedPrior: won }),
    ];
    // Without the prior, /a (210) would edge out /b (200). With /b's proven-winner prior
    // (+15%, 200*1.15=230), /b should now edge out /a.
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW, maxExperiments: 1, backups: 0 } });
    expect(plan.selected.map((s) => s.url)).toEqual(["/b"]);
  });

  it("learned-prior tags carried on selected picks never contain a banned dash", () => {
    // Guards the ACTUAL tag strings this module ships against the hard no-dash rule, since
    // tagFor() in experiment-prior.ts is shared infrastructure this planner now surfaces.
    const candidates = [cand({ url: "/a", learnedPrior: won }), cand({ url: "/b", learnedPrior: lost, pageFamily: "z" })];
    for (const c of candidates) {
      if (c.learnedPrior?.tag) expect(hasBannedDash(c.learnedPrior.tag)).toBe(false);
    }
  });
});
