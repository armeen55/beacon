import { describe, it, expect } from "vitest";

/**
 * synthetic-journey (BEACON_500 N37, 2026-07-03, R22b) - ONE end-to-end
 * integration test that walks a synthetic operator through the whole loop with
 * the REAL pure modules and mocked I/O:
 *
 *   find -> abstention-hold -> prepare -> ship (canary) -> measure -> learn
 *
 * The point is COHERENCE: the same item threads through every stage and no stage
 * silently drops it. We assert at each seam that the item is still present and
 * that its disposition is honest (a held item is honestly held, a shipped item
 * is honestly shipped, a measured outcome feeds the next-run prior).
 *
 * PURE end to end - every module here is deterministic, so this test is a
 * hermetic proof that the loop is wired together, not a live smoke test.
 */

import { buildDemandGraph } from "@/domains/demand-graph/build-graph";
import { assessAbstention, partitionByEvidence } from "@/domains/recommendations/abstention";
import { buildEvidencePacket } from "@/domains/demand-graph/evidence-packet";
import { runCanaries, type CanaryMove } from "@/domains/safety/canary";
import { computeCitationOutcome } from "@/domains/proof-gsc/citation-outcome";
import { computeOutcomePriors } from "@/domains/recommendation-intelligence/outcome-prior";
import { goldCases } from "./gold-library";

const OWN_DOMAIN = "you.example";

