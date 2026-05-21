import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { PageInventoryEntry } from "./page-inventory";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
} from "./specific-edit-evidence";
import { ACTION_TYPES, ACTION_TYPE_REGISTRY } from "./action-types";
import { NEEDS_NEW_PAGE } from "./resolved-types";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 7 — Specific Edit Evidence Packet builder tests.
//
// Fixtures are neutral (no Ritz / Bay Area terms — uses generic dental /
// orthodontic vocabulary) so the no-Ritz-hardcoding invariant holds at
// the test layer too.
// ---------------------------------------------------------------------------

// ── Fixture builders ───────────────────────────────────────────────────────

function makePrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "acc-test",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: ["openai"],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-24T00:00:00Z",
  };
}

function makeOpportunity(
  promptId: string,
  overrides: Partial<PromptOpportunity> = {},
): PromptOpportunity {
  return {
    prompt_id: promptId,
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "Brand absent across 5 of 5 observations.",
    evidence: {
      observationCount: 5,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 4,
      avgCitationRank: null,
      dominantCompetitors: ["AcmeOrtho", "PrismDental"],
      answerStructureDistribution: { numbered_list: 4, paragraph: 1 },
      topDescriptors: ["board-certified", "ages 7+", "Invisalign"],
      byPlatform: [],
      lookbackDays: 7,
    },
    ...overrides,
  };
}

function makeSummary(
  promptId: string,
  overrides: Partial<PromptPrimarySummary> = {},
): PromptPrimarySummary {
  return {
    prompt_id: promptId,
    totalAnswers: 5,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [
      { name: "AcmeOrtho", primaryCount: 3, totalAnswers: 5 },
      { name: "PrismDental", primaryCount: 2, totalAnswers: 5 },
    ],
    fragmented: false,
    ...overrides,
  };
}

function makeInventoryEntry(
  url: string,
  overrides: Partial<PageInventoryEntry> = {},
): PageInventoryEntry {
  return {
    url,
    title: null,
    h1: null,
    metaDescription: null,
    h2s: [],
    routeType: "service",
    detectedGeo: null,
    detectedService: null,
    ...overrides,
  };
}

function makeElement(
  overrides: Partial<PageElementInventoryRow> = {},
): PageElementInventoryRow {
  return {
    id: "snap-1__title[0]:abc123def456",
    tenant_id: "tenant-test",
    page_id: "pg-1",
    url: "https://example.com/services/braces",
    element_type: "title",
    element_key: "title[0]:abc123def456",
    display_label: "Title: Braces",
    element_text: "Braces · Acme Orthodontics",
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-24T10:00:00Z",
    source_snapshot_id: "snap-1",
    ...overrides,
  };
}

const TENANT_ID = "tenant-test-acme";
const REC_ID = "rec-2026-04-24-abc";
const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");

function buildArgs(
  overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
): BuildSpecificEditEvidencePacketArgs {
  const promptId = "prompt-1";
  return {
    tenantId: TENANT_ID,
    recId: REC_ID,
    clusterLabel: "braces for teens",
    clusterKind: "topic",
    affectedPromptIds: [promptId],
    promptOpportunities: [makeOpportunity(promptId)],
    trackedPrompts: [makePrompt(promptId, "best orthodontist for teens braces")],
    primarySummaries: [makeSummary(promptId)],
    // Sprint 6A.2g.A — default to legacy null path so existing assertions
    // about candidate-set + sentinel keep firing. New target-alignment
    // tests below override this explicitly.
    singleTargetUrl: null,
    // Sprint 6A.2g.E — default to no observations so existing assertions
    // about affectedPrompts continue to pass with empty actualSearchQueries
    // / citedSourcePages / descriptorWindows. New tests override this.
    observations: [],
    ownedPageInventory: [
      makeInventoryEntry("https://example.com/services/braces", {
        title: "Braces · Acme Orthodontics",
        h1: "Braces for Teens",
        h2s: ["Treatment timeline", "Cost"],
        routeType: "service",
        detectedService: "braces",
      }),
      makeInventoryEntry("https://example.com/services/invisalign", {
        title: "Invisalign · Acme",
        h1: "Invisalign",
        h2s: ["Process"],
        routeType: "service",
        detectedService: "invisalign",
      }),
    ],
    pageElementInventory: [
      makeElement({
        url: "https://example.com/services/braces",
        element_type: "title",
        element_key: "title[0]:hash-aaa",
        display_label: "Title",
        element_text: "Braces · Acme Orthodontics",
      }),
      makeElement({
        url: "https://example.com/services/braces",
        element_type: "h1",
        element_key: "h1[0]:hash-bbb",
        display_label: "H1: Braces for Teens",
        element_text: "Braces for Teens",
      }),
      makeElement({
        url: "https://example.com/services/braces",
        element_type: "h2",
        element_key: "h2[0]:hash-ccc",
        display_label: 'H2: "Treatment timeline"',
        element_text: "Treatment timeline",
      }),
      // Element on a non-candidate URL — must NOT appear in packet.
      makeElement({
        url: "https://other-site.example/something",
        element_type: "h2",
        element_key: "h2[0]:hash-zzz",
        element_text: "Off-domain element",
      }),
    ],
    now: FROZEN_NOW,
    ...overrides,
  };
}

// ── Core build invariants ──────────────────────────────────────────────────

