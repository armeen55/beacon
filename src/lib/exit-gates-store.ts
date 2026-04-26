/**
 * Internal operator sign-off for Track 1.2 (Daily Ritual), 1.3 (Replication), and 1.4 (Local layer).
 * Persisted in `.data/exit-gates.json` via `json-store` — no workflow, no audit trail.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  EXIT_GATE_KEYS,
  EXIT_GATE_DEFAULT_UPDATED_AT,
  type ExitGateKey,
  type ExitGateRecord,
  type ExitGateStatus,
} from "@/lib/exit-gates-types";

export type { ExitGateKey, ExitGateRecord, ExitGateStatus } from "@/lib/exit-gates-types";
export { EXIT_GATE_KEYS, EXIT_GATE_DEFAULT_UPDATED_AT } from "@/lib/exit-gates-types";

const STORE = "exit-gates";

const STATUSES: ReadonlySet<ExitGateStatus> = new Set([
  "not_started",
  "in_review",
  "passed",
  "failed",
]);

function defaultRecord(key: ExitGateKey): ExitGateRecord {
  return {
    key,
    status: "not_started",
    note: "",
    updated_at: EXIT_GATE_DEFAULT_UPDATED_AT,
  };
}

function coerceStatus(v: unknown): ExitGateStatus {
  return typeof v === "string" && STATUSES.has(v as ExitGateStatus)
    ? (v as ExitGateStatus)
    : "not_started";
}

const KNOWN_EXIT_GATE_KEYS = new Set<string>(EXIT_GATE_KEYS);

function parseRow(raw: unknown): ExitGateRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = o.key;
  if (typeof key !== "string" || !KNOWN_EXIT_GATE_KEYS.has(key)) return null;
  const note = typeof o.note === "string" ? o.note : "";
  const updated_at =
    typeof o.updated_at === "string" && o.updated_at.length > 0
      ? o.updated_at
      : EXIT_GATE_DEFAULT_UPDATED_AT;
  return {
    key: key as ExitGateKey,
    status: coerceStatus(o.status),
    note,
    updated_at,
  };
}

/**
 * Normalize to exactly one row per known key in canonical order. Unknown rows are ignored.
 */
export function normalizeExitGates(rows: unknown[]): ExitGateRecord[] {
  const byKey = new Map<ExitGateKey, ExitGateRecord>();
  for (const raw of rows) {
    const parsed = parseRow(raw);
    if (parsed) byKey.set(parsed.key, parsed);
  }
  return EXIT_GATE_KEYS.map((k) => byKey.get(k) ?? defaultRecord(k));
}

/** Full snapshot (immutable copy). Empty / missing file → all gates `not_started`. */
export async function readExitGates(): Promise<ExitGateRecord[]> {
  const raw = await readStore<ExitGateRecord>(STORE, []);
  return normalizeExitGates(raw).map((r) => ({ ...r }));
}

/** Replace entire store (normalized to all known keys). */
export async function writeExitGates(gates: ExitGateRecord[]): Promise<void> {
  const normalized = normalizeExitGates(gates);
  await writeStore(STORE, normalized);
}

export async function getExitGate(key: ExitGateKey): Promise<ExitGateRecord> {
  return (await readExitGates()).find((g) => g.key === key) ?? defaultRecord(key);
}

export type ExitGatePatch = Partial<Pick<ExitGateRecord, "status" | "note">>;

/**
 * Merge patch for one gate. `updated_at` advances only when status or note actually changes.
 */
export async function updateExitGate(
  key: ExitGateKey,
  patch: ExitGatePatch,
): Promise<ExitGateRecord> {
  const list = await readExitGates();
  const idx = list.findIndex((g) => g.key === key);
  const prev = list[idx] ?? defaultRecord(key);
  const note = patch.note !== undefined ? patch.note : prev.note;
  const status = patch.status !== undefined ? patch.status : prev.status;
  const safeStatus = coerceStatus(status);
  const changed = note !== prev.note || safeStatus !== prev.status;
  const next: ExitGateRecord = {
    key,
    status: safeStatus,
    note,
    updated_at: changed ? new Date().toISOString() : prev.updated_at,
  };
  const merged = list.map((g) => (g.key === key ? next : g));
  await writeExitGates(merged);
  return next;
}

/** Test helper: clear persisted rows (next read normalizes to defaults). */
export async function _resetExitGatesStoreForTests(): Promise<void> {
  await writeStore(STORE, []);
}
