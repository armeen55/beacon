import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
} from "@/domains/recommendations/specific-edit-evidence";
import { ACTION_TYPES, ACTION_TYPE_REGISTRY } from "@/domains/recommendations/action-types";
import { NEEDS_NEW_PAGE } from "@/domains/recommendations/resolved-types";

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
  it("threads schemaVersion / tenantId / recId / generatedAt; required fields always present", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.schemaVersion).toBe("specific-edit/v1");
    expect(packet.tenantId).toBe(TENANT_ID);
    expect(packet.recId).toBe(REC_ID);
    expect(packet.generatedAt).toBe(FROZEN_NOW.toISOString());
    expect(packet.evidenceHash).toBeTruthy();
    // Cluster fields exist (may be null) — the keys must be present.
    expect("clusterId" in packet).toBe(true);
    expect("clusterLabel" in packet).toBe(true);
    expect("clusterKind" in packet).toBe(true);
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


  it("computes topPrimaryCompetitor from primarySummary.primaryCompetitors[0]", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.affectedPrompts[0].topPrimaryCompetitor).toEqual({
      name: "AcmeOrtho",
      share: 0.6,
    });
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


  it("excludes off-domain URLs even if elements for them appear in pageElementInventory", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.allowedTargetUrls).not.toContain(
      "https://other-site.example/something",
    );
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


  it("singleTargetUrl === NEEDS_NEW_PAGE → [NEEDS_NEW_PAGE] only", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({ singleTargetUrl: NEEDS_NEW_PAGE }),
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



});

// ── priorOutcomes ──────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — priorOutcomes", () => {
  it("defaults to []", () => {
    const packet = buildSpecificEditEvidencePacket(buildArgs());
    expect(packet.priorOutcomes).toEqual([]);
  });


});

// ── evidenceHash ────────────────────────────────────────────────────────────

describe("Phase 6A.1.7 — evidenceHash", () => {
  it("is a non-empty hex string and deterministic for identical inputs", () => {
    const a = buildSpecificEditEvidencePacket(buildArgs());
    const b = buildSpecificEditEvidencePacket(buildArgs());
    expect(a.evidenceHash).toMatch(/^[0-9a-f]+$/);
    expect(a.evidenceHash.length).toBeGreaterThanOrEqual(8);
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("changes when any identity field changes (tenantId / recId / clusterLabel / clusterId)", () => {
    const base = buildSpecificEditEvidencePacket(buildArgs()).evidenceHash;
    const variants: Array<Partial<BuildSpecificEditEvidencePacketArgs>> = [
      { tenantId: "tenant-other" },
      { recId: "rec-other" },
      { clusterLabel: "different cluster", clusterKind: "topic" },
      { clusterId: "cluster-XYZ" },
    ];
    for (const v of variants) {
      expect(
        buildSpecificEditEvidencePacket(buildArgs(v)).evidenceHash,
      ).not.toBe(base);
    }
  });

  it("changes when evidence content changes (prompts / element text / candidate set / allowedActionTypes)", () => {
    const base = buildSpecificEditEvidencePacket(buildArgs()).evidenceHash;
    // affectedPromptIds change:
    expect(
      buildSpecificEditEvidencePacket(
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
      ).evidenceHash,
    ).not.toBe(base);
    // element_text edit:
    const editedElements = buildArgs().pageElementInventory.map((r) =>
      r.element_key === "h1[0]:hash-bbb"
        ? { ...r, element_text: "TOTALLY NEW H1" }
        : r,
    );
    expect(
      buildSpecificEditEvidencePacket(
        buildArgs({ pageElementInventory: editedElements }),
      ).evidenceHash,
    ).not.toBe(base);
    // ownedPageCandidates set change:
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
    expect(
      buildSpecificEditEvidencePacket(
        buildArgs({
          clusterLabel: "palatal expander",
          clusterKind: "topic",
          ownedPageInventory: extraInventory,
        }),
      ).evidenceHash,
    ).not.toBe(base);
    // allowedActionTypes change:
    expect(
      buildSpecificEditEvidencePacket(
        buildArgs({ allowedActionTypes: ["edit_title"] }),
      ).evidenceHash,
    ).not.toBe(base);
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
    const appDir = resolve(process.cwd(), "src/app");
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


  type TrackedEntityFixture = NonNullable<
    BuildSpecificEditEvidencePacketArgs["trackedEntities"]
  >[number];

  function makeTrackedEntity(args: {
    id: string;
    name: string;
    entity_type: TrackedEntityFixture["entity_type"];
    domain: string;
    aliases?: string[];
  }): TrackedEntityFixture {
    return {
      id: args.id,
      name: args.name,
      entity_type: args.entity_type,
      domain: args.domain,
      aliases: args.aliases ?? [],
      url: null,
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: true,
      metadata: {},
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-24T00:00:00Z",
      account_id: "acc-test",
    };
  }

  it("excludes Houzz/Yelp/Angi/BuildZoom from competitor co-mentions when listed in trackedEntities", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({
        trackedEntities: [
          makeTrackedEntity({
            id: "ent-houzz",
            name: "Houzz",
            entity_type: "directory_source",
            domain: "houzz.com",
          }),
          makeTrackedEntity({
            id: "ent-yelp",
            name: "Yelp",
            entity_type: "directory_source",
            domain: "yelp.com",
          }),
          makeTrackedEntity({
            id: "ent-buildzoom",
            name: "BuildZoom",
            entity_type: "directory_source",
            domain: "buildzoom.com",
          }),
          makeTrackedEntity({
            id: "ent-de-mattei",
            name: "De Mattei Construction",
            entity_type: "competitor",
            domain: "demattei.com",
            aliases: ["De Mattei"],
          }),
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
          makeTrackedEntity({
            id: "ent-bay-builders",
            name: "Bay Builders",
            entity_type: "competitor",
            domain: "baybuilders.example",
          }),
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

  it("returns empty arrays for signal-less or absent observations (better empty than fake); caps still reported", () => {
    const emptySignal = buildSpecificEditEvidencePacket(
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
    const noObs = buildSpecificEditEvidencePacket(
      buildSearchSignalArgs({ observations: [] }),
    );
    for (const packet of [emptySignal, noObs]) {
      expect(packet.aiSearchSignal.topSearchQueries).toEqual([]);
      expect(packet.aiSearchSignal.topDescriptors).toEqual([]);
      expect(packet.aiSearchSignal.topCompetitorCoMentions).toEqual([]);
    }
    // Caps are still reported so consumers can read them defensively.
    expect(noObs.aiSearchSignal.caps.maxSearchQueries).toBeGreaterThan(0);
    expect(noObs.aiSearchSignal.caps.maxDescriptors).toBeGreaterThan(0);
    expect(noObs.aiSearchSignal.caps.maxCompetitorCoMentions).toBeGreaterThan(0);
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

});

describe("W3 Step 3.2 — crossTenantPatterns stub", () => {
  it("returns [] for any packet, even with rich observations (single-tenant single-user, today)", () => {
    expect(
      buildSpecificEditEvidencePacket(buildArgs()).crossTenantPatterns,
    ).toEqual([]);
    expect(
      buildSpecificEditEvidencePacket(
        buildArgs({
          observations: [
            makeObservation("prompt-1", {
              search_queries: ["x"],
              descriptor_window: ["y"],
              competitor_co_mentions: ["Z"],
            }),
          ],
        }),
      ).crossTenantPatterns,
    ).toEqual([]);
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
