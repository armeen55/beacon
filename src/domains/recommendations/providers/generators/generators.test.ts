import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
} from "../../specific-edit-evidence";
import type { SpecificEdit } from "../../specific-edit-provider";
import { generateEditTitle } from "./edit-title";
import { generateAddH2Section } from "./add-h2-section";
import { generateAddFaq } from "./add-faq";
import {
  deterministicProvider,
  runDeterministicGenerators,
} from "../deterministic";
import type { PageInventoryEntry } from "../../page-inventory";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import { ACTION_TYPES } from "../../action-types";
import { isQuestionLike, titleCase } from "./_text-utils";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 9 — deterministic generators.
//
// Fixtures use neutral non-Ritz vocabulary (orthodontics + Burbank /
// Pasadena). Each generator gets a positive case (proposes an edit)
// and a negative case (returns []). Plus invariants asserted across
// all generators: only owned URLs, only allowed action types, no
// route imports, output is JSON-serializable.
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");
const TENANT = "tenant-test-acme";
const REC = "rec-2026-04-24-1";

// ── Fixture builders ───────────────────────────────────────────────────────

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

function makeOpportunity(
  promptId: string,
  overrides: Partial<PromptOpportunity> = {},
): PromptOpportunity {
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
      dominantCompetitors: ["AcmeOrtho", "PrismDental"],
      answerStructureDistribution: {},
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
  overrides: Partial<PageElementInventoryRow>,
): PageElementInventoryRow {
  return {
    id: "snap__key",
    tenant_id: TENANT,
    page_id: "pg-1",
    url: "https://example.com/services/braces",
    element_type: "title",
    element_key: "title[0]:abc",
    display_label: "Title tag",
    element_text: "Braces · Acme",
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-24T10:00:00Z",
    source_snapshot_id: "snap",
    ...overrides,
  };
}

const URL_BRACES = "https://example.com/services/braces";

function basePacketArgs(): BuildSpecificEditEvidencePacketArgs {
  const promptId = "prompt-1";
  return {
    tenantId: TENANT,
    recId: REC,
    clusterLabel: "teen braces",
    clusterKind: "topic" as const,
    affectedPromptIds: [promptId],
    promptOpportunities: [makeOpportunity(promptId)],
    trackedPrompts: [
      makePrompt(promptId, "What are the best teen braces options?"),
    ],
    primarySummaries: [makeSummary(promptId)],
    singleTargetUrl: null,
    observations: [],
    ownedPageInventory: [
      makeInventoryEntry(URL_BRACES, {
        title: "Braces · Acme",
        h1: "Braces",
        h2s: ["Treatment timeline", "Cost"],
        detectedService: "braces",
      }),
    ],
    pageElementInventory: [
      makeElement({
        url: URL_BRACES,
        element_type: "title",
        element_key: "title[0]:hash-title",
        element_text: "Braces · Acme",
        display_label: "Title tag",
      }),
      makeElement({
        url: URL_BRACES,
        element_type: "h1",
        element_key: "h1[0]:hash-h1",
        element_text: "Braces",
      }),
      makeElement({
        url: URL_BRACES,
        element_type: "h2",
        element_key: "h2[0]:hash-h2a",
        element_text: "Treatment timeline",
      }),
      makeElement({
        url: URL_BRACES,
        element_type: "h2",
        element_key: "h2[1]:hash-h2b",
        element_text: "Cost",
      }),
    ],
    now: FROZEN_NOW,
  };
}

function buildPacket(
  overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
): SpecificEditEvidencePacket {
  return buildSpecificEditEvidencePacket({ ...basePacketArgs(), ...overrides });
}

// ── _text-utils sanity ────────────────────────────────────────────────────

describe("Phase 6A.1.9 — _text-utils helpers", () => {
  it("titleCase capitalizes words and lowers connectors", () => {
    expect(titleCase("teen braces in burbank")).toBe(
      "Teen Braces in Burbank",
    );
  });

  it("isQuestionLike matches ?-suffix and interrogatives", () => {
    expect(isQuestionLike("How long do braces take")).toBe(true);
    expect(isQuestionLike("braces in burbank")).toBe(false);
    expect(isQuestionLike("tell me about braces")).toBe(false);
    expect(isQuestionLike("Will my insurance cover this?")).toBe(true);
    expect(isQuestionLike("")).toBe(false);
  });
});

// ── edit_title generator ──────────────────────────────────────────────────

