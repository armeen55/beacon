/**
 * Section 7 C7a — Off-Site Authority pure compute tests.
 *
 * Covers:
 *   - Channel confidence transitions (high / medium / low) per claimed
 *     and review presence.
 *   - Yelp claimed-by-token vs claimed-by-yelpBusinessId source-string.
 *   - Inferred rows for the five non-API channels.
 *   - Deterministic channel order.
 *   - is_local_service gate.
 *   - data_sources_note required entries + placeholder addition.
 *   - Review aggregation (sum + mean per source).
 *   - brand_name passthrough.
 */

import { describe, it, expect } from "vitest";
import {
  computeOffSitePresenceSnapshot,
  type ComputeBusinessConfigInput,
  type ComputeConnectorTokenInput,
  type ComputeLocalReviewInput,
  type ComputeOffSitePresenceSnapshotArgs,
} from "@/domains/off-site-authority/compute-snapshot";

const NOW = new Date("2026-05-16T12:00:00Z");
const TENANT = "tenant-ritz-founder";

function bc(
  over: Partial<ComputeBusinessConfigInput> = {},
): ComputeBusinessConfigInput {
  return {
    name: "Ritz Builders",
    industry: "Builder",
    yelpBusinessId: "",
    locations: ["Atherton, CA"],
    // Section 7 C7g v1 (2026-05-16) — operator-entered profile URLs
    // default to "" (not configured) so legacy C7a/C7c tests keep
    // the same inferred/unknown behavior for Houzz/Angi/BBB/
    // industry_directory.
    houzzProfileUrl: "",
    angiProfileUrl: "",
    bbbProfileUrl: "",
    industryDirectoryProfileUrl: "",
    ...over,
  };
}

function args(
  over: Partial<ComputeOffSitePresenceSnapshotArgs> = {},
): ComputeOffSitePresenceSnapshotArgs {
  return {
    tenantId: TENANT,
    brandName: "Ritz Builders",
    businessConfig: bc(),
    businessConfigIsPlaceholder: false,
    localReviews: [],
    googleToken: null,
    yelpToken: null,
    now: NOW,
    ...over,
  };
}

const GOOGLE_TOKEN: ComputeConnectorTokenInput = { provider: "google" };
const YELP_TOKEN: ComputeConnectorTokenInput = { provider: "yelp" };

describe("Section 7 C7a — computeOffSitePresenceSnapshot (GBP confidence)", () => {
  it("GBP claimed + reviews → high", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        googleToken: GOOGLE_TOKEN,
        localReviews: [
          { source: "google", rating: 5 },
          { source: "google", rating: 4 },
        ],
      }),
    );
    const gbp = out.channels.find((c) => c.channel === "gbp")!;
    expect(gbp.claimed).toBe(true);
    expect(gbp.review_count).toBe(2);
    expect(gbp.rating).toBe(4.5);
    expect(gbp.source).toBe("connector_api");
    expect(gbp.confidence).toBe("high");
  });

  it("GBP claimed + no reviews → medium", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ googleToken: GOOGLE_TOKEN, localReviews: [] }),
    );
    const gbp = out.channels.find((c) => c.channel === "gbp")!;
    expect(gbp.claimed).toBe(true);
    expect(gbp.review_count).toBeNull();
    expect(gbp.confidence).toBe("medium");
  });

  it("GBP unclaimed → false claimed, inferred source, low confidence", () => {
    const out = computeOffSitePresenceSnapshot(args({ googleToken: null }));
    const gbp = out.channels.find((c) => c.channel === "gbp")!;
    expect(gbp.claimed).toBe(false);
    expect(gbp.source).toBe("inferred");
    expect(gbp.confidence).toBe("low");
    expect(gbp.review_count).toBeNull();
    expect(gbp.rating).toBeNull();
  });
});

describe("Section 7 C7a — Yelp confidence + source", () => {
  it("Yelp token + reviews → connector_api, high", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        yelpToken: YELP_TOKEN,
        localReviews: [
          { source: "yelp", rating: 4 },
          { source: "yelp", rating: 5 },
          { source: "yelp", rating: 5 },
        ],
      }),
    );
    const yelp = out.channels.find((c) => c.channel === "yelp")!;
    expect(yelp.claimed).toBe(true);
    expect(yelp.source).toBe("connector_api");
    expect(yelp.review_count).toBe(3);
    expect(yelp.rating).toBeCloseTo(4.7, 1);
    expect(yelp.confidence).toBe("high");
  });

  it("Yelp via yelpBusinessId only → business_config, medium", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        yelpToken: null,
        businessConfig: bc({ yelpBusinessId: "yelp-biz-123" }),
      }),
    );
    const yelp = out.channels.find((c) => c.channel === "yelp")!;
    expect(yelp.claimed).toBe(true);
    expect(yelp.source).toBe("business_config");
    expect(yelp.confidence).toBe("medium");
  });

  it("Yelp neither → inferred, low", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ yelpToken: null, businessConfig: bc({ yelpBusinessId: "" }) }),
    );
    const yelp = out.channels.find((c) => c.channel === "yelp")!;
    expect(yelp.claimed).toBe(false);
    expect(yelp.source).toBe("inferred");
    expect(yelp.confidence).toBe("low");
  });
});

