import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 5 (2026-04-24) — Accept → changelog truth contract per action type.
 *
 * For each of the 8 possible actions, verify what `acceptRecommendation`
 * does: which actions stamp a changelog entry, what fields they pass, and
 * which fields are populated in notes. Locks the decision-loop shape so
 * accidental regressions get caught before the operator clicks Accept.
 *
 * Operator-stated rules (see Phase 5 request):
 *   strengthen_existing_page    → stamp, URL = resolved
 *   expand_existing_page        → stamp, URL = resolved
 *   add_section_or_faq          → stamp, URL = resolved
 *   create_new_page             → stamp, URL = null, carry proposedSlug + pageBrief
 *   merge_or_dedupe             → stamp iff canonical URL explicit (current
 *                                 behavior: stamps — target URL is always
 *                                 explicit for the action)
 *   split_or_separate_page      → NO stamp
 *   needs_review                → NO stamp
 *   watch                       → NO stamp
 *
 *   Shared requirements:
 *     - asset_name = resolved title (Strengthen / Expand / Add / Merge /
 *       Create), never raw generator title, never contains "Shield:"
 *     - hypothesis_source = "recommendation"
 *     - URL must be the resolved URL or null — the NEEDS_NEW_PAGE
 *       sentinel must never leak
 *     - notes carry action, motive, confidence, reasoning, brief, edits,
 *       risks, proposedSlug (sanitized)
 */

// ── capture state across calls ─────────────────────────────────────────
let capturedFormData: Record<string, string> | null = null;
let createChangelogCalls = 0;
let hypothesisCalls: Array<{
  id: string;
  hypothesis: string | null;
  source: "operator" | "recommendation" | "inferred" | "manual";
}> = [];

vi.mock("@/domains/changelog/actions", () => ({
  createChangelogEntry: vi.fn(async (formData: FormData) => {
    createChangelogCalls += 1;
    const captured: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      captured[k] = typeof v === "string" ? v : String(v);
    }
    capturedFormData = captured;
    return { success: true, changeId: "cl-test" };
  }),
  updateChangelogHypothesis: vi.fn(
    async (
      id: string,
      hypothesis: string | null,
      source: "operator" | "recommendation" | "inferred" | "manual" = "operator",
    ) => {
      hypothesisCalls.push({ id, hypothesis, source });
      return { success: true };
    },
  ),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/domains/product/recommendation-response-store", () => ({
  recommendationResponses: [],
  recordResponse: vi.fn(),
  persistResponses: vi.fn(async () => {}),
  ensureRecommendationResponsesSeeded: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── helpers ────────────────────────────────────────────────────────────

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    stableKey: "k-test",
    type: "create_cluster_page" as const,
    title: "Create a Luxury Home Builder Bay Area page",
    description: "Cluster has no owned URL cited yet.",
    clusterLabel: "Luxury Home Builder Bay Area",
    clusterKind: "topic" as const,
    ...overrides,
  };
}

const RESOLVED_LUXURY_URL =
  "https://ritzbuilders.com/luxury-home-builder-bay-area";

