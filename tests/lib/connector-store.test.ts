import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getConnectorToken,
  getGoogleConnectorToken,
  getConnectorInfo,
  saveConnectorToken,
  updateConnectorToken,
  deleteConnectorToken,
  isTokenExpired,
  _resetCache,
  _deleteStoreFile,
  type GoogleConnectorToken,
  type YelpConnectorToken,
} from "@/lib/connector-store";

function googleToken(overrides?: Partial<GoogleConnectorToken>): GoogleConnectorToken {
  return {
    provider: "google",
    access_token: "ya29.test-access-token",
    refresh_token: "1//test-refresh-token",
    expires_at: Date.now() + 3600_000,
    connected_at: "2026-04-13T10:00:00Z",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    ...overrides,
  };
}

function yelpToken(overrides?: Partial<YelpConnectorToken>): YelpConnectorToken {
  return {
    provider: "yelp",
    api_key: "yelp-test-key",
    connected_at: "2026-04-13T11:00:00Z",
    business_id: "test-business-alias",
    ...overrides,
  };
}

describe("connector-store", () => {
  beforeEach(() => {
    _deleteStoreFile();
  });

  afterEach(() => {
    _deleteStoreFile();
  });

  describe("getConnectorToken", () => {
    it("returns null for unknown provider", () => {
      expect(getConnectorToken("google")).toBeNull();
    });

    it("returns saved token", () => {
      const token = googleToken();
      saveConnectorToken(token);
      const result = getConnectorToken("google");
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("google");
      expect(getGoogleConnectorToken()!.access_token).toBe(token.access_token);
    });
  });

  describe("getConnectorInfo", () => {
    it("returns disconnected when no token", () => {
      const info = getConnectorInfo("google");
      expect(info.status).toBe("disconnected");
      expect(info.connected_at).toBeNull();
      expect(info.expires_at).toBeNull();
      expect(info.last_synced_at).toBeNull();
    });

    it("returns connected with timestamps when token exists", () => {
      const token = googleToken();
      saveConnectorToken(token);
      const info = getConnectorInfo("google");
      expect(info.status).toBe("connected");
      expect(info.connected_at).toBe(token.connected_at);
      expect(info.expires_at).toBe(token.expires_at);
      expect(info.last_synced_at).toBeNull();
    });

    it("returns last_synced_at when set on token", () => {
      saveConnectorToken(
        googleToken({ last_synced_at: "2026-04-13T12:00:00.000Z" }),
      );
      expect(getConnectorInfo("google").last_synced_at).toBe(
        "2026-04-13T12:00:00.000Z",
      );
    });
  });

  describe("saveConnectorToken", () => {
    it("persists token to disk and survives cache clear", () => {
      const token = googleToken();
      saveConnectorToken(token);
      _resetCache();
      const result = getConnectorToken("google");
      expect(result).not.toBeNull();
      expect(getGoogleConnectorToken()!.refresh_token).toBe(token.refresh_token);
    });

    it("overwrites existing token for same provider", () => {
      saveConnectorToken(googleToken({ access_token: "first" }));
      saveConnectorToken(googleToken({ access_token: "second" }));
      expect(getGoogleConnectorToken()!.access_token).toBe("second");
    });
  });

  describe("updateConnectorToken", () => {
    it("patches access_token and expires_at", () => {
      saveConnectorToken(googleToken());
      const newExpiry = Date.now() + 7200_000;
      updateConnectorToken("google", {
        access_token: "refreshed-token",
        expires_at: newExpiry,
      });
      const result = getGoogleConnectorToken()!;
      expect(result.access_token).toBe("refreshed-token");
      expect(result.expires_at).toBe(newExpiry);
      expect(result.refresh_token).toBe("1//test-refresh-token");
    });

    it("patches last_synced_at", () => {
      saveConnectorToken(googleToken());
      updateConnectorToken("google", {
        last_synced_at: "2026-04-13T15:00:00.000Z",
      });
      expect(getGoogleConnectorToken()!.last_synced_at).toBe(
        "2026-04-13T15:00:00.000Z",
      );
    });

    it("does nothing if provider not found", () => {
      updateConnectorToken("google", { access_token: "nope" });
      expect(getConnectorToken("google")).toBeNull();
    });
  });

  describe("deleteConnectorToken", () => {
    it("removes the token", () => {
      saveConnectorToken(googleToken());
      expect(getConnectorToken("google")).not.toBeNull();
      deleteConnectorToken("google");
      expect(getConnectorToken("google")).toBeNull();
    });

    it("survives cache clear after delete", () => {
      saveConnectorToken(googleToken());
      deleteConnectorToken("google");
      _resetCache();
      expect(getConnectorToken("google")).toBeNull();
    });
  });

  describe("isTokenExpired", () => {
    it("returns false for future expiry", () => {
      expect(isTokenExpired(googleToken({ expires_at: Date.now() + 60_000 }))).toBe(false);
    });

    it("returns true for past expiry", () => {
      expect(isTokenExpired(googleToken({ expires_at: Date.now() - 1 }))).toBe(true);
    });

    it("returns false for Yelp token (no OAuth expiry)", () => {
      expect(isTokenExpired(yelpToken())).toBe(false);
    });
  });

  describe("Google location selection", () => {
    it("stores and retrieves selected_location_id and selected_location_name", () => {
      saveConnectorToken(googleToken({
        selected_location_id: "accounts/a/locations/x",
        selected_location_name: "My Location",
      }));
      const tok = getGoogleConnectorToken()!;
      expect(tok.selected_location_id).toBe("accounts/a/locations/x");
      expect(tok.selected_location_name).toBe("My Location");
    });

    it("patches selected_location_id via updateConnectorToken", () => {
      saveConnectorToken(googleToken());
      updateConnectorToken("google", {
        selected_location_id: "accounts/b/locations/y",
        selected_location_name: "Updated Loc",
      });
      const tok = getGoogleConnectorToken()!;
      expect(tok.selected_location_id).toBe("accounts/b/locations/y");
      expect(tok.selected_location_name).toBe("Updated Loc");
      expect(tok.access_token).toBe("ya29.test-access-token");
    });

    it("getConnectorInfo returns selected location fields for Google", () => {
      saveConnectorToken(googleToken({
        selected_location_id: "accounts/a/locations/z",
        selected_location_name: "Place Z",
      }));
      const info = getConnectorInfo("google");
      expect(info.selected_location_id).toBe("accounts/a/locations/z");
      expect(info.selected_location_name).toBe("Place Z");
    });

    it("getConnectorInfo returns null location fields when unset", () => {
      saveConnectorToken(googleToken());
      const info = getConnectorInfo("google");
      expect(info.selected_location_id).toBeNull();
      expect(info.selected_location_name).toBeNull();
    });
  });

  describe("Yelp connector token", () => {
    it("getConnectorInfo returns expires_at null for Yelp", () => {
      saveConnectorToken(yelpToken());
      const info = getConnectorInfo("yelp");
      expect(info.status).toBe("connected");
      expect(info.expires_at).toBeNull();
      expect(info.connected_at).toBeTruthy();
    });

    it("updateConnectorToken patches yelp api_key and business_id", () => {
      saveConnectorToken(yelpToken());
      updateConnectorToken("yelp", { api_key: "new-key", business_id: "new-biz" });
      const t = getConnectorToken("yelp");
      expect(t?.provider).toBe("yelp");
      if (t?.provider !== "yelp") return;
      expect(t.api_key).toBe("new-key");
      expect(t.business_id).toBe("new-biz");
    });
  });
});
