/**
 * On-demand Google Business Profile review pull → mergeUpsertLocalReviews.
 * Track 1.4e — no background jobs, no auto-sync.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  getGoogleConnectorToken,
  isTokenExpired,
  persistRefreshedGoogleToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { mapGbpReviewToLocalReview } from "@/lib/connectors/google-reviews-map";
import type { LocalReview } from "@/lib/local-reviews-types";
import { mergeUpsertLocalReviews } from "@/lib/local-reviews-store";
import { appendConnectorReviewsImportRun } from "@/lib/connectors/connector-review-import-run";
import { now } from "@/lib/actions";
import { revalidatePath } from "next/cache";

function safeRevalidatePath(
  path: string,
  type?: "layout" | "page",
): void {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch {
    /* Outside a Next.js request (e.g. Vitest) — cache revalidation is a no-op. */
  }
}

const GBP_V4 = "https://mybusiness.googleapis.com/v4";

export type GoogleReviewsSyncResult =
  | {
      ok: true;
      imported: number;
      rejected: number;
      partial: boolean;
      warnings: string[];
    }
  | {
      ok: false;
      code: "not_connected" | "reconnect" | "sync_failed" | "no_location";
      message: string;
    };

type GbpJson = Record<string, unknown>;

async function gbpGet(
  pathWithLeadingSlash: string,
  accessToken: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${GBP_V4}${pathWithLeadingSlash}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { _parseError: true, _raw: text.slice(0, 300) };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

async function refreshAccessOrReconnect(): Promise<
  { access: string } | { reconnect: true }
> {
  const token = await getGoogleConnectorToken("gbp");
  if (!token?.refresh_token) {
    return { reconnect: true };
  }
  try {
    const r = await refreshGoogleAccessToken(token.refresh_token, {
      provider: "google_gbp",
      connectedAt: token.connected_at,
    });
    // Persist the refreshed token through the guarded compare-and-swap (RPC
    // mode 'refresh'), NOT updateConnectorToken: the patch path refuses
    // refresh_token, and a read-merge-write here is the cross-instance race the
    // CAS resolves (review P1-1). A rotated refresh_token (only when Google
    // returned one) self-heals the GBP grant instead of bricking on the next
    // refresh. Fail-soft inside the helper; the fresh access token still serves
    // this run regardless of whether the persist landed.
    await persistRefreshedGoogleToken("google_gbp", {
      access_token: r.access_token,
      expires_in: r.expires_in,
      ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
    });
    return { access: r.access_token };
  } catch {
    log.warn("Google refresh token exchange failed");
    return { reconnect: true };
  }
}

/** Ensures a non-expired access token; updates disk on refresh. */
async function ensureAccessToken(): Promise<
  { access: string } | { reconnect: true }
> {
  const token = await getGoogleConnectorToken("gbp");
  if (!token) return { reconnect: true };
  if (!isTokenExpired(token)) {
    return { access: token.access_token };
  }
  return refreshAccessOrReconnect();
}

async function gbpGetWith401Retry(
  path: string,
  access: string,
): Promise<{ ok: boolean; status: number; body: unknown; access: string }> {
  let a = access;
  let res = await gbpGet(path, a);
  if (res.status === 401) {
    const ref = await refreshAccessOrReconnect();
    if ("reconnect" in ref) {
      return { ok: false, status: 401, body: {}, access: a };
    }
    a = ref.access;
    res = await gbpGet(path, a);
  }
  return { ...res, access: a };
}

function listingTitle(loc: GbpJson): string {
  const t = loc.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  const ln = loc.locationName;
  if (typeof ln === "string" && ln.trim()) return ln.trim();
  const n = loc.name;
  return typeof n === "string" ? n : "Location";
}

export type GbpLocationInfo = {
  locationId: string;
  locationName: string;
  address: string | null;
};

export type FetchLocationsResult =
  | { ok: true; locations: GbpLocationInfo[] }
  | { ok: false; code: "not_connected" | "reconnect" | "fetch_failed"; message: string };

function extractAddress(loc: GbpJson): string | null {
  const addr = loc.address ?? loc.storefrontAddress;
  if (!addr || typeof addr !== "object") return null;
  const a = addr as GbpJson;
  const lines: string[] = [];
  for (const key of ["addressLines", "locality", "administrativeArea", "postalCode"]) {
    const v = a[key];
    if (Array.isArray(v)) lines.push(...v.filter((s) => typeof s === "string" && s.trim()));
    else if (typeof v === "string" && v.trim()) lines.push(v.trim());
  }
  return lines.length > 0 ? lines.join(", ") : null;
}

/**
 * List all GBP locations available to the connected Google account.
 * Used by the location picker — no data is synced.
 */
export async function fetchGoogleLocations(): Promise<FetchLocationsResult> {
  const token0 = await getGoogleConnectorToken("gbp");
  if (!token0) {
    return { ok: false, code: "not_connected", message: "Google is not connected." };
  }

  const ensured = await ensureAccessToken();
  if ("reconnect" in ensured) {
    return { ok: false, code: "reconnect", message: "Reconnect Google — your session expired and could not be refreshed." };
  }

  let access = ensured.access;
  const allLocations: GbpLocationInfo[] = [];

  let accountPageToken: string | undefined;
  const accountNames: string[] = [];
  for (;;) {
    const path = "/accounts" + (accountPageToken ? `?pageToken=${encodeURIComponent(accountPageToken)}` : "?pageSize=50");
    const accRes = await gbpGetWith401Retry(path, access);
    access = accRes.access;
    if (!accRes.ok) {
      const msg = gbpErrorMessage(accRes.body, accRes.status);
      return {
        ok: false,
        code: accRes.status === 401 ? "reconnect" : "fetch_failed",
        message: accRes.status === 401 ? "Reconnect Google — authorization was rejected." : `Failed to load accounts: ${msg}`,
      };
    }
    const body = accRes.body as GbpJson;
    const accounts = body.accounts;
    if (Array.isArray(accounts)) {
      for (const a of accounts) {
        if (a && typeof a === "object" && typeof (a as GbpJson).name === "string") {
          accountNames.push((a as GbpJson).name as string);
        }
      }
    }
    const npt = body.nextPageToken;
    if (typeof npt === "string" && npt) accountPageToken = npt;
    else break;
  }

  if (accountNames.length === 0) {
    return { ok: true, locations: [] };
  }

  for (const accountName of accountNames) {
    let locPageToken: string | undefined;
    for (;;) {
      const locPath = `/${accountName}/locations` + (locPageToken ? `?pageToken=${encodeURIComponent(locPageToken)}` : "?pageSize=50");
      const locRes = await gbpGetWith401Retry(locPath, access);
      access = locRes.access;
      if (!locRes.ok) {
        log.warn("GBP locations.list failed during location fetch", { accountName, status: locRes.status });
        break;
      }
      const lb = locRes.body as GbpJson;
      const locs = lb.locations;
      if (Array.isArray(locs)) {
        for (const L of locs) {
          if (!L || typeof L !== "object") continue;
          const loc = L as GbpJson;
          const name = loc.name;
          if (typeof name !== "string" || !name) continue;
          allLocations.push({
            locationId: name,
            locationName: listingTitle(loc),
            address: extractAddress(loc),
          });
        }
      }
      const lnpt = lb.nextPageToken;
      if (typeof lnpt === "string" && lnpt) locPageToken = lnpt;
      else break;
    }
  }

  return { ok: true, locations: allLocations };
}

/**
 * Pull reviews from the operator's selected GBP location and merge
 * into `.data/local-reviews.json`. Preserves manual rows (dedupe by id).
 * Requires `selected_location_id` on the Google token — returns `no_location` otherwise.
 */
export async function runGoogleReviewsSync(): Promise<GoogleReviewsSyncResult> {
  const token0 = await getGoogleConnectorToken("gbp");
  if (!token0) {
    return {
      ok: false,
      code: "not_connected",
      message: "Google is not connected. Connect Google in Settings first.",
    };
  }

  const locationId = token0.selected_location_id;
  const locationName = token0.selected_location_name ?? "Location";

  if (!locationId) {
    return {
      ok: false,
      code: "no_location",
      message:
        "Select a location before syncing — use the location picker in Settings → Connectors.",
    };
  }

  const ensured = await ensureAccessToken();
  if ("reconnect" in ensured) {
    return {
      ok: false,
      code: "reconnect",
      message:
        "Reconnect Google — your session expired and could not be refreshed.",
    };
  }

  let access = ensured.access;
  const warnings: string[] = [];
  let partial = false;
  const mapped: LocalReview[] = [];
  let rejected = 0;

  let revPageToken: string | undefined;
  for (;;) {
    const revPath =
      `/${locationId}/reviews?pageSize=50` +
      (revPageToken ? `&pageToken=${encodeURIComponent(revPageToken)}` : "");
    const revRes = await gbpGetWith401Retry(revPath, access);
    access = revRes.access;
    if (!revRes.ok) {
      if (revRes.status === 401) {
        return {
          ok: false,
          code: "reconnect",
          message: "Reconnect Google — authorization was rejected.",
        };
      }
      partial = true;
      warnings.push(
        `Partial fetch for ${locationName}: HTTP ${revRes.status} ${gbpErrorMessage(revRes.body, revRes.status)}`,
      );
      log.warn("GBP reviews.list partial failure", { location: locationId, status: revRes.status });
      break;
    }
    const rb = revRes.body as GbpJson;
    const reviews = rb.reviews;
    if (Array.isArray(reviews)) {
      for (const raw of reviews) {
        const m = mapGbpReviewToLocalReview(raw, {
          listingTitle: locationName,
          locationName: locationId,
        });
        if (m.ok) mapped.push(m.row);
        else {
          rejected += 1;
          log.debug("GBP review row rejected", { reason: m.reason });
        }
      }
    }
    const rnpt = rb.nextPageToken;
    if (typeof rnpt === "string" && rnpt) revPageToken = rnpt;
    else break;
  }

  const imported = mapped.length;

  try {
    await mergeUpsertLocalReviews(mapped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("mergeUpsertLocalReviews failed after GBP fetch", { msg });
    return {
      ok: false,
      code: "sync_failed",
      message: `Sync failed while saving reviews: ${msg}`,
    };
  }

  const completedAt = now();
  await updateConnectorToken("google_gbp", { last_synced_at: completedAt });

  await appendConnectorReviewsImportRun({
    source_system: "connector:google",
    idPrefix: "gbp",
    imported,
    skipped: rejected,
    warnings,
    errors: partial ? ["partial_fetch"] : [],
  });

  safeRevalidatePath("/settings/connectors");
  safeRevalidatePath("/local");
  safeRevalidatePath("/prompts");
  safeRevalidatePath("/", "layout");

  log.info("GBP reviews sync completed", {
    imported,
    rejected,
    partial,
    warningCount: warnings.length,
  });

  return {
    ok: true,
    imported,
    rejected,
    partial,
    warnings,
  };
}

function gbpErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const err = (body as GbpJson).error;
    if (err && typeof err === "object") {
      const msg = (err as GbpJson).message;
      if (typeof msg === "string") return `${status}: ${msg}`;
    }
  }
  return `${status}`;
}
