/**
 * Phase A.1 Step 4 — compute-time-to-citation pure-compute tests.
 *
 * Locked behaviors per Section 2.5–2.7 + D4 / D5 / D6 / D7.
 *
 * Fixture-style: each test constructs the minimum row + observation
 * shapes the compute layer reads. We pass strict subsets via `as` so
 * tests stay readable without manufacturing every PromptAnswerObservation
 * extraction field.
 */

import { describe, expect, it } from "vitest";

import {
  computeTimeToCitation,
  type TimeToCitationRecommendedEditInput,
} from "@/domains/citation-lifecycle/compute-time-to-citation";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

const TARGET_URL = "https://ritzbuilders.com/services/whole-home-remodel";

function eligibleRow(
  overrides: Partial<TimeToCitationRecommendedEditInput> = {},
): TimeToCitationRecommendedEditInput {
  return {
    implementation_status: "verified_live",
    live_at: "2026-05-01T07:00:00.000Z",
    target_url: TARGET_URL,
    ...overrides,
  };
}

function pao(
  overrides: Partial<PromptAnswerObservation> & Pick<PromptAnswerObservation, "id">,
): PromptAnswerObservation {
  return {
    prompt_id: "prompt-1",
    run_id: "run-1",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-05-05T07:00:00.000Z",
    platform: "chatgpt",
    topic: "remodel",
    metadata: {},
    tenant_id: "tenant-ritz-founder",
    ...overrides,
  } as PromptAnswerObservation;
}

function cobs(
  overrides: Partial<CitationObservation> &
    Pick<CitationObservation, "id" | "prompt_answer_id">,
): CitationObservation {
  return {
    domain: "ritzbuilders.com",
    url: TARGET_URL,
    title: null,
    citation_order: null,
    source_category: "owned",
    is_owned: true,
    tracked_entity_id: null,
    observed_at: "2026-05-05T07:00:00.000Z",
    ...overrides,
  } as CitationObservation;
}

const NOW = new Date("2026-05-13T07:00:00.000Z"); // 12 days after May 1

