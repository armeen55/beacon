/**
 * Google OAuth 2.0 helpers — connector-tokens-supabase-and-gsc-scope-split
 * (2026-05-16; extended 2026-05-18 for Slice 9.A1 — GA4 kind).
 *
 * Server-only — never imported from client components.
 *
 * SCOPE SPLIT (locked):
 *   This module no longer requests multiple scopes in a single OAuth
 *   flow. Each `buildGoogleAuthUrl(kind, ...)` call requests exactly
 *   one scope set:
 *     • kind="gsc" → webmasters.readonly only
 *     • kind="gbp" → business.manage only
 *     • kind="ga4" → analytics.readonly only      (Slice 9.A1 — read-only
 *                                                  GA4 + Analytics Admin)
 *
 *   Why: requesting multiple scopes forces broader permissions onto a
 *   single consent screen than the connector needs. The per-grant
 *   model matches Google's own authorization shape (refresh tokens
 *   are bound to the scopes granted at consent). A GA4-only operator
 *   never has to grant GSC or GBP permissions to enable Analytics.
 *
 * SIGNED STATE (locked):
 *   Every auth URL carries a signed `state` parameter encoding:
 *     • k — connector kind ("gsc" | "gbp" | "ga4")
 *     • t — tenantId at request time
 *     • n — random nonce
 *     • i — issued-at unix-ms (for sanity TTL)
 *
 *   Signature: HMAC-SHA256 of the canonical payload string with
 *   `BEACON_OAUTH_STATE_SECRET`. Callback verifies before persisting.
 *   Tampered or missing state → callback fails fast with
 *   `?error=invalid_state`, no token write.
 *
 * Requires env vars:
 *   • GOOGLE_CLIENT_ID
 *   • GOOGLE_CLIENT_SECRET
 *   • BEACON_OAUTH_STATE_SECRET
 *
 * Optional: NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
 */

import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { log } from "@/lib/logger";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** GSC read scope. Used for both URL Inspection + Search Analytics APIs. */
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * GBP scope. Despite the name, the connector uses read-only operations
 * (review fetch, location list). No write API calls are made — enforced
 * at the application layer (Section 7 lock: pull-only).
 */
const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

/**
 * GA4 read scope (Slice 9.A1, 2026-05-18). Grants read-only access to
 * the Google Analytics Admin API (`accountSummaries.list`) AND the
 * Data API; Slice 9.A1 uses ONLY the Admin API to list properties
 * during the property-picker flow. Data API usage lands in a future
 * slice (9.A2 — Mode A outcome attribution).
 */
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** Per-kind single scope. Each OAuth flow requests exactly one. */
const SCOPES: Record<GoogleConnectorKind, string> = {
  gsc: GSC_SCOPE,
  gbp: GBP_SCOPE,
  ga4: GA4_SCOPE,
};

export type GoogleConnectorKind = "gsc" | "gbp" | "ga4";

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

function getStateSecret(): string {
  const secret = process.env.BEACON_OAUTH_STATE_SECRET;
  if (!secret) throw new Error("BEACON_OAUTH_STATE_SECRET is not set");
  return secret;
}

export function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

// ─────────────────────────────────────────────────────────────────────
// Signed OAuth state
// ─────────────────────────────────────────────────────────────────────

export type OAuthStatePayload = {
  /** Connector kind: "gsc" | "gbp" | "ga4". */
  k: GoogleConnectorKind;
  /** Tenant id at request time. */
  t: string;
  /** Random nonce. */
  n: string;
  /** Issued-at unix-ms. */
  i: number;
};

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalized, "base64");
}

function signStatePayload(payloadJson: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadJson).digest("hex");
}

export function encodeOAuthState(payload: OAuthStatePayload): string {
  const secret = getStateSecret();
  const json = JSON.stringify(payload);
  const sig = signStatePayload(json, secret);
  const body = b64urlEncode(Buffer.from(json, "utf-8"));
  return `${body}.${sig}`;
}

export type OAuthStateDecodeResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "secret_missing" };

/** Max age for a state token. OAuth flows complete in seconds; 10 min
 *  is a generous TTL to absorb network + consent-screen latency. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function decodeOAuthState(raw: string | null | undefined): OAuthStateDecodeResult {
  if (raw == null || raw === "") return { ok: false, reason: "missing" };
  let secret: string;
  try {
    secret = getStateSecret();
  } catch {
    return { ok: false, reason: "secret_missing" };
  }
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === raw.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const body = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);

  let json: string;
  try {
    json = b64urlDecode(body).toString("utf-8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expectedSig = signStatePayload(json, secret);
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expBuf.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed == null || typeof parsed !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const p = parsed as Partial<OAuthStatePayload>;
  if (
    (p.k !== "gsc" && p.k !== "gbp" && p.k !== "ga4") ||
    typeof p.t !== "string" ||
    typeof p.n !== "string" ||
    typeof p.i !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() - p.i > STATE_MAX_AGE_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload: { k: p.k, t: p.t, n: p.n, i: p.i } };
}

// ─────────────────────────────────────────────────────────────────────
// Auth URL construction
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a Google OAuth consent URL for the given connector kind.
 *
 * The auth URL requests exactly ONE scope (the scope mapped to `kind`).
 * State is REQUIRED — pass a signed state produced by `encodeOAuthState`.
 * The callback validates the state and persists the token under the
 * provider key matching the kind:
 *   • kind="gsc" → provider "google_gsc"
 *   • kind="gbp" → provider "google_gbp"
 *   • kind="ga4" → provider "google_ga4"
 */
export function buildGoogleAuthUrl(kind: GoogleConnectorKind, state: string): string {
  if (state == null || state === "") {
    throw new Error("buildGoogleAuthUrl: state parameter is required");
  }
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES[kind],
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────
// Token exchange + refresh (unchanged from prior posture)
// ─────────────────────────────────────────────────────────────────────

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

/** Random nonce helper for OAuth state. */
export function generateOAuthNonce(): string {
  return randomBytes(16).toString("hex");
}
