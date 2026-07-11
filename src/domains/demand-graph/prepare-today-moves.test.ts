import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every I/O boundary. Keep the PURE reasoning real: specialist-opinions,
// move-router, prepared-move-pack, draft-quality, evidence-packet, and the new
// existing-page-winnability decision all run for real so the test exercises the
// actual readiness ladder + hold logic. NO live DataForSEO call is ever made
// (runSerp is injected per test).
vi.mock("./gap-compiler", () => ({ loadChangePacksForTenant: vi.fn() }));
vi.mock("./move-draft-store", () => ({
  saveMoveDraft: vi.fn(async () => true),
  getLatestMoveDrafts: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/llm/structured-drafter", () => ({
  draftAnswerBlockStructured: vi.fn(),
  draftAtomicEditStructured: vi.fn(),
  draftCreatePageStructured: vi.fn(),
  draftCROFixStructured: vi.fn(),
}));
vi.mock("@/domains/team-scoreboard/load-team-scoreboard", () => ({ loadSpecialistWeightTable: vi.fn(async () => null) }));
vi.mock("@/domains/seasonal/family-demand-profile-store", () => ({ loadFamilyDemandProfiles: vi.fn(async () => []) }));

import { prepareTodayMovesForTenant } from "./prepare-today-moves";
import { loadChangePacksForTenant } from "./gap-compiler";
import { saveMoveDraft, getLatestMoveDrafts } from "./move-draft-store";
import { draftAnswerBlockStructured } from "@/domains/llm/structured-drafter";
import { buildEvidencePacket } from "./evidence-packet";
import type { MoveCandidate } from "./build-graph";
import type { SerpRunResult } from "@/domains/serp/dataforseo-serp";
import type { SerpSnapshot } from "@/domains/serp/serp-provider";
import { parsePreparedPack } from "./prepared-move-pack";

function move(over: Partial<MoveCandidate> = {}): MoveCandidate {
  return {
    demandKey: "gap:persian-tea",
    label: "persian tea culture",
    gap: "answer_block",
    score: 90,
    components: { demand: 500, winnability: 0.6, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: "high",
    signals: ["GSC", "AI"],
    ownedUrl: "https://iranopedia.com/persian-tea",
    competitorUrls: ["https://competitor.com/tea"],
    fanoutSeeds: ["how is persian tea served", "what is persian tea"],
    rationale: "demand + AI cite rivals",
    ...over,
  };
}

/** A real EvidencePacket for an existing-page answer_block move. */
function packet(over: Partial<MoveCandidate> = {}) {
  return buildEvidencePacket({
    move: move(over),
    brand: "Iranopedia",
    ownedFacts: {
      title: "Persian Tea",
      metaDescription: "About persian tea",
      h1: "Persian Tea",
      h2Count: 3,
      outline: ["History", "How it is served"],
      schemaTypes: ["Article"],
      hasFaq: false,
      hasAnswerBlock: false,
      wordCount: 400,
    },
    ownedGsc: { clicks: 50, impressions: 2000, ctr: 0.025, position: 8 },
    competitor: null,
    fanoutSeeds: ["how is persian tea served"],
  });
}

const CONTENT_SNAPSHOT: SerpSnapshot = {
  query: "persian tea culture",
  results: [
    { rank: 1, domain: "theknot.com", url: "https://theknot.com/x", title: "x" },
    { rank: 2, domain: "brides.com", url: "https://brides.com/y", title: "y" },
    { rank: 3, domain: "history.com", url: "https://history.com/z", title: "z" },
    { rank: 4, domain: "wikipedia.org", url: "https://wikipedia.org/w", title: "w" },
    { rank: 5, domain: "vogue.com", url: "https://vogue.com/v", title: "v" },
  ],
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-07-06T00:00:00Z",
};

const MARKETPLACE_SNAPSHOT: SerpSnapshot = {
  query: "persian tea culture",
  results: [
    { rank: 1, domain: "amazon.com", url: "https://amazon.com/1", title: "1" },
    { rank: 2, domain: "etsy.com", url: "https://etsy.com/2", title: "2" },
    { rank: 3, domain: "ebay.com", url: "https://ebay.com/3", title: "3" },
    { rank: 4, domain: "reddit.com", url: "https://reddit.com/4", title: "4" },
    { rank: 5, domain: "pinterest.com", url: "https://pinterest.com/5", title: "5" },
    { rank: 6, domain: "walmart.com", url: "https://walmart.com/6", title: "6" },
    { rank: 7, domain: "aliexpress.com", url: "https://aliexpress.com/7", title: "7" },
  ],
  features: [],
  source: "dataforseo",
  fetchedAt: "2026-07-06T00:00:00Z",
};

function serpResult(status: SerpRunResult["status"], snapshot: SerpSnapshot | null, costUsd = 0): SerpRunResult {
  return { status, plan: {} as never, snapshot, costUsd, detail: status };
}

/** A GOOD Iranopedia answer block that passes the draft-quality gate. */
const GOOD_ANSWER =
  "Persian tea culture centers on strong black tea brewed in a two-tier samovar and served in a small glass called an estekan, often with a sugar cube held between the teeth. In Iran, tea is offered to guests as a sign of hospitality throughout the day, from morning until late evening, and it accompanies conversation, sweets, and dates.";

function draftedOk() {
  return {
    status: "drafted" as const,
    kind: "answer_block" as const,
    value: { answer: GOOD_ANSWER, evidenceRefs: [{ source: "gsc" }], operatorSteps: ["Add the answer block up top."], risks: [] },
    costUsd: 0.01,
    retried: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadChangePacksForTenant).mockResolvedValue({ packets: [packet()] } as never);
  vi.mocked(getLatestMoveDrafts).mockResolvedValue(new Map());
  vi.mocked(saveMoveDraft).mockResolvedValue(true);
  vi.mocked(draftAnswerBlockStructured).mockResolvedValue(draftedOk() as never);
});