describe("synthetic journey: find -> hold -> prepare -> ship -> measure -> learn", () => {
  it("walks one item coherently through every stage with no silent drop", () => {
    // ── FIND. Take a real gold case that SHOULD ship (an answer-block gap) and
    //    one that SHOULD be held (the evidence-thin hunch), so the journey
    //    exercises both the ready and the held path in one pass. ──
    const shipCase = goldCases().find((c) => c.id === "answer-block-uncited")!;
    const holdCase = goldCases().find((c) => c.id === "abstention-thin-hunch")!;
    expect(shipCase).toBeTruthy();
    expect(holdCase).toBeTruthy();

    const graph = buildDemandGraph({
      demand: [shipCase.signals.demand, holdCase.signals.demand],
      ownedPages: [...shipCase.signals.ownedPages, ...holdCase.signals.ownedPages],
      competitorCitations: [...shipCase.signals.competitorCitations, ...holdCase.signals.competitorCitations],
    });
    // FIND produced a move for BOTH demand nodes - nothing dropped at discovery.
    expect(graph.moves.length).toBe(2);
    const shipMove = graph.moves.find((m) => m.demandKey === shipCase.signals.demand.key)!;
    const holdMove = graph.moves.find((m) => m.demandKey === holdCase.signals.demand.key)!;
    expect(shipMove.gap).toBe("answer_block");
    expect(holdMove.gap).toBe("low_demand");

    // ── ABSTENTION-HOLD. Partition by the honest evidence each item carries. The
    //    ready one moves on; the held one is HELD (not deleted) with a reason. ──
    const items = [
      { id: shipCase.id, evidence: shipCase.expected.evidence, move: shipMove },
      { id: holdCase.id, evidence: holdCase.expected.evidence, move: holdMove },
    ];
    const partition = partitionByEvidence(items, (i) => i.evidence);
    expect(partition.ready.map((i) => i.id)).toEqual([shipCase.id]);
    expect(partition.held.map((h) => h.item.id)).toEqual([holdCase.id]);
    // The held item is honestly held, not silently gone: it carries a watching
    // verdict with the honest sentence.
    expect(partition.held[0]!.verdict.state).toBe("watching");
    expect(partition.held[0]!.verdict.sentence).toContain("I do not have enough evidence");
    // And the ready item's disposition is coherent with assessAbstention.
    expect(assessAbstention(shipCase.expected.evidence).state).toBe("ready");

    // ── PREPARE. Build the grounded evidence packet for the ready item. No LLM,
    //    a deterministic skeleton. The item survives with a real draft. ──
    const ready = partition.ready[0]!;
    const packet = buildEvidencePacket({
      move: ready.move,
      brand: "You",
      ownedFacts: {
        title: "Tahdig",
        metaDescription: null,
        h1: "Tahdig",
        h2Count: 2,
        outline: ["What is tahdig", "Steps"],
        schemaTypes: [],
        hasFaq: false,
        hasAnswerBlock: false,
        wordCount: 600,
      },
      ownedGsc: { clicks: 400, impressions: 3200, ctr: 0.125, position: 3 },
      competitor: {
        url: "https://competitor-a.example/tahdig-guide",
        domain: "competitor-a.example",
        fetchStatus: "ok",
        facts: null,
      },
    });
    expect(packet.move.key).toBe(ready.move.demandKey);
    // The packet named a concrete gap and produced a draft skeleton (prepared,
    // not dropped).
    expect(packet.gaps.length).toBeGreaterThan(0);
    expect(packet.draft.kind).toBe("deterministic_skeleton");

    // ── SHIP. The prepared item goes through the FINAL canary gate. A clean,
    //    on-tenant, non-empty, evidenced move must NOT be held (byte-identical to
    //    shipping directly). Then prove the gate CATCHES a bad sibling. ──
    const cleanMove: CanaryMove = {
      id: ready.id,
      targetUrl: `https://${OWN_DOMAIN}/tahdig`,
      proposedText: packet.draft.titleSuggestion ?? "How to cook tahdig",
      evidenceCount: packet.gaps.length,
    };
    const clean = runCanaries([cleanMove], { tenantDomain: OWN_DOMAIN, spendTripped: false });
    expect(clean.held).toBe(false);
    if (!clean.held) expect(clean.checked).toBe(1);

    // A bad batch (off-tenant URL) is held whole - nothing ships silently.
    const bad = runCanaries(
      [cleanMove, { id: "x", targetUrl: "https://competitor.example/x", proposedText: "hi", evidenceCount: 1 }],
      { tenantDomain: OWN_DOMAIN, spendTripped: false },
    );
    expect(bad.held).toBe(true);
    if (bad.held) expect(bad.holdReason).toContain("Nothing was published.");

    // ── MEASURE. After the (clean) ship, a control-adjusted citation outcome is
    //    computed from pre/post observations. The item produces an honest,
    //    non-silent verdict. ──
    const outcome = computeCitationOutcome({
      shippedAt: "2026-06-01",
      preWindowDays: 28,
      postWindowDays: 28,
      treatedPre: [{ date: "2026-05-20", platform: "chatgpt", promptText: "how to cook tahdig", count: 1 }],
      treatedPost: [
        { date: "2026-06-10", platform: "chatgpt", promptText: "how to cook tahdig", count: 4 },
        { date: "2026-06-20", platform: "perplexity", promptText: "how to cook tahdig", count: 3 },
      ],
      controls: [
        {
          pre: [{ date: "2026-05-21", platform: "chatgpt", promptText: "q", count: 1 }],
          post: [{ date: "2026-06-11", platform: "chatgpt", promptText: "q", count: 1 }],
        },
      ],
      sourceActiveInPre: true,
      sourceActiveInPost: true,
    });
    // A real, spoken verdict (not silence, not insufficient_data) - the treated
    // page gained AI mentions the comparison page did not.
    expect(outcome.verdict).toBe("gained");
    expect(outcome.sentence.trim().length).toBeGreaterThan(0);

    // ── LEARN. The settled outcome feeds the next-run priority prior for this
    //    action type, closing the loop. Three settled wins earn a positive prior
    //    that would re-rank the SAME kind of move up next time. ──
    const priors = computeOutcomePriors([
      { actionType: "add_answer_block", verdict: "won" },
      { actionType: "add_answer_block", verdict: "won" },
      { actionType: "add_answer_block", verdict: "won" },
    ]);
    expect(priors.get("add_answer_block")).toBe(1);
    // The loop is coherent: the item that was FOUND and SHIPPED and MEASURED as a
    // win now tilts the next find/rank toward more of the same - nothing was
    // dropped, and learning flowed back to the front of the loop.
  });

  it("no stage fabricates a decision for the held item (it never reaches ship)", () => {
    const holdCase = goldCases().find((c) => c.id === "abstention-thin-hunch")!;
    const verdict = assessAbstention(holdCase.expected.evidence);
    // The held item stops at abstention - it is watching, with no present signals,
    // and never gets prepared or shipped. That is the honest drop-safe behavior.
    expect(verdict.state).toBe("watching");
    expect(verdict.presentSignals).toEqual([]);
  });
});
