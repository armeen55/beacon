import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => stored),
  writeStore: vi.fn(async (_name: string, rows: unknown[]) => { stored = rows; }),
}));

import { validateBlindHoldout } from "./blind-holdout-contract";
import {
  buildBlindHoldoutReceiptFromEvents,
  digestBlindArtifact,
  listBlindHoldoutCaseEvents,
  preregisterBlindHoldoutCase,
  revealBlindHoldoutLabel,
  sealBlindHoldoutPrediction,
} from "./blind-holdout-session-store";

const SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const ARCHETYPES = ["edit", "new_page", "zero_click_trap", "declining_page", "do_nothing"] as const;

beforeEach(() => {
  stored = [];
});

describe("server-sealed blind holdout lifecycle", () => {
  it("stamps preregistration and refuses ID reuse", async () => {
    const row = await preregisterBlindHoldoutCase({
      currentSha: SHA,
      caseId: "fresh-1",
      archetype: "edit",
      inputDigest: digestBlindArtifact("unseen input"),
      now: new Date("2026-07-18T06:00:00.000Z"),
    });
    expect(row).toMatchObject({ phase: "preregister", candidateSha: SHA, recordedAt: "2026-07-18T06:00:00.000Z" });
    await expect(preregisterBlindHoldoutCase({
      currentSha: SHA,
      caseId: "fresh-1",
      archetype: "edit",
      inputDigest: digestBlindArtifact("different input"),
    })).rejects.toThrow("already sealed");
  });

  it("requires the frozen prediction before reveal and spends a case when the build changes", async () => {
    await preregisterBlindHoldoutCase({
      currentSha: SHA,
      caseId: "spent-1",
      archetype: "edit",
      inputDigest: digestBlindArtifact("input"),
      now: new Date("2026-07-18T06:00:00.000Z"),
    });
    await expect(revealBlindHoldoutLabel({
      currentSha: SHA,
      caseId: "spent-1",
      expertLabelDigest: digestBlindArtifact("label"),
      passed: true,
    })).rejects.toThrow("Seal the prediction");
    await sealBlindHoldoutPrediction({
      currentSha: SHA,
      caseId: "spent-1",
      predictionDigest: digestBlindArtifact("prediction"),
      now: new Date("2026-07-18T06:01:00.000Z"),
    });
    const reveal = await revealBlindHoldoutLabel({
      currentSha: NEW_SHA,
      caseId: "spent-1",
      expertLabelDigest: digestBlindArtifact("label"),
      passed: true,
      now: new Date("2026-07-18T06:02:00.000Z"),
    });
    expect(reveal).toMatchObject({ phase: "reveal", codeChangedInResponse: true, revealSha: NEW_SHA });
    const validation = validateBlindHoldout(buildBlindHoldoutReceiptFromEvents(await listBlindHoldoutCaseEvents(), SHA));
    expect(validation.spentCases).toBe(1);
    expect(validation.releaseEligible).toBe(false);
  });

  it("generates an eligible receipt only after five diverse server-ordered cases pass", async () => {
    for (let index = 0; index < ARCHETYPES.length; index += 1) {
      const caseId = `fresh-${index + 1}`;
      await preregisterBlindHoldoutCase({
        currentSha: SHA,
        caseId,
        archetype: ARCHETYPES[index]!,
        inputDigest: digestBlindArtifact(`input-${index}`),
        now: new Date(`2026-07-18T06:0${index}:00.000Z`),
      });
      await sealBlindHoldoutPrediction({
        currentSha: SHA,
        caseId,
        predictionDigest: digestBlindArtifact(`prediction-${index}`),
        now: new Date(`2026-07-18T06:1${index}:00.000Z`),
      });
      await revealBlindHoldoutLabel({
        currentSha: SHA,
        caseId,
        expertLabelDigest: digestBlindArtifact(`label-${index}`),
        passed: true,
        now: new Date(`2026-07-18T06:2${index}:00.000Z`),
      });
    }
    const receipt = buildBlindHoldoutReceiptFromEvents(await listBlindHoldoutCaseEvents(), SHA);
    expect(receipt.cases).toHaveLength(5);
    expect(validateBlindHoldout(receipt)).toEqual({
      releaseEligible: true,
      countedCases: 5,
      spentCases: 0,
      reasons: [],
    });
    for (const row of receipt.cases) {
      expect(Date.parse(row.preregisteredAt)).toBeLessThan(Date.parse(row.predictionRecordedAt));
      expect(Date.parse(row.predictionRecordedAt)).toBeLessThan(Date.parse(row.expertLabelRevealedAt));
    }
  });
});
