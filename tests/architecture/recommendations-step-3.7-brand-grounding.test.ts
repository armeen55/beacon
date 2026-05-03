/**
 * W3 Step 3.7 (2026-05-03) — brand-claim grounding architecture
 * invariants.
 *
 * Source-scan contracts that protect the operator-locked grounding
 * layer against silent regression:
 *
 *   - The OpenAI SYSTEM_PROMPT carries Rule 18 (BRAND-CLAIM
 *     GROUNDING) with the Allowed / Forbidden / Grounded-phrasing
 *     blocks.
 *   - The OpenAI provider sends `packet.brandAssertions` to the
 *     model (the user-message body stringifies the full packet).
 *   - The evidence-packet builder threads `brandAssertions` into the
 *     packet AND that field flows into the evidenceHash (deterministic
 *     hash flips when the assertion list changes).
 *   - The validator wires `validateBrandClaimGrounding` after the
 *     competitor-public-copy gate.
 *   - The brand-assertions module exports the canonical helpers.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const OPENAI_SRC = fs.readFileSync(
  path.join(ROOT, "src/domains/recommendations/providers/openai.ts"),
  "utf-8",
);
const VALIDATOR_SRC = fs.readFileSync(
  path.join(ROOT, "src/domains/recommendations/specific-edit-validator.ts"),
  "utf-8",
);
const PACKET_SRC = fs.readFileSync(
  path.join(ROOT, "src/domains/recommendations/specific-edit-evidence.ts"),
  "utf-8",
);
const BRAND_SRC = fs.readFileSync(
  path.join(ROOT, "src/domains/recommendations/brand-assertions.ts"),
  "utf-8",
);

// ── 1. SYSTEM_PROMPT carries Rule 18 + the canonical claim lists ────────

describe("W3 Step 3.7 — OpenAI SYSTEM_PROMPT carries the brand-grounding contract", () => {
  it("Rule 18 BRAND-CLAIM GROUNDING heading is present", () => {
    expect(OPENAI_SRC).toMatch(
      /18\.\s*\*\*BRAND-CLAIM GROUNDING/,
    );
  });

  it("Forbidden-claim block enumerates the operator-locked patterns", () => {
    // Each phrase the operator's W3 §3.7 brief named appears verbatim.
    expect(OPENAI_SRC).toMatch(/frequently \/ commonly \/ often recommended/);
    expect(OPENAI_SRC).toMatch(/most trusted/);
    expect(OPENAI_SRC).toMatch(/award-winning/);
    expect(OPENAI_SRC).toMatch(/top-rated/);
    expect(OPENAI_SRC).toMatch(/years in business/);
    expect(OPENAI_SRC).toMatch(/since 19YY \/ since 20YY/);
    expect(OPENAI_SRC).toMatch(/guarantees? of outcome/);
    expect(OPENAI_SRC).toMatch(/PERMANENTLY LOCKED/);
  });

  it("Allowed-block references packet.brandAssertions explicitly", () => {
    expect(OPENAI_SRC).toMatch(/packet\.brandAssertions/);
  });

  it("Grounded-phrasing examples appear (Ritz emphasizes / can highlight / The section should explain)", () => {
    expect(OPENAI_SRC).toMatch(/Ritz emphasizes/);
    expect(OPENAI_SRC).toMatch(/can highlight/);
    expect(OPENAI_SRC).toMatch(/The section should explain/);
  });

  it("The unlocked-by category map appears (popularity / award / ranking_first / trust / tenure / client_outcome)", () => {
    expect(OPENAI_SRC).toMatch(/popularity/);
    expect(OPENAI_SRC).toMatch(/ranking_first/);
    expect(OPENAI_SRC).toMatch(/award/);
    expect(OPENAI_SRC).toMatch(/trust/);
    expect(OPENAI_SRC).toMatch(/tenure/);
    expect(OPENAI_SRC).toMatch(/client_outcome/);
  });
});

// ── 2. OpenAI provider passes the packet (with brandAssertions) into ────
//      the user-message body.

describe("W3 Step 3.7 — OpenAI provider ships brandAssertions in the request body", () => {
  it("user-message content stringifies the full packet (which now carries brandAssertions)", () => {
    expect(OPENAI_SRC).toMatch(
      /content:\s*`Evidence packet:\\n\$\{JSON\.stringify\(packet[\s\S]*?\}\`/,
    );
  });
});

// ── 3. Packet builder threads brandAssertions ──────────────────────────

describe("W3 Step 3.7 — evidence-packet builder includes brandAssertions", () => {
  it("imports getBrandAssertions + BrandAssertion", () => {
    expect(PACKET_SRC).toMatch(
      /import\s*\{[^}]*getBrandAssertions[\s\S]*?from\s*"\.\/brand-assertions"/,
    );
  });

  it("packet type declares brandAssertions: BrandAssertion[]", () => {
    expect(PACKET_SRC).toMatch(/brandAssertions:\s*BrandAssertion\[\]/);
  });

  it("builder body populates brandAssertions via getBrandAssertions(args.tenantId)", () => {
    expect(PACKET_SRC).toMatch(
      /brandAssertions:\s*\[\.\.\.\s*getBrandAssertions\(args\.tenantId\)/,
    );
  });

  it("evidenceHash is computed AFTER brandAssertions is populated", () => {
    // The withoutHash block (which is hashed) sits before
    // computeEvidenceHash. Verify brandAssertions appears INSIDE the
    // withoutHash literal so the hash flips when the list changes.
    const withoutHashStart = PACKET_SRC.indexOf("const withoutHash");
    const computeHashIdx = PACKET_SRC.indexOf("computeEvidenceHash(withoutHash)");
    expect(withoutHashStart).toBeGreaterThan(0);
    expect(computeHashIdx).toBeGreaterThan(withoutHashStart);
    const withoutHashBlock = PACKET_SRC.slice(withoutHashStart, computeHashIdx);
    expect(withoutHashBlock).toMatch(/brandAssertions/);
  });
});

// ── 4. Validator wires the new gate ────────────────────────────────────

describe("W3 Step 3.7 — validator wires validateBrandClaimGrounding", () => {
  it("imports findUnsupportedBrandClaims from brand-assertions", () => {
    expect(VALIDATOR_SRC).toMatch(
      /import\s*\{\s*findUnsupportedBrandClaims\s*\}\s*from\s*"\.\/brand-assertions"/,
    );
  });

  it("validateBrandClaimGrounding is defined as a function in the validator", () => {
    expect(VALIDATOR_SRC).toMatch(
      /function validateBrandClaimGrounding\([\s\S]*?packet:\s*SpecificEditEvidencePacket/,
    );
  });

  it("the validator's main path calls validateBrandClaimGrounding AFTER validateCompetitorPublicCopy", () => {
    const competitorIdx = VALIDATOR_SRC.indexOf("validateCompetitorPublicCopy(edit, packet)");
    const brandIdx = VALIDATOR_SRC.indexOf("validateBrandClaimGrounding(edit, packet)");
    expect(competitorIdx).toBeGreaterThan(0);
    expect(brandIdx).toBeGreaterThan(0);
    expect(brandIdx).toBeGreaterThan(competitorIdx);
  });

  it("the BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS env opt-out is wired", () => {
    expect(VALIDATOR_SRC).toMatch(
      /BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS\s*!==\s*"1"/,
    );
  });
});

// ── 5. Brand-assertions module exports + content ──────────────────────

describe("W3 Step 3.7 — brand-assertions module exposes the canonical surface", () => {
  it("exports getBrandAssertions + findUnsupportedBrandClaims + format helpers", () => {
    expect(BRAND_SRC).toMatch(/export function getBrandAssertions/);
    expect(BRAND_SRC).toMatch(/export function findUnsupportedBrandClaims/);
    expect(BRAND_SRC).toMatch(/export function formatBrandAssertionsForPrompt/);
    expect(BRAND_SRC).toMatch(/export function formatForbiddenClaimsForPrompt/);
  });

  it("declares the Ritz Builders curated list", () => {
    expect(BRAND_SRC).toMatch(/architect-led design-build/);
    expect(BRAND_SRC).toMatch(/Silicon Valley luxury custom homes/);
    expect(BRAND_SRC).toMatch(/whole-home remodels/);
  });

  it("FORBIDDEN_CLAIM_PATTERNS is exported", () => {
    expect(BRAND_SRC).toMatch(/export const FORBIDDEN_CLAIM_PATTERNS/);
  });
});