describe("computeTimeToCitation — Phase A.1 §2.5–2.7", () => {
  // ─────────────────────────────────────────────────────────────────
  // Eligibility passthrough
  // ─────────────────────────────────────────────────────────────────

  it("case 1: ineligible row (status=recommended) → eligible:false, all dates null, reason: excluded_status", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ implementation_status: "recommended" }),
      citationObservations: [],
      promptAnswerObservations: [],
      now: NOW,
    });
    expect(result).toEqual({
      eligible: false,
      eligibility_reason: "excluded_status",
      is_partial_live: false,
      first_citation_date_iso: null,
      days_to_first_citation: null,
      days_since_live: null,
      per_platform_first_citation: {
        chatgpt: null,
        perplexity: null,
        google_ai_overviews: null,
      },
      was_cited_before_live: false,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Eligible-no-citations baseline
  // ─────────────────────────────────────────────────────────────────

  it("case 2: eligible row with no citations → null first citation + days_since_live=12", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [],
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.eligibility_reason).toBe("eligible_verified_live");
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.days_to_first_citation).toBeNull();
    expect(result.days_since_live).toBe(12);
    expect(result.was_cited_before_live).toBe(false);
    expect(result.per_platform_first_citation).toEqual({
      chatgpt: null,
      perplexity: null,
      google_ai_overviews: null,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Native regime match
  // ─────────────────────────────────────────────────────────────────

  it("case 3: native citation_urls match target URL → first citation set + days correct", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-05T11:30:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.first_citation_date_iso).toBe("2026-05-05");
    expect(result.days_to_first_citation).toBe(4);
    expect(result.per_platform_first_citation.chatgpt).toBe("2026-05-05");
    expect(result.per_platform_first_citation.perplexity).toBeNull();
    expect(result.per_platform_first_citation.google_ai_overviews).toBeNull();
    expect(result.was_cited_before_live).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Benchmark regime match (CitationObservation joined via prompt-answer)
  // ─────────────────────────────────────────────────────────────────

  it("case 4: benchmark CitationObservation matched via prompt-answer join → first citation set", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [
        cobs({
          id: "cit-1",
          prompt_answer_id: "pa-1",
          observed_at: "2026-05-04T12:00:00.000Z",
        }),
      ],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-04T12:00:00.000Z",
          platform: "perplexity",
          // No citation_urls — pre-Commit-7 row pattern. Citation
          // came in through the cold-store side.
          citation_urls: null,
        }),
      ],
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.first_citation_date_iso).toBe("2026-05-04");
    expect(result.days_to_first_citation).toBe(3);
    expect(result.per_platform_first_citation.perplexity).toBe("2026-05-04");
    expect(result.per_platform_first_citation.chatgpt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Tenant-scope guard: orphan CitationObservation rows are ignored
  // ─────────────────────────────────────────────────────────────────

  it("case 5: CitationObservation whose prompt_answer_id is NOT in provided prompt answers is ignored (tenant guard)", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [
        cobs({
          id: "cit-other",
          prompt_answer_id: "pa-from-OTHER-tenant",
          observed_at: "2026-05-03T12:00:00.000Z",
        }),
      ],
      promptAnswerObservations: [
        // Note: the matching pa is intentionally not in this array;
        // only an unrelated pa for the current tenant.
        pao({ id: "pa-1", platform: "chatgpt", citation_urls: null }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.per_platform_first_citation.perplexity).toBeNull();
    expect(result.per_platform_first_citation.chatgpt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // URL canonicalization equivalence: all shapes normalize and match
  // ─────────────────────────────────────────────────────────────────

  it("case 6: URL shape variations (www / http / trailing slash / query / fragment / uppercase host) all match via canonicalizer", () => {
    const variants = [
      "https://www.ritzbuilders.com/services/whole-home-remodel",
      "http://ritzbuilders.com/services/whole-home-remodel",
      "https://ritzbuilders.com/services/whole-home-remodel/",
      "https://ritzbuilders.com/services/whole-home-remodel?utm_source=ai&id=42",
      "https://ritzbuilders.com/services/whole-home-remodel#section",
      "HTTPS://RITZBUILDERS.COM/services/whole-home-remodel",
    ];
    for (const variant of variants) {
      const result = computeTimeToCitation({
        recommendedEdit: eligibleRow(),
        citationObservations: [],
        promptAnswerObservations: [
          pao({
            id: `pa-${variant}`,
            observed_at: "2026-05-05T11:30:00.000Z",
            platform: "chatgpt",
            citation_urls: [variant],
          }),
        ],
        now: NOW,
      });
      expect(result.first_citation_date_iso).toBe("2026-05-05");
      expect(result.per_platform_first_citation.chatgpt).toBe("2026-05-05");
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Different path: no match
  // ─────────────────────────────────────────────────────────────────

  it("case 7: a different URL path on the same host does NOT match", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-05T11:30:00.000Z",
          platform: "chatgpt",
          citation_urls: ["https://ritzbuilders.com/services/kitchen-remodel"],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.per_platform_first_citation.chatgpt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Brand mention / primary-recommendation without URL doesn't count
  // ─────────────────────────────────────────────────────────────────

  it("case 8: brand mention / primary recommendation flags without URL citation do NOT produce a first-citation date", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-03T07:00:00.000Z",
          platform: "chatgpt",
          tracked_brand_mentioned: true,
          tracked_brand_cited: true, // brand cited at domain-level
          primary_recommendation: true,
          // But citation_urls is null → no URL-level citation to match.
          citation_urls: null,
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.days_to_first_citation).toBeNull();
    expect(result.per_platform_first_citation.chatgpt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Per-platform divergence
  // ─────────────────────────────────────────────────────────────────

  it("case 9: per-platform first citation differs (Perplexity day 3, ChatGPT day 7)", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-px-1",
          observed_at: "2026-05-04T07:00:00.000Z", // 3 days after May 1
          platform: "perplexity",
          citation_urls: [TARGET_URL],
        }),
        pao({
          id: "pa-cg-1",
          observed_at: "2026-05-08T07:00:00.000Z", // 7 days after May 1
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.per_platform_first_citation.perplexity).toBe("2026-05-04");
    expect(result.per_platform_first_citation.chatgpt).toBe("2026-05-08");
  });

  // ─────────────────────────────────────────────────────────────────
  // Aggregate first citation = earliest active-platform match
  // ─────────────────────────────────────────────────────────────────

  it("case 10: aggregate first_citation_date_iso = min(chatgpt, perplexity) (active-platforms only)", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-px",
          observed_at: "2026-05-04T07:00:00.000Z",
          platform: "perplexity",
          citation_urls: [TARGET_URL],
        }),
        pao({
          id: "pa-cg",
          observed_at: "2026-05-08T07:00:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-04");
    expect(result.days_to_first_citation).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────
  // Same-day citation
  // ─────────────────────────────────────────────────────────────────

  it("case 11: same-day citation returns 0 days", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ live_at: "2026-05-01T07:00:00.000Z" }),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-01T15:30:00.000Z", // same UTC day
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-01");
    expect(result.days_to_first_citation).toBe(0);
    expect(result.was_cited_before_live).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Citation observed BEFORE live_at (operator-override delay / VL↔VLM re-stamp)
  // ─────────────────────────────────────────────────────────────────

  it("case 12: citation before live_at → was_cited_before_live:true and days_to_first_citation:0", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ live_at: "2026-05-05T07:00:00.000Z" }),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-03T07:00:00.000Z", // 2 days BEFORE live_at
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-03");
    expect(result.was_cited_before_live).toBe(true);
    expect(result.days_to_first_citation).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // google_ai_overviews always null
  // ─────────────────────────────────────────────────────────────────

  it("case 13: google_ai_overviews slot is always null (D6 lock), even if a GAIO citation appears in input", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-gaio",
          observed_at: "2026-05-04T07:00:00.000Z",
          platform: "google_ai_overviews",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    // The GAIO citation is silently dropped (unknown-platform behavior),
    // and the slot itself is hardcoded null.
    expect(result.per_platform_first_citation.google_ai_overviews).toBeNull();
    // Also: GAIO doesn't contribute to the aggregate.
    expect(result.first_citation_date_iso).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Unknown platform behavior pinned (silently dropped)
  // ─────────────────────────────────────────────────────────────────

  it("case 14: unknown platform (e.g., 'claude') does NOT contribute to per-platform map or aggregate", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-claude",
          observed_at: "2026-05-03T07:00:00.000Z",
          platform: "claude",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.per_platform_first_citation.chatgpt).toBeNull();
    expect(result.per_platform_first_citation.perplexity).toBeNull();
    expect(result.per_platform_first_citation.google_ai_overviews).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Null citation URL skipped safely (benchmark side)
  // ─────────────────────────────────────────────────────────────────

  it("case 15: CitationObservation.url=null is skipped safely", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [
        cobs({
          id: "cit-1",
          prompt_answer_id: "pa-1",
          url: null,
        }),
      ],
      promptAnswerObservations: [pao({ id: "pa-1" })],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Native null/empty citation_urls skipped safely
  // ─────────────────────────────────────────────────────────────────

  it("case 16: native citation_urls null OR empty array is skipped safely", () => {
    const resultNull = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [pao({ id: "pa-null", citation_urls: null })],
      now: NOW,
    });
    expect(resultNull.first_citation_date_iso).toBeNull();

    const resultEmpty = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [pao({ id: "pa-empty", citation_urls: [] })],
      now: NOW,
    });
    expect(resultEmpty.first_citation_date_iso).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Dedupe: duplicate citations don't change the result
  // ─────────────────────────────────────────────────────────────────

  it("case 17: duplicate citation URLs inside one observation are deduped", () => {
    // Three duplicates of the same target URL within one observation's
    // citation_urls array → still produces one first-citation entry on
    // the observation's date.
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-dup",
          observed_at: "2026-05-04T07:00:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL, TARGET_URL, TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-04");
    expect(result.days_to_first_citation).toBe(3);
    expect(result.per_platform_first_citation.chatgpt).toBe("2026-05-04");
  });

  it("case 17b: cross-regime duplicate (same URL in both native + benchmark sources on the same date) does not move the result", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow(),
      citationObservations: [
        cobs({
          id: "cit-1",
          prompt_answer_id: "pa-1",
          observed_at: "2026-05-04T07:00:00.000Z",
        }),
      ],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-04T07:00:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-04");
    expect(result.days_to_first_citation).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────
  // UTC boundary
  // ─────────────────────────────────────────────────────────────────

  it("case 18: UTC boundary — live_at late on May 1 UTC, citation early on May 2 UTC ⇒ 1 day apart (NOT 0)", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ live_at: "2026-05-01T23:30:00.000Z" }),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-utc",
          observed_at: "2026-05-02T00:30:00.000Z", // 1 UTC hour later, but next UTC day
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-02");
    expect(result.days_to_first_citation).toBe(1);
  });

  it("case 18b: UTC boundary same-day — both late on May 1 UTC ⇒ 0 days", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ live_at: "2026-05-01T01:00:00.000Z" }),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-utc2",
          observed_at: "2026-05-01T23:00:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.first_citation_date_iso).toBe("2026-05-01");
    expect(result.days_to_first_citation).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // Unparseable target_url after eligibility passes
  // ─────────────────────────────────────────────────────────────────

  it("case 19: target_url that passes eligibility but fails canonicalization → eligible:false, reason: target_url_unparseable, days_since_live still computed", () => {
    // "https:///just-path" passes eligibility (non-null, not sentinel)
    // but the canonicalizer's credibility guard rejects it.
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({ target_url: "https:///just-path" }),
      citationObservations: [],
      promptAnswerObservations: [],
      now: NOW,
    });
    expect(result.eligible).toBe(false);
    expect(result.eligibility_reason).toBe("target_url_unparseable");
    expect(result.first_citation_date_iso).toBeNull();
    expect(result.days_to_first_citation).toBeNull();
    // We DO compute days_since_live — it doesn't depend on the URL.
    expect(result.days_since_live).toBe(12);
    expect(result.was_cited_before_live).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // partially_implemented + live_at + valid target_url → is_partial_live:true
  // (verifies D1 flag flows through compute, even though current
  // production code never stamps live_at on partial rows — see Section
  // 2.2 finding. The eligibility branch is reserved forward-compatibly.)
  // ─────────────────────────────────────────────────────────────────

  it("case 20: partially_implemented with live_at + valid target + matching citation → is_partial_live:true", () => {
    const result = computeTimeToCitation({
      recommendedEdit: eligibleRow({
        implementation_status: "partially_implemented",
      }),
      citationObservations: [],
      promptAnswerObservations: [
        pao({
          id: "pa-1",
          observed_at: "2026-05-05T07:00:00.000Z",
          platform: "chatgpt",
          citation_urls: [TARGET_URL],
        }),
      ],
      now: NOW,
    });
    expect(result.eligible).toBe(true);
    expect(result.is_partial_live).toBe(true);
    expect(result.eligibility_reason).toBe("eligible_partial_live");
    expect(result.first_citation_date_iso).toBe("2026-05-05");
  });
});
