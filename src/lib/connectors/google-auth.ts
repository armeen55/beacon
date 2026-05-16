/**
 * Google OAuth 2.0 helpers for GBP connector (Track 1.4e).
 * Server-only — never imported from client components.
 *
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 * Optional: NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
 */

import "server-only";

import { log } from "@/lib/logger";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * GBP scope — `business.manage` is the only available scope for GBP review
 * read access. Despite the name, the connector uses read-only operations.
 * No write API calls are made — enforced at the application layer (§5.1 of
 * the 1.4e spec: pull-only).
 */
const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

/**
 * GSC scope (A.3.b1.alpha, 2026-05-16) — `webmasters.readonly` is the
 * read-only scope for the Search Console URL Inspection + Search
 * Analytics APIs. The GSC client lives at
 * `src/lib/connectors/gsc/client.ts` and is currently NOT wired into
 * the indexability compute or any customer surface (A.3.b1.beta lands
 * that). Requesting the scope from day 1 means a single operator
 * consent grants both APIs; no re-consent later.
 */
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * Combined OAuth scope string. Google's OAuth contract takes a single
 * space-separated value; both scopes appear on the consent screen and
 * the issued token's `scopes` array carries both.
 */
const GOOGLE_OAUTH_SCOPES = `${GBP_SCOPE} ${GSC_SCOPE}`;

export const GOOGLE_CALLBACK_PATH = "/api/connectors/google/callback";

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return secret;
}

export function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

export function buildGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  if (state) params.set("state", state);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error("Google token exchange failed", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Google token exchange failed (${res.status})`);
  }

  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error("Google token refresh failed", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Google token refresh failed (${res.status})`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  return { access_token: data.access_token, expires_in: data.expires_in };
}