describe("Phase 6A.1.9 — edit_title generator", () => {
  it("positive: proposes a title rewrite when current title misses cluster keyword", () => {
    const packet = buildPacket();
    // current title is "Braces · Acme" — missing "teen" from cluster
    // "teen braces"
    const edits = generateEditTitle(packet);
    expect(edits).toHaveLength(1);
    const e = edits[0];
    expect(e.actionType).toBe("edit_title");
    expect(e.targetUrl).toBe(URL_BRACES);
    expect(e.targetElement?.elementKey).toBe("title[0]:hash-title");
    expect(e.targetElement?.currentText).toBe("Braces · Acme");
    expect(e.targetElement?.proposedText).toBeTruthy();
    expect(e.targetElement?.proposedText?.toLowerCase()).toContain("teen");
    expect(e.difficulty).toBe("low");
    expect(e.confidence).toBe("medium");
    expect(e.source).toBe("deterministic");
    expect(e.providerName).toBe("deterministic");
    expect(e.model).toBeNull();
    expect(e.costUsd).toBeNull();
  });

  it("negative: returns [] when title already contains every cluster token", () => {
    const packet = buildPacket({
      ownedPageInventory: [
        makeInventoryEntry(URL_BRACES, {
          title: "Teen Braces · Acme",
          h1: "Braces",
          h2s: ["Treatment timeline"],
          detectedService: "braces",
        }),
      ],
      pageElementInventory: [
        makeElement({
          url: URL_BRACES,
          element_type: "title",
          element_key: "title[0]:hash-titleA",
          element_text: "Teen Braces · Acme",
        }),
      ],
    });
    expect(generateEditTitle(packet)).toEqual([]);
  });

  it("negative: returns [] when no title element exists in the inventory", () => {
    const packet = buildPacket({
      pageElementInventory: [
        makeElement({
          url: URL_BRACES,
          element_type: "h1",
          element_key: "h1[0]:hash-h1",
          element_text: "Braces",
        }),
      ],
    });
    expect(generateEditTitle(packet)).toEqual([]);
  });

  it("negative: returns [] when clusterLabel is null", () => {
    const packet = buildPacket({
      clusterLabel: null,
      clusterKind: null,
    });
    expect(generateEditTitle(packet)).toEqual([]);
  });

  it("negative: returns [] when edit_title is not in allowedActionTypes", () => {
    const packet = buildPacket();
    // Override post-build to drop edit_title from allowed list.
    const restricted: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: ["add_faq", "add_h2_section"],
    };
    expect(generateEditTitle(restricted)).toEqual([]);
  });
});

// ── add_h2_section generator ──────────────────────────────────────────────

describe("Phase 6A.1.9 — add_h2_section generator", () => {
  it("positive: proposes H2 targeting top competitor when no H2 mentions them", () => {
    const packet = buildPacket();
    const edits = generateAddH2Section(packet);
    expect(edits).toHaveLength(1);
    const e = edits[0];
    expect(e.actionType).toBe("add_h2_section");
    expect(e.targetUrl).toBe(URL_BRACES);
    expect(e.targetElement?.elementKey.startsWith("h2[new]:")).toBe(true);
    expect(e.targetElement?.proposedText?.toLowerCase()).toContain(
      "acmeortho",
    );
    expect(e.targetElement?.currentText).toBeNull();
    expect(e.difficulty).toBe("low");
    expect(e.confidence).toBe("medium");
  });

  it("positive (fallback): proposes cluster-themed H2 when no competitor angle exists", () => {
    const packet = buildPacket({
      primarySummaries: [
        makeSummary("prompt-1", { primaryCompetitors: [] }),
      ],
    });
    const edits = generateAddH2Section(packet);
    expect(edits).toHaveLength(1);
    expect(edits[0].targetElement?.proposedText?.toLowerCase()).toContain(
      "teen braces",
    );
  });

  it("negative: returns [] when an existing H2 already mentions the competitor", () => {
    const packet = buildPacket({
      pageElementInventory: [
        makeElement({
          url: URL_BRACES,
          element_type: "title",
          element_key: "title[0]:hash-title",
          element_text: "Braces · Acme",
        }),
        makeElement({
          url: URL_BRACES,
          element_type: "h2",
          element_key: "h2[0]:hash-h2a",
          element_text: "Why we beat AcmeOrtho",
        }),
      ],
    });
    expect(generateAddH2Section(packet)).toEqual([]);
  });

  it("negative: returns [] when no competitorAngles AND no clusterLabel", () => {
    const packet = buildPacket({
      clusterLabel: null,
      clusterKind: null,
      primarySummaries: [makeSummary("prompt-1", { primaryCompetitors: [] })],
    });
    expect(generateAddH2Section(packet)).toEqual([]);
  });

  it("negative: returns [] when add_h2_section is not in allowedActionTypes", () => {
    const packet = buildPacket();
    const restricted: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: ["edit_title", "add_faq"],
    };
    expect(generateAddH2Section(restricted)).toEqual([]);
  });
});

