/**
 * CORE 100K decision kernel — OUTCOME tests.
 *
 * These prove the OUTCOMES the old recommendation-intelligence / recommendations
 * / drafts / llm-orchestration / changes-shaping / action-packs stack produced,
 * against the ONE new decision path (EvidenceInput → ChangeProposal):
 *
 *   1. existing-page cold proposal generated + validated + persisted + loadable
 *   2. new-page cold brief generated + validated
 *   3. safety gates reject unsafe drafts (placeholder / dash / uuid /
 *      destructive edit / invented number)
 *   4. ranking orders by honest value
 *   5. no fabricated causality/certainty (an ungrounded number rejects)
 *   6. manual-publish — a proposal never auto-writes a live page
 *
 * Cold + deterministic: the drafting harness `complete` fn is injected, so zero
 * paid LLM calls run.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { proposeExistingPageChange, proposeNewPageChange } from "@/domains/decision/propose";
import { validateProposal } from "@/domains/decision/validate-proposal";
import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals";
import {
  serializeChangeProposal,
  deserializeChangeProposal,
  type EvidenceInput,
  type ChangeProposal,
} from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";

// ── fixtures ──────────────────────────────────────────────────────────────────

/** A completion fn that replays a fixed queue (last response repeats). */
function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const VALID_ATOMIC_EDIT = {
  field: "title",
  before: "Nowruz",
  after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
  rationale: "The current title is one word and misses the specific customs searchers ask about.",
  evidenceRefs: [{ source: "gsc", detail: "many impressions for nowruz traditions with a low click rate" }],
  confidence: "high",
  risks: ["keep the title concise"],
  operatorSteps: ["Replace the page title field with the new value"],
  proofPlan: { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
};

const VALID_CREATE_PAGE = {
  proposedTitle: "Haft-Seen Table: The Symbolic Items of Nowruz",
  metaDescription:
    "Learn what goes on the Haft-Seen table for the Persian New Year and what each symbolic item means for the year ahead.",
  openingAnswer:
    "The Haft-Seen table is the centerpiece of Nowruz, the Persian New Year, arranged with symbolic items whose Persian names begin with the letter seen. Families gather the setting to wish for renewal, health, and prosperity, and sit before it together as the new year arrives.",
  outline: [
    "What the Haft-Seen table is",
    "The symbolic items and their meanings",
    "How families arrange the setting",
    "Regional variations across Iran",
  ],
  faqQuestions: ["What does Haft-Seen mean?", "When is the Haft-Seen table set?"],
  schemaTypes: ["Article", "FAQPage"],
  evidenceRefs: [{ source: "dataforseo", detail: "AI is asked what goes on the haft-seen table for nowruz" }],
  confidence: "high",
  risks: ["describe the items qualitatively, not by count"],
  operatorSteps: ["Create a new page with this title and outline"],
  proofPlan: { metrics: ["AI citations"], windowsDays: [7, 14, 28], controls: "comparable topic pages" },
};

const EXISTING_INPUT: EvidenceInput = {
  tenantId: "referencepedia",
  page: { path: "/nowruz", url: "https://fixture-content.example/nowruz", label: "Nowruz" },
  opportunity: {
    query: "nowruz traditions",
    kind: "existing_edit",
    field: "title",
    opportunityType: "Capture clicks",
    currentValue: "Nowruz",
    intent: "what",
  },
  evidence: {
    hints: ["Search Console shows strong demand for nowruz traditions, the persian new year customs"],
    outline: ["History of Nowruz", "Haft-Seen table", "Persian customs and foods"],
  },
  sizing: { impactScore: 80, upsidePerMonth: 45 },
};

const NEW_PAGE_INPUT: EvidenceInput = {
  tenantId: "referencepedia",
  page: { path: null, url: null, label: "Haft-Seen table" },
  opportunity: {
    query: "haft-seen table",
    kind: "new_page",
    opportunityType: "Win AI citations",
  },
  evidence: {
    hints: ["AI assistants are asked what goes on the haft-seen table for nowruz, the persian new year celebrated across iran"],
    fanoutQueries: ["what are the seven items", "what does each item mean"],
    competitorPages: ["https://example.com/haft-seen"],
  },
  sizing: { impactScore: 60, upsidePerMonth: null },
};

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;
beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai"; // opt into the enabled drafting path
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
});

