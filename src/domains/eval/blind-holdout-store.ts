import "server-only";

import { createHash } from "node:crypto";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  REQUIRED_HOLDOUT_ARCHETYPES,
  validateBlindHoldout,
  type BlindHoldoutCaseReceipt,
  type BlindHoldoutReceipt,
  type BlindHoldoutValidation,
  type HoldoutArchetype,
} from "./blind-holdout-contract";

/**
 * Durable release-evaluation receipts.
 *
 * The validator used to exist without a write/read seam, which made the product
 * permanently unable to register a legitimate hosted blind run. This store is
 * global rather than tenant-scoped because a receipt certifies one immutable
 * application SHA, not one customer's data. The json-store entry is mirrored to
 * Supabase so it survives Vercel instance recycling.
 */
const STORE = "blind-holdout-receipts";
const KEEP = 40;

export type StoredBlindHoldoutReceipt = {
  id: string;
  recordedAt: string;
  receipt: BlindHoldoutReceipt;
};

export type BlindHoldoutReleaseStatus = {
  state: "missing_build" | "missing" | "stale" | "failed" | "eligible";
  currentSha: string | null;
  latest: StoredBlindHoldoutReceipt | null;
  current: StoredBlindHoldoutReceipt | null;
  validation: BlindHoldoutValidation | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseCase(value: unknown, index: number): BlindHoldoutCaseReceipt {
  if (!isObject(value)) throw new Error(`Case ${index + 1} must be an object.`);
  const archetype = value.archetype;
  if (
    typeof archetype !== "string" ||
    !(REQUIRED_HOLDOUT_ARCHETYPES as readonly string[]).includes(archetype)
  ) {
    throw new Error(`Case ${index + 1} has an invalid archetype.`);
  }
  const requiredStrings = [
    "id",
    "preregisteredAt",
    "predictionRecordedAt",
    "expertLabelRevealedAt",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") {
      throw new Error(`Case ${index + 1} is missing ${key}.`);
    }
  }
  if (typeof value.passed !== "boolean") {
    throw new Error(`Case ${index + 1} is missing passed.`);
  }
  if (typeof value.codeChangedInResponse !== "boolean") {
    throw new Error(`Case ${index + 1} is missing codeChangedInResponse.`);
  }
  return {
    id: value.id as string,
    archetype: archetype as HoldoutArchetype,
    preregisteredAt: value.preregisteredAt as string,
    predictionRecordedAt: value.predictionRecordedAt as string,
    expertLabelRevealedAt: value.expertLabelRevealedAt as string,
    passed: value.passed,
    codeChangedInResponse: value.codeChangedInResponse,
  };
}

/** Strict runtime parsing at the operator-input boundary. Unknown fields are
 * ignored, but every field used by the acceptance gate must have the right type. */
export function parseBlindHoldoutReceipt(value: unknown): BlindHoldoutReceipt {
  if (!isObject(value)) throw new Error("The blind receipt must be a JSON object.");
  if (typeof value.candidateSha !== "string") {
    throw new Error("The blind receipt is missing candidateSha.");
  }
  if (!Array.isArray(value.cases)) {
    throw new Error("The blind receipt is missing its cases array.");
  }
  return {
    candidateSha: value.candidateSha,
    cases: value.cases.map(parseCase),
  };
}

function receiptId(receipt: BlindHoldoutReceipt): string {
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}

/** Append one immutable attempt. Invalid/failed attempts are intentionally
 * retained as honest evidence, but only validateBlindHoldout can grant eligibility. */
export async function recordBlindHoldoutReceipt(
  receipt: BlindHoldoutReceipt,
  recordedAt = new Date().toISOString(),
): Promise<StoredBlindHoldoutReceipt> {
  const row: StoredBlindHoldoutReceipt = {
    id: receiptId(receipt),
    recordedAt,
    receipt,
  };
  const rows = await readStore<StoredBlindHoldoutReceipt>(STORE, []);
  const next = rows
    .filter((existing) => existing.id !== row.id)
    .concat(row)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .slice(-KEEP);
  await writeStore(STORE, next);
  return row;
}

export async function listBlindHoldoutReceipts(): Promise<StoredBlindHoldoutReceipt[]> {
  try {
    const rows = await readStore<StoredBlindHoldoutReceipt>(STORE, []);
    return rows
      .filter(
        (row) =>
          isObject(row) &&
          typeof row.id === "string" &&
          typeof row.recordedAt === "string" &&
          isObject(row.receipt),
      )
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } catch {
    return [];
  }
}

/** Pure release-status fold. A valid receipt for any older/newer SHA is stale,
 * never proof for the build currently serving the page. */
export function buildBlindHoldoutReleaseStatus(
  rows: readonly StoredBlindHoldoutReceipt[],
  currentSha: string | null,
): BlindHoldoutReleaseStatus {
  const ordered = [...rows].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const latest = ordered[0] ?? null;
  if (currentSha == null || !/^[0-9a-f]{40}$/i.test(currentSha)) {
    return { state: "missing_build", currentSha, latest, current: null, validation: null };
  }
  const current = ordered.find((row) => row.receipt.candidateSha === currentSha) ?? null;
  if (current == null) {
    return {
      state: latest == null ? "missing" : "stale",
      currentSha,
      latest,
      current: null,
      validation: null,
    };
  }
  const validation = validateBlindHoldout(current.receipt);
  return {
    state: validation.releaseEligible ? "eligible" : "failed",
    currentSha,
    latest,
    current,
    validation,
  };
}

export async function readCurrentBlindHoldoutStatus(
  currentSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null,
): Promise<BlindHoldoutReleaseStatus> {
  return buildBlindHoldoutReleaseStatus(await listBlindHoldoutReceipts(), currentSha);
}

export function blindHoldoutStatusLine(status: BlindHoldoutReleaseStatus): string {
  switch (status.state) {
    case "missing_build":
      return "No fresh blind result is registered for this release. I also cannot match one to this build because its full commit identity is unavailable.";
    case "missing":
      return "No fresh blind result is registered for this release. My known cases only catch regressions.";
    case "stale":
      return `The latest blind result belongs to ${status.latest?.receipt.candidateSha.slice(0, 8) ?? "another build"}, so it does not certify this release.`;
    case "failed":
      return `This release has a blind receipt, but it did not pass: ${status.validation?.reasons[0] ?? "the acceptance gate failed"}`;
    case "eligible":
      return `This release passed ${status.validation?.countedCases ?? 0} preregistered unseen cases across every required decision type.`;
  }
}
