import { describe, it, expect } from "vitest";

/**
 * ask/planner.test (W9 slice 2, 2026-07-10) - PURE, NO MOCKS. planAsk is a pure function
 * over the real router and the real provider registry (it only reads each provider's id and
 * classes, never calls a gather), so these run with zero I/O and zero LLM. They pin: the
 * FLAGSHIP multi-class selection that is this slice's proof; the best-effort single-class
 * default; the 3-provider cap keeping the primary; the whole-plan determinism verdict; and
 * mergeAndCapFacts's bounding + interleave + dedupe.
 */

import { planAsk, isDeterministicPlan, SECONDARY_CUES } from "./planner";
import { mergeAndCapFacts } from "./providers/registry";
import type { AskFact } from "./types";

function ids(plan: ReturnType<typeof planAsk>): string[] {
  return plan.selections.map((s) => s.provider.id);
}

describe("ask/planner - FLAGSHIP multi-class selection (the slice's proof)", () => {
  it("'which page makes the most money and is it in tonight's plan' selects {page-ranking, daily-plan}, deterministic false", () => {
    const plan = planAsk("which page makes the most money and is it in tonight's plan");
    expect(ids(plan)).toEqual(["page-ranking", "daily-plan"]);
    expect(plan.selectedClasses).toEqual(["page_ranking", "plan"]);
    expect(plan.selections[0]!.reason).toBe("primary");
    expect(plan.selections[1]!.reason).toBe("secondary_cue");
    expect(plan.deterministic).toBe(false);
    expect(plan.bestEffortOnly).toBe(false);
  });
});

describe("ask/planner - single-class best-effort default", () => {
  it("'how are things going' selects only {gsc-daily-totals}, bestEffortOnly true, deterministic true", () => {
    const plan = planAsk("how are things going");
    expect(ids(plan)).toEqual(["gsc-daily-totals"]);
    expect(plan.selectedClasses).toEqual(["site_trend"]);
    expect(plan.bestEffortOnly).toBe(true);
    expect(plan.deterministic).toBe(true);
  });

  it("an EXPLICIT site-trend question is NOT best-effort (it had a real cue to go on)", () => {
    const plan = planAsk("did our traffic drop sitewide this week");
    expect(ids(plan)).toEqual(["gsc-daily-totals"]);
    expect(plan.bestEffortOnly).toBe(false);
  });
});

describe("ask/planner - selection per question family (primary first + determinism)", () => {
  const cases: Array<{ q: string; ids: string[]; deterministic: boolean }> = [
    // what changed -> site_trend (deterministic total)
    { q: "what changed on my site this week", ids: ["gsc-daily-totals"], deterministic: true },
    // losing/leading traffic -> page_ranking (deterministic rank)
    { q: "which page is losing the most traffic", ids: ["page-ranking"], deterministic: true },
    // what did we ship (count) -> measurement, deterministic via "how many"
    { q: "how many changes did we ship this week", ids: ["proof-ledger"], deterministic: true },
    // what did the last batch do (narrative) -> measurement, needs the LLM
    { q: "what did my last batch of changes do", ids: ["proof-ledger"], deterministic: false },
    // broken/stale -> system_health, narrative
    { q: "is anything broken right now", ids: ["pipeline-health"], deterministic: false },
    // which keyword next -> keyword_next, narrative
    { q: "which keyword should I chase next", ids: ["keyword-library"], deterministic: false },
    // who is winning AI answers -> ai_visibility, narrative
    { q: "who is beating me in chatgpt's answers", ids: ["answer-intelligence-index"], deterministic: false },
    // biggest recoverable opportunity -> keyword_next + page_ranking (multi-class L partial)
    {
      q: "which keyword should I target for the biggest opportunity",
      ids: ["keyword-library", "page-ranking"],
      deterministic: false,
    },
    // what to do next to make money -> plan + page_ranking (multi-class L)
    { q: "what should I do next to make the most money", ids: ["daily-plan", "page-ranking"], deterministic: false },
  ];

  for (const c of cases) {
    it(`'${c.q}' -> {${c.ids.join(", ")}}, deterministic ${c.deterministic}`, () => {
      const plan = planAsk(c.q);
      expect(ids(plan)).toEqual(c.ids);
      expect(plan.selections[0]!.reason).toBe("primary");
      expect(plan.deterministic).toBe(c.deterministic);
    });
  }
});

