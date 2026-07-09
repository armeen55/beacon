/**
 * Google OAuth callback,
 * connector-tokens-supabase-and-gsc-scope-split (2026-05-16).
 *  (Extended 2026-05-18, Slice 9.A1, GA4 kind.)
 *  (Per-tenant OAuth hardening 2026-07-09: never-erase guard, account
 *   identity, replace semantics.)
 *
 * Decodes + validates the signed state, exchanges the code for tokens,
 * and stores the result in Supabase under the provider key matching the
 * state's connector kind:
 *   • kind="gsc" → provider "google_gsc"
 *   • kind="gbp" → provider "google_gbp"
 *   • kind="ga4" → provider "google_ga4"
 *
 * ACCOUNT IDENTITY (2026-07-09): every auth URL now requests the basic
 * openid + email identity scopes alongside the single data scope, so the
 * token exchange returns an id_token. Its sub + email are persisted on the
 * token payload (google_account_sub / google_account_email) and power both
 * the "Connected as <email>" card line and the same-account check below.
 *
 * NEVER-ERASE GUARD (2026-07-09): Google omits the refresh_token on
 * re-consent for an already-granted client. saveConnectorToken is a
 * full-row upsert, so writing "" would OVERWRITE a previously-working
 * refresh token and permanently brick the grant. When the exchange returns
 * no refresh token:
 *   • Stored non-empty refresh token + PROVABLY the same Google account
 *     (id_token sub equals the stored sub) → retain the stored refresh
 *     token and refresh everything else.
 *   • Stored read failed, stored token empty/missing, or the account can't
 *     be proven the same → NO WRITE AT ALL; redirect with an explicit
 *     error state telling the operator exactly what to do. A soft-failed
 *     read must never be treated as "nothing stored".
 *
 * REPLACE SEMANTICS (2026-07-09): an explicit "Replace Google account"
 * (state intent x="replace") that gets a refresh token overwrites the row
 * fully (new refresh token, new sub/email, auth_failed_at cleared by the
 * fresh payload). A replace that gets NO refresh token for a DIFFERENT sub
 * is rejected with ?error=account_mismatch; the old account's refresh
 * token is never silently re-labeled as the "replaced" account's.
 *
 * Failure modes (all redirect to /settings/connectors?error=<code>):
 *   • Google denied consent           → ?error=access_denied
 *   • Callback missing code           → ?error=no_code
 *   • Missing state                   → ?error=invalid_state
 *   • Tampered / malformed state      → ?error=invalid_state
 *   • Expired state                   → ?error=invalid_state
 *   • Token exchange threw            → ?error=exchange_failed
 *   • Token persistence threw         → ?error=persistence_failed
 *   • No refresh token, unsafe to keep the old one
 *                                     → ?error=refresh_token_missing
 *   • No refresh token + a DIFFERENT account than the grant we hold
 *                                     → ?error=account_mismatch
 *
 * Success: ?connected=<provider> so the Settings UI can show the
 * correct success copy per provider. (The old degraded-success
 * ?warning=missing_refresh_token path is gone: a grant with no usable
 * refresh token is now never written at all.)
 */

import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import {
  saveConnectorToken,
  readConnectorToken,
  type GoogleConnectorToken,
} from "@/lib/connector-store";
import {
  exchangeGoogleCode,
  decodeOAuthState,
  decodeGoogleIdToken,
} from "@/lib/connectors/google-auth";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isOperatorModeServer } from "@/lib/operator-mode";

/**
 * Night-shift hardening (2026-06-11): the signed state carries the
 * tenantId chosen at connect-initiation. The middleware already blocks
 * unauthenticated access to this route, and the state is HMAC-signed
 * (so the tenantId isn't attacker-forgeable), but nothing previously
 * confirmed the signed-in user is a MEMBER of the state's tenant before
 * writing a connector token there via the service-role client.
 * Defense-in-depth: verify membership, fail-closed.
 */
