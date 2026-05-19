/**
 * Google OAuth callback —
 * connector-tokens-supabase-and-gsc-scope-split (2026-05-16).
 *  (Extended 2026-05-18 — Slice 9.A1 — GA4 kind.)
 *
 * Decodes + validates the signed state, exchanges the code for tokens,
 * and stores the result in Supabase under the provider key matching the
 * state's connector kind:
 *   • kind="gsc" → provider "google_gsc"
 *   • kind="gbp" → provider "google_gbp"
 *   • kind="ga4" → provider "google_ga4"
 *
 * Failure modes (all redirect to /settings/connectors?error=<code>):
 *   • Google denied consent           → ?error=access_denied
 *   • Callback missing code           → ?error=no_code
 *   • Missing state                   → ?error=invalid_state
 *   • Tampered / malformed state      → ?error=invalid_state
 *   • Expired state                   → ?error=invalid_state
 *   • Token exchange threw            → ?error=exchange_failed
 *   • Token persistence threw         → ?error=persistence_failed
 *
 * Success: ?connected=<provider> so the Settings UI can show the
 * correct success copy per provider.
 */

import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { saveConnectorToken } from "@/lib/connector-store";
import {
  exchangeGoogleCode,
  decodeOAuthState,
} from "@/lib/connectors/google-auth";

const SETTINGS_PATH = "/settings/connectors";

function settingsRedirect(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const origin = new URL(request.url).origin;
  const qs = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${origin}${SETTINGS_PATH}?${qs}`);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const rawState = url.searchParams.get("state");

  if (error) {
    log.warn("Google OAuth denied by user", { error });
    return settingsRedirect(request, { error: "access_denied" });
  }

  if (!code) {
    log.warn("Google OAuth callback missing code parameter");
    return settingsRedirect(request, { error: "no_code" });
  }

  const stateResult = decodeOAuthState(rawState);
  if (!stateResult.ok) {
    log.warn("Google OAuth callback rejected state", {
      reason: stateResult.reason,
    });
    return settingsRedirect(request, { error: "invalid_state" });
  }

  const { k: kind, t: tenantId } = stateResult.payload;
  const provider: "google_gsc" | "google_gbp" | "google_ga4" =
    kind === "gsc"
      ? "google_gsc"
      : kind === "gbp"
        ? "google_gbp"
        : "google_ga4";

  let tokens;
  try {
    tokens = await exchangeGoogleCode(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Google OAuth token exchange failed", {
      provider,
      error: msg.slice(0, 500),
    });
    return settingsRedirect(request, { error: "exchange_failed" });
  }

  if (!tokens.refresh_token) {
    log.warn(
      "Google did not return a refresh token — user may need to re-authorize with prompt=consent",
      { provider },
    );
  }

  try {
    await saveConnectorToken(
      {
        provider,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? "",
        expires_at: Date.now() + tokens.expires_in * 1000,
        connected_at: new Date().toISOString(),
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
      },
      tenantId,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Google OAuth token persistence failed", {
      provider,
      tenantId,
      error: msg.slice(0, 500),
    });
    return settingsRedirect(request, { error: "persistence_failed" });
  }

  log.info("Google connector authorized", {
    provider,
    tenantId,
    expiresIn: tokens.expires_in,
    hasRefresh: !!tokens.refresh_token,
  });

  return settingsRedirect(request, { connected: provider });
}
