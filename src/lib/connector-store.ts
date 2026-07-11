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
import { CONNECTION_LIVENESS_STALE_DAYS } from "@/domains/ops/source-freshness";

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
  /** Per-tenant OAuth (2026-07-09), the stable Google account id (`sub`
   *  from the id_token) this grant belongs to. Used by the OAuth callback
   *  to prove a re-consent is the SAME account before retaining a stored
   *  refresh token (never-erase guard). Absent on grants authorized before
   *  identity scopes were requested; those simply skip the same-account check
   *  until the next connect/replace. Never a secret. */
  google_account_sub?: string;
  /** Per-tenant OAuth (2026-07-09), the Google account email for this grant
   *  (from the id_token's `email` claim). Display-only ("Connected as
   *  <email>"), never used for API calls. Absent on older grants. */
  google_account_email?: string;
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
  /**
   * Topic-scoping (2026-06-24, operator-managed). When the tenant's AEO
   * prompts live as ONE topic inside a shared/borrowed Profound workspace
   * category (e.g. Iranopedia's prompts are one of 16 topics in a borrowed
   * "Frontier Models" category), set these in the SAME payload as the api_key
   * so the nightly sync scopes every report to the tenant's own topic instead
   * of pulling the whole (unrelated) category. `topic_id`/`category_id` are
   * Profound UUIDs; `topic_label` is a human label for surfaces. Optional —
   * unset → sync pulls the full category (original behavior).
   */
  category_id?: string;
  topic_id?: string;
  topic_label?: string;
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
  /** Per-tenant OAuth (2026-07-09), the Google account email for the connected
   *  grant (Google connectors only), surfaced as "Connected as <email>" on the
   *  connector card. null on older grants (authorized before identity scopes)
   *  and on non-Google providers. Never a secret. */
  google_account_email?: string | null;
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

/**
 * Discriminated token read (per-tenant OAuth never-erase guard, 2026-07-09).
 *
 * `getConnectorToken` soft-fails to null on TRANSIENT read errors, which is
 * right for status renders but catastrophic for the OAuth callback: a
 * soft-failed read there made "no stored refresh token" indistinguishable
 * from "could not check", and the callback's full-row upsert then OVERWROTE a
 * healthy stored refresh token with an empty string. This read distinguishes
 * the three states so write-path callers can ABORT (no write) on a failed
 * read instead of destroying state:
 *   • { ok: true, token }       : the row exists and parsed.
 *   • { ok: true, token: null } : provably NO row (including 42P01
 *     table-missing, which genuinely means nothing is stored).
 *   • { ok: false }             : the read itself failed; the truth is
 *     UNKNOWN. Never treat this as "no token".
 */
export type ConnectorTokenReadResult =
  | { ok: true; token: ConnectorToken | null }
  | { ok: false; reason: "store_unavailable" | "read_error" };

export async function readConnectorToken(
  provider: ConnectorProvider,
  tenantId?: string,
): Promise<ConnectorTokenReadResult> {
  const tid = await resolveTenantId(tenantId);
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // Supabase env vars are not configured in this environment. The truth is
    // unknowable here, so report the read as failed; render-path callers
    // (getConnectorToken) degrade this to "disconnected" as before.
    return { ok: false, reason: "store_unavailable" };
  }
  const { data, error } = await admin
    .from(TABLE)
    .select("payload")
    .eq("tenant_id", tid)
    .eq("provider", provider)
    .maybeSingle();

  if (error != null) {
    if (isUndefinedTableError(error)) return { ok: true, token: null };
    // Resilience (2026-06-17): a connector STATUS/token READ must never crash
    // the app. getConnectorInfo runs in the shell layout on EVERY render, so a
    // transient Supabase error (egress restriction / outage / timeout)
    // previously threw → 500'd the WHOLE app (white screen) instead of
    // degrading to "connect your tools". Log loudly and report the failure;
    // getConnectorToken degrades it to null (disconnected), while write-path
    // callers (the OAuth callback, saveConnectorToken's blank-refresh guard)
    // treat it as "unknown" and refuse to write.
    // eslint-disable-next-line no-console
    console.warn(
      `[connector-store] read failed for provider=${provider}, treating as disconnected (app stays up): ${(error.message ?? String(error)).slice(0, 200)}`,
    );
    return { ok: false, reason: "read_error" };
  }
  if (data == null) return { ok: true, token: null };
  const payload = (data as { payload: unknown }).payload;
  if (payload == null || typeof payload !== "object") {
    return { ok: true, token: null };
  }
  return { ok: true, token: payload as ConnectorToken };
}