describe("Phase 6A.1.7 — buildSpecificEditEvidencePacket core invariants", () => {
  it("returns a packet with schemaVersion specific-edit/v1", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.schemaVersion).toBe("specific-edit/v1");
  });

  it("threads tenantId + recId from args to packet", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.tenantId).toBe(TENANT_ID);
    expect(packet.recId).toBe(REC_ID);
  });

  it("threads clusterLabel + clusterKind unchanged at top level", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ clusterLabel: "Burbank", clusterKind: "geo" }),
    );
    expect(packet.clusterLabel).toBe("Burbank");
    expect(packet.clusterKind).toBe("geo");
  });

  it("threads optional clusterId — defaults to null when not provided", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.clusterId).toBeNull();
  });

  it("threads optional clusterId from args when provided", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ clusterId: "cluster-geo-burbank-2026-04-24" }),
    );
    expect(packet.clusterId).toBe("cluster-geo-burbank-2026-04-24");
  });

  it("required fields are always present on the packet (tenantId, recId, hash, schemaVersion)", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.tenantId).toBeTruthy();
    expect(packet.recId).toBeTruthy();
    expect(packet.evidenceHash).toBeTruthy();
    expect(packet.schemaVersion).toBe("specific-edit/v1");
    // Cluster fields exist (may be null) — the keys must be present.
    expect("clusterId" in packet).toBe(true);
    expect("clusterLabel" in packet).toBe(true);
    expect("clusterKind" in packet).toBe(true);
  });

  it("emits generatedAt from the provided now", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.generatedAt).toBe(FROZEN_NOW.toISOString());
  });

  it("output is JSON-serializable + round-trips losslessly", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    const json = JSON.stringify(packet);
    const parsed = JSON.parse(json) as SpecificEditEvidencePacket;
    expect(parsed).toEqual(packet);
  });

  it("output contains no functions, no Date/Map/Set/class instances, no undefined values", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    const offenders: string[] = [];
    walk(packet, "$");
    expect(offenders).toEqual([]);

    function walk(value: unknown, path: string): void {
      if (value === null) return;
      if (value === undefined) {
        offenders.push(`${path}: undefined (not JSON-serializable)`);
        return;
      }
      const t = typeof value;
      if (t === "function") {
        offenders.push(`${path}: function`);
        return;
      }
      if (t === "string" || t === "number" || t === "boolean") return;
      if (t === "symbol" || t === "bigint") {
        offenders.push(`${path}: ${t}`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (t === "object") {
        // Plain objects only — anything with a non-Object prototype (Date,
        // Map, Set, Buffer, custom class instances, etc.) is rejected.
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          const ctor =
            (value as { constructor?: { name?: string } }).constructor?.name ??
            "unknown";
          offenders.push(`${path}: non-plain-object (${ctor})`);
          return;
        }
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(v, `${path}.${k}`);
        }
        return;
      }
    }
  });
});

// ── affectedPrompts ─────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — affectedPrompts", () => {
  it("emits one block per affectedPromptId", () => {
    const args = buildArgs({
      affectedPromptIds: ["prompt-1", "prompt-2"],
      trackedPrompts: [
        makePrompt("prompt-1", "first prompt text"),
        makePrompt("prompt-2", "second prompt text"),
      ],
      promptOpportunities: [
        makeOpportunity("prompt-1"),
        makeOpportunity("prompt-2", {
          evidence: {
            observationCount: 8,
            primaryCount: 0,
            citedCount: 0,
            mentionedCount: 0,
            absentCount: 8,
            avgCitationRank: null,
            dominantCompetitors: [],
            answerStructureDistribution: {},
            topDescriptors: [],
            byPlatform: [],
            lookbackDays: 7,
          },
        }),
      ],
      primarySummaries: [makeSummary("prompt-1"), makeSummary("prompt-2")],
    });
    const packet = buildSpecificEditEvidencePacket(args);
    expect(packet.affectedPrompts).toHaveLength(2);
    expect(packet.affectedPrompts[0].promptId).toBe("prompt-1");
    expect(packet.affectedPrompts[0].promptText).toBe("first prompt text");
    expect(packet.affectedPrompts[1].promptId).toBe("prompt-2");
    expect(packet.affectedPrompts[1].observationCount).toBe(8);
  });

  it("falls back to early category when opportunity is missing for a prompt", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        affectedPromptIds: ["unknown-prompt"],
        promptOpportunities: [],
        trackedPrompts: [],
        primarySummaries: [],
      }),
    );
    expect(packet.affectedPrompts).toHaveLength(1);
    expect(packet.affectedPrompts[0].category).toBe("early");
    expect(packet.affectedPrompts[0].promptText).toBe("unknown-prompt");
    expect(packet.affectedPrompts[0].observationCount).toBe(0);
  });

  it("computes topPrimaryCompetitor from primarySummary.primaryCompetitors[0]", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.affectedPrompts[0].topPrimaryCompetitor).toEqual({
      name: "AcmeOrtho",
      share: 0.6,
    });
  });

  it("topPrimaryCompetitor is null when no competitor primary observations exist", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        primarySummaries: [
          makeSummary("prompt-1", {
            primaryCompetitors: [],
            ritzPrimaryShare: 0.8,
            ritzState: "primary",
            ritzPrimaryCount: 4,
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].topPrimaryCompetitor).toBeNull();
  });

  it("descriptorsNearBrand caps at 6 per prompt", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        promptOpportunities: [
          makeOpportunity("prompt-1", {
            evidence: {
              observationCount: 5,
              primaryCount: 0,
              citedCount: 1,
              mentionedCount: 1,
              absentCount: 4,
              avgCitationRank: null,
              dominantCompetitors: [],
              answerStructureDistribution: {},
              topDescriptors: ["a", "b", "c", "d", "e", "f", "g", "h"],
              byPlatform: [],
              lookbackDays: 7,
            },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].descriptorsNearBrand).toEqual([
      "a", "b", "c", "d", "e", "f",
    ]);
  });
});

// ── ownedPageCandidates ─────────────────────────────────────────────────────

describe("Phase 6A.1.7 — ownedPageCandidates", () => {
  it("emits matched owned pages with score + reasons", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.ownedPageCandidates.length).toBeGreaterThan(0);
    const top = packet.ownedPageCandidates[0];
    expect(top.url.startsWith("https://example.com/")).toBe(true);
    expect(typeof top.matchScore).toBe("number");
    expect(top.matchReasons.length).toBeGreaterThan(0);
  });

  it("returns [] when ownedPageInventory is empty (no crash)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ ownedPageInventory: [] }),
    );
    expect(packet.ownedPageCandidates).toEqual([]);
  });

  it("returns [] when clusterLabel is null and no affected prompt provides text", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        clusterLabel: null,
        clusterKind: null,
        affectedPromptIds: [],
      }),
    );
    expect(packet.ownedPageCandidates).toEqual([]);
  });

  it("falls back to first affected prompt's text when clusterLabel is null", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        clusterLabel: null,
        clusterKind: null,
      }),
    );
    // Should still match the braces-related inventory page off the prompt
    // text "best orthodontist for teens braces".
    expect(packet.ownedPageCandidates.length).toBeGreaterThan(0);
  });

  it("respects maxCandidatePages cap", () => {
    const inventory: PageInventoryEntry[] = [];
    for (let i = 0; i < 20; i++) {
      inventory.push(
        makeInventoryEntry(`https://example.com/services/braces-${i}`, {
          title: `Braces page ${i}`,
          h1: "Braces for Teens",
          h2s: [],
          detectedService: "braces",
        }),
      );
    }
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        ownedPageInventory: inventory,
        maxCandidatePages: 3,
      }),
    );
    expect(packet.ownedPageCandidates.length).toBeLessThanOrEqual(3);
  });
});

// ── targetPageElements ──────────────────────────────────────────────────────

