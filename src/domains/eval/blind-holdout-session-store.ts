import "server-only";

import { createHash } from "node:crypto";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  REQUIRED_HOLDOUT_ARCHETYPES,
  type BlindHoldoutReceipt,
  type HoldoutArchetype,
} from "./blind-holdout-contract";

const STORE = "blind-holdout-case-events";
const KEEP = 300;

type BaseEvent = {
  eventId: string;
  caseId: string;
  candidateSha: string;
  recordedAt: string;
};

export type BlindHoldoutCaseEvent = BaseEvent & (
  | { phase: "preregister"; archetype: HoldoutArchetype; inputDigest: string }
  | { phase: "prediction"; predictionDigest: string }
  | {
      phase: "reveal";
      expertLabelDigest: string;
      passed: boolean;
      codeChangedInResponse: boolean;
      revealSha: string;
    }
);

type WithoutEventId<T> = T extends unknown ? Omit<T, "eventId"> : never;
type NewBlindHoldoutCaseEvent = WithoutEventId<BlindHoldoutCaseEvent>;

export type BlindHoldoutCaseProgress = {
  caseId: string;
  candidateSha: string;
  archetype: HoldoutArchetype;
  preregisteredAt: string;
  inputDigest: string;
  predictionRecordedAt: string | null;
  predictionDigest: string | null;
  expertLabelRevealedAt: string | null;
  expertLabelDigest: string | null;
  passed: boolean | null;
  codeChangedInResponse: boolean;
};

function validSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function validDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function digestBlindArtifact(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function eventId(value: NewBlindHoldoutCaseEvent): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nextRecordedAt(previous: string | null, now: Date): string {
  const previousMs = previous == null ? Number.NEGATIVE_INFINITY : Date.parse(previous);
  return new Date(Math.max(now.getTime(), Number.isFinite(previousMs) ? previousMs + 1 : now.getTime())).toISOString();
}

function isEvent(value: unknown): value is BlindHoldoutCaseEvent {
  if (value == null || typeof value !== "object") return false;
  const row = value as Partial<BlindHoldoutCaseEvent>;
  return (
    typeof row.eventId === "string" &&
    typeof row.caseId === "string" &&
    typeof row.candidateSha === "string" &&
    typeof row.recordedAt === "string" &&
    (row.phase === "preregister" || row.phase === "prediction" || row.phase === "reveal")
  );
}

export async function listBlindHoldoutCaseEvents(): Promise<BlindHoldoutCaseEvent[]> {
  try {
    return (await readStore<BlindHoldoutCaseEvent>(STORE, []))
      .filter(isEvent)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  } catch {
    return [];
  }
}

async function appendEvent(value: NewBlindHoldoutCaseEvent): Promise<BlindHoldoutCaseEvent> {
  const row = { ...value, eventId: eventId(value) } as BlindHoldoutCaseEvent;
  const rows = await listBlindHoldoutCaseEvents();
  const next = rows
    .filter((existing) => existing.eventId !== row.eventId)
    .concat(row)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .slice(-KEEP);
  await writeStore(STORE, next);
  return row;
}

export function foldBlindHoldoutProgress(
  events: readonly BlindHoldoutCaseEvent[],
): BlindHoldoutCaseProgress[] {
  const cases = new Map<string, BlindHoldoutCaseProgress>();
  for (const event of [...events].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    if (event.phase === "preregister") {
      if (cases.has(event.caseId)) continue;
      cases.set(event.caseId, {
        caseId: event.caseId,
        candidateSha: event.candidateSha,
        archetype: event.archetype,
        preregisteredAt: event.recordedAt,
        inputDigest: event.inputDigest,
        predictionRecordedAt: null,
        predictionDigest: null,
        expertLabelRevealedAt: null,
        expertLabelDigest: null,
        passed: null,
        codeChangedInResponse: false,
      });
      continue;
    }
    const current = cases.get(event.caseId);
    if (!current || current.candidateSha !== event.candidateSha) continue;
    if (event.phase === "prediction" && current.predictionRecordedAt == null) {
      current.predictionRecordedAt = event.recordedAt;
      current.predictionDigest = event.predictionDigest;
    } else if (
      event.phase === "reveal" &&
      current.predictionRecordedAt != null &&
      current.expertLabelRevealedAt == null
    ) {
      current.expertLabelRevealedAt = event.recordedAt;
      current.expertLabelDigest = event.expertLabelDigest;
      current.passed = event.passed;
      current.codeChangedInResponse = event.codeChangedInResponse;
    }
  }
  return [...cases.values()].sort((a, b) => a.preregisteredAt.localeCompare(b.preregisteredAt));
}

export async function preregisterBlindHoldoutCase(args: {
  currentSha: string;
  caseId: string;
  archetype: HoldoutArchetype;
  inputDigest: string;
  now?: Date;
}): Promise<BlindHoldoutCaseEvent> {
  const caseId = args.caseId.trim();
  if (!validSha(args.currentSha)) throw new Error("The live build does not expose a valid full SHA.");
  if (!caseId) throw new Error("Case ID is required.");
  if (!(REQUIRED_HOLDOUT_ARCHETYPES as readonly string[]).includes(args.archetype)) {
    throw new Error("The holdout archetype is invalid.");
  }
  if (!validDigest(args.inputDigest)) throw new Error("The input artifact digest is invalid.");
  const progress = foldBlindHoldoutProgress(await listBlindHoldoutCaseEvents());
  if (progress.some((row) => row.caseId === caseId)) {
    throw new Error("That case ID is already sealed and cannot be reused.");
  }
  return appendEvent({
    phase: "preregister",
    caseId,
    candidateSha: args.currentSha,
    archetype: args.archetype,
    inputDigest: args.inputDigest,
    recordedAt: (args.now ?? new Date()).toISOString(),
  });
}

export async function sealBlindHoldoutPrediction(args: {
  currentSha: string;
  caseId: string;
  predictionDigest: string;
  now?: Date;
}): Promise<BlindHoldoutCaseEvent> {
  if (!validSha(args.currentSha)) throw new Error("The live build does not expose a valid full SHA.");
  if (!validDigest(args.predictionDigest)) throw new Error("The prediction artifact digest is invalid.");
  const progress = foldBlindHoldoutProgress(await listBlindHoldoutCaseEvents());
  const row = progress.find((entry) => entry.caseId === args.caseId.trim());
  if (!row) throw new Error("Preregister this case before sealing a prediction.");
  if (row.candidateSha !== args.currentSha) {
    throw new Error("The deployed build changed after preregistration, so this case is spent.");
  }
  if (row.predictionRecordedAt != null) throw new Error("This prediction is already sealed.");
  return appendEvent({
    phase: "prediction",
    caseId: row.caseId,
    candidateSha: row.candidateSha,
    predictionDigest: args.predictionDigest,
    recordedAt: nextRecordedAt(row.preregisteredAt, args.now ?? new Date()),
  });
}

export async function revealBlindHoldoutLabel(args: {
  currentSha: string;
  caseId: string;
  expertLabelDigest: string;
  passed: boolean;
  now?: Date;
}): Promise<BlindHoldoutCaseEvent> {
  if (!validSha(args.currentSha)) throw new Error("The live build does not expose a valid full SHA.");
  if (!validDigest(args.expertLabelDigest)) throw new Error("The expert-label artifact digest is invalid.");
  const progress = foldBlindHoldoutProgress(await listBlindHoldoutCaseEvents());
  const row = progress.find((entry) => entry.caseId === args.caseId.trim());
  if (!row?.predictionRecordedAt) throw new Error("Seal the prediction before revealing the expert label.");
  if (row.expertLabelRevealedAt != null) throw new Error("This expert label is already sealed.");
  return appendEvent({
    phase: "reveal",
    caseId: row.caseId,
    candidateSha: row.candidateSha,
    expertLabelDigest: args.expertLabelDigest,
    passed: args.passed,
    codeChangedInResponse: row.candidateSha !== args.currentSha,
    revealSha: args.currentSha,
    recordedAt: nextRecordedAt(row.predictionRecordedAt, args.now ?? new Date()),
  });
}

export function buildBlindHoldoutReceiptFromEvents(
  events: readonly BlindHoldoutCaseEvent[],
  candidateSha: string,
): BlindHoldoutReceipt {
  const cases = foldBlindHoldoutProgress(events)
    .filter(
      (row) =>
        row.candidateSha === candidateSha &&
        row.predictionRecordedAt != null &&
        row.expertLabelRevealedAt != null &&
        row.passed != null,
    )
    .map((row) => ({
      id: row.caseId,
      archetype: row.archetype,
      preregisteredAt: row.preregisteredAt,
      predictionRecordedAt: row.predictionRecordedAt!,
      expertLabelRevealedAt: row.expertLabelRevealedAt!,
      passed: row.passed!,
      codeChangedInResponse: row.codeChangedInResponse,
    }));
  return { candidateSha, cases };
}

export async function readBlindHoldoutProgress(candidateSha?: string): Promise<BlindHoldoutCaseProgress[]> {
  const rows = foldBlindHoldoutProgress(await listBlindHoldoutCaseEvents());
  return candidateSha ? rows.filter((row) => row.candidateSha === candidateSha) : rows;
}
