/** Recommendation queue: load + sweeper + group score (Core 100K Phase 6 merge). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecisionMatrix } from "@/domains/prompts/decision-matrix";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import {
  buildPacketForRec,
  type LiveRecommendationQueue,
  type LiveRecQueueItem,
} from "@/domains/recommendations/load-queue";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import {
  selectQueueExpiries,
  sweepQueueForTenant,
  QUEUE_TTL_DAYS,
  MAX_PENDING_PER_TENANT,
} from "@/domains/recommendations/queue-sweeper";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { queueGroupScore } from "@/domains/recommendations/load-queue";

// ===== from src/domains/recommendations/load-queue.test.ts =====
// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 14 — orchestration extract + queue-driven CLI tests.
//
// Two test layers:
//   1. `buildPacketForRec` (pure) — fed a synthetic LiveRecommendationQueue
//      + inventory rows; asserts the packet's tenant_id / recId / cluster
//      flow through cleanly and that targetPageElements come from the
//      inventory.
//   2. Source-scan invariants — the page no longer inlines generation
//      steps; no app route imports the CLI packet builder; `server-only`
//      keeps the loader off the client bundle.
// ---------------------------------------------------------------------------

// ── Fixture builders ──────────────────────────────────────────────────────

function makePrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "acc",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: [],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-24T00:00:00Z",
  };
}

function makeOpportunity(promptId: string): PromptOpportunity {
  return {
    prompt_id: promptId,
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "n/a",
    evidence: {
      observationCount: 5,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 4,
      avgCitationRank: null,
      dominantCompetitors: ["AcmeOrtho"],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
  };
}

function makeSummary(promptId: string): PromptPrimarySummary {
  return {
    prompt_id: promptId,
    totalAnswers: 5,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [
      { name: "AcmeOrtho", primaryCount: 3, totalAnswers: 5 },
    ],
    fragmented: false,
  };
}

function makeMatrix(): DecisionMatrix {
  const promptId = "p-1";
  return {
    date: "2026-04-24",
    prompts: [makeOpportunity(promptId)],
    primaryByPromptId: {
      [promptId]: makeSummary(promptId),
    },
    clusters: [],
  } as unknown as DecisionMatrix;
}

function makePageInventoryEntry(): PageInventoryEntry {
  return {
    url: "https://example.com/services/braces",
    title: "Braces · Acme",
    h1: "Braces",
    metaDescription: null,
    h2s: ["Treatment timeline"],
    routeType: "service",
    detectedGeo: null,
    detectedService: "braces",
  };
}

function makeRec(): LiveRecQueueItem {
  return {
    stableKey: "rec-test-1",
    type: "strengthen_page_copy",
    title: "Strengthen Braces page",
    description: "test",
    affectedPromptIds: ["p-1"],
    clusterLabel: "teen braces",
    clusterKind: "topic",
    evidence: {
      promptCount: 1,
      observationCount: 5,
      categoryBreakdown: { outranked: 1 },
      dominantCompetitors: ["AcmeOrtho"],
      descriptorsNearBrand: [],
      maxSignalStrength: 70,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity: "medium",
    effort: "low",
    score: 5,
    tier: "now",
    rank: 1,
    reasoning: "test reasoning",
    // W3 Step 3.3 (2026-05-01) — fixture stamps a baseline LOW
    // engineConfidence so the type satisfies LiveRecQueueItem. Real
    // verdicts are computed inside loadLiveRecommendationQueue.
    engineConfidence: { confidence: "low", reasons: ["no_edits"] },
  };
}

function makeContext(
  overrides: Partial<LiveRecommendationQueue> = {},
): LiveRecommendationQueue {
  const matrix = makeMatrix();
  return {
    queue: [makeRec()],
    watchlist: [],
    matrix,
    trackedPrompts: [makePrompt("p-1", "best teen braces?")],
    trackedEntities: [] as TrackedEntity[],
    promptAnswerObservations: [],
    pageInventory: [makePageInventoryEntry()],
    recommendedEdits: [],
    competitorPageSnapshotsByUrl: new Map(),
    competitorBlueprintBrandScrubAliases: [],
    errors: [],
    ...overrides,
  };
}

function makeElement(
  overrides: Partial<PageElementInventoryRow>,
): PageElementInventoryRow {
  return {
    id: "snap__title[0]:hash",
    tenant_id: "tenant-test",
    page_id: "pg-1",
    url: "https://example.com/services/braces",
    element_type: "title",
    element_key: "title[0]:hash",
    display_label: "Title",
    element_text: "Braces · Acme",
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-24T10:00:00Z",
    source_snapshot_id: "snap",
    ...overrides,
  };
}

// ── 1. buildPacketForRec ──────────────────────────────────────────────────

describe("Phase 6A.1.14 — buildPacketForRec", () => {
  it("threads tenantId + recId + cluster fields from the rec into the packet", () => {
    const ctx = makeContext();
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.tenantId).toBe("tenant-test");
    expect(packet.recId).toBe(rec.stableKey);
    expect(packet.clusterLabel).toBe("teen braces");
    expect(packet.clusterKind).toBe("topic");
  });

  it("returns 0 targetPageElements when inventory is empty", () => {
    const ctx = makeContext();
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.targetPageElements).toEqual([]);
  });

  it("populates targetPageElements when inventory rows match candidate URLs", () => {
    const ctx = makeContext();
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [makeElement({})],
      tenantId: "tenant-test",
    });
    expect(packet.targetPageElements.length).toBeGreaterThan(0);
    expect(
      packet.targetPageElements.some(
        (el) => el.url === "https://example.com/services/braces",
      ),
    ).toBe(true);
  });

  it("throws when the matrix is null (load-queue step failed)", () => {
    const ctx = makeContext({ matrix: null });
    const rec = makeRec();
    expect(() =>
      buildPacketForRec({
        rec,
        context: ctx,
        pageElementInventory: [],
        tenantId: "tenant-test",
      }),
    ).toThrow(/matrix is null/);
  });

  it("primarySummaries are sourced from matrix.primaryByPromptId (shared with /recommendations)", () => {
    const ctx = makeContext();
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.affectedPrompts).toHaveLength(1);
    expect(packet.affectedPrompts[0].topPrimaryCompetitor?.name).toBe(
      "AcmeOrtho",
    );
  });

  // Sprint 6A.2g.A (2026-04-26) — strict target alignment.
  it("threads rec.resolution.targetUrl into allowedTargetUrls (strict anchor)", () => {
    const ctx = makeContext();
    const rec: typeof ctx.queue[0] = {
      ...ctx.queue[0],
      resolution: {
        action: "strengthen_existing_page",
        motive: "counter_competitor",
        targetUrl: "https://example.com/services/braces",
        confidence: "high",
        confidenceReason: "test",
        tier: "observation",
        reasoning: "test",
        cannibalization: null,
        evidenceRefs: [],
      },
    };
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.allowedTargetUrls).toEqual([
      "https://example.com/services/braces",
    ]);
  });

  // Sprint 6A.2g.E (2026-04-26) — observations threading.
  it("threads context.promptAnswerObservations through to packet.affectedPrompts evidence enrichment", async () => {
    const ctx = makeContext({
      promptAnswerObservations: [
        {
          id: "obs-thread-test",
          prompt_id: "p-1",
          run_id: "run-test",
          answer_hash: "deadbeefdeadbeef",
          position: null,
          tracked_brand_mentioned: false,
          tracked_brand_cited: false,
          citation_count: 1,
          owned_citation_count: 0,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-04-26T10:00:00Z",
          platform: "chatgpt",
          topic: "",
          metadata: {
            extracted: { searchQueries: ["threaded query"] },
          },
          tenant_id: "tenant-test",
          citation_urls: ["https://example.com/cited"],
          descriptor_window: ["threaded-desc"],
        },
      ],
    });
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.affectedPrompts).toHaveLength(1);
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([
      "threaded query",
    ]);
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([
      "https://example.com/cited",
    ]);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual([
      "threaded-desc",
    ]);
  });

  it("packet has empty enrichment arrays when context has no observations (legacy/pre-Phase-D)", () => {
    const ctx = makeContext({ promptAnswerObservations: [] });
    const rec = ctx.queue[0];
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    expect(packet.affectedPrompts[0].actualSearchQueries).toEqual([]);
    expect(packet.affectedPrompts[0].citedSourcePages).toEqual([]);
    expect(packet.affectedPrompts[0].descriptorWindows).toEqual([]);
  });

  it("legacy rec without resolution falls through to candidate-set + sentinel", () => {
    const ctx = makeContext();
    const rec = ctx.queue[0];
    // The default fixture rec has no `resolution` field — backwards-compat
    // path returns owned candidate URLs + the sentinel.
    expect(rec.resolution).toBeUndefined();
    const packet = buildPacketForRec({
      rec,
      context: ctx,
      pageElementInventory: [],
      tenantId: "tenant-test",
    });
    // The sentinel must be present under the legacy path.
    expect(packet.allowedTargetUrls.length).toBeGreaterThanOrEqual(1);
    expect(packet.allowedTargetUrls).toContain(
      // NEEDS_NEW_PAGE constant — re-imported via the legacy path's
      // string literal. Value mirrors `src/domains/recommendations/resolved-types.ts`.
      "needs_new_page",
    );
  });
});

// ── 2. Source-scan invariants ─────────────────────────────────────────────

const PAGE_PATH = resolve(process.cwd(), "src/app/(shell)/recommendations/page.tsx");
const LOAD_QUEUE_PATH = resolve(process.cwd(), "src/domains/recommendations/load-queue.ts");

describe("Phase 6A.1.14 — orchestration is shared between page + CLI", () => {
  it("page.tsx no longer inlines orchestration steps it now delegates", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // These were the inline calls before extraction. They MUST live in
    // load-queue.ts now, not page.tsx.
    expect(src).not.toMatch(/buildPromptDecisionMatrix\(/);
    expect(src).not.toMatch(/generateRecommendations\(/);
    expect(src).not.toMatch(/buildPageInventory\(/);
    expect(src).not.toMatch(/resolvePageIntent\(/);
    expect(src).not.toMatch(/adjudicateFromCacheOnly\(/);
    expect(src).not.toMatch(/prioritizeRecommendations\(/);
  });

});

// ── 3. No-route-render-generation invariant (CLI must not be route-imported) ──

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

describe("Phase 6A.1.14 — no route-render generation", () => {
  it("no app route imports the CLI script or runProviderAndPersist", () => {
    const appDir = resolve(__dirname, "../../app");
    const matches = walkSync(
      appDir,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /from\s+["'][^"']*build-edits-for-queue/.test(src) ||
        /\brunProviderAndPersist\b/.test(src) ||
        /\bbuildPacketForRec\b/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("load-queue.ts has 'server-only' so it cannot leak into the client bundle", () => {
    const src = readFileSync(LOAD_QUEUE_PATH, "utf8");
    expect(src).toMatch(/import\s+["']server-only["']/);
  });
});

// ===== from tests/domains/recommendations/queue-sweeper.test.ts =====
/**
 * 2026-06-11 (night shift, #114/#49) — queue staleness sweeper.
 * Pins: ONLY auto-promoted rows sweep; TTL expiry; cap overflow expires
 * the OLDEST beyond MAX_PENDING; operator/factory/accepted rows are
 * untouchable; idempotent persist with sync-warning surfacing.
 */