export async function getConnectorToken(
  provider: ConnectorProvider,
  tenantId?: string,
): Promise<ConnectorToken | null> {
  const r = await readConnectorToken(provider, tenantId);
  // Read-side soft-fail preserved: render callers treat an unreadable store
  // as "no token connected" so the app stays up. Write paths must use
  // readConnectorToken directly and abort on ok:false.
  return r.ok ? r.token : null;
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
      // Per-tenant OAuth (2026-07-09), the connected Google account email,
      // surfaced as "Connected as <email>" on the card. Null on older grants.
      google_account_email: token.google_account_email ?? null,
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

/**
 * Connected-but-no-data is more than this many days stale → soft hint. Wave 3A
 * reconciliation: this is a SYNC-age connection-liveness threshold ("is this connection
 * still alive"), DISTINCT from the per-source DATA-age SLA (gsc 3d, profound 21d, clarity
 * 7d) that decides whether a source's numbers are current. Both now live in ONE module
 * (src/domains/ops/source-freshness.ts): the data-age SLA is SOURCE_SLA, this liveness
 * threshold is CONNECTION_LIVENESS_STALE_DAYS, so the three old scattered constants
 * (this 14, the strip's 24h, golden-path's 2d) can never drift apart again.
 */
const STALE_DAYS = CONNECTION_LIVENESS_STALE_DAYS;

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
    // A disconnected source can still hold FRESH cached data — e.g. a Google
    // OAuth refresh-token expired under testing-mode 7-day expiry, but the last
    // sync landed only days ago and the dashboard is actively rendering that
    // source's recent numbers. A bare "Connect →" then reads as "no data /
    // broken" when data is in fact present. Honest middle state: when there's a
    // genuinely recent last_synced_at (< STALE_DAYS), surface needs_attention
    // ("showing cached data · reconnect to refresh") so the card matches what the
    // page shows. Stale or never-synced → not_connected, as before.
    if (info.last_synced_at != null && info.last_synced_at !== "") {
      const lastSynced = Date.parse(info.last_synced_at);
      if (Number.isFinite(lastSynced)) {
        const days = Math.floor(
          Math.max(0, now - lastSynced) / (24 * 60 * 60 * 1000),
        );
        if (days < STALE_DAYS) {
          return {
            ...info,
            health: "needs_attention",
            healthReason:
              days < 1
                ? "Showing cached data. Reconnect to refresh."
                : `Showing data from ${days} day${days === 1 ? "" : "s"} ago. Reconnect to refresh.`,
          };
        }
      }
    }
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
      healthReason:
        "Reconnect Google to refresh. Google access needs renewing, reconnect now.",
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
        "Connected. Pick your Analytics property to start pulling data.",
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
          healthReason: `Last pulled ${days} days ago. Refresh to update.`,
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
  // SEMrush removed (dead; DataForSEO is the env-based search-market source).
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
  const isGoogle =
    token.provider === "google_gsc" ||
    token.provider === "google_gbp" ||
    token.provider === "google_ga4";
  if (isGoogle) {
    // DB-SIDE never-erase guard (operator guardrail, 2026-07-09): Google token
    // saves go through ONE atomic SQL statement (save_connector_token_guarded_v1,
    // mode 'connect') that preserves a stored non-empty refresh_token inside
    // the upsert itself and refuses (raises, statement rolls back) when neither
    // side has one. An app-side read-then-merge can be raced by two concurrent
    // callbacks or two Vercel instances; the database cannot.
    const { error: rpcError } = await admin.rpc("save_connector_token_guarded_v1", {
      p_tenant: tid,
      p_provider: token.provider,
      p_payload: token,
      p_mode: "connect",
    });
    if (rpcError == null) return;
    if (!isMissingRpcError(rpcError)) {
      throw new Error(
        `connector-store: guarded save failed for provider=${token.provider}: ${rpcError.message ?? String(rpcError)}`,
      );
    }
    // The guarded RPC is not installed on this database (fresh install, or the
    // migration is not applied yet). Fall back to the app-side guarded path
    // below, LOUDLY, so a missing migration can never brick a connect.
    // eslint-disable-next-line no-console
    console.warn(
      `[connector-store] save_connector_token_guarded_v1 missing (apply migrations/2026-07-09_connector_token_guarded_upsert.sql); falling back to the app-side guarded save for provider=${token.provider}`,
    );
    // NEVER-ERASE assertion (app-side fallback; also defense in depth behind
    // the OAuth callback's own guard): an EMPTY refresh_token must never
    // replace a stored non-empty one, under ANY code path. Google refresh
    // tokens are only minted at consent; overwriting one with "" bricks the
    // grant silently (the access token dies in about an hour with no
    // self-heal). If the stored row cannot be READ, the truth is unknown, so
    // the write is refused too.
    if (token.refresh_token === "") {
      const existing = await readConnectorToken(token.provider, tid);
      if (!existing.ok) {
        throw new Error(
          `connector-store: refused to save provider=${token.provider} with an empty refresh_token because the stored token could not be read (${existing.reason}); an empty value must never overwrite an unknown stored state`,
        );
      }
      if (
        existing.token != null &&
        "refresh_token" in existing.token &&
        existing.token.refresh_token
      ) {
        throw new Error(
          `connector-store: refused to overwrite the stored non-empty refresh_token for provider=${token.provider} with an empty one`,
        );
      }
      // Parity with the RPC's fail-closed rule: a Google row must never be
      // WRITTEN with an empty refresh_token at all (it would die in about an
      // hour with no self-heal). Nothing usable is stored either, so refuse.
      throw new Error(
        `connector-store: refused to save provider=${token.provider} with no usable refresh token (incoming empty, nothing stored); connect again so Google mints one`,
      );
    }
  }
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

/** PostgREST "function not found" (PGRST202, a stale schema cache PGRST205, or
 *  raw Postgres 42883) - the ONLY errors allowed to route a guarded write to
 *  the app-side fallback. Every other error must surface to the caller. */
function isMissingRpcError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "PGRST205" || code === "42883") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function");
}

