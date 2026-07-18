/**
 * 2026-05-26 Phase A.2 (Section 3.2 / E1) — cross-tenant brain PRODUCER.
 *
 * The I/O half that activates the brain: enumerate tenants, read each
 * OTHER tenant's cited-edit outcomes, and feed them to the pure
 * `aggregateCrossTenantPatterns` core. This is what makes the scrubber
 * + aggregator reachable.
 *
 * GATE-FIRST + INERT-SAFE:
 *   • Returns `[]` immediately when `BEACON_CROSS_TENANT_BRAIN` is off
 *     (default) — no tenant enumeration, no reads. So production is
 *     byte-identical to the old sync stub until the gate flips.
 *   • At n=1 (single install) the only tenant IS the requester →
 *     excluded → `[]`. The brain only produces signal with ≥2 tenants.
 *   • Any error anywhere → `[]` (never breaks the LLM evidence packet).
 *
 * Dependency-injected for testability: production passes real
 * `listTenants` + a per-tenant outcomes loader + a blocklist builder;
 * tests pass synthetic multi-tenant fixtures with the gate forced on.
 *
 * Pinned by producer.test.ts. The aggregation contract (exclude-self,
 * sample-gate, scrub, cap) lives in `aggregate.ts`; this module only
 * orchestrates the reads + delegates.
 */

import {
  aggregateCrossTenantPatterns,
  type CrossTenantEditOutcome,
} from "./aggregate";
import { isCrossTenantProducerEnabled } from "./config";
import type {
  CrossTenantPattern,
  GetCrossTenantPatternsArgs,
} from "../cross-tenant-brain";

export type CrossTenantProducerDeps = {
  /** Enumerate tenants (the producer excludes the requester). MUST be wired to
   *  `listActiveTenants` in production (2026-07-18 tenant-safety fix): a paused
   *  tenant's cited-edit outcomes must not feed the cross-tenant brain / paid
   *  work. This producer is dependency-injected and gated off by default
   *  (`BEACON_CROSS_TENANT_BRAIN`), so there is no production caller to switch
   *  yet; when one is wired, it must pass `listActiveTenants`. */
  listTenants: () => Promise<ReadonlyArray<{ id: string }>>;
  /** Load one tenant's cited-edit outcomes (matchKey + helped). */
  loadOutcomesForTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<CrossTenantEditOutcome>>;
  /** Assemble the privacy blocklist (tenant/brand/competitor names +
   *  domains) used to scrub pattern descriptions. */
  buildBlocklist: () => Promise<ReadonlyArray<string>>;
  /** Gate override (test hook). Defaults to the env-backed gate. */
  isEnabled?: () => boolean;
};

/**
 * Compute cross-tenant patterns for the requesting tenant. Async +
 * gated; returns `[]` unless the producer gate is on AND ≥2 tenants
 * have aggregatable outcomes.
 */
export async function computeCrossTenantPatterns(
  args: GetCrossTenantPatternsArgs,
  deps: CrossTenantProducerDeps,
): Promise<CrossTenantPattern[]> {
  const enabled = deps.isEnabled ?? isCrossTenantProducerEnabled;
  if (!enabled()) return [];

  try {
    const tenants = await deps.listTenants();
    const others = tenants.filter((t) => t.id !== args.tenantId);
    if (others.length === 0) return []; // n=1: nothing to learn from

    const outcomes: CrossTenantEditOutcome[] = [];
    for (const t of others) {
      const tenantOutcomes = await deps.loadOutcomesForTenant(t.id);
      outcomes.push(...tenantOutcomes);
    }
    if (outcomes.length === 0) return [];

    const blocklist = await deps.buildBlocklist();
    return aggregateCrossTenantPatterns(outcomes, {
      requestingTenantId: args.tenantId,
      actionTypes: args.actionTypes,
      blocklist,
    });
  } catch {
    // Never break the evidence packet on a producer fault.
    return [];
  }
}