describe("ask/planner - cap at 3 providers, primary always kept", () => {
  it("truncates to 3 providers keeping the routed primary first", () => {
    const plan = planAsk(
      "which page makes the most money in tonight's plan, did the last change ship, and which keyword to target",
    );
    expect(plan.selections.length).toBe(3);
    expect(plan.selections[0]!.provider.id).toBe("page-ranking");
    expect(plan.selections[0]!.reason).toBe("primary");
    // the fourth-ranked secondary (keyword-library) is dropped by the cap
    expect(ids(plan)).not.toContain("keyword-library");
  });

  it("respects an injected lower cap", () => {
    const plan = planAsk("which page makes the most money and is it in tonight's plan", { maxProviders: 1 });
    expect(plan.selections.length).toBe(1);
    expect(plan.selections[0]!.provider.id).toBe("page-ranking");
  });
});

describe("ask/planner - isDeterministicPlan", () => {
  it("a count question is deterministic even across a mix of classes", () => {
    expect(isDeterministicPlan("how many pages and keywords have no owner", ["page_ranking", "keyword_next"])).toBe(true);
  });

  it("a multi-class 'why' synthesis is NOT deterministic", () => {
    expect(isDeterministicPlan("why is the top page in tonight's plan", ["page_ranking", "plan"])).toBe(false);
  });

  it("a plan made only of rank/total classes is deterministic", () => {
    expect(isDeterministicPlan("top pages and overall traffic", ["page_ranking", "site_trend"])).toBe(true);
  });
});

describe("ask/planner - SECONDARY_CUES lexicon", () => {
  it("omits site_trend (the universal primary) and page_specific (needs a path)", () => {
    expect(SECONDARY_CUES.site_trend).toBeUndefined();
    expect(SECONDARY_CUES.page_specific).toBeUndefined();
  });

  it("fires no secondary on the plain best-effort default", () => {
    for (const cue of Object.values(SECONDARY_CUES)) {
      expect(cue!.test("how are things going")).toBe(false);
    }
  });
});

describe("ask/planner - mergeAndCapFacts (per-provider cap, interleave, global cap, dedupe)", () => {
  function group(prefix: string, n: number, source: AskFact["source"]): AskFact[] {
    return Array.from({ length: n }, (_, i) => ({ value: `${prefix}${i}`, source, href: "/" }));
  }

  it("caps each provider at 6, interleaves primary-first, and hard-caps the total at 12", () => {
    const merged = mergeAndCapFacts([group("A", 8, "gsc"), group("B", 8, "ga4")]);
    expect(merged.length).toBe(12);
    expect(merged.slice(0, 4).map((f) => f.value)).toEqual(["A0", "B0", "A1", "B1"]);
    // per-provider cap of 6 drops A6/A7 and B6/B7
    expect(merged.some((f) => f.value === "A6")).toBe(false);
    expect(merged.some((f) => f.value === "B6")).toBe(false);
  });

  it("drops an exact-duplicate value (trim + lowercase), keeping the first (primary) occurrence", () => {
    const a: AskFact[] = [
      { value: "same fact", source: "gsc", href: "/" },
      { value: "unique a", source: "gsc", href: "/" },
    ];
    const b: AskFact[] = [
      { value: "SAME FACT", source: "ga4", href: "/" },
      { value: "unique b", source: "ga4", href: "/" },
    ];
    expect(mergeAndCapFacts([a, b]).map((f) => f.value)).toEqual(["same fact", "unique a", "unique b"]);
  });
});