async function callerIsMemberOfTenant(tenantId: string): Promise<boolean> {
  // Operator god-view: on the auth bypass / operator mode there's no Supabase
  // user, so the membership lookup below always fails and blocks the founder
  // from connecting their own sources. The OAuth `state` is HMAC-signed, so
  // the tenantId can't be forged; operator mode is the trusted founder
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
  // Intent from the signed state (per-tenant OAuth, 2026-07-09):
  // connect | replace | reauth. Legacy/absent decodes as "connect".
  const intent = stateResult.payload.x ?? "connect";

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
    // Surface Google's actual error code so the operator fixes the RIGHT thing
    // (e.g. invalid_client = wrong CLIENT_SECRET; redirect_uri_mismatch = the
    // domain's callback URL isn't registered in Google Cloud Console).
    const m = msg.match(
      /(invalid_client|redirect_uri_mismatch|invalid_grant|unauthorized_client|invalid_request)/,
    );
    return settingsRedirect(
      request,
      m ? { error: "exchange_failed", detail: m[1]! } : { error: "exchange_failed" },
    );
  }

  // Account identity from the id_token (present because the auth URL requests
  // openid + email). Decoded WITHOUT JWT signature verification because this
  // id_token arrived over our own TLS server-to-server exchange with Google's
  // token endpoint (see decodeGoogleIdToken's doc comment for why that is
  // sufficient). Null on older or malformed responses; identity then simply
  // stays unknown for this grant.
  const identity = decodeGoogleIdToken(tokens.id_token);

  // Read the stored token ONCE via the discriminated read. Both branches
  // below need it: the never-erase guard when the exchange lacks a refresh
  // token, and the same-account carry-over of convenience fields (GA4
  // property, GBP location, last sync) when it has one.
  const storedRead = await readConnectorToken(provider, tenantId);
  const stored: GoogleConnectorToken | null =
    storedRead.ok &&
    storedRead.token != null &&
    (storedRead.token.provider === "google_gsc" ||
      storedRead.token.provider === "google_gbp" ||
      storedRead.token.provider === "google_ga4")
      ? storedRead.token
      : null;
  const sameAccountAsStored =
    identity != null &&
    stored?.google_account_sub != null &&
    stored.google_account_sub !== "" &&
    identity.sub === stored.google_account_sub;

  let refreshToken = tokens.refresh_token ?? "";
  let connectedAt = new Date().toISOString();

  if (!refreshToken) {
    // NEVER-ERASE GUARD (2026-07-09). Google returned no refresh token; the
    // ONLY safe write is retaining a stored non-empty refresh token that
    // PROVABLY belongs to the same Google account. Every other case aborts
    // with no write of any kind (saveConnectorToken additionally refuses a
    // blank refresh_token over a stored non-empty one, as defense in depth).
    if (!storedRead.ok) {
      // The stored state is UNKNOWN (transient read failure). We cannot
      // prove any write is safe, so nothing is written.
      log.error("Google OAuth callback aborted: no refresh token and the stored token could not be read", {
        provider,
        tenantId,
        intent,
        readFailure: storedRead.reason,
      });
      return settingsRedirect(request, { error: "refresh_token_missing" });
    }
    const storedRefreshToken =
      stored != null && stored.refresh_token ? stored.refresh_token : "";
    if (storedRefreshToken === "") {
      // Nothing usable stored. Writing "" would create a grant that dies in
      // about an hour with no self-heal, so store nothing and tell the
      // operator exactly how to make Google mint a refresh token.
      log.warn("Google OAuth callback aborted: no refresh token from Google and none stored", {
        provider,
        tenantId,
        intent,
        hasIdentity: identity != null,
      });
      return settingsRedirect(request, { error: "refresh_token_missing" });
    }
    if (!sameAccountAsStored) {
      // A stored refresh token exists but we can NOT prove the new grant is
      // the same Google account (different sub, or either side's identity is
      // unknown). Keeping the old refresh token under the new grant's name
      // would silently leave the OLD account connected, worst on an explicit
      // replace. Abort with no write; the stored grant stays untouched.
      const differs =
        identity != null &&
        stored?.google_account_sub != null &&
        stored.google_account_sub !== "" &&
        identity.sub !== stored.google_account_sub;
      log.warn("Google OAuth callback aborted: no refresh token and the account is not provably the stored one", {
        provider,
        tenantId,
        intent,
        accountDiffers: differs,
        hasIdentity: identity != null,
        storedHasSub:
          stored?.google_account_sub != null && stored.google_account_sub !== "",
      });
      return settingsRedirect(request, {
        error: differs ? "account_mismatch" : "refresh_token_missing",
      });
    }
    // Same account, proven. Retain the stored refresh token and its original
    // connected_at (token-age diagnostics stay truthful: the retained token
    // was minted at the ORIGINAL consent, not today).
    refreshToken = storedRefreshToken;
    connectedAt = stored!.connected_at || connectedAt;
  }

  const payload: GoogleConnectorToken = {
    provider,
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + tokens.expires_in * 1000,
    connected_at: connectedAt,
    scopes: tokens.scope ? tokens.scope.split(" ") : [],
  };
  if (identity != null) {
    payload.google_account_sub = identity.sub;
    if (identity.email) payload.google_account_email = identity.email;
  }
  // Same-account carry-over: when the grant provably belongs to the SAME
  // Google account as the stored row, its per-source selections (GA4
  // property, GBP location) and sync freshness remain valid, so keep them
  // instead of forcing the operator to pick again. A replace/connect for a
  // different or unproven account starts clean: a fresh payload with no
  // carried selections and, by omission, cleared auth_failed_at and
  // disconnected_at.
  if (stored != null && sameAccountAsStored) {
    if (stored.ga4_property_id != null) payload.ga4_property_id = stored.ga4_property_id;
    if (stored.ga4_property_display_name != null) payload.ga4_property_display_name = stored.ga4_property_display_name;
    if (stored.ga4_account_display_name != null) payload.ga4_account_display_name = stored.ga4_account_display_name;
    if (stored.selected_location_id != null) payload.selected_location_id = stored.selected_location_id;
    if (stored.selected_location_name != null) payload.selected_location_name = stored.selected_location_name;
    if (stored.last_synced_at != null) payload.last_synced_at = stored.last_synced_at;
  }

  try {
    await saveConnectorToken(payload, tenantId);
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
    intent,
    expiresIn: tokens.expires_in,
    hasRefresh: !!tokens.refresh_token,
    retainedStoredRefresh: !tokens.refresh_token,
    hasIdentity: identity != null,
  });

  return settingsRedirect(request, { connected: provider });
}