vi.mock("server-only", () => ({}));


const NOW = new Date("2026-06-11T05:30:00Z");

function row(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: `id-${over.rec_id ?? "x"}-${over.created_at ?? ""}`,
    tenant_id: "tenant-x",
    rec_id: over.rec_id ?? "rec-x",
    action_type: "edit_title",
    target_url: "https://x.com/p",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-10T05:30:00Z",
    updated_at: "2026-06-10T05:30:00Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as RecommendedEditRow;
}

const OLD = `2026-04-01T00:00:00Z`; // far beyond the TTL window

describe("selectQueueExpiries", () => {
  it("expires recommended auto-promoted rows older than the TTL", () => {
    const sel = selectQueueExpiries(
      [row({ created_at: OLD, rec_id: "old" }), row({ rec_id: "fresh" })],
      NOW,
    );
    expect(sel.expiries).toHaveLength(1);
    expect(sel.expiries[0]!.row.rec_id).toBe("old");
    expect(sel.expiries[0]!.reason).toBe("ttl");
    expect(sel.pendingAfter).toBe(1);
  });

  it("NEVER touches operator/factory/non-promoted rows, regardless of age", () => {
    const sel = selectQueueExpiries(
      [
        row({ created_at: OLD, source: "deterministic" as RecommendedEditRow["source"] }),
        row({ created_at: OLD, source: "openai" as RecommendedEditRow["source"], rec_id: "factory" }),
        row({ created_at: OLD, implementation_status: "accepted", rec_id: "accepted" }),
        row({ created_at: OLD, implementation_status: "pushed", rec_id: "pushed" }),
      ],
      NOW,
    );
    expect(sel.expiries).toHaveLength(0);
  });

  it("cap overflow expires the OLDEST beyond MAX_PENDING_PER_TENANT", () => {
    const rows = Array.from({ length: MAX_PENDING_PER_TENANT + 3 }, (_, i) =>
      row({
        rec_id: `r${i}`,
        created_at: `2026-06-${String((i % 9) + 1).padStart(2, "0")}T0${i % 10}:00:00Z`,
      }),
    );
    const sel = selectQueueExpiries(rows, NOW);
    const overflow = sel.expiries.filter((e) => e.reason === "overflow");
    expect(overflow).toHaveLength(3);
    // The expired ones must be the 3 OLDEST surviving rows.
    const expiredDates = overflow.map((e) => e.row.created_at).sort();
    const allDates = rows.map((r) => r.created_at).sort();
    expect(expiredDates).toEqual(allDates.slice(0, 3));
    expect(sel.pendingAfter).toBe(MAX_PENDING_PER_TENANT);
  });

  it("respects custom ttlDays", () => {
    const sel = selectQueueExpiries(
      [row({ created_at: "2026-06-09T00:00:00Z" })],
      NOW,
      { ttlDays: 1 },
    );
    expect(sel.expiries).toHaveLength(1);
  });

  it("QUEUE_TTL_DAYS default is 30 (the 'short queue' contract)", () => {
    expect(QUEUE_TTL_DAYS).toBe(30);
  });
});