describe("prepareTodayMovesForTenant - RANK-3 live Google-results winnability", () => {
  it("WINNABLE content SERP -> proceeds to draft, reaches draft_ready+, and carries the worth-doing line", async () => {
    const runSerp = vi.fn(async () => serpResult("ok", CONTENT_SNAPSHOT, 0.003));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    expect(runSerp).toHaveBeenCalledTimes(1);
    expect(summary.winnabilityHeld).toBe(0);
    expect(summary.serpCostUsd).toBeCloseTo(0.003);
    expect(summary.prepared).toBe(1);
    // A drafted move with a proof plan reaches ready_to_review.
    expect(["draft_ready", "ready_to_review"]).toContain(summary.outcomes[0].preparedStatus);
    // The prepared_pack was persisted carrying the honest winnable line.
    const packCall = vi.mocked(saveMoveDraft).mock.calls.find((c) => c[2] === "prepared_pack");
    const persisted = parsePreparedPack(packCall?.[3] as string);
    expect(persisted?.winnabilityLine).toContain("worth doing");
    expect(persisted?.winnabilityHold).toBeUndefined();
    expect(persisted?.structuredDraft).toBeTruthy();
  });

  it("UNWINNABLE marketplace SERP -> HELD at serp_checked, NO LLM draft, honest hold line", async () => {
    const runSerp = vi.fn(async () => serpResult("ok", MARKETPLACE_SNAPSHOT, 0.003));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    expect(summary.winnabilityHeld).toBe(1);
    // Held BEFORE drafting: the LLM drafter was never called.
    expect(draftAnswerBlockStructured).not.toHaveBeenCalled();
    expect(summary.llmCostUsd).toBe(0);
    expect(summary.outcomes[0].preparedStatus).toBe("serp_checked");
    const packCall = vi.mocked(saveMoveDraft).mock.calls.find((c) => c[2] === "prepared_pack");
    const persisted = parsePreparedPack(packCall?.[3] as string);
    expect(persisted?.winnabilityHold).toBe(true);
    expect(persisted?.winnabilityLine).toContain("marketplaces and directories I cannot outrank");
    expect(persisted?.preparedStatus).toBe("serp_checked");
    expect(persisted?.structuredDraft).toBeNull();
  });

  it("BYTE-IDENTICAL + ZERO SPEND when SERP is unconfigured/dry-run (runSerp returns disabled/dry_run, no snapshot)", async () => {
    const runSerp = vi.fn(async () => serpResult("dry_run", null, 0));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    expect(summary.serpCostUsd).toBe(0);
    expect(summary.winnabilityHeld).toBe(0);
    // Drafting proceeds exactly as before (no verdict = no change to the flow).
    expect(draftAnswerBlockStructured).toHaveBeenCalledTimes(1);
    const packCall = vi.mocked(saveMoveDraft).mock.calls.find((c) => c[2] === "prepared_pack");
    const persisted = parsePreparedPack(packCall?.[3] as string);
    // No verdict -> no winnability line, no hold. Same shape as pre-RANK-3.
    expect(persisted?.winnabilityLine).toBeUndefined();
    expect(persisted?.winnabilityHold).toBeUndefined();
    expect(persisted?.structuredDraft).toBeTruthy();
  });

  it("checkWinnability:false makes ZERO SERP calls (opt-out) and drafts as before", async () => {
    const runSerp = vi.fn(async () => serpResult("ok", CONTENT_SNAPSHOT, 0.003));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      checkWinnability: false,
      runSerp: runSerp as never,
    });
    expect(runSerp).not.toHaveBeenCalled();
    expect(summary.serpCostUsd).toBe(0);
    expect(draftAnswerBlockStructured).toHaveBeenCalledTimes(1);
  });

  it("CAP/BREAKER respected: a 'capped' runSerp result yields no verdict, no spend, and drafting still proceeds (fail-soft)", async () => {
    const runSerp = vi.fn(async () => serpResult("capped", null, 0));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    expect(runSerp).toHaveBeenCalledTimes(1);
    expect(summary.serpCostUsd).toBe(0);
    expect(summary.winnabilityHeld).toBe(0);
    // A capped check never holds a move (we only hold on a REAL verdict).
    expect(draftAnswerBlockStructured).toHaveBeenCalledTimes(1);
  });

  it("CACHE-FIRST: a fresh persisted serp_verdict is reused at $0 (no runSerp call)", async () => {
    const freshVerdict = JSON.stringify({
      verdict: "reject",
      confidence: "low",
      intent: "marketplace_ugc",
      contentDomainCount: 2,
      marketplaceUgcCount: 8,
      profoundOverlapCount: 0,
      ownAlreadyRanks: false,
      topDomains: ["amazon.com"],
      reason: "marketplace",
      generatedAt: "2026-07-06T00:00:00Z",
      costUsd: 0.003,
    });
    vi.mocked(getLatestMoveDrafts).mockResolvedValue(
      new Map([[`gap:persian-tea::serp_verdict`, { recId: "gap:persian-tea", kind: "serp_verdict", content: freshVerdict, createdAt: "2026-07-06T00:00:00Z" }]]) as never,
    );
    const runSerp = vi.fn(async () => serpResult("ok", CONTENT_SNAPSHOT, 0.003));
    const summary = await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T01:00:00Z"),
      runSerp: runSerp as never,
    });
    // Cached verdict served -> no live call, $0.
    expect(runSerp).not.toHaveBeenCalled();
    expect(summary.serpCostUsd).toBe(0);
    // The cached marketplace verdict still HOLDS the move.
    expect(summary.winnabilityHeld).toBe(1);
    expect(draftAnswerBlockStructured).not.toHaveBeenCalled();
  });

  it("never emits an em or en dash in the persisted winnability line (dash guard)", async () => {
    const runSerp = vi.fn(async () => serpResult("ok", MARKETPLACE_SNAPSHOT, 0.003));
    await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    const packCall = vi.mocked(saveMoveDraft).mock.calls.find((c) => c[2] === "prepared_pack");
    const persisted = parsePreparedPack(packCall?.[3] as string);
    expect(persisted?.winnabilityLine ?? "").not.toMatch(/[–—]/);
  });
});

