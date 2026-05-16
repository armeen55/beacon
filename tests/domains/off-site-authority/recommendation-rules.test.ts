/**
 * Section 7 C7c — pure off-site recommendation rules tests.
 *
 * Truth-table coverage of `computeOffSiteRecommendationCandidates`:
 *   • not-local-service → all 7 silent `not_local_service`.
 *   • GBP confidence + sample bands → candidate or silent per rule.
 *   • Yelp confidence + sample bands → candidate or silent per rule.
 *   • Houzz / Angi / BBB / industry_directory / local_press → always
 *     silent `detection_not_implemented` in C7c (C7g lands detection).
 *   • Structural pin-throughs: tenant_id, data_sources_note,
 *     generated_at, decision count + order, id pattern,
 *     `manual_only: true` literal on every candidate,
 *     `policy_risk: true` ONLY on `request_gbp_reviews`,
 *     `pursue_local_pr` never fires.
 */

import { describe, it, expect } from "vitest";

import {
  computeOffSiteRecommendationCandidates,
} from "@/domains/off-site-authority/recommendation-rules";
import type {
  OffSitePresenceChannel,
  OffSitePresenceSnapshot,
  OffSiteChannelState,
} from "@/domains/off-site-authority/types";

const TENANT = "tenant-ritz-founder";
const NOW = "2026-05-16T12:00:00.000Z";

const STANDARD_NOTES = [
  "business-config: process-global today; multi-tenant routing not yet implemented for this source.",
  "connector-tokens: process-global today; multi-tenant routing not yet implemented for this source.",
  "local-reviews: request-scoped per tenant via the persistence-layer tenant-slug resolver.",
  "industry directory and local press detection: not implemented until C7g.",
];

const INFERRED_CHANNELS: OffSitePresenceChannel[] = [
  "houzz",
  "angi",
  "bbb",
  "industry_directory",
  "local_press",
];

function inferredRow(channel: OffSitePresenceChannel): OffSiteChannelState {
  return {
    channel,
    claimed: null,
    review_count: null,
    rating: null,
    profile_url: null,
    source: "inferred",
    last_checked_at: NOW,
    confidence: "unknown",
  };
}

function gbpRow(
  over: Partial<OffSiteChannelState> = {},
): OffSiteChannelState {
  return {
    channel: "gbp",
    claimed: true,
    review_count: 20,
    rating: 4.6,
    profile_url: null,
    source: "connector_api",
    last_checked_at: NOW,
    confidence: "high",
    ...over,
  };
}

function yelpRow(
  over: Partial<OffSiteChannelState> = {},
): OffSiteChannelState {
  return {
    channel: "yelp",
    claimed: true,
    review_count: 12,
    rating: 4.5,
    profile_url: null,
    source: "connector_api",
    last_checked_at: NOW,
    confidence: "high",
    ...over,
  };
}

function snapshot(
  over: Partial<OffSitePresenceSnapshot> = {},
  channelOverrides: {
    gbp?: Partial<OffSiteChannelState>;
    yelp?: Partial<OffSiteChannelState>;
  } = {},
): OffSitePresenceSnapshot {
  return {
    tenant_id: TENANT,
    brand_name: "Ritz Builders",
    is_local_service: true,
    channels: [
      gbpRow(channelOverrides.gbp),
      yelpRow(channelOverrides.yelp),
      ...INFERRED_CHANNELS.map(inferredRow),
    ],
    data_sources_note: [...STANDARD_NOTES],
    generated_at: NOW,
    ...over,
  };
}

describe("Section 7 C7c — not-local-service gate", () => {
  it("is_local_service=false → all 7 silent not_local_service, candidates empty", () => {
    const s = snapshot({ is_local_service: false });
    const out = computeOffSiteRecommendationCandidates(s);
    expect(out.is_local_service).toBe(false);
    expect(out.candidates).toEqual([]);
    expect(out.decisions).toHaveLength(7);
    for (const d of out.decisions) {
      expect(d.kind).toBe("silent");
      if (d.kind === "silent") expect(d.reason).toBe("not_local_service");
    }
  });
});