// NOTE (2026-07-09, review P1-1): `refresh_token` is DELIBERATELY excluded from
// this patch type. A rotated refresh token must be persisted through
// `persistRefreshedGoogleToken` (guarded mode 'refresh', the cross-instance
// compare-and-swap), never via `updateConnectorToken` — the patch path is
// UPDATE-only, strips refresh_token in SQL, and throws at runtime if a caller
// includes one, so no future caller can reintroduce the read-merge-write race
// that resurrected a stale refresh token / dropped a rotation.
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
  const isGoogle =
    provider === "google_gsc" ||
    provider === "google_gbp" ||
    provider === "google_ga4";
  if (isGoogle) {
    // DB-SIDE patch (operator guardrail, 2026-07-09; review finding P1-1): a
    // Google field patch (last_synced_at, ga4_property_id, disconnected_at,
    // auth_failed_at, selected_location_*) goes through ONE atomic SQL statement
    // (save_connector_token_guarded_v1, mode 'patch') that merges the patch onto
    // the stored row WITHOUT ever touching refresh_token. The old app-side
    // read-then-merge-then-full-upsert could be raced by two Vercel instances:
    // one reads a row, another rotates the refresh_token, then the first writes
    // the stale row back, resurrecting a dead refresh_token and dropping the
    // rotation. p_payload is the PATCH ONLY (not a merged full row).
    //
    // REFUSE refresh_token here (no future caller reintroduces the race): a
    // rotated refresh_token is the ONE thing a patch must never carry. The SQL
    // strips it defensively, but a patch that thinks it can write one is a bug.
    // Rotations go through persistRefreshedGoogleToken (mode 'refresh', the
    // cross-instance compare-and-swap).
    if ("refresh_token" in patch) {
      throw new Error(
        `connector-store: updateConnectorToken must not carry a refresh_token for provider=${provider}; persist a rotated refresh token through persistRefreshedGoogleToken (guarded mode 'refresh'), never a patch`,
      );
    }
    const admin = getSupabaseAdmin();
    const { error: rpcError } = await admin.rpc("save_connector_token_guarded_v1", {
      p_tenant: tid,
      p_provider: provider,
      p_payload: patch,
      p_mode: "patch",
    });
    if (rpcError == null) return;
    if (!isMissingRpcError(rpcError)) {
      throw new Error(
        `connector-store: guarded patch failed for provider=${provider}: ${rpcError.message ?? String(rpcError)}`,
      );
    }
    // The guarded RPC is not installed on this database (fresh install, or the
    // patch-mode migration is not applied yet). Fall back to the app-side
    // read-merge-write LOUDLY so a missing migration can never brick a patch.
    // This fallback keeps the pre-guard behavior: it merges onto the stored row
    // (which retains its refresh_token) and saves via the connect-guarded path.
    // eslint-disable-next-line no-console
    console.warn(
      `[connector-store] save_connector_token_guarded_v1 missing (apply migrations/2026-07-09_connector_token_patch_mode.sql); falling back to the app-side read-merge-write patch for provider=${provider}`,
    );
    const existing = await getConnectorToken(provider, tid);
    if (existing == null) return;
    if (existing.provider !== provider) return;
    const merged = { ...existing, ...patch } as ConnectorToken;
    await saveConnectorToken(merged, tid);
    return;
  }
  // Non-Google providers keep the app-side read-merge-write (no OAuth
  // refresh-token race to guard against).
  const existing = await getConnectorToken(provider, tid);
  if (existing == null) return;
  if (existing.provider !== provider) return;
  const merged = { ...existing, ...patch } as ConnectorToken;
  await saveConnectorToken(merged, tid);
}

