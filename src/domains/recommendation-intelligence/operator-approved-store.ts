/**
 * α₂ approve-to-promote store (operator-locked decision U4, 2026-06-13).
 *
 * Persists the candidate `dedupe_key`s the OPERATOR has explicitly
 * approved for promotion. `selectPromotableCandidates` reads this set
 * (via `operatorApprovedDedupeKeys`) so an approved operator-review-only
 * candidate promotes through the remaining safety gates instead of
 * being tier-suppressed.
 *
 * Tenant-scoped rows in one json-store (mirrors push-snapshots): a row
 * is the operator's standing approval of a candidate identity
 * (dedupe_key is stable across nightly runs for the same
 * trigger×action×URL×topic), so an approval persists until revoked —
 * the candidate re-promotes each night until the operator ships or
 * unapproves it. Dual-write to Supabase is handled by the json-store
 * layer (file-first invariant; Vercel reads hydrate from Supabase).
 *
 * NO push, NO LLM, NO destructive op — pure approval bookkeeping.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "operator-approved-candidates";

export type OperatorApprovedCandidateRow = {
  tenant_id: string;
  /** RecommendationCandidateRow.dedupe_key — the approved identity. */
  dedupe_key: string;
  approved_at: string;
};

async function readAll(): Promise<OperatorApprovedCandidateRow[]> {
  return (await readStore<OperatorApprovedCandidateRow>(STORE)) ?? [];
}

/** The set of approved dedupe_keys for one tenant — the exact shape
 *  `selectPromotableCandidates` consumes. */
export async function loadOperatorApprovedDedupeKeys(
  tenantId: string,
): Promise<Set<string>> {
  const all = await readAll();
  const out = new Set<string>();
  for (const r of all) {
    if (r.tenant_id === tenantId) out.add(r.dedupe_key);
  }
  return out;
}

/** Approve a candidate for promotion. Idempotent (re-approving the
 *  same key is a no-op). */
export async function approveCandidate(args: {
  tenantId: string;
  dedupeKey: string;
  now: Date;
}): Promise<void> {
  const all = await readAll();
  const exists = all.some(
    (r) => r.tenant_id === args.tenantId && r.dedupe_key === args.dedupeKey,
  );
  if (exists) return;
  all.push({
    tenant_id: args.tenantId,
    dedupe_key: args.dedupeKey,
    approved_at: args.now.toISOString(),
  });
  await writeStore(STORE, all);
}

/** Revoke a prior approval. Idempotent. */
export async function unapproveCandidate(args: {
  tenantId: string;
  dedupeKey: string;
}): Promise<void> {
  const all = await readAll();
  const next = all.filter(
    (r) => !(r.tenant_id === args.tenantId && r.dedupe_key === args.dedupeKey),
  );
  if (next.length === all.length) return;
  await writeStore(STORE, next);
}
