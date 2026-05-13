/**
 * P0 — 2026-05-13 (signed-in production bug).
 *
 * The earlier resolver invariant + the route-id round-trip test used
 * SYNTHETIC row.id strings. Both passed. The user nonetheless reports
 * that EVERY visible Recommendation card lands on the
 * "replaced or already handled" state in real signed-in production.
 *
 * This test is the missing piece — it exercises the FULL pipeline:
 *
 *   1. construct a realistic persisted-loader-shaped queue
 *   2. run the actual `buildRecommendationActionRows({ queue, promptTextById })`
 *   3. for EVERY emitted row.id:
 *        a. encode via `encodeRecommendationRouteId(row.id)`
 *        b. simulate Next.js's path-segment decoding (decodeURIComponent)
 *        c. trim through `decodeRecommendationRouteId`
 *        d. resolve via `resolveRecommendationDetail(allRows, decoded)`
 *        e. assert the resolution is `kind: "exact"` AND the row is the
 *           same one we started from
 *
 * If this test FAILS locally, there is a code bug — encoding,
 * decoding, the builder, or the resolver disagree on identity.
 *
 * If it PASSES locally but production still 100% misses, the bug is
 * either in production-only data shapes (the
 * /api/diagnostics/recs-resolver endpoint will surface them) or in a
 * Next/RSC cache layer this test doesn't simulate.
 */

import { describe, expect, it } from "vitest";

