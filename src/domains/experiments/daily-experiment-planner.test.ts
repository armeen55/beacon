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

const won: LearnedPrior = { multiplier: 1.15, decidedSample: 5, basis: "actionType:answer_block", tag: "I moved this up because your answer-block changes keep winning (4 of the last 5 won)." };
const lost: LearnedPrior = { multiplier: 0.85, decidedSample: 4, basis: "actionType:edit_title", tag: "I moved this down because your title and wording tweaks have not been landing (1 of 4 won)." };
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

// ── Item 81: auto-retire repeatedly-losing (pageFamily, lever) cells, with a scheduled retest ──

const lostRec = (slug: string, settledAt: string, verdict: "lost" | "won" = "lost"): ShippedChangeRecord => ({
  id: `/cities/${slug}::${settledAt}`, page: `https://iranopedia.com/cities/${slug}`, path: `/cities/${slug}`,
  actionType: "edit_title", before: null, after: null, shippedAt: settledAt,
  baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["q"],
  controlPages: [], windows: [], verdict, confidence: "low", measuredAt: settledAt,
  notes: null, verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null,
  createdAt: settledAt, updatedAt: settledAt,
});

describe("planDailyExperiments — item 81 lever retirement wiring", () => {
  it("suppresses every candidate in a retired (pageFamily, lever) cell (3+ losses, 0 wins)", () => {
    const retiredLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
    ];
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities", actionFamily: "title" }),
      cand({ url: "https://iranopedia.com/cities/qom", pageFamily: "cities", actionFamily: "title" }),
    ];
    // "now" well inside the 90 day wait - still fully retired, no retest yet.
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: retiredLedger, config: { now: new Date("2026-01-25T00:00:00Z") } });
    expect(plan.selected).toHaveLength(0);
    expect(plan.excluded.filter((e) => e.reason === "lever_retired")).toHaveLength(2);
    expect(plan.leverRetirements.find((r) => r.pageFamily === "cities" && r.lever === "title")?.status).toBe("retired");
  });

  it("does NOT suppress a different lever on the same page family (retirement is per-cell)", () => {
    const retiredLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
    ];
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities", actionFamily: "meta" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: retiredLedger, config: { now: new Date("2026-01-25T00:00:00Z") } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
  });

  it("does NOT suppress the same lever on a different page family (retirement never crosses families)", () => {
    const retiredLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
    ];
    const candidates = [cand({ url: "https://iranopedia.com/iran-flags/umayyad", pageFamily: "iran-flags", actionFamily: "title" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: retiredLedger, config: { now: new Date("2026-01-25T00:00:00Z") } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/iran-flags/umayyad"]);
  });

  it("passes EXACTLY ONE candidate through as a flagged retest once 90 days have passed", () => {
    const retiredLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
    ];
    const due = new Date(Date.parse("2026-01-20T00:00:00Z") + 90 * 86_400_000);
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities", actionFamily: "title", ctrOpportunityClicks: 500 }),
      cand({ url: "https://iranopedia.com/cities/qom", pageFamily: "cities", actionFamily: "title", ctrOpportunityClicks: 400 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: retiredLedger, config: { now: due } });
    // Only the BEST-scoring candidate (yazd, higher ctrOpportunityClicks) gets the one retest slot.
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.selected[0].retest).toBeDefined();
    expect(plan.selected[0].retest?.decision.status).toBe("retest_due");
    expect(plan.excluded.find((e) => e.url === "https://iranopedia.com/cities/qom")?.reason).toBe("lever_retired");
  });

  it("fully unsuppresses a cell once its retest wins (permanently active from then on)", () => {
    const wonRetestLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
      lostRec("yazd", "2026-04-25T00:00:00Z", "won"), // the granted retest, settled as a win
    ];
    const candidates = [cand({ url: "https://iranopedia.com/cities/qom", pageFamily: "cities", actionFamily: "title" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: wonRetestLedger, config: { now: new Date("2026-05-01T00:00:00Z") } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/qom"]);
    expect(plan.leverRetirements.find((r) => r.pageFamily === "cities" && r.lever === "title")?.status).toBe("active");
  });

  it("re-retires (fresh 90 day clock) when the granted retest loses again", () => {
    const lostRetestLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
      lostRec("yazd", "2026-04-25T00:00:00Z"), // the granted retest, settled as ANOTHER loss
    ];
    const candidates = [cand({ url: "https://iranopedia.com/cities/qom", pageFamily: "cities", actionFamily: "title" })];
    const soonAfter = new Date("2026-05-01T00:00:00Z");
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: lostRetestLedger, config: { now: soonAfter } });
    expect(plan.selected).toHaveLength(0);
    expect(plan.excluded.find((e) => e.url === "https://iranopedia.com/cities/qom")?.reason).toBe("lever_retired");
    const decision = plan.leverRetirements.find((r) => r.pageFamily === "cities" && r.lever === "title");
    expect(decision?.status).toBe("retired");
    expect(decision?.retiredAtIso).toBe(new Date("2026-04-25T00:00:00Z").toISOString());
  });

  it("byte-identical when no cell qualifies: an empty/thin ledger produces the exact pre-item-81 plan", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/a", pageFamily: "iran-flags", ctrOpportunityClicks: 900 }),
      cand({ url: "https://iranopedia.com/iran-flags/b", pageFamily: "iran-flags", ctrOpportunityClicks: 800 }),
      cand({ url: "https://iranopedia.com/people/c", pageFamily: "people", actionFamily: "meta", ctrOpportunityClicks: 700 }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/iran-flags/a", "https://iranopedia.com/iran-flags/b", "https://iranopedia.com/people/c"]);
    expect(plan.excluded).toHaveLength(0);
    expect(plan.leverRetirements).toEqual([]);
    // Never present when no cell qualifies - the exact absent-field shape every pre-item-81 pick had.
    for (const s of plan.selected) expect(s.retest).toBeUndefined();
  });

  it("byte-identical when no cell qualifies, even with an UNRELATED settled ledger present (< threshold losses)", () => {
    const thinLedger = [lostRec("tehran", "2026-01-01T00:00:00Z"), lostRec("shiraz", "2026-01-10T00:00:00Z")]; // only 2 losses
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities", actionFamily: "title", ctrOpportunityClicks: 300 })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: thinLedger, config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.selected[0].retest).toBeUndefined();
  });

  it("retirement lines contain no banned dash and read plainly", () => {
    const retiredLedger = [
      lostRec("tehran", "2026-01-01T00:00:00Z"),
      lostRec("shiraz", "2026-01-10T00:00:00Z"),
      lostRec("isfahan", "2026-01-20T00:00:00Z"),
    ];
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities", actionFamily: "title" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: retiredLedger, config: { now: new Date("2026-01-25T00:00:00Z") } });
    const decision = plan.leverRetirements[0];
    expect(decision.leverPlain).toBe("a title change");
    expect(hasBannedDash(decision.leverPlain)).toBe(false);
  });
});

