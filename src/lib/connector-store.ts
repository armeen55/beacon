/**
 * 2026-05-16 — connector-tokens-supabase-and-gsc-scope-split.
 *
 * Server-only token store for platform connectors, persisted in the
 * Supabase `connector_tokens` table (migration:
 * `migrations/2026-05-16_connector_tokens.sql`).
 *
 * Replaces the prior `.data/connector-tokens.json` file store, which
 * crashed on Vercel post-deploy with `ENOENT: no such file or
 * directory, open '/var/task/.data/connector-tokens.json.tmp'` —
 * lambda FS is read-only post-init and `.data/` is gitignored.
 *
 * Provider keys (locked):
 *   • `google_gsc` — Google Search Console (webmasters.readonly).
 *   • `google_gbp` — Google Business Profile (business.manage).
 *   • `yelp`      — Yelp Fusion API key.
 *
 * Two-token Google storage reflects Google's per-grant authorization
 * model: refresh tokens are bound to the scope set granted at consent.
 * A single "google" slot would force both scopes to live in one grant
 * — the trust bug operators reported when GSC connect asked for GBP
 * edit/create/delete permissions.
 *
 * Posture:
 *   • All public functions are `async`. Read + write go through the
 *     Supabase service-role admin client (`getSupabaseAdmin()`).
 *   • Tenant-scoped: every read/write threads `tenantId` through the
 *     composite primary key.
 *   • Plaintext payload (mirrors the prior on-disk posture). Section 4
 *     F3 lock: encryption-at-rest deferred to a follow-up bundle
 *     before broader customer onboarding.
 *   • RLS deny-all on the table; service-role bypasses. No customer
 *     surface reads this module.
 *   • No `writeFileSync` / `renameSync` / `mkdirSync` — pinned by
 *     `tests/architecture/connector-store-no-disk-write.test.ts`.
 *
 * Soft-fail rules:
 *   • Read paths return `null` when the row is missing OR when the
 *     `connector_tokens` table is missing entirely (PostgreSQL
 *     `42P01` undefined_table). The undefined-table soft-fail covers
 *     the deploy window when code is live but the migration hasn't
 *     applied yet.
 *   • Write paths throw — OAuth callback persistence MUST fail loud
 *     so the operator notices a missing migration / RLS misconfig.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────
// Provider + token shapes
// ─────────────────────────────────────────────────────────────────────

export type ConnectorProvider = "google_gsc" | "google_gbp" | "yelp";

/** Google OAuth token shape (GSC or GBP — discriminated by provider). */
export type GoogleConnectorToken = {
  provider: "google_gsc" | "google_gbp";
  access_token: string;
  refresh_token: string;
  /** Unix timestamp in milliseconds when the access token expires. */
  expires_at: number;
  /** ISO 8601 date when the connector was first authorized. */
  connected_at: string;
  /** Scopes granted by Google. */
  scopes: string[];
  /** ISO 8601 — last successful on-demand pull. */
  last_synced_at?: string;
  /** GBP resource name of the selected location (e.g.
   *  "accounts/123/locations/456"). google_gbp only. */
  selected_location_id?: string;
  /** Display name of the selected location — convenience only,
   *  never used for API calls. google_gbp only. */
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
  /** GBP selected location resource name (google_gbp only). */
  selected_location_id?: string | null;
  /** GBP selected location display name (google_gbp only). */
  selected_location_name?: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Supabase helpers
// ─────────────────────────────────────────────────────────────────────

const TABLE = "connector_tokens";

function isUndefinedTableError(error: unknown): boolean {
  // PostgREST surfaces `code: "42P01"` on undefined_table.
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

async function resolveTenantId(tenantId?: string): Promise<string> {
  if (tenantId != null && tenantId !== "") return tenantId;
  return await currentTenantId();
}

// ─────────────────────────────────────────────────────────────────────
// Read API (soft-fail to null on missing row / missing table)
// ─────────────────────────────────────────────────────────────────────

export async function getConnectorToken(
  provider: ConnectorProvider,
  tenantId?: string,
): Promise<ConnectorToken | null> {
  const tid = await resolveTenantId(tenantId);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // Supabase env vars are not configured in this environment.
    // Read-side soft-fail: treat as "no token connected" so callers
    // like getConnectorInfo / local-presence render disconnected
    // state instead of crashing. Writes still throw because the OAuth
    // callback must surface persistence failures.
    return null;
  }
  const { data, error } = await admin
    .from(TABLE)
    .select("payload")
    .eq("tenant_id", tid)
    .eq("provider", provider)
    .maybeSingle();

  if (error != null) {
    if (isUndefinedTableError(error)) return null;
    throw new Error(
      `connector-store: read failed for provider=${provider}: ${error.message ?? String(error)}`,
    );
  }
  if (data == null) return null;
  const payload = (data as { payload: unknown }).payload;
  if (payload == null || typeof payload !== "object") return null;
  return payload as ConnectorToken;
}

export async function getGoogleConnectorToken(
  kind: "gsc" | "gbp" = "gsc",
  tenantId?: string,
): Promise<GoogleConnectorToken | null> {
  const provider: ConnectorProvider =
    kind === "gsc" ? "google_gsc" : "google_gbp";
  const t = await getConnectorToken(provider, tenantId);
  return t != null && (t.provider === "google_gsc" || t.provider === "google_gbp")
    ? (t as GoogleConnectorToken)
    : null;
}

export async function getYelpConnectorToken(
  tenantId?: string,
): Promise<YelpConnectorToken | null> {
  const t = await getConnectorToken("yelp", tenantId);
  return t != null && t.provider === "yelp" ? t : null;
}

export async function getConnectorInfo(
  provider: ConnectorProvider,
  tenantId?: string,
): Promise<ConnectorInfo> {
  const token = await getConnectorToken(provider, tenantId);
  if (token == null) {
    return {
      status: "disconnected",
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
    };
  }
  if (token.provider === "google_gsc" || token.provider === "google_gbp") {
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

// ─────────────────────────────────────────────────────────────────────
// Write API (throws on failure — OAuth callback must surface errors)
// ─────────────────────────────────────────────────────────────────────

export async function saveConnectorToken(
  token: ConnectorToken,
  tenantId?: string,
): Promise<void> {
  const tid = await resolveTenantId(tenantId);
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(TABLE).upsert(
    {
      tenant_id: tid,
      provider: token.provider,
      payload: token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error != null) {
    throw new Error(
      `connector-store: save failed for provider=${token.provider}: ${error.message ?? String(error)}`,
    );
  }
}

type GoogleConnectorPatch = Partial<
  Pick<
    GoogleConnectorToken,
    | "access_token"
    | "expires_at"
    | "last_synced_at"
    | "selected_location_id"
    | "selected_location_name"
  >
>;
type YelpConnectorPatch = Partial<
  Pick<YelpConnectorToken, "api_key" | "last_synced_at" | "business_id">
>;

export async function updateConnectorToken(
  provider: "google_gsc" | "google_gbp",
  patch: GoogleConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "yelp",
  patch: YelpConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: ConnectorProvider,
  patch: GoogleConnectorPatch | YelpConnectorPatch,
  tenantId?: string,
): Promise<void> {
  const tid = await resolveTenantId(tenantId);
  const existing = await getConnectorToken(provider, tid);
  if (existing == null) return;
  if (existing.provider !== provider) return;
  const merged = { ...existing, ...patch } as ConnectorToken;
  await saveConnectorToken(merged, tid);
}

export async function deleteConnectorToken(
  provider: ConnectorProvider,
  tenantId?: string,
): Promise<void> {
  const tid = await resolveTenantId(tenantId);
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from(TABLE)
    .delete()
    .eq("tenant_id", tid)
    .eq("provider", provider);
  if (error != null) {
    if (isUndefinedTableError(error)) return;
    throw new Error(
      `connector-store: delete failed for provider=${provider}: ${error.message ?? String(error)}`,
    );
  }
}

export function isTokenExpired(token: ConnectorToken): boolean {
  if (token.provider !== "google_gsc" && token.provider !== "google_gbp") {
    return false;
  }
  return Date.now() >= token.expires_at;
}
