/**
 * launch-flow — the activation transaction (Core 100K minimal onboarding).
 *
 * Relocated from the retired /onboard/review step. This is the FIRST and
 * ONLY code path that flips a tenants.status from 'pending_onboarding' to
 * 'active'. It persists the tenant's minimal BusinessConfig, seeds a small
 * starter prompt set, accepts TOS, and flips the tenant. From this point
 * the nightly fleet includes the tenant and polls its prompts.
 *
 * Lives in its own module (NOT a "use server" file) so test fixtures can
 * import the helpers without invoking Next.js's server-action compile-time
 * constraints (which require every export to be async).
 *
 * Core 100K: the elaborate business-profile / service-area / competitor
 * derivation that used to feed starter-prompt generation is gone. The
 * launch now seeds a minimal brand-focused prompt set from the tenant's
 * confirmed name — cruder, but a stranger still lands active with real
 * prompts to track. Deep prompt curation happens later in the app.
 *
 * Atomicity contract (unchanged):
 *   - INSERT prompts BEFORE the tenant status flip. Order matters — the
 *     flip is the single atomic gate.
 *   - Lock-out: UPDATE tenants gated by `WHERE id=? AND
 *     status='pending_onboarding' AND tos_accepted_at IS NULL`.
 *     Concurrent second-click returns 0 rows (silent no-op) → redirect.
 *   - Rollback: if the status-flip UPDATE *errors*, DELETE the prompts we
 *     just inserted (by id) so a retry sees a clean slate. If the UPDATE
 *     returns 0 rows (race won by another call), do NOT roll back.
 *   - Dedup: app-layer SELECT-then-filter against existing
 *     tracked_prompts.text (case-insensitive).
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAndPersistTenantConfig } from "@/domains/account";
import { dispatchFirstScanForTenant } from "@/domains/account";
import { runInProcessColdStartScan } from "@/domains/evidence";

/**
 * Minimal starter-prompt shape. The launch inserts these directly; the
 * heavyweight generator (brand/competitor/city/cost families) was retired
 * with the derivation flow. Only the fields buildTrackedPromptRow reads.
 */
export type StarterPromptDraft = {
  text: string;
  cluster: string;
  priority: number;
  city_scope: string | null;
  service_scope: string | null;
};

/**
 * Build the minimal starter prompt set from the tenant's confirmed name.
 * Two brand-discovery prompts — enough to give a brand-new tenant a real
 * (if small) tracking list on day one. Empty name → no prompts, which the
 * launch treats as "not ready" (the confirm step captures the name first).
 */
export function buildMinimalStarterPrompts(
  businessName: string,
): StarterPromptDraft[] {
  const name = businessName.trim();
  if (!name) return [];
  return [
    {
      text: `${name} reviews`,
      cluster: "brand_discovery",
      priority: 1,
      city_scope: null,
      service_scope: null,
    },
    {
      text: `is ${name} a good company`,
      cluster: "brand_discovery",
      priority: 2,
      city_scope: null,
      service_scope: null,
    },
  ];
}

/**
 * Outcome of `executeLaunchTransaction`. The server-action wrapper
 * translates `redirect: "/"` into a real Next.js redirect. (The dashboard
 * lives at "/".)
 */
export type LaunchTransactionOutcome =
  | {
      kind: "redirect";
      to: "/";
      reason: "success" | "already_launched" | "race_lost";
    }
  | { kind: "error"; error: string };

const PROMPT_PLATFORMS_DEFAULT = ["perplexity", "chatgpt"] as const;
const PROMPT_INTENT_DEFAULT = "recommendation" as const;

/**
 * Pure helper: turn a StarterPromptDraft into a tracked_prompts row.
 * Side-effect-free except for the random id generation.
 */