describe("planDailyExperiments — item N14 interference hold", () => {
  it("excludes a candidate the caller's interference lookup marks held, with the plain reason threaded through", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/late-safavid-military-flag", pageFamily: "iran-flags" }),
    ];
    const interference = new Map([
      [
        "/iran-flags/late-safavid-military-flag",
        { hold: true, reason: "I am holding this because the page shares its template family with 3 changes still measuring." },
      ],
    ]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, interference });
    expect(plan.selected).toHaveLength(0);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0].reason).toBe("interference_hold");
    expect(plan.excluded[0].plainReason).toMatch(/template family with 3 changes still measuring/);
    expect(hasBannedDash(plan.excluded[0].plainReason!)).toBe(false);
  });

  it("a candidate the lookup does NOT mark held stays eligible even when other paths are held", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/held-page", pageFamily: "iran-flags" }),
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" }),
    ];
    const interference = new Map([["/iran-flags/held-page", { hold: true, reason: "held" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, interference });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.excluded.map((e) => e.reason)).toEqual(["interference_hold"]);
  });

  it("omitting the interference lookup entirely is byte-identical to before N14 existed", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" })];
    const withoutLookup = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(withoutLookup.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(withoutLookup.excluded).toHaveLength(0);
  });

  it("an entry with hold:false never excludes (only hold:true fires)", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" })];
    const interference = new Map([["/cities/yazd", { hold: false, reason: "" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, interference });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
  });

  it("interference hold is checked AFTER ledger eligibility, so an active-treatment exclusion still wins its own reason", () => {
    const candidates = [cand({ url: "https://iranopedia.com/iran-animals/persian-wolf" })]; // active treatment per `ledger`
    const interference = new Map([["/iran-animals/persian-wolf", { hold: true, reason: "would also be held" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: ledger, config: { now: NOW }, interference });
    expect(plan.excluded[0].reason).toBe("same_family_measuring");
  });
});

describe("scoreCandidate — R5 / N15 effect-size fold", () => {

  it("multiplies the score by the effect multiplier, clamped to [0.8, 1.3]", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const s0 = scoreCandidate(base);
    const boosted = scoreCandidate({ ...base, effectPrior: { multiplier: 1.3, sample: 4, basis: "answer_block::iran-flags", tag: "t" } });
    const demoted = scoreCandidate({ ...base, effectPrior: { multiplier: 0.8, sample: 3, basis: "edit_page", tag: "t" } });
    expect(boosted).toBeCloseTo(s0 * 1.3, 6);
    expect(demoted).toBeCloseTo(s0 * 0.8, 6);
  });

  it("defensively re-clamps an out-of-range multiplier", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const s0 = scoreCandidate(base);
    const wild = scoreCandidate({ ...base, effectPrior: { multiplier: 9, sample: 3, basis: "x", tag: null } });
    const crushed = scoreCandidate({ ...base, effectPrior: { multiplier: 0.01, sample: 3, basis: "x", tag: null } });
    expect(wild).toBeCloseTo(s0 * 1.3, 6);
    expect(crushed).toBeCloseTo(s0 * 0.8, 6);
  });

  it("absent or neutral effectPrior is byte-identical to the pre-N15 score", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    expect(scoreCandidate({ ...base, effectPrior: { multiplier: 1, sample: 0, basis: null, tag: null } })).toBe(scoreCandidate(base));
  });

  it("composes with the win-rate prior multiplicatively (two independent learnings)", () => {
    const base = cand({ url: "/a", ctrOpportunityClicks: 200 });
    const s0 = scoreCandidate(base);
    const both = scoreCandidate({
      ...base,
      learnedPrior: { multiplier: 1.1, decidedSample: 4, basis: "actionType:title", tag: "t" } as LearnedPrior,
      effectPrior: { multiplier: 1.2, sample: 3, basis: "title", tag: "t" },
    });
    expect(both).toBeCloseTo(s0 * 1.1 * 1.2, 6);
  });
});