describe("prepareTodayMovesForTenant - pilot loop 4 reference-candidate wiring", () => {
  it("threads the packet's OWN AI-cited competitor URLs into the answer-block drafter as referenceCandidates (zero new fetches)", async () => {
    const runSerp = vi.fn(async () => serpResult("ok", CONTENT_SNAPSHOT, 0.003));
    await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    expect(draftAnswerBlockStructured).toHaveBeenCalledTimes(1);
    const [input] = vi.mocked(draftAnswerBlockStructured).mock.calls[0]!;
    // packet() -> move() carries competitorUrls: ["https://competitor.com/tea"] -
    // buildEvidencePacket puts that at competitor.topUrl, no I/O performed here.
    expect((input as { referenceCandidates?: string[] }).referenceCandidates).toEqual(["https://competitor.com/tea"]);
  });

  it("renders an empty referenceCandidates array (never undefined/an error) when the packet has no competitor URL", async () => {
    vi.mocked(loadChangePacksForTenant).mockResolvedValue({
      packets: [packet({ competitorUrls: [] })],
    } as never);
    const runSerp = vi.fn(async () => serpResult("ok", CONTENT_SNAPSHOT, 0.003));
    await prepareTodayMovesForTenant("tenant-iranopedia", {
      now: () => new Date("2026-07-06T00:00:00Z"),
      runSerp: runSerp as never,
    });
    const [input] = vi.mocked(draftAnswerBlockStructured).mock.calls[0]!;
    expect((input as { referenceCandidates?: string[] }).referenceCandidates).toEqual([]);
  });
});
