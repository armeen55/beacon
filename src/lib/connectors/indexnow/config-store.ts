import "server-only";

/**
 * IndexNow per-tenant config store (BEACON_500 item 75, 2026-07-02).
 *
 * IndexNow (the shared Bing/Yandex/Seznam change-notification protocol) needs
 * two things per tenant, both operator-supplied:
 *   - key: an opaque token the operator generates once
 *   - a matching key file hosted at https://<host>/<key>.txt (or a custom
 *     keyLocation) so api.indexnow.org can verify the ping came from someone
 *     who controls the site
 *
 * This mirrors the existing per-tenant connector-token pattern (see
 * `src/lib/connector-store.ts`) but stays in its own small store rather than
 * widening the shared `ConnectorProvider` union: IndexNow has no OAuth flow,
 * no bearer-token API calls to make on the tenant's behalf, and self-hides
 * completely with no key configured, so the whole "provider" is really just
 * one opaque string plus optional host override. Kept as a per-tenant
 * singleton json-store ("indexnow-config"), the same one-object-per-tenant
 * shape as `autopilot-state`.
 *
 * SAFETY: reads fail soft to "not configured" (the lane self-hides). Writes
 * throw so the operator notices a save failure immediately.
 *
 * Optional Bing Webmaster API key rides the same config object (item 75 part
 * 3): a separate, OPTIONAL bearer key for the official Bing Webmaster API
 * quota check. Absent by default; the quota card self-hides without it.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "indexnow-config";

export type IndexNowConfig = {
  /** Opaque key the operator generated for the IndexNow protocol. */
  key: string;
  /** Host the key file is served from (e.g. "example.com"). Defaults to the
   *  tenant's registered domain when not set explicitly. */
  host?: string;
  /** Optional override if the key file lives somewhere other than
   *  https://<host>/<key>.txt (e.g. a subpath CDN rule). */
  keyLocation?: string;
  /** ISO 8601 — when the operator saved this config. */
  connected_at: string;
  /** Optional Bing Webmaster API bearer key (separate product, separate
   *  key). Only used for the read-only quota check; never required for
   *  pings. Absent -> the quota card self-hides. */
  bingWebmasterApiKey?: string;
};

function normalize(raw: unknown): IndexNowConfig | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Partial<IndexNowConfig>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  if (key === "") return null;
  return {
    key,
    host: typeof r.host === "string" && r.host.trim() !== "" ? r.host.trim() : undefined,
    keyLocation:
      typeof r.keyLocation === "string" && r.keyLocation.trim() !== ""
        ? r.keyLocation.trim()
        : undefined,
    connected_at: typeof r.connected_at === "string" ? r.connected_at : new Date(0).toISOString(),
    bingWebmasterApiKey:
      typeof r.bingWebmasterApiKey === "string" && r.bingWebmasterApiKey.trim() !== ""
        ? r.bingWebmasterApiKey.trim()
        : undefined,
  };
}

/** The tenant's IndexNow config, or null when never configured. Fail-soft:
 *  any read error also reads as "not configured" so the lane self-hides
 *  instead of throwing on a render path. */
export async function getIndexNowConfig(): Promise<IndexNowConfig | null> {
  try {
    const rows = await readStore<IndexNowConfig>(STORE);
    return normalize(rows?.[0]);
  } catch {
    return null;
  }
}

/** Persist the tenant's IndexNow config (single-element array, the same
 *  singleton convention as `autopilot-state`). Throws on failure so a
 *  save action can surface the error to the operator. */
export async function saveIndexNowConfig(config: IndexNowConfig): Promise<void> {
  const clean = normalize(config);
  if (clean == null) {
    throw new Error("indexnow-config: a non-empty key is required");
  }
  await writeStore<IndexNowConfig>(STORE, [clean]);
}
