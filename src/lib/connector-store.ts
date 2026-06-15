/**
 * 2026-05-16 — connector-tokens-supabase-and-gsc-scope-split.
 *  (Extended 2026-05-18 — Slice 9.A1 — GA4 provider.)
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
 *   • `google_ga4` — Google Analytics 4 (analytics.readonly).
 *                   Slice 9.A1 — OAuth + Admin API property picker
 *                   only; Data API consumption lands in Slice 9.A2.
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

export type ConnectorProvider =
  | "google_gsc"
  | "google_gbp"
  | "google_ga4"
  | "yelp"
  | "semrush"
  | "callrail"
  | "wix"
  | "profound"
  | "clarity";

/** Google OAuth token shape (GSC, GBP, or GA4 — discriminated by provider). */
export type GoogleConnectorToken = {
  provider: "google_gsc" | "google_gbp" | "google_ga4";
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
  /** GA4 property id (numeric string; e.g. "123456789"). Persisted on
   *  the google_ga4 token payload via JSONB extension — no schema
   *  migration. Selected by the operator on `/settings/connectors`
   *  after OAuth via the property-picker flow. google_ga4 only.
   *  Slice 9.A1 (2026-05-18). */
  ga4_property_id?: string;
  /** GA4 property display name — convenience only, never used for
   *  API calls. google_ga4 only. Slice 9.A1 (2026-05-18). */
  ga4_property_display_name?: string;
  /** GA4 account display name — convenience only, surfaced in the
   *  settings card alongside the property name. google_ga4 only.
   *  Slice 9.A1 (2026-05-18). */
  ga4_account_display_name?: string;
  /** J5 (2026-05-18) — ISO 8601 timestamp set when the operator
   *  clicks "Disconnect" on `/settings/connectors`. Soft disconnect:
   *  the token row stays in `connector_tokens` (cached historical
   *  state preserved) but `getConnectorInfo` reports `status:
   *  "disconnected"` and downstream connectors fail-soft as if no
   *  token. Reconnect via the OAuth callback upserts a fresh payload
   *  WITHOUT this field, naturally clearing the disconnect state.
   *  Absent on legacy rows (pre-J5). Applies to GSC + GA4 (GBP retains
   *  destructive delete path per Section 7 lock). */
  disconnected_at?: string;
  /** Reconnect signal (2026-06-15). ISO 8601 timestamp stamped by the
   *  GSC/GA4 sync paths when a sync TERMINATES in an auth failure — the
   *  refresh token itself is dead/revoked/scope-lost (gsc_token_expired,
   *  gsc_auth_failed_401/403, GA4 token_expired). This is the only
   *  authoritative "needs reconnect" signal: an `expires_at < now` alone
   *  is NOT, because the next refresh silently heals it. CLEARED (set to
   *  null) on a successful sync (synced:true, auth OK — even 0 rows).
   *  `getConnectorHealth` reads this to surface a "Reconnect" state. The
   *  write is fail-soft from the sync path (a token-write error never
   *  changes the sync's own outcome). Absent on legacy rows. google_gsc
   *  + google_ga4 only. */
  auth_failed_at?: string | null;
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

/**
 * Semrush Analytics API — API key (never sent to the client). Key-based
 * auth like Yelp (no OAuth). `database` is the Semrush regional database
 * (e.g. "us") used as the default for domain reports. Soft-disconnect
 * via `disconnected_at` mirrors the Google connectors so a week-limited
 * key can be disconnected while cached metrics are preserved.
 */
export type SemrushConnectorToken = {
  provider: "semrush";
  api_key: string;
  connected_at: string;
  /** Regional database default for domain reports (e.g. "us"). */
  database: string;
  last_synced_at?: string;
  /** Set when the operator disconnects; cached metrics are preserved. */
  disconnected_at?: string;
};

/**
 * CallRail API — API token + account id (never sent to the client).
 * Token-header auth (no OAuth). `account_id` scopes the calls endpoint
 * (/v3/a/{account_id}/calls.json). Soft-disconnect via `disconnected_at`
 * mirrors the other connectors so cached call attribution is preserved.
 */
export type CallRailConnectorToken = {
  provider: "callrail";
  api_key: string;
  account_id: string;
  connected_at: string;
  last_synced_at?: string;
  disconnected_at?: string;
};

/**
 * Wix REST — site-level API key + site id (never sent to the client).
 * Header auth: `Authorization: <api_key>` + `wix-site-id: <site_id>`.
 * Powers the §push Wix adapter (CMS data items, blog drafts, media).
 * Soft-disconnect via `disconnected_at` preserves the url-map cache.
 */
export type WixConnectorToken = {
  provider: "wix";
  api_key: string;
  site_id: string;
  connected_at: string;
  last_synced_at?: string;
  disconnected_at?: string;
};

/**
 * Profound API — bearer key (never sent to the client). Answer-engine
 * visibility: citations, sentiment, fanouts. Connect-cards slice
 * (2026-06-12): self-serve key paste; the nightly fetcher activates
 * the moment a key lands (dormant-honest until then).
 */
export type ProfoundConnectorToken = {
  provider: "profound";
  api_key: string;
  connected_at: string;
  last_synced_at?: string;
  disconnected_at?: string;
};

/**
 * Microsoft Clarity Data Export API — per-project bearer token (never
 * sent to the client). Hard platform limits: 10 requests/day, 1-3 day
 * lookback, no backfill — the nightly harvester budgets ONE pull/day
 * and accumulates history locally (the research-note hedge).
 */
export type ClarityConnectorToken = {
  provider: "clarity";
  api_token: string;
  connected_at: string;
  last_synced_at?: string;
  disconnected_at?: string;
};

export type ConnectorToken =
  | GoogleConnectorToken
  | YelpConnectorToken
  | SemrushConnectorToken
  | CallRailConnectorToken
  | WixConnectorToken
  | ProfoundConnectorToken
  | ClarityConnectorToken;

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
  /** GA4 selected property id (google_ga4 only). null when the
   *  operator has connected GA4 but not yet selected a property
   *  (mid-flow state on the settings card). Slice 9.A1 (2026-05-18). */
  ga4_property_id?: string | null;
  /** GA4 selected property display name (google_ga4 only). */
  ga4_property_display_name?: string | null;
  /** GA4 account display name (google_ga4 only). */
  ga4_account_display_name?: string | null;
  /** Reconnect signal (Google only, 2026-06-15). ISO 8601 timestamp set by
   *  the sync path when the last sync ended in an auth failure (dead/revoked
   *  refresh token); null/absent when the connection is healthy. Read by
   *  `getConnectorHealth` to surface a "Reconnect" state. */
  auth_failed_at?: string | null;
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
  kind: "gsc" | "gbp" | "ga4" = "gsc",
  tenantId?: string,
): Promise<GoogleConnectorToken | null> {
  const provider: ConnectorProvider =
    kind === "gsc"
      ? "google_gsc"
      : kind === "gbp"
        ? "google_gbp"
        : "google_ga4";
  const t = await getConnectorToken(provider, tenantId);
  return t != null &&
    (t.provider === "google_gsc" ||
      t.provider === "google_gbp" ||
      t.provider === "google_ga4")
    ? (t as GoogleConnectorToken)
    : null;
}