/** A minimal safe existing-edit proposal, for constructing rejection variants. */
function baseProposal(over: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    id: "referencepedia::/x::existing_edit::title",
    tenantId: "referencepedia",
    kind: "existing_edit",
    pagePath: "/x",
    pageUrl: "https://fixture-content.example/x",
    pageLabel: "X",
    primaryQuery: "nowruz traditions",
    opportunityType: "Capture clicks",
    changeFamily: "title",
    status: "proposed",
    recommendedChange: {
      kind: "existing_edit",
      field: "title",
      before: "Nowruz",
      after: "Nowruz Traditions: Persian New Year Customs and Haft-Seen",
    },
    whyItMatters: "The title misses the customs searchers ask about.",
    estimatedEffortMinutes: 1,
    riskLevel: "low",
    confidence: "high",
    limitations: [],
    evidence: { query: "nowruz traditions", hints: ["gsc demand"], evidenceRefCount: 1 },
    impactScore: 50,
    upsidePerMonth: 20,
    publish: "manual",
    createdAt: "2026-07-22T00:00:00.000Z",
    ...over,
  };
}

// ── 1. existing-page cold proposal generated + validated + persisted + loadable

describe("existing-page cold proposal", () => {
  it("generates, validates, persists (serialize), and re-loads (deserialize)", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_ATOMIC_EDIT) }]),
      now: new Date("2026-07-22T00:00:00Z"),
    });
    expect(out.status).toBe("proposed");
    if (out.status !== "proposed") return;

    const p = out.proposal;
    // exact-edit outcome fields Changes/Today render
    expect(p.recommendedChange.kind).toBe("existing_edit");
    if (p.recommendedChange.kind === "existing_edit") {
      expect(p.recommendedChange.before).toBe("Nowruz");
      expect(p.recommendedChange.after).toContain("Nowruz Traditions");
    }
    expect(p.whyItMatters).toMatch(/customs/i);
    expect(p.primaryQuery).toBe("nowruz traditions");
    expect(p.opportunityType).toBe("Capture clicks");
    expect(p.evidence.evidenceRefCount).toBe(1);
    // validated safe → proposed, not rejected
    expect(out.validation.verdict).toBe("ready");
    expect(p.status).toBe("proposed");

    // persisted + loadable: serialize → deserialize round-trips + re-validates
    const wire = serializeChangeProposal(p);
    const loaded = deserializeChangeProposal(wire);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(p);

    // a tampered persisted row is rejected on load (never served as trusted)
    const tampered = JSON.stringify({ v: 1, proposal: { ...p, recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "" } } });
    expect(deserializeChangeProposal(tampered)).toBeNull();
  });

  it("returns no_draft (fail-closed) when the harness is off", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const out = await proposeExistingPageChange(EXISTING_INPUT, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_ATOMIC_EDIT) }]),
    });
    expect(out.status).toBe("no_draft");
  });
});

// ── 2. new-page cold brief generated + validated ──────────────────────────────

describe("new-page cold brief", () => {
  it("generates a full brief and validates it", async () => {
    const out = await proposeNewPageChange(NEW_PAGE_INPUT, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_CREATE_PAGE) }]),
      now: new Date("2026-07-22T00:00:00Z"),
    });
    expect(out.status).toBe("proposed");
    if (out.status !== "proposed") return;

    const p = out.proposal;
    expect(p.kind).toBe("new_page");
    expect(p.pagePath).toBeNull(); // no existing page
    expect(p.recommendedChange.kind).toBe("new_page");
    if (p.recommendedChange.kind === "new_page") {
      expect(p.recommendedChange.proposedTitle).toContain("Haft-Seen");
      expect(p.recommendedChange.outline.length).toBeGreaterThanOrEqual(3);
      expect(p.recommendedChange.faqQuestions.length).toBeGreaterThan(0);
    }
    // honest limitation carried WITH a brand-new page (no before/after baseline)
    expect(p.limitations.some((l) => /baseline/i.test(l))).toBe(true);
    // a generated brief is either ready (proposed) or held for review, never
    // rejected/high-risk when its content is clean.
    expect(out.validation.verdict).not.toBe("rejected");
    expect(p.status === "proposed" || p.status === "needs_review").toBe(true);
    expect(p.riskLevel).toBe("medium");
  });
});

