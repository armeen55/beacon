"use server";

import { log } from "@/lib/logger";
import {
  getConnectorInfo,
  deleteConnectorToken,
  saveConnectorToken,
  updateConnectorToken,
  type ConnectorInfo,
} from "@/lib/connector-store";
import { softDisconnectGsc } from "@/lib/connectors/gsc/disconnect-flow";
import { listGa4PropertiesForTenant } from "@/lib/connectors/ga4/property-selection";
import type {
  Ga4Property,
  Ga4PropertyListResult,
} from "@/lib/connectors/ga4/types";
import {
  buildGoogleAuthUrl,
  encodeOAuthState,
  generateOAuthNonce,
  type GoogleConnectorKind,
} from "@/lib/connectors/google-auth";
import {
  runGoogleReviewsSync,
  fetchGoogleLocations,
  type GbpLocationInfo,
} from "@/lib/connectors/google-reviews-sync";
import { runYelpReviewsSync } from "@/lib/connectors/yelp-reviews-sync";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";
// On-demand connector syncs (2026-06-15) — with all crons/Actions off, these
// existing per-tenant sync engines (HTTP + Supabase, Vercel-safe) must be
// triggerable from the product. Each "Sync now" action wraps one.
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { syncSemrushOrganicKeywordsForTenant } from "@/lib/connectors/semrush/sync-organic-keywords";

export async function getGoogleGscConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google_gsc");
}

export async function getGoogleGbpConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google_gbp");
}

/**
 * Slice 9.A1β (2026-05-18) — read GA4 connector status. Mirrors the
 * GSC/GBP read shape. Returns disconnected when no token exists OR
 * when the existing token has `disconnected_at` set (soft-disconnect
 * aware via `getConnectorInfo`'s shared branch).
 */
export async function getGoogleGa4ConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google_ga4");
}

export async function getYelpConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("yelp");
}

export async function getWixConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("wix");
}

/**
 * North-star onboarding (2026-06-11) — self-serve Wix connection.
 * A Wix customer pastes their own API key + site id; the token is
 * stored per-tenant in the connector store (the same row the push
 * service reads). Without this card the publish path dead-ended on
 * the operator hand-seeding the key. The key is held server-side
 * only; pushing still goes through Approve & Push (operator click,
 * caps, non-destructive guard) — connecting a key never publishes
 * anything by itself.
 */