describe("Section 7 C7c — GBP rules", () => {
  it("claimed=false → candidate claim_gbp, confidence medium, policy_risk false, manual_only true", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    expect(gbp.kind).toBe("candidate");
    if (gbp.kind !== "candidate") throw new Error("unreachable");
    expect(gbp.candidate.actionType).toBe("claim_gbp");
    expect(gbp.candidate.confidence).toBe("medium");
    expect(gbp.candidate.policy_risk).toBe(false);
    expect(gbp.candidate.manual_only).toBe(true);
    expect(gbp.candidate.id).toBe("gbp:claim_gbp");
  });

  it("claimed=true + review_count=null → candidate optimize_gbp_profile, confidence low", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: null, rating: null } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    if (gbp.kind !== "candidate") throw new Error("expected candidate");
    expect(gbp.candidate.actionType).toBe("optimize_gbp_profile");
    expect(gbp.candidate.confidence).toBe("low");
    expect(gbp.candidate.policy_risk).toBe(false);
  });

  it("claimed=true + review_count=5 → candidate request_gbp_reviews, confidence low, policy_risk true", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: 5, rating: 4.2 } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    if (gbp.kind !== "candidate") throw new Error("expected candidate");
    expect(gbp.candidate.actionType).toBe("request_gbp_reviews");
    expect(gbp.candidate.confidence).toBe("low");
    expect(gbp.candidate.policy_risk).toBe(true);
  });

  it("GBP review_count=10 (upper boundary) → request_gbp_reviews", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: 10, rating: 4.2 } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    if (gbp.kind !== "candidate") throw new Error("expected candidate");
    expect(gbp.candidate.actionType).toBe("request_gbp_reviews");
  });

  it("GBP review_count=11 + rating=4.5 → silent channel_healthy", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: 11, rating: 4.5 } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    expect(gbp.kind).toBe("silent");
    if (gbp.kind === "silent") expect(gbp.reason).toBe("channel_healthy");
  });

  it("GBP review_count=11 + rating=3.9 → silent insufficient_signal", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: 11, rating: 3.9 } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    expect(gbp.kind).toBe("silent");
    if (gbp.kind === "silent") expect(gbp.reason).toBe("insufficient_signal");
  });

  it("GBP review_count=20 + rating=4.0 (boundary) → silent channel_healthy", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { gbp: { claimed: true, review_count: 20, rating: 4.0 } }),
    );
    const gbp = out.decisions.find((d) => d.channel === "gbp")!;
    expect(gbp.kind).toBe("silent");
    if (gbp.kind === "silent") expect(gbp.reason).toBe("channel_healthy");
  });
});

describe("Section 7 C7c — Yelp rules", () => {
  it("claimed=false → candidate claim_or_optimize_yelp, confidence medium", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { yelp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" } }),
    );
    const yelp = out.decisions.find((d) => d.channel === "yelp")!;
    if (yelp.kind !== "candidate") throw new Error("expected candidate");
    expect(yelp.candidate.actionType).toBe("claim_or_optimize_yelp");
    expect(yelp.candidate.confidence).toBe("medium");
    expect(yelp.candidate.policy_risk).toBe(false);
  });

  it("claimed=true + review_count=null → candidate claim_or_optimize_yelp, confidence low", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { yelp: { claimed: true, review_count: null, rating: null } }),
    );
    const yelp = out.decisions.find((d) => d.channel === "yelp")!;
    if (yelp.kind !== "candidate") throw new Error("expected candidate");
    expect(yelp.candidate.actionType).toBe("claim_or_optimize_yelp");
    expect(yelp.candidate.confidence).toBe("low");
  });

  it("Yelp review_count=1 + rating=4.5 → silent channel_healthy", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { yelp: { claimed: true, review_count: 1, rating: 4.5 } }),
    );
    const yelp = out.decisions.find((d) => d.channel === "yelp")!;
    expect(yelp.kind).toBe("silent");
    if (yelp.kind === "silent") expect(yelp.reason).toBe("channel_healthy");
  });

  it("Yelp review_count=5 + rating=3.5 → silent insufficient_signal", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({}, { yelp: { claimed: true, review_count: 5, rating: 3.5 } }),
    );
    const yelp = out.decisions.find((d) => d.channel === "yelp")!;
    expect(yelp.kind).toBe("silent");
    if (yelp.kind === "silent") expect(yelp.reason).toBe("insufficient_signal");
  });
});

