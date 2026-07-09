/**
 * Google service-account auth path (OAUTH_ROOT_CAUSE_2026-07-09).
 *
 * WHY: GA4 / GSC reads used to depend on a per-user OAuth refresh token. On an
 * unverified sensitive-scope OAuth app Google keeps the 7-day refresh-token
 * expiry, so those grants die every few days and the operator has to reconnect
 * (which, via the refresh-token cap, kills yet another connector). A Google
 * SERVICE ACCOUNT has no such expiry: it self-signs a short-lived JWT and
 * exchanges it for a 1-hour access token, forever, with zero human re-consent.
 *
 * This module is the service-account access-token minter. It is used FIRST at
 * every GSC/GA4 read acquisition point; when the env is absent it returns null
 * and the caller falls through to the existing OAuth path byte-identically.
 *
 * Env:
 *   • GOOGLE_SERVICE_ACCOUNT_EMAIL         — the SA client email (`iss`)
 *   • GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   — the SA RSA private key (PEM). May
 *     carry literal "\n" sequences (single-line Vercel / .env value); those are
 *     normalized to real newlines before signing.
 *
 * NO new npm dependency: the JWT is built + RS256-signed with node:crypto
 * `createSign("RSA-SHA256")`.
 *
 * Fail-soft by contract: any error (missing env, unparseable key, non-2xx from
 * the token endpoint, missing access_token) returns null with exactly ONE
 * `log.warn` — never the key, never the signed assertion, never the token.
 */

import "server-only";

import { createSign } from "node:crypto";

import { log } from "@/lib/logger";

/** Google's OAuth 2.0 token endpoint (also the JWT `aud`). */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** RFC 7523 JWT-bearer grant. */
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Refresh a cached token this long BEFORE its real expiry, so a token never
 *  goes stale mid-request. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

type CacheEntry = { token: string; expiresAtMs: number };
/** In-process cache, PER SCOPE. Two scopes (GSC / GA4) → two entries; each is
 *  reused until 5 minutes before it expires. */
const tokenCache = new Map<string, CacheEntry>();

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalize a PEM private key read from an env var. Env stores frequently hold
 * the key on a single line with literal "\n" (two characters) instead of real
 * newlines, and sometimes wrap the whole value in quotes. Convert both so the
 * PEM parses. Pure; never logged.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  // Literal backslash-n → real newline.
  return key.replace(/\\n/g, "\n");
}

/**
 * Build the JWT claim set for a service-account token request. `iat` is derived
 * from `nowMs`; the token is valid for one hour (`exp = iat + 3600`), Google's
 * maximum. `aud` is the token endpoint. Pure; exported for tests.
 */
export function buildServiceAccountJwtClaims(
  email: string,
  scope: string,
  nowMs: number,
): { iss: string; scope: string; aud: string; iat: number; exp: number } {
  const iat = Math.floor(nowMs / 1000);
  return {
    iss: email,
    scope,
    aud: TOKEN_ENDPOINT,
    iat,
    exp: iat + 3600,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Assemble + RS256-sign the service-account JWT. Never logged. */
function signServiceAccountJwt(
  email: string,
  privateKeyPem: string,
  scope: string,
  nowMs: number,
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = buildServiceAccountJwtClaims(email, scope, nowMs);
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/** True when both service-account env vars are present and non-empty. */
export function isServiceAccountConfigured(): boolean {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  return (
    typeof email === "string" &&
    email.trim() !== "" &&
    typeof key === "string" &&
    key.trim() !== ""
  );
}

/**
 * Mint (or reuse a cached) service-account access token for `scope`. Returns the
 * bearer token string, or null on ANY failure (env absent, key unparseable,
 * token endpoint non-2xx, missing access_token). A null return is the signal to
 * the caller to fall through to its existing OAuth path.
 *
 * Cache: per scope, reused until `EXPIRY_SKEW_MS` before the token's real
 * expiry, so a second call within the hour never re-hits the token endpoint.
 */
export async function getServiceAccountAccessToken(
  scope: string,
): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (
    email == null ||
    email.trim() === "" ||
    rawKey == null ||
    rawKey.trim() === ""
  ) {
    return null;
  }

  const nowMs = Date.now();
  const cached = tokenCache.get(scope);
  if (cached != null && cached.expiresAtMs - EXPIRY_SKEW_MS > nowMs) {
    return cached.token;
  }

  try {
    const privateKey = normalizePrivateKey(rawKey);
    const assertion = signServiceAccountJwt(email.trim(), privateKey, scope, nowMs);
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: JWT_BEARER_GRANT,
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      log.warn(
        "[google-service-account] token endpoint non-2xx; falling back to OAuth",
        { scope, status: res.status },
      );
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (
      data == null ||
      typeof data.access_token !== "string" ||
      data.access_token === ""
    ) {
      log.warn(
        "[google-service-account] token response missing access_token; falling back to OAuth",
        { scope },
      );
      return null;
    }
    const expiresInSec =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : 3600;
    tokenCache.set(scope, {
      token: data.access_token,
      expiresAtMs: nowMs + expiresInSec * 1000,
    });
    return data.access_token;
  } catch (e) {
    log.warn(
      "[google-service-account] failed to mint access token; falling back to OAuth",
      { scope, error: e instanceof Error ? e.message : String(e) },
    );
    return null;
  }
}

/** Test-only internals. Mirrors the connector `__testing` convention. */
export const __testing = {
  TOKEN_ENDPOINT,
  JWT_BEARER_GRANT,
  EXPIRY_SKEW_MS,
  tokenCache,
  clearCache: () => tokenCache.clear(),
  base64url,
  signServiceAccountJwt,
};
