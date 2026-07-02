"use server";

/**
 * Portfolio circuit breaker (2026-07-02, BEACON 500 item 80) - the Today card
 * and the autopilot settings card share this: load the persisted trip state
 * for the current tenant, and the operator's one-click resume.
 *
 * Resume is a server action writing to the SAME autopilot store the nightly
 * run path reads (autopilot-store.ts's resumeCircuitBreaker), gated behind
 * the same publish-permission check every other autopilot settings action
 * uses. It also resets the consecutive-loss counter: resuming clears the
 * "tripped" flag, so the very next settled batch (not the two that caused the
 * trip) starts the next consecutive-negative count.
 */

import { revalidatePath } from "next/cache";

import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import {
  getAutopilotState,
  resumeCircuitBreaker,
  type CircuitBreakerState,
} from "@/domains/autopilot/autopilot-store";

export type CircuitBreakerCardView = {
  tripped: boolean;
  reason: string;
  trippedAt: string | null;
  sinceIso: string | null;
  canResume: boolean;
};

export async function loadCircuitBreakerCardView(): Promise<CircuitBreakerCardView> {
  const [state, canPublish] = await Promise.all([getAutopilotState(), canPublishForCurrentTenant()]);
  const cb: CircuitBreakerState = state.circuitBreaker;
  return {
    tripped: cb.tripped,
    reason: cb.reason,
    trippedAt: cb.trippedAt,
    sinceIso: cb.sinceIso,
    canResume: canPublish,
  };
}

export type ResumeCircuitBreakerResult = { ok: true } | { ok: false; reason: string };

export async function resumeAutopilotCircuitBreaker(): Promise<ResumeCircuitBreakerResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "You don't have permission to change publishing for this site." };
  }
  await resumeCircuitBreaker(new Date().toISOString());
  revalidatePath("/", "layout");
  revalidatePath("/settings/connectors");
  return { ok: true };
}
