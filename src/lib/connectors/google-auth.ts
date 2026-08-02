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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

/** Per-kind single DATA scope. Each OAuth flow requests exactly one of these. */
const SCOPES: Record<GoogleConnectorKind, string> = {
  gsc: GSC_SCOPE,
  gbp: GBP_SCOPE,
  ga4: GA4_SCOPE,
};

/**
 * Basic identity scopes requested ALONGSIDE the single data scope per kind
 * (per-tenant OAuth, 2026-07-09). These are Google's standard sign-in scopes:
 * they carry no sensitive-data access and no OAuth-verification impact, and
 * they let the token response include an id_token from which we read the
 * signed-in account's stable id (sub) + email. That identity is what lets the
 * callback prove a re-consent is the SAME Google account before retaining a
 * stored refresh token, and lets the connector card show "Connected as <email>".
 * The least-privilege DATA scopes stay separate per kind and are NEVER bundled
 * with each other; only these two universal identity scopes ride along.
 */
const IDENTITY_SCOPES: readonly string[] = ["openid", "email"];

export type GoogleConnectorKind = "gsc" | "gbp" | "ga4";

/**
 * Why the operator initiated this OAuth flow (per-tenant OAuth, 2026-07-09):
 *   • "connect" - first authorization for this tenant+kind (no grant yet).
 *   • "replace" - the operator deliberately swaps the Google account behind a
 *     LIVE grant (mints a fresh refresh token for the newly chosen account).
 *   • "reauth"  - reconnect a dead / soft-disconnected grant.
 * Every one of these is a deliberate (re)authorization, so all three show the
 * account chooser AND force consent. Ordinary syncs/refreshes NEVER run OAuth.
 * The intent is carried in the signed state so the callback can log it and
 * apply replacement semantics.
 */
export type OAuthIntent = "connect" | "replace" | "reauth";

const GOOGLE_CALLBACK_PATH = "/api/connectors/google/callback";

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  /** OpenID Connect id_token (present because we request the openid + email
   *  identity scopes). Decoded server-side to read the account sub + email. */
  id_token?: string;
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

function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

// ─────────────────────────────────────────────────────────────────────
// Signed OAuth state
// ─────────────────────────────────────────────────────────────────────

