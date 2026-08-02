"use server";

import { log } from "@/lib/logger";
import { continueResearch, requestExtraSample, warmFreeSurfaces } from "@/domains/runtime"; import { reportingDay } from "@/lib/reporting-day";
import {
  getConnectorInfo,
  getGoogleConnectorToken,
  getYelpConnectorToken,
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
  type OAuthIntent,
} from "@/lib/connectors/google-auth";
import {
  runGoogleReviewsSync,
  fetchGoogleLocations,
  type GbpLocationInfo,
} from "@/lib/connectors/google-reviews-sync";
import { runYelpReviewsSync } from "@/lib/connectors/yelp-reviews-sync";
import { getTenant, websiteOf } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";
// On-demand connector syncs (2026-06-15), with all crons/Actions off, these
// existing per-tenant sync engines (HTTP + Supabase, Vercel-safe) must be
// triggerable from the product. Each "Sync now" action wraps one.
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { recordSourceRefresh } from "@/domains/runtime";
import type { RefreshSource } from "@/domains/runtime/ops/refresh-runs-store";
import {
  discoverAndMapWixCollections,
  type DiscoverWixResult,
} from "./wix-mapping";

/** Manual-refresh provider -> refresh-ledger source name. The manual paths all
 *  pull one of the four read sources; each maps 1:1. */
function manualLedgerSource(provider: FreshnessProvider): RefreshSource {
  switch (provider) {
    case "google_gsc":
      return "gsc";
    case "google_ga4":
      return "ga4";
    case "clarity":
      return "clarity";
  }
}

/** Record a manual (operator-triggered) refresh into the ledger. Fail-soft:
 *  never throws, so recording can't turn a successful refresh into a failure. */
async function recordManualRefresh(
  tenantId: string,
  provider: FreshnessProvider,
  startedAt: string,
  value: unknown,
): Promise<void> {
  try {
    await recordSourceRefresh({
      tenantId,
      source: manualLedgerSource(provider),
      trigger: "manual",
      startedAt,
      value,
    });
  } catch (e) {
    log.warn("Refresh-ledger write threw (refresh unaffected)", {
      provider,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }
}

export async function getGoogleGscConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google_gsc");
}

export async function getGoogleGbpConnectorStatus(): Promise<ConnectorInfo> {
  return getConnectorInfo("google_gbp");
}

/**
 * Slice 9.A1β (2026-05-18), read GA4 connector status. Mirrors the
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
 * North-star onboarding (2026-06-11), self-serve Wix connection.
 * A Wix customer pastes their own API key + site id; the token is
 * stored per-tenant in the connector store (the same row the push
 * service reads). Without this card the publish path dead-ended on
 * the operator hand-seeding the key. The key is held server-side
 * only; pushing still goes through Approve & Push (operator click,
 * caps, non-destructive guard), connecting a key never publishes
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

export type { DiscoverWixResult } from "./wix-mapping";

/**
 * Discover the connected Wix site's collections and build the page map so
 * approved changes can publish (relocated 2026-07-20 from the retired
 * /diagnostics/wix surface). Read-only discovery + an internal url-map build:
 * this NEVER writes to the live site. Returns the mapped-page count on success
 * so the Wix card can say exactly how many pages it can now publish to, or an
 * honest reason on failure. Fail-soft: never throws.
 */
export async function discoverWixCollections(): Promise<DiscoverWixResult> {
  const action = "discoverWixCollections";
  const t0 = Date.now();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    // Canonical Website: the Account row owns the one domain.
    const account = await getTenant(tenantId).catch(() => null);
    const domain = account ? websiteOf(account).domain : "";
    if (domain === "") {
      // A well-formed site base URL needs the operator's domain; without it we
      // cannot derive any page URLs. Surface it as an honest api_error-adjacent
      // reason the card explains plainly.
      return {
        ok: false,
        reason: "sync_failed",
        detail: "no site domain set",
      };
    }
    const siteBaseUrl = `https://www.${domain.replace(/^www\./, "")}`;
    const result = await discoverAndMapWixCollections({ siteBaseUrl }, { tenantId });
    if (result.ok) {
      // A fresh url map changes what the push service can resolve; drop the
      // cross-request graph snapshot so the next render sees it.
      revalidatePath("/settings/connectors");
    }
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      ok: result.ok,
      mappedPages: result.ok ? result.mappedPages : undefined,
    });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { ok: false, reason: "api_error", detail: err.slice(0, 500) };
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
    // Connection owns connector configuration; the business id lives on the
    // connector token, never on the BusinessProfile.
    const existingToken = await getYelpConnectorToken();
    await saveConnectorToken({
      provider: "yelp",
      api_key: trimmed,
      connected_at: now(),
      business_id: existingToken?.business_id ?? "",
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
 * "gsc"). Each kind requests exactly ONE data scope, plus the basic
 * openid + email identity scopes (per-tenant OAuth, 2026-07-09):
 *   • gsc → webmasters.readonly
 *   • gbp → business.manage
 *   • ga4 → analytics.readonly      (Slice 9.A1α scaffold; Slice
 *                                    9.A1β surfaces the Connect
 *                                    button)
 *
 * INTENT (per-tenant OAuth, 2026-07-09): the caller says WHY it wants a
 * flow ("connect" for a first grant, "replace" to swap the Google account
 * behind a live grant, "reauth" to reconnect a dead one), and this action,
 * the ONE store-readable call site, verifies that intent against the
 * stored token before threading it into the auth URL and the signed state:
 *   • "replace" is only honored when a LIVE grant actually exists;
 *     otherwise it degrades to the derived intent (a forged/stale client
 *     call can never widen semantics).
 *   • Omitted intent derives from the store: no usable grant → "connect";
 *     dead or soft-disconnected → "reauth"; live → "replace".
 * Every intent shows Google's account chooser AND forces consent (a fresh
 * refresh token for the chosen account). Ordinary syncs/refreshes never
 * run OAuth, so this cannot churn Google's cap of 100 refresh tokens per
 * Google account per OAuth client (only deliberate operator clicks reach
 * here; when the cap IS exceeded, Google revokes the oldest token).
 *
 * State is HMAC-signed with BEACON_OAUTH_STATE_SECRET and carries the
 * connector kind + tenantId + nonce + issued-at + intent. The callback
 * verifies the signature before persisting the token.
 */