// ── add_faq generator ─────────────────────────────────────────────────────

describe("Phase 6A.1.9 — add_faq generator", () => {
  it("positive: proposes FAQ for a question-shaped prompt with no existing FAQ coverage", () => {
    const packet = buildPacket();
    const edits = generateAddFaq(packet);
    expect(edits).toHaveLength(1);
    const e = edits[0];
    expect(e.actionType).toBe("add_faq");
    expect(e.targetUrl).toBe(URL_BRACES);
    expect(e.targetElement?.elementKey.startsWith("faq_question[new]:")).toBe(
      true,
    );
    expect(e.targetElement?.currentText).toBeNull();
    expect(e.targetElement?.proposedText).toContain("Q:");
    expect(e.targetElement?.proposedText).toContain("A:");
    expect(e.difficulty).toBe("low");
    expect(e.confidence).toBe("medium");
  });

  it("negative: skips prompts that aren't question-shaped", () => {
    const packet = buildPacket({
      trackedPrompts: [makePrompt("prompt-1", "best teen braces options")],
    });
    expect(generateAddFaq(packet)).toEqual([]);
  });

  it("negative: returns [] when an existing FAQ on the page covers the prompt's tokens", () => {
    const packet = buildPacket({
      pageElementInventory: [
        makeElement({
          url: URL_BRACES,
          element_type: "title",
          element_key: "title[0]:hash-title",
          element_text: "Braces · Acme",
        }),
        makeElement({
          url: URL_BRACES,
          element_type: "faq_question",
          element_key: "faq_question[0]:hash-q",
          element_text: "What are the best teen braces options for my child?",
        }),
      ],
    });
    expect(generateAddFaq(packet)).toEqual([]);
  });

  it("negative: returns [] when add_faq is not in allowedActionTypes", () => {
    const packet = buildPacket();
    const restricted: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: ["edit_title", "add_h2_section"],
    };
    expect(generateAddFaq(restricted)).toEqual([]);
  });

  it("negative: returns [] when no candidate URLs exist", () => {
    const packet = buildPacket({ ownedPageInventory: [] });
    expect(generateAddFaq(packet)).toEqual([]);
  });
});

// ── Cross-generator invariants ────────────────────────────────────────────