export async function saveWixConnection(input: {
  apiKey: string;
  siteId: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveWixConnection";
  const t0 = Date.now();
  const apiKey = input.apiKey.trim();
  const siteId = input.siteId.trim();
  if (!apiKey) return { success: false, error: "Enter your Wix API key." };
  if (!siteId) return { success: false, error: "Enter your Wix site id." };
  log.info("Action started", { action });
  try {
    await saveConnectorToken({
      provider: "wix",
      api_key: apiKey,
      site_id: siteId,
      connected_at: now(),
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

export async function disconnectWix(): Promise<{
  success: boolean;
  error?: string;
}> {
  const action = "disconnectWix";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    await deleteConnectorToken("wix");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

export async function saveYelpApiKey(
  apiKeyRaw: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "saveYelpApiKey";
  const t0 = Date.now();
  const trimmed = apiKeyRaw.trim();
  if (!trimmed) {
    return { success: false, error: "Enter a Yelp API key." };
  }
  log.info("Action started", { action });
  try {
    const bid = (await getBusinessConfigForCurrentTenant()).yelpBusinessId.trim();
    await saveConnectorToken({
      provider: "yelp",
      api_key: trimmed,
      connected_at: now(),
      business_id: bid,
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

/**
 * Build the Google OAuth URL for the given connector kind (default
 * "gsc"). Each kind requests exactly ONE scope set:
 *   • gsc → webmasters.readonly
 *   • gbp → business.manage
 *   • ga4 → analytics.readonly      (Slice 9.A1α scaffold; Slice
 *                                    9.A1β surfaces the Connect
 *                                    button)
 *
 * State is HMAC-signed with BEACON_OAUTH_STATE_SECRET and carries the
 * connector kind + tenantId + nonce + issued-at. The callback verifies
 * the signature before persisting the token.
 */
export async function getGoogleAuthUrl(
  kind: GoogleConnectorKind = "gsc",
): Promise<{ url: string | null; error?: string }> {
  const action = "getGoogleAuthUrl";
  try {
    const tenantId = await currentTenantId();
    const state = encodeOAuthState({
      k: kind,
      t: tenantId,
      n: generateOAuthNonce(),
      i: Date.now(),
    });
    const url = buildGoogleAuthUrl(kind, state);
    log.info("Google auth URL generated", { action, kind });
    return { url };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Failed to build Google auth URL", {
      action,
      kind,
      error: err.slice(0, 500),
    });
    return { url: null, error: err };
  }
}

export async function loadGoogleLocations(): Promise<
  | { ok: true; locations: GbpLocationInfo[] }
  | { ok: false; message: string }
> {
  const action = "loadGoogleLocations";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const result = await fetchGoogleLocations();
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      ok: result.ok,
      count: result.ok ? result.locations.length : 0,
    });
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    return { ok: true, locations: result.locations };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { ok: false, message: err.slice(0, 500) };
  }
}

export async function selectGoogleLocation(
  locationId: string,
  locationName: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "selectGoogleLocation";
  const t0 = Date.now();
  log.info("Action started", { action, locationId });
  try {
    await updateConnectorToken("google_gbp", {
      selected_location_id: locationId,
      selected_location_name: locationName,
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err.slice(0, 500) };
  }
}

export async function syncGoogleReviews(): Promise<
  | {
      ok: true;
      imported: number;
      rejected: number;
      partial: boolean;
      warnings: string[];
    }
  | { ok: false; code: string; message: string }
> {
  const action = "syncGoogleReviews";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const result = await runGoogleReviewsSync();
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      ok: result.ok,
    });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return {
      ok: false,
      code: "sync_failed",
      message: err.slice(0, 500),
    };
  }
}

export async function syncYelpReviews(): Promise<
  | {
      ok: true;
      imported: number;
      rejected: number;
      partial: boolean;
      warnings: string[];
    }
  | { ok: false; code: string; message: string }
> {
  const action = "syncYelpReviews";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const result = await runYelpReviewsSync();
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      ok: result.ok,
    });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return {
      ok: false,
      code: "sync_failed",
      message: err.slice(0, 500),
    };
  }
}

export async function disconnectYelp(): Promise<{
  success: boolean;
  error?: string;
}> {
  const action = "disconnectYelp";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    await deleteConnectorToken("yelp");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

export async function disconnectGoogle(): Promise<{
  success: boolean;
  error?: string;
}> {
  const action = "disconnectGoogle";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    // Disconnect both Google providers — GSC + GBP are separate token
    // grants, but a single "Disconnect Google" affordance clears both
    // so the operator doesn't have to click twice.
    //
    // J5 (2026-05-18) — GSC uses SOFT disconnect so cached historical
    // state in `gsc_url_inspections` is preserved. Reconnect via the
    // standard OAuth flow naturally clears `disconnected_at` because
    // saveConnectorToken upserts a fresh payload without the field.
    // GBP keeps its existing destructive delete path (Section 7
    // owns the GBP soft-disconnect migration when warranted).
    //
    // Slice 9.A1β (2026-05-18) — GA4 is INTENTIONALLY excluded from
    // this combined affordance. The Google Analytics card on
    // /settings/connectors owns its own `disconnectGoogleGa4` server
    // action so the operator can manage GA4 independently of the GSC
    // + GBP combo (e.g., rotate the property selection without
    // re-running Search Console OAuth).
    const tenantId = await currentTenantId();
    await softDisconnectGsc({ tenantId });
    await deleteConnectorToken("google_gbp");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Slice 9.A1β (2026-05-18) — GA4 server actions
// ─────────────────────────────────────────────────────────────────────

/**
 * List GA4 properties the connected operator can read. Wraps the
 * tenant-scoped `listGa4PropertiesForTenant` helper for the property
 * picker UI on `/settings/connectors`. Returns the structured
 * fail-soft result verbatim; the client component renders per-reason
 * copy.
 */
export async function listGa4Properties(): Promise<Ga4PropertyListResult> {
  const action = "listGa4Properties";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    const result = await listGa4PropertiesForTenant(tenantId);
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      ok: result.ok,
      count: result.ok ? result.properties.length : 0,
    });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { ok: false, reason: "api_error", message: err.slice(0, 500) };
  }
}