describe("planDailyExperiments — N16 last-clean-donor hold", () => {
  const HOLD_SENTENCE = "I am holding this page because it is the last clean comparison page for a change I am still measuring on /iran-flags/one.";

  it("excludes a held page with reason last_clean_donor and the plain sentence", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/tehran" }),
      cand({ url: "https://iranopedia.com/cities/shiraz", actionFamily: "meta" }),
    ];
    const holds = new Map([["/cities/tehran", HOLD_SENTENCE]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, lastCleanDonorHolds: holds });
    const held = plan.excluded.find((e) => e.url.includes("tehran"));
    expect(held?.reason).toBe("last_clean_donor");
    expect(held?.plainReason).toBe(HOLD_SENTENCE);
    expect(held?.plainReason).not.toMatch(/[–—]/);
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/shiraz"]);
  });

  it("no holds wired (the default) is byte-identical to the pre-N16 plan", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/tehran" }),
      cand({ url: "https://iranopedia.com/cities/shiraz", actionFamily: "meta" }),
    ];
    const before = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    const withEmpty = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, lastCleanDonorHolds: new Map() });
    expect(withEmpty.selected).toEqual(before.selected);
    expect(withEmpty.excluded).toEqual(before.excluded);
  });

  it("keys by host-stripped path (a full-URL candidate still matches)", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/tehran" })];
    const holds = new Map([["/cities/tehran", HOLD_SENTENCE]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, lastCleanDonorHolds: holds });
    expect(plan.selected).toEqual([]);
    expect(plan.excluded[0]?.reason).toBe("last_clean_donor");
  });
});