describe("Section 7 C7c — inferred channels emit detection_not_implemented", () => {
  for (const c of INFERRED_CHANNELS) {
    it(`${c} → silent detection_not_implemented`, () => {
      const out = computeOffSiteRecommendationCandidates(snapshot());
      const row = out.decisions.find((d) => d.channel === c)!;
      expect(row.kind).toBe("silent");
      if (row.kind === "silent") {
        expect(row.reason).toBe("detection_not_implemented");
      }
    });
  }
});

describe("Section 7 C7c — structural pin-throughs", () => {
  it("tenant_id passes through verbatim", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot({ tenant_id: "tenant-test-xyz" }),
    );
    expect(out.tenant_id).toBe("tenant-test-xyz");
  });

  it("data_sources_note passes through verbatim", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    expect(out.data_sources_note).toEqual(STANDARD_NOTES);
  });

  it("generated_at uses snapshot.generated_at (no new clock)", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    expect(out.generated_at).toBe(NOW);
  });

  it("decisions length = 7 (one per channel)", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    expect(out.decisions).toHaveLength(7);
  });

  it("decisions order matches snapshot.channels", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    expect(out.decisions.map((d) => d.channel)).toEqual([
      "gbp",
      "yelp",
      "houzz",
      "angi",
      "bbb",
      "industry_directory",
      "local_press",
    ]);
  });

  it("candidates is the subset of decisions with kind=candidate, stable order", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot(
        {},
        {
          gbp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
          yelp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
        },
      ),
    );
    const cand = out.decisions
      .filter((d): d is Extract<typeof d, { kind: "candidate" }> => d.kind === "candidate")
      .map((d) => d.candidate);
    expect(out.candidates).toEqual(cand);
    // Both channels fire → exactly 2 candidates.
    expect(out.candidates).toHaveLength(2);
  });

  it("every candidate id matches `${channel}:${actionType}` pattern", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot(
        {},
        {
          gbp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
          yelp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
        },
      ),
    );
    for (const c of out.candidates) {
      expect(c.id).toBe(`${c.channel}:${c.actionType}`);
    }
  });

  it("policy_risk=true ONLY on request_gbp_reviews", () => {
    // Trigger request_gbp_reviews on GBP + a non-policy-risk yelp.
    const out = computeOffSiteRecommendationCandidates(
      snapshot(
        {},
        {
          gbp: { claimed: true, review_count: 5, rating: 4.2 },
          yelp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
        },
      ),
    );
    const reviewsCand = out.candidates.find(
      (c) => c.actionType === "request_gbp_reviews",
    );
    expect(reviewsCand?.policy_risk).toBe(true);
    for (const c of out.candidates) {
      if (c.actionType !== "request_gbp_reviews") {
        expect(c.policy_risk).toBe(false);
      }
    }
  });

  it("every candidate has manual_only=true (the LITERAL true type)", () => {
    const out = computeOffSiteRecommendationCandidates(
      snapshot(
        {},
        {
          gbp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
          yelp: { claimed: false, review_count: null, rating: null, source: "inferred", confidence: "low" },
        },
      ),
    );
    for (const c of out.candidates) {
      expect(c.manual_only).toBe(true);
    }
  });

  it("pursue_local_pr never appears as a candidate in C7c", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    for (const c of out.candidates) {
      expect(c.actionType).not.toBe("pursue_local_pr");
    }
  });

  it("no candidate uses Houzz/Angi/BBB/industry/local_press channel in C7c", () => {
    const out = computeOffSiteRecommendationCandidates(snapshot());
    for (const c of out.candidates) {
      expect(["houzz", "angi", "bbb", "industry_directory", "local_press"]).not.toContain(c.channel);
    }
  });
});