/**
 * FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): persist a refreshed Google token
 * best-effort. Writes ONLY the changed fields via `updateConnectorToken`
 * (merge, not full-row upsert) so a rotated refresh_token — when Google
 * returned one — is never lost, and the rest of the payload (scopes,
 * connected_at, disconnected_at, ga4_property_id, ...) is never clobbered.
 * The refresh_token field is included ONLY when Google actually rotated it,
 * so this never overwrites the stored token with an empty value.
 *
 * Fail-soft: a persist error is logged and swallowed — the in-memory token
 * still serves the current run (mirrors the existing per-caller persist
 * posture). Callers that already write `access_token`/`expires_at` themselves
 * (with additional fields like `last_synced_at`) keep doing so; this helper
 * is for the refresh sites that either persisted nothing or want a one-call
 * rotation-safe write.
 */
export async function persistRefreshedGoogleToken(
  provider: "google_gsc" | "google_gbp" | "google_ga4",
  refreshed: { access_token: string; expires_in: number; refresh_token?: string },
  tenantId?: string,
): Promise<void> {
  try {
    const tid = await resolveTenantId(tenantId);
    const newExpiresAt = Date.now() + refreshed.expires_in * 1000;
    // DB-SIDE compare-and-swap (operator guardrail, 2026-07-09): the RPC's
    // 'refresh' mode UPDATEs only where the incoming expires_at is strictly
    // newer than the stored one. That conditional is the CROSS-INSTANCE race
    // resolution: the in-process single-flight in google-auth.ts only dedupes
    // within one lambda, so two Vercel instances refreshing concurrently must
    // resolve at the database, and the staler write silently no-ops. It also
    // never inserts and only touches refresh_token when Google rotated it.
    const admin = getSupabaseAdmin();
    const rpcPayload: Record<string, unknown> = {
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
    };
    if (refreshed.refresh_token) rpcPayload.refresh_token = refreshed.refresh_token;
    const { error: rpcError } = await admin.rpc("save_connector_token_guarded_v1", {
      p_tenant: tid,
      p_provider: provider,
      p_payload: rpcPayload,
      p_mode: "refresh",
    });
    if (rpcError == null) return;
    if (!isMissingRpcError(rpcError)) {
      throw new Error(rpcError.message ?? String(rpcError));
    }
    // RPC not installed: app-side fallback mirrors the same rules (loudly).
    // Monotonic guard first, so even the fallback cannot clobber a FRESHER
    // stored token with this staler one; rotation (a new refresh_token) always
    // persists because its expiry is by construction the newest.
    // eslint-disable-next-line no-console
    console.warn(
      `[connector-store] save_connector_token_guarded_v1 missing (apply migrations/2026-07-09_connector_token_guarded_upsert.sql); falling back to the app-side refresh persist for provider=${provider}`,
    );
    const existing = await getConnectorToken(provider, tid);
    if (existing == null || existing.provider !== provider) return;
    if (existing.expires_at >= newExpiresAt) return; // staler write: no-op (CAS mirror)
    // Write directly via saveConnectorToken, NOT updateConnectorToken: this is
    // the ONE path allowed to persist a rotated refresh_token, and
    // updateConnectorToken now refuses that field (it routes through the
    // patch-mode RPC, which strips refresh_token in SQL). We already hold the
    // read + the monotonic CAS guard above, so merge and save here — the merged
    // row keeps its stored (or freshly-rotated) refresh_token, so the
    // connect-guarded save accepts it.
    const merged: GoogleConnectorToken = {
      ...(existing as GoogleConnectorToken),
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
    };
    if (refreshed.refresh_token) {
      merged.refresh_token = refreshed.refresh_token;
    }
    await saveConnectorToken(merged, tid);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[connector-store] persistRefreshedGoogleToken failed for provider=${provider}, continuing with in-memory token: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
    );
  }
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
