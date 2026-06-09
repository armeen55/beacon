/**
 * 2026-05-16 — connector-tokens-supabase-and-gsc-scope-split.
 *
 * Pins the scope-split contract on Google OAuth:
 *   • kind="gsc" auth URL contains webmasters.readonly and NOT business.manage.
 *   • kind="gbp" auth URL contains business.manage and NOT webmasters.readonly.
 *   • Signed state round-trips correctly; tampered/expired states fail.
 *   • Each OAuth flow requests EXACTLY ONE scope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  encodeOAuthState,
  decodeOAuthState,
  generateOAuthNonce,
} from "@/lib/connectors/google-auth";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "test-state-secret-32-chars-minimum");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("google-auth scope split — GSC", () => {
  it("GSC auth URL contains webmasters.readonly", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain(GSC_SCOPE);
  });

  it("GSC auth URL does NOT contain business.manage", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).not.toContain(GBP_SCOPE);
    expect(scope).not.toContain("business.manage");
  });

  it("GSC auth URL requests EXACTLY ONE scope", () => {
    const url = new URL(buildGoogleAuthUrl("gsc", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    // Space-separated count: one scope = no separators.
    expect(scope.split(/\s+/).filter(Boolean)).toHaveLength(1);
  });
});

describe("google-auth scope split — GBP", () => {
  it("GBP auth URL contains business.manage", () => {
    const url = new URL(buildGoogleAuthUrl("gbp", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain(GBP_SCOPE);
  });

  it("GBP auth URL does NOT contain webmasters.readonly", () => {
    const url = new URL(buildGoogleAuthUrl("gbp", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).not.toContain(GSC_SCOPE);
    expect(scope).not.toContain("webmasters");
  });

  it("GBP auth URL requests EXACTLY ONE scope", () => {
    const url = new URL(buildGoogleAuthUrl("gbp", "signed-state-token"));
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope.split(/\s+/).filter(Boolean)).toHaveLength(1);
  });
});

describe("google-auth signed state — encode / decode round-trip", () => {
  it("encoded state decodes back to the original payload", () => {
    const payload = {
      k: "gsc" as const,
      t: "tenant-ritz-founder",
      n: generateOAuthNonce(),
      i: Date.now(),
    };
    const encoded = encodeOAuthState(payload);
    const decoded = decodeOAuthState(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload.k).toBe("gsc");
    expect(decoded.payload.t).toBe("tenant-ritz-founder");
    expect(decoded.payload.n).toBe(payload.n);
    expect(decoded.payload.i).toBe(payload.i);
  });

  it("tampered body fails verification", () => {
    const encoded = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "nonce",
      i: Date.now(),
    });
    // Flip the FIRST body char to a different base64url char. The
    // first char carries the full high bits of byte 0, so the change
    // is always significant (the last base64url char can have
    // don't-care low bits → a last-char flip can be a byte-level
    // no-op → flaky, same class as the signature case below).
    const [body, sig] = encoded.split(".");
    const tampered = `${body!.slice(0, 1) === "A" ? "B" : "A"}${body!.slice(1)}.${sig}`;
    const result = decodeOAuthState(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["bad_signature", "malformed"]).toContain(result.reason);
  });

  it("tampered signature fails verification", () => {
    const encoded = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "nonce",
      i: Date.now(),
    });
    const [body, sig] = encoded.split(".");
    // The signature is LOWERCASE hex and Buffer.from(_, "hex") is
    // case-insensitive, so flipping to a different *hex nibble* is the
    // only guaranteed-different tamper. (The old `slice(0,-2)+"00"` was
    // a no-op when the sig ended in "00"; an "a"->"A" flip is a no-op
    // because both decode to byte 0x0a. The payload carries Date.now()
    // so the sig — and thus the last nibble — varies per run → flaky.)
    const lastNibble = sig!.slice(-1).toLowerCase();
    const flipped = lastNibble === "0" ? "1" : "0";
    const tampered = `${body}.${sig!.slice(0, -1)}${flipped}`;
    const result = decodeOAuthState(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("missing state returns missing", () => {
    expect(decodeOAuthState(null).ok).toBe(false);
    expect(decodeOAuthState("").ok).toBe(false);
    expect(decodeOAuthState(undefined).ok).toBe(false);
  });

  it("malformed state returns malformed", () => {
    const result = decodeOAuthState("not-a-valid-encoded-state-no-dots");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed");
  });

  it("expired state (i older than 10 minutes) returns expired", () => {
    const payload = {
      k: "gsc" as const,
      t: "tenant-a",
      n: "nonce",
      i: Date.now() - 11 * 60 * 1000, // 11 minutes ago
    };
    const encoded = encodeOAuthState(payload);
    const result = decodeOAuthState(encoded);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });

  it("state signed with a different secret fails verification", () => {
    const encoded = encodeOAuthState({
      k: "gsc",
      t: "tenant-a",
      n: "nonce",
      i: Date.now(),
    });
    vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "a-completely-different-secret-32-chars");
    const result = decodeOAuthState(encoded);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bad_signature");
  });

  it("missing BEACON_OAUTH_STATE_SECRET returns secret_missing", () => {
    vi.stubEnv("BEACON_OAUTH_STATE_SECRET", "");
    const result = decodeOAuthState("foo.bar");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("secret_missing");
  });

  it("decoded payload preserves k for both gsc and gbp", () => {
    const gsc = encodeOAuthState({ k: "gsc", t: "a", n: "n", i: Date.now() });
    const gbp = encodeOAuthState({ k: "gbp", t: "a", n: "n", i: Date.now() });
    const rGsc = decodeOAuthState(gsc);
    const rGbp = decodeOAuthState(gbp);
    expect(rGsc.ok && rGsc.payload.k).toBe("gsc");
    expect(rGbp.ok && rGbp.payload.k).toBe("gbp");
  });
});

describe("google-auth — buildGoogleAuthUrl carries state verbatim", () => {
  it("the URL's state param equals the input state string", () => {
    const state = "test-signed-state-abc.123-sig";
    const url = new URL(buildGoogleAuthUrl("gsc", state));
    expect(url.searchParams.get("state")).toBe(state);
  });
});
