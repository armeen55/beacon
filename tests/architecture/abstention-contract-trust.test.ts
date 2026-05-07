/**
 * Architecture invariant — Trust Sprint Mini-Phase T4.1 (2026-05-06).
 *
 * Pins the abstention-contract validator wiring at the source-text
 * level so a future "small refactor" cannot quietly remove the gate
 * or weaken its rejection reasons.
 *
 * Contract verified:
 *   1. The 4 reject reasons exist verbatim in `specific-edit-validator.ts`.
 *   2. `validateAbstentionContract` is called as the FIRST per-edit gate
 *      in `validateSpecificEdit` (before actionType + targetUrl + element
 *      checks) — so a structurally thin packet rejects without wasting
 *      CPU on downstream gates AND without depending on any other gate
 *      to pass first.
 *   3. `runProviderAndPersist` runs `validateSpecificEditBundle`, which
 *      runs `validateSpecificEdit` per row, which runs the abstention
 *      contract. Verified by the chain of imports + the wiring above.
 *   4. `checkAbstentionContract(packet, null)` runs only the packet-level
 *      triggers (A, B, C). Trigger D requires the edit's elementKey.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const VALIDATOR_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "recommendations",
  "specific-edit-validator.ts",
);
const PERSISTENCE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "recommendations",
  "recommended-edits-persistence.ts",
);

const VALIDATOR_SRC = fs.readFileSync(VALIDATOR_PATH, "utf-8");
const PERSISTENCE_SRC = fs.readFileSync(PERSISTENCE_PATH, "utf-8");

describe("Architecture — abstention contract reject reasons (T4.1)", () => {
  it("the 4 reject reasons exist verbatim", () => {
    expect(VALIDATOR_SRC).toContain('"abstention_contract_low_confidence_no_brand_assertions"');
    expect(VALIDATOR_SRC).toContain('"abstention_contract_no_grounding_signals"');
    expect(VALIDATOR_SRC).toContain('"abstention_contract_single_prompt_thin_evidence"');
    expect(VALIDATOR_SRC).toContain('"abstention_contract_thin_faq_answer"');
  });

  it("AbstentionRejectReason is a public exported union", () => {
    expect(VALIDATOR_SRC).toMatch(/export type AbstentionRejectReason\s*=/);
  });

  it("validateAbstentionContract is exported", () => {
    expect(VALIDATOR_SRC).toMatch(/export function validateAbstentionContract/);
  });

  it("checkAbstentionContract is exported (used by audit script)", () => {
    expect(VALIDATOR_SRC).toMatch(/export function checkAbstentionContract/);
  });
});

describe("Architecture — validateSpecificEdit wires abstention as the FIRST gate (T4.1)", () => {
  it("validateAbstentionContract is called BEFORE the actionType gate inside validateSpecificEdit", () => {
    // The function body must call validateAbstentionContract before any
    // ACTION_TYPES / packet.allowedActionTypes check. Pin the order.
    const fn = /export function validateSpecificEdit[\s\S]+?const abstentionGate = validateAbstentionContract\(edit, packet\);[\s\S]+?if\s*\(!abstentionGate\.ok\)\s*return abstentionGate;[\s\S]+?\(ACTION_TYPES as readonly string\[\]\)\.includes\(edit\.actionType\)/m.exec(
      VALIDATOR_SRC,
    );
    expect(
      fn,
      "validateSpecificEdit must call validateAbstentionContract before the actionType gate",
    ).not.toBeNull();
  });

  it("validateAbstentionContract returns a ValidationResult with field='packet' on reject", () => {
    // Pin that the failing path emits a ValidationFail keyed on "packet"
    // so downstream consumers can distinguish abstention from per-edit
    // shape failures without parsing the reason string.
    const fn = /export function validateAbstentionContract[\s\S]+?return fail\("packet",\s*reason\);/m.exec(
      VALIDATOR_SRC,
    );
    expect(fn, "validateAbstentionContract must fail() on the 'packet' field").not.toBeNull();
  });
});

describe("Architecture — runProviderAndPersist filters out abstention-rejected edits (T4.1)", () => {
  it("runProviderAndPersist calls validateSpecificEditBundle and persists only ok=true rows", () => {
    expect(PERSISTENCE_SRC).toMatch(/validateSpecificEditBundle\(bundle, opts\.packet\)/);
    // The acceptedEdits filter is the structural guard: rows where
    // result.ok===false are dropped before mapSpecificEditToRow.
    expect(PERSISTENCE_SRC).toMatch(
      /acceptedEdits[\s\S]+?validation\.perEdit[\s\S]+?\.filter\([\s\S]+?p\.result\.ok\)/,
    );
  });
});

describe("Architecture — D rule discriminates faq_answer via element key (T4.1)", () => {
  it("isFaqAnswerEdit uses parseElementTypeFromKey to detect faq_answer", () => {
    expect(VALIDATOR_SRC).toMatch(/function isFaqAnswerEdit/);
    expect(VALIDATOR_SRC).toMatch(/parseElementTypeFromKey\(tel\.elementKey\)/);
    expect(VALIDATOR_SRC).toMatch(/parsed\s*===\s*"faq_answer"/);
  });
});