describe("Phase 6A.1.9 — cross-generator invariants", () => {
  it("no generator emits a targetUrl outside packet.allowedTargetUrls", () => {
    const packet = buildPacket();
    const allEdits: SpecificEdit[] = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    expect(allEdits.length).toBeGreaterThan(0);
    for (const e of allEdits) {
      expect(packet.allowedTargetUrls).toContain(e.targetUrl);
    }
  });

  it("no generator emits an actionType outside packet.allowedActionTypes", () => {
    const packet = buildPacket();
    const allEdits: SpecificEdit[] = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    for (const e of allEdits) {
      expect(packet.allowedActionTypes).toContain(e.actionType);
    }
  });

  it("every emitted actionType is a valid ACTION_TYPES enum member", () => {
    const packet = buildPacket();
    const allEdits: SpecificEdit[] = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    for (const e of allEdits) {
      expect(ACTION_TYPES).toContain(e.actionType);
    }
  });

  it("targetElement.elementKey is from inventory for edit_title and h2[new]/faq_question[new] for adds", () => {
    const packet = buildPacket();
    const titleEdits = generateEditTitle(packet);
    for (const e of titleEdits) {
      // edit_title key MUST come from the inventory for that URL.
      const inventoryKeys = packet.targetPageElements
        .filter((el) => el.url === e.targetUrl && el.elementType === "title")
        .map((el) => el.elementKey);
      expect(inventoryKeys).toContain(e.targetElement?.elementKey);
    }
    const h2Edits = generateAddH2Section(packet);
    for (const e of h2Edits) {
      expect(e.targetElement?.elementKey.startsWith("h2[new]:")).toBe(true);
    }
    const faqEdits = generateAddFaq(packet);
    for (const e of faqEdits) {
      expect(
        e.targetElement?.elementKey.startsWith("faq_question[new]:"),
      ).toBe(true);
    }
  });

  it("all generator outputs are JSON-serializable + round-trip", () => {
    const packet = buildPacket();
    const allEdits = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    const json = JSON.stringify(allEdits);
    expect(JSON.parse(json)).toEqual(allEdits);
  });

  it("does not mutate the input packet", () => {
    const packet = buildPacket();
    const before = JSON.stringify(packet);
    generateEditTitle(packet);
    generateAddH2Section(packet);
    generateAddFaq(packet);
    expect(JSON.stringify(packet)).toBe(before);
  });

  it("same packet → same generator output (deterministic)", () => {
    const packet = buildPacket();
    const a = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    const b = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── No tenant-specific (Ritz) hardcoding ──────────────────────────────────

describe("Phase 6A.1.9 — no Ritz hardcoding", () => {
  it("none of the generator output strings contain 'ritz' / 'palo alto' / 'menlo park'", () => {
    const packet = buildPacket();
    const allEdits = [
      ...generateEditTitle(packet),
      ...generateAddH2Section(packet),
      ...generateAddFaq(packet),
    ];
    const blob = JSON.stringify(allEdits).toLowerCase();
    expect(blob).not.toMatch(/\britz\b/);
    expect(blob).not.toMatch(/\bpalo alto\b/);
    expect(blob).not.toMatch(/\bmenlo park\b/);
    expect(blob).not.toMatch(/\bbay area\b/);
  });

  it("generator source files do NOT contain Ritz / brand-specific tokens", () => {
    const dir = resolve(__dirname);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8").toLowerCase();
      expect(src).not.toMatch(/\britz\b/);
      expect(src).not.toMatch(/\bpalo alto\b/);
      expect(src).not.toMatch(/\bmenlo park\b/);
      expect(src).not.toMatch(/\bbay area\b/);
    }
  });
});

// ── Deterministic provider integration ────────────────────────────────────

describe("Phase 6A.1.9 — deterministic provider aggregation", () => {
  it("provider.generate aggregates all 3 generators in stable order", async () => {
    const packet = buildPacket();
    const direct = runDeterministicGenerators(packet);
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.recommendations).toEqual(direct);
    expect(bundle.recommendations.length).toBeGreaterThan(0);
    // Order is edit_title → add_h2_section → add_faq.
    const types = bundle.recommendations.map((e) => e.actionType);
    const idxTitle = types.indexOf("edit_title");
    const idxH2 = types.indexOf("add_h2_section");
    const idxFaq = types.indexOf("add_faq");
    if (idxTitle >= 0 && idxH2 >= 0) expect(idxTitle).toBeLessThan(idxH2);
    if (idxH2 >= 0 && idxFaq >= 0) expect(idxH2).toBeLessThan(idxFaq);
  });

  it("totalCostUsd stays 0 — deterministic generators spend no tokens", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.totalCostUsd).toBe(0);
  });

  it("empty packet returns an empty recommendations array", async () => {
    const empty = buildSpecificEditEvidencePacket({
      tenantId: TENANT,
      recId: REC,
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
    const bundle = await deterministicProvider.generate(empty);
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.totalCostUsd).toBe(0);
  });

  it("provider does not mutate the input packet", async () => {
    const packet = buildPacket();
    const before = JSON.stringify(packet);
    await deterministicProvider.generate(packet);
    expect(JSON.stringify(packet)).toBe(before);
  });

  it("bundle is fully JSON-serializable + round-trips losslessly", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const json = JSON.stringify(bundle);
    expect(JSON.parse(json)).toEqual(bundle);
  });

  it("threads tenantId / recId / evidenceHash from packet (already proven in P8 — re-asserted here for the populated path)", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.tenantId).toBe(packet.tenantId);
    expect(bundle.recId).toBe(packet.recId);
    expect(bundle.evidenceHash).toBe(packet.evidenceHash);
  });
});

// ── Source-scan invariants ────────────────────────────────────────────────

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

describe("Phase 6A.1.9 — generator never runs on render", () => {
  it("no app route page.tsx or route.ts imports any generator or runDeterministicGenerators", () => {
    const appDir = resolve(__dirname, "../../../../app");
    const matches = walkSync(
      appDir,
      (p) => p.endsWith("/page.tsx") || p.endsWith("/route.ts"),
    );
    const offenders: string[] = [];
    for (const file of matches) {
      const src = readFileSync(file, "utf8");
      if (
        /\bgenerateEditTitle\b/.test(src) ||
        /\bgenerateAddH2Section\b/.test(src) ||
        /\bgenerateAddFaq\b/.test(src) ||
        /\brunDeterministicGenerators\b/.test(src) ||
        /from\s+["'][^"']*recommendations\/providers\/generators/.test(src)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("generator files do NOT import the openai SDK or @anthropic-ai/sdk", () => {
    const dir = resolve(__dirname);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/from\s+["']openai["']/);
      expect(src).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
    }
  });
});