describe("Section 7 C7a — inferred channels", () => {
  it("Houzz/Angi/BBB/industry_directory/local_press always inferred + unknown", () => {
    const out = computeOffSitePresenceSnapshot(args());
    const inferred = out.channels.filter((c) =>
      ["houzz", "angi", "bbb", "industry_directory", "local_press"].includes(
        c.channel,
      ),
    );
    expect(inferred).toHaveLength(5);
    for (const row of inferred) {
      expect(row.claimed).toBeNull();
      expect(row.review_count).toBeNull();
      expect(row.rating).toBeNull();
      expect(row.profile_url).toBeNull();
      expect(row.source).toBe("inferred");
      expect(row.confidence).toBe("unknown");
      expect(row.last_checked_at).toBe(NOW.toISOString());
    }
  });
});

describe("Section 7 C7a — deterministic channel order", () => {
  it("channels render in fixed order: gbp, yelp, houzz, angi, bbb, industry_directory, local_press", () => {
    const out = computeOffSitePresenceSnapshot(args());
    expect(out.channels.map((c) => c.channel)).toEqual([
      "gbp",
      "yelp",
      "houzz",
      "angi",
      "bbb",
      "industry_directory",
      "local_press",
    ]);
  });
});

describe("Section 7 C7a — is_local_service gate", () => {
  it("true with non-empty industry + at least one location", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({
          industry: "Builder",
          locations: ["Atherton, CA"],
        }),
      }),
    );
    expect(out.is_local_service).toBe(true);
  });

  it("false with empty industry", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({ industry: "", locations: ["Atherton, CA"] }),
      }),
    );
    expect(out.is_local_service).toBe(false);
  });

  it("false with empty locations", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ industry: "Builder", locations: [] }) }),
    );
    expect(out.is_local_service).toBe(false);
  });
});

describe("Section 7 C7a — data_sources_note", () => {
  it("includes the 4 always-on notes about scope provenance", () => {
    const out = computeOffSitePresenceSnapshot(args());
    expect(
      out.data_sources_note.some((n) =>
        n.includes("business-config: tenant-scoped"),
      ),
    ).toBe(true);
    expect(
      out.data_sources_note.some((n) =>
        n.includes("connector-tokens: tenant-scoped"),
      ),
    ).toBe(true);
    expect(
      out.data_sources_note.some((n) =>
        n.includes("local-reviews: request-scoped"),
      ),
    ).toBe(true);
    expect(
      out.data_sources_note.some((n) =>
        n.includes("industry directory and local press"),
      ),
    ).toBe(true);
  });

  it("appends placeholder note only when businessConfigIsPlaceholder=true", () => {
    const off = computeOffSitePresenceSnapshot(
      args({ businessConfigIsPlaceholder: false }),
    );
    expect(off.data_sources_note.some((n) => n.startsWith("business-config is the neutral placeholder"))).toBe(false);
    const on = computeOffSitePresenceSnapshot(
      args({ businessConfigIsPlaceholder: true }),
    );
    expect(on.data_sources_note.some((n) => n.startsWith("business-config is the neutral placeholder"))).toBe(true);
  });
});

describe("Section 7 C7a — review aggregation", () => {
  it("review_count sums same-source rows (not max, not count of all rows)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        googleToken: GOOGLE_TOKEN,
        yelpToken: YELP_TOKEN,
        localReviews: [
          { source: "google", rating: 5 },
          { source: "google", rating: 4 },
          { source: "google", rating: 3 },
          { source: "yelp", rating: 4 },
          { source: "bbb", rating: 5 }, // ignored — no bbb channel review path
        ],
      }),
    );
    expect(out.channels.find((c) => c.channel === "gbp")!.review_count).toBe(3);
    expect(out.channels.find((c) => c.channel === "yelp")!.review_count).toBe(1);
  });

  it("rating is the mean across same-source rows", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        googleToken: GOOGLE_TOKEN,
        localReviews: [
          { source: "google", rating: 5 },
          { source: "google", rating: 4 },
          { source: "google", rating: 3 },
        ],
      }),
    );
    expect(out.channels.find((c) => c.channel === "gbp")!.rating).toBe(4);
  });

  it("rating is null when no reviews on the channel", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ googleToken: GOOGLE_TOKEN, localReviews: [] }),
    );
    expect(out.channels.find((c) => c.channel === "gbp")!.rating).toBeNull();
  });
});

describe("Section 7 C7a — snapshot metadata", () => {
  it("generated_at and last_checked_at use the provided `now`", () => {
    const out = computeOffSitePresenceSnapshot(args());
    expect(out.generated_at).toBe(NOW.toISOString());
    for (const c of out.channels) {
      expect(c.last_checked_at).toBe(NOW.toISOString());
    }
  });

  it("brand_name passes through verbatim, including null", () => {
    const a = computeOffSitePresenceSnapshot(args({ brandName: "Acme Co" }));
    expect(a.brand_name).toBe("Acme Co");
    const b = computeOffSitePresenceSnapshot(args({ brandName: null }));
    expect(b.brand_name).toBeNull();
  });

  it("tenant_id passes through verbatim", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ tenantId: "tenant-test-xyz" }),
    );
    expect(out.tenant_id).toBe("tenant-test-xyz");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section 7 C7g v1 (2026-05-16) — operator-entered profile URLs.
