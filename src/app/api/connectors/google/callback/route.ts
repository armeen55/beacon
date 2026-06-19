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
 *
 * Degraded success (#90): ?connected=<provider>&warning=missing_refresh_token
 * when Google returned no refresh token — the grant works now but WILL die
 * and can't self-heal, so the UI shows a reconnect warning, not a clean
 * "connected successfully".
 */

import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { saveConnectorToken } from "@/lib/connector-store";
import {
  exchangeGoogleCode,
  decodeOAuthState,
} from "@/lib/connectors/google-auth";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isOperatorModeServer } from "@/lib/operator-mode";

/**
 * Night-shift hardening (2026-06-11): the signed state carries the
 * tenantId chosen at connect-initiation. The middleware already blocks
 * unauthenticated access to this route, and the state is HMAC-signed
 * (so the tenantId isn't attacker-forgeable) — but nothing previously
 * confirmed the signed-in user is a MEMBER of the state's tenant before
 * writing a connector token there via the service-role client.
 * Defense-in-depth: verify membership, fail-closed.
 */
async function callerIsMemberOfTenant(tenantId: string): Promise<boolean> {
  // Operator god-view: on the auth bypass / operator mode there's no Supabase
  // user, so the membership lookup below always fails and blocks the founder
  // from connecting their own sources. The OAuth `state` is HMAC-signed, so
  // the tenantId can't be forged — operator mode is the trusted founder
  // context. Customers never run in operator mode, so they still go through
  // the membership check.
  if (isOperatorModeServer()) return true;
  try {
    const supabase = await getSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return false;
    const { data, error } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

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

  // Defense-in-depth (2026-06-11): the signed-in user must be a member
  // of the state's tenant before we write a connector token there.
  if (!(await callerIsMemberOfTenant(tenantId))) {
    log.warn("Google OAuth callback rejected: caller not a member of state tenant", {
      tenantId,
    });
    return settingsRedirect(request, { error: "not_authorized" });
  }

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

  // #90 (2026-06-14) — a token grant with NO refresh_token is guaranteed to
  // die once the short-lived access token expires (and cannot self-heal),
  // even though the auth URL already requests access_type=offline +
  // prompt=consent. This happens when the user previously granted offline
  // access on an OLD consent (Google then omits the refresh token on
  // re-consent for the same client) or revoked it externally. Reporting a
  // clean "connected successfully" here is dishonest — surface a WARNING that
  // tells the owner to reconnect so a fresh refresh token is issued.
  if (!tokens.refresh_token) {
    return settingsRedirect(request, {
      connected: provider,
      warning: "missing_refresh_token",
    });
  }

  return settingsRedirect(request, { connected: provider });
}
