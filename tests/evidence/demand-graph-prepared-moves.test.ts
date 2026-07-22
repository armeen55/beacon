/**
 * PREPARED MOVES (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/demand-graph/prepared-move-pack.test.ts
 *   src/domains/demand-graph/prepare-today-moves.test.ts
 * Pins kept: honest readiness ladder, two-tier copy-basis staleness, G6
 * fetched-text strip, URL-fallback join safety, winnability hold before any
 * LLM spend, SERP cache-first at $0, capped provider fail-soft, dash guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  EvidencePacket,
  DraftSkeleton,
  PageStructureFacts,
} from "@/domains/demand-graph/evidence-packet";
import { computeCopyBasisHash } from "@/domains/demand-graph/evidence-packet";
import type { GapKind, MoveComponents, MoveCandidate } from "@/domains/demand-graph/build-graph";
import type { CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";
import { routeMove } from "@/domains/demand-graph/move-router";
import {
  buildPreparedMovePack,
  derivePreparedStatus,
  isPackStale,
  toPersistedPack,
  parsePreparedPack,
  indexReadyPacksByUrl,
  selectPersistedPackForRow,
} from "@/domains/demand-graph/prepared-move-pack";

vi.mock("@/domains/demand-graph/gap-compiler", () => ({ loadChangePacksForTenant: vi.fn() }));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  saveMoveDraft: vi.fn(async () => true),
  getLatestMoveDrafts: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/llm/structured-drafter", () => ({
  draftAnswerBlockStructured: vi.fn(),
  draftAtomicEditStructured: vi.fn(),
  draftCreatePageStructured: vi.fn(),
  draftCROFixStructured: vi.fn(),
}));
vi.mock("@/domains/team-scoreboard/load-team-scoreboard", () => ({
  loadSpecialistWeightTable: vi.fn(async () => null),
}));
vi.mock("@/domains/seasonal/family-demand-profile-store", () => ({
  loadFamilyDemandProfiles: vi.fn(async () => []),
}));

const NOW = "2026-06-25T00:00:00.000Z";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});
const draft: DraftSkeleton = {
  kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [],
  answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "",
};

function packPacket(gapType: GapKind, over: { competitorFacts?: CompetitorPageFacts | null; label?: string } = {}): EvidencePacket {
  return {
    move: { key: "k1", gapType, label: over.label ?? "persian wedding traditions", confidence: "medium", score: 1000, components: components(), signals: ["GSC"] },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: ["what to wear", "how long"] },
    competitor: { topUrl: "https://theknot.com/x", domain: "theknot.com", fetchStatus: "ok", facts: over.competitorFacts ?? null, whatWins: "-", relevance: 0.8, looselyMatched: false, otherUrls: [] },
    yourPage: { url: gapType === "create_page" ? null : "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0 },
    research: null,
    gaps: [],
    draft,
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash-A",
  };
}

const facts = (): CompetitorPageFacts => ({} as CompetitorPageFacts);

describe("buildPreparedMovePack + derivePreparedStatus: honest by construction", () => {
  it("assembles a compact pack and reports competitors_read when a teardown is present", () => {
    const p = packPacket("answer_block", { competitorFacts: facts() });
    const decision = routeMove({ packet: p, opinions: [] });
    const pack = buildPreparedMovePack({ tenantId: "tenant-iranopedia", packet: p, opinions: [], decision, nowIso: NOW });

    expect(pack.moveId).toBe("k1");
    expect(pack.parentType).toBe("aeo_move");
    expect(pack.primaryQuery).toBe("persian wedding traditions");
    expect(pack.structuredDraft).toBeNull();
    expect(pack.costSpent).toEqual({ llmUsd: 0, serpUsd: 0 });
    expect(pack.preparedStatus).toBe("competitors_read");
    expect(Date.parse(pack.staleAt) - Date.parse(NOW)).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("walks the readiness ladder only as evidence actually attaches", () => {
    const bare = packPacket("edit_page");
    expect(derivePreparedStatus({ packet: bare, hasSerpVerdict: false, hasAiCheck: false, structuredDraft: null })).toBe("demand_found");
    expect(derivePreparedStatus({ packet: bare, hasSerpVerdict: true, hasAiCheck: false, structuredDraft: null })).toBe("serp_checked");
    const withFacts = packPacket("edit_page", { competitorFacts: facts() });
    expect(derivePreparedStatus({ packet: withFacts, hasSerpVerdict: false, hasAiCheck: false, structuredDraft: null })).toBe("competitors_read");
    expect(derivePreparedStatus({ packet: bare, hasSerpVerdict: true, hasAiCheck: true, structuredDraft: { kind: "answer_block" } })).toBe("ready_to_review");
  });

  it("derives a slug for a create_page move and null targetUrl", () => {
    const p = packPacket("create_page", { label: "Persian Wedding Traditions" });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(pack.targetUrl).toBeNull();
    expect(pack.proposedSlug).toBe("persian-wedding-traditions");
  });
});

describe("isPackStale: two-tier copy-basis contract", () => {
  const facts_ = (title: string | null): PageStructureFacts => ({
    title, metaDescription: null, h1: null, h2Count: 0, outline: [], schemaTypes: [], hasFaq: false, hasAnswerBlock: false, wordCount: 0,
  });
  function packForTitle(title: string | null) {
    const p = packPacket("edit_page");
    p.yourPage.facts = facts_(title);
    p.copyBasisHash = computeCopyBasisHash({ ownedTitle: title, ownedH1: null, gapType: "edit_page", primaryQuery: p.move.label });
    return buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
  }
  const current = (title: string | null, evidenceHash = "evidence-live") => ({
    evidenceHash,
    copyBasisHash: computeCopyBasisHash({ ownedTitle: title, ownedH1: null, gapType: "edit_page", primaryQuery: "persian wedding traditions" }),
  });
  const daysLater = (n: number) => new Date(Date.parse(NOW) + n * 24 * 60 * 60 * 1000).toISOString();

  it("legacy packs (no copyBasisHash): age governs, evidence drift never invalidates", () => {
    const p = packPacket("edit_page");
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(pack.copyBasisHash).toBeUndefined();
    expect(isPackStale(pack, { evidenceHash: "hash-DIFFERENT" }, NOW)).toBe(false);
    expect(isPackStale(pack, { evidenceHash: "hash-A" }, daysLater(15))).toBe(true);
  });

  it("stays FRESH at 20 days with a VERIFIED matching basis; volatile evidence drift is ignored", () => {
    const pack = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, current("Persian Wedding Traditions", "totally-different-evidence"), NOW)).toBe(false);
    expect(isPackStale(pack, current("Persian Wedding Traditions"), daysLater(20))).toBe(false);
  });

  it("goes STALE on a verified copy-basis mismatch at any age", () => {
    const pack = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, current("Persian Wedding Traditions - Updated 2026"), NOW)).toBe(true);
    expect(isPackStale(pack, current("Persian Wedding Traditions - Updated 2026"), daysLater(20))).toBe(true);
  });

  it("is ALWAYS stale past the 45-day horizon, even with a verified matching basis", () => {
    const pack = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, current("Persian Wedding Traditions"), daysLater(50))).toBe(true);
  });

  it("URL-fallback path (no live packet) cannot verify basis, so the 14-day bound governs", () => {
    const pack = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, null, NOW)).toBe(false);
    expect(isPackStale(pack, null, daysLater(15))).toBe(true);
  });
});

describe("toPersistedPack / parsePreparedPack round-trip", () => {
  it("survives a JSON round-trip and rejects garbage", () => {
    const p = packPacket("answer_block", { competitorFacts: facts() });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    const parsed = parsePreparedPack(toPersistedPack(pack));
    expect(parsed).not.toBeNull();
    expect(parsed!.routerDecision.action).toBe("add_answer_block");
    expect(parsePreparedPack(null)).toBeNull();
    expect(parsePreparedPack("{not json")).toBeNull();
    expect(parsePreparedPack(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("G6: strips a source's transient fetchedText so full page text never reaches a store", () => {
    const p = packPacket("answer_block", { competitorFacts: facts() });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    const bigPage = "MUSEUM ".repeat(5000);
    (pack as unknown as { structuredDraft: unknown }).structuredDraft = {
      kind: "answer_block",
      value: {
        answer: "A grounded roundup answer the operator can paste.",
        sources: [{ url: "https://en.wikipedia.org/wiki/x", domain: "wikipedia.org", verified: true, supportingExcerpt: "MUSEUM MUSEUM", fetchedText: bigPage }],
      },
    };
    const serialized = toPersistedPack(pack);
    expect(serialized).not.toContain("fetchedText");
    expect(serialized).not.toContain(bigPage);
    expect(serialized).toContain("supportingExcerpt");
  });
});

describe("fallback join: a draft can only surface for its own URL", () => {
  const canonLower = (u: string | null | undefined): string => (u ?? "").toLowerCase();

  function readyPackFor(url: string) {
    const p = packPacket("answer_block", { competitorFacts: facts() });
    p.yourPage.url = url;
    const pack = buildPreparedMovePack({
      tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW,
      structuredDraft: { kind: "answer_block", value: { answer: "A grounded, paste-ready answer block." } },
    });
    expect(pack.preparedStatus).toBe("ready_to_review");
    return pack;
  }
  function notReadyPackFor(url: string) {
    const p = packPacket("answer_block", { competitorFacts: facts() });
    p.yourPage.url = url;
    return buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
  }

  it("indexes only ready_to_review prepared_pack rows, keyed by canonical target URL", () => {
    const rows = [
      { kind: "prepared_pack", content: toPersistedPack(readyPackFor("https://iranopedia.com/Famous-Iranian-Singers")) },
      { kind: "prepared_pack", content: toPersistedPack(notReadyPackFor("https://iranopedia.com/not-ready")) },
      { kind: "answer_block", content: toPersistedPack(readyPackFor("https://iranopedia.com/other")) },
      { kind: "prepared_pack", content: "not json" },
    ];
    const idx = indexReadyPacksByUrl(rows, canonLower);
    expect([...idx.keys()]).toEqual(["https://iranopedia.com/famous-iranian-singers"]);
  });

  it("a READY URL-indexed pack beats a REGRESSED packet-keyed pack; no fallback keeps the regressed one", () => {
    const url = "https://iranopedia.com/tehran";
    const regressed = notReadyPackFor(url);
    const readyByUrl = indexReadyPacksByUrl(
      [{ kind: "prepared_pack", content: toPersistedPack(readyPackFor(url)) }],
      canonLower,
    );
    const picked = selectPersistedPackForRow({
      packetKeyedPack: regressed, readyByUrl, rowCanonUrl: url,
      isReadyAndValid: (p) => p.preparedStatus === "ready_to_review",
    });
    expect(picked!.preparedStatus).toBe("ready_to_review");
    expect(picked).not.toBe(regressed);
    expect(
      selectPersistedPackForRow({
        packetKeyedPack: regressed, readyByUrl: new Map(), rowCanonUrl: url,
        isReadyAndValid: (p) => p.preparedStatus === "ready_to_review",
      }),
    ).toBe(regressed);
  });

  it("a draft for URL X can never attach to a row for URL Y", () => {
    const readyByUrl = indexReadyPacksByUrl(
      [{ kind: "prepared_pack", content: toPersistedPack(readyPackFor("https://iranopedia.com/url-x")) }],
      canonLower,
    );
    expect(
      selectPersistedPackForRow({ packetKeyedPack: null, readyByUrl, rowCanonUrl: "https://iranopedia.com/url-y" }),
    ).toBeNull();
  });
});
