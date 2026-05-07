/**
 * launch-flow — Gap C.4 (2026-05-07).
 *
 * Pure-injected helpers used by the launchTenant server action.
 *
 * Lives in its own module (NOT a "use server" file) so test fixtures
 * can import the helpers without invoking Next.js's server-action
 * compile-time constraints (which require every export to be async).
 *
 * Atomicity contract (preflight 2026-05-07):
 *   - No supabase-js multi-statement transaction is available; the
 *     codebase has zero RPC functions today.
 *   - Strategy: INSERT prompts BEFORE the tenant status flip.
 *     Order matters — the flip is the single atomic gate.
 *   - Lock-out: UPDATE tenants gated by `WHERE id=? AND
 *     status='pending_onboarding' AND tos_accepted_at IS NULL`.
 *     Concurrent second-click returns 0 rows (silent no-op) → we
 *     redirect to /today.
 *   - Rollback: if the status-flip UPDATE *errors*, DELETE the
 *     prompts we just inserted (by id) so a retry sees a clean slate.
 *     If the UPDATE returns 0 rows (race won by another call), do
 *     NOT roll back — those prompts now belong to the active tenant.
 *   - Dedup: app-layer SELECT-then-filter against existing
 *     tracked_prompts.text (case-insensitive). Race-resilient enough
 *     — a true double-click producing duplicate-text rows still polls
 *     correctly, just slightly wasteful.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateStarterPrompts,
  type PromptDraft,
} from "@/domains/onboarding/prompt-generator";
import type { ProjectMixTag } from "@/domains/tenants/types";

/**
 * Outcome of `executeLaunchTransaction` — testable helper that does
 * the actual DB work. The server-action wrapper translates
 * `redirect: "/today"` into a real Next.js redirect.
 */
export type LaunchTransactionOutcome =
  | {
      kind: "redirect";
      to: "/today";
      reason: "success" | "already_launched" | "race_lost";
    }
  | { kind: "error"; error: string };

const PROMPT_PLATFORMS_DEFAULT = ["perplexity", "chatgpt"] as const;
const PROMPT_INTENT_DEFAULT = "recommendation" as const;

/**
 * Pure helper: turn a PromptDraft into a tracked_prompts row.
 * Side-effect-free except for the random id generation.
 */
export function buildTrackedPromptRow(args: {
  draft: PromptDraft;
  accountId: string;
  now: string;
  id?: string;
}) {
  return {
    id: args.id ?? `prompt-${randomUUID()}`,
    account_id: args.accountId,
    text: args.draft.text,
    topic_id: null as string | null,
    location_scope: args.draft.city_scope,
    service_scope: args.draft.service_scope,
    intent_type: PROMPT_INTENT_DEFAULT,
    platforms: [...PROMPT_PLATFORMS_DEFAULT],
    tags: [
      "starter_v0",
      args.draft.cluster,
      `priority-${args.draft.priority}`,
    ],
    is_active: true,
    created_at: args.now,
    updated_at: args.now,
  };
}

/**
 * Pure-injected core of the launch flow. Takes the admin Supabase
 * client + the tenantId resolved from the user's session, plus a
 * clock for tests. Performs:
 *
 *   1. Fetch tenant row.
 *   2. If status='active' → returns `{ redirect: "/today", reason: "already_launched" }`.
 *   3. If status != 'pending_onboarding' → error.
 *   4. Re-generate starter prompts from tenant fields.
 *   5. Validate ≥1 prompt.
 *   6. Dedup against existing tracked_prompts.text (case-insensitive).
 *   7. INSERT new prompts (is_active=true).
 *   8. UPDATE tenants with double-click guard.
 *   9a. UPDATE error → DELETE inserted prompts (rollback).
 *   9b. UPDATE returns 0 rows (race lost / already activated) → redirect.
 *   9c. UPDATE returns 1 row → success → redirect.
 *
 * Returns either a redirect target or a structured error. Never
 * throws (caller decides whether to invoke Next.js redirect).
 */
