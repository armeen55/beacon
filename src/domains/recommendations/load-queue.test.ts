import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecisionMatrix } from "@/domains/prompts/decision-matrix";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PrioritizedRecommendation } from "./prioritize";
import type { PageInventoryEntry } from "./page-inventory";
import {
  buildPacketForRec,
  type LiveRecommendationQueue,
} from "./load-queue";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 14 — orchestration extract + queue-driven CLI tests.
//
// Two test layers:
//   1. `buildPacketForRec` (pure) — fed a synthetic LiveRecommendationQueue
//      + inventory rows; asserts the packet's tenant_id / recId / cluster
//      flow through cleanly and that targetPageElements come from the
//      inventory.
//   2. Source-scan invariants — the page imports `loadLiveRecommendationQueue`
//      (NOT the inlined steps it used to call directly); the CLI imports
//      the same function; no LLM SDK; no app route imports the CLI.
//
// `loadLiveRecommendationQueue` itself is mostly orchestration — the
// individual layers it composes already have their own tests. We assert
// the page + CLI consume it (i.e. the EXTRACT actually happened).
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

function makeRec(): PrioritizedRecommendation {
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
});

// ── 2. Source-scan invariants ─────────────────────────────────────────────

const PAGE_PATH = resolve(
  __dirname,
  "../../app/(shell)/recommendations/page.tsx",
);
const CLI_PATH = resolve(
  __dirname,
  "../../../scripts/build-edits-for-queue.ts",
);
const LOAD_QUEUE_PATH = resolve(__dirname, "./load-queue.ts");

describe("Phase 6A.1.14 — orchestration is shared between page + CLI", () => {
  it("page.tsx imports loadLiveRecommendationQueue", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    expect(src).toMatch(
      /from\s+["']@\/domains\/recommendations\/load-queue["']/,
    );
    expect(src).toMatch(/loadLiveRecommendationQueue/);
  });

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

  it("page.tsx still does its own fresh-read of recommendation_responses + recommended_edits", () => {
    // Phase 12 wired these reads at the page layer; Phase 14 must NOT
    // move them into load-queue.ts (different concerns: queue vs.
    // operator decoration).
    const src = readFileSync(PAGE_PATH, "utf8");
    // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound reads.
    expect(src).toMatch(/getRepository\(\)\.forTenant\([^)]+\)\.getRecommendationResponses\(/);
    expect(src).toMatch(/getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/);
  });

  it("loadLiveRecommendationQueue uses forTenant for getPages + getPageSnapshots", () => {
    // Sprint 7 Phase 7.5b Commit 3 (2026-04-25) — tenant-bound orchestration
    // reads. Must NOT call getRepository().getPages() / .getPageSnapshots()
    // unscoped; the tenantId from LoadLiveRecommendationQueueOptions
    // (Phase 7.3) flows into both reads.
    const src = readFileSync(LOAD_QUEUE_PATH, "utf8");
    expect(src).toMatch(/getRepository\(\)\.forTenant\([^)]+\)\.getPages\(/);
    expect(src).toMatch(/getRepository\(\)\.forTenant\([^)]+\)\.getPageSnapshots\(/);
    expect(src).not.toMatch(/getRepository\(\)\.getPages\(/);
    expect(src).not.toMatch(/getRepository\(\)\.getPageSnapshots\(/);
  });

  it("CLI imports loadLiveRecommendationQueue + buildPacketForRec from the SAME module the page uses", () => {
    const src = readFileSync(CLI_PATH, "utf8");
    expect(src).toMatch(
      /from\s+["']\.\.\/src\/domains\/recommendations\/load-queue["']/,
    );
    expect(src).toMatch(/loadLiveRecommendationQueue/);
    expect(src).toMatch(/buildPacketForRec/);
  });

  it("CLI uses the same persistence helper as Phase 11", () => {
    const src = readFileSync(CLI_PATH, "utf8");
    expect(src).toMatch(
      /from\s+["']\.\.\/src\/domains\/recommendations\/recommended-edits-persistence["']/,
    );
    expect(src).toMatch(/runProviderAndPersist/);
  });
});

// ── 3. CLI surface invariants ─────────────────────────────────────────────

describe("Phase 6A.1.14 — CLI surface", () => {
  const SRC = readFileSync(CLI_PATH, "utf8");

  it("supports --list / --rec-id / --all / --write flags", () => {
    expect(SRC).toMatch(/"--list"/);
    expect(SRC).toMatch(/"--rec-id="/);
    expect(SRC).toMatch(/"--all"/);
    expect(SRC).toMatch(/"--write"/);
  });

  it("default mode is DRY-RUN (write requires explicit --write)", () => {
    expect(SRC).toMatch(/dryRun\s*=\s*!flags\.write/);
  });

  it("reports stableKey + target URL + target element count + accepted/rejected/persisted per rec", () => {
    expect(SRC).toMatch(/rec=\$\{report\.stableKey\}/);
    expect(SRC).toMatch(/target_url=\$\{report\.targetUrl\}/);
    expect(SRC).toMatch(/target_element_count=\$\{report\.targetElementCount\}/);
    expect(SRC).toMatch(/generated=\$\{report\.generated\}/);
    expect(SRC).toMatch(/accepted=\$\{report\.accepted\}/);
    expect(SRC).toMatch(/rejected=\$\{report\.rejected\}/);
    expect(SRC).toMatch(/persisted=\$\{report\.persisted\}/);
  });

  it("flags empty page_element_inventory honestly (does not pretend success)", () => {
    expect(SRC).toMatch(/EMPTY/);
    expect(SRC).toMatch(/not a real-world signal/);
  });

  it("does NOT import any LLM SDK", () => {
    expect(SRC).not.toMatch(/from\s+["']openai["']/);
    expect(SRC).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
  });

  it("requires exactly one mode flag (--list / --rec-id / --all)", () => {
    expect(SRC).toMatch(/Pass only ONE mode flag/);
  });
});

// ── 4. No-route-render-generation invariant (CLI must not be route-imported) ──

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