export function buildTrackedPromptRow(args: {
  draft: StarterPromptDraft;
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
 * Pure-injected core of the launch flow. Takes the admin Supabase client +
 * the tenantId resolved from the user's session, plus a clock for tests.
 * Performs:
 *
 *   1. Fetch tenant row.
 *   2. If status='active' → returns `{ redirect, reason: "already_launched" }`.
 *   3. If status != 'pending_onboarding' → error.
 *   4. Persist the minimal per-tenant BusinessConfig (name + domain).
 *   5. Build minimal starter prompts; validate ≥1.
 *   6. Dedup against existing tracked_prompts.text (case-insensitive).
 *   7. INSERT new prompts (is_active=true).
 *   8. UPDATE tenants with double-click guard.
 *   9a. UPDATE error → DELETE inserted prompts (rollback).
 *   9b. UPDATE returns 0 rows (race lost / already activated) → redirect.
 *   9c. UPDATE returns 1 row → success → first-scan → redirect.
 *
 * Returns either a redirect target or a structured error. Never throws.
 */
export async function executeLaunchTransaction(args: {
  admin: SupabaseClient;
  tenantId: string;
  now: string;
  /** Injectable config persister. Defaults to the real minimal persister
   *  (name + domain + confirmed cities/competitors). Tests inject a stub. */
  persistConfig?: typeof deriveAndPersistTenantConfig;
  /** Injectable launch-time first-scan dispatcher (inert without the
   *  operator PAT; tenant-scoped; failure-soft). */
  dispatchFirstScan?: typeof dispatchFirstScanForTenant;
  /** Injectable Vercel-safe in-process cold-start crawler. FALLBACK when
   *  GitHub dispatch is unavailable so a brand-new tenant still gets real
   *  page inventory on first /today render. Failure-soft; bounded caps. */
  coldStartScan?: typeof runInProcessColdStartScan;
}): Promise<LaunchTransactionOutcome> {
  const { admin, tenantId, now } = args;
  const persistConfig = args.persistConfig ?? deriveAndPersistTenantConfig;
  const dispatchFirstScan = args.dispatchFirstScan ?? dispatchFirstScanForTenant;
  const coldStartScan = args.coldStartScan ?? runInProcessColdStartScan;

  // 1. Fetch tenant row.
  const { data: tenant, error: tFetchErr } = await admin
    .from("tenants")
    .select(
      "id, slug, business_name, domain, cities_served, project_mix, discovered_competitors, status, tos_accepted_at",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (tFetchErr) {
    console.error("[onboard/launch] tenant fetch failed:", tFetchErr.message);
    return { kind: "error", error: "tenant_fetch_failed" };
  }
  if (!tenant) {
    return { kind: "error", error: "tenant_missing" };
  }

  // 2. Already launched — redirect (idempotent).
  if (tenant.status === "active") {
    return { kind: "redirect", to: "/", reason: "already_launched" };
  }
  if (tenant.status !== "pending_onboarding") {
    // Paused / cancelled — operator must intervene.
    return { kind: "error", error: `tenant_invalid_status:${tenant.status}` };
  }

  // 2.5 Persist the minimal per-tenant BusinessConfig BEFORE anything else —
  //     an active tenant must never exist without a config row (every
  //     downstream engine reads it). The minimal config is name + domain +
  //     confirmed cities/competitors; deep site profiling was retired.
  //     FAILURE-SOFT: an unexpected throw never blocks the launch. A failed
  //     DURABLE write (persist_failed) DOES abort — a config-less active
  //     tenant resolves PLACEHOLDER_CONFIG everywhere.
  try {
    const configResult = await persistConfig({
      tenantId: tenant.id,
      domain: tenant.domain ?? "",
      typedName: tenant.business_name,
      typedCities: tenant.cities_served ?? [],
      competitors: tenant.discovered_competitors ?? [],
    });
    console.info(`[onboard/launch] tenant config ${configResult.outcome}`);
    if (configResult.outcome === "persist_failed") {
      console.error(
        `[onboard/launch] config persist FAILED for ${tenant.id} (${configResult.persistError ?? "unknown"}) — aborting launch; tenant stays pending_onboarding`,
      );
      return { kind: "error", error: "config_persist_failed" };
    }
  } catch (e) {
    console.error(
      "[onboard/launch] config persist threw — launching without it:",
      e instanceof Error ? e.message : e,
    );
  }

  // 3. Build minimal starter prompts server-side. NEVER trust client input.
  const drafts = buildMinimalStarterPrompts(tenant.business_name ?? "");
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
      "[onboard/launch] existing prompts fetch failed:",
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

  // 5. Bulk INSERT new prompts BEFORE the status flip. If the flip later
  //    errors, we DELETE these by id.
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
      console.error("[onboard/launch] prompt insert failed:", insertErr.message);
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
      "[onboard/launch] tenant activation failed; rolling back inserted prompts:",
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
          "[onboard/launch] rollback DELETE failed; orphan prompts remain (tenant still pending — cron will skip):",
          rollbackErr.message,
        );
      }
    }
    return { kind: "error", error: "tenant_activation_failed" };
  }

  if (!updated || updated.length === 0) {
    // 7b. Status flip returned 0 rows. Race lost or already activated.
    //     Prompts we inserted are now legitimate parts of the active
    //     tenant's list. DO NOT roll back. Redirect.
    return { kind: "redirect", to: "/", reason: "race_lost" };
  }

  // 7c. Success — atomic flip lit up. Kick the tenant-scoped first scan:
  //     minutes-to-first-crawl instead of waiting for the nightly. Inert
  //     without the operator PAT; failure-soft.
  try {
    const scanDispatch = await dispatchFirstScan(tenant.id);
    console.info(
      `[onboard/launch] first-scan dispatch: ${scanDispatch.status}` +
        (scanDispatch.status === "dispatch_failed"
          ? ` (http ${scanDispatch.httpStatus}: ${scanDispatch.error.slice(0, 120)})`
          : ""),
    );
    // Vercel fallback. GitHub dispatch is INERT without the operator PAT
    // (the normal hosted case). Crawl the tenant's own domain in-process
    // (bounded, crawl-only, failure-soft) so the very first /today render
    // has real recommendations. Both "skipped (no PAT)" AND "dispatch_failed"
    // leave the tenant with zero inventory, so both need the fallback.
    if (
      scanDispatch.status === "skipped_pat_not_configured" ||
      scanDispatch.status === "dispatch_failed"
    ) {
      const scanDomain = (tenant.domain ?? "").trim();
      if (scanDomain) {
        const cold = await coldStartScan({ tenantId: tenant.id, domain: scanDomain });
        console.info(
          `[onboard/launch] in-process cold-start scan: ${cold.status} ` +
            `(discovered=${cold.pagesDiscovered} crawled=${cold.pagesCrawled} ` +
            `snapshots=${cold.snapshotsWritten} source=${cold.source} ${cold.durationMs}ms)` +
            (cold.detail ? ` detail=${cold.detail}` : ""),
        );
      } else {
        console.info(
          "[onboard/launch] in-process cold-start scan skipped: no domain on tenant",
        );
      }
    }
  } catch (e) {
    console.error(
      "[onboard/launch] first-scan dispatch/cold-start threw (launch unaffected):",
      e instanceof Error ? e.message : e,
    );
  }
  return { kind: "redirect", to: "/", reason: "success" };
}