export async function getGoogleAuthUrl(
  kind: GoogleConnectorKind = "gsc",
  requestedIntent?: OAuthIntent,
): Promise<{ url: string | null; error?: string }> {
  const action = "getGoogleAuthUrl";
  try {
    const tenantId = await currentTenantId();
    // Derive the honest intent from the stored token, then reconcile with
    // what the client asked for. Store unreadable → treat as no grant
    // ("connect"), which is always the safest posture.
    let derived: OAuthIntent = "connect";
    try {
      const existing = await getGoogleConnectorToken(kind, tenantId);
      const hasStoredRefreshToken =
        existing != null &&
        typeof existing.refresh_token === "string" &&
        existing.refresh_token !== "";
      const isDeadOrDisconnected =
        existing != null &&
        ((existing.auth_failed_at != null && existing.auth_failed_at !== "") ||
          (existing.disconnected_at != null && existing.disconnected_at !== ""));
      derived = !hasStoredRefreshToken
        ? "connect"
        : isDeadOrDisconnected
          ? "reauth"
          : "replace";
    } catch {
      derived = "connect";
    }
    // The client's requested intent is honored only when it makes sense for
    // the stored state; "replace" without a live grant falls back to derived.
    const intent: OAuthIntent =
      requestedIntent === "replace"
        ? derived === "replace"
          ? "replace"
          : derived
        : requestedIntent === "connect" || requestedIntent === "reauth"
          ? requestedIntent
          : derived;
    const state = encodeOAuthState({
      k: kind,
      t: tenantId,
      n: generateOAuthNonce(),
      i: Date.now(),
      x: intent,
    });
    const url = buildGoogleAuthUrl(kind, state, intent);
    log.info("Google auth URL generated", { action, kind, intent });
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
    // Disconnect both Google providers, GSC + GBP are separate token
    // grants, but a single "Disconnect Google" affordance clears both
    // so the operator doesn't have to click twice.
    //
    // J5 (2026-05-18), GSC uses SOFT disconnect so cached historical
    // state in `gsc_url_inspections` is preserved. Reconnect via the
    // standard OAuth flow naturally clears `disconnected_at` because
    // saveConnectorToken upserts a fresh payload without the field.
    // GBP keeps its existing destructive delete path (Section 7
    // owns the GBP soft-disconnect migration when warranted).
    //
    // Slice 9.A1β (2026-05-18), GA4 is INTENTIONALLY excluded from
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
// Slice 9.A1β (2026-05-18), GA4 server actions
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
    // fails (e.g., transient API error), in that case we trust the
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
 * `updateConnectorToken`, NO destructive `deleteConnectorToken`. The
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

// ── Connect-cards slice (2026-06-12), Clarity ──
// Same self-serve posture as the Wix card: paste a key, it stays on
// this server, the nightly syncs activate the moment it lands
// (dormant-honest until then). Disconnect = soft (cached data kept).

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
// ON-DEMAND "Sync now" actions (2026-06-15), golden path with crons OFF.
//
// All GitHub Actions + the Vercel cron are disabled. The per-tenant sync
// engines (syncGscSearchAnalyticsForTenant / syncGa4UrlTrafficForTenant /
// syncClarityDailyMetricsForTenant) are all pure HTTP→Supabase (no
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
 * #87/#88 honesty fix (2026-06-14), reasons that genuinely mean "this
 * source simply isn't connected / has nothing yet": a benign skip, NOT a
 * failure. Everything NOT in this set (auth expired, supabase down, upsert
 * failed, …) is surfaced as a real failure so the owner is told to act.
 *
 *   • no_token / no_key / no_property / no_domain / disconnected, never set up.
 *   • no_property_derivable, GSC connected but no domain configured yet.
 */
const BENIGN_SKIP_REASONS = new Set([
  "no_token",
  "no_key",
  "no_property",
  "disconnected",
  // #208, `no_domain` / `no_property_derivable` now route to the more
  // specific NEEDS_DOMAIN_REASONS copy ("set your website domain in
  // Config") instead of the generic "not connected yet" line.
  // GSC: token store genuinely had no row → never connected (#87).
  "no_usable_gsc_token",
  // Clarity: no token connected yet, distinct from a real API error. (The
  // engine still uses the legacy combined reason; treat it as a skip so an
  // unconnected source never alarms. A genuine upsert_failed stays a failure.)
  "no_token_or_api_error",
]);

/**
 * #87 (2026-06-14), reasons that mean "you WERE connected but the auth
 * broke": an honest FAILURE that tells the owner to reconnect, never a
 * harmless "skipped". Each maps to plain-English copy (no jargon).
 */
const RECONNECT_REASONS: Record<string, string> = {
  // GSC: token row exists but the grant expired / went stale (>7d).
  gsc_token_expired:
    "Your Google connection expired. Reconnect Google to refresh.",
  // GSC: a mid-sync 401/403 the refresh couldn't recover (revoked / lost scope).
  gsc_auth_failed_401:
    "Your Google connection expired. Reconnect Google to refresh.",
  gsc_auth_failed_403:
    "Google revoked access for this site. Reconnect Google to refresh.",
};

/**
 * #208, plain-English copy for genuine FAILURE reason codes the sync
 * engines emit. Pre-fix these fell through to "Sync failed: <raw_code>."
 * which leaks an internal token (e.g. "supabase_unavailable",
 * "no_key_or_api_error") to a non-technical owner. Anything still NOT in
 * this map keeps the generic "Sync didn't finish" fallback below, never
 * the raw code.
 */
const FAILED_REASON_COPY: Record<string, string> = {
  // Beacon's database was briefly unreachable, transient, retry works.
  supabase_unavailable:
    "Beacon couldn't reach its database just now, please try again in a moment.",
  // Writing the pulled rows failed, transient, retry works.
  upsert_failed:
    "Beacon pulled your data but couldn't save it, please try again in a moment.",
  // The key is missing OR the API rejected the request.
  no_key_or_api_error:
    "I could not reach this data source. Check the connection details on this card and try again.",
  // No competitor configured yet to pull citations against.
  no_known_competitor:
    "Add at least one competitor in Settings → Config, then sync again.",
};

/**
 * #208, reasons that mean "you're connected, but Beacon needs your
 * website domain in Config before it can pull data". A benign,
 * actionable state, not an alarming failure, but distinct from the
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
    // #88 (2026-06-14), a successful sync that returned zero rows is an OK
    // state, not a failure: the engine ran fine and there's simply nothing yet,
    // distinct from an auth/API error (which fails below).
    const rowCount = r.rows_upserted ?? r.rows ?? r.imported ?? r.citation_rows;
    // Only count POSITIVE rows as a "N rows" success bit. A successful sync
    // that returned exactly zero rows is reported separately below, silently
    // printing "Synced 0 rows" hid the real story (e.g. GA4 connected but the
    // property has no traffic / its tag isn't collecting). Wave 0 (2026-06-18).
    if (rowCount != null && rowCount > 0)
      bits.push(`${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`);
    if (r.days != null) bits.push(`${r.days} day${r.days === 1 ? "" : "s"}`);
    if (bits.length) return { ok: true, detail: `Synced ${bits.join(" · ")}.` };
    // Explicit empty pull (the API call worked but the source returned zero
    // rows for the window). Wave 0 (2026-06-18): say what that means instead of
    // a bare "Synced 0 rows", the #1 cause is the source isn't collecting yet
    // (e.g. a GA4 property whose tracking tag isn't installed/firing on the site).
    if (rowCount === 0) {
      return {
        ok: true,
        detail:
          "Connected and working, but this source returned no data for the window. If it should have data, check that it's actively collecting (for Google Analytics, that the GA4 tracking tag is installed and firing on your site).",
      };
    }
    return { ok: true, detail: "Synced, nothing new found yet." };
  }
  // 2026-06-22, Beacon's OWN Google credentials are wrong (invalid_client):
  // the refresh fails because GOOGLE_CLIENT_SECRET doesn't match the OAuth
  // client. This is a SERVER SETUP issue, not the user's connection -
  // reconnecting can't fix it. Name the real cause so it's diagnosable in
  // seconds instead of looking like a phantom "revoked".
  if (r.reason === "gsc_client_misconfig") {
    return {
      ok: false,
      error:
        "Beacon's Google sign-in credentials are misconfigured (the client secret is invalid). This is a server setup issue, not your Google connection, set GOOGLE_CLIENT_SECRET to match your Google Cloud OAuth client, then redeploy.",
    };
  }
  // 2026-06-22, a mid-sync 401/403 / refresh hiccup where the live-refresh
  // probe proved the grant is STILL ALIVE. NOT a reconnect case, Google just
  // had a momentary blip. Say so honestly instead of the alarming "revoked"
  // copy, so a healthy connection never gets told to reconnect.
  if (r.reason === "gsc_auth_transient") {
    return {
      ok: false,
      error:
        "Couldn't refresh from Google just now, your connection is fine. Try again in a moment.",
    };
  }
  // #87, auth broke: an honest, plain-English reconnect prompt (a FAILURE).
  if (r.reason != null && RECONNECT_REASONS[r.reason] != null) {
    return { ok: false, error: RECONNECT_REASONS[r.reason] };
  }
  // #208, connected, but Beacon needs the website domain set in Config
  // before it can pull. A specific, actionable next step (not a raw code).
  if (r.reason != null && NEEDS_DOMAIN_REASONS.has(r.reason)) {
    return {
      ok: false,
      error: "Set your website domain in Settings → Config, then sync again.",
    };
  }
  // #208, GA4 ran fine but there's simply no traffic data yet. A benign
  // "nothing yet" state, not a failure to alarm the owner about.
  if (r.reason === "no_traffic_data") {
    return { ok: true, detail: "Synced, no traffic data yet." };
  }
  // Benign skip, the source isn't connected yet. Not an alarming failure.
  if (r.reason != null && BENIGN_SKIP_REASONS.has(r.reason)) {
    return { ok: false, error: "Not connected yet. Connect this source to sync." };
  }
  // #208, known real-failure reason codes get plain-English copy instead
  // of leaking the raw token (supabase_unavailable, upsert_failed, …).
  if (r.reason != null && FAILED_REASON_COPY[r.reason] != null) {
    return { ok: false, error: FAILED_REASON_COPY[r.reason] };
  }
  // Anything still unmapped is a real failure, keep it honest, but never
  // surface the raw reason code to a non-technical owner.
  return {
    ok: false,
    error: "Sync didn't finish, please try again in a moment.",
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
        // A good manual pull also clears any bounded needs-attention marker
        // (BUG 2) so the operator's reconnect+sync heals the banner at once.
        await updateConnectorToken(
          provider,
          { ...patch, needs_attention_at: null, needs_attention_since: null, needs_attention_kind: null },
          tenantId,
        );
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
  const startedAt = new Date(t0).toISOString();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    const result = await run(tenantId);
    const summary = summarizeConnectorSync(result);
    // Record the honest per-source outcome into the refresh ledger so a manual
    // "Sync now" leaves a row (cron used to be the only path that recorded).
    if (freshnessProvider != null) {
      await recordManualRefresh(tenantId, freshnessProvider, startedAt, result);
    }
    // #72/#85, stamp freshness ONLY on a genuinely successful pull so the
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

/** Pull Microsoft Clarity daily friction metrics for this tenant. */
export async function syncClarityNow(): Promise<ConnectorSyncNowResult> {
  return runConnectorSyncNow(
    "syncClarityNow",
    (tenantId) => syncClarityDailyMetricsForTenant({ tenantId }),
    "clarity",
  );
}

// ─────────────────────────────────────────────────────────────────────
// ONE-CLICK "Refresh my data" (2026-06-15), Today command-center surface.
//
// The per-source "Sync now" actions above live on /settings/connectors. The
// owner asked for a single control on Today ("everything should be updating,
// I don't need to refresh"). This action pulls EVERY connected READ source in
// one click, fail-soft, concurrent, and returns a per-source result list the
// Today button renders. Wix is publish-only (EXCLUDED).
// ─────────────────────────────────────────────────────────────────────

/** The READ sources a Today refresh pulls, in display order. Wix is
 *  publish-only and intentionally excluded. Each entry maps a connector-store
 *  provider → its sync engine + plain-English customer label. */
const REFRESH_ALL_SOURCES: ReadonlyArray<{
  provider: "google_gsc" | "google_ga4" | "clarity";
  label: string;
  run: (tenantId: string) => Promise<unknown>;
  freshnessProvider: FreshnessProvider;
}> = [
  {
    provider: "google_gsc",
    label: "Search (Google)",
    run: (tenantId) => syncGscSearchAnalyticsForTenant({ tenantId }),
    freshnessProvider: "google_gsc",
  },
  {
    provider: "google_ga4",
    label: "Visitors (Google Analytics)",
    run: (tenantId) => syncGa4UrlTrafficForTenant({ tenantId }),
    freshnessProvider: "google_ga4",
  },
  {
    provider: "clarity",
    label: "Visitor experience",
    run: (tenantId) => syncClarityDailyMetricsForTenant({ tenantId }),
    freshnessProvider: "clarity",
  },
] as const;

export type RefreshAllConnectedResult = {
  /** ISO 8601 timestamp when this refresh ran. */
  ranAt: string;
  results: Array<{
    provider: string;
    /** Plain-English customer label (never a vendor name). */
    label: string;
    ok: boolean;
    /** Short, plain-English line, "Synced …" on success, an actionable
     *  reason on failure. Never a raw reason code. */
    detail: string;
  }>;
};

/**
 * Pull every CONNECTED read source for the current tenant in one click.
 *
 * - Resolves the tenant the same way the per-source "Sync now" actions do
 *   (`currentTenantId()`).
 * - Reads connector status for the 5 read sources; skips any not 'connected'
 *   (Wix is publish-only and not in the set at all).
 * - Runs the connected engines concurrently with `Promise.allSettled`, one
 *   source failing never blocks the others, and the action NEVER throws.
 * - Stamps `last_synced_at` on each genuinely-successful pull (#72/#85), the
 *   same freshness contract the per-source actions use.
 * - Zero connected → `{ ranAt, results: [] }`.
 */
/** ONE bounded research hop of whatever is unfinished, and whether more is owed. This is the recovery
 *  seam behind the Update data button: one request that claims the run's lease for itself, with the
 *  day's real count kept on the account's own row so the `hop` a caller passes is a REPORT, never an
 *  authority. The daily round itself is the scheduler's job, not this action's. */
export async function continueResearchNow(hop = 0): Promise<{ hop: number; more: boolean }> {
  const tenantId = await currentTenantId().catch(() => "");
  return tenantId ? continueResearch(tenantId, hop) : { hop: 0, more: false };
}

export async function refreshAllConnectedDataNow(): Promise<RefreshAllConnectedResult> {
  const action = "refreshAllConnectedDataNow";
  const t0 = Date.now();
  const ranAt = new Date().toISOString();
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();

    // Read status for all 5 read sources in parallel; fail-soft per provider
    // (a status-read error counts as not-connected so a flaky read never
    // alarms the owner about a source they never set up).
    const connectedFlags = await Promise.all(
      REFRESH_ALL_SOURCES.map(async (s) => {
        try {
          const info = await getConnectorInfo(s.provider, tenantId);
          return info.status === "connected";
        } catch {
          return false;
        }
      }),
    );
    const connected = REFRESH_ALL_SOURCES.filter((_, i) => connectedFlags[i]);

    // BEACON'S OWN RESEARCH IS NOT A CONNECTOR (2026-08-01). Zero connected sources used to return right
    // here, skipping the warm, the extra AI reading and any honest word about what happened, so an account
    // running on Beacon's own research could press this button forever and never get a second reading of
    // today's answers. Only the third-party syncs are skipped now.
    const startedAt = new Date().toISOString();
    const settled = await Promise.allSettled(
      connected.map((s) => s.run(tenantId)),
    );

    const results: RefreshAllConnectedResult["results"] = await Promise.all(
      connected.map(async (s, i) => {
        const outcome = settled[i];
        if (outcome.status === "rejected") {
          // Engine threw, fail-soft, plain-English (never the raw error).
          const err =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          log.warn("Refresh source threw", {
            action,
            provider: s.provider,
            error: err.slice(0, 200),
          });
          await recordManualRefresh(tenantId, s.freshnessProvider, startedAt, {
            synced: false,
            reason: err.slice(0, 200),
          });
          return {
            provider: s.provider,
            label: s.label,
            ok: false,
            detail: "Couldn't refresh just now, please try again in a moment.",
          };
        }
        const summary = summarizeConnectorSync(outcome.value);
        await recordManualRefresh(tenantId, s.freshnessProvider, startedAt, outcome.value);
        if (summary.ok) {
          // Best-effort freshness stamp; never flips a success to a failure.
          await writeLastSyncedAt(s.freshnessProvider, tenantId);
        }
        return {
          provider: s.provider,
          label: s.label,
          ok: summary.ok,
          detail:
            (summary.ok ? summary.detail : summary.error) ??
            (summary.ok
              ? "Updated."
              : "Couldn't refresh just now, please try again in a moment."),
        };
      }),
    );

    // Warm the shared surfaces BEFORE the repaint so the render after this refresh is instant, not a cold
    // ~6s demand-graph rebuild right when the operator is watching (the pulls above just changed the
    // underlying data; build-then-write rebuilds the snapshot from it). Free steps only, fail-soft: a warm
    // failure never turns a successful refresh into an error. Bounded by a safety-valve deadline (well
    // under this route's maxDuration) so a pathological hang can never wedge the action; if the cap wins,
    // the build keeps warming in the background for the next visit.
    const WARM_AFTER_REFRESH_DEADLINE_MS = 45_000;
    await Promise.race([
      // warmFreeSurfaces PROPAGATES a build failure (the Research Run publish phase
      // relies on that truth). This "Update data" action is deliberately fail-soft:
      // a warm failure must never turn a successful data refresh into an error, so
      // we own the .catch here rather than inside warmFreeSurfaces.
      warmFreeSurfaces(tenantId).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, WARM_AFTER_REFRESH_DEADLINE_MS)),
    ]);

    // Pressing Update data IS the ask for a second reading of today's AI answers, and the planner answers
    // honestly: it refuses while today's one canonical round is still owed (an extra read of a few
    // questions would tilt the day's average) and once every pair already has three. No new button and no
    // new surface. With nothing connected the line below is the whole answer the operator gets, so it says
    // WHAT ACTUALLY HAPPENED: that refusal used to reach a log line while the operator read "I refreshed
    // what I gather myself".
    const extra = await requestExtraSample(tenantId, reportingDay(Date.now())).catch(() => null);
    if (extra) log.info("Action extra AI reading", { action, granted: extra.granted, due: extra.due.length, reason: extra.reason });
    if (connected.length === 0) results.push({ provider: "beacon_research", label: "My own research.", ok: true,
      detail: `${extra == null ? "I could not tell whether a fresh AI reading is due just now, so I am not promising one."
        : extra.granted ? `I am taking ${extra.due.length} fresh AI ${extra.due.length === 1 ? "reading" : "readings"} now.`
          : extra.reason} Connect Google to refresh your search data too.` });

    revalidatePath("/");
    revalidatePath("/settings/connectors");
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      connected: connected.length,
      ok: results.filter((r) => r.ok).length,
    });
    return { ranAt, results };
  } catch (e) {
    // Defense-in-depth: the action must NEVER throw. Even a tenant-resolution
    // failure returns an empty (honest) result rather than crashing Today.
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { ranAt, results: [] };
  }
}
