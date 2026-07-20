import { describe, it, expect } from "vitest";
import type { EvidencePacket, DraftSkeleton, PageStructureFacts } from "./evidence-packet";
import { computeCopyBasisHash } from "./evidence-packet";
import type { GapKind, MoveComponents } from "./build-graph";
import type { CompetitorPageFacts } from "./competitor-page-audit";
import type { ResearchDossier } from "@/domains/research/research-dossier";
import { routeMove } from "./move-router";
import {
  buildPreparedMovePack,
  derivePreparedStatus,
  isPackStale,
  toPersistedPack,
  parsePreparedPack,
  indexReadyPacksByUrl,
  selectPersistedPackForRow,
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
    research: null,
    gaps: [],
    draft,
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "hash-A",
  };
}

const facts = (): CompetitorPageFacts => ({} as CompetitorPageFacts); // presence is all derivePreparedStatus checks

const research = (): ResearchDossier => ({
  tenantId: "tenant-iranopedia",
  moveKey: "k1",
  topic: "persian wedding traditions",
  targetUrl: "https://iranopedia.com/wedding",
  keywords: [{
    query: "persian wedding traditions",
    searchesPerMo: 1400,
    timesShownOnGoogle: 420,
    clicks: 12,
    yourPosition: 11.4,
    difficulty: 37,
    trend: null,
    ownerPage: "https://iranopedia.com/wedding",
    competitorOwners: ["theknot.com"],
    relatedQuestions: ["What happens at a Persian wedding?"],
    sources: ["gsc", "dataforseo_demand"],
    lastChecked: NOW,
  }],
  serpPatterns: [],
  questions: [{
    question: "Who pays for a Persian wedding?",
    sources: ["paa"],
    demandScore: 18,
    priority: 8,
    ownership: null,
    coverageStatus: "not_answered",
  }],
  ai: null,
  cloneBriefs: [],
  evidenceSources: ["gsc", "keyword_volume", "paa"],
  builtAt: NOW,
  evidenceHash: "research-A",
});

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

  it("persists the research receipt and uncovered questions into the prepared work", () => {
    const p = packet("answer_block", { competitorFacts: facts() });
    p.research = research();
    const decision = routeMove({ packet: p, opinions: [] });
    const pack = buildPreparedMovePack({ tenantId: "tenant-iranopedia", packet: p, opinions: [], decision, nowIso: NOW });

    expect(pack.secondaryQueries).toContain("Who pays for a Persian wedding?");
    expect(pack.researchSummary).toEqual({
      evidenceSources: ["gsc", "keyword_volume", "paa"],
      keywords: 1,
      serpPatterns: 0,
      questions: 1,
      cloneBriefs: 0,
      aiPrompts: 0,
      citedPages: 0,
    });
    expect(parsePreparedPack(toPersistedPack(pack))?.researchSummary).toEqual(pack.researchSummary);
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

describe("isPackStale — legacy packs (no copyBasisHash) fall back to evidenceHash", () => {
  it("is stale when the evidence hash drifts", () => {
    const p = packet("edit_page"); // fixture has no copyBasisHash → legacy path
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(pack.copyBasisHash).toBeUndefined();
    expect(isPackStale(pack, { evidenceHash: "hash-A" }, NOW)).toBe(false);
    expect(isPackStale(pack, { evidenceHash: "hash-DIFFERENT" }, NOW)).toBe(true);
  });
  it("is stale once the TTL has passed", () => {
    const p = packet("edit_page");
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(isPackStale(pack, { evidenceHash: "hash-A" }, "2026-08-01T00:00:00.000Z")).toBe(true);
  });
});

describe("isPackStale — two-tier copy-basis contract (new packs)", () => {
  const facts_ = (title: string | null): PageStructureFacts => ({
    title, metaDescription: null, h1: null, h2Count: 0, outline: [], schemaTypes: [], hasFaq: false, hasAnswerBlock: false, wordCount: 0,
  });
  // A pack whose copyBasisHash is computed from the owned title, edit_page action,
  // and primary query (the fixture's default label). Mirrors buildEvidencePacket.
  function packForTitle(title: string | null, nowIso = NOW): { pack: ReturnType<typeof buildPreparedMovePack> } {
    const p = packet("edit_page");
    p.yourPage.facts = facts_(title);
    p.copyBasisHash = computeCopyBasisHash({ ownedTitle: title, ownedH1: null, gapType: "edit_page", primaryQuery: p.move.label });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso });
    return { pack };
  }
  // The live build's current inputs: a fresh evidenceHash (drifts freely) plus a
  // copyBasisHash derived from the current title.
  const current = (title: string | null, evidenceHash = "evidence-live") => ({
    evidenceHash,
    copyBasisHash: computeCopyBasisHash({ ownedTitle: title, ownedH1: null, gapType: "edit_page", primaryQuery: "persian wedding traditions" }),
  });

  it("(b) stays FRESH when only volatile evidence changed (competitor facts / dossier / share drift)", () => {
    const { pack } = packForTitle("Persian Wedding Traditions");
    expect(pack.copyBasisHash).toBeDefined();
    // evidenceHash is wildly different (competitor teardown re-fetched, dossier
    // re-hashed) but the owned title, action, and source query are unchanged.
    expect(isPackStale(pack, current("Persian Wedding Traditions", "totally-different-evidence"), NOW)).toBe(false);
  });

  it("(c) goes STALE when the owned page title the edit was computed against changed", () => {
    const { pack } = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, current("Persian Wedding Traditions — Updated 2026"), NOW)).toBe(true);
  });

  it("goes STALE when the action type changed", () => {
    const { pack } = packForTitle("Persian Wedding Traditions");
    const currentDifferentAction = {
      evidenceHash: "evidence-live",
      copyBasisHash: computeCopyBasisHash({ ownedTitle: "Persian Wedding Traditions", ownedH1: null, gapType: "answer_block", primaryQuery: "persian wedding traditions" }),
    };
    expect(isPackStale(pack, currentDifferentAction, NOW)).toBe(true);
  });

  it("(d) a 15-day-old pack is stale regardless of matching hashes", () => {
    const { pack } = packForTitle("Persian Wedding Traditions");
    const fifteenDaysLater = new Date(Date.parse(NOW) + 15 * 24 * 60 * 60 * 1000).toISOString();
    // Copy basis is unchanged, but the age bound (14 days) fires anyway.
    expect(isPackStale(pack, current("Persian Wedding Traditions"), fifteenDaysLater)).toBe(true);
  });

  it("URL-fallback path (no live packet) keeps a fresh pack fresh under the age bound", () => {
    const { pack } = packForTitle("Persian Wedding Traditions");
    expect(isPackStale(pack, null, NOW)).toBe(false);
    const fifteenDaysLater = new Date(Date.parse(NOW) + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPackStale(pack, null, fifteenDaysLater)).toBe(true);
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

  it("G6: strips a source's transient fetchedText so the full page text never reaches a store", () => {
    const p = packet("answer_block", { competitorFacts: facts() });
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    // Simulate a generation-time draft that threaded the fetched full page text.
    const bigPage = "MUSEUM ".repeat(5000); // ~35 KB of "full page" text
    (pack as unknown as { structuredDraft: unknown }).structuredDraft = {
      kind: "answer_block",
      value: {
        answer: "A grounded roundup answer the operator can paste.",
        sources: [
          { url: "https://en.wikipedia.org/wiki/x", domain: "wikipedia.org", verified: true, supportingExcerpt: "MUSEUM MUSEUM", fetchedText: bigPage },
        ],
      },
    };
    const serialized = toPersistedPack(pack);
    expect(serialized).not.toContain("fetchedText");
    expect(serialized).not.toContain(bigPage);
    // The rest of the source (the persistable receipt) survives.
    expect(serialized).toContain("supportingExcerpt");
    const parsed = parsePreparedPack(serialized) as unknown as {
      structuredDraft: { value: { sources: Array<{ fetchedText?: string; supportingExcerpt?: string }> } };
    };
    expect(parsed.structuredDraft.value.sources[0]!.fetchedText).toBeUndefined();
    expect(parsed.structuredDraft.value.sources[0]!.supportingExcerpt).toBe("MUSEUM MUSEUM");
  });
});