describe("Phase 6A.1.7 — targetPageElements", () => {
  it("includes element_key + display_label + element_text for every row", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.targetPageElements.length).toBeGreaterThan(0);
    for (const el of packet.targetPageElements) {
      expect(el.elementKey).toBeTruthy();
      expect(el.displayLabel).toBeTruthy();
      // elementText can legitimately be null (e.g. canonical link without
      // a value) but the key MUST exist on the row.
      expect("elementText" in el).toBe(true);
    }
  });

  it("filters elements to candidate URLs only (off-domain rows excluded)", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    const urls = new Set(packet.targetPageElements.map((e) => e.url));
    const candidateUrls = new Set(
      packet.ownedPageCandidates.map((c) => c.url),
    );
    for (const u of urls) {
      expect(candidateUrls.has(u)).toBe(true);
    }
    expect(urls.has("https://other-site.example/something")).toBe(false);
  });

  it("dedupes to the latest observed_at per (url, element_key)", () => {
    const args = buildArgs({
      pageElementInventory: [
        makeElement({
          url: "https://example.com/services/braces",
          element_key: "h1[0]:hash-bbb",
          display_label: "OLD",
          element_text: "Old H1",
          observed_at: "2026-04-20T10:00:00Z",
          source_snapshot_id: "snap-old",
        }),
        makeElement({
          url: "https://example.com/services/braces",
          element_key: "h1[0]:hash-bbb",
          display_label: "NEW",
          element_text: "New H1",
          observed_at: "2026-04-24T10:00:00Z",
          source_snapshot_id: "snap-new",
        }),
      ],
    });
    const packet = buildSpecificEditEvidencePacket(args);
    const h1Rows = packet.targetPageElements.filter(
      (e) => e.elementKey === "h1[0]:hash-bbb",
    );
    expect(h1Rows).toHaveLength(1);
    expect(h1Rows[0].displayLabel).toBe("NEW");
    expect(h1Rows[0].elementText).toBe("New H1");
  });

  it("returns [] when pageElementInventory is empty (no crash)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ pageElementInventory: [] }),
    );
    expect(packet.targetPageElements).toEqual([]);
  });

  it("returns [] when no owned candidate matches (graceful empty)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ ownedPageInventory: [] }),
    );
    expect(packet.targetPageElements).toEqual([]);
  });

  it("respects maxTargetElements cap", () => {
    const elements: PageElementInventoryRow[] = [];
    for (let i = 0; i < 50; i++) {
      elements.push(
        makeElement({
          url: "https://example.com/services/braces",
          element_type: "h2",
          element_key: `h2[${i}]:hash-${i}`,
          display_label: `H2 ${i}`,
          element_text: `H2 text ${i}`,
        }),
      );
    }
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        pageElementInventory: elements,
        maxTargetElements: 5,
      }),
    );
    expect(packet.targetPageElements.length).toBeLessThanOrEqual(5);
  });
});

// ── allowedTargetUrls ───────────────────────────────────────────────────────

describe("Phase 6A.1.7 — allowedTargetUrls", () => {
  it("only includes owned URLs (from ownedPageCandidates) + the needs_new_page sentinel", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    const candidateUrls = new Set(packet.ownedPageCandidates.map((c) => c.url));
    for (const url of packet.allowedTargetUrls) {
      if (url === NEEDS_NEW_PAGE) continue;
      expect(candidateUrls.has(url)).toBe(true);
    }
  });

  it("always contains the needs_new_page sentinel", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedTargetUrls).toContain(NEEDS_NEW_PAGE);
  });

  it("excludes off-domain URLs even if elements for them appear in pageElementInventory", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedTargetUrls).not.toContain(
      "https://other-site.example/something",
    );
  });

  it("returns just the sentinel when no owned candidates exist", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ ownedPageInventory: [] }),
    );
    expect(packet.allowedTargetUrls).toEqual([NEEDS_NEW_PAGE]);
  });
});

// ── Sprint 6A.2g.A — strict target alignment ───────────────────────────────

describe("Sprint 6A.2g.A — buildAllowedTargetUrls strict target alignment", () => {
  it("real singleTargetUrl + content actions → exactly [singleTargetUrl] (no sentinel)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    expect(packet.allowedTargetUrls).toEqual([
      "https://example.com/services/braces",
    ]);
    expect(packet.allowedTargetUrls).not.toContain(NEEDS_NEW_PAGE);
  });

  it("real singleTargetUrl + content actions → list does NOT include sibling owned candidates", () => {
    // The default fixture's cluster matcher would otherwise pull
    // /services/invisalign as a candidate; under strict alignment the
    // model must not see it.
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    expect(packet.allowedTargetUrls).not.toContain(
      "https://example.com/services/invisalign",
    );
  });

  it("singleTargetUrl === NEEDS_NEW_PAGE → [NEEDS_NEW_PAGE] only", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ singleTargetUrl: NEEDS_NEW_PAGE }),
    );
    expect(packet.allowedTargetUrls).toEqual([NEEDS_NEW_PAGE]);
  });

  it("real singleTargetUrl + only page-level actions → [NEEDS_NEW_PAGE] only", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
        // Page-level lifecycle actions only — every elementTypeDomain
        // is empty per ACTION_TYPE_REGISTRY.
        allowedActionTypes: ["split_page", "merge_pages", "create_page"],
      }),
    );
    expect(packet.allowedTargetUrls).toEqual([NEEDS_NEW_PAGE]);
  });

  it("real singleTargetUrl + mixed page-level AND content actions → [singleTargetUrl] (one content action triggers anchor)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
        // create_page is page-level; edit_title is content-level. Mixed
        // means at least one content action exists, so we anchor.
        allowedActionTypes: ["create_page", "edit_title"],
      }),
    );
    expect(packet.allowedTargetUrls).toEqual([
      "https://example.com/services/braces",
    ]);
  });

  it("legacy null singleTargetUrl path preserves the pre-6A.2g candidate-set + sentinel shape", () => {
    // Default `buildArgs` already supplies `singleTargetUrl: null`.
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedTargetUrls).toContain(NEEDS_NEW_PAGE);
    // At least one owned candidate URL ends up in the list (the default
    // fixture matches /services/braces).
    const ownedInList = packet.allowedTargetUrls.filter(
      (u) => u !== NEEDS_NEW_PAGE,
    );
    expect(ownedInList.length).toBeGreaterThan(0);
  });

  it("evidenceHash differs between strict-anchor and legacy-null paths for the same fixture", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("evidenceHash is deterministic across two builds with identical strict-anchor args", () => {
    const a = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("strict-anchor list is length 1 when targetUrl is real (operator-locked invariant)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        singleTargetUrl: "https://example.com/services/braces",
      }),
    );
    expect(packet.allowedTargetUrls).toHaveLength(1);
  });

  it("strict-anchor list is length 1 when targetUrl is the sentinel (operator-locked invariant)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ singleTargetUrl: NEEDS_NEW_PAGE }),
    );
    expect(packet.allowedTargetUrls).toHaveLength(1);
  });
});

