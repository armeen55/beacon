/**
 * SoV drop alert trigger tests (BEACON 500 item 79, 2026-07-02) -
 * `sov_drop_alert`: an AI engine that used to mention the tenant on a
 * topic stopped doing so this week (or fell hard). The trigger is a thin
 * wrapper over sov-weekly.ts's own `SovDropAlert[]` - the drop MATH is
 * tested there; this file tests the candidate-row SHAPE, ranking, and
 * abstain paths.
 */

import { describe, expect, it } from "vitest";

import type { SovDropAlert } from "@/domains/ai-visibility/sov-weekly";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import { sovDropAlert } from "@/domains/recommendation-intelligence/triggers/sov-drop-alert";

const ROOT = "https://iranopedia.com/";

function alert(over: Partial<SovDropAlert> = {}): SovDropAlert {
  return {
    engine: "perplexity",
    topic: "date questions",
    weekKey: "2026-W27",
    priorWeekKey: "2026-W26",
    priorShare: 0.8,
    currentShare: 0.2,
    dropPoints: 60,
    promptsPolled: 5,
    droppedToZero: false,
    flippedPrompts: [
      { promptId: "p1", promptText: "When is Nowruz 2026" },
      { promptId: "p2", promptText: "What date is Chaharshanbe Suri" },
      { promptId: "p3", promptText: "When does the Persian new year start" },
    ],
    headline:
      "Perplexity dropped you 60 points on date questions this week (3 of 5 questions stopped mentioning you)",
    ...over,
  };
}

function run(alerts: SovDropAlert[], siteRootUrl: string | null = ROOT) {
  return sovDropAlert({
    tenantId: "tenant-a",
    alerts,
    siteRootUrl,
    signalAt: "2026-07-02T04:00:00Z",
  });
}

describe("sovDropAlert - emits on a real drop", () => {
  it("emits one add_answer_block candidate per alert", () => {
    const out = run([alert()]);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("sov_drop_alert");
    expect(c.action_type).toBe("add_answer_block");
    expect(c.generator_kind).toBe("deterministic");
    expect(c.target_url).toBe(ROOT);
    expect(c.confidence).toBe("medium");
    expect(c.safety_flags).toEqual([]);
  });

  it("topic_cluster_label anchors on (engine, topic, week) so a new week produces a fresh candidate", () => {
    const a = run([alert({ weekKey: "2026-W27" })])[0]!;
    const b = run([alert({ weekKey: "2026-W28" })])[0]!;
    expect(a.topic_cluster_label).not.toBe(b.topic_cluster_label);
    expect(a.dedupe_key).not.toBe(b.dedupe_key);
  });

  it("re-running the same week produces the same dedupe_key (collapses onto one row)", () => {
    const a = run([alert()])[0]!;
    const b = run([alert()])[0]!;
    expect(a.dedupe_key).toBe(b.dedupe_key);
  });

  it("names the engine, topic, and flipped prompts in the evidence + operator trace", () => {
    const c = run([alert()])[0]!;
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]!.detail).toContain("engine=perplexity");
    expect(c.evidence[0]!.detail).toContain("topic=date questions");
    expect(c.evidence[0]!.detail).toContain("week=2026-W27");
    expect(c.evidence[0]!.detail).toContain("flipped_prompts=3");
    expect(c.operator_evidence).toBe(alert().headline);
  });

  it("customer copy names the engine, the topic, and example flipped prompts, with no forbidden dash", () => {
    const c = run([alert()])[0]!;
    expect(c.customer_copy).toContain("Perplexity");
    expect(c.customer_copy).toContain("date questions");
    expect(c.customer_copy).toContain("When is Nowruz 2026");
    expect(hasBannedDash(c.customer_copy)).toBe(false);
  });

  it("uses high impact when 3+ prompts flipped or the drop fell to zero", () => {
    const manyFlipped = run([alert()])[0]!;
    expect(manyFlipped.impact_estimate).toBe("high");

    const zeroFall = run([
      alert({
        flippedPrompts: [{ promptId: "p1", promptText: "q1" }],
        droppedToZero: true,
      }),
    ])[0]!;
    expect(zeroFall.impact_estimate).toBe("high");

    const smallDrop = run([
      alert({
        flippedPrompts: [{ promptId: "p1", promptText: "q1" }],
        droppedToZero: false,
      }),
    ])[0]!;
    expect(smallDrop.impact_estimate).toBe("medium");
  });

  it("picks the worst drop first and caps at maxCandidates", () => {
    const out = run([
      alert({ topic: "small-drop", dropPoints: 16 }),
      alert({ topic: "big-drop", dropPoints: 70 }),
      alert({ topic: "mid-drop", dropPoints: 40 }),
    ]);
    expect(out.map((c) => c.topic_cluster_label)).toEqual([
      expect.stringContaining("big-drop"),
      expect.stringContaining("mid-drop"),
      expect.stringContaining("small-drop"),
    ]);
  });

  it("respects a custom maxCandidates cap", () => {
    const out = sovDropAlert({
      tenantId: "tenant-a",
      alerts: [alert({ topic: "a" }), alert({ topic: "b" }), alert({ topic: "c" })],
      siteRootUrl: ROOT,
      signalAt: "2026-07-02T04:00:00Z",
      maxCandidates: 1,
    });
    expect(out).toHaveLength(1);
  });
});

describe("sovDropAlert - abstains on nothing to show", () => {
  it("emits NOTHING on empty alerts", () => {
    expect(run([])).toEqual([]);
  });

  it("abstains when the tenant has no configured domain (no URL to anchor)", () => {
    expect(run([alert()], null)).toEqual([]);
    expect(run([alert()], "")).toEqual([]);
  });
});