import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import {
  encodeRecommendationRouteId,
  decodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import type { LiveRecQueueItem } from "@/domains/recommendations/load-queue";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// ─────────────────────────────────────────────────────────────────────
// Synthesize a queue item the same way the persisted loader does.
// ─────────────────────────────────────────────────────────────────────

function synthesizeQueueItem(
  recId: string,
  edits: Array<Partial<RecommendedEditRow> & {
    action_type: RecommendedEditRow["action_type"];
    target_element_key: string | null;
  }>,
): {
  rec: LiveRecQueueItem;
  response: null;
  edits: RecommendedEditRow[];
} {
  const fullEdits: RecommendedEditRow[] = edits.map((e, idx) => ({
    id: `${recId}__${e.action_type}__${e.target_element_key ?? "null"}`,
    tenant_id: "tenant-fixture",
    rec_id: recId,
    action_type: e.action_type,
    target_url: e.target_url ?? "https://example.com/services/page",
    target_element_key: e.target_element_key,
    display_label: e.display_label ?? `display ${idx}`,
    current_text: e.current_text ?? null,
    proposed_text: e.proposed_text ?? `Proposed text ${idx}`,
    why: e.why ?? "Synthetic why",
    evidence: e.evidence ?? [],
    expected_impact: e.expected_impact ?? null,
    difficulty: e.difficulty ?? "low",
    confidence: e.confidence ?? "medium",
    measurement_plan: e.measurement_plan ?? null,
    risks: e.risks ?? [],
    source: e.source ?? "openai",
    provider_name: e.provider_name ?? "openai",
    evidence_hash: e.evidence_hash ?? "h",
    model: e.model ?? "gpt-5-mini",
    cost_usd: e.cost_usd ?? null,
    created_at: e.created_at ?? new Date().toISOString(),
    updated_at: e.updated_at ?? new Date().toISOString(),
    implementation_status: e.implementation_status ?? "recommended",
    live_at: e.live_at ?? null,
    live_snapshot_id: e.live_snapshot_id ?? null,
    live_match_confidence: e.live_match_confidence ?? null,
    live_match_kind: e.live_match_kind ?? null,
    live_element_key: e.live_element_key ?? null,
    not_found_reason: e.not_found_reason ?? null,
  }));
  const rec = {
    stableKey: recId,
    type: "create_cluster_page",
    title: `Synthetic title for ${recId}`,
    description: "synthetic",
    affectedPromptIds: ["p-1", "p-2"],
    clusterLabel: "Cluster",
    clusterKind: "geo",
    evidence: {
      promptCount: 2,
      observationCount: 4,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 50,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity: "medium",
    effort: "low",
    score: 5,
    tier: "now",
    rank: 1,
    reasoning: "synthetic",
    resolution: {
      action: "expand_existing_page",
      motive: "improve_close_prompt",
      targetUrl: "https://example.com/services/page",
      confidence: "medium",
      confidenceReason: "synthetic",
      reasoning: "synthetic",
      tier: "deterministic_only",
      evidenceRefs: [],
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      needsHumanReview: false,
    },
    engineConfidence: { confidence: "medium", reasons: [] },
  } as unknown as LiveRecQueueItem;
  return { rec, response: null, edits: fullEdits };
}

// ─────────────────────────────────────────────────────────────────────
// Adversarial rec-id corpus — every shape we have evidence for in
// production fixtures + the operator's reported URL.
// ─────────────────────────────────────────────────────────────────────

const CORPUS: Array<{
  recId: string;
  edits: Array<{
    action_type: RecommendedEditRow["action_type"];
    target_element_key: string | null;
  }>;
}> = [
  // The operator's reported URL shape.
  {
    recId: "create_cluster_page:geo:Palo Alto",
    edits: [
      { action_type: "add_h2_section", target_element_key: "h2[new]:paloalto1a2b3c4d" },
    ],
  },
  // FAQ-pair shape — a paired Q+A produces ONE grouped row whose id is
  // `${stableKey}::faq-pair::${hash}`, not `${stableKey}::${edit.id}`.
  {
    recId: "create_cluster_page:geo:Los Altos",
    edits: [
      {
        action_type: "add_faq",
        target_element_key: "faq_question[new]:d1b049c63d8a",
      },
      {
        action_type: "add_faq",
        target_element_key: "faq_answer[new]:d1b049c63d8a",
      },
    ],
  },
  // Multi-edit rec — title + meta + h2.
  {
    recId: "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)",
    edits: [
      { action_type: "edit_title", target_element_key: "title-1" },
      { action_type: "edit_meta", target_element_key: "meta-1" },
      { action_type: "add_h2_section", target_element_key: "h2[new]:abcd1234" },
    ],
  },
  // Adversarial: spaces, brackets, single-edit fallback.
  {
    recId: "rec-explore-brief-fix-8",
    edits: [
      { action_type: "add_h2_section", target_element_key: "h2[new]:abc" },
    ],
  },
  // Schema-finding shape from production rows.
  {
    recId: "schema_missing_for_page_type-/available-homes-obs-1776550666639",
    edits: [
      { action_type: "add_schema", target_element_key: "schema-LocalBusiness" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// THE TEST
// ─────────────────────────────────────────────────────────────────────

describe("INTEGRATION — every emitted row.id round-trips through encode → Next decode → resolver", () => {
  // Build the realistic queue + emit rows once for the entire suite.
  const queue = CORPUS.map((c) => synthesizeQueueItem(c.recId, c.edits));
  const promptTextById = { "p-1": "prompt 1 text", "p-2": "prompt 2 text" };
  const allRows = buildRecommendationActionRows({ queue, promptTextById });

  it("emits at least one row per fixture rec (sanity check on fixture shape)", () => {
    // If this drops to zero, the fixture is wrong — not the resolver.
    expect(allRows.length).toBeGreaterThanOrEqual(CORPUS.length);
  });

  it("legacy Next 13/14/15 path — every emitted row resolves exactly through pre-decoded params.id", () => {
    const misses: Array<{
      title: string;
      rowId: string;
      encoded: string;
      decoded: string | null;
      resolutionKind: string;
    }> = [];

    for (const row of allRows) {
      const encoded = encodeRecommendationRouteId(row.id);
      // Legacy Next 13/14/15: framework auto-decodes once before
      // handing params.id to the page.
      const nextSegment = decodeURIComponent(encoded);
      const decoded = decodeRecommendationRouteId(nextSegment);
      const result =
        decoded === null
          ? null
          : resolveRecommendationDetail(allRows, decoded);

      if (
        result === null ||
        result.kind !== "exact" ||
        result.row.id !== row.id
      ) {
        misses.push({
          title: row.title,
          rowId: row.id,
          encoded,
          decoded: decoded ?? "(null)",
          resolutionKind: result === null ? "decode_failed" : result.kind,
        });
      }
    }
    expect(misses).toEqual([]);
  });

  it("Next 16 path — every emitted row resolves exactly when params.id arrives PERCENT-ENCODED", () => {
    // 2026-05-13 P0 runtime evidence — the operator's detail-route
    // debug panel showed `params.id (raw)` arriving percent-encoded
    // from a v2 card click. Next 16 client-side navigation no longer
    // auto-decodes the path segment. The decoder must handle that
    // case, and the resolver must reach exact match.
    const misses: Array<{
      title: string;
      rowId: string;
      encoded: string;
      decoded: string | null;
      resolutionKind: string;
    }> = [];

    for (const row of allRows) {
      const encoded = encodeRecommendationRouteId(row.id);
      // Pass the ENCODED form directly — simulating Next 16's params.id.
      const decoded = decodeRecommendationRouteId(encoded);
      const result =
        decoded === null
          ? null
          : resolveRecommendationDetail(allRows, decoded);

      if (
        result === null ||
        result.kind !== "exact" ||
        result.row.id !== row.id
      ) {
        misses.push({
          title: row.title,
          rowId: row.id,
          encoded,
          decoded: decoded ?? "(null)",
          resolutionKind: result === null ? "decode_failed" : result.kind,
        });
      }
    }

    expect(
      misses,
      `\n  ${misses.length} row(s) failed Next-16-encoded-params round-trip.\n` +
        `  First miss:\n` +
        (misses[0]
          ? JSON.stringify(misses[0], null, 2)
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n")
          : "(none)"),
    ).toEqual([]);
  });

  it("every emitted row.id encodes to a path segment that is safe for the URL bar AND the Next.js router", () => {
    // Per RFC 3986, the sub-delims set (`!`, `$`, `&`, `'`, `(`, `)`,
    // `*`, `+`, `,`, `;`, `=`) is allowed in a URL path segment;
    // `encodeURIComponent` deliberately preserves `(`, `)`, `!`, `*`,
    // `'`, and `~`. The relevant safety contract is: the ROUND-TRIP
    // through encodeRecommendationRouteId → Next.js decode →
    // decodeRecommendationRouteId is lossless. The character-level
    // test below caught a real defect in an earlier draft and is kept
    // narrow to the truly-unsafe set: ` `, `/`, `?`, `#`, `[`, `]`.
    const offenders: Array<{ rowId: string; encoded: string; bad: string }> =
      [];
    for (const row of allRows) {
      const encoded = encodeRecommendationRouteId(row.id);
      const bad = encoded.match(/[\s/?#[\]]/);
      if (bad) offenders.push({ rowId: row.id, encoded, bad: bad[0] });
    }
    expect(offenders).toEqual([]);
  });

  it("the operator's reported Palo Alto URL pattern resolves through the pipeline when the underlying edit exists in the queue", () => {
    // Reproduces the exact URL pattern from the operator's report.
    const operatorEditId =
      "create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:paloalto1a2b3c4d";
    const operatorRowId = `create_cluster_page:geo:Palo Alto::${operatorEditId}`;
    const encoded = encodeRecommendationRouteId(operatorRowId);

    // Both transport modes (Next 13/14/15 pre-decoded, Next 16 encoded)
    // must converge to the operator row id.
    const legacyDecoded = decodeRecommendationRouteId(
      decodeURIComponent(encoded),
    );
    expect(legacyDecoded).toBe(operatorRowId);

    const next16Decoded = decodeRecommendationRouteId(encoded);
    expect(next16Decoded).toBe(operatorRowId);

    for (const decoded of [legacyDecoded, next16Decoded]) {
      const result = resolveRecommendationDetail(allRows, decoded!);
      expect(result.kind).toBe("exact");
      if (result.kind === "exact") {
        expect(result.row.id).toBe(operatorRowId);
      }
    }
  });
});