// ── allowedActionTypes ──────────────────────────────────────────────────────

describe("Phase 6A.1.7 — allowedActionTypes", () => {
  it("defaults to the v1 active set from ACTION_TYPE_REGISTRY", () => {
    const expected = ACTION_TYPES.filter(
      (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
    ).sort();
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedActionTypes).toEqual(expected);
  });

  it("defaults are exactly the 13-type active set (sorted) — post-Slice 4.5.E.α₁a", () => {
    // Slice 4.5.B.α₀ (2026-05-19): `edit_meta` flipped paired with
    // the `missing-meta` trigger predicate.
    // Slice 4.5.B.α₁ (2026-05-19): `change_h1` flipped paired with
    // `missing-h1` + `weak-h1` + `title-h1-mismatch` predicates.
    // α₂ adds no flips.
    // Slice 4.5.C.α₁ (2026-05-20): 4 Tier-1 indexability flips —
    // `fix_sitemap`, `fix_robots`, `fix_status_code`, `fix_canonical`.
    // Slice 4.5.C.α₂ (2026-05-20): 1 Tier-2 sensitive flip —
    // `fix_noindex` (paired with `noindex-on-indexable-page`
    // predicate at confidence: low; routes to diagnostic_only).
    // Slice 4.5.C.α₃a (2026-05-20): `add_internal_link` flipped
    // paired with the cross-snapshot `orphan-page` predicate
    // at confidence: medium (main candidates section).
    // Slice 4.5.C.α₃b (2026-05-20): `add_schema` flipped paired
    // with the per-snapshot `missing-schema` predicate at
    // confidence: low (routes to diagnostic_only).
    // Slice 4.5.E.α₁a (2026-05-21): `rewrite_h2` flipped paired
    // with the new `weak-h2` predicate at confidence: low
    // (routes to diagnostic_only via applyQueueRules). First
    // LLM-assisted activation though the gateway is NOT invoked
    // in α₁a — gateway wire-up lands in α₁b.
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedActionTypes.sort()).toEqual(
      [
        "add_faq",
        "add_h2_section",
        "add_internal_link",
        "add_schema",
        "change_h1",
        "edit_meta",
        "edit_title",
        "fix_canonical",
        "fix_noindex",
        "fix_robots",
        "fix_sitemap",
        "fix_status_code",
        "rewrite_h2",
      ].sort(),
    );
  });

  it("respects caller override + dedupes + sorts for hash stability", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        allowedActionTypes: [
          "add_h2_section",
          "edit_title",
          "edit_title", // duplicate intentionally
        ],
      }),
    );
    expect(packet.allowedActionTypes).toEqual(["add_h2_section", "edit_title"]);
  });
});

// ── competitorAngles ────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — competitorAngles", () => {
  it("aggregates competitors across affected prompts", () => {
    const args = buildArgs({
      affectedPromptIds: ["prompt-1", "prompt-2"],
      trackedPrompts: [
        makePrompt("prompt-1", "p1"),
        makePrompt("prompt-2", "p2"),
      ],
      promptOpportunities: [
        makeOpportunity("prompt-1"),
        makeOpportunity("prompt-2"),
      ],
      primarySummaries: [
        makeSummary("prompt-1", {
          primaryCompetitors: [
            { name: "AcmeOrtho", primaryCount: 3, totalAnswers: 5 },
          ],
        }),
        makeSummary("prompt-2", {
          primaryCompetitors: [
            { name: "AcmeOrtho", primaryCount: 2, totalAnswers: 4 },
            { name: "PrismDental", primaryCount: 1, totalAnswers: 4 },
          ],
        }),
      ],
    });
    const packet = buildSpecificEditEvidencePacket(args);
    const acme = packet.competitorAngles.find(
      (c) => c.competitorName === "AcmeOrtho",
    );
    expect(acme).toBeDefined();
    expect(acme!.promptsWherePrimary).toBe(2);
    expect(acme!.totalPrimaryObservations).toBe(5);
    expect(acme!.totalAffectedPrompts).toBe(2);
  });

  it("returns [] when no primarySummaries are provided (graceful empty)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ primarySummaries: [] }),
    );
    expect(packet.competitorAngles).toEqual([]);
  });

  it("returns [] when affectedPromptIds is empty (no crash)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ affectedPromptIds: [] }),
    );
    expect(packet.competitorAngles).toEqual([]);
  });

  it("orders by promptsWherePrimary desc, then totalPrimaryObservations desc, then name", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.competitorAngles).toEqual([
      {
        competitorName: "AcmeOrtho",
        promptsWherePrimary: 1,
        totalAffectedPrompts: 1,
        totalPrimaryObservations: 3,
      },
      {
        competitorName: "PrismDental",
        promptsWherePrimary: 1,
        totalAffectedPrompts: 1,
        totalPrimaryObservations: 2,
      },
    ]);
  });
});

// ── priorOutcomes ──────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — priorOutcomes", () => {
  it("defaults to []", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.priorOutcomes).toEqual([]);
  });

  it("does not crash when priorOutcomes is omitted entirely", () => {
    const args = buildArgs();
    delete (args as { priorOutcomes?: unknown }).priorOutcomes;
    const packet = buildSpecificEditEvidencePacket(args);
    expect(packet.priorOutcomes).toEqual([]);
  });

  it("passes through provided rows sorted by actionType for hash stability", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        priorOutcomes: [
          { actionType: "edit_title", sampleSize: 4, positiveOutcomeRate: 0.5 },
          { actionType: "add_faq", sampleSize: 6, positiveOutcomeRate: 0.83 },
        ],
      }),
    );
    expect(packet.priorOutcomes.map((p) => p.actionType)).toEqual([
      "add_faq",
      "edit_title",
    ]);
  });
});

