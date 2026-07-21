/**
 * Rec-list ENFORCEMENT layer (2026-06-16) — the operator's exact production
 * cases, pinned. The live `/recommendations` list exposed enforcement bugs:
 * a QA-rejected rec rendered "Suggested" + a one-tap "Accept" + "High", and
 * copy artifacts ("Add Add …", "Change the page title to …") reached the card.
 *
 * "A smart explanation on a bad recommendation is worse than none." So the LIST
 * must look expert BEFORE the operator clicks in: the deterministic QA verdict
 * (the final authority) decides the visible confidence, status pill, primary
 * CTA, and pushability — it can only LOWER/flag, never raise/revive a reject.
 *
 * These tests use Iranopedia-SHAPED fixtures (cities / Asiatic cheetah /
 * Pahlavi / Abbasid) ONLY as test data — there is zero tenant/keyword/brand
 * hardcoding in the product logic under test; the judgments come from the
 * generic evidence + intent-fit gate.
 */

import { describe, it, expect } from "vitest";

import { buildRecommendationQaVerdict } from "@/domains/recommendations/recommendation-qa";
import {
  dedupeDoubledWords,
  stripInstructionArtifactPrefix,
} from "@/domains/recommendations/copy-artifact-guard";
import { cleanDisplayLabel } from "@/domains/recommendations/recommendation-title-humanizer";
import type {
  ActionRowType,
  RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

const gscLine = (q: string): EvidenceLine => ({
  key: "headline_query",
  value: `“${q}”`,
  label: "shown · rank #6",
});

function row(o: {
  actionType?: ActionRowType;
  targetLabel?: string;
  targetUrl?: string | null;
  gsc?: EvidenceLine[];
  proposedText?: string | null;
}): RecommendationActionRow {
  return {
    actionType: o.actionType ?? "edit_title",
    targetLabel: o.targetLabel ?? "Abbasid Caliphate",
    targetUrl: o.targetUrl ?? "https://iranopedia.com/history/abbasid-caliphate",
    detail: {
      gscEvidenceLines: o.gsc ?? [],
      semrushEvidenceLines: [],
      clarityEvidenceLines: [],
      aeoEvidenceLines: [],
      topCompetitor: null,
      proposedText: o.proposedText ?? null,
      motiveLabel: null,
      observationCount: 0,
    },
  } as unknown as RecommendationActionRow;
}

describe("operator production cases — the gate rejects off-topic recs", () => {
  it("Asiatic Cheetah optimized for an unrelated query → rejected, never approvable", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Asiatic Cheetah",
        targetUrl: "https://iranopedia.com/wildlife/asiatic-cheetah",
        gsc: [gscLine("current time in tehran now")],
      }),
      affectedPromptTexts: [],
    });
    expect(v.confidence).toBe("rejected");
    expect(v.approve).toBe(false);
  });

  it("Pahlavi reject → the gate withholds approval", () => {
    // A confident topic mismatch (a transactional/unrelated query on the
    // dynasty page) is rejected by the gate → downstream surfaces must never
    // present it as approvable.
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Pahlavi dynasty",
        targetUrl: "https://iranopedia.com/history/pahlavi-dynasty",
        gsc: [gscLine("buy persian rugs online")],
      }),
      affectedPromptTexts: [],
    });
    expect(v.approve).toBe(false);
    expect(["rejected", "needs_more_evidence", "low"]).toContain(v.confidence);
  });

  it("a valid on-topic rec (Abbasid history) is STILL approved with real confidence", () => {
    const v = buildRecommendationQaVerdict({
      row: row({
        targetLabel: "Abbasid Caliphate",
        targetUrl: "https://iranopedia.com/history/abbasid-caliphate",
        gsc: [gscLine("abbasid caliphate history")],
      }),
      affectedPromptTexts: ["abbasid caliphate timeline", "who were the abbasids"],
    });
    expect(["high", "medium"]).toContain(v.confidence);
    expect(v.approve).toBe(true);
  });
});

// NOTE (2026-07-21, CORE 100K): the `deriveRecQaDisplay` display-mapping and
// list/detail parity describe blocks were removed together with the function
// itself — it lost its last production caller when the /recommendations list +
// detail surfaces collapsed into /changes. The deterministic authority,
// `buildRecommendationQaVerdict`, is live (publish gate) and stays pinned above.

describe("copy artifacts can never reach the customer card", () => {
  it("schema title cannot render 'Add Add' (doubled leading verb collapsed)", () => {
    expect(dedupeDoubledWords("Add Add Article schema to this page")).toBe(
      "Add Article schema to this page",
    );
    expect(dedupeDoubledWords("Add Add Article schema")).not.toMatch(/Add Add/);
  });

  it("a title can never render 'Change the page title to …' as the copy", () => {
    const cleaned = cleanDisplayLabel(
      'Change the page title to "Abbasid Caliphate: History & Timeline"',
    );
    expect(cleaned).toBe("Abbasid Caliphate: History & Timeline");
    expect(cleaned).not.toMatch(/change the page title/i);
  });

  it("strips a leading meta-description directive prefix", () => {
    const out = stripInstructionArtifactPrefix(
      'Add the short page description: "A complete guide to the Abbasid Caliphate."',
    );
    expect(out.stripped).toBe(true);
    expect(out.text).not.toMatch(/add the short page description/i);
  });

  it("drops a directive that leaves only a sentence fragment (no clean value)", () => {
    // "Update the meta description to improve click-through" → after stripping
    // the prefix the remainder is a lowercase fragment, not a real value → "".
    expect(cleanDisplayLabel("Update the meta description to improve click-through")).toBe("");
  });
});
