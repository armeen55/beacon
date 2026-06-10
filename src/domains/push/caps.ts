import "server-only";

/**
 * 2026-06-10 — Publish safety caps (§push layer, Invariant 3).
 *
 * Enforced IN THE PUSH PATH (push-service calls these before any
 * adapter fires), not just in UI. Clones the API-spend budget-cap
 * pattern: a tenant-scoped ledger store counts pushes per UTC day.
 *
 *   • ≤ MAX_PUSHES_PER_DAY per property (default 10)
 *   • no URL changes        — structurally enforced (the Wix client
 *     strips slug-ish fields; the git adapter never renames paths)
 *   • no nav / sitewide     — structurally enforced (adapters touch
 *     CMS items + blog drafts only)
 *   • no deletions          — structurally enforced (no delete
 *     endpoints exist in any adapter) + `assertNonDestructivePatch`
 *     refuses pushes that would blank existing content
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

export const MAX_PUSHES_PER_DAY = 10;

const LEDGER_STORE = "push-ledger";

export type PushLedgerEntry = {
  id: string;
  tenant_id: string;
  edit_id: string;
  target_url: string;
  adapter: string;
  pushed_at: string; // ISO
  /** UTC day for the daily cap (YYYY-MM-DD). */
  day: string;
  result: "pushed" | "push_failed";
  detail: string | null;
};

export async function readPushLedger(): Promise<PushLedgerEntry[]> {
  try {
    return (await readStore<PushLedgerEntry>(LEDGER_STORE)) ?? [];
  } catch {
    return [];
  }
}

export async function appendPushLedger(entry: PushLedgerEntry): Promise<void> {
  const all = await readPushLedger();
  all.push(entry);
  // Retention: newest 1000 (cap math only needs today).
  await writeStore(LEDGER_STORE, all.slice(-1000));
}

export type CapVerdict = { allowed: true } | { allowed: false; reason: string };

/** Daily-cap check. Counts SUCCESSFUL pushes today for this tenant. */
export async function checkDailyPushCap(args: {
  tenantId: string;
  now?: Date;
  max?: number;
}): Promise<CapVerdict> {
  const day = (args.now ?? new Date()).toISOString().slice(0, 10);
  const max = args.max ?? MAX_PUSHES_PER_DAY;
  const ledger = await readPushLedger();
  const todays = ledger.filter(
    (e) => e.tenant_id === args.tenantId && e.day === day && e.result === "pushed",
  ).length;
  if (todays >= max) {
    return {
      allowed: false,
      reason: `daily push cap reached (${todays}/${max} for ${day}) — resumes tomorrow or raise the cap deliberately`,
    };
  }
  return { allowed: true };
}

/**
 * Non-destructive guard: a push may ADD or REWRITE content; it may not
 * BLANK it. Refuses when the proposed value is empty/near-empty while
 * the current value had real content (deletion requires its own,
 * separate, explicit approval flow — which does not exist yet, by design).
 */
export function assertNonDestructivePatch(args: {
  currentText: string | null;
  proposedText: string | null;
}): CapVerdict {
  const current = (args.currentText ?? "").trim();
  const proposed = (args.proposedText ?? "").trim();
  if (proposed.length === 0) {
    return {
      allowed: false,
      reason: "proposed text is empty — deletions are not pushable (Invariant 3)",
    };
  }
  if (current.length > 80 && proposed.length < current.length * 0.2) {
    return {
      allowed: false,
      reason:
        "proposed text would shrink existing content by >80% — treat as deletion; needs a separate explicit approval",
    };
  }
  return { allowed: true };
}
