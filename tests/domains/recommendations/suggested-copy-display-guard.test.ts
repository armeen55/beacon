/**
 * Recommendation Execution Layer v1 Phase A (2026-05-13) —
 * display-safety guard unit tests.
 */

import { describe, expect, it } from "vitest";

import {
  allCopyDisplaySafe,
  checkCopyDisplaySafe,
} from "@/domains/recommendations/suggested-copy-display-guard";

describe("checkCopyDisplaySafe — happy path", () => {
  it("passes empty / null / whitespace-only input", () => {
    expect(checkCopyDisplaySafe(null)).toEqual({ safe: true });
    expect(checkCopyDisplaySafe(undefined)).toEqual({ safe: true });
    expect(checkCopyDisplaySafe("")).toEqual({ safe: true });
    expect(checkCopyDisplaySafe("   \n\t  ")).toEqual({ safe: true });
  });

  it("passes plain prose copy with no internal tokens", () => {
    expect(
      checkCopyDisplaySafe(
        "Ritz Builders coordinates architecture, engineering, and permitting for custom homes in Palo Alto.",
      ),
    ).toEqual({ safe: true });
  });

  it("passes copy that mentions year ranges and digits", () => {
    expect(
      checkCopyDisplaySafe(
        "Our process typically spans 12–18 months for whole-home remodels.",
      ),
    ).toEqual({ safe: true });
  });

  it("passes copy that mentions common product names with single-transition casing", () => {
    // Brand / product names with single-transition casing should NOT trip
    // the guard, otherwise legitimate FAQ copy would be blocked.
    expect(checkCopyDisplaySafe("Pair with iPhone or iPad apps.")).toEqual({
      safe: true,
    });
    expect(checkCopyDisplaySafe("Listed on eBay last year.")).toEqual({
      safe: true,
    });
    expect(checkCopyDisplaySafe("Compatible with macOS systems.")).toEqual({
      safe: true,
    });
  });
});

describe("checkCopyDisplaySafe — UUID detection", () => {
  it("blocks copy containing a UUID anywhere", () => {
    const r = checkCopyDisplaySafe(
      "Drawn from prompt 7ee3216b-327c-4de9-8d5d-2f4c95a6d773 evidence.",
    );
    expect(r.safe).toBe(false);
    if (!r.safe) {
      expect(r.reason).toBe("uuid");
      expect(r.match).toBe("7ee3216b-327c-4de9-8d5d-2f4c95a6d773");
    }
  });

  it("blocks uppercase UUIDs too (case-insensitive)", () => {
    const r = checkCopyDisplaySafe(
      "See record 7EE3216B-327C-4DE9-8D5D-2F4C95A6D773.",
    );
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("uuid");
  });
});

describe("checkCopyDisplaySafe — hard-blocked internal tokens", () => {
  it.each([
    ["aiSearchSignal"],
    ["actualSearchQueries"],
    ["topSearchQueries"],
    ["topDescriptors"],
    ["topCompetitorCoMentions"],
    ["competitorPageBlueprints"],
    ["brandAssertions"],
    ["affectedPrompts"],
    ["ownedPageCandidates"],
    ["descriptorWindows"],
    ["evidence_tier"],
    ["source_rec_id"],
    ["rec_id"],
    ["tenant_id"],
    ["evidence_hash"],
    ["target_element_key"],
    ["live_at"],
    ["live_match_kind"],
    ["live_match_confidence"],
    ["implementation_status"],
    ["stableKey"],
    ["pageBrief"],
    ["resolverTier"],
  ])("blocks copy containing %s as a whole word", (token) => {
    const r = checkCopyDisplaySafe(`Pulled from ${token} in the packet.`);
    expect(r.safe).toBe(false);
    if (!r.safe) {
      expect(r.reason).toBe("internal_token");
      expect(r.match).toBe(token);
    }
  });

  it("does NOT block substrings inside longer words", () => {
    // "rec_id" appears whole-word only. A made-up legitimate phrase
    // like "recommendation_id_here" still has snake_case so the snake
    // detector catches it on a separate path — but a continuous string
    // like "recidivism" does NOT contain `\brec_id\b` (no underscore).
    expect(checkCopyDisplaySafe("recidivism is a legal term").safe).toBe(true);
  });
});

describe("checkCopyDisplaySafe — snake_case detection", () => {
  it("blocks multi-segment snake_case (3+ segments)", () => {
    const r = checkCopyDisplaySafe(
      "The page_intent_resolution step was unclear.",
    );
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("snake_case_identifier");
  });

  it("blocks suspicious double-segment snake_case suffixes", () => {
    const r = checkCopyDisplaySafe("Status code is final_status here.");
    expect(r.safe).toBe(false);
    if (!r.safe) expect(r.reason).toBe("snake_case_identifier");
  });

  it("blocks _at / _id / _hash / _tier / _key suffixes", () => {
    expect(checkCopyDisplaySafe("created_at value").safe).toBe(false);
    expect(checkCopyDisplaySafe("customer_id mapping").safe).toBe(false);
    expect(checkCopyDisplaySafe("payload_hash").safe).toBe(false);
    expect(checkCopyDisplaySafe("priority_tier label").safe).toBe(false);
    expect(checkCopyDisplaySafe("api_key in the body").safe).toBe(false);
  });
});

describe("checkCopyDisplaySafe — multi-transition camelCase detection", () => {
  it("blocks identifiers with two or more lowercase→Uppercase transitions", () => {
    expect(checkCopyDisplaySafe("Used topSearchQueries here").safe).toBe(false);
    expect(checkCopyDisplaySafe("aiSearchSignal was empty").safe).toBe(false);
    expect(checkCopyDisplaySafe("Set actualSearchQueries to []").safe).toBe(
      false,
    );
  });

  it("preserves single-transition camelCase (brand / product names)", () => {
    expect(checkCopyDisplaySafe("iPhone has macOS support.").safe).toBe(true);
    expect(checkCopyDisplaySafe("eBay listings").safe).toBe(true);
  });
});

describe("allCopyDisplaySafe", () => {
  it("returns true only when every supplied string passes", () => {
    expect(
      allCopyDisplaySafe("Heading here", "Body paragraph that's fine."),
    ).toBe(true);
    expect(
      allCopyDisplaySafe(
        "Heading here",
        "Body mentions aiSearchSignal so this fails.",
      ),
    ).toBe(false);
  });

  it("treats null / undefined / empty as safe", () => {
    expect(allCopyDisplaySafe(null, undefined, "")).toBe(true);
  });
});
