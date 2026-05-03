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
    // The import group can carry multiple symbols (Step 3.7s adds
    // findEmDashes / findIncompleteBrandMentions / getBrandNameStyle
    // into the same import block). Match a multi-symbol shape.
    expect(VALIDATOR_SRC).toMatch(
      /import\s*\{[^}]*findUnsupportedBrandClaims[^}]*\}\s*from\s*"\.\/brand-assertions"/,
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

// ── 6. W3 §3.7s — public-copy style rules (em dash + brand-name-first) ─

describe("W3 §3.7s — public-copy style helpers + validator", () => {
  it("brand-assertions exports getBrandNameStyle + findEmDashes + findIncompleteBrandMentions", () => {
    expect(BRAND_SRC).toMatch(/export function getBrandNameStyle/);
    expect(BRAND_SRC).toMatch(/export function findEmDashes/);
    expect(BRAND_SRC).toMatch(/export function findIncompleteBrandMentions/);
  });

  it("brand-assertions registers Ritz Builders style (fullName + bannedShortForms: ['Ritz'])", () => {
    expect(BRAND_SRC).toMatch(/fullName:\s*"Ritz Builders"/);
    expect(BRAND_SRC).toMatch(/bannedShortForms:\s*\[\s*"Ritz"\s*\]/);
  });

  it("validator imports the new helpers from brand-assertions", () => {
    expect(VALIDATOR_SRC).toMatch(/findEmDashes/);
    expect(VALIDATOR_SRC).toMatch(/findIncompleteBrandMentions/);
    expect(VALIDATOR_SRC).toMatch(/getBrandNameStyle/);
  });

  it("validator wires validateNoEmDashes after validateBrandClaimGrounding", () => {
    const brandIdx = VALIDATOR_SRC.indexOf("validateBrandClaimGrounding(edit, packet)");
    const dashIdx = VALIDATOR_SRC.indexOf("validateNoEmDashes(edit)");
    expect(brandIdx).toBeGreaterThan(0);
    expect(dashIdx).toBeGreaterThan(0);
    expect(dashIdx).toBeGreaterThan(brandIdx);
  });

  it("validator wires validateBrandNameFirstMention after validateNoEmDashes", () => {
    const dashIdx = VALIDATOR_SRC.indexOf("validateNoEmDashes(edit)");
    const nameIdx = VALIDATOR_SRC.indexOf("validateBrandNameFirstMention(edit, packet)");
    expect(dashIdx).toBeGreaterThan(0);
    expect(nameIdx).toBeGreaterThan(0);
    expect(nameIdx).toBeGreaterThan(dashIdx);
  });

  it("BEACON_ALLOW_EM_DASH + BEACON_ALLOW_SHORT_BRAND_NAME env opt-outs are wired", () => {
    expect(VALIDATOR_SRC).toMatch(/BEACON_ALLOW_EM_DASH\s*!==\s*"1"/);
    expect(VALIDATOR_SRC).toMatch(/BEACON_ALLOW_SHORT_BRAND_NAME\s*!==\s*"1"/);
  });
});

