import "server-only";

/**
 * Adjudicator cache — keyed by sha256 of the canonical evidence-packet
 * JSON. Re-renders of /recommendations against unchanged data cost $0.
 *
 * Phase v7 Commit 3 (2026-04-23).
 */

import { createHash } from "node:crypto";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AdjudicatorOutput } from "./adjudicator-schema";
import { canonicalStringify } from "./evidence-packet";

const STORE_NAME = "adjudicator-cache";

export type AdjudicatorCacheEntry = {
  /** sha256 of canonicalStringify(packet). Primary key. */
  evidenceHash: string;
  stableKey: string;
  model: string;
  output: AdjudicatorOutput;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cachedAt: string;
};

/**
 * Hash a packet for cache + audit keys. Strips volatile fields like
 * `generatedAt` so repeat calls with the same logical inputs hit the
 * cache even when they happen seconds apart.
 */
export function hashEvidencePacket(packet: unknown): string {
  const stable =
    packet && typeof packet === "object"
      ? stripVolatile(packet as Record<string, unknown>)
      : packet;
  const canonical = canonicalStringify(stable);
  return createHash("sha256").update(canonical).digest("hex");
}

function stripVolatile(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key === "generatedAt") continue;
    out[key] = obj[key];
  }
  return out;
}

export async function readCacheEntry(
  evidenceHash: string,
): Promise<AdjudicatorCacheEntry | null> {
  const rows = await readStore<AdjudicatorCacheEntry>(STORE_NAME);
  return rows.find((r) => r.evidenceHash === evidenceHash) ?? null;
}

export async function writeCacheEntry(entry: AdjudicatorCacheEntry): Promise<void> {
  const rows = await readStore<AdjudicatorCacheEntry>(STORE_NAME);
  const idx = rows.findIndex((r) => r.evidenceHash === entry.evidenceHash);
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  // Cap the cache to the most-recent 500 entries so the file stays small.
  const sorted = [...rows].sort((a, b) =>
    a.cachedAt > b.cachedAt ? -1 : 1,
  );
  const capped = sorted.slice(0, 500);
  await writeStore<AdjudicatorCacheEntry>(STORE_NAME, capped);
}

export async function listCacheEntries(): Promise<AdjudicatorCacheEntry[]> {
  return await readStore<AdjudicatorCacheEntry>(STORE_NAME);
}
