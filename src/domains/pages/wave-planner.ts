/**
 * Wave Planner — groups compatible playbook briefs into coordinated rollout waves.
 *
 * Waves are a coordination layer above page-level issues.
 * They bundle related briefs by pattern, page type, and urgency
 * so the operator can ship coherent batches.
 */

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { getRepository } from "@/lib/persistence/repositories";

// ── Types ──

export type WaveType =
  | "quick_fix_wave"
  | "pattern_rollout_wave"
  | "verification_wave"
  | "mixed_operator_wave";

export type WaveStatus =
  | "proposed"
  | "handed_off"
  | "in_progress"
  | "partially_shipped"
  | "shipped"
  | "partially_verified"
  | "completed"
  | "dismissed";

export type RolloutWave = {
  rolloutWaveId: string;
  title: string;
  sourcePatternId: string;
  waveType: WaveType;
  createdAt: string;
  status: WaveStatus;
  targetPages: string[];
  briefIds: string[];
  issueIds: string[];
  rationale: string;
  priorityScore: number;
  expectedVerificationMode: string;
  notes: string | null;
};

// Night-shift cache sweep (2026-06-11): this was a process-global
// mutable cache keyed by NOTHING — in a warm multi-tenant process the
// first tenant pinned its rows for every later tenant (the same class
// fixed across 7 other stores tonight). Per-tenant Map now; the
// underlying read stays ambient-routed (per-tenant on disk), so the
// cache key was the leak. Stable per-tenant array refs preserve the
// in-place mutator semantics.
const _byTenant = new Map<string, RolloutWave[]>();

const ensureLoaded = cache(async (): Promise<RolloutWave[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getRolloutWaves();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getRolloutWaves = cache(async (): Promise<RolloutWave[]> => {
  return ensureLoaded();
});
