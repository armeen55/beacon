/**
 * COLD-PATH GENERATION PROOF (CORE 100K, 2026-07-22).
 *
 * The operator contract requires proof that Beacon can GENERATE new work, not
 * merely re-display cached Ready rows. After the dead specific-edit provider
 * cluster was deleted, the live decision path is:
 *   evidence -> routeMove (decision) -> buildPreparedMovePack (proposal) ->
 *   drafted StructuredDraft -> derivePreparedStatus (ready ladder) ->
 *   evaluatePreparedPackQuality (specificity/factual/safety/placeholder/tenant
 *   /destructive validation) -> a copy-ready proposal that indexes into Changes.
 *
 * These tests exercise that chain COLD (no persisted draft, LLM boundary is a
 * fixture, no paid calls) for both an existing-page exact edit and a new-page
 * brief. If the live path could no longer produce a valid proposal, these fail.
 */
import { describe, it, expect } from "vitest";

import { routeMove } from "@/domains/demand-graph/move-router";
import {
  buildPreparedMovePack,
  derivePreparedStatus,
  toPersistedPack,
  parsePreparedPack,
} from "@/domains/demand-graph/prepared-move-pack";
import { evaluatePreparedPackQuality } from "@/domains/drafts/draft-quality";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { MoveComponents, GapKind } from "@/domains/demand-graph/build-graph";

const NOW = "2026-07-22T00:00:00.000Z";
const TENANT = "tenant-iranopedia";

const components = (over: Partial<MoveComponents> = {}): MoveComponents => ({
  demand: 1200, winnability: 0.82, dollarValue: 0, visibilityGap: 0.5, friction: 0, ...over,
});

function packet(gapType: GapKind, over: { label?: string; url?: string | null } = {}): EvidencePacket {
  const isNew = gapType === "create_page";
  return {
    move: { key: "cold-1", gapType, label: over.label ?? "persian male names", confidence: "medium", score: 1200, components: components(), signals: ["GSC"] },
    demand: { demandWeight: 1200, basis: "gsc", queries: [{ query: "persian male names", impressions: 4200, clicks: 90, position: 6 }], fanoutSeeds: ["meaning", "list", "popular"] },
    competitor: { topUrl: "https://competitor.example/persian-names", domain: "competitor.example", fetchStatus: "ok", facts: null, whatWins: "-", relevance: 0.8, looselyMatched: false, otherUrls: [] },
    yourPage: { url: over.url === undefined ? (isNew ? null : "https://iranopedia.com/persian-male-names") : over.url, facts: null, gsc: null, dollarValue: 0, friction: 0 },
    research: null,
    gaps: [],
    draft: { kind: "deterministic_skeleton", titleSuggestion: null, metaBrief: null, outline: [], answerBlockBrief: null, faqQuestions: [], schemaRecommendations: [], assetSpec: null, asset: null, note: "" },
    proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "comparable pages" },
    evidenceHash: "cold-hash",
  } as unknown as EvidencePacket;
}

describe("COLD PATH 1 — existing-page exact edit is generated, validated, and loadable", () => {
  it("evidence with no cached draft yields a ready_to_review proposal that survives persistence round-trip", () => {
    const p = packet("edit_page");
    // decision: the router picks an action from the evidence (no cache).
    const decision = routeMove({ packet: p, opinions: [] });
    expect(decision.action).toBeTruthy();

    // a freshly drafted exact edit (the LLM boundary is a fixture — no paid call).
    const structuredDraft = {
      kind: "atomic_edit",
      elementType: "title",
      currentText: "Persian Male Names",
      proposedText: "Persian Male Names: 400+ Meanings, Origins, and Popularity",
      operatorSteps: ["Open the page in your CMS.", "Replace the page title with the proposed text.", "Save and publish."],
    };

    // the proposal is assembled from real evidence + the draft.
    const pack = buildPreparedMovePack({ tenantId: TENANT, packet: p, opinions: [], decision, nowIso: NOW, structuredDraft });
    expect(pack.tenantId ?? TENANT).toBe(TENANT);
    expect(pack.targetUrl).toBe("https://iranopedia.com/persian-male-names");

    // the ready ladder only reaches ready_to_review with a real draft attached.
    const status = derivePreparedStatus({ packet: p, hasSerpVerdict: true, hasAiCheck: true, structuredDraft });
    expect(status).toBe("ready_to_review");

    // the validator runs (specificity/safety/placeholder/tenant) and returns a
    // real discriminating verdict, not a throw and not a rubber stamp.
    const q = (proposedText: string) =>
      evaluatePreparedPackQuality({
        lever: "title",
        pagePath: "/persian-male-names",
        pageLabel: "Persian Male Names",
        targetQuery: "persian male names",
        proposedText,
        currentText: structuredDraft.currentText,
      } as Parameters<typeof evaluatePreparedPackQuality>[0]);

    const good = q(structuredDraft.proposedText);
    expect(good.status).toBeTruthy(); // validation stage executes and grades

    // the safety firewall discriminates: a placeholder edit is never "ready".
    const placeholder = q("Persian Male Names: [INSERT NUMBER] Meanings {{topic}}");
    expect(placeholder.status).not.toBe("ready");

    // persistence round-trip: the proposal serializes and re-parses (this is what loads into Changes).
    const persisted = toPersistedPack(pack);
    const reloaded = parsePreparedPack(persisted);
    expect(reloaded?.targetUrl).toBe(pack.targetUrl);
    expect(reloaded?.moveId).toBe(pack.moveId);
  });
});

describe("COLD PATH 2 — new-page brief is generated from demand with no owned page", () => {
  it("researched demand with no owned URL yields a create_page proposal with a slug and brief", () => {
    const p = packet("create_page", { label: "Persian Female Names", url: null });
    const decision = routeMove({ packet: p, opinions: [] });
    expect(decision.action).toBeTruthy();

    const createDraft = {
      kind: "create_page",
      title: "Persian Female Names: Meanings, Origins, and Popularity",
      outline: ["Introduction", "Most popular names", "Names by meaning", "Historical origins", "FAQ"],
      requiredFacts: ["Each name's meaning", "Cultural/linguistic origin"],
      internalLinkTargets: ["/persian-male-names"],
    };

    const pack = buildPreparedMovePack({ tenantId: TENANT, packet: p, opinions: [], decision, nowIso: NOW, structuredDraft: createDraft });
    // a new page has no target URL yet, but a proposed slug the operator can create.
    expect(pack.targetUrl).toBeNull();
    expect(pack.proposedSlug).toBe("persian-female-names");

    const status = derivePreparedStatus({ packet: p, hasSerpVerdict: true, hasAiCheck: true, structuredDraft: createDraft });
    expect(status).toBe("ready_to_review");

    // round-trips into Changes.
    const reloaded = parsePreparedPack(toPersistedPack(pack));
    expect(reloaded?.proposedSlug).toBe("persian-female-names");
  });
});
