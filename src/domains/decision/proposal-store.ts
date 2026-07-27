/**
 * decision/proposal-store (CORE 100K decision kernel, 2026-07-22) — durable,
 * fail-soft persistence for a ChangeProposal. The kernel owns its own storage
 * so it does not depend on any old draft/rec store internals.
 *
 * Reuses the existing `move_drafts` table (free-text `content` column, no
 * migration) under the synthetic kind `change_proposal`, keyed by the
 * proposal's own stable id. Latest write per id wins.
 *
 * ONE MATERIAL ROW PER GENERATION (2026-07-27). The save used to be a plain
 * insert, so every surface refresh appended another copy of an unchanged
 * proposal: 500 rows for 31 distinct proposals, one of them written 27 times,
 * each with a fresh timestamp that made yesterday's thinking read as today's
 * work. A save now compares a CONTENT FINGERPRINT (the material fields an
 * operator would act on) against the row already stored and writes nothing when
 * they match. No new table, no migration, no history deleted.
 *
 * DEGRADE-SAFE, exactly like move-draft-store.ts: if the table is absent
 * (PGRST205 / Postgres 42P01) reads return empty and writes return false; the
 * caller behaves as generate-on-demand. Never throws. Every LOAD re-validates
 * through deserializeChangeProposal, so a tampered/legacy row can never be
 * served as a trusted proposal.
 *
 * server-only.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import {
  type ChangeProposal,
  serializeChangeProposal,
  deserializeChangeProposal,
} from "./contracts";

const KIND = "change_proposal";

/** A missing table (not yet migrated) — treat as "no proposals", not an error. */
function isMissingTable(code?: string | null): boolean {
  return code === "PGRST205" || code === "42P01";
}

/** saved = a new material generation is durable. unchanged = the stored row already
 *  says exactly this, so nothing was written. failed = the write did not land. */
export type SaveResult = "saved" | "unchanged" | "failed";

/**
 * PURE: the fingerprint of everything an operator would act on. Deliberately
 * EXCLUDES createdAt and anything else that moves on its own, so a pass that
 * re-derives the same decision from the same evidence produces the same
 * fingerprint and writes nothing.
 */
export function proposalFingerprint(p: ChangeProposal): string {
  const material = {
    id: p.id,
    status: p.status,
    confidence: p.confidence,
    basis: p.basis ?? null,
    change: p.recommendedChange,
    limitations: p.limitations,
    components: (p.bundle?.components ?? []).map((c) => [c.kind, c.before, c.after, c.evidenceKeys, c.risk]),
    receipt: (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt]),
    missing: p.bundle?.receipt.missing ?? [],
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

/** Persist one proposal, or NOTHING when the stored row is already this exact
 *  proposal. Fail-soft → "failed". */
export async function saveChangeProposal(proposal: ChangeProposal): Promise<SaveResult> {
  if (!proposal.tenantId || !proposal.id) return "failed";
  const content = serializeChangeProposal(proposal);
  try {
    const stored = await loadChangeProposal(proposal.tenantId, proposal.id);
    if (stored && proposalFingerprint(stored) === proposalFingerprint(proposal)) return "unchanged";
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("move_drafts").insert({
      tenant_id: proposal.tenantId,
      rec_id: proposal.id,
      kind: KIND,
      content: content.slice(0, 12_000),
    });
    if (error) {
      if (!isMissingTable(error.code)) {
        log.warn("[proposal-store] save failed", { tenantId: proposal.tenantId, id: proposal.id, error: error.message });
      }
      return "failed";
    }
    return "saved";
  } catch (e) {
    log.warn("[proposal-store] save threw", {
      id: proposal.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return "failed";
  }
}

/** Load the latest valid proposal for one id. Fail-soft → null. */
export async function loadChangeProposal(tenantId: string, id: string): Promise<ChangeProposal | null> {
  if (!tenantId || !id) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("move_drafts")
      .select("content, created_at")
      .eq("tenant_id", tenantId)
      .eq("rec_id", id)
      .eq("kind", KIND)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) {
      if (error && !isMissingTable(error.code)) {
        log.warn("[proposal-store] load failed", { tenantId, id, error: error.message });
      }
      return null;
    }
    return deserializeChangeProposal(data[0].content as string);
  } catch (e) {
    log.warn("[proposal-store] load threw", { id, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Manually mark one proposal APPLIED (the operator's own "Mark implemented"
 * action — never the kernel). Re-persists the proposal with status "applied" so
 * the pre-ship queue drops it and its measurement lives in the proof ledger.
 * Fail-soft → false. Publishing stays manual: this records the operator's claim,
 * it does not write a live page.
 */
export async function markProposalApplied(tenantId: string, id: string): Promise<boolean> {
  const proposal = await loadChangeProposal(tenantId, id);
  if (!proposal) return false;
  return (await saveChangeProposal({ ...proposal, status: "applied" })) !== "failed";
}

/** Load the latest valid proposal per id for a tenant. Fail-soft → empty map. */
export async function loadChangeProposals(tenantId: string, limit = 500): Promise<Map<string, ChangeProposal>> {
  const out = new Map<string, ChangeProposal>();
  if (!tenantId) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("move_drafts")
      .select("rec_id, content, created_at")
      .eq("tenant_id", tenantId)
      .eq("kind", KIND)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error && !isMissingTable(error.code)) {
        log.warn("[proposal-store] loadAll failed", { tenantId, error: error.message });
      }
      return out;
    }
    for (const r of data) {
      const id = r.rec_id as string;
      if (out.has(id)) continue; // first seen = newest (desc)
      const proposal = deserializeChangeProposal(r.content as string);
      if (proposal) out.set(id, proposal);
    }
    return out;
  } catch (e) {
    log.warn("[proposal-store] loadAll threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return out;
  }
}