describe("sweepQueueForTenant", () => {
  it("persists expired rows with status 'expired' + fresh updated_at", async () => {
    const persisted: RecommendedEditRow[][] = [];
    const synced: Array<{ rows: RecommendedEditRow[]; tenantId: string }> = [];
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row({ created_at: OLD, rec_id: "old" }), row({ rec_id: "fresh" })],
      persistLocal: async (rows) => {
        persisted.push(rows);
      },
      syncRows: async (rows, tenantId) => {
        synced.push({ rows, tenantId });
      },
      now: NOW,
    });
    expect(r.expiredTtl).toBe(1);
    expect(r.expiredOverflow).toBe(0);
    expect(persisted[0]![0]!.implementation_status).toBe("expired");
    expect(persisted[0]![0]!.updated_at).toBe(NOW.toISOString());
    expect(synced[0]!.tenantId).toBe("tenant-x");
  });

  it("no expiries → no writes at all", async () => {
    let writes = 0;
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row()],
      persistLocal: async () => {
        writes++;
      },
      syncRows: async () => {
        writes++;
      },
      now: NOW,
    });
    expect(r.expiredTtl + r.expiredOverflow).toBe(0);
    expect(writes).toBe(0);
  });

  it("surfaces a sync warning without throwing (local write landed)", async () => {
    const r = await sweepQueueForTenant("tenant-x", {
      loadRows: async () => [row({ created_at: OLD })],
      persistLocal: async () => {},
      syncRows: async () => {
        throw new Error("supabase down");
      },
      now: NOW,
    });
    expect(r.expiredTtl).toBe(1);
    expect(r.sync_warning).toContain("supabase down");
  });
});