export async function getYelpConnectorToken(
  tenantId?: string,
): Promise<YelpConnectorToken | null> {
  const t = await getConnectorToken("yelp", tenantId);
  return t != null && t.provider === "yelp" ? t : null;
}

export async function getSemrushConnectorToken(
  tenantId?: string,
): Promise<SemrushConnectorToken | null> {
  const t = await getConnectorToken("semrush", tenantId);
  return t != null && t.provider === "semrush" ? t : null;
}

export async function getWixConnectorToken(
  tenantId?: string,
): Promise<WixConnectorToken | null> {
  const t = await getConnectorToken("wix", tenantId);
  return t != null && t.provider === "wix" ? t : null;
}

export async function getCallRailConnectorToken(
  tenantId?: string,
): Promise<CallRailConnectorToken | null> {
  const t = await getConnectorToken("callrail", tenantId);
  return t != null && t.provider === "callrail" ? t : null;
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
  if (
    token.provider === "google_gsc" ||
    token.provider === "google_gbp" ||
    token.provider === "google_ga4"
  ) {
    // J5 (2026-05-18) — soft-disconnect: the row stays in
    // `connector_tokens` so cached historical state is preserved,
    // but `getConnectorInfo` reports `disconnected` when the
    // `disconnected_at` field is set. The UI then shows the Connect
    // button + the "Last refreshed at X days ago" tooltip.
    const sharedFields = {
      connected_at: token.connected_at,
      expires_at: token.expires_at,
      last_synced_at: token.last_synced_at ?? null,
      // GBP convenience fields (null on non-GBP providers).
      selected_location_id: token.selected_location_id ?? null,
      selected_location_name: token.selected_location_name ?? null,
      // GA4 convenience fields (null on non-GA4 providers). Slice
      // 9.A1 (2026-05-18) — surfaced so the settings card can
      // render the connected-with-property state without a second
      // round-trip to the token store.
      ga4_property_id: token.ga4_property_id ?? null,
      ga4_property_display_name: token.ga4_property_display_name ?? null,
      ga4_account_display_name: token.ga4_account_display_name ?? null,
      // Reconnect signal (2026-06-15) — carried through so
      // getConnectorHealth can surface a "Reconnect Google" state without a
      // second token read. Null on healthy connections + non-Google providers.
      auth_failed_at: token.auth_failed_at ?? null,
    } as const;
    if (token.disconnected_at != null && token.disconnected_at !== "") {
      return {
        status: "disconnected",
        ...sharedFields,
      };
    }
    return {
      status: "connected",
      ...sharedFields,
    };
  }
  // Semrush + CallRail soft-disconnect mirrors the Google connectors:
  // the row is preserved so cached data survives, but we report
  // `disconnected` when `disconnected_at` is set (UI shows Connect +
  // last-synced).
  const softDisconnected =
    (token.provider === "semrush" || token.provider === "callrail" || token.provider === "wix") &&
    token.disconnected_at != null &&
    token.disconnected_at !== "";
  return {
    status: softDisconnected ? "disconnected" : "connected",
    connected_at: token.connected_at,
    expires_at: null,
    last_synced_at: token.last_synced_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Honest connector health (derived) — 2026-06-15
// ─────────────────────────────────────────────────────────────────────

/**
 * Derived per-source health, beyond the binary connected/disconnected the
 * token row stores. The owner-reported trust bug: a source can be
 * `status: "connected"` (a token row exists, no `disconnected_at`) yet
 * deliver ZERO data — because the operator never picked a GA4 property, or
 * never ran a first refresh. A blanket green ✓ for those states is a lie.
 *
 *   • "connected"       — connected AND has reliably delivered (or can).
 *   • "needs_attention" — connected but provably not yet delivering data,
 *                         with an actionable plain-English reason.
 *   • "not_connected"   — no token / soft-disconnected.
 *
 * RELIABILITY NOTE (deliberately conservative — honesty over coverage):
 *
 *   We only flag `needs_attention` from signals that are PROVABLE at render
 *   time by reading the persisted token row (no live HTTP):
 *     0. `auth_failed_at` set → the last sync proved the grant is dead →
 *        Reconnect (HIGHEST priority — see below).
 *     1. GA4 connected but `ga4_property_id` is null/empty → 0 rows ever.
 *     2. Connected but `last_synced_at` is null → never pulled a reading.
 *     3. Connected + `last_synced_at` older than STALE_DAYS → soft hint.
 *
 *   We still do NOT derive reconnect state from `expires_at`. OAuth *access*
 *   tokens expire hourly but the *refresh* token is what matters — so
 *   `expires_at < now` alone is NOT "needs reconnect" (the next refresh
 *   silently heals it). The only authoritative reconnect signal is a FAILED
 *   refresh. The GSC/GA4 syncs classify that failure transiently
 *   (`gsc_token_expired` / `gsc_auth_failed_*` / GA4 `token_expired`) AND now
 *   PERSIST it onto the token row as `auth_failed_at` (set on the sync's
 *   auth-failure terminal branch, cleared on a successful sync). That
 *   persisted marker is what we read here — no live HTTP, no `expires_at`
 *   guessing.
 */
export type ConnectorHealth = "connected" | "needs_attention" | "not_connected";

export type ConnectorHealthInfo = ConnectorInfo & {
  health: ConnectorHealth;
  /** Plain-English, customer-facing, actionable. null when health is a
   *  plain "connected" or "not_connected" with nothing to say. */
  healthReason: string | null;
};

/** Connected-but-no-data is more than this many days stale → soft hint. */
const STALE_DAYS = 14;

/** Providers that require a per-source selection before any data can flow. */
function requiresPropertySelection(provider: ConnectorProvider): boolean {
  // GA4 pulls zero rows until the operator picks a property. (GBP needs a
  // location, but GBP is not a strip data source.)
  return provider === "google_ga4";
}

/**
 * Derive honest health for a single provider from its persisted token row.
 * Fail-soft: a token-store read error degrades to `not_connected` (never
 * throws, never blocks a render). Tenant-scoping is preserved end-to-end via
 * `getConnectorInfo` → `getConnectorToken`.
 */
export async function getConnectorHealth(
  provider: ConnectorProvider,
  tenantId?: string,
  now: number = Date.now(),
): Promise<ConnectorHealthInfo> {
  let info: ConnectorInfo;
  try {
    info = await getConnectorInfo(provider, tenantId);
  } catch {
    return {
      status: "disconnected",
      connected_at: null,
      expires_at: null,
      last_synced_at: null,
      health: "not_connected",
      healthReason: null,
    };
  }

  if (info.status !== "connected") {
    return { ...info, health: "not_connected", healthReason: null };
  }

  // Connected, but is it actually able to deliver data?

  // 0. Reconnect (HIGHEST priority — most urgent + most actionable). The
  // sync path stamps `auth_failed_at` when a Google sync TERMINATES in an
  // auth failure (the refresh token is dead/revoked/scope-lost). This is the
  // only authoritative reconnect signal — see the field doc on
  // GoogleConnectorToken. It outranks the GA4-no-property and stale rules:
  // those describe a working connection that just needs a nudge, whereas this
  // is a BROKEN connection that delivers nothing until the operator
  // re-authorizes. Read off info.auth_failed_at (carried through from the
  // token row by getConnectorInfo). Cleared back to null by the next
  // successful sync, which silently returns this to plain "connected".
  if (info.auth_failed_at != null && info.auth_failed_at !== "") {
    return {
      ...info,
      health: "needs_attention",
      healthReason: "Reconnect Google to refresh — the connection expired.",
    };
  }

  // 1. GA4 connected, no property picked → 0 rows will ever sync.
  if (
    requiresPropertySelection(provider) &&
    (info.ga4_property_id == null || info.ga4_property_id === "")
  ) {
    return {
      ...info,
      health: "needs_attention",
      healthReason:
        "Connected — pick your Analytics property to start pulling data.",
    };
  }

  // Data-freshness rules apply ONLY to read sources. Wix is publish-only —
  // it never "pulls a reading", so a connected Wix is always healthy (a
  // missing/old last_synced_at just means nothing's been published, not a
  // problem). Skipping it here also avoids the "pull your first reading"
  // copy nonsensically appearing on Wix.
  if (provider === "wix") {
    return { ...info, health: "connected", healthReason: null };
  }

  // 2. Connected + stale beyond STALE_DAYS → soft, non-alarming hint. Only
  // fires when last_synced_at is a REAL timestamp that is genuinely old. We
  // deliberately do NOT alarm on a null/empty last_synced_at: it is an
  // unreliable "never synced" signal (e.g. GSC can hold 90 days of data with
  // a null marker because the marker predates last-synced stamping), and a
  // false ⚠ on a source that actually has data is worse than staying quiet.
  if (info.last_synced_at != null && info.last_synced_at !== "") {
    const lastSynced = Date.parse(info.last_synced_at);
    if (Number.isFinite(lastSynced)) {
      const days = Math.floor(
        Math.max(0, now - lastSynced) / (24 * 60 * 60 * 1000),
      );
      if (days >= STALE_DAYS) {
        return {
          ...info,
          health: "needs_attention",
          healthReason: `Last pulled ${days} days ago — Refresh to update.`,
        };
      }
    }
  }

  return { ...info, health: "connected", healthReason: null };
}

/**
 * The read data-source connectors that, when ANY is connected, mean the
 * tenant is operating on its own LIVE data — not demo/sample content.
 * (google_gbp + callrail + yelp are excluded: GBP rides the gsc grant,
 * CallRail/Yelp are auxiliary, not a primary visibility/SEO/AEO source.)
 */
const REAL_DATA_SOURCE_PROVIDERS: ConnectorProvider[] = [
  "google_gsc",
  "google_ga4",
  "semrush",
  "profound",
  "clarity",
  "wix",
];

/**
 * True when the tenant has at least one real data source connected.
 * The single source of truth for "is this a real (non-demo) tenant" used
 * by the shell + the Today gate so a GSC-connected (but never-CSV-imported)
 * tenant sees its real command center, not the connect-prompt. Fail-soft:
 * a token-read error counts as not-connected for that provider (never
 * blocks the render). Parallel reads (cached tokens).
 */
export async function hasAnyConnectedDataSource(
  tenantId?: string,
): Promise<boolean> {
  const checks = await Promise.all(
    REAL_DATA_SOURCE_PROVIDERS.map(async (provider) => {
      try {
        const info = await getConnectorInfo(provider, tenantId);
        return info.status === "connected";
      } catch {
        return false;
      }
    }),
  );
  return checks.some(Boolean);
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
    // Slice 9.A1 (2026-05-18) — GA4 property selection patches the
    // existing google_ga4 token payload after the operator picks a
    // property in the settings UI.
    | "ga4_property_id"
    | "ga4_property_display_name"
    | "ga4_account_display_name"
    // J5 (2026-05-18) — soft-disconnect / reconnect flow patches the
    // payload's disconnected_at without touching the OAuth tokens.
    | "disconnected_at"
    // 2026-06-15 — auth-failure reconnect signal, set on sync auth
    // failure / cleared on sync success by the GSC + GA4 sync paths.
    | "auth_failed_at"
  >
>;
type YelpConnectorPatch = Partial<
  Pick<YelpConnectorToken, "api_key" | "last_synced_at" | "business_id">
>;
type SemrushConnectorPatch = Partial<
  Pick<
    SemrushConnectorToken,
    "api_key" | "database" | "last_synced_at" | "disconnected_at"
  >
>;
type CallRailConnectorPatch = Partial<
  Pick<
    CallRailConnectorToken,
    "api_key" | "account_id" | "last_synced_at" | "disconnected_at"
  >
>;
type WixConnectorPatch = Partial<
  Pick<
    WixConnectorToken,
    "api_key" | "site_id" | "last_synced_at" | "disconnected_at"
  >
>;
type ProfoundConnectorPatch = Partial<
  Pick<ProfoundConnectorToken, "api_key" | "last_synced_at" | "disconnected_at">
>;
type ClarityConnectorPatch = Partial<
  Pick<ClarityConnectorToken, "api_token" | "last_synced_at" | "disconnected_at">
>;

export async function updateConnectorToken(
  provider: "google_gsc" | "google_gbp" | "google_ga4",
  patch: GoogleConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "yelp",
  patch: YelpConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "semrush",
  patch: SemrushConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "callrail",
  patch: CallRailConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "wix",
  patch: WixConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "profound",
  patch: ProfoundConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: "clarity",
  patch: ClarityConnectorPatch,
  tenantId?: string,
): Promise<void>;
export async function updateConnectorToken(
  provider: ConnectorProvider,
  patch:
    | GoogleConnectorPatch
    | YelpConnectorPatch
    | SemrushConnectorPatch
    | CallRailConnectorPatch
    | WixConnectorPatch
    | ProfoundConnectorPatch
    | ClarityConnectorPatch,
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
  if (
    token.provider !== "google_gsc" &&
    token.provider !== "google_gbp" &&
    token.provider !== "google_ga4"
  ) {
    return false;
  }
  return Date.now() >= token.expires_at;
}