//
// Confirms that:
//   • Houzz / Angi / BBB / industry_directory each flip from
//     inferred/unknown to configured/medium when a valid http(s)
//     profile URL is set in business-config.
//   • Empty / whitespace / `javascript:` / bare-domain / relative-path
//     inputs are REJECTED — the row falls back to inferred/unknown.
//   • `local_press` is NEVER affected — no config field, no logic
//     change.
// ─────────────────────────────────────────────────────────────────────

describe("Section 7 C7g v1 — operator-entered profile URLs", () => {
  const VALID_HTTPS = "https://www.houzz.com/professionals/example";
  const VALID_HTTP = "http://www.houzz.com/professionals/example";

  it("Houzz with a valid https URL → claimed, source business_config, confidence medium", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: VALID_HTTPS }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBe(true);
    expect(houzz.profile_url).toBe(VALID_HTTPS);
    expect(houzz.source).toBe("business_config");
    expect(houzz.confidence).toBe("medium");
    expect(houzz.review_count).toBeNull();
    expect(houzz.rating).toBeNull();
  });

  it("Houzz with a valid http URL → also accepted (claimed true)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: VALID_HTTP }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBe(true);
    expect(houzz.profile_url).toBe(VALID_HTTP);
  });

  it("Houzz with empty string '' → inferred/unknown (existing behavior)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: "" }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBeNull();
    expect(houzz.profile_url).toBeNull();
    expect(houzz.source).toBe("inferred");
    expect(houzz.confidence).toBe("unknown");
  });

  it("Houzz with whitespace-only '   ' → inferred/unknown", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: "   " }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBeNull();
    expect(houzz.profile_url).toBeNull();
  });

  it("Houzz with bare domain (no protocol) → inferred/unknown", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: "houzz.com/professionals/example" }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBeNull();
    expect(houzz.profile_url).toBeNull();
  });

  it("Houzz with javascript: scheme → inferred/unknown (rejected)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({ houzzProfileUrl: "javascript:alert('x')" }),
      }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.claimed).toBeNull();
    expect(houzz.profile_url).toBeNull();
  });

  it("Houzz with mailto: scheme → inferred/unknown (rejected)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({ houzzProfileUrl: "mailto:owner@example.com" }),
      }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.profile_url).toBeNull();
  });

  it("Houzz with relative path '/professionals/x' → inferred/unknown (rejected)", () => {
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ houzzProfileUrl: "/professionals/x" }) }),
    );
    const houzz = out.channels.find((c) => c.channel === "houzz")!;
    expect(houzz.profile_url).toBeNull();
  });

  it("Angi with a valid https URL → configured/medium", () => {
    const url = "https://www.angi.com/companylist/us/ca/example";
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ angiProfileUrl: url }) }),
    );
    const row = out.channels.find((c) => c.channel === "angi")!;
    expect(row.claimed).toBe(true);
    expect(row.profile_url).toBe(url);
    expect(row.source).toBe("business_config");
    expect(row.confidence).toBe("medium");
  });

  it("BBB with a valid https URL → configured/medium", () => {
    const url = "https://www.bbb.org/us/ca/atherton/profile/example";
    const out = computeOffSitePresenceSnapshot(
      args({ businessConfig: bc({ bbbProfileUrl: url }) }),
    );
    const row = out.channels.find((c) => c.channel === "bbb")!;
    expect(row.claimed).toBe(true);
    expect(row.profile_url).toBe(url);
    expect(row.source).toBe("business_config");
    expect(row.confidence).toBe("medium");
  });

  it("industry_directory with a valid https URL → configured/medium", () => {
    const url = "https://nari.example.org/member/example";
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({ industryDirectoryProfileUrl: url }),
      }),
    );
    const row = out.channels.find((c) => c.channel === "industry_directory")!;
    expect(row.claimed).toBe(true);
    expect(row.profile_url).toBe(url);
    expect(row.source).toBe("business_config");
    expect(row.confidence).toBe("medium");
  });

  it("local_press is NEVER affected by any business-config URL field", () => {
    // Set ALL four URL fields; local_press still inferred/unknown.
    const out = computeOffSitePresenceSnapshot(
      args({
        businessConfig: bc({
          houzzProfileUrl: VALID_HTTPS,
          angiProfileUrl: "https://www.angi.com/x",
          bbbProfileUrl: "https://www.bbb.org/x",
          industryDirectoryProfileUrl: "https://example.org/x",
        }),
      }),
    );
    const press = out.channels.find((c) => c.channel === "local_press")!;
    expect(press.claimed).toBeNull();
    expect(press.profile_url).toBeNull();
    expect(press.source).toBe("inferred");
    expect(press.confidence).toBe("unknown");
  });
});
