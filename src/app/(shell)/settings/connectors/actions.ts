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
import { getBusinessConfig } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";

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
    const bid = getBusinessConfig().yelpBusinessId.trim();
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
