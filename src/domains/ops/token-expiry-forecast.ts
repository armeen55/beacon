import "server-only";

/**
 * token-expiry-forecast (BEACON_500 item 84, 2026-07-03).
 *
 * Google's OAuth consent screen being in "Testing" publishing status force-
 * expires refresh tokens after 7 DAYS FROM GRANT, regardless of how often the
 * access token gets refreshed in between (see the recurring incident in
 * src/lib/connectors/gsc/expiry-handler.ts's docstring + the operator's own
 * "connections die every few days" reports). `connected_at` on a
 * GoogleConnectorToken is stamped once at grant time (saveConnectorToken) and
 * is NEVER touched by the routine access-token refresh path
 * (updateConnectorToken's GoogleConnectorPatch has no connected_at field) -
 * so `connected_at` is exactly the clock this forecast needs.
 *
 * PURE arithmetic over a connected_at timestamp - no I/O here. The nightly
 * caller (cron-sync.ts) resolves each tenant's Google connections, calls
 * `daysUntilExpiry`, and decides whether to email at T-2 days.
 */

/** Google Testing-mode refresh-token absolute lifetime. */
export const TESTING_MODE_REFRESH_TOKEN_LIFETIME_DAYS = 7;

/** Send the one warning email when the forecast reaches this many days
 *  or fewer until expiry (and hasn't already warned this cycle). */
export const WARNING_THRESHOLD_DAYS = 2;

export type GoogleProviderKind = "google_gsc" | "google_ga4" | "google_gbp";

export type ExpiryForecast = {
  tenantId: string;
  provider: GoogleProviderKind;
  connectedAt: string;
  /** May be negative if already past the 7-day Testing-mode window. */
  daysUntilExpiry: number;
  /** True at or under WARNING_THRESHOLD_DAYS (including already-expired). */
  shouldWarn: boolean;
};

/** PURE. Days remaining (can be negative) until the Testing-mode 7-day
 *  refresh-token death, floored to whole days remaining (ceil so "6.9 days
 *  left" still reads as 7, and "1.1 days left" reads as 2 - never
 *  under-warns by rounding down past the threshold). */
export function daysUntilExpiry(connectedAt: string, now: Date = new Date()): number {
  const grantMs = Date.parse(connectedAt);
  if (!Number.isFinite(grantMs)) return -Infinity; // unknown grant time -> treat as already-expired
  const deathMs = grantMs + TESTING_MODE_REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
  const msRemaining = deathMs - now.getTime();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

export function buildExpiryForecast(
  tenantId: string,
  provider: GoogleProviderKind,
  connectedAt: string,
  now: Date = new Date(),
): ExpiryForecast {
  const days = daysUntilExpiry(connectedAt, now);
  return {
    tenantId,
    provider,
    connectedAt,
    daysUntilExpiry: days,
    shouldWarn: days <= WARNING_THRESHOLD_DAYS,
  };
}

const PROVIDER_PLAIN_NAME: Record<GoogleProviderKind, string> = {
  google_gsc: "Google Search Console",
  google_ga4: "Google Analytics",
  google_gbp: "Google Business Profile",
};

/** Plain-English email body. No jargon, one concrete number, one next step. */
export function buildExpiryWarningEmail(
  forecast: ExpiryForecast,
  reconnectUrl: string,
): { subject: string; text: string } {
  const name = PROVIDER_PLAIN_NAME[forecast.provider];
  const days = Math.max(0, forecast.daysUntilExpiry);
  const dayWord = days === 1 ? "day" : "days";
  return {
    subject: `Your ${name} connection needs a quick reconnect`,
    text:
      `Your ${name} connection to Beacon will stop working in about ${days} ${dayWord}. ` +
      `This happens because Google treats the sign-in as temporary until it is fully approved. ` +
      `Reconnect now so I do not lose your data: ${reconnectUrl}\n\n` +
      `It takes under a minute. Nothing else changes.`,
  };
}