// ── 3. safety gates reject unsafe drafts ──────────────────────────────────────

describe("safety gates reject unsafe drafts", () => {
  it("rejects a placeholder stub", () => {
    const p = baseProposal({
      recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz [insert customs here]" },
    });
    expect(validateProposal(p).verdict).toBe("rejected");
  });

  it("rejects an em/en dash in operator copy", () => {
    const p = baseProposal({
      recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions — Persian New Year" },
    });
    const v = validateProposal(p);
    expect(v.verdict).toBe("rejected");
    expect(v.safetyFlags.some((f) => /dash/i.test(f))).toBe(true);
  });

  it("rejects a raw uuid leaking into copy", () => {
    const p = baseProposal({
      recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz 550e8400-e29b-41d4-a716-446655440000 Guide" },
    });
    expect(validateProposal(p).verdict).toBe("rejected");
  });

  it("rejects a destructive edit that guts the current value", () => {
    const p = baseProposal({
      recommendedChange: {
        kind: "existing_edit",
        field: "meta",
        before: "Nowruz is the Persian New Year celebrated with the Haft-Seen table, customs, and foods across Iran and the diaspora.",
        after: "Nowruz.",
      },
    });
    const v = validateProposal(p);
    expect(v.verdict).toBe("rejected");
    expect(v.safetyFlags.some((f) => /destructive/i.test(f))).toBe(true);
  });

  it("maps a rejected verdict to a rejected proposal status", () => {
    const p = baseProposal();
    const v = validateProposal({
      ...p,
      recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz — bad" },
    });
    expect(v.status).toBe("rejected");
  });
});

// ── 4. ranking orders by honest value ─────────────────────────────────────────

describe("rankProposals orders by value", () => {
  it("puts the higher honest upside first and sinks the rejected one", () => {
    const low = baseProposal({ id: "low", upsidePerMonth: 10, impactScore: 30 });
    const high = baseProposal({ id: "high", upsidePerMonth: 90, impactScore: 30 });
    const rejected = baseProposal({ id: "rej", status: "rejected", upsidePerMonth: 999, impactScore: 999 });
    const ranked = rankProposals([low, rejected, high]);
    expect(ranked.map((p) => p.id)).toEqual(["high", "low", "rej"]);
    // a rejected proposal never outranks a proposed one on upside alone
    expect(proposalValueScore(high)).toBeGreaterThan(proposalValueScore(rejected));
  });

  it("a real upside figure beats an unsized (null) one", () => {
    const sized = baseProposal({ id: "sized", upsidePerMonth: 5 });
    const unsized = baseProposal({ id: "unsized", upsidePerMonth: null, impactScore: 100 });
    const ranked = rankProposals([unsized, sized]);
    expect(ranked[0].id).toBe("sized");
  });
});

// ── 5. no fabricated causality / certainty ────────────────────────────────────

describe("no fabricated causality or certainty", () => {
  it("rejects an edit that introduces an ungrounded number/claim", () => {
    const p = baseProposal({
      recommendedChange: {
        kind: "existing_edit",
        field: "meta",
        before: "Nowruz is the Persian New Year celebrated across Iran.",
        after: "Nowruz is the Persian New Year, first celebrated exactly 3247 years ago in 1223 BCE.",
      },
    });
    // grounding carries no such figure → factual entailment flags a violation
    const v = validateProposal(p, { evidenceText: "nowruz is the persian new year", pageBodyText: "Nowruz is the Persian New Year celebrated across Iran." });
    expect(v.verdict).toBe("rejected");
    expect(v.factViolations.length).toBeGreaterThan(0);
  });
});

// ── 6. manual publishing authority (proposal never auto-writes) ───────────────

describe("manual publishing authority", () => {
  it("every generated proposal is a manual proposal, never applied", async () => {
    const out = await proposeExistingPageChange(EXISTING_INPUT, {
      complete: fakeComplete([{ text: JSON.stringify(VALID_ATOMIC_EDIT) }]),
    });
    expect(out.status).toBe("proposed");
    if (out.status !== "proposed") return;
    expect(out.proposal.publish).toBe("manual");
    expect(out.proposal.status).not.toBe("applied");
  });
});
