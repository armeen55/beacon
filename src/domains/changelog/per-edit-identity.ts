import { createHash } from "node:crypto";

/** Stable identity for the one changelog row representing one accepted lever.
 * This is deliberately the same grain as lifecycle attribution: tenant,
 * recommendation, action, and target element. */
export function editChangelogIdentity(args: {
  tenantId: string;
  stableKey: string;
  actionType: string;
  targetElementKey: string | null;
}): string {
  return JSON.stringify([
    args.tenantId,
    args.stableKey,
    args.actionType,
    args.targetElementKey ?? null,
  ]);
}

/** Deterministic row ID closes the concurrent double-submit race across two
 * server instances: both writes address the same database primary key. */
export function deterministicEditChangelogId(identity: string): string {
  return `cl-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}