async function callAccept(payload: Record<string, unknown>) {
  const { acceptRecommendation } = await import(
    "@/app/(shell)/recommendations/actions"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return acceptRecommendation(payload as any);
}

describe("Phase 5 — Accept → changelog per action type", () => {
  beforeEach(() => {
    capturedFormData = null;
    createChangelogCalls = 0;
    hypothesisCalls = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── stamping actions (5) ─────────────────────────────────────────────

  it("strengthen_existing_page: stamps changelog with resolved URL, resolved title, hypothesis_source=recommendation", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "strengthen_existing_page",
          motive: "improve_close_prompt",
          targetUrl: RESOLVED_LUXURY_URL,
          reasoning: "AI already cites this page on most prompts in the cluster.",
          specificRecommendation: "Tighten lead copy with luxury descriptors.",
        },
      }),
    );
    expect(createChangelogCalls).toBe(1);
    expect(capturedFormData!.asset_name).toMatch(/^Strengthen /);
    expect(capturedFormData!.asset_name).not.toMatch(/Shield:/);
    expect(capturedFormData!.url).toBe(RESOLVED_LUXURY_URL);
    expect(capturedFormData!.signal_type).toBe("content");
    expect(hypothesisCalls).toHaveLength(1);
    expect(hypothesisCalls[0].source).toBe("recommendation");
  });

  it("expand_existing_page: stamps changelog with resolved URL", async () => {
    await callAccept(
      basePayload({
        clusterLabel: "Palo Alto",
        clusterKind: "geo",
        resolution: {
          action: "expand_existing_page",
          motive: "capture_absent_cluster",
          targetUrl: "https://ritzbuilders.com/locations/palo-alto",
          reasoning: "Partial coverage — expand to cover the full cluster.",
        },
      }),
    );
    expect(createChangelogCalls).toBe(1);
    expect(capturedFormData!.asset_name).toMatch(/^Expand /);
    expect(capturedFormData!.url).toBe("https://ritzbuilders.com/locations/palo-alto");
    expect(capturedFormData!.signal_type).toBe("content");
    expect(capturedFormData!.asset_type).toBe("city_page");
  });

  it("add_section_or_faq: stamps changelog with resolved URL, signal_type=technical", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "add_section_or_faq",
          motive: "improve_citation_depth",
          targetUrl: RESOLVED_LUXURY_URL,
          reasoning: "Page exists; missing a specific angle.",
        },
      }),
    );
    expect(createChangelogCalls).toBe(1);
    expect(capturedFormData!.asset_name).toMatch(/^Add section /);
    expect(capturedFormData!.url).toBe(RESOLVED_LUXURY_URL);
    expect(capturedFormData!.signal_type).toBe("technical");
  });

  it("merge_or_dedupe: stamps with resolved target URL + signal_type=technical", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "merge_or_dedupe",
          motive: "resolve_cannibalization",
          targetUrl: "https://ritzbuilders.com/custom-home-builder-bay-area",
          reasoning: "Two owned pages competing on this cluster.",
        },
      }),
    );
    expect(createChangelogCalls).toBe(1);
    expect(capturedFormData!.asset_name).toMatch(/^Merge /);
    expect(capturedFormData!.url).toBe(
      "https://ritzbuilders.com/custom-home-builder-bay-area",
    );
    expect(capturedFormData!.signal_type).toBe("technical");
  });

  it("create_new_page: stamps with URL null (NEEDS_NEW_PAGE sentinel filtered), proposedSlug + pageBrief in notes", async () => {
    await callAccept(
      basePayload({
        clusterLabel: "Totally Missing Cluster",
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          reasoning: "No owned page covers this cluster.",
          proposedSlug: "totally-missing-cluster-bay-area",
          pageBrief: {
            recommendedTitle: "Totally Missing Cluster Bay Area",
            recommendedH1: "Totally Missing Cluster | Ritz Builders",
            mustCoverAngles: ["angle1", "angle2"],
            competitorAnglesToCounter: ["counter1"],
            internalLinksToAdd: ["/locations/palo-alto"],
          },
        },
      }),
    );
    expect(createChangelogCalls).toBe(1);
    expect(capturedFormData!.asset_name).toMatch(/^Create a /);
    // NEEDS_NEW_PAGE sentinel filtered out of the url field.
    expect(capturedFormData!.url).toBeUndefined();
    expect(capturedFormData!.signal_type).toBe("page");
    // Notes carry the proposed slug and the brief.
    expect(capturedFormData!.notes).toBeDefined();
    expect(capturedFormData!.notes).toMatch(/totally-missing-cluster-bay-area/);
    expect(capturedFormData!.notes).toMatch(/Totally Missing Cluster Bay Area/);
    expect(capturedFormData!.notes).toMatch(/angle1/);
  });

  // ── non-stamping actions (3) ─────────────────────────────────────────

  it("split_or_separate_page: does NOT auto-create changelog", async () => {
    const res = await callAccept(
      basePayload({
        resolution: {
          action: "split_or_separate_page",
          motive: "capture_absent_cluster",
          targetUrl: "https://ritzbuilders.com/services/build-on-your-lot",
          reasoning: "Bundled — needs operator split decision.",
        },
      }),
    );
    expect(res.success).toBe(true);
    expect(createChangelogCalls).toBe(0);
    expect(hypothesisCalls).toHaveLength(0);
  });

  it("needs_review: does NOT auto-create changelog", async () => {
    const res = await callAccept(
      basePayload({
        resolution: {
          action: "needs_review",
          motive: "capture_absent_cluster",
          targetUrl: "https://ritzbuilders.com/locations/los-altos",
          reasoning: "Bundled with Los Altos Hills.",
        },
      }),
    );
    expect(res.success).toBe(true);
    expect(createChangelogCalls).toBe(0);
    expect(hypothesisCalls).toHaveLength(0);
  });

  it("watch: does NOT auto-create changelog", async () => {
    const res = await callAccept(
      basePayload({
        type: "watch_winning_cluster",
        resolution: {
          action: "watch",
          motive: "defend_winning_cluster",
          targetUrl: "needs_new_page",
          reasoning: "You already win this cluster.",
        },
      }),
    );
    expect(res.success).toBe(true);
    expect(createChangelogCalls).toBe(0);
  });

  it("watch_winning_cluster candidate type (no resolution): does NOT auto-create", async () => {
    const res = await callAccept(
      basePayload({
        type: "watch_winning_cluster",
        // no resolution at all — safety net for older records
      }),
    );
    expect(res.success).toBe(true);
    expect(createChangelogCalls).toBe(0);
  });

  // ── sanitization + notes contract ────────────────────────────────────

  it("asset_name never contains raw generator 'Create a ...' when action is not create", async () => {
    await callAccept(
      basePayload({
        title: "Create a Shield: Luxury Home Builder Bay Area page",
        clusterLabel: "Shield: Luxury Home Builder Bay Area",
        resolution: {
          action: "strengthen_existing_page",
          motive: "improve_close_prompt",
          targetUrl: RESOLVED_LUXURY_URL,
          reasoning: "strong coverage",
        },
      }),
    );
    expect(capturedFormData!.asset_name).not.toMatch(/^Create /);
    expect(capturedFormData!.asset_name).not.toMatch(/Shield:/);
  });

  it("topic_targeted and city_targeted are sanitized (no Shield:/Internal: prefix)", async () => {
    await callAccept(
      basePayload({
        clusterLabel: "Shield: Palo Alto",
        clusterKind: "geo",
        resolution: {
          action: "strengthen_existing_page",
          motive: "improve_close_prompt",
          targetUrl: "https://ritzbuilders.com/locations/palo-alto",
          reasoning: "strong coverage",
        },
      }),
    );
    // clusterKind = geo → city_targeted populated, topic_targeted fallback.
    expect(capturedFormData!.city_targeted ?? "").not.toMatch(/Shield:/);
    expect(capturedFormData!.topic_targeted ?? "").not.toMatch(/Shield:/);
  });

  it("notes include action, motive, confidence, reasoning, brief, edits, risks", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "strengthen_existing_page",
          motive: "improve_close_prompt",
          targetUrl: RESOLVED_LUXURY_URL,
          reasoning: "AI already cites this page on most prompts in the cluster.",
          confidence: "medium",
          specificRecommendation: "Tighten the H1 with luxury descriptors.",
          suggestedEdits: [
            {
              type: "copy",
              scope: "h1",
              title: "H1 tighten",
              body: "Replace with: Luxury Custom Home Builders Bay Area",
              why: "AI cites competitors using 'luxury custom' phrasing",
            },
          ],
          risks: ["Brand voice drift if rushed."],
        },
      }),
    );
    const notes = capturedFormData!.notes ?? "";
    expect(notes).toMatch(/action/i);
    expect(notes).toMatch(/strengthen_existing_page/);
    expect(notes).toMatch(/motive/i);
    expect(notes).toMatch(/improve_close_prompt/);
    expect(notes).toMatch(/confidence/i);
    expect(notes).toMatch(/reasoning/i);
    expect(notes).toMatch(/AI already cites this page/);
    expect(notes).toMatch(/Tighten the H1/);
    expect(notes).toMatch(/Luxury Custom Home Builders Bay Area/);
    expect(notes).toMatch(/Brand voice drift/);
  });

  it("notes are sanitized — Shield:/Internal: prefixes do not reach changelog notes", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "strengthen_existing_page",
          motive: "improve_close_prompt",
          targetUrl: RESOLVED_LUXURY_URL,
          reasoning: "Shield: internal-taxonomy leak here",
          specificRecommendation: "Shield: another leak",
          suggestedEdits: [
            {
              type: "copy",
              scope: "h1",
              title: "Shield: leaky title",
              body: "Internal: leaky body",
              why: "Shield: leaky why",
            },
          ],
          risks: ["Internal: leaky risk"],
        },
      }),
    );
    const notes = capturedFormData!.notes ?? "";
    expect(notes).not.toMatch(/Shield:/);
    expect(notes).not.toMatch(/Internal:/);
  });

  it("url field never carries the NEEDS_NEW_PAGE sentinel string", async () => {
    await callAccept(
      basePayload({
        resolution: {
          action: "create_new_page",
          motive: "capture_absent_cluster",
          targetUrl: "needs_new_page",
          reasoning: "r",
        },
      }),
    );
    // undefined or empty, but never the sentinel
    expect(capturedFormData!.url ?? "").not.toBe("needs_new_page");
  });
});
