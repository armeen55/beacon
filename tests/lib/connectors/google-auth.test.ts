import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildGoogleAuthUrl,
  getRedirectUri,
  GOOGLE_CALLBACK_PATH,
} from "@/lib/connectors/google-auth";

describe("google-auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getRedirectUri", () => {
    it("defaults to localhost:3000 when NEXT_PUBLIC_APP_URL is unset", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      expect(getRedirectUri()).toBe(`http://localhost:3000${GOOGLE_CALLBACK_PATH}`);
    });

    it("uses NEXT_PUBLIC_APP_URL when set", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
      expect(getRedirectUri()).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });

    it("strips trailing slashes from base URL", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
      expect(getRedirectUri()).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });
  });

  describe("buildGoogleAuthUrl", () => {
    it("throws if GOOGLE_CLIENT_ID is not set", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      expect(() => buildGoogleAuthUrl()).toThrow("GOOGLE_CLIENT_ID");
    });

    it("builds a valid auth URL with required params", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

      const url = new URL(buildGoogleAuthUrl());
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("client_id")).toBe(
        "test-client-id.apps.googleusercontent.com",
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("scope")).toContain("business.manage");
      expect(url.searchParams.get("redirect_uri")).toContain(
        GOOGLE_CALLBACK_PATH,
      );
    });

    it("A.3.b1.alpha — auth URL requests webmasters.readonly scope alongside business.manage", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

      const url = new URL(buildGoogleAuthUrl());
      const scope = url.searchParams.get("scope") ?? "";
      expect(scope).toContain("https://www.googleapis.com/auth/business.manage");
      expect(scope).toContain("https://www.googleapis.com/auth/webmasters.readonly");
      // Scopes must be space-separated per Google's OAuth contract.
      expect(scope.split(" ").length).toBeGreaterThanOrEqual(2);
    });

    it("A.3.b1.alpha — callback path remains unchanged after GSC scope addition", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
      const url = new URL(buildGoogleAuthUrl());
      // Existing redirect URI shape preserved verbatim.
      expect(url.searchParams.get("redirect_uri")).toBe(
        `https://app.example.com${GOOGLE_CALLBACK_PATH}`,
      );
    });

    it("includes state parameter when provided", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
      const url = new URL(buildGoogleAuthUrl("csrf-token-123"));
      expect(url.searchParams.get("state")).toBe("csrf-token-123");
    });

    it("omits state parameter when not provided", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
      const url = new URL(buildGoogleAuthUrl());
      expect(url.searchParams.has("state")).toBe(false);
    });
  });
});