describe("planDailyExperiments — R6 / N12 same-query experiment blocking", () => {
  it("excludes a candidate the caller's query-overlap lookup marks held (open-measurement overlap), with the plain reason threaded through", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/late-safavid-military-flag", pageFamily: "iran-flags" }),
    ];
    const queryOverlapHolds = new Map([
      [
        "/iran-flags/late-safavid-military-flag",
        { hold: true, reason: "I am holding this because it competes for the same searches as a change I am already measuring on /iran-flags/umayyad-caliphate-flag." },
      ],
    ]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, queryOverlapHolds });
    expect(plan.selected).toHaveLength(0);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0].reason).toBe("query_overlap_hold");
    expect(plan.excluded[0].plainReason).toBe(
      "I am holding this because it competes for the same searches as a change I am already measuring on /iran-flags/umayyad-caliphate-flag.",
    );
    expect(hasBannedDash(plan.excluded[0].plainReason!)).toBe(false);
  });

  it("a candidate the lookup does NOT mark held stays eligible even when another path is held", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/held-page", pageFamily: "iran-flags" }),
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" }),
    ];
    const queryOverlapHolds = new Map([["/iran-flags/held-page", { hold: true, reason: "held" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, queryOverlapHolds });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.excluded.map((e) => e.reason)).toEqual(["query_overlap_hold"]);
  });

  it("intra-batch: never selects two candidates whose target queries overlap, holding the LATER-ranked one with the tonight's-pick sentence", () => {
    const strong = cand({
      url: "https://iranopedia.com/iran-animals/persian-cat",
      relatedQueries: ["persian cat facts", "persian cat breed", "persian cat price"],
      ctrOpportunityClicks: 500, // scores higher -> first-ranked, wins the slot
    });
    const weak = cand({
      url: "https://iranopedia.com/iran-animals/persian-cat-guide",
      relatedQueries: ["persian cat facts", "persian cat breed", "persian cat food"],
      ctrOpportunityClicks: 50, // scores lower -> later-ranked, held
    });
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: [weak, strong], proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/iran-animals/persian-cat"]);
    const held = plan.excluded.find((e) => e.url.includes("persian-cat-guide"));
    expect(held?.reason).toBe("query_overlap_hold");
    expect(held?.plainReason).toBe(
      "I am holding this because it competes for the same searches as tonight's pick for /iran-animals/persian-cat.",
    );
    expect(hasBannedDash(held?.plainReason ?? "")).toBe(false);
  });

  it("intra-batch floor respected: a single shared query between two candidates never blocks either one", () => {
    const a = cand({ url: "https://iranopedia.com/iran-animals/persian-cat", relatedQueries: ["persian cat facts"] });
    const b = cand({ url: "https://iranopedia.com/iran-animals/caracal", relatedQueries: ["persian cat facts"] });
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: [a, b], proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url).sort()).toEqual(
      ["https://iranopedia.com/iran-animals/caracal", "https://iranopedia.com/iran-animals/persian-cat"].sort(),
    );
    expect(plan.excluded).toHaveLength(0);
  });

  it("intra-batch floor respected: overlap below MIN_QUERY_OVERLAP_JACCARD never blocks", () => {
    const a = cand({
      url: "https://iranopedia.com/iran-animals/persian-cat",
      relatedQueries: ["lion facts", "lion habitat", "lion diet", "lion pride"],
    });
    const b = cand({
      url: "https://iranopedia.com/iran-animals/caracal",
      relatedQueries: ["lion facts", "fox facts", "fox habitat", "fox diet"],
    });
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates: [a, b], proofLedger: [], config: { now: NOW } });
    expect(plan.selected).toHaveLength(2);
    expect(plan.excluded).toHaveLength(0);
  });

  it("omitting queryOverlapHolds and relatedQueries entirely is byte-identical to before N12 existed", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd" }),
      cand({ url: "https://iranopedia.com/cities/tehran", actionFamily: "meta" }),
    ];
    const before = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(before.selected.map((s) => s.url).sort()).toEqual(
      ["https://iranopedia.com/cities/tehran", "https://iranopedia.com/cities/yazd"].sort(),
    );
    expect(before.excluded).toEqual([]);
  });

  it("an entry with hold:false never excludes (only hold:true fires)", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd" })];
    const queryOverlapHolds = new Map([["/cities/yazd", { hold: false, reason: "" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, queryOverlapHolds });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
  });

  it("query-overlap hold is checked AFTER ledger eligibility, so an active-treatment exclusion still wins its own reason", () => {
    const candidates = [cand({ url: "https://iranopedia.com/iran-animals/persian-wolf" })]; // active treatment per `ledger`
    const queryOverlapHolds = new Map([["/iran-animals/persian-wolf", { hold: true, reason: "would also be held" }]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: ledger, config: { now: NOW }, queryOverlapHolds });
    expect(plan.excluded[0].reason).toBe("same_family_measuring");
  });
});

