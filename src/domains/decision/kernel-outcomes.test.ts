/**
 * DECISION KERNEL OUTCOME PROOF (CORE 100K cutover, 2026-07-22).
 *
 * Proves the ONE recommendation path the live Changes + Today surfaces run on:
 *   EvidenceSnapshot -> (opportunities) EvidenceInput
 *     -> (propose, COLD) ChangeProposal   [LLM boundary is a fixture, no paid call]
 *       -> (validate) safe verdict + lifecycle status
 *         -> (rank) most-valuable first
 *           -> (serialize) durable, tamper-rejecting persistence contract
 * Publishing is MANUAL and tenant isolation holds. If the live path could no
 * longer generate + validate + rank a safe exact change, these fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));
const { buildWinnerFewShotsMock, buildWinnerFewShotsWithPatternMock } = vi.hoisted(() => ({
  buildWinnerFewShotsMock: vi.fn(async (): Promise<string> => ""),
  buildWinnerFewShotsWithPatternMock: vi.fn(async (): Promise<{ fragment: string; patternHint: null }> => ({ fragment: "", patternHint: null })),
}));
vi.mock("@/domains/llm/winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
  buildWinnerFewShotsWithPattern: buildWinnerFewShotsWithPatternMock,
}));

import type { CompleteFn } from "@/domains/llm/structured-drafter";
import { proposeExistingPageChange, proposeNewPageChange } from "./propose";
import { validateProposal } from "./validate-proposal";
import { rankProposals } from "./rank-proposals";
import {
  serializeChangeProposal,
  deserializeChangeProposal,
  proposalId,
  type ChangeProposal,
  type EvidenceInput,
} from "./contracts";
import { snapshotToEvidenceInputs } from "./opportunities";
import { buildEvidenceSnapshot, type EvidenceSnapshotInput } from "@/domains/evidence/snapshot";

const NOW = new Date("2026-07-22T00:00:00.000Z");
const TENANT = "tenant-iranopedia";

function fakeComplete(text: string): CompleteFn {
  return async () => ({ text });
}

const atomicEditJson = JSON.stringify({
  field: "title",
  before: "Persian Male Names",
  after: "Persian Male Names: Meanings and Origins",
  rationale: "Names the meanings and origins the searchers and AI answers are looking for.",
  sources: [],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
  evidenceRefs: [{ source: "gsc", detail: "4200 impressions for persian male names over 90 days" }],
  confidence: "high",
  risks: [],
  operatorSteps: ["Open the page in your CMS", "Replace the page title with the new value", "Save and publish"],
});

const createPageJson = JSON.stringify({
  proposedTitle: "Persian Wedding Traditions Explained",
  metaDescription: "A clear guide to Persian wedding traditions, from the sofreh aghd ceremony to the jashn reception and what each symbolic item means.",
  openingAnswer:
    "Persian weddings center on the sofreh aghd, a ceremonial spread the couple sits before while guests hold a canopy above them, followed by the aghd vows and a celebratory jashn reception with family and friends who share food, music, and dancing.",
  outline: ["What is the sofreh aghd", "The aghd ceremony", "The jashn reception"],
  faqQuestions: ["What is a sofreh aghd?", "How long does a Persian wedding last?"],
  schemaTypes: ["Article", "FAQPage"],
  sources: [],
  proofPlan: { metrics: ["Profound citations", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" },
  evidenceRefs: [{ source: "fanout", detail: "AI answers keep getting asked about persian wedding traditions" }],
  confidence: "medium",
  risks: [],
  operatorSteps: ["Draft the page from this brief", "Publish it", "Add it to your sitemap"],
});

const existingInput: EvidenceInput = {
  tenantId: TENANT,
  page: { path: "/persian-male-names", url: "https://iranopedia.com/persian-male-names", label: "Persian Male Names" },
  opportunity: {
    query: "persian male names",
    kind: "existing_edit",
    opportunityType: "Sharpen the title for search + AI",
    field: "title",
    currentValue: "Persian Male Names",
    intent: "list",
  },
  evidence: { hints: ["4200 impressions for persian male names over 90 days"], pageBodyText: null, outline: ["Meanings", "Origins"] },
  sizing: { impactScore: 4200, upsidePerMonth: 90, hasSerpVerdict: false },
};

const newPageInput: EvidenceInput = {
  tenantId: TENANT,
  page: { path: null, url: null, label: "persian wedding traditions" },
  opportunity: { query: "persian wedding traditions", kind: "new_page", opportunityType: "Build a page AI and Google keep asking for" },
  evidence: { hints: ["AI answers keep getting asked about persian wedding traditions"], competitorPages: ["https://competitor.example/persian-weddings"], fanoutQueries: ["sofreh aghd", "jashn reception"] },
  sizing: { impactScore: 800, upsidePerMonth: null, hasSerpVerdict: false },
};

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai";
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = "deterministic";
  vi.clearAllMocks();
});

describe("propose (COLD) — existing-page exact edit", () => {
  it("generates + validates a manual-publish ChangeProposal with an exact before/after", async () => {
    const outcome = await proposeExistingPageChange(existingInput, { complete: fakeComplete(atomicEditJson), now: NOW });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const p = outcome.proposal;
    expect(p.kind).toBe("existing_edit");
    expect(p.tenantId).toBe(TENANT);
    expect(p.publish).toBe("manual"); // the kernel NEVER writes a live page
    expect(p.recommendedChange.kind).toBe("existing_edit");
    if (p.recommendedChange.kind === "existing_edit") {
      expect(p.recommendedChange.after.length).toBeGreaterThan(0);
      expect(p.recommendedChange.before).toBe("Persian Male Names");
    }
    // a landed, safe draft is offered as ready-or-review, never rejected here.
    expect(["proposed", "needs_review"]).toContain(p.status);
    expect(p.pagePath).toBe("/persian-male-names");
  });
});

describe("propose (COLD) — new-page brief", () => {
  it("generates a new_page ChangeProposal kept distinct from an edit", async () => {
    const outcome = await proposeNewPageChange(newPageInput, { complete: fakeComplete(createPageJson), now: NOW });
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const p = outcome.proposal;
    expect(p.kind).toBe("new_page");
    expect(p.pagePath).toBeNull(); // a new page has no existing path
    expect(p.recommendedChange.kind).toBe("new_page");
    // a brand-new page honestly carries the "no baseline yet" limitation.
    expect(p.limitations.join(" ")).toMatch(/baseline/i);
    expect(p.publish).toBe("manual");
  });
});

describe("validate-proposal — the one safety verdict", () => {
  const base: ChangeProposal = {
    id: "id", tenantId: TENANT, kind: "existing_edit", pagePath: "/p", pageUrl: null, pageLabel: "P",
    primaryQuery: "persian male names", opportunityType: "t", changeFamily: "title", status: "proposed",
    recommendedChange: { kind: "existing_edit", field: "title", before: "Persian Male Names", after: "Persian Male Names and Meanings" },
    whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high",
    limitations: [], evidence: { query: "persian male names", hints: [], evidenceRefCount: 1 },
    impactScore: 1, upsidePerMonth: 1, publish: "manual", createdAt: NOW.toISOString(),
  };

  it("passes a clean, on-topic rewrite", () => {
    const v = validateProposal(base, { evidenceText: "persian male names meanings", now: NOW });
    expect(v.verdict).not.toBe("rejected");
  });

  it("rejects a placeholder rewrite", () => {
    const v = validateProposal(
      { ...base, recommendedChange: { kind: "existing_edit", field: "title", before: "X", after: "[insert title here]" } },
      { now: NOW },
    );
    expect(v.verdict).toBe("rejected");
    expect(v.status).toBe("rejected");
  });

  it("rejects an em-dash in operator copy", () => {
    const v = validateProposal(
      { ...base, recommendedChange: { kind: "existing_edit", field: "title", before: "X", after: "Persian Male Names — Meanings" } },
      { now: NOW },
    );
    expect(v.verdict).toBe("rejected");
  });

  it("rejects a destructive rewrite that guts the current value", () => {
    const v = validateProposal(
      { ...base, recommendedChange: { kind: "existing_edit", field: "title", before: "A very long descriptive current page title", after: "x" } },
      { now: NOW },
    );
    expect(v.verdict).toBe("rejected");
  });
});

describe("rank-proposals — most-valuable first", () => {
  const mk = (over: Partial<ChangeProposal>): ChangeProposal => ({
    id: over.id ?? "id", tenantId: TENANT, kind: "existing_edit", pagePath: "/p", pageUrl: null, pageLabel: "P",
    primaryQuery: "q", opportunityType: "t", changeFamily: "title", status: "proposed",
    recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "a" },
    whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high",
    limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 },
    impactScore: 0, upsidePerMonth: null, publish: "manual", createdAt: NOW.toISOString(), ...over,
  });

  it("ranks proposed above needs_review above rejected, then by upside", () => {
    const rejected = mk({ id: "r", status: "rejected", upsidePerMonth: 9999 });
    const review = mk({ id: "v", status: "needs_review", upsidePerMonth: 5000 });
    const bigReady = mk({ id: "big", status: "proposed", upsidePerMonth: 500 });
    const smallReady = mk({ id: "small", status: "proposed", upsidePerMonth: 100 });
    const order = rankProposals([rejected, review, smallReady, bigReady]).map((p) => p.id);
    expect(order).toEqual(["big", "small", "v", "r"]);
  });
});

describe("contracts — identity, persistence, tenant isolation", () => {
  it("carries the tenant id in the stable proposal id (isolation)", () => {
    const a = proposalId(existingInput);
    const b = proposalId({ ...existingInput, tenantId: "tenant-other" });
    expect(a).toContain(TENANT);
    expect(b).toContain("tenant-other");
    expect(a).not.toBe(b);
  });

  it("survives a serialize -> deserialize round-trip and rejects a tampered row", () => {
    const p: ChangeProposal = {
      id: "id", tenantId: TENANT, kind: "existing_edit", pagePath: "/p", pageUrl: null, pageLabel: "P",
      primaryQuery: "q", opportunityType: "t", changeFamily: "title", status: "proposed",
      recommendedChange: { kind: "existing_edit", field: "title", before: null, after: "a" },
      whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "high",
      limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 },
      impactScore: 1, upsidePerMonth: 1, publish: "manual", createdAt: NOW.toISOString(),
    };
    expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p);
    expect(deserializeChangeProposal('{"v":1,"proposal":{"garbage":true}}')).toBeNull();
    expect(deserializeChangeProposal(null)).toBeNull();
  });
});

describe("opportunities — snapshot maps to kernel inputs", () => {
  function snapshotInput(): EvidenceSnapshotInput {
    const empty = { status: "empty" as const, lastSyncedAt: null, payload: [] as never[] };
    return {
      scope: { tenantId: TENANT, site: "iranopedia.com", builtAt: NOW.toISOString() },
      gsc: {
        status: "fresh", lastSyncedAt: null,
        payload: [{ url: "https://iranopedia.com/persian-male-names", clicks90d: 90, impressions90d: 4200, ctr90d: 0.02, position90d: 6, topQueries: [{ query: "persian male names", impressions: 4200, clicks: 90, position: 6 }] }],
      },
      ga4: empty,
      wix: {
        status: "fresh", lastSyncedAt: null,
        payload: [{ url: "https://iranopedia.com/persian-male-names", title: "Persian Male Names", metaDescription: "Names", h1: "Persian Male Names", h2: [], outline: ["Meanings"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 800, internalLinks: [], fetchedAt: NOW.toISOString() }],
      },
      clarity: empty,
      dataforseo: empty,
      nativeAi: {
        status: "fresh", lastSyncedAt: null,
        payload: {
          citedPages: [{ url: "https://competitor.example/persian-weddings", isOwned: false, citationCount: 5, distinctPrompts: 4, engines: ["chatgpt"], examplePrompts: ["persian wedding traditions"] }],
          questions: [], rowsScanned: 10, enginesSeen: ["chatgpt"],
        },
      },
    };
  }

  it("emits an existing_edit input for a demanded owned page and a new_page input for a competitor-cited topic", () => {
    const snapshot = buildEvidenceSnapshot(snapshotInput());
    const inputs = snapshotToEvidenceInputs(snapshot);
    const edits = inputs.filter((i) => i.opportunity.kind === "existing_edit");
    const newPages = inputs.filter((i) => i.opportunity.kind === "new_page");
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].tenantId).toBe(TENANT);
    expect(edits[0].opportunity.query).toBe("persian male names");
    expect(edits[0].opportunity.currentValue).toBe("Persian Male Names");
    expect(newPages.length).toBeGreaterThan(0);
    expect(newPages[0].page.path).toBeNull();
  });
});
