"use server";

/**
 * /onboard - URL-first server action (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Safety contract (same posture as saveBusinessProfile):
 *   - User resolved from the session cookie, never from form input.
 *   - Tenant resolved via lookupExistingMembership.
 *   - Writes gated by WHERE status = 'pending_onboarding'; never flips
 *     status, never inserts prompts (launch stays in /onboard/review).
 *   - Crawl-only network: a reachability probe, the ≤3-page config
 *     derivation, and one bounded crawl batch of the stranger's OWN site.
 *     Zero paid API calls (day-0 Google checks ride the DataForSEO
 *     gauntlet's dry-run/cache/cap path).
 *   - Every scan/baseline step is fail-soft: an unreachable page never
 *     strands the signup, and /onboard/done renders whatever happened
 *     honestly.
 */

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { lookupExistingMembership, isPlaceholderBusinessName } from "@/domains/onboarding/provision-tenant";
import { normalizeSiteUrl } from "@/domains/onboarding/fetch-site-profile";
import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { deriveAndPersistTenantConfig } from "@/domains/onboarding/launch-config";
import { runFirstLook, deriveNameFromDomain } from "@/domains/onboarding/url-first";

export type StartFromUrlResult = { ok: true } | { ok: false; error: string };

const PROBE_TIMEOUT_MS = 10_000;

export async function startFromUrl(input: { url: string }): Promise<StartFromUrlResult> {
  // 1. Parse the one thing the stranger typed. Pure, no I/O.
  const normalized = normalizeSiteUrl(input?.url ?? "");
  if (!normalized) {
    return {
      ok: false,
      error: "That does not look like a website address. Enter it like acme.com.",
    };
  }

  // 2. Resolve the current user from the session cookie.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Your session expired. Sign in again to continue." };
  }

  // 3. Resolve their tenant.
  const admin = getSupabaseAdmin();
  const membership = await lookupExistingMembership(admin, user.id);
  if (membership.error || !membership.tenantId) {
    return { ok: false, error: "I could not find your account. Try signing in again." };
  }
  const tenantId = membership.tenantId;

  // 4. Honest reachability check BEFORE any writes: a typo'd address gets a
  //    clear sentence + retry right here, not a broken scorecard later.
  const probe = await fetchPageHtml(normalized.homepageUrl, new Map(), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (!probe.ok) {
    return {
      ok: false,
      error:
        probe.reason === "robots_blocked"
          ? `${normalized.domain} asks crawlers to stay out of its pages, so I cannot read it. If this is your site, allow BeaconBot in robots.txt and try again.`
          : `I could not reach ${normalized.domain}. Check the spelling, or try it with www in front.`,
    };
  }

  // 5. Save the domain to the pending tenant (status-guarded, race-safe).
  const { data: updatedRows, error: updateErr } = await admin
    .from("tenants")
    .update({ domain: normalized.domain, updated_at: new Date().toISOString() })
    .eq("id", tenantId)
    .eq("status", "pending_onboarding")
    .select("business_name");
  if (updateErr) {
    console.error("[onboard/url-first] domain update failed:", updateErr.message);
    return { ok: false, error: "I hit a temporary issue saving. Try again in a moment." };
  }
  if (!updatedRows || updatedRows.length === 0) {
    return { ok: false, error: "Your account has already launched. Head to your dashboard." };
  }

  // 6. Persist the first business config from the site itself (polite ≤3-page
  //    read; failure-soft: an odd site still saves a domain-keyed config).
  //    The site's own derived name beats the domain guess; a human-typed name
  //    from the guided wizard beats both (typed-beats-derived, preserved by
  //    only filling the name while it is still the placeholder).
  let derivedName = deriveNameFromDomain(normalized.domain);
  try {
    const configResult = await deriveAndPersistTenantConfig({
      tenantId,
      domain: normalized.domain,
      typedName: null,
      typedCities: [],
      competitors: [],
      timeoutMs: 8_000,
    });
    const configName = (configResult.config?.name ?? "").trim();
    if (configName && !isPlaceholderBusinessName(configName)) derivedName = configName;
    console.info(
      `[onboard/url-first] tenant config ${configResult.outcome} for ${tenantId} (${normalized.domain})`,
    );
  } catch (e) {
    console.error(
      "[onboard/url-first] config derivation threw (continuing with domain-derived name):",
      e instanceof Error ? e.message : e,
    );
  }

  const currentName = (updatedRows[0]?.business_name ?? "") as string;
  if (derivedName && isPlaceholderBusinessName(currentName)) {
    const { error: nameErr } = await admin
      .from("tenants")
      .update({ business_name: derivedName, updated_at: new Date().toISOString() })
      .eq("id", tenantId)
      .eq("status", "pending_onboarding");
    if (nameErr) {
      console.error("[onboard/url-first] name update failed (non-blocking):", nameErr.message);
    }
  }

  // 7. The bounded first look: discovery + one crawl batch + day-0 baselines.
  //    Fail-soft by contract; /onboard/done renders whatever state this left.
  try {
    const look = await runFirstLook({ tenantId, domain: normalized.domain });
    console.info(
      `[onboard/url-first] first look: crawl=${look.crawl.status} pages=${look.crawl.pagesRead} ` +
        `questions=${look.day0.questionSeeding ?? "none"} serpTerms=${look.day0.serpTerms.length}`,
    );
  } catch (e) {
    console.error(
      "[onboard/url-first] first look threw (scorecard will say so honestly):",
      e instanceof Error ? e.message : e,
    );
  }

  // 8. Land on the scorecard.
  redirect("/onboard/done");
}
