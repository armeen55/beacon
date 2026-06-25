import { describe, it, expect } from "vitest";
import type { EvidencePacket, DraftSkeleton } from "./evidence-packet";
import type { GapKind, MoveComponents } from "./build-graph";
import type { CompetitorPageFacts } from "./competitor-page-audit";
import { routeMove } from "./move-router";
import {
  buildPreparedMovePack,
  derivePreparedStatus,
  isPackStale,
  toPersistedPack,
  parsePreparedPack,
} from "./prepared-move-pack";

const NOW = "2026-06-25T00:00:00.000Z";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});
const draft: DraftSkeleton = {
  kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [],
  answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "",
};

function packet(gapType: GapKind, over: { competitorFacts?: CompetitorPageFacts | null; label?: string } = {}): EvidencePacket {
  return {
    move: { key: "k1", gapType, label: over.label ?? "persian wedding traditions", confidence: "medium", score: 1000, components: components(), signals: ["GSC"] },
    demand: { demandWeight: 1000, basis: "gsc", queries: [], fanoutSeeds: ["what to wear", "how long"] },
    competitor: { topUrl: "https://theknot.com/x", domain: "theknot.com", fetchStatus: "ok", facts: over.competitorFacts ?? null, whatWins: "—", relevance: 0.8, looselyMatched: false, otherUrls: [] },
    yourPage: { url: gapType === "create_page" ? null : "https://iranopedia.com/wedding", facts: null, gsc: null, dollarValue: 0, friction: 0 },
    gaps: [],
    draft,
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash-A",
  };
}

const facts = (): CompetitorPageFacts => ({} as CompetitorPageFacts); // presence is all derivePreparedStatus checks

describe("buildPreparedMovePack", () => {
  it("assembles a compact pack from packet + opinions + decision", () => {
    const p = packet("answer_block", { competitorFacts: facts() });
    const decision = routeMove({ packet: p, opinions: [] });
    const pack = buildPreparedMovePack({ tenantId: "tenant-iranopedia", packet: p, opinions: [], decision, nowIso: NOW });

    expect(pack.tenantId).toBe("tenant-iranopedia");
    expect(pack.moveId).toBe("k1");
    expect(pack.moveType).toBe("answer_block");
    expect(pack.parentType).toBe("aeo_move");
    expect(pack.primaryQuery).toBe("persian wedding traditions");
    expect(pack.secondaryQueries).toEqual(["what to wear", "how long"]);
    expect(pack.evidenceHash).toBe("hash-A");
    expect(pack.structuredDraft).toBeNull(); // P4
    expect(pack.costSpent).toEqual({ llmUsd: 0, serpUsd: 0 });
    // competitor teardown present → competitors_read
    expect(pack.preparedStatus).toBe("competitors_read");
    // 14d default TTL
    expect(Date.parse(pack.staleAt) - Date.parse(NOW)).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("derives a slug for a create_page move and null targetUrl", () => {
    const p = packet("create_page", { label: "Persian Wedding Traditions" });
    const decision = routeMove({ packet: p, opinions: [] });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision, nowIso: NOW });
    expect(pack.targetUrl).toBeNull();
    expect(pack.proposedSlug).toBe("persian-wedding-traditions");
  });
});

describe("derivePreparedStatus — honest by construction", () => {
  const p = packet("edit_page"); // no competitor facts, no serp, no draft
  it("caps at demand_found with nothing attached", () => {
    expect(derivePreparedStatus({ packet: p, hasSerpVerdict: false, hasAiCheck: false, structuredDraft: null })).toBe("demand_found");
  });
  it("reports serp_checked when a SERP verdict is attached", () => {
    expect(derivePreparedStatus({ packet: p, hasSerpVerdict: true, hasAiCheck: false, structuredDraft: null })).toBe("serp_checked");
  });
  it("reports competitors_read when a teardown is present", () => {
    const withFacts = packet("edit_page", { competitorFacts: facts() });
    expect(derivePreparedStatus({ packet: withFacts, hasSerpVerdict: false, hasAiCheck: false, structuredDraft: null })).toBe("competitors_read");
  });
  it("reaches ready_to_review only once a structured draft exists (P4+)", () => {
    expect(derivePreparedStatus({ packet: p, hasSerpVerdict: true, hasAiCheck: true, structuredDraft: { kind: "answer_block" } })).toBe("ready_to_review");
  });
});

describe("isPackStale", () => {
  it("is stale when the evidence hash drifts", () => {
    const p = packet("edit_page");
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(isPackStale(pack, "hash-A", NOW)).toBe(false);
    expect(isPackStale(pack, "hash-DIFFERENT", NOW)).toBe(true);
  });
  it("is stale once the TTL has passed", () => {
    const p = packet("edit_page");
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(isPackStale(pack, "hash-A", "2026-08-01T00:00:00.000Z")).toBe(true);
  });
});

describe("toPersistedPack / parsePreparedPack round-trip", () => {
  it("survives a JSON round-trip and rejects garbage", () => {
    const p = packet("answer_block", { competitorFacts: facts() });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    const parsed = parsePreparedPack(toPersistedPack(pack));
    expect(parsed).not.toBeNull();
    expect(parsed!.moveId).toBe("k1");
    expect(parsed!.routerDecision.action).toBe("add_answer_block");
    expect(parsePreparedPack(null)).toBeNull();
    expect(parsePreparedPack("{not json")).toBeNull();
    expect(parsePreparedPack(JSON.stringify({ version: 2 }))).toBeNull();
  });
});
