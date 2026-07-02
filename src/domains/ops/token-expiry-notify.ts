import "server-only";

/**
 * token-expiry-notify (BEACON_500 item 84, 2026-07-03) - the nightly Google
 * refresh-token expiry check. For each tenant's connected Google providers
 * (GSC / GA4 / GBP), computes days-until-Testing-mode-expiry from the
 * connection's connected_at, and at T-2 days sends ONE email via the
 * EXISTING resend.ts channel to the single configured operator inbox
 * (BEACON_DIGEST_TO - this is a single-operator app; there is no per-tenant
 * operator-email field, see resolveEmailConfig in resend.ts).
 *
 * SAFETY CONTRACT (matches send-pitch.ts's posture for outreach):
 *   - This is a NOTIFICATION to the account owner on an already-established
 *     channel, never outreach. It NEVER emails anyone but the configured
 *     operator inbox.
 *   - Never sends when no operator email is configured - skip and log
 *     honestly (`not_configured`), no throw, no retry storm.
 *   - Deduped to at most one warning per (tenant, provider) per expiry cycle
 *     via token-expiry-warning-store.ts, keyed on the connection's
 *     connected_at so a reconnect naturally opens a fresh cycle.
 *   - Fail-soft throughout: every step (connector read, forecast, dedupe
 *     check, send, dedupe write) is isolated so one tenant's/provider's
 *     failure can never break the loop or the sync it rides inside.
 */

import { getConnectorInfo } from "@/lib/connector-store";
import { sendEmail } from "@/lib/email/resend";
import { log } from "@/lib/logger";
import {
  buildExpiryForecast,
  buildExpiryWarningEmail,
  type ExpiryForecast,
  type GoogleProviderKind,
} from "./token-expiry-forecast";
import { alreadyWarnedThisCycle, recordWarningSent } from "./token-expiry-warning-store";

const GOOGLE_PROVIDERS: readonly GoogleProviderKind[] = ["google_gsc", "google_ga4", "google_gbp"];

const RECONNECT_URL = "/settings/connectors";

export type TokenExpiryCheckResult = {
  tenantId: string;
  provider: GoogleProviderKind;
  connected: boolean;
  daysUntilExpiry: number | null;
  action: "no_connection" | "not_due" | "already_warned" | "sent" | "skipped_not_configured" | "send_failed";
  detail?: string;
};

/**
 * Absolute URL for the reconnect deep link when a public base URL is
 * configured; otherwise the relative path (still usable if the operator
 * opens the email on the same host, and honest - Beacon never invents a
 * domain it doesn't know). Mirrors the convention other email builders in
 * this codebase use for links (best-effort absolute, relative fallback).
 */
function reconnectDeepLink(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.NEXT_PUBLIC_APP_URL?.trim() || env.VERCEL_URL?.trim();
  if (!base) return RECONNECT_URL;
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin.replace(/\/$/, "")}${RECONNECT_URL}`;
}

/** Check + (maybe) warn for ONE (tenant, provider). Never throws. */
async function checkOneProvider(
  tenantId: string,
  provider: GoogleProviderKind,
  now: Date,
): Promise<TokenExpiryCheckResult> {
  let info;
  try {
    info = await getConnectorInfo(provider, tenantId);
  } catch (e) {
    log.warn("[token-expiry-notify] connector read failed", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    return { tenantId, provider, connected: false, daysUntilExpiry: null, action: "no_connection" };
  }

  if (info.status !== "connected" || !info.connected_at) {
    return { tenantId, provider, connected: false, daysUntilExpiry: null, action: "no_connection" };
  }

  let forecast: ExpiryForecast;
  try {
    forecast = buildExpiryForecast(tenantId, provider, info.connected_at, now, info.last_synced_at ?? null);
  } catch (e) {
    log.warn("[token-expiry-notify] forecast failed", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    return { tenantId, provider, connected: true, daysUntilExpiry: null, action: "no_connection" };
  }

  if (!forecast.shouldWarn) {
    return {
      tenantId,
      provider,
      connected: true,
      daysUntilExpiry: forecast.daysUntilExpiry,
      action: "not_due",
    };
  }

  try {
    if (await alreadyWarnedThisCycle(tenantId, provider, info.connected_at)) {
      return {
        tenantId,
        provider,
        connected: true,
        daysUntilExpiry: forecast.daysUntilExpiry,
        action: "already_warned",
      };
    }
  } catch (e) {
    // Fail-soft toward SENDING rather than silently skipping a real warning
    // (a duplicate email is far cheaper than a missed one); log so the dedupe
    // read failure is visible.
    log.warn("[token-expiry-notify] dedupe check failed, proceeding to send", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const email = buildExpiryWarningEmail(forecast, reconnectDeepLink());
  const result = await sendEmail({ to: resolveOperatorTo(), subject: email.subject, text: email.text });
  if (!result.sent) {
    if (result.reason === "not_configured") {
      log.info("[token-expiry-notify] skipped - operator email not configured", {
        tenantId,
        provider,
        missing: result.missing,
      });
      return {
        tenantId,
        provider,
        connected: true,
        daysUntilExpiry: forecast.daysUntilExpiry,
        action: "skipped_not_configured",
        detail: result.missing.join(", "),
      };
    }
    log.warn("[token-expiry-notify] send failed", { tenantId, provider, detail: result.detail });
    return {
      tenantId,
      provider,
      connected: true,
      daysUntilExpiry: forecast.daysUntilExpiry,
      action: "send_failed",
      detail: result.detail,
    };
  }

  await recordWarningSent(tenantId, provider, info.connected_at, now);
  log.info("[token-expiry-notify] warning sent", {
    tenantId,
    provider,
    daysUntilExpiry: forecast.daysUntilExpiry,
  });
  return {
    tenantId,
    provider,
    connected: true,
    daysUntilExpiry: forecast.daysUntilExpiry,
    action: "sent",
  };
}

/** resend.ts resolves the operator inbox from BEACON_DIGEST_TO internally
 *  when `to` is left to the caller - but sendEmail's contract takes an
 *  explicit `to`. This app has exactly one operator inbox (single-operator
 *  product; see resolveEmailConfig), so that IS "the tenant's configured
 *  operator email" the task spec refers to. */
function resolveOperatorTo(env: NodeJS.ProcessEnv = process.env): string {
  return env.BEACON_DIGEST_TO?.trim() ?? "";
}

/**
 * Nightly entry point: check every Google provider for every given tenant.
 * Fail-soft per (tenant, provider) - one failure never stops the rest.
 */
export async function checkTokenExpiryForTenants(
  tenantIds: readonly string[],
  now: Date = new Date(),
): Promise<TokenExpiryCheckResult[]> {
  const to = resolveOperatorTo();
  if (!to) {
    log.info("[token-expiry-notify] no operator email configured (BEACON_DIGEST_TO unset) - skipping all checks");
    return tenantIds.flatMap((tenantId) =>
      GOOGLE_PROVIDERS.map((provider) => ({
        tenantId,
        provider,
        connected: false,
        daysUntilExpiry: null,
        action: "skipped_not_configured" as const,
        detail: "BEACON_DIGEST_TO",
      })),
    );
  }

  const results: TokenExpiryCheckResult[] = [];
  for (const tenantId of tenantIds) {
    for (const provider of GOOGLE_PROVIDERS) {
      try {
        results.push(await checkOneProvider(tenantId, provider, now));
      } catch (e) {
        log.warn("[token-expiry-notify] provider check threw", {
          tenantId,
          provider,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return results;
}
