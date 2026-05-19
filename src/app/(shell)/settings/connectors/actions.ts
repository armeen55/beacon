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