// ── evidenceHash ────────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — evidenceHash", () => {
  it("is a non-empty hex string", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.evidenceHash).toMatch(/^[0-9a-f]+$/);
    expect(packet.evidenceHash.length).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic — same inputs produce same hash", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(buildArgs());
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("changes when tenantId changes", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ tenantId: "tenant-other" }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when recId changes", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ recId: "rec-other" }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when clusterLabel changes", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ clusterLabel: "different cluster", clusterKind: "topic" }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when clusterId changes (null → set)", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ clusterId: "cluster-XYZ" }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when affectedPromptIds change", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        affectedPromptIds: ["prompt-1", "prompt-2"],
        trackedPrompts: [
          makePrompt("prompt-1", "p1"),
          makePrompt("prompt-2", "p2"),
        ],
        promptOpportunities: [
          makeOpportunity("prompt-1"),
          makeOpportunity("prompt-2"),
        ],
        primarySummaries: [makeSummary("prompt-1"), makeSummary("prompt-2")],
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when targetPageElements content changes (element_text edited)", () => {
    const baseElements = buildArgs().pageElementInventory;
    const editedElements = baseElements.map((r) =>
      r.element_key === "h1[0]:hash-bbb"
        ? { ...r, element_text: "TOTALLY NEW H1" }
        : r,
    );
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ pageElementInventory: editedElements }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when ownedPageCandidates set changes", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const extraInventory: PageInventoryEntry[] = [
      ...buildArgs().ownedPageInventory,
      makeInventoryEntry("https://example.com/services/expanders", {
        title: "Expanders",
        h1: "Palatal Expanders",
        h2s: ["When", "How"],
        detectedService: "expander",
        routeType: "service",
      }),
    ];
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        clusterLabel: "palatal expander",
        clusterKind: "topic",
        ownedPageInventory: extraInventory,
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changes when allowedActionTypes changes", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ allowedActionTypes: ["edit_title"] }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("does NOT depend on the input array order of allowedActionTypes (sorted before hashing)", () => {
    const a = buildSpecificEditEvidencePacket(
      buildArgs({
        allowedActionTypes: ["edit_title", "add_h2_section", "add_faq"],
      }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        allowedActionTypes: ["add_faq", "add_h2_section", "edit_title"],
      }),
    );
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });
});

// ── Empty-input resilience ──────────────────────────────────────────────────

describe("Phase 6A.1.7 — empty-input resilience", () => {
  it("builds a valid packet when ALL evidence dimensions are empty", () => {
    const packet = buildSpecificEditEvidencePacket({
      tenantId: TENANT_ID,
      recId: REC_ID,
      clusterLabel: null,
      clusterKind: null,
      affectedPromptIds: [],
      promptOpportunities: [],
      trackedPrompts: [],
      primarySummaries: [],
      ownedPageInventory: [],
      pageElementInventory: [],
      observations: [],
      singleTargetUrl: null,
      now: FROZEN_NOW,
    });
    expect(packet.affectedPrompts).toEqual([]);
    expect(packet.ownedPageCandidates).toEqual([]);
    expect(packet.targetPageElements).toEqual([]);
    expect(packet.competitorAngles).toEqual([]);
    expect(packet.priorOutcomes).toEqual([]);
    expect(packet.allowedTargetUrls).toEqual([NEEDS_NEW_PAGE]);
    expect(packet.allowedActionTypes.length).toBeGreaterThan(0);
    expect(packet.evidenceHash).toBeTruthy();
    // Round-trip through JSON to confirm serializability.
    expect(() => JSON.parse(JSON.stringify(packet))).not.toThrow();
  });

  it("builds a valid packet when tenantId is empty string (legacy behavior, but warns at the type level only)", () => {
    // Hard rule: tenantId is REQUIRED. The type system enforces "string"
    // — empty string is technically a string. The packet still builds;
    // downstream validation (Sprint 7 multi-tenant) will reject empty.
    // Phase 7 only asserts the field is present, not non-empty.
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ tenantId: "" }),
    );
    expect(packet.tenantId).toBe("");
    expect(typeof packet.evidenceHash).toBe("string");
  });

  it("requires recId but accepts any string at the type level (downstream enforces shape)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ recId: "rec-7" }),
    );
    expect(packet.recId).toBe("rec-7");
  });
});

// ── Sprint 6A.2g.E — affectedPrompts evidence enrichment ──────────────────

