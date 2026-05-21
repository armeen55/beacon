/**
 * Architecture invariant — Slice 4.5.D.α₁a — promotion writer
 * source pin.
 *
 * Pins:
 *   1. `SpecificEditSource` union has exactly 5 values:
 *      `"deterministic" | "deterministic_promotion" | "openai" |
 *       "anthropic" | "operator_edited"`. Drift breaks the contract.
 *   2. Mapper source code references `"deterministic_promotion"`.
 *   3. Mapper sets `source: "deterministic_promotion"` unconditionally
 *      on every produced row (verified behaviorally via
 *      `promotionResultToRecommendedEditRow` returning the locked
 *      constant).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  promotionResultToRecommendedEditRow,
  DETERMINISTIC_PROMOTION_SOURCE,
} from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import type { PromotionResult } from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PROVIDER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "specific-edit-provider.ts",
);
const MAPPER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "promotion-result-to-edit-row.ts",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

const NOW = new Date("2026-05-20T00:00:00.000Z");
const URL = "https://example.com/a";

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-x",
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: URL,
    topic_cluster_label: "metadata",
    evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
    confidence: "high",
    impact_estimate: "high",
    customer_copy: "x",
    operator_evidence: "x",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

function makeResult(partial: Partial<PromotionResult> = {}): PromotionResult {
  return {
    candidate: makeCandidate(),
    tier: "customer-queue-ready",
    eligible: true,
    suppression_reason: null,
    cooldown_expires_at: null,
    priority_score: 42,
    promotion_dedupe_key: "0123456789abcdef0123456789abcdef01234567",
    promotion_cooldown_key: "fedcba9876543210fedcba9876543210fedcba98",
    ...partial,
  };
}

describe("recommendation-intelligence-promotion-writer-source-pin", () => {
  it("SpecificEditSource union has the locked 5-value set", () => {
    const src = read(PROVIDER_FILE);
    // Match the union declaration block. Tolerant of inline comments.
    const match = src.match(
      /export type SpecificEditSource[\s\S]*?;/u,
    );
    expect(match).not.toBeNull();
    const unionBlock = match![0];
    for (const value of [
      '"deterministic"',
      '"deterministic_promotion"',
      '"openai"',
      '"anthropic"',
      '"operator_edited"',
    ]) {
      expect(
        unionBlock.includes(value),
        `SpecificEditSource union must contain ${value}`,
      ).toBe(true);
    }
  });

  it("SpecificEditSource union does NOT contain unexpected values", () => {
    const src = read(PROVIDER_FILE);
    const match = src.match(/export type SpecificEditSource[\s\S]*?;/u)![0];
    // Strip comments + extract quoted strings.
    const stripped = match
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const quoted = Array.from(stripped.matchAll(/"([^"]+)"/g)).map(
      (m) => m[1],
    );
    expect(new Set(quoted)).toEqual(
      new Set([
        "deterministic",
        "deterministic_promotion",
        "openai",
        "anthropic",
        "operator_edited",
      ]),
    );
  });

  it("mapper source references `\"deterministic_promotion\"` literal", () => {
    const src = read(MAPPER_FILE);
    expect(src).toContain('"deterministic_promotion"');
  });

  it("DETERMINISTIC_PROMOTION_SOURCE export resolves to `\"deterministic_promotion\"`", () => {
    expect(DETERMINISTIC_PROMOTION_SOURCE).toBe("deterministic_promotion");
  });

  it("mapper sets source: \"deterministic_promotion\" on every produced row", () => {
    // Parametric over the 3 valid confidence × happy paths.
    for (const confidence of ["high", "medium"] as const) {
      const row = promotionResultToRecommendedEditRow(
        makeResult({ candidate: makeCandidate({ confidence }) }),
        NOW,
      );
      expect(row).not.toBeNull();
      expect(row!.source).toBe("deterministic_promotion");
    }
  });
});
