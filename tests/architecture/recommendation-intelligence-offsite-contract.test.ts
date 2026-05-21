/**
 * Architecture invariant — Slice 4.5.F (2026-05-21):
 * Off-Site Shared Queue Contract.
 *
 * Pins the adapter `offSiteCandidateToCandidateRow` (Section 7's
 * `OffSiteCandidateAction` → Section 4.5's
 * `RecommendationCandidateRow`) + the `applyQueueRules` carve-out
 * that routes off-site rows to `diagnostic_only` (never to
 * `candidates`).
 *
 * Scope: source-text pins on the adapter file + behavioral pins
 * on adapter output + behavioral pin on `applyQueueRules`.
 *
 * Defense-in-depth alongside `recommendation-intelligence-no-
 * queue-write` (writer boundary), `recommendation-intelligence-
 * promotion-eligibility-pin` (off-site permanently "blocked"
 * tier), and `recommendation-intelligence-promotion-live-write-
 * guards` (operator-only live-write entry point).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { offSiteCandidateToCandidateRow } from "@/domains/off-site-authority/to-candidate-row";
import type { OffSiteCandidateAction } from "@/domains/off-site-authority/recommendation-rules";
import { applyQueueRules } from "@/domains/recommendation-intelligence/emitter/apply-queue-rules";
import { eligibilityForTrigger } from "@/domains/recommendation-intelligence/promotion-eligibility";
import { ACTION_TYPE_REGISTRY } from "@/domains/recommendations/action-types";
import type { ActionType } from "@/domains/recommendations/action-types";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ADAPTER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "off-site-authority",
  "to-candidate-row.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

function makeAction(
  overrides: Partial<OffSiteCandidateAction> = {},
): OffSiteCandidateAction {
  return {
    id: "gbp:claim_gbp",
    actionType: "claim_gbp",
    channel: "gbp",
    title: "Claim your Google Business Profile",
    rationale: "Beacon did not find a confirmed GBP for this tenant.",
    confidence: "high",
    source_note: "channel state: missing",
    manual_only: true,
    policy_risk: false,
    ...overrides,
  };
}

const CTX = {
  tenant_id: "tenant-x",
  generated_at: "2026-05-21T00:00:00.000Z",
};

describe("recommendation-intelligence-offsite-contract", () => {
  it("adapter file exists at the expected path", () => {
    expect(
      existsSync(ADAPTER_FILE),
      `Expected adapter at ${ADAPTER_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on to-candidate-row.ts", () => {
    const active = stripComments(read(ADAPTER_FILE));

    it("contains the LITERAL string `\"human_task\"`", () => {
      expect(active).toMatch(/['"]human_task['"]/);
    });

    it("sets `target_url: null` LITERAL", () => {
      expect(active).toMatch(/target_url\s*:\s*null/);
    });

    it("imports `OffSiteCandidateAction` from Section 7's recommendation-rules", () => {
      expect(active).toContain("./recommendation-rules");
      expect(active).toContain("OffSiteCandidateAction");
    });

    it("imports `RecommendationCandidateRow` from the emitter contract", () => {
      expect(active).toContain(
        "@/domains/recommendation-intelligence/emitter/candidate-row",
      );
      expect(active).toContain("RecommendationCandidateRow");
    });

    it("does NOT import `recommended-edits-persistence`", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference `runProviderAndPersist`", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT call `fetch(`", () => {
      expect(active).not.toMatch(/\bfetch\(/);
    });

    it("does NOT import from connectors / Supabase / persistence", () => {
      expect(active).not.toContain("@/lib/connectors");
      expect(active).not.toContain("@/lib/persistence");
    });

    it("does NOT import LLM providers", () => {
      expect(active).not.toContain("BEACON_LLM_PROVIDER");
      expect(active).not.toContain("openaiProvider");
      expect(active).not.toMatch(/\bOpenAI\(/);
      expect(active).not.toMatch(/\bAnthropic\(/);
    });

    it("does NOT contain a direct Supabase `recommended_edits` write shape", () => {
      const writeShape = new RegExp(
        "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
          "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
        "u",
      );
      expect(writeShape.test(active)).toBe(false);
    });
  });

  describe("behavioral contract on adapter output", () => {
    it.each(OFF_SITE_ACTION_TYPES)(
      "every (trigger_signal, action_type) emitted for %s returns `blocked` from eligibilityForTrigger (defense-in-depth pin)",
      (actionType) => {
        const row = offSiteCandidateToCandidateRow(
          makeAction({ actionType, id: `${actionType}:test` }),
          CTX,
        );
        expect(eligibilityForTrigger(row.trigger_signal, row.action_type)).toBe(
          "blocked",
        );
      },
    );

    it("every off-site action_type in the registry carries signalType: 'off_page_seo' (registry consistency pin)", () => {
      for (const actionType of OFF_SITE_ACTION_TYPES) {
        expect(
          ACTION_TYPE_REGISTRY[actionType].signalType,
          `${actionType} must have signalType: 'off_page_seo' for the applyQueueRules carve-out to detect it`,
        ).toBe("off_page_seo");
      }
    });

    it("adapter output never carries proposed_text-shape side fields (human_task only)", () => {
      const row = offSiteCandidateToCandidateRow(makeAction(), CTX);
      expect(row.generator_kind).toBe("human_task");
      expect(row.target_url).toBeNull();
    });
  });

  describe("applyQueueRules off-site routing contract", () => {
    function makeRow(
      action: OffSiteCandidateAction,
    ): RecommendationCandidateRow {
      return offSiteCandidateToCandidateRow(action, CTX);
    }

    it.each(OFF_SITE_ACTION_TYPES)(
      "applyQueueRules routes off-site %s rows to diagnostic_only (NEVER candidates), even at high confidence + no safety flags",
      (actionType) => {
        const row = makeRow(
          makeAction({
            actionType,
            id: `${actionType}:test`,
            confidence: "high",
            policy_risk: false,
          }),
        );
        const result = applyQueueRules([row]);
        expect(result.candidates).toHaveLength(0);
        expect(result.diagnostic_only).toHaveLength(1);
      },
    );
  });
});
