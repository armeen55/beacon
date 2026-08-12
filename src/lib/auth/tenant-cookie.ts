/**
 * tenant-cookie: the signed answer to "which account is this session", so the middleware stops asking the
 * database on EVERY request.
 *
 * The middleware runs on every navigation and every server action. Reading `tenant_members` there put one
 * blocking Supabase round trip in front of every press, and when the pool was starved that read timed out and
 * the request was bounced to /login?error=account_unavailable even though the session cookie was perfectly
 * valid. One slow read is not an account verdict.
 *
 * The account id is carried in an HMAC-signed, httpOnly cookie instead. A fresh signature is trusted for
 * TENANT_COOKIE_TTL_MS and skips the database entirely; past that the middleware reads `tenant_members` once
 * and re-signs. A signature that is merely EXPIRED still verifies, which is what lets a failed read fall back
 * to the last known account (STALE_GRACE_MS) rather than throwing the operator out.
 *
 * The value is signed, never encrypted: it carries no secret, only the account id the server would have
 * injected anyway, and the signature is what makes it unforgeable. Web Crypto is used (not node:crypto) so the
 * same code runs on the edge runtime and under Node.
 */

const TENANT_COOKIE_NAME = "beacon_acct";
/** How long a signature is trusted without re-reading `tenant_members`. */
const TENANT_COOKIE_TTL_MS = 15 * 60 * 1000;
/** How long past expiry a signature may still answer a FAILED read. Membership rarely changes; a stranded
 *  operator is a certainty. */
const STALE_GRACE_MS = 24 * 60 * 60 * 1000;

export const TENANT_COOKIE = {
  name: TENANT_COOKIE_NAME,
  /** Seconds, for the Set-Cookie. The grace window is what the signature itself carries. */
  maxAge: Math.floor((TENANT_COOKIE_TTL_MS + STALE_GRACE_MS) / 1000),
} as const;

/** The cookie the middleware sets after ONE failed account read, so the second failure in a row stops
 *  reloading and says so. Short lived on purpose: an incident an hour later gets its own free retry. */
export const ACCOUNT_RETRY_COOKIE = "beacon_acct_retry";

/** No secret configured means no cached account: the middleware falls back to reading the database every
 *  time, exactly as it did before. Ordered by how certain each one is to be set on a server that can serve
 *  an authenticated page at all. */
function signingSecret(): string | null {
  return (
    process.env.BEACON_OAUTH_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.CRON_SECRET ||
    null
  );
}

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  cachedKey = { secret, key };
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `<base64url payload>.<base64url signature>`, where the payload names the user, the account and the moment
 *  the signature stops being fresh. The user id is inside the signed payload so a cookie lifted from one
 *  session can never answer for another. */
export async function signTenantCookie(userId: string, tenantId: string, nowMs: number): Promise<string | null> {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = toBase64Url(encoder.encode(`${userId}|${tenantId}|${nowMs + TENANT_COOKIE_TTL_MS}`));
  const signature = await crypto.subtle
    .sign("HMAC", await hmacKey(secret), encoder.encode(payload))
    .then((sig) => toBase64Url(new Uint8Array(sig)))
    .catch(() => null);
  return signature ? `${payload}.${signature}` : null;
}

type CachedTenant = {
  tenantId: string;
  /** TRUE while the signature is inside its TTL: the database read is skipped outright. FALSE means expired
   *  but still genuine, which only answers a read that FAILED. */
  fresh: boolean;
};

/** Verify and read the cookie. Null on a missing, malformed, forged, wrong-user or long-dead value, and a
 *  null answer is always safe: the caller reads `tenant_members` instead. */
export async function readTenantCookie(
  raw: string | undefined,
  userId: string,
  nowMs: number,
): Promise<CachedTenant | null> {
  const secret = signingSecret();
  if (!secret || !raw) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const signature = fromBase64Url(raw.slice(dot + 1));
  const body = fromBase64Url(payload);
  if (!signature || !body) return null;
  const verified = await crypto.subtle
    .verify("HMAC", await hmacKey(secret), signature as BufferSource, encoder.encode(payload))
    .catch(() => false);
  if (!verified) return null;
  const parts = new TextDecoder().decode(body).split("|");
  if (parts.length !== 3) return null;
  const [signedUser, tenantId, expiresAt] = parts as [string, string, string];
  const expiresMs = Number(expiresAt);
  if (signedUser !== userId || !tenantId || !Number.isFinite(expiresMs)) return null;
  if (nowMs > expiresMs + STALE_GRACE_MS) return null;
  return { tenantId, fresh: nowMs <= expiresMs };
}