export async function executeLaunchTransaction(args: {
  admin: SupabaseClient;
  tenantId: string;
  now: string;
}): Promise<LaunchTransactionOutcome> {
  const { admin, tenantId, now } = args;

  // 1. Fetch tenant row.
  const { data: tenant, error: tFetchErr } = await admin
    .from("tenants")
    .select(
      "id, slug, business_name, domain, cities_served, project_mix, discovered_competitors, status, tos_accepted_at",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (tFetchErr) {
    console.error("[onboard/review] tenant fetch failed:", tFetchErr.message);
    return { kind: "error", error: "tenant_fetch_failed" };
  }
  if (!tenant) {
    return { kind: "error", error: "tenant_missing" };
  }

  // 2. Already launched — redirect to /today (idempotent).
  if (tenant.status === "active") {
    return { kind: "redirect", to: "/today", reason: "already_launched" };
  }
  if (tenant.status !== "pending_onboarding") {
    // Paused / cancelled — operator must intervene.
    return { kind: "error", error: `tenant_invalid_status:${tenant.status}` };
  }

  // 3. Re-generate prompts server-side. NEVER trust client input.
  const drafts = generateStarterPrompts({
    businessName: tenant.business_name ?? "",
    domain: tenant.domain ?? "",
    citiesServed: tenant.cities_served ?? [],
    projectMix: (tenant.project_mix ?? []) as ProjectMixTag[],
    competitors: tenant.discovered_competitors ?? [],
  });
  if (drafts.length === 0) {
    return { kind: "error", error: "no_prompts_generated" };
  }

  // 4. App-layer dedup against existing tracked_prompts for this tenant.
  const { data: existing, error: existingErr } = await admin
    .from("tracked_prompts")
    .select("text")
    .eq("account_id", tenant.slug);
  if (existingErr) {
    console.error(
      "[onboard/review] existing prompts fetch failed:",
      existingErr.message,
    );
    return { kind: "error", error: "existing_prompts_fetch_failed" };
  }

  const existingTextsLower = new Set<string>();
  for (const row of existing ?? []) {
    if (typeof row.text === "string") {
      existingTextsLower.add(row.text.toLowerCase());
    }
  }
  const newDrafts = drafts.filter(
    (d) => !existingTextsLower.has(d.text.toLowerCase()),
  );

  // 5. Bulk INSERT new prompts BEFORE the status flip. If the flip
  //    later errors, we DELETE these by id.
  const insertedIds: string[] = [];
  if (newDrafts.length > 0) {
    const rows = newDrafts.map((d) => {
      const row = buildTrackedPromptRow({
        draft: d,
        accountId: tenant.slug,
        now,
      });
      insertedIds.push(row.id);
      return row;
    });
    const { error: insertErr } = await admin
      .from("tracked_prompts")
      .insert(rows);
    if (insertErr) {
      console.error(
        "[onboard/review] prompt insert failed:",
        insertErr.message,
      );
      return { kind: "error", error: "prompt_insert_failed" };
    }
  }

  // 6. Atomic flip with double-click guard.
  const { data: updated, error: updateErr } = await admin
    .from("tenants")
    .update({
      status: "active",
      tos_accepted_at: now,
      updated_at: now,
    })
    .eq("id", tenant.id)
    .eq("status", "pending_onboarding")
    .is("tos_accepted_at", null)
    .select("id");

  if (updateErr) {
    // 7a. Status flip ERRORED. Roll back inserted prompts.
    console.error(
      "[onboard/review] tenant activation failed; rolling back inserted prompts:",
      updateErr.message,
    );
    if (insertedIds.length > 0) {
      const { error: rollbackErr } = await admin
        .from("tracked_prompts")
        .delete()
        .in("id", insertedIds)
        .eq("account_id", tenant.slug);
      if (rollbackErr) {
        console.error(
          "[onboard/review] rollback DELETE failed; orphan prompts remain (tenant still pending — cron will skip):",
          rollbackErr.message,
        );
      }
    }
    return { kind: "error", error: "tenant_activation_failed" };
  }

  if (!updated || updated.length === 0) {
    // 7b. Status flip returned 0 rows. Race lost or already
    //     activated. Prompts we inserted are now legitimate parts of
    //     the active tenant's list. DO NOT roll back. Redirect.
    return { kind: "redirect", to: "/today", reason: "race_lost" };
  }

  // 7c. Success — atomic flip lit up.
  return { kind: "redirect", to: "/today", reason: "success" };
}
