/**
 * Google OAuth access-token expiry classifier plus the "last refreshed" copy the Connections cards show.
 *
 * `fresh` means the access token is still usable (more than the 60s buffer before `expires_at`); `stale` means the caller must refresh it through the stored refresh token. There is deliberately NO idle cutoff: Google
 * refresh tokens do not die because the access token sat expired for a week, and the old 7 day refusal (2026-05-18 to 2026-09-14) left an idle grant unrefreshable without a single HTTP call, so the card said the
 * connection was fine while every sync returned token_expired. Only Google's own invalid_grant answer proves a grant dead, and the sync paths stamp auth_failed_at on it.
 *
 * Pure: no I/O, no logging, no clock reads. Deterministic on input.
 */

import "server-only";

import type { GoogleConnectorToken } from "@/lib/connector-store";

type ExpiryStatus = "fresh" | "stale";

/** A token within 60s of its `expires_at` counts as stale so the refresh completes before the token dies mid-request. */
const REFRESH_BUFFER_MS = 60_000;

/** `fresh` while `now < expires_at - 60s`; `stale` otherwise, including a token with no usable `expires_at`. */
export function evaluateExpiry(args: {
  token: GoogleConnectorToken;
  now: Date | number;
}): ExpiryStatus {
  const { token } = args;
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  if (typeof token.expires_at !== "number" || !Number.isFinite(token.expires_at)) {
    return "stale";
  }
  return nowMs < token.expires_at - REFRESH_BUFFER_MS ? "fresh" : "stale";
}

/** Card copy for a soft-disconnected source that still holds cached data: how old the last pull is and the one next step. Pure formatting. */
export function formatLastRefreshedCopy(args: {
  source: "Search Console" | "Google Analytics";
  lastSyncedMs: number;
  now: Date | number;
}): string {
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  const days = Math.floor(Math.max(0, nowMs - args.lastSyncedMs) / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return `${args.source} data last refreshed less than a day ago.`;
  }
  return `${args.source} data last refreshed ${days} day${days === 1 ? "" : "s"} ago. Reconnect to refresh.`;
}
