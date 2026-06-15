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
import { deriveAndPersistTenantConfig } from "@/domains/onboarding/launch-config";
import { dispatchFirstScanForTenant } from "@/domains/onboarding/first-scan-dispatch";
import {
  generateStarterPrompts,
  type PromptDraft,
} from "@/domains/onboarding/prompt-generator";
import type { ProjectMixTag } from "@/domains/tenants/types";

/**
 * Outcome of `executeLaunchTransaction` — testable helper that does
 * the actual DB work. The server-action wrapper translates
 * `redirect: "/"` into a real Next.js redirect. (The dashboard lives at
 * "/", NOT "/today" — the old "/today" target 404'd on launch.)
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
 *   2. If status='active' → returns `{ redirect: "/", reason: "already_launched" }`.
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
  /**
   * North-star onboarding (2026-06-11) — injectable config persister.
   * Defaults to the real `deriveAndPersistTenantConfig` (polite ≤3-page
   * site fetch → derived profile → per-tenant BusinessConfig). Tests
   * inject a stub; the dep shape keeps this module network-free.
   */
  persistConfig?: typeof deriveAndPersistTenantConfig;
  /** 2026-06-11 — injectable launch-time first-scan dispatcher (inert
   *  without the operator PAT; tenant-scoped; failure-soft). */
  dispatchFirstScan?: typeof dispatchFirstScanForTenant;
}): Promise<LaunchTransactionOutcome> {
  const { admin, tenantId, now } = args;
  const persistConfig = args.persistConfig ?? deriveAndPersistTenantConfig;
  const dispatchFirstScan = args.dispatchFirstScan ?? dispatchFirstScanForTenant;

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
    return { kind: "redirect", to: "/", reason: "already_launched" };
  }
  if (tenant.status !== "pending_onboarding") {
    // Paused / cancelled — operator must intervene.
    return { kind: "error", error: `tenant_invalid_status:${tenant.status}` };
  }

  // 2.5 North-star onboarding (2026-06-11): persist the per-tenant
  //     BusinessConfig BEFORE anything else — an active tenant must
  //     never exist without a config (every downstream engine reads
  //     it). Derivation fetches the stranger's own site (polite, ≤3
  //     pages); typed wizard fields beat derived values. FAILURE-SOFT:
  //     an unreachable site still persists a typed-fields config, and
  //     an unexpected throw never blocks the launch (config can be
  //     re-derived later; a blocked launch cannot be retried as
  //     cheaply). Pre-flip write is harmless if the flip races — the
  //     config is inert until the tenant is active.
  let persistedConfig: Awaited<ReturnType<typeof persistConfig>>["config"];
  let suggestedSegment: Awaited<
    ReturnType<typeof persistConfig>
  >["suggestedSegment"] = null;
  try {
    const configResult = await persistConfig({
      tenantId: tenant.id,
      domain: tenant.domain ?? "",
      typedName: tenant.business_name,
      typedCities: tenant.cities_served ?? [],
      competitors: tenant.discovered_competitors ?? [],
    });
    persistedConfig = configResult.config;
    suggestedSegment = configResult.suggestedSegment;
    console.info(
      `[onboard/review] tenant config ${configResult.outcome}` +
        (configResult.derivedFields.length > 0
          ? ` (derived: ${configResult.derivedFields.join(", ")})`
          : ""),
    );
    // wave-4 #2 (2026-06-14): the durable config write did NOT land (Vercel
    // Supabase upsert failed). DO NOT proceed to the status→active flip — an
    // active tenant without a config row resolves PLACEHOLDER_CONFIG in every
    // downstream engine (generic recs, "other" page classification → zero
    // content cards). Abort with the tenant still pending_onboarding so a
    // retry re-persists; nothing partial is left active.
    if (configResult.outcome === "persist_failed") {
      console.error(
        `[onboard/review] config persist FAILED for ${tenant.id} (${configResult.persistError ?? "unknown"}) — aborting launch; tenant stays pending_onboarding`,
      );
      return { kind: "error", error: "config_persist_failed" };
    }
  } catch (e) {
    // Failure-soft BY CONTRACT (pinned by the "config derivation FAILING
    // never blocks the launch" test): an unexpected derivation throw must
    // not block a stranger's signup. Note deriveAndPersistTenantConfig is
    // itself failure-soft (unreachable site → typed-only config, still
    // saved), so this catch is for truly-unexpected throws only. The
    // DB-write failure path — the wave-4 #2 finding — is handled above via
    // the persist_failed outcome, which DOES abort (a missing config row is
    // a different, harder failure than a site that wouldn't load).
    console.error(
      "[onboard/review] config derivation threw — launching without it:",
      e instanceof Error ? e.message : e,
    );
  }

  // Segment resolution (2026-06-11): a human picking builder tags is a
  // SELF-DECLARATION and beats site inference; otherwise the site's own
  // signals decide (content_publisher / local_service); an ambiguous
  // site keeps the provisioning default (all local engines safe-off).
  const resolvedSegment =
    (tenant.project_mix ?? []).length > 0
      ? ("local_residential_builder" as const)
      : suggestedSegment;

  // 3. Re-generate prompts server-side. NEVER trust client input.
  //    North-star onboarding (2026-06-11): the site-derived config
  //    feeds the generator so ANY vertical gets real service-in-city
  //    prompts (the ProjectMixTag path only covers the six builder
  //    verticals). Typed cities beat derived locations; derived
  //    locations fill in when the wizard collected none.
  const typedCities = tenant.cities_served ?? [];
  const drafts = generateStarterPrompts({
    businessName: tenant.business_name ?? "",
    domain: tenant.domain ?? "",
    citiesServed:
      typedCities.length > 0 ? typedCities : (persistedConfig?.locations ?? []),
    projectMix: (tenant.project_mix ?? []) as ProjectMixTag[],
    competitors: tenant.discovered_competitors ?? [],
    derivedServices: persistedConfig?.services ?? [],
    industry: persistedConfig?.industry ?? null,
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

  // 6. Atomic flip with double-click guard. The derived segment rides
  //    the same UPDATE (one write, same race guard) — only when the
  //    site/human gave a signal; an ambiguous site keeps the
  //    provisioning default.
  const { data: updated, error: updateErr } = await admin
    .from("tenants")
    .update({
      status: "active",
      tos_accepted_at: now,
      updated_at: now,
      ...(resolvedSegment ? { segment: resolvedSegment } : {}),
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
    return { kind: "redirect", to: "/", reason: "race_lost" };
  }

  // 7c. Success — atomic flip lit up. Kick the tenant-scoped first
  //     scan (2026-06-11): minutes-to-first-crawl instead of waiting
  //     for the nightly. Inert without the operator PAT; failure-soft —
  //     a failed dispatch never affects the launch (the nightly fleet
  //     run picks the tenant up automatically either way).
  try {
    const scanDispatch = await dispatchFirstScan(tenant.id);
    console.info(
      `[onboard/review] first-scan dispatch: ${scanDispatch.status}` +
        (scanDispatch.status === "dispatch_failed"
          ? ` (http ${scanDispatch.httpStatus}: ${scanDispatch.error.slice(0, 120)})`
          : ""),
    );
  } catch (e) {
    console.error(
      "[onboard/review] first-scan dispatch threw (launch unaffected):",
      e instanceof Error ? e.message : e,
    );
  }
  return { kind: "redirect", to: "/", reason: "success" };
}