describe("fallback join — indexReadyPacksByUrl / selectPersistedPackForRow", () => {
  const canonLower = (u: string | null | undefined): string => (u ?? "").toLowerCase();

  function readyPackFor(url: string) {
    const p = packet("answer_block", { competitorFacts: facts() });
    p.yourPage.url = url;
    const pack = buildPreparedMovePack({
      tenantId: "t",
      packet: p,
      opinions: [],
      decision: routeMove({ packet: p, opinions: [] }),
      nowIso: NOW,
      structuredDraft: { kind: "answer_block", value: { answer: "A grounded, paste-ready answer block." } },
    });
    expect(pack.preparedStatus).toBe("ready_to_review"); // draft + proof plan => ready
    return pack;
  }

  function notReadyPackFor(url: string) {
    const p = packet("answer_block", { competitorFacts: facts() });
    p.yourPage.url = url;
    const pack = buildPreparedMovePack({ tenantId: "t", packet: p, opinions: [], decision: routeMove({ packet: p, opinions: [] }), nowIso: NOW });
    expect(pack.preparedStatus).not.toBe("ready_to_review"); // no draft => competitors_read
    return pack;
  }

  it("indexes only ready_to_review prepared_pack rows, keyed by canonical target URL", () => {
    const rows = [
      { kind: "prepared_pack", content: toPersistedPack(readyPackFor("https://iranopedia.com/Famous-Iranian-Singers")) },
      { kind: "prepared_pack", content: toPersistedPack(notReadyPackFor("https://iranopedia.com/not-ready")) },
      { kind: "answer_block", content: toPersistedPack(readyPackFor("https://iranopedia.com/other")) }, // wrong kind
      { kind: "prepared_pack", content: "not json" }, // fail-soft
    ];
    const idx = indexReadyPacksByUrl(rows, canonLower);
    expect([...idx.keys()]).toEqual(["https://iranopedia.com/famous-iranian-singers"]);
    expect(idx.get("https://iranopedia.com/not-ready")).toBeUndefined();
  });

  it("(a) a row whose packet join MISSES surfaces its persisted ready draft by URL", () => {
    const url = "https://iranopedia.com/famous-iranian-singers";
    const readyByUrl = indexReadyPacksByUrl(
      [{ kind: "prepared_pack", content: toPersistedPack(readyPackFor(url)) }],
      canonLower,
    );
    // No packet emitted for this row → packetKeyedPack is null (the orphan case).
    const picked = selectPersistedPackForRow({ packetKeyedPack: null, readyByUrl, rowCanonUrl: url });
    expect(picked).not.toBeNull();
    expect(picked!.preparedStatus).toBe("ready_to_review");
    expect(canonLower(picked!.targetUrl)).toBe(url);
  });

  it("the packet-key match wins and the URL fallback is not consulted when a packet-keyed pack exists", () => {
    const url = "https://iranopedia.com/famous-iranian-singers";
    const packetKeyedPack = readyPackFor(url);
    const readyByUrl = indexReadyPacksByUrl(
      [{ kind: "prepared_pack", content: toPersistedPack(readyPackFor("https://iranopedia.com/somewhere-else")) }],
      canonLower,
    );
    const picked = selectPersistedPackForRow({ packetKeyedPack, readyByUrl, rowCanonUrl: url });
    expect(picked).toBe(packetKeyedPack);
  });

  it("(e) a draft for URL X can never attach to a row for URL Y", () => {
    const readyByUrl = indexReadyPacksByUrl(
      [{ kind: "prepared_pack", content: toPersistedPack(readyPackFor("https://iranopedia.com/url-x")) }],
      canonLower,
    );
    const picked = selectPersistedPackForRow({
      packetKeyedPack: null,
      readyByUrl,
      rowCanonUrl: "https://iranopedia.com/url-y",
    });
    expect(picked).toBeNull();
  });
});