function makeObservation(
  promptId: string,
  overrides: Partial<PromptAnswerObservation> = {},
): PromptAnswerObservation {
  return {
    id: `obs-${promptId}-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: promptId,
    run_id: "run-test",
    answer_hash: "deadbeefdeadbeef",
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-04-26T10:00:00Z",
    platform: "chatgpt",
    topic: "",
    metadata: {},
    tenant_id: "tenant-test-acme",
    citation_urls: [],
    descriptor_window: [],
    ...overrides,
  };
}

describe("Sprint 6A.2g.E — affectedPrompts evidence enrichment (actualSearchQueries / citedSourcePages / descriptorWindows)", () => {
  const PROMPT = "prompt-1";

  it("populates actualSearchQueries from observation.metadata.extracted.searchQueries", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: {
              extracted: {
                searchQueries: ["query alpha", "query beta"],
              },
            },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([
      "query alpha",
      "query beta",
    ]);
  });

  it("populates citedSourcePages from observation.citation_urls", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: [
              "https://example.com/a",
              "https://example.com/b",
            ],
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("populates descriptorWindows from observation.descriptor_window", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            descriptor_window: ["award-winning", "design-build"],
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual([
      "award-winning",
      "design-build",
    ]);
  });

  it("caps actualSearchQueries at 10 per prompt", () => {
    const queries = Array.from({ length: 15 }, (_, i) => `q-${i}`);
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: { extracted: { searchQueries: queries } },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toHaveLength(10);
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual(
      queries.slice(0, 10),
    );
  });

  it("caps citedSourcePages at 10 per prompt", () => {
    const urls = Array.from({ length: 15 }, (_, i) => `https://x.com/${i}`);
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [makeObservation(PROMPT, { citation_urls: urls })],
      }),
    );
    expect(packet.affectedPrompts[0].citedSourcePages).toHaveLength(10);
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual(
      urls.slice(0, 10),
    );
  });

  it("caps descriptorWindows at 5 per prompt", () => {
    const windows = Array.from({ length: 8 }, (_, i) => `desc-${i}`);
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, { descriptor_window: windows }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].descriptorWindows).toHaveLength(5);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual(
      windows.slice(0, 5),
    );
  });

  it("dedupes exact-string repeats across observations (first-seen wins)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            id: "obs-1",
            observed_at: "2026-04-26T10:00:00Z",
            metadata: { extracted: { searchQueries: ["alpha", "beta"] } },
            citation_urls: ["https://x.com/p"],
            descriptor_window: ["fast"],
          }),
          makeObservation(PROMPT, {
            id: "obs-2",
            observed_at: "2026-04-26T11:00:00Z",
            metadata: {
              extracted: { searchQueries: ["beta", "gamma"] }, // beta dup
            },
            citation_urls: ["https://x.com/p", "https://x.com/q"], // dup
            descriptor_window: ["fast", "modern"], // dup
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([
      "https://x.com/p",
      "https://x.com/q",
    ]);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual([
      "fast",
      "modern",
    ]);
  });

  it("pre-Phase-D observations (no metadata.extracted) → empty actualSearchQueries gracefully", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: {
              source_system: "beacon_native",
              model: "gpt-4o",
              // No `extracted` key — legacy shape from pre-Phase-D rows.
            },
            citation_urls: ["https://legacy.com/cited"],
            descriptor_window: ["legacy"],
          }),
        ],
      }),
    );
    // Phase-D-only field: empty.
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([]);
    // citation_urls + descriptor_window predate Phase D and ARE populated
    // on legacy rows by Schema v2.1 extraction — those still flow through.
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([
      "https://legacy.com/cited",
    ]);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual(["legacy"]);
  });

  it("malformed metadata.extracted (non-object) → empty actualSearchQueries gracefully (no crash)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            // Adversarial shape — extracted is a string, not an object.
            metadata: { extracted: "garbage" as unknown as object },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([]);
  });

  it("non-string entries inside searchQueries are skipped (no crash, no fake values)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: {
              extracted: {
                searchQueries: [
                  "valid",
                  null as unknown as string,
                  42 as unknown as string,
                  "",
                  "another valid",
                ],
              },
            },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([
      "valid",
      "another valid",
    ]);
  });

  it("empty observations → all 3 arrays empty, no crash", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ observations: [] }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([]);
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([]);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual([]);
  });

  it("ignores observations whose prompt_id doesn't match any affectedPromptIds", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        affectedPromptIds: ["prompt-1"],
        observations: [
          makeObservation("prompt-1", {
            metadata: { extracted: { searchQueries: ["mine"] } },
          }),
          makeObservation("other-prompt", {
            metadata: { extracted: { searchQueries: ["theirs"] } },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual(["mine"]);
  });

  it("aggregates across multiple observations of the same prompt — order = (observed_at, id) ascending", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          // Pass in reverse chronological order — builder must sort.
          makeObservation(PROMPT, {
            id: "obs-c",
            observed_at: "2026-04-26T12:00:00Z",
            metadata: { extracted: { searchQueries: ["latest"] } },
          }),
          makeObservation(PROMPT, {
            id: "obs-b",
            observed_at: "2026-04-26T11:00:00Z",
            metadata: { extracted: { searchQueries: ["middle"] } },
          }),
          makeObservation(PROMPT, {
            id: "obs-a",
            observed_at: "2026-04-26T10:00:00Z",
            metadata: { extracted: { searchQueries: ["earliest"] } },
          }),
        ],
      }),
    );
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([
      "earliest",
      "middle",
      "latest",
    ]);
  });

  it("evidenceHash is deterministic across two builds with identical observations", () => {
    const args = buildArgs({
      observations: [
        makeObservation(PROMPT, {
          id: "obs-stable",
          observed_at: "2026-04-26T10:00:00Z",
          metadata: { extracted: { searchQueries: ["a", "b"] } },
          citation_urls: ["https://x.com"],
          descriptor_window: ["d"],
        }),
      ],
    });
    const a = buildSpecificEditEvidencePacket(args);
    const b = buildSpecificEditEvidencePacket(args);
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("evidenceHash is deterministic regardless of caller observation order (builder sorts internally)", () => {
    const o1 = makeObservation(PROMPT, {
      id: "obs-a",
      observed_at: "2026-04-26T10:00:00Z",
      metadata: { extracted: { searchQueries: ["a"] } },
    });
    const o2 = makeObservation(PROMPT, {
      id: "obs-b",
      observed_at: "2026-04-26T11:00:00Z",
      metadata: { extracted: { searchQueries: ["b"] } },
    });
    const a = buildSpecificEditEvidencePacket(
      buildArgs({ observations: [o1, o2] }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({ observations: [o2, o1] }),
    );
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("evidenceHash changes when actualSearchQueries content changes", () => {
    const a = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: { extracted: { searchQueries: ["one"] } },
          }),
        ],
      }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation(PROMPT, {
            metadata: { extracted: { searchQueries: ["different"] } },
          }),
        ],
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });
});

// ── No route-render generation guarantee ──────────────────────────────────

function walkSync(dir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && predicate(full)) out.push(full);
    }
  }
  return out;
}