type OAuthStatePayload = {
  /** Connector kind: "gsc" | "gbp" | "ga4". */
  k: GoogleConnectorKind;
  /** Tenant id at request time. */
  t: string;
  /** Random nonce. */
  n: string;
  /** Issued-at unix-ms. */
  i: number;
  /** Intent that started this flow (per-tenant OAuth, 2026-07-09). Optional so
   *  older in-flight states (< 10 min TTL) still decode; absent is treated as
   *  "connect". Carried so the callback can log it + apply replace semantics. */
  x?: OAuthIntent;
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

type OAuthStateDecodeResult =
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
  // Intent is optional; an unrecognized/absent value defaults to "connect" so a
  // tampered or legacy state can never widen semantics (worst case: a chooser +
  // consent, which is always safe).
  const intent: OAuthIntent =
    p.x === "replace" || p.x === "reauth" ? p.x : "connect";
  return { ok: true, payload: { k: p.k, t: p.t, n: p.n, i: p.i, x: intent } };
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
export function buildGoogleAuthUrl(
  kind: GoogleConnectorKind,
  state: string,
  intent: OAuthIntent = "connect",
): string {
  if (state == null || state === "") {
    throw new Error("buildGoogleAuthUrl: state parameter is required");
  }
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    // The single least-privilege DATA scope for this kind PLUS the universal
    // identity scopes (openid + email). Space-separated; URLSearchParams
    // URL-encodes the spaces. The data scopes are never bundled ACROSS kinds -
    // a GSC flow still never asks for analytics.readonly, and vice versa.
    scope: [SCOPES[kind], ...IDENTITY_SCOPES].join(" "),
    access_type: "offline",
    // Per-tenant OAuth (2026-07-09): every OAuth flow reachable here is a
    // deliberate (re)authorization - a first connect, an explicit "Replace
    // Google account", or a reconnect after death. Ordinary syncs/refreshes
    // NEVER run OAuth, so there is no accidental re-consent of a HEALTHY grant
    // to protect against (the old refresh-token-cap-churn failure mode). All
    // three intents therefore show the account chooser (select_account) AND
    // force a fresh consent so the chosen account mints its own refresh token.
    // Google accepts space-separated prompt values; the space is URL-encoded.
    prompt: promptForIntent(intent),
    // Carry forward scopes the account already granted this client so a
    // per-kind re-auth never silently narrows an existing grant.
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Map an OAuth intent to Google's `prompt` value. All operator-initiated
 *  flows show the chooser and force consent (see buildGoogleAuthUrl). */
function promptForIntent(intent: OAuthIntent): string {
  switch (intent) {
    case "connect":
    case "replace":
    case "reauth":
      return "consent select_account";
  }
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
    // Google returns { error, error_description }. Surface `error` so the
    // operator sees the ACTUAL cause (invalid_client / redirect_uri_mismatch /
    // invalid_grant) instead of a generic "check your creds".
    let googleError = "";
    try {
      googleError = (JSON.parse(text) as { error?: string }).error ?? "";
    } catch {
      /* non-JSON error body */
    }
    log.error("Google token exchange failed", {
      status: res.status,
      googleError,
      body: text.slice(0, 500),
    });
    throw new Error(
      `Google token exchange failed (${res.status})${googleError ? `: ${googleError}` : ""}`,
    );
  }

  return (await res.json()) as GoogleTokenResponse;
}

/** The Google account behind a grant, read from the id_token. */
type GoogleAccountIdentity = {
  /** Stable, opaque Google account id (`sub`). Never changes for an account,
   *  never the email (which can change). This is the identity we compare on. */
  sub: string;
  /** The account's email, when the `email` scope was granted. Display-only. */
  email?: string;
};

/**
 * Decode the account identity (sub + email) from Google's id_token
 * (per-tenant OAuth, 2026-07-09).
 *
 * WHY signature verification is NOT needed here: this id_token arrives ONLY as
 * the body of a direct, server-to-server HTTPS POST that WE made to Google's
 * token endpoint (oauth2.googleapis.com) using our client secret, over TLS.
 * There is no untrusted party in that channel who could forge or swap the
 * token, so fetching Google's JWKS to verify the JWT signature would add a
 * network dependency and failure mode for zero security gain. We still
 * sanity-check `iss` (must be Google) and `aud` (must be OUR client id) so a
 * malformed or misrouted token is rejected rather than trusted. (If this token
 * ever came from an UNtrusted channel - e.g. a browser redirect - full
 * signature verification WOULD be required.)
 *
 * Fail-soft: returns null on any missing/malformed/unexpected token so callers
 * simply treat the account as "unknown" (older grants render without the email
 * line and skip the same-account check).
 */
export function decodeGoogleIdToken(
  idToken: string | null | undefined,
): GoogleAccountIdentity | null {
  if (idToken == null || idToken === "") return null;
  const parts = idToken.split(".");
  // A JWT is header.payload.signature; we only read the middle payload segment.
  if (parts.length < 2 || !parts[1]) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(parts[1]).toString("utf-8"));
  } catch {
    return null;
  }
  if (payload == null || typeof payload !== "object") return null;
  const p = payload as {
    sub?: unknown;
    email?: unknown;
    iss?: unknown;
    aud?: unknown;
  };
  // iss must be Google's issuer (both forms Google uses are accepted).
  if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") {
    return null;
  }
  // aud must be OUR OAuth client id. Skip the check only if the client id is
  // somehow unreadable (never in the callback, where the exchange already used it).
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId != null && clientId !== "" && p.aud !== clientId) return null;
  if (typeof p.sub !== "string" || p.sub === "") return null;
  const email =
    typeof p.email === "string" && p.email !== "" ? p.email : undefined;
  return { sub: p.sub, email };
}

/**
 * FIX 4 (OAUTH_ROOT_CAUSE_2026-07-09): a NON-REVERSIBLE fingerprint of a
 * refresh token — the first 8 hex of its sha256. Lets logs prove WHICH
 * refresh token was used and spot a silently-changed one (rotation, or a new
 * consent replacing the row) WITHOUT ever printing the secret itself.
 */
function refreshTokenFingerprint(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 8);
}

/** Age in days (one decimal) since `connectedAt`, or null when unknown. */
function connectedAgeDays(connectedAt?: string): number | null {
  if (connectedAt == null || connectedAt === "") return null;
  const t = Date.parse(connectedAt);
  if (Number.isNaN(t)) return null;
  return Math.round(((Date.now() - t) / 86_400_000) * 10) / 10;
}

/**
 * Optional diagnostic context threaded into a refresh so a token death is
 * attributable in ONE log line (FIX 4). Never carries the token itself.
 */
type RefreshTokenContext = {
  provider?: "google_gsc" | "google_gbp" | "google_ga4";
  tenantId?: string;
  /** ISO 8601 `connected_at`, for token-age-at-death. */
  connectedAt?: string;
};

type RefreshedGoogleToken = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