/**
 * Persist the operator's GA4 property selection onto the
 * `google_ga4` token payload. Defense-in-depth: the picker UI passes
 * a property from a fresh `listGa4Properties()` call, but a stale or
 * forged submission could pass an arbitrary id; this action ALSO
 * re-runs the property listing and verifies the submitted id is in
 * the latest set before persisting.
 */
export async function selectGa4Property(
  property: Pick<Ga4Property, "id" | "displayName" | "accountDisplayName">,
): Promise<{ success: boolean; error?: string }> {
  const action = "selectGa4Property";
  const t0 = Date.now();
  const propertyId = (property?.id ?? "").trim();
  const propertyDisplayName = (property?.displayName ?? "").trim();
  const accountDisplayName = (property?.accountDisplayName ?? "").trim();
  log.info("Action started", { action, propertyId });
  if (propertyId === "" || propertyDisplayName === "") {
    return {
      success: false,
      error: "Property id + display name are required.",
    };
  }
  try {
    const tenantId = await currentTenantId();
    // Defense-in-depth: re-list the operator's properties + verify
    // the submitted id is in the latest set. Skips when the listing
    // fails (e.g., transient API error) — in that case we trust the
    // form submission since the operator must have just seen the
    // property in the picker to have submitted it. The picker UI
    // re-runs listGa4Properties after disconnect/reconnect so a
    // stale id never lingers in the rendered HTML.
    const list = await listGa4PropertiesForTenant(tenantId);
    if (list.ok) {
      const known = list.properties.some((p) => p.id === propertyId);
      if (!known) {
        return {
          success: false,
          error:
            "Selected property is no longer available. Please choose again.",
        };
      }
    }
    await updateConnectorToken("google_ga4", {
      ga4_property_id: propertyId,
      ga4_property_display_name: propertyDisplayName,
      ga4_account_display_name:
        accountDisplayName !== "" ? accountDisplayName : undefined,
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err.slice(0, 500) };
  }
}

/**
 * Soft-disconnect the GA4 connector. Mirrors the GSC J5 soft-disconnect
 * contract: sets `disconnected_at` on the existing token payload via
 * `updateConnectorToken` — NO destructive `deleteConnectorToken`. The
 * UI shows the Connect button + "Last refreshed at X days ago" copy
 * until the operator reconnects via OAuth (the callback upserts a
 * fresh payload that omits `disconnected_at`, naturally clearing the
 * field). Also clears `ga4_property_id` (and friends) so reconnect
 * re-runs the property picker.
 */
export async function disconnectGoogleGa4(): Promise<{
  success: boolean;
  error?: string;
}> {
  const action = "disconnectGoogleGa4";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const nowIso = new Date().toISOString();
    await updateConnectorToken("google_ga4", {
      disconnected_at: nowIso,
      ga4_property_id: undefined,
      ga4_property_display_name: undefined,
      ga4_account_display_name: undefined,
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { success: false, error: err.slice(0, 500) };
  }
}

// ── Connect-cards slice (2026-06-12) — SEMrush / Profound / Clarity ──
// Same self-serve posture as the Wix card: paste a key, it stays on
// this server, the nightly syncs activate the moment it lands
// (dormant-honest until then). Disconnect = soft (cached data kept).

export async function saveSemrushConnection(input: {
  apiKey: string;
  database?: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveSemrushConnection";
  const t0 = Date.now();
  const apiKey = input.apiKey.trim();
  const database = (input.database ?? "us").trim() || "us";
  if (!apiKey) return { success: false, error: "Enter your Semrush API key." };
  log.info("Action started", { action });
  try {
    await saveConnectorToken({
      provider: "semrush",
      api_key: apiKey,
      database,
      connected_at: now(),
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

export async function disconnectSemrush(): Promise<{ success: boolean; error?: string }> {
  const action = "disconnectSemrush";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    await deleteConnectorToken("semrush");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

export async function saveProfoundConnection(input: {
  apiKey: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveProfoundConnection";
  const t0 = Date.now();
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { success: false, error: "Enter your Profound API key." };
  log.info("Action started", { action });
  try {
    await saveConnectorToken({
      provider: "profound",
      api_key: apiKey,
      connected_at: now(),
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

export async function disconnectProfound(): Promise<{ success: boolean; error?: string }> {
  const action = "disconnectProfound";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    await deleteConnectorToken("profound");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

export async function saveClarityConnection(input: {
  apiToken: string;
}): Promise<{ success: boolean; error?: string }> {
  const action = "saveClarityConnection";
  const t0 = Date.now();
  const apiToken = input.apiToken.trim();
  if (!apiToken) {
    return { success: false, error: "Enter your Clarity API token." };
  }
  log.info("Action started", { action });
  try {
    await saveConnectorToken({
      provider: "clarity",
      api_token: apiToken,
      connected_at: now(),
    });
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

export async function disconnectClarity(): Promise<{ success: boolean; error?: string }> {
  const action = "disconnectClarity";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    await deleteConnectorToken("clarity");
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0 });
    return { success: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { success: false, error: err };
  }
}

// ─────────────────────────────────────────────────────────────────────
// ON-DEMAND "Sync now" actions (2026-06-15) — golden path with crons OFF.
//
// All GitHub Actions + the Vercel cron are disabled. The per-tenant sync
// engines (syncGscSearchAnalyticsForTenant / syncGa4UrlTrafficForTenant /
// syncProfoundNightlyForTenant / syncClarityDailyMetricsForTenant /
// syncSemrushOrganicKeywordsForTenant) are all pure HTTP→Supabase (no
// subprocess, Vercel-safe) and were previously reachable ONLY from the
// nightly script. These actions surface each as an operator-clickable
// "Sync now" so connecting a source actually pulls data. Each is fail-soft
// and returns a normalized {ok, detail?, error?} the card renders. They are
// idempotent (each sync has its own dedupe/watermark/UTC-day guard).
// ─────────────────────────────────────────────────────────────────────

export type ConnectorSyncNowResult = {
  ok: boolean;
  detail?: string;
  error?: string;
};

/**
 * #87/#88 honesty fix (2026-06-14) — reasons that genuinely mean "this
 * source simply isn't connected / has nothing yet": a benign skip, NOT a
 * failure. Everything NOT in this set (auth expired, supabase down, upsert
 * failed, …) is surfaced as a real failure so the owner is told to act.
 *
 *   • no_token / no_key / no_property / no_domain / disconnected — never set up.
 *   • no_property_derivable — GSC connected but no domain configured yet.
 *   • no_categories_configured — Profound key works, workspace empty.
 */
const BENIGN_SKIP_REASONS = new Set([
  "no_token",
  "no_key",
  "no_property",
  "disconnected",
  // #208 — `no_domain` / `no_property_derivable` now route to the more
  // specific NEEDS_DOMAIN_REASONS copy ("set your website domain in
  // Config") instead of the generic "not connected yet" line.
  "no_categories_configured",
  // GSC: token store genuinely had no row → never connected (#87).
  "no_usable_gsc_token",
  // Profound: no key connected yet (#88) — distinct from profound_api_error.
  "no_profound_key",
  // Clarity: no token connected yet — distinct from a real API error. (The
  // engine still uses the legacy combined reason; treat it as a skip so an
  // unconnected source never alarms. A genuine upsert_failed stays a failure.)
  "no_token_or_api_error",
]);

/**
 * #87 (2026-06-14) — reasons that mean "you WERE connected but the auth
 * broke": an honest FAILURE that tells the owner to reconnect, never a
 * harmless "skipped". Each maps to plain-English copy (no jargon).
 */
const RECONNECT_REASONS: Record<string, string> = {
  // GSC: token row exists but the grant expired / went stale (>7d).
  gsc_token_expired:
    "Your Google connection expired — reconnect Google to refresh.",
  // GSC: a mid-sync 401/403 the refresh couldn't recover (revoked / lost scope).
  gsc_auth_failed_401:
    "Your Google connection expired — reconnect Google to refresh.",
  gsc_auth_failed_403:
    "Google revoked access for this site — reconnect Google to refresh.",
};

/**
 * #208 — plain-English copy for genuine FAILURE reason codes the sync
 * engines emit. Pre-fix these fell through to "Sync failed: <raw_code>."
 * which leaks an internal token (e.g. "supabase_unavailable",
 * "no_key_or_api_error") to a non-technical owner. Anything still NOT in
 * this map keeps the generic "Sync didn't finish" fallback below — never
 * the raw code.
 */
const FAILED_REASON_COPY: Record<string, string> = {
  // Beacon's database was briefly unreachable — transient, retry works.
  supabase_unavailable:
    "Beacon couldn't reach its database just now — please try again in a moment.",
  // Writing the pulled rows failed — transient, retry works.
  upsert_failed:
    "Beacon pulled your data but couldn't save it — please try again in a moment.",
  // SEMrush: the key is missing OR the API rejected the request.
  no_key_or_api_error:
    "Couldn't reach SEMrush — check the API key on this card, then try again.",
  // Profound: the key is present but the API returned an error.
  profound_api_error:
    "Couldn't reach Profound — check the API key on this card, then try again.",
  // Profound: no competitor configured yet to pull citations against.
  no_known_competitor:
    "Add at least one competitor in Settings → Config, then sync again.",
};

/**
 * #208 — reasons that mean "you're connected, but Beacon needs your
 * website domain in Config before it can pull data". A benign,
 * actionable state — not an alarming failure, but distinct from the
 * generic "not connected yet" so the owner knows the exact next step.
 */
const NEEDS_DOMAIN_REASONS = new Set([
  "no_property_derivable",
  "no_domain",
]);

/**
 * Normalize a connector sync engine's discriminated result into the UI
 * shape WITHOUT coupling to each connector's exact fields. The engines all
 * carry a `synced` boolean discriminant; on success they expose some of
 * {rows_upserted, rows, imported, days, citation_rows}; on skip they expose
 * a `reason`. We read those defensively so one summarizer serves all five.
 */
function summarizeConnectorSync(result: unknown): ConnectorSyncNowResult {
  const r = (result ?? {}) as {
    synced?: boolean;
    reason?: string;
    rows_upserted?: number;
    rows?: number;
    imported?: number;
    days?: number;
    citation_rows?: number;
  };
  if (r.synced) {
    const bits: string[] = [];
    // #88 (2026-06-14) — a successful sync that returned zero rows is an OK
    // state, not a failure. Profound especially: a synced run with zero
    // citations means the engine ran fine and there's simply nothing yet —
    // distinct from an auth/API error (which fails below as profound_api_error).
    const rowCount = r.rows_upserted ?? r.rows ?? r.imported ?? r.citation_rows;
    if (rowCount != null) bits.push(`${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`);
    if (r.days != null) bits.push(`${r.days} day${r.days === 1 ? "" : "s"}`);
    if (bits.length) return { ok: true, detail: `Synced ${bits.join(" · ")}.` };
    return { ok: true, detail: "Synced — nothing new found yet." };
  }
  // #87 — auth broke: an honest, plain-English reconnect prompt (a FAILURE).
  if (r.reason != null && RECONNECT_REASONS[r.reason] != null) {
    return { ok: false, error: RECONNECT_REASONS[r.reason] };
  }
  // #208 — connected, but Beacon needs the website domain set in Config
  // before it can pull. A specific, actionable next step (not a raw code).
  if (r.reason != null && NEEDS_DOMAIN_REASONS.has(r.reason)) {
    return {
      ok: false,
      error: "Set your website domain in Settings → Config, then sync again.",
    };
  }
  // #208 — GA4 ran fine but there's simply no traffic data yet. A benign
  // "nothing yet" state, not a failure to alarm the owner about.
  if (r.reason === "no_traffic_data") {
    return { ok: true, detail: "Synced — no traffic data yet." };
  }
  // Benign skip — the source isn't connected yet. Not an alarming failure.
  if (r.reason != null && BENIGN_SKIP_REASONS.has(r.reason)) {
    return { ok: false, error: "Not connected yet — connect this source to sync." };
  }
  // #208 — known real-failure reason codes get plain-English copy instead
  // of leaking the raw token (supabase_unavailable, upsert_failed, …).
  if (r.reason != null && FAILED_REASON_COPY[r.reason] != null) {
    return { ok: false, error: FAILED_REASON_COPY[r.reason] };
  }
  // Anything still unmapped is a real failure — keep it honest, but never
  // surface the raw reason code to a non-technical owner.
  return {
    ok: false,
    error: "Sync didn't finish — please try again in a moment.",
  };
}

/**
 * Map a "Sync now" action to the connector token-store provider whose
 * `last_synced_at` should be stamped on a successful pull (#72/#85). Only
 * providers backed by the connector store are listed.
 */
type FreshnessProvider =
  | "google_gsc"
  | "google_ga4"
  | "semrush"
  | "profound"
  | "clarity";

async function writeLastSyncedAt(
  provider: FreshnessProvider,
  tenantId: string,
): Promise<void> {
  // Best-effort: a freshness-write failure must never turn a successful sync
  // into a reported failure. updateConnectorToken is a no-op when the row is
  // missing (e.g. soft-disconnected), so this is safe to call unconditionally.
  // Switch routes to the right overload (each provider has a distinct patch
  // type; all five accept last_synced_at).
  try {
    const patch = { last_synced_at: now() };
    switch (provider) {
      case "google_gsc":
      case "google_ga4":
        await updateConnectorToken(provider, patch, tenantId);
        break;
      case "semrush":
        await updateConnectorToken(provider, patch, tenantId);
        break;
      case "profound":
        await updateConnectorToken(provider, patch, tenantId);
        break;
      case "clarity":
        await updateConnectorToken(provider, patch, tenantId);
        break;
    }
  } catch (e) {
    log.warn("Freshness write failed (sync still succeeded)", {
      provider,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }
}

async function runConnectorSyncNow(
  action: string,
  run: (tenantId: string) => Promise<unknown>,
  /** Connector-store provider whose last_synced_at to stamp on success
   *  (#72/#85). Omit for sources without a freshness row. */
  freshnessProvider?: FreshnessProvider,
): Promise<ConnectorSyncNowResult> {
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    const result = await run(tenantId);
    const summary = summarizeConnectorSync(result);
    // #72/#85 — stamp freshness ONLY on a genuinely successful pull so the
    // connector card + freshness label stop saying "never refreshed".
    if (summary.ok && freshnessProvider != null) {
      await writeLastSyncedAt(freshnessProvider, tenantId);
    }
    revalidatePath("/settings/connectors");
    log.info("Action completed", { action, durationMs: Date.now() - t0, ok: summary.ok });
    return summary;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: err.slice(0, 500) });
    return { ok: false, error: err.slice(0, 500) };
  }
}

/** Pull the latest Google Search Console search-analytics for this tenant.
 *  First click on a cold tenant auto-backfills the watermark window; click
 *  again to extend history further. */
export async function syncGscNow(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncGscNow",
    (tenantId) => syncGscSearchAnalyticsForTenant({ tenantId }),
    "google_gsc",
  );
}

/** Pull GA4 URL traffic for the selected property. */
export async function syncGa4Now(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncGa4Now",
    (tenantId) => syncGa4UrlTrafficForTenant({ tenantId }),
    "google_ga4",
  );
}

/** Pull Profound AI-visibility/citation rows for this tenant. */
export async function syncProfoundNow(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncProfoundNow",
    (tenantId) => syncProfoundNightlyForTenant({ tenantId }),
    "profound",
  );
}

/** Pull Microsoft Clarity daily friction metrics for this tenant. */
export async function syncClarityNow(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncClarityNow",
    (tenantId) => syncClarityDailyMetricsForTenant({ tenantId }),
    "clarity",
  );
}

/** Pull SEMrush organic keywords (supporting evidence) for this tenant. */
export async function syncSemrushNow(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncSemrushNow",
    (tenantId) => syncSemrushOrganicKeywordsForTenant({ tenantId }),
    "semrush",
  );
}