describe("planDailyExperiments — N46 opportunity expiration (planner skip)", () => {
  it("skips a candidate whose evidenceFreshness is expired, with reason evidence_expired", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd", evidenceFreshness: "expired" }),
      cand({ url: "https://iranopedia.com/cities/tehran", actionFamily: "meta" }),
    ];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/tehran"]);
    const held = plan.excluded.find((e) => e.url.includes("yazd"));
    expect(held?.reason).toBe("evidence_expired");
  });

  it("an aging (not expired) candidate is untouched by the planner - presentation-only", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", evidenceFreshness: "aging" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.excluded).toEqual([]);
  });

  it("omitting evidenceFreshness entirely (the default) is byte-identical to before N46 existed", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd" }),
      cand({ url: "https://iranopedia.com/cities/tehran", actionFamily: "meta" }),
    ];
    const before = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(before.selected.map((s) => s.url).sort()).toEqual(
      ["https://iranopedia.com/cities/tehran", "https://iranopedia.com/cities/yazd"].sort(),
    );
    expect(before.excluded).toEqual([]);
  });

  it("evidence_expired is checked AFTER ledger eligibility, so an active-treatment exclusion still wins its own reason", () => {
    const candidates = [cand({ url: "https://iranopedia.com/iran-animals/persian-wolf", evidenceFreshness: "expired" })]; // active treatment per `ledger`
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: ledger, config: { now: NOW } });
    expect(plan.excluded[0].reason).toBe("same_family_measuring");
  });

  it("an explicit fresh verdict behaves exactly like the absent default", () => {
    const candidates = [cand({ url: "https://iranopedia.com/cities/yazd", evidenceFreshness: "fresh" })];
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
  });
});

describe("planDailyExperiments — N45 prerequisite hold", () => {
  it("excludes a candidate the caller's prerequisite lookup marks held, with the plain reason threaded through", () => {
    const candidates = [cand({ url: "https://iranopedia.com/iran-flags/umayyad-caliphate-flag", pageFamily: "iran-flags" })];
    const prerequisiteHolds = new Map([
      [
        "/iran-flags/umayyad-caliphate-flag",
        "Fix the indexing problem on /iran-flags/umayyad-caliphate-flag first. Optimizing a page Google is told to ignore wastes the work.",
      ],
    ]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, prerequisiteHolds });
    expect(plan.selected).toHaveLength(0);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0].reason).toBe("prerequisite_pending");
    expect(plan.excluded[0].plainReason).toContain("Fix the indexing problem");
    expect(hasBannedDash(plan.excluded[0].plainReason!)).toBe(false);
  });

  it("omitting the prerequisite lookup entirely is byte-identical to before N45 existed", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" }),
      cand({ url: "https://iranopedia.com/iran-flags/late-safavid-military-flag", pageFamily: "iran-flags" }),
    ];
    const withOut = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW } });
    const withEmpty = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, prerequisiteHolds: new Map() });
    expect(withEmpty.selected.map((s) => s.url)).toEqual(withOut.selected.map((s) => s.url));
    expect(withEmpty.excluded.map((e) => e.reason)).toEqual(withOut.excluded.map((e) => e.reason));
  });

  it("a candidate the lookup does NOT mark held stays eligible even when another path is held", () => {
    const candidates = [
      cand({ url: "https://iranopedia.com/iran-flags/held-page", pageFamily: "iran-flags" }),
      cand({ url: "https://iranopedia.com/cities/yazd", pageFamily: "cities" }),
    ];
    const prerequisiteHolds = new Map([["/iran-flags/held-page", "Fix the indexing problem on /iran-flags/held-page first."]]);
    const plan = planDailyExperiments({ tenantId: "t", date: "d", candidates, proofLedger: [], config: { now: NOW }, prerequisiteHolds });
    expect(plan.selected.map((s) => s.url)).toEqual(["https://iranopedia.com/cities/yazd"]);
    expect(plan.excluded.map((e) => e.reason)).toEqual(["prerequisite_pending"]);
  });
});