// ===== from tests/domains/recommendations/queue-group-score.test.ts =====
/**
 * 2026-06-11 (night shift, #48) — unified queue ordering score.
 * Pins: drafted beats undrafted regardless of confidence; confidence
 * orders within draftedness; max-over-group semantics.
 */



describe("queueGroupScore", () => {
  it("drafted-low beats undrafted-high (approvable on sight wins)", () => {
    expect(queueGroupScore([{ proposed_text: "draft", confidence: "low" }]))
      .toBeGreaterThan(queueGroupScore([{ proposed_text: null, confidence: "high" }]));
  });

  it("confidence orders within drafted groups", () => {
    const high = queueGroupScore([{ proposed_text: "d", confidence: "high" }]);
    const med = queueGroupScore([{ proposed_text: "d", confidence: "medium" }]);
    const low = queueGroupScore([{ proposed_text: "d", confidence: "low" }]);
    expect(high).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(low);
  });

  it("max-over-group: one drafted edit lifts the whole rec", () => {
    expect(
      queueGroupScore([
        { proposed_text: null, confidence: "low" },
        { proposed_text: "d", confidence: "medium" },
      ]),
    ).toBe(queueGroupScore([{ proposed_text: "d", confidence: "medium" }]));
  });

  it("empty drafts don't count as drafted", () => {
    expect(queueGroupScore([{ proposed_text: "", confidence: "high" }])).toBe(
      queueGroupScore([{ proposed_text: null, confidence: "high" }]),
    );
  });
});