describe("Phase 6A.1.7 — packet builder never runs on render", () => {
  it("buildSpecificEditEvidencePacket is NOT imported from any route page.tsx or route.ts", () => {
    const appDir = resolve(__dirname, "../../app");
    const matches = walkSync(
      appDir,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /\bbuildSpecificEditEvidencePacket\b/.test(src) ||
        /from\s+["'][^"']*recommendations\/specific-edit-evidence["']/.test(
          src,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── W3 Step 3.2 — Recommendation Engine v2 evidence packet foundation ─────

describe("W3 Step 3.2 — aiSearchSignal aggregation", () => {
  const PROMPT_A = "prompt-a";
  const PROMPT_B = "prompt-b";

  function buildSearchSignalArgs(
    overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
  ): BuildSpecificEditEvidencePacketArgs {
    return buildArgs({
      affectedPromptIds: [PROMPT_A, PROMPT_B],
      promptOpportunities: [makeOpportunity(PROMPT_A), makeOpportunity(PROMPT_B)],
      trackedPrompts: [
        makePrompt(PROMPT_A, "best teen braces atherton"),
        makePrompt(PROMPT_B, "kitchen remodel cost atherton"),
      ],
      primarySummaries: [makeSummary(PROMPT_A), makeSummary(PROMPT_B)],
      ...overrides,
    });
  }

  it("dedupes and counts top search queries across prompts + platforms", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        observations: [
          makeObservation(PROMPT_A, {
            platform: "chatgpt",
            search_queries: ["kitchen remodel atherton", "luxury renovation"],
          }),
          makeObservation(PROMPT_A, {
            platform: "chatgpt",
            search_queries: ["kitchen remodel atherton"], // dup +1
          }),
          makeObservation(PROMPT_B, {
            platform: "perplexity",
            search_queries: ["kitchen remodel atherton"], // shared across prompts
          }),
        ],
      }),
    );

    const sig = packet.aiSearchSignal;
    expect(sig.topSearchQueries.length).toBe(2);
    const top = sig.topSearchQueries[0];
    expect(top.query).toBe("kitchen remodel atherton");
    expect(top.count).toBe(3);
    expect(top.promptIds).toEqual([PROMPT_A, PROMPT_B].sort());
    expect(top.platforms).toEqual(["chatgpt", "perplexity"].sort());

    const second = sig.topSearchQueries[1];
    expect(second.query).toBe("luxury renovation");
    expect(second.count).toBe(1);
    expect(second.promptIds).toEqual([PROMPT_A]);
  });

  it("dedupes and counts top descriptors near brand", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        observations: [
          makeObservation(PROMPT_A, {
            descriptor_window: ["luxury", "award-winning", "atherton"],
          }),
          makeObservation(PROMPT_B, {
            descriptor_window: ["luxury", "design-build"],
          }),
        ],
      }),
    );

    const descriptors = packet.aiSearchSignal.topDescriptors;
    expect(descriptors[0].word).toBe("luxury"); // count 2 wins
    expect(descriptors[0].count).toBe(2);
    expect(descriptors[0].promptIds).toEqual([PROMPT_A, PROMPT_B].sort());

    // Lowercased
    const words = descriptors.map((d) => d.word);
    for (const w of words) {
      expect(w).toBe(w.toLowerCase());
    }
  });

  it("excludes Houzz/Yelp/Angi/BuildZoom from competitor co-mentions when listed in trackedEntities", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        trackedEntities: [
          {
            id: "ent-houzz",
            name: "Houzz",
            entity_type: "directory_source",
            domain: "houzz.com",
            aliases: [],
            url: null,
            location_scope: null,
            service_scope: null,
            is_owned: false,
            is_active: true,
            metadata: {},
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
            account_id: "acc-test",
          },
          {
            id: "ent-yelp",
            name: "Yelp",
            entity_type: "directory_source",
            domain: "yelp.com",
            aliases: [],
            url: null,
            location_scope: null,
            service_scope: null,
            is_owned: false,
            is_active: true,
            metadata: {},
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
            account_id: "acc-test",
          },
          {
            id: "ent-buildzoom",
            name: "BuildZoom",
            entity_type: "directory_source",
            domain: "buildzoom.com",
            aliases: [],
            url: null,
            location_scope: null,
            service_scope: null,
            is_owned: false,
            is_active: true,
            metadata: {},
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
            account_id: "acc-test",
          },
          {
            id: "ent-de-mattei",
            name: "De Mattei Construction",
            entity_type: "competitor",
            domain: "demattei.com",
            aliases: ["De Mattei"],
            url: null,
            location_scope: null,
            service_scope: null,
            is_owned: false,
            is_active: true,
            metadata: {},
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
            account_id: "acc-test",
          },
        ],
        observations: [
          makeObservation(PROMPT_A, {
            competitor_co_mentions: [
              "Houzz",
              "Yelp",
              "BuildZoom",
              "De Mattei Construction",
              "General Contractors", // generic-noun fallback
            ],
          }),
        ],
      }),
    );

    const names = packet.aiSearchSignal.topCompetitorCoMentions.map(
      (c) => c.competitorName,
    );
    expect(names).toEqual(["De Mattei Construction"]);
    expect(names).not.toContain("Houzz");
    expect(names).not.toContain("Yelp");
    expect(names).not.toContain("BuildZoom");
    expect(names).not.toContain("General Contractors");
  });

  it("retains real competitors with valid metadata (Bay Builders kept even if name reads generic)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        trackedEntities: [
          {
            id: "ent-bay-builders",
            name: "Bay Builders",
            entity_type: "competitor",
            domain: "baybuilders.example",
            aliases: [],
            url: null,
            location_scope: null,
            service_scope: null,
            is_owned: false,
            is_active: true,
            metadata: {},
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-24T00:00:00Z",
            account_id: "acc-test",
          },
        ],
        observations: [
          makeObservation(PROMPT_A, {
            competitor_co_mentions: ["Bay Builders"],
          }),
        ],
      }),
    );
    const names = packet.aiSearchSignal.topCompetitorCoMentions.map(
      (c) => c.competitorName,
    );
    expect(names).toEqual(["Bay Builders"]);
  });

  it("returns empty arrays when observations have no signal (better empty than fake)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        observations: [
          makeObservation(PROMPT_A, {
            search_queries: [],
            descriptor_window: [],
            competitor_co_mentions: [],
          }),
        ],
      }),
    );
    expect(packet.aiSearchSignal.topSearchQueries).toEqual([]);
    expect(packet.aiSearchSignal.topDescriptors).toEqual([]);
    expect(packet.aiSearchSignal.topCompetitorCoMentions).toEqual([]);
  });

  it("returns empty arrays when no observations are passed at all", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({ observations: [] }),
    );
    expect(packet.aiSearchSignal.topSearchQueries).toEqual([]);
    expect(packet.aiSearchSignal.topDescriptors).toEqual([]);
    expect(packet.aiSearchSignal.topCompetitorCoMentions).toEqual([]);
    // Caps are still reported so consumers can read them defensively.
    expect(packet.aiSearchSignal.caps.maxSearchQueries).toBeGreaterThan(0);
    expect(packet.aiSearchSignal.caps.maxDescriptors).toBeGreaterThan(0);
    expect(packet.aiSearchSignal.caps.maxCompetitorCoMentions).toBeGreaterThan(0);
  });

  it("ignores non-string entries in source arrays (defensive)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        observations: [
          makeObservation(PROMPT_A, {
            // Cast through unknown so the test can simulate a bad
            // upstream row without a wider type widening.
            search_queries: [
              "valid query",
              null as unknown as string,
              123 as unknown as string,
              "",
              "  ",
            ],
            descriptor_window: ["good", null as unknown as string],
          }),
        ],
      }),
    );
    expect(
      packet.aiSearchSignal.topSearchQueries.map((q) => q.query),
    ).toEqual(["valid query"]);
    expect(packet.aiSearchSignal.topDescriptors.map((d) => d.word)).toEqual([
      "good",
    ]);
  });
});

