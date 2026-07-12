/**
 * gold-library (BEACON_500 N36, 2026-07-03, R22b) - the gold-standard library:
 * a small, curated, FROZEN set of decision cases Beacon must get right, so every
 * other eval piece (the benchmark N33, the ablation N34, the replay N35) has one
 * honest substrate to test against.
 *
 * This is intentionally a REGRESSION library, never a blind holdout: both its
 * inputs and expert answers are visible in source and may influence implementation.
 * Each GoldCase is a self-contained, TENANT-AGNOSTIC synthetic fixture: the raw
 * demand / competitor / GSC signals for ONE page, plus the CORRECT decision an
 * expert would make about it -
 *   - the action (which gap type the scorer should classify it as),
 *   - ship-or-hold (should abstention hold it, or is it ready to recommend?),
 *   - a rough rank band (where in the ranked list this move should land), and
 *   - whether the dependency planner should hold it behind a prerequisite.
 *
 * WHY synthetic, not real customer data. A gold library that leaked one tenant's
 * pages would (a) rot the moment that tenant's data changed and (b) cross a data
 * boundary a regression suite must never cross. These fixtures are hand-built to
 * exercise each decision bucket cleanly - a create-page land-grab, a cited-by-
 * competitors answer-block gap, a weak-rank title edit, a high-friction page, a
 * healthy page to leave alone, a below-floor page, and an evidence-thin hunch the
 * abstention gate must hold. Together they are the "known-good cases" Beacon
 * checks itself against.
 *
 * PURE data + one pure builder. No I/O, no clock, no randomness. The signals feed
 * the REAL pure modules (buildDemandGraph, assessAbstention, planDependencies) so
 * the library tracks the actual decision logic, never a re-implementation of it.
 *
 * Pinned by benchmark.test.ts (via runBenchmark) and used by ablation.ts.
 */

import type {
  DemandInput,
  OwnedPageInput,
  CompetitorCitationInput,
  GapKind,
} from "@/domains/demand-graph/build-graph";
import type { AbstentionEvidence, AbstentionState } from "@/domains/recommendations/abstention";
import type { DependencyCandidate } from "@/domains/experiments/dependency-planner";

/** The synthetic input signals for one page - exactly what buildDemandGraph
 *  consumes, so a gold case IS a runnable scorer input, never a mock of one. */
export type GoldSignals = {
  demand: DemandInput;
  ownedPages: OwnedPageInput[];
  competitorCitations: CompetitorCitationInput[];
};

/** The expected correct decision for a gold case - what an expert says Beacon
 *  should do. The benchmark scores agreement against this. */
export type GoldExpectation = {
  /** The gap type the pure scorer should classify the top move as. */
  action: GapKind;
  /** Should this move be READY to recommend, or HELD (watching / monitor)?
   *  "hold" covers both the abstention watching state AND the healthy/low-demand
   *  buckets that are correct to sit on rather than push. */
  disposition: "ship" | "hold";
  /** The abstention evidence an honest caller would read for this case - the
   *  three real-signal booleans law 2 recognizes. Drives assessAbstention. */
  evidence: AbstentionEvidence;
  /** Roughly-right rank band among the gold moves, sorted by score desc:
   *  "top" = should be one of the strongest moves, "mid" = middle of the pack,
   *  "bottom" = correctly deprioritized (healthy / below-floor). Deliberately
   *  coarse - the benchmark checks the BAND, not an exact index, so a healthy
   *  tweak to the scoring math does not read as a regression. */
  rankBand: "top" | "mid" | "bottom";
  /** When set, the dependency planner should HOLD this case behind a
   *  prerequisite (e.g. a technical block must be fixed first). */
  dependencyHeld?: boolean;
};

export type GoldCase = {
  id: string;
  /** One plain sentence: what this case is and why it is in the library. */
  what: string;
  signals: GoldSignals;
  expected: GoldExpectation;
  /** Optional dependency-planner shape for this case (when the case exercises
   *  the prerequisite ordering). Omitted cases use a derived default. */
  dependency?: DependencyCandidate;
};

// ---------------------------------------------------------------------------
// The frozen cases. Every threshold referenced here mirrors build-graph DEFAULTS
// (minDemand 50, weakPositionMax 5, weakCtrRatio 0.5, notCitedAtOrBelow 0) so the
// expected bucket is the one the real scorer lands on, not a guess.
// ---------------------------------------------------------------------------