/**
 * Single-flight dedupe of concurrent refreshes (per-tenant OAuth, 2026-07-09).
 * The cron fan-out, an on-render sync, and the freshness probe can all try to
 * refresh the SAME (tenant, provider) grant near-simultaneously. Racing those
 * calls burns quota and, when Google rotates the refresh token, can persist a
 * stale rotation out of order. Concurrent callers with the same key now share
 * ONE in-flight refresh promise (the module-level in-flight-map pattern used
 * elsewhere, e.g. the auto-measure throttle). Keyed by tenant:provider; a
 * caller without that context (no key) falls through to a direct refresh.
 * In-process only, which matches where the races actually happen (one lambda
 * or one dev server fanning out over tenants in a single process).
 */
const inFlightRefreshes = new Map<string, Promise<RefreshedGoogleToken>>();

export async function refreshGoogleAccessToken(
  refreshToken: string,
  context?: RefreshTokenContext,
): Promise<RefreshedGoogleToken> {
  const key =
    context?.tenantId && context?.provider
      ? `${context.tenantId}:${context.provider}`
      : null;
  if (key == null) return doRefreshGoogleAccessToken(refreshToken, context);
  const existing = inFlightRefreshes.get(key);
  if (existing != null) return existing;
  const flight = doRefreshGoogleAccessToken(refreshToken, context).finally(
    () => {
      inFlightRefreshes.delete(key);
    },
  );
  inFlightRefreshes.set(key, flight);
  return flight;
}

async function doRefreshGoogleAccessToken(
  refreshToken: string,
  context?: RefreshTokenContext,
): Promise<RefreshedGoogleToken> {
  const refreshFp = refreshTokenFingerprint(refreshToken);
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
    // Surface Google's error code. `invalid_grant` = the REFRESH TOKEN itself is
    // dead/revoked/expired → the ONLY condition that genuinely needs a reconnect.
    // Anything else (5xx, 429, network) is TRANSIENT and must NOT be treated as
    // a dead grant — callers key the "Reconnect Google" prompt on this string.
    let googleError = "";
    let googleErrorDescription = "";
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        error_description?: string;
      };
      googleError = parsed.error ?? "";
      googleErrorDescription = parsed.error_description ?? "";
    } catch {
      /* non-JSON error body */
    }
    // FIX 4: a dead grant (invalid_grant / "expired or revoked") gets ONE
    // structured, greppable line — provider, tenant, the refresh-token
    // fingerprint, its age in days, and Google's verbatim error_description —
    // so the NEXT death is attributable in one look (ages clustering near 7d ⇒
    // unverified sensitive scopes; deaths correlating with reconnects ⇒
    // refresh-token cap churn). Never logs the token.
    const isDeadGrant =
      googleError === "invalid_grant" ||
      /expired|revoked/i.test(googleErrorDescription);
    if (isDeadGrant) {
      log.error("Google refresh token dead", {
        provider: context?.provider ?? "unknown",
        tenantId: context?.tenantId ?? "unknown",
        refreshFp,
        tokenAgeDays: connectedAgeDays(context?.connectedAt),
        googleError,
        googleErrorDescription,
        status: res.status,
      });
    } else {
      log.error("Google token refresh failed", {
        status: res.status,
        provider: context?.provider ?? "unknown",
        tenantId: context?.tenantId ?? "unknown",
        refreshFp,
        googleError,
        body: text.slice(0, 500),
      });
    }
    throw new Error(
      `Google token refresh failed (${res.status})${googleError ? `: ${googleError}` : ""}`,
    );
  }

  const data = (await res.json()) as GoogleTokenResponse;
  // FIX 4: fingerprint EVERY successful refresh at debug level. A CHANGED
  // fingerprint on the next refresh is how rotation (or a replaced consent)
  // becomes visible without ever logging the secret.
  log.debug("Google token refreshed", {
    provider: context?.provider ?? "unknown",
    tenantId: context?.tenantId ?? "unknown",
    refreshFp,
    rotated: data.refresh_token != null && data.refresh_token !== "",
  });
  // FIX 3: return any rotated refresh_token so call sites can persist it.
  // Dropping it means the app keeps using an OLD refresh token that Google may
  // have just invalidated by the rotation, bricking the grant on the next
  // refresh (invalid_grant). Only include the field when Google actually sent
  // one — otherwise a persist must NOT overwrite the stored token with empty.
  return data.refresh_token
    ? {
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token,
      }
    : { access_token: data.access_token, expires_in: data.expires_in };
}

/** Random nonce helper for OAuth state. */
export function generateOAuthNonce(): string {
  return randomBytes(16).toString("hex");
}
