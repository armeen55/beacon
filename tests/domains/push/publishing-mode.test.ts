/**
 * Armed publishing mode — the per-site policy gate (2026-06-16).
 *
 * Pins the operator's "Option 1: per-site arming, then 1-click" rails:
 *   • default (staged) NEVER publishes on Accept;
 *   • armed + safe + mapped + live target → one-click live publish;
 *   • armed REFUSES rejected / low / needs-more-evidence (QA !approve);
 *   • armed REFUSES non-field directives + routes manual builds to paste-ready;
 *   • a non-live target (Ritz dev_note / git_pr) can never one-click publish;
 *   • disarming returns to two-click;
 *   • arming requires connector + mapping + dry-run + confirmed rails.
 *
 * The pure gate decides ONLY routing; executePush remains the structural
 * authority (snapshot / cap / field-only / non-destructive / Ritz refuse) and
 * is pinned by tests/domains/push/push-service*.test.ts.
 */

import { describe, it, expect } from "vitest";

import {
  decideAcceptDisposition,
  isOneClickPublish,
  evaluateArmingPreconditions,
  type AcceptDispositionInput,
  type PublishingMode,
} from "@/domains/push/publishing-mode";
import type { RecPushReadiness } from "@/domains/recommendations/recommendation-qa";

function input(o: Partial<AcceptDispositionInput> & { approve?: boolean; pushReadiness?: RecPushReadiness }): AcceptDispositionInput {
  return {
    mode: o.mode ?? "armed",
    canPublish: o.canPublish ?? true,
    publishTarget: o.publishTarget ?? "wix_cms",
    isSuggestion: o.isSuggestion ?? true,
    qaVerdict:
      o.qaVerdict !== undefined
        ? o.qaVerdict
        : { approve: o.approve ?? true, pushReadiness: o.pushReadiness ?? "paste_ready" },
  };
}

describe("decideAcceptDisposition — the per-site one-click gate", () => {
  it("DEFAULT (staged) never publishes on Accept — even a perfect rec stages", () => {
    expect(decideAcceptDisposition(input({ mode: "staged" }))).toBe("stage");
  });

  it("ARMED + safe + mapped field edit + live target → publish_live", () => {
    expect(decideAcceptDisposition(input({ mode: "armed" }))).toBe("publish_live");
    expect(isOneClickPublish(input({ mode: "armed" }))).toBe(true);
  });

  it("ARMED REFUSES a rejected rec (QA !approve) → review_only", () => {
    expect(decideAcceptDisposition(input({ approve: false }))).toBe("review_only");
  });

  it("ARMED REFUSES a low / needs-more-evidence rec (QA !approve) → review_only", () => {
    // low and needs_more_evidence both surface as approve=false from the gate.
    expect(decideAcceptDisposition(input({ approve: false, pushReadiness: "paste_ready" }))).toBe(
      "review_only",
    );
  });

  it("ARMED routes a manual build (new page) to paste_ready, not a live write", () => {
    expect(decideAcceptDisposition(input({ pushReadiness: "manual" }))).toBe("paste_ready");
  });

  it("ARMED refuses a non-publishable directive (review_only readiness) → review_only", () => {
    expect(decideAcceptDisposition(input({ pushReadiness: "review_only" }))).toBe("review_only");
  });

  it("a non-live target (Ritz dev_note) can NEVER one-click publish → stage", () => {
    expect(decideAcceptDisposition(input({ publishTarget: "dev_note" }))).toBe("stage");
    expect(decideAcceptDisposition(input({ publishTarget: "git_pr" }))).toBe("stage");
  });

  it("no publish permission → stage even when armed", () => {
    expect(decideAcceptDisposition(input({ canPublish: false }))).toBe("stage");
  });

  it("DISARMING (staged again) returns to two-click → stage", () => {
    const armed: PublishingMode = "armed";
    const staged: PublishingMode = "staged";
    expect(decideAcceptDisposition(input({ mode: armed }))).toBe("publish_live");
    expect(decideAcceptDisposition(input({ mode: staged }))).toBe("stage");
  });

  it("an already-actioned row (not a suggestion) never re-publishes → stage", () => {
    expect(decideAcceptDisposition(input({ isSuggestion: false }))).toBe("stage");
  });

  it("missing verdict → review_only (fail-safe)", () => {
    expect(decideAcceptDisposition(input({ qaVerdict: null }))).toBe("review_only");
  });
});

describe("evaluateArmingPreconditions — arming requires real readiness", () => {
  const ready = {
    publishTarget: "wix_cms" as const,
    connectorConnected: true,
    mappingCount: 3,
    dryRunPassed: true,
    safetyRailsConfirmed: true,
  };

  it("all preconditions met → canArm", () => {
    const e = evaluateArmingPreconditions(ready);
    expect(e.canArm).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it("no live target → cannot arm (connector precondition unmet)", () => {
    const e = evaluateArmingPreconditions({ ...ready, publishTarget: "dev_note" });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("connector_connected");
  });

  it("no mappings → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, mappingCount: 0 });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("collection_mapped");
  });

  it("dry-run not passed → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, dryRunPassed: false });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("dry_run_passed");
  });

  it("safety rails not confirmed → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, safetyRailsConfirmed: false });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("safety_rails_confirmed");
  });
});