describe("W3 §3.7s — SYSTEM_PROMPT carries Rule 19 (voice + style)", () => {
  it("Rule 19 PUBLIC-COPY VOICE + STYLE block is present", () => {
    expect(OPENAI_SRC).toMatch(/19\.\s*\*\*PUBLIC-COPY VOICE \+ STYLE/);
  });

  it("Rule 19a NO EM DASHES is present", () => {
    expect(OPENAI_SRC).toMatch(/19a\.\s*NO EM DASHES/);
  });

  it("Rule 19b FULL ENTITY NAME ON FIRST MENTION is present", () => {
    expect(OPENAI_SRC).toMatch(/19b\.\s*FULL ENTITY NAME/);
    expect(OPENAI_SRC).toMatch(/Ritz Builders/);
    expect(OPENAI_SRC).toMatch(/our team/);
    expect(OPENAI_SRC).toMatch(/our process/);
  });

  it("Rule 19c H2 STYLE is present (topic-first)", () => {
    expect(OPENAI_SRC).toMatch(/19c\.\s*H2 STYLE/);
    expect(OPENAI_SRC).toMatch(/topic[-\s]first/i);
  });

  it("Rule 19d PUBLIC BODY STYLE is present (self-contained chunks)", () => {
    expect(OPENAI_SRC).toMatch(/19d\.\s*PUBLIC BODY STYLE/);
    expect(OPENAI_SRC).toMatch(/answer[-\s]engine/i);
  });

  it("Rule 19e GOLD-STANDARD EXAMPLE includes the operator-approved Palo Alto H2", () => {
    expect(OPENAI_SRC).toMatch(/19e\.\s*GOLD-STANDARD EXAMPLE/);
    expect(OPENAI_SRC).toMatch(/Architect-designed custom homes in Palo Alto/);
    // The example body is line-wrapped inside the SYSTEM_PROMPT
    // template literal — match the key phrase across optional
    // whitespace.
    expect(OPENAI_SRC).toMatch(
      /Ritz Builders emphasizes an architect-led\s+design-build approach/,
    );
    expect(OPENAI_SRC).toMatch(/our integrated process/);
  });
});

// ── 7. W3 §3.8 — FAQ Q+A pairing contract ───────────────────────────────

describe("W3 §3.8 — SYSTEM_PROMPT carries the paired FAQ output contract", () => {
  it("Rule 13 names the W3 §3.8 PAIRED FAQ OUTPUT contract", () => {
    expect(OPENAI_SRC).toMatch(/PAIRED FAQ OUTPUT/);
  });

  it("describes the faq_question[new] / faq_answer[new] hash-pairing shape", () => {
    expect(OPENAI_SRC).toMatch(/faq_question\[new\]:<hash>/);
    expect(OPENAI_SRC).toMatch(/faq_answer\[new\]:<hash>/);
    expect(OPENAI_SRC).toMatch(/SAME hash suffix/);
  });

  it("includes BAD (bundled) and GOOD (paired) examples", () => {
    expect(OPENAI_SRC).toMatch(/BAD \(bundled\s*[—-]+\s*REJECTED/);
    expect(OPENAI_SRC).toMatch(/GOOD \(paired\s*[—-]+\s*passes\)/);
  });

  it("notes that the answer body is governed by Rule 18 + Rule 19 gates", () => {
    expect(OPENAI_SRC).toMatch(
      /Rule 18 brand-claim grounding[\s\S]+Rule 19 voice \+ style/,
    );
  });
});

describe("W3 §3.8 — validator wires FAQ row-shape + bundle-pairing", () => {
  it("imports parseElementTypeFromKey + checkFaqPairing helper exists", () => {
    expect(VALIDATOR_SRC).toMatch(/function checkFaqPairing/);
    expect(VALIDATOR_SRC).toMatch(/function validateFaqRowShape/);
  });

  it("validateFaqRowShape runs BEFORE validateFaqIntentRewriting (so bundled Q+A gets the actionable error)", () => {
    const shapeIdx = VALIDATOR_SRC.indexOf("validateFaqRowShape(edit)");
    const intentIdx = VALIDATOR_SRC.indexOf(
      "validateFaqIntentRewriting(edit, packet)",
    );
    expect(shapeIdx).toBeGreaterThan(0);
    expect(intentIdx).toBeGreaterThan(0);
    expect(shapeIdx).toBeLessThan(intentIdx);
  });

  it("validateSpecificEditBundle aggregates FAQ pairing failures into bundleErrors", () => {
    expect(VALIDATOR_SRC).toMatch(/checkFaqPairing\(bundle\.recommendations\)/);
    expect(VALIDATOR_SRC).toMatch(/bundleErrors\.push/);
  });

  it("validateSpecificEditBundle overwrites the orphan per-edit result so callers see WHICH row was orphaned", () => {
    expect(VALIDATOR_SRC).toMatch(
      /perEditMutable\[pf\.editIndex\]\s*=\s*\{[\s\S]*?result:\s*fail/,
    );
  });
});
