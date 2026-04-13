/**
 * Server-only token store for platform connectors.
 * Stored in `.data/connector-tokens.json` — gitignored, never client-visible.
 * Atomic writes via temp file + rename (same pattern as json-store).
 */

import "server-only";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type ConnectorProvider = "google" | "yelp";

/** Google Business Profile — OAuth tokens. */
export type GoogleConnectorToken = {
  provider: "google";
  access_token: string;
  refresh_token: string;
  /** Unix timestamp in milliseconds when the access token expires. */
  expires_at: number;
  /** ISO 8601 date when the connector was first authorized. */
  connected_at: string;
  /** Scopes granted by the platform. */
  scopes: string[];
  /** ISO 8601 — last successful on-demand review pull. */
  last_synced_at?: string;
  /** GBP resource name of the selected location (e.g. "accounts/123/locations/456"). */
  selected_location_id?: string;
  /** Display name of the selected location — convenience only, never used for API calls. */
  selected_location_name?: string;
};

/** Yelp Fusion — API key (never sent to the client). */
export type YelpConnectorToken = {
  provider: "yelp";
  api_key: string;
  connected_at: string;
  /** Yelp Fusion business id or alias (may mirror Settings → Config). */
  business_id: string;
  last_synced_at?: string;
};

export type ConnectorToken = GoogleConnectorToken | YelpConnectorToken;

export type ConnectorStatus = "connected" | "disconnected";

export type ConnectorInfo = {
  status: ConnectorStatus;
  connected_at: string | null;
  /** OAuth access expiry (Google only); null for Yelp. */
  expires_at: number | null;
  last_synced_at: string | null;
  /** GBP selected location resource name (Google only). */
  selected_location_id?: string | null;
  /** GBP selected location display name (Google only). */
  selected_location_name?: string | null;
};

type TokenStore = Partial<Record<ConnectorProvider, ConnectorToken>>;

const DATA_DIR = join(process.cwd(), ".data");
const STORE_PATH = join(DATA_DIR, "connector-tokens.json");

let _cached: TokenStore | null = null;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readTokenStore(): TokenStore {
  if (_cached) return _cached;

  ensureDir();
  if (existsSync(STORE_PATH)) {
    try {
      const raw = readFileSync(STORE_PATH, "utf-8");
      _cached = JSON.parse(raw) as TokenStore;
      return _cached;
    } catch {
      // Corrupted — treat as empty
    }
  }

  _cached = {};
  return _cached;
}

function persistTokenStore(store: TokenStore): void {
  ensureDir();
  const tmp = STORE_PATH + ".tmp";
  const json = JSON.stringify(store, null, 2);
  writeFileSync(tmp, json, "utf-8");
  renameSync(tmp, STORE_PATH);
  _cached = store;
}

export function getConnectorToken(
  provider: ConnectorProvider,
): ConnectorToken | null {
  const store = readTokenStore();
  return store[provider] ?? null;
}

export function getGoogleConnectorToken(): GoogleConnectorToken | null {
  const t = getConnectorToken("google");
  return t?.provider === "google" ? t : null;
}

export function getYelpConnectorToken(): YelpConnectorToken | null {
  const t = getConnectorToken("yelp");
  return t?.provider === "yelp" ? t : null;
}

export function getConnectorInfo(provider: ConnectorProvider): ConnectorInfo {
  const token = getConnectorToken(provider);
  if (!token) {
    return {
      status: "disconnected",
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
    };
  }
  if (token.provider === "google") {
    return {
      status: "connected",
      connected_at: token.connected_at,
      expires_at: token.expires_at,
      last_synced_at: token.last_synced_at ?? null,
      selected_location_id: token.selected_location_id ?? null,
      selected_location_name: token.selected_location_name ?? null,
    };
  }
  return {
    status: "connected",
    connected_at: token.connected_at,
    expires_at: null,
    last_synced_at: token.last_synced_at ?? null,
  };
}

export function saveConnectorToken(token: ConnectorToken): void {
  const store = { ...readTokenStore() };
  store[token.provider] = token;
  persistTokenStore(store);
}

type GoogleConnectorPatch = Partial<
  Pick<GoogleConnectorToken, "access_token" | "expires_at" | "last_synced_at" | "selected_location_id" | "selected_location_name">
>;
type YelpConnectorPatch = Partial<
  Pick<YelpConnectorToken, "api_key" | "last_synced_at" | "business_id">
>;

export function updateConnectorToken(
  provider: "google",
  patch: GoogleConnectorPatch,
): void;
export function updateConnectorToken(
  provider: "yelp",
  patch: YelpConnectorPatch,
): void;
export function updateConnectorToken(
  provider: ConnectorProvider,
  patch: GoogleConnectorPatch | YelpConnectorPatch,
): void {
  const store = { ...readTokenStore() };
  const existing = store[provider];
  if (!existing || existing.provider !== provider) return;
  store[provider] = { ...existing, ...patch } as ConnectorToken;
  persistTokenStore(store);
}

export function deleteConnectorToken(provider: ConnectorProvider): void {
  const store = { ...readTokenStore() };
  delete store[provider];
  persistTokenStore(store);
}

export function isTokenExpired(token: ConnectorToken): boolean {
  if (token.provider !== "google") return false;
  return Date.now() >= token.expires_at;
}

/** Clear the in-memory cache (useful for tests). */
export function _resetCache(): void {
  _cached = null;
}

/** Delete the token file from disk (useful for tests). */
export function _deleteStoreFile(): void {
  _cached = null;
  if (existsSync(STORE_PATH)) {
    try {
      unlinkSync(STORE_PATH);
    } catch {
      // Best effort
    }
  }
}
