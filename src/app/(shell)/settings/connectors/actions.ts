"use server";

import { log } from "@/lib/logger";
import {
  getConnectorInfo,
  deleteConnectorToken,
  saveConnectorToken,
  updateConnectorToken,
  type ConnectorInfo,
} from "@/lib/connector-store";
import { buildGoogleAuthUrl } from "@/lib/connectors/google-auth";
import {
  runGoogleReviewsSync,
  fetchGoogleLocations,
  type GbpLocationInfo,
} from "@/lib/connectors/google-reviews-sync";
import { runYelpReviewsSync } from "@/lib/connectors/yelp-reviews-sync";
import { getBusinessConfig } from "@/lib/business-config";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";

export async function getGoogleConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google");
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
    saveConnectorToken({
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

export async function getGoogleAuthUrl(): Promise<{
  url: string | null;
  error?: string;
}> {
  const action = "getGoogleAuthUrl";
  try {
    const url = buildGoogleAuthUrl();
    log.info("Google auth URL generated", { action });
    return { url };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Failed to build Google auth URL", {
      action,
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
    updateConnectorToken("google", {
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
    deleteConnectorToken("yelp");
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
    deleteConnectorToken("google");
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