const CASES: GoldCase[] = [
  // 1. CREATE PAGE - competitors own the demand, you have no page. A land-grab.
  {
    id: "create-page-land-grab",
    what: "Real AI-cited demand with competitors ranking and no owned page - Beacon should say create the page and be ready to recommend it.",
    signals: {
      demand: {
        key: "best-persian-restaurants-la",
        label: "best persian restaurants los angeles",
        queries: ["best persian restaurants los angeles"],
        searchVolume: 2400,
        aiExecutions: 180,
      },
      ownedPages: [],
      competitorCitations: [
        { url: "https://competitor-a.example/persian-la", demandKey: "best-persian-restaurants-la", weight: 40 },
        { url: "https://competitor-b.example/la-persian", demandKey: "best-persian-restaurants-la", weight: 25 },
      ],
    },
    expected: {
      action: "create_page",
      disposition: "ship",
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: true, hasBehaviorOrGscSignal: false },
      rankBand: "top",
    },
  },

  // 2. ANSWER BLOCK - you rank well but AI cites competitors, not you.
  {
    id: "answer-block-uncited",
    what: "You rank on page one but AI cites competitors and never you - Beacon should say add an extractable answer block.",
    signals: {
      demand: {
        key: "how-to-cook-tahdig",
        label: "how to cook tahdig",
        queries: ["how to cook tahdig"],
        gscImpressions: 3200,
        aiExecutions: 90,
      },
      ownedPages: [
        {
          url: "https://you.example/tahdig",
          servesDemandKeys: ["how-to-cook-tahdig"],
          gscImpressions: 3200,
          gscClicks: 400, // strong CTR (~12.5% at pos 3), so NOT a weak-rank edit
          gscPosition: 3,
          aiCitationCount: 0, // not cited (notCitedAtOrBelow 0) while competitors are
        },
      ],
      competitorCitations: [
        { url: "https://competitor-a.example/tahdig-guide", demandKey: "how-to-cook-tahdig", weight: 30 },
      ],
    },
    expected: {
      action: "answer_block",
      disposition: "ship",
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: true, hasBehaviorOrGscSignal: true },
      rankBand: "top",
    },
  },

  // 3. EDIT PAGE - you rank weakly (position past the weak cutoff), no competitor
  //    citation evidence, so it is a pure CTR/title edit, not an answer block.
  {
    id: "edit-page-weak-rank",
    what: "You rank but under the fold with weak CTR and no competitor is cited - Beacon should say tighten the title and meta.",
    signals: {
      demand: {
        key: "persian-new-year-date",
        label: "when is persian new year",
        queries: ["when is persian new year"],
        gscImpressions: 5000,
      },
      ownedPages: [
        {
          url: "https://you.example/nowruz-date",
          servesDemandKeys: ["persian-new-year-date"],
          gscImpressions: 5000,
          gscClicks: 90, // ~1.8% CTR at position 8 = weak (below weakCtrRatio of expected)
          gscPosition: 8, // > weakPositionMax (5) => weak
          aiCitationCount: 5, // cited, and no competitor citations => not an answer-block gap
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "edit_page",
      disposition: "ship",
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: true },
      rankBand: "top",
    },
  },

  // 4. FIX EXPERIENCE - you rank AND are cited, no competitor gap, but the page
  //    has high Clarity friction. Friction IS the move here.
  {
    id: "fix-experience-friction",
    what: "You rank and are cited but the page frustrates visitors with dead and rage clicks - Beacon should say fix the experience first.",
    signals: {
      demand: {
        key: "persian-rug-guide",
        label: "how to identify a persian rug",
        queries: ["how to identify a persian rug"],
        gscImpressions: 1800,
      },
      ownedPages: [
        {
          url: "https://you.example/persian-rug-guide",
          servesDemandKeys: ["persian-rug-guide"],
          gscImpressions: 1800,
          gscClicks: 300, // strong CTR at position 2 => not weak
          gscPosition: 2,
          aiCitationCount: 12, // cited => not an answer-block gap
          clarityRageClicks: 14,
          clarityDeadClicks: 10, // 14 + 10 = 24 friction (>= 15)
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "fix_experience",
      disposition: "ship",
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: true },
      // Friction on a high-demand page is a strong, urgent move: it scores well
      // over half the top move, so it lands honestly in the top band.
      rankBand: "top",
    },
  },

  // 5. HEALTHY - you rank, you are cited, low friction. Leave it alone (monitor).
  {
    id: "healthy-monitor",
    what: "You rank well, you are cited, and the page is clean - Beacon should leave it alone and just monitor it.",
    signals: {
      demand: {
        key: "saffron-benefits",
        label: "saffron health benefits",
        queries: ["saffron health benefits"],
        gscImpressions: 2200,
      },
      ownedPages: [
        {
          url: "https://you.example/saffron-benefits",
          servesDemandKeys: ["saffron-benefits"],
          gscImpressions: 2200,
          gscClicks: 440, // strong CTR (~20%) at position 1
          gscPosition: 1,
          aiCitationCount: 30, // well cited
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "healthy",
      disposition: "hold", // correct to sit on a healthy page, not push a change
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: true },
      rankBand: "bottom",
    },
  },

  // 6. LOW DEMAND - real page but demand is below the floor. Not worth acting on.
  {
    id: "low-demand-below-floor",
    what: "A topic with almost no demand and no competitor pressure - Beacon should hold it below the demand floor.",
    signals: {
      demand: {
        key: "obscure-dialect-note",
        label: "obscure dialect footnote",
        queries: ["obscure dialect footnote"],
        gscImpressions: 12, // < minDemand (50)
      },
      ownedPages: [
        {
          url: "https://you.example/dialect-note",
          servesDemandKeys: ["obscure-dialect-note"],
          gscImpressions: 12,
          gscClicks: 1,
          gscPosition: 9,
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "low_demand",
      disposition: "hold",
      // A GSC impression signal exists but is tiny; the demand floor is the gate
      // here, not abstention. Abstention still reads the (weak) behavior signal.
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: true },
      rankBand: "bottom",
    },
  },

  // 7. ABSTENTION HOLD - a pure hunch: a page exists, but there is NO real signal
  //    behind acting on it (no demand, no competitor, no behavior movement). The
  //    abstention gate must hold this in "watching", never dress it as a move.
  {
    id: "abstention-thin-hunch",
    what: "A page exists but nothing corroborates acting on it - the abstention gate must hold it as watching, not recommend it.",
    signals: {
      // No demand weight, no competitors, no behavior movement. The scorer would
      // classify it low_demand; the ABSTENTION gate is what must hold it, and
      // this case exists to prove the gate holds an evidence-free hunch.
      demand: {
        key: "template-hunch-faq",
        label: "template says add an faq here",
        queries: ["template says add an faq here"],
      },
      ownedPages: [
        {
          url: "https://you.example/some-page",
          servesDemandKeys: ["template-hunch-faq"],
          // no impressions, no clicks, no position, no citations
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "low_demand",
      disposition: "hold",
      evidence: { hasDemandSignal: false, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: false },
      rankBand: "bottom",
    },
  },

  // 8. DEPENDENCY HELD - a real, ready content edit that is nonetheless blocked
  //    this batch because the page has a technical block that must be fixed first.
  //    The scorer + abstention say ship; the dependency planner says wait.
  {
    id: "dependency-technical-block",
    what: "A ready title edit on a page that is currently noindexed - the dependency planner should hold it until the indexing block is fixed.",
    signals: {
      demand: {
        key: "persian-tea-guide",
        label: "how to brew persian tea",
        queries: ["how to brew persian tea"],
        gscImpressions: 1500,
      },
      ownedPages: [
        {
          url: "https://you.example/persian-tea",
          servesDemandKeys: ["persian-tea-guide"],
          gscImpressions: 1500,
          gscClicks: 20, // weak CTR at position 7 => edit_page gap
          gscPosition: 7,
          aiCitationCount: 3,
        },
      ],
      competitorCitations: [],
    },
    expected: {
      action: "edit_page",
      disposition: "ship", // the move itself is sound
      evidence: { hasDemandSignal: true, hasCompetitorTeardown: false, hasBehaviorOrGscSignal: true },
      rankBand: "mid",
      dependencyHeld: true, // but held this batch behind the technical block
    },
    dependency: {
      id: "dependency-technical-block",
      url: "https://you.example/persian-tea",
      actionType: "edit_title",
      technicalBlocked: true, // noindex/bad status/canonical elsewhere
    },
  },
];

/** The frozen gold cases (read-only). */
export function goldCases(): readonly GoldCase[] {
  return CASES;
}

/** Total number of gold cases - the "N known-good cases" the operator line names. */
export function goldCaseCount(): number {
  return CASES.length;
}

/** The dependency candidates for the whole library, so the planner can be run
 *  over the full batch (a case with no explicit dependency gets a benign default
 *  derived from its top move, so it never spuriously blocks another case). */
export function goldDependencyCandidates(): DependencyCandidate[] {
  return CASES.map((c) => {
    if (c.dependency) return c.dependency;
    const url = c.signals.ownedPages[0]?.url ?? `https://synthetic.example/${c.id}`;
    return { id: c.id, url, actionType: "edit_meta" };
  });
}

// Re-export the abstention state type so eval consumers have one import surface.
export type { AbstentionState };