describe("W3 Step 3.2 — competitorPageBlueprints", () => {
  const PROMPT = "prompt-a";

  function buildBlueprintArgs(
    overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
  ): BuildSpecificEditEvidencePacketArgs {
    return buildArgs({
      affectedPromptIds: [PROMPT],
      promptOpportunities: [makeOpportunity(PROMPT)],
      trackedPrompts: [makePrompt(PROMPT, "best builders atherton")],
      primarySummaries: [makeSummary(PROMPT)],
      ...overrides,
    });
  }

  it("aggregates citation_urls with class=competitor across observations", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: [
              "https://demattei.com/services",
              "https://kasten.example/about",
            ],
            citation_domain_classes: ["competitor", "competitor"],
          }),
          makeObservation(PROMPT, {
            citation_urls: ["https://demattei.com/services"], // +1
            citation_domain_classes: ["competitor"],
          }),
        ],
      }),
    );

    expect(packet.competitorPageBlueprints).toHaveLength(2);
    const top = packet.competitorPageBlueprints[0];
    expect(top.url).toBe("https://demattei.com/services");
    expect(top.citationCount).toBe(2);
    expect(top.domain).toBe("demattei.com");
    expect(top.promptsCitedOn).toEqual([PROMPT]);
  });

  it("excludes citations with class=owned/directory/news/etc.", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: [
              "https://example.com/services/braces", // owned
              "https://houzz.com/profile/foo", // directory
              "https://example-news.example/article", // news
              "https://demattei.com/services", // competitor — keep
            ],
            citation_domain_classes: [
              "owned",
              "directory",
              "news",
              "competitor",
            ],
          }),
        ],
      }),
    );

    const urls = packet.competitorPageBlueprints.map((b) => b.url);
    expect(urls).toEqual(["https://demattei.com/services"]);
  });

  it("excludes blocklisted directory domains (Houzz/Yelp/Angi/BuildZoom) even when class is missing", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: [
              "https://houzz.com/profile/foo",
              "https://yelp.com/biz/bar",
              "https://angi.com/listing/baz",
              "https://buildzoom.com/contractor/qux",
              "https://demattei.com/services",
            ],
            // class array intentionally omitted — fall back to domain
            // blocklist.
            citation_domain_classes: null,
          }),
        ],
      }),
    );
    const urls = packet.competitorPageBlueprints.map((b) => b.url);
    expect(urls).toEqual(["https://demattei.com/services"]);
  });

  it("excludes owned-domain URLs (no self-blueprinting) when class array is missing", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: [
              "https://example.com/services/braces", // owned
              "https://demattei.com/services", // competitor
            ],
            citation_domain_classes: null,
          }),
        ],
      }),
    );
    const urls = packet.competitorPageBlueprints.map((b) => b.url);
    expect(urls).toEqual(["https://demattei.com/services"]);
  });

  it("caps the blueprint list to 5 entries even with many distinct competitor URLs", () => {
    const observations = [
      makeObservation(PROMPT, {
        citation_urls: [
          "https://a1.example/p",
          "https://a2.example/p",
          "https://a3.example/p",
          "https://a4.example/p",
          "https://a5.example/p",
          "https://a6.example/p",
          "https://a7.example/p",
        ],
        citation_domain_classes: [
          "competitor",
          "competitor",
          "competitor",
          "competitor",
          "competitor",
          "competitor",
          "competitor",
        ],
      }),
    ];
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({ observations }),
    );
    expect(packet.competitorPageBlueprints).toHaveLength(5);
  });

  it("enriches with pageTitle from CompetitorPageEvidence when supplied", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: ["https://demattei.com/services"],
            citation_domain_classes: ["competitor"],
          }),
        ],
        competitorPages: [
          {
            competitorEvidenceId: "cpe-1",
            frontierKey: "fk",
            topic: "Atherton Construction",
            domain: "demattei.com",
            pageUrl: "https://demattei.com/services",
            pageTitle: "Custom Home Services — De Mattei",
            sourceType: "competitor_service_page",
            sourceTypeInferred: false,
            citationCount: 12,
            evidenceType: "primary_competitor",
            observedAt: "2026-04-30T00:00:00Z",
            structuralSignals: "",
            contentSignals: "",
            comparisonSignals: "",
            notes: null,
          } as Parameters<typeof buildSpecificEditEvidencePacket>[0]["competitorPages"] extends ReadonlyArray<infer T> ? T : never,
        ],
      }),
    );
    const top = packet.competitorPageBlueprints[0];
    expect(top.pageTitle).toBe("Custom Home Services — De Mattei");
    expect(top.topic).toBe("Atherton Construction");
  });

  it("leaves h1 / topH2s / faqQuestions / metaDescription as null/empty (never invented)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, {
            citation_urls: ["https://demattei.com/services"],
            citation_domain_classes: ["competitor"],
          }),
        ],
      }),
    );
    const top = packet.competitorPageBlueprints[0];
    expect(top.h1).toBeNull();
    expect(top.topH2s).toEqual([]);
    expect(top.faqQuestions).toEqual([]);
    expect(top.metaDescription).toBeNull();
  });

  it("returns [] when no observations cite any competitor URLs", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({
        observations: [
          makeObservation(PROMPT, { citation_urls: [] }),
        ],
      }),
    );
    expect(packet.competitorPageBlueprints).toEqual([]);
  });

  it("returns [] when no observations are passed at all", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildBlueprintArgs({ observations: [] }),
    );
    expect(packet.competitorPageBlueprints).toEqual([]);
  });
});

describe("W3 Step 3.2 — crossTenantPatterns stub", () => {
  it("returns [] for any packet (single-tenant single-user, today)", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.crossTenantPatterns).toEqual([]);
  });

  it("is stable across runs (still empty even with rich observations)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation("prompt-1", {
            search_queries: ["x"],
            descriptor_window: ["y"],
            competitor_co_mentions: ["Z"],
          }),
        ],
      }),
    );
    expect(packet.crossTenantPatterns).toEqual([]);
  });
});

describe("W3 Step 3.2 — evidenceHash propagation", () => {
  it("flips when aiSearchSignal contents change", () => {
    const a = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation("prompt-1", {
            search_queries: ["alpha"],
          }),
        ],
      }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation("prompt-1", {
            search_queries: ["beta"], // different query
          }),
        ],
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("flips when competitorPageBlueprints contents change", () => {
    const a = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation("prompt-1", {
            citation_urls: ["https://demattei.com/services"],
            citation_domain_classes: ["competitor"],
          }),
        ],
      }),
    );
    const b = buildSpecificEditEvidencePacket(
      buildArgs({
        observations: [
          makeObservation("prompt-1", {
            citation_urls: ["https://kasten.example/about"], // different URL
            citation_domain_classes: ["competitor"],
          }),
        ],
      }),
    );
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("is stable across re-runs with the same inputs (deterministic ordering)", () => {
    const args = buildArgs({
      observations: [
        makeObservation("prompt-1", {
          search_queries: ["gamma", "alpha", "beta"],
          descriptor_window: ["luxury", "atherton"],
          citation_urls: [
            "https://demattei.com/services",
            "https://kasten.example/about",
          ],
          citation_domain_classes: ["competitor", "competitor"],
        }),
      ],
    });
    const a = buildSpecificEditEvidencePacket(args);
    const b = buildSpecificEditEvidencePacket(args);
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("packet always carries the new fields (never undefined)", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.aiSearchSignal).toBeDefined();
    expect(packet.aiSearchSignal.topSearchQueries).toEqual([]);
    expect(packet.aiSearchSignal.topDescriptors).toEqual([]);
    expect(packet.aiSearchSignal.topCompetitorCoMentions).toEqual([]);
    expect(packet.competitorPageBlueprints).toEqual([]);
    expect(packet.crossTenantPatterns).toEqual([]);
  });
});
