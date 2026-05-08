/**
 * Architecture invariants — UX.4 customer-safe labels (2026-05-07).
 *
 * Pins the three label changes shipped in UX.4:
 *   - HELPING_VERDICT_STYLE.label === "Measured lift"   (action-card.tsx)
 *   - VERDICT_LABEL.weak_signal    === "Early signal"   (truth-client.tsx)
 *   - STATUS_LABEL.insufficient_post_data === "Still watching"
 *   - STATUS_LABEL.zero_signal     === "No movement yet"  (attribution-status-pill.tsx)
 *
 * Plus negative checks: the OLD labels do not regress.
 *
 * The honest "Trustworthy / Directional / Unreliable" trust-level
 * labels in `<WhyThisNumber>` are intentionally NOT touched — they
 * live behind a `<details>` disclosure and are pinned by the existing
 * `score-provenance-trust-labels.test.ts`. UX.4 honors that contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const ACTION_CARD = join(
  REPO_ROOT,
  "src/components/today/action-card.tsx",
);
const TRUTH_CLIENT = join(
  REPO_ROOT,
  "src/app/(shell)/changes/truth/truth-client.tsx",
);
const ATTRIBUTION_PILL = join(
  REPO_ROOT,
  "src/app/(shell)/changes/attribution-status-pill.tsx",
);

const ACTION_CARD_SRC = readFileSync(ACTION_CARD, "utf8");
const TRUTH_CLIENT_SRC = readFileSync(TRUTH_CLIENT, "utf8");
const ATTRIBUTION_PILL_SRC = readFileSync(ATTRIBUTION_PILL, "utf8");

describe("UX.4 — helping_verdict label = 'Measured lift'", () => {
  it("HELPING_VERDICT_STYLE.label === 'Measured lift' in action-card.tsx", () => {
    expect(ACTION_CARD_SRC).toMatch(
      /HELPING_VERDICT_STYLE[\s\S]{0,300}label:\s*"Measured lift"/,
    );
  });

  it("does NOT regress to 'Measured win'", () => {
    expect(ACTION_CARD_SRC).not.toMatch(/label:\s*"Measured win"/);
  });
});

describe("UX.4 — weak_signal label = 'Early signal'", () => {
  it("VERDICT_LABEL.weak_signal === 'Early signal' in truth-client.tsx", () => {
    expect(TRUTH_CLIENT_SRC).toMatch(/weak_signal:\s*"Early signal"/);
  });

  it("does NOT regress to 'Early signs of lift'", () => {
    expect(TRUTH_CLIENT_SRC).not.toMatch(
      /weak_signal:\s*"Early signs of lift"/,
    );
  });
});

describe("UX.4 — AttributionStatusPill softens scary defaults", () => {
  it("STATUS_LABEL.insufficient_post_data === 'Still watching'", () => {
    expect(ATTRIBUTION_PILL_SRC).toMatch(
      /insufficient_post_data:\s*"Still watching"/,
    );
  });

  it("STATUS_LABEL.zero_signal === 'No movement yet'", () => {
    expect(ATTRIBUTION_PILL_SRC).toMatch(
      /zero_signal:\s*"No movement yet"/,
    );
  });

  it("does NOT regress to the old scary defaults", () => {
    expect(ATTRIBUTION_PILL_SRC).not.toMatch(
      /insufficient_post_data:\s*"Too early"/,
    );
    expect(ATTRIBUTION_PILL_SRC).not.toMatch(
      /zero_signal:\s*"No signal"/,
    );
  });

  it("AttributionStatusPill does NOT render 'Unreliable' / 'Contaminated' / 'False positive' as default labels", () => {
    // Defense-in-depth: the pill should never use these scary words
    // as STATUS_LABEL values. (The trust-level labels in
    // <WhyThisNumber> live behind a <details> disclosure and are
    // honest-by-contract; that's a different surface.)
    const labelMap = ATTRIBUTION_PILL_SRC.match(
      /STATUS_LABEL:\s*Record[\s\S]*?\}\s*;/,
    );
    expect(labelMap).toBeTruthy();
    if (!labelMap) return;
    const body = labelMap[0];
    expect(body).not.toMatch(/\bUnreliable\b/);
    expect(body).not.toMatch(/\bContaminated\b/);
    expect(body).not.toMatch(/\bFalse positive\b/i);
  });
});

describe("UX.4 — semantics unchanged (enum keys preserved)", () => {
  it("AttributionStatusPill enum keys are intact", () => {
    // Pin the enum keys so a refactor that renamed them would break.
    // The brief says 'change labels, not semantics'.
    for (const key of [
      "computed",
      "weak_estimate",
      "no_controls",
      "unsupported_scope",
      "insufficient_baseline",
      "insufficient_post_data",
      "zero_signal",
      "ineligible_layer",
      "ineligible_event",
    ]) {
      expect(ATTRIBUTION_PILL_SRC).toContain(`${key}:`);
    }
  });
});
