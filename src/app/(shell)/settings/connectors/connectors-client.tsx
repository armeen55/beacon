"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConnectorInfo } from "@/lib/connector-store";
import { CONNECTOR_REGISTRY, type ConnectorRollup } from "@/lib/connectors/registry";
import type { Ga4Property } from "@/lib/connectors/ga4/types";
import { Pill } from "@/components/ui/pill";
import {
  getGoogleAuthUrl,
  getGoogleGscConnectorStatus,
  getGoogleGa4ConnectorStatus,
  getWixConnectorStatus,
  disconnectGoogle,
  disconnectGoogleGa4,
  saveWixConnection,
  disconnectWix,
  saveClarityConnection,
  disconnectClarity,
  syncGoogleReviews,
  loadGoogleLocations,
  selectGoogleLocation,
  listGa4Properties,
  selectGa4Property,
  syncGscNow,
  syncGa4Now,
  syncClarityNow,
  discoverWixCollections,
} from "./actions";
import type { ConnectorSyncNowResult } from "./actions";

type SelectedLocation = { id: string; name: string } | null;

type LocationOption = { locationId: string; locationName: string; address: string | null };

/**
 * 2026-05-16, GSC scope split: the Google card is GSC-focused for v1.
 * Sync now + Location picker are GBP-only affordances; both flip on
 * when the deferred GBP card lands in a follow-up slice. Action code
 * + server actions stay wired; only the UI surfaces are gated.
 */
const GBP_AFFORDANCES_ENABLED = false;

type Props = {
  google: ConnectorInfo;
  googleSelectedLocation: SelectedLocation;
  /** Slice 9.A1β (2026-05-18), GA4 connector status. Mirrors the
   *  GSC props shape (status, expires_at, ga4_property_id, etc.). */
  ga4: ConnectorInfo;
  /** North-star onboarding (2026-06-11), self-serve Wix connection. */
  wix: ConnectorInfo;
  clarity: ConnectorInfo;
  /** J5 (2026-05-18), pre-rendered "GSC data last refreshed X days
   *  ago. Reconnect to refresh." copy. Computed server-side in
   *  page.tsx so the formatting helper stays `server-only`. Present
   *  only when the GSC connector has a non-null `expires_at` (i.e.,
   *  the operator previously authorized the connector at some
   *  point) AND status is "disconnected". `null` otherwise. */
  gscStaleCopy?: string | null;
  /** MAX_SEO_AEO Phase 4 (2026-06-16), pre-composed GSC readiness for the
   *  card: the resolved property (the one synced data landed under, derived
   *  from the tenant's own rows, never hardcoded), a plain-English
   *  headline/detail, a hard not-ready verdict, and a tone for styling. All
   *  computed server-side in page.tsx (the loader is server-only + does no live
   *  Google call). Always present (the page soft-fails to a not_connected
   *  shape) so the card can always render an honest readiness line. */
  gscReadiness?: {
    verdict:
      | "ready"
      | "connected_no_data"
      | "not_connected"
      | "needs_reconnect";
    headline: string;
    detail: string;
    tone: "ready" | "attention" | "idle";
    property: string | null;
  };
  /** R17a (v1 266), pre-composed missing-days line for the GSC card, e.g.
   *  "I am missing 2 days of Google data between Jun 14 and Jun 15. I will
   *  re-pull them automatically while you use Beacon." Computed server-side
   *  in page.tsx from the same daily totals the sync writes. Null when
   *  nothing is missing inside the covered range (the card renders exactly
   *  as before). */
  gscGapLine?: string | null;
  /** Slice 9.A1β (2026-05-18), pre-rendered "Google Analytics data
   *  last refreshed X days ago" copy. Computed server-side in
   *  page.tsx. Present only when the GA4 connector has a non-null
   *  `expires_at` AND status is "disconnected". `null` otherwise. */
  ga4StaleCopy?: string | null;
  /** FP10a (2026-07-02), summary strip counts: how many of the self-serve
   *  sources (GSC, GA4, Wix, Clarity) are connected right now,
   *  out of how many exist. Computed server-side in page.tsx. Defaults keep
   *  older render-test callers (pre-FP10a) working without every prop. */
  connectedCount?: number;
  totalCount?: number;
  /** Honest connector health rollup (2026-07-20). Computed server-side in
   *  page.tsx from the SAME per-connector health the cards render, so the
   *  headline + subline count impaired sources truthfully (connected-but-failing
   *  GA4 ingest, authorized-but-blocked Wix publish) and can never read
   *  "4 of 4 connected" while a source is broken. Optional so pre-existing
   *  render-test callers keep working; when absent the strip falls back to the
   *  bare connected count. */
  rollup?: ConnectorRollup;
  /** T0b (2026-07-03), how many pages Wix's url map currently covers.
   *  Computed server-side in page.tsx from getWixUrlMap().length. A
   *  connected-but-zero-mapped Wix can't publish anything, this drives the
   *  Discover collections fix block on the Wix card. */
  wixUrlMapCount?: number;
  /** BUG 3 (2026-07-11), per-source refresh-ledger facts for the "last pulled /
   *  data through / result" strip. Keyed by ledger source name (gsc/ga4/clarity/
   *  profound). Computed server-side in page.tsx from latestRefreshBySource.
   *  Optional + self-hiding so pre-BUG3 render-test callers are unaffected. */
  refreshLedger?: RefreshLedgerFacts;
};

/** BUG 3 (2026-07-11) per-source refresh-ledger fact for one source, as the
 *  page hands it to the client (plain, serializable). */
export type RefreshLedgerFact = {
  /** ISO 8601 timestamp of the most recent refresh of this source. */
  lastPulled: string;
  /** Newest source data date after that run (YYYY-MM-DD), or null when unknown. */
  dataThrough: string | null;
  result: "ok" | "partial" | "failed";
  /** Honest reason code when result !== "ok" (e.g. "no new data"). */
  reason: string | null;
};

export type RefreshLedgerFacts = Partial<
  Record<"gsc" | "ga4" | "clarity", RefreshLedgerFact>
>;

/** FP10a (2026-07-02) - one line per source: what it actually feeds, in
 *  plain English. Lives here once so it never has to repeat in a footer
 *  paragraph, a capability block, AND a page-level intro. */
const SOURCE_SUMMARY: Record<string, string> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.id, c.summary]),
);

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google authorization was denied. You can try again when ready.",
  no_code: "No authorization code received from Google. Please try again.",
  invalid_state:
    "Authorization could not be verified. The connect link may have expired, please try Connect again.",
  exchange_failed:
    "Failed to complete authorization with Google. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly.",
  persistence_failed:
    "Authorization succeeded but Beacon could not save the connection. Please try again, or contact support if it persists.",
  env_missing:
    "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and BEACON_OAUTH_STATE_SECRET in your environment.",
  // #213, the callback emits ?error=not_authorized when Google grants
  // but the signed-in user isn't a member of the connecting account.
  // Pre-fix this fell through to the raw "Connection error: not_authorized".
  not_authorized:
    "You declined the Google permission. Try connecting again and approve access.",
  // Per-tenant OAuth never-erase guard (2026-07-09): Google gave no ongoing
  // access and I could not safely keep the previous connection, so I changed
  // nothing. The fix that always works: revoke Beacon's access on the Google
  // side, then connect again so Google issues fresh ongoing access.
  refresh_token_missing:
    "Google did not give me ongoing access, so I kept everything unchanged. Click Connect to try again. If this happens twice, open myaccount.google.com/permissions, remove Beacon's access for this Google account, then click Connect again.",
  // Per-tenant OAuth replace semantics (2026-07-09): a replacement picked a
  // DIFFERENT Google account but Google gave no ongoing access for it, so the
  // existing connection stays exactly as it was.
  account_mismatch:
    "That is a different Google account, and Google did not give me ongoing access for it, so I kept your current connection unchanged. To switch accounts, open myaccount.google.com/permissions signed in as the new account, remove Beacon's access, then click Replace Google account again.",
};

// #213, friendly catch-all for any error code we don't have explicit copy
// for, so a non-technical owner never sees a raw code like "not_authorized".
const DEFAULT_ERROR_MESSAGE =
  "Couldn't connect to Google, please try again.";

// 2026-06-22, when the token exchange fails, the callback forwards Google's
// actual `error` code as ?detail=…. Turn it into the precise fix so an opaque
// "check your creds" becomes "here's exactly what's wrong".
const EXCHANGE_DETAIL_HINTS: Record<string, string> = {
  invalid_client:
    " Google rejected the app credentials, GOOGLE_CLIENT_SECRET in Vercel is wrong/missing or doesn't match GOOGLE_CLIENT_ID. Re-copy both from Google Cloud Console → Credentials into Vercel (Production scope), then redeploy.",
  redirect_uri_mismatch:
    " This domain's callback URL isn't registered. In Google Cloud Console → Credentials → your OAuth client, add the Authorized redirect URI https://<this-domain>/api/connectors/google/callback (and make sure NEXT_PUBLIC_APP_URL matches this domain).",
  invalid_grant:
    " The authorization code expired or was already used, just click Connect again.",
  unauthorized_client:
    " This OAuth client can't use this grant, confirm it's a 'Web application' client in Google Cloud Console.",
  invalid_request:
    " Google rejected the request, usually a redirect-URI or client-config mismatch.",
};

// (The old #90 ?warning=missing_refresh_token degraded-success path was
// removed 2026-07-09: the callback now never stores a grant without a usable
// refresh token, so it redirects with ?error=refresh_token_missing instead.)

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Friendly "Jul 8" for a YYYY-MM-DD source data date. Null-safe. */
function formatDataDate(ymd?: string | null): string | null {
  if (!ymd) return null;
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return null;
  }
}

/**
 * BUG 3 (2026-07-11): the per-source refresh-ledger line. States, in plain
 * English, when this source was last pulled, what date its data is current
 * through, and whether the pull worked - the honest facts the operator asked
 * for. Self-hides when there is no ledger row yet. This is the surface that
 * makes a "synced today but the newest data is weeks old" partial visible.
 */
function RefreshLedgerLine({ fact }: { fact?: RefreshLedgerFact }) {
  if (fact == null) return null;
  const when = formatDate(fact.lastPulled);
  const through = formatDataDate(fact.dataThrough);
  const base =
    through != null
      ? `Last pulled ${when}, data through ${through}.`
      : `Last pulled ${when}.`;
  const verdict =
    fact.result === "ok"
      ? ""
      : fact.result === "partial"
        ? " No new data came back that time."
        : " That pull did not work; I will try again on my own.";
  const tone =
    fact.result === "failed"
      ? "text-status-warning"
      : fact.result === "partial"
        ? "text-status-warning"
        : "text-muted-foreground";
  return (
    <p className={`text-[12px] ${tone}`} data-refresh-ledger={fact.result}>
      {base}
      {verdict}
    </p>
  );
}

export function ConnectorsClient({
  google: initialGoogle,
  googleSelectedLocation: initialSelectedLocation,
  ga4: initialGa4,
  wix: initialWix,
  clarity: initialClarity,
  gscStaleCopy = null,
  gscReadiness,
  gscGapLine = null,
  ga4StaleCopy = null,
  connectedCount = 0,
  totalCount = CONNECTOR_REGISTRY.length,
  rollup,
  wixUrlMapCount = 0,
  refreshLedger = {},
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [google, setGoogle] = useState<ConnectorInfo>(initialGoogle);
  const [ga4, setGa4] = useState<ConnectorInfo>(initialGa4);
  const [wix, setWix] = useState<ConnectorInfo>(initialWix);
  const [wixKeyInput, setWixKeyInput] = useState("");
  const [wixSiteIdInput, setWixSiteIdInput] = useState("");
  // Wix page mapping (relocated 2026-07-20 from the retired /diagnostics/wix).
  // The Discover collections button on the connected Wix card runs the relocated
  // server action and reports the resulting mapped-page count right here.
  const [wixDiscoverPending, setWixDiscoverPending] = useState(false);
  const [wixDiscoverResult, setWixDiscoverResult] = useState<
    { ok: boolean; text: string } | null
  >(null);
  // Connect-cards slice (2026-06-12)
  const [clarity, setClarity] = useState<ConnectorInfo>(initialClarity);
  const [clarityTokenInput, setClarityTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [googleSyncInFlight, setGoogleSyncInFlight] = useState(false);

  // Customer "Pull my data now" affordances (2026-06-14), each
  // connected source gets a per-card sync button wired to its
  // server action; a per-card pending flag + last-result message
  // mirror the Google/Yelp Sync-now idiom above.
  type SyncResultMsg = { ok: boolean; text: string } | null;
  const [gscSyncPending, setGscSyncPending] = useState(false);
  const [gscSyncResult, setGscSyncResult] = useState<SyncResultMsg>(null);
  const [ga4SyncPending, setGa4SyncPending] = useState(false);
  const [ga4SyncResult, setGa4SyncResult] = useState<SyncResultMsg>(null);
  const [claritySyncPending, setClaritySyncPending] = useState(false);
  const [claritySyncResult, setClaritySyncResult] = useState<SyncResultMsg>(null);

  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation>(initialSelectedLocation);
  const [locationOptions, setLocationOptions] = useState<LocationOption[] | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Slice 9.A1β (2026-05-18), GA4 property picker state. The list of
  // properties is loaded ONLY on explicit user action (Choose property
  // button); never on mount, so the page-load contract stays intact
  // (no GA4 API call on page render, enforced by the
  // `ga4-no-page-load-call` architecture invariant).
  const [ga4Properties, setGa4Properties] = useState<Ga4Property[] | null>(null);
  const [ga4PropertiesLoading, setGa4PropertiesLoading] = useState(false);
  const [ga4PropertyError, setGa4PropertyError] = useState<string | null>(null);

  useEffect(() => {
    const err = searchParams.get("error");
    const connected = searchParams.get("connected");
    if (err) {
      const detail = searchParams.get("detail");
      const hint = detail ? (EXCHANGE_DETAIL_HINTS[detail] ?? ` (${detail})`) : "";
      setError((ERROR_MESSAGES[err] ?? DEFAULT_ERROR_MESSAGE) + hint);
      window.history.replaceState(null, "", "/settings/connectors");
    }
    if (connected === "google_gsc") {
      setSuccess("Google Search Console connected successfully.");
      startTransition(async () => {
        const status = await getGoogleGscConnectorStatus();
        setGoogle(status);
      });
      window.history.replaceState(null, "", "/settings/connectors");
    }
    if (connected === "google_ga4") {
      setSuccess(
        "Google Analytics connected. Choose a property to finish setup.",
      );
      startTransition(async () => {
        const status = await getGoogleGa4ConnectorStatus();
        setGa4(status);
      });
      window.history.replaceState(null, "", "/settings/connectors");
    }
  }, [searchParams]);

  async function handleLoadLocations() {
    setLocationError(null);
    setLocationsLoading(true);
    try {
      const result = await loadGoogleLocations();
      if (!result.ok) {
        setLocationError(result.message);
        return;
      }
      const locs = result.locations;
      setLocationOptions(locs);
      if (locs.length === 1 && !selectedLocation) {
        await handleSelectLocation(locs[0]!);
      }
    } catch (e) {
      setLocationError(e instanceof Error ? e.message : "Failed to load locations.");
    } finally {
      setLocationsLoading(false);
    }
  }

  async function handleSelectLocation(loc: LocationOption) {
    setLocationError(null);
    const result = await selectGoogleLocation(loc.locationId, loc.locationName);
    if (result.success) {
      setSelectedLocation({ id: loc.locationId, name: loc.locationName });
      setSuccess(`Location selected: ${loc.locationName}`);
      router.refresh();
    } else {
      setLocationError(result.error ?? "Failed to select location.");
    }
  }

  function handleConnect() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await getGoogleAuthUrl();
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(
          ERROR_MESSAGES.env_missing,
        );
      }
    });
  }

  // Per-tenant OAuth (2026-07-09): deliberately swap the Google account
  // behind a LIVE grant. The server action verifies a live grant exists and
  // threads intent="replace" into the auth URL + signed state; Google shows
  // the account chooser and mints a fresh refresh token for the chosen
  // account. The callback fully overwrites the row only when that fresh
  // refresh token actually arrives; otherwise nothing changes.
  function handleReplaceGoogle(kind: "gsc" | "ga4") {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await getGoogleAuthUrl(kind, "replace");
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(ERROR_MESSAGES.env_missing);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // Slice 9.A1β (2026-05-18), GA4 handlers
  // ───────────────────────────────────────────────────────────────────

  function handleConnectGa4() {
    setError(null);
    setSuccess(null);
    setGa4PropertyError(null);
    startTransition(async () => {
      const result = await getGoogleAuthUrl("ga4");
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(ERROR_MESSAGES.env_missing);
      }
    });
  }

  async function handleLoadGa4Properties() {
    setGa4PropertyError(null);
    setGa4PropertiesLoading(true);
    try {
      const result = await listGa4Properties();
      if (!result.ok) {
        const map: Record<string, string> = {
          no_token: "Beacon is not connected to Google Analytics yet.",
          token_expired:
            "Beacon's Google Analytics access expired. Reconnect to refresh.",
          disconnected:
            "Beacon's Google Analytics connection was disconnected. Reconnect to choose a property.",
          api_error:
            "Could not load Google Analytics properties. Try again in a moment.",
        };
        setGa4PropertyError(
          map[result.reason] ?? "Could not load properties.",
        );
        return;
      }
      setGa4Properties(result.properties);
      if (result.properties.length === 1) {
        // Auto-select the only property, saves a click in the common case.
        await handleSelectGa4Property(result.properties[0]!);
      }
    } catch (e) {
      setGa4PropertyError(
        e instanceof Error ? e.message : "Could not load properties.",
      );
    } finally {
      setGa4PropertiesLoading(false);
    }
  }

  async function handleSelectGa4Property(property: Ga4Property) {
    setGa4PropertyError(null);
    const result = await selectGa4Property({
      id: property.id,
      displayName: property.displayName,
      accountDisplayName: property.accountDisplayName,
    });
    if (result.success) {
      setSuccess(`Property selected: ${property.displayName}`);
      const status = await getGoogleGa4ConnectorStatus();
      setGa4(status);
      router.refresh();
    } else {
      setGa4PropertyError(result.error ?? "Failed to select property.");
    }
  }

  function handleDisconnectGa4() {
    setError(null);
    setSuccess(null);
    setGa4PropertyError(null);
    startTransition(async () => {
      const result = await disconnectGoogleGa4();
      if (result.success) {
        // Soft-disconnect mirror of GSC: preserve connected_at +
        // expires_at so the stale tooltip renders on next refresh.
        setGa4({
          status: "disconnected",
          connected_at: ga4.connected_at,
          expires_at: ga4.expires_at,
          last_synced_at: null,
          ga4_property_id: null,
          ga4_property_display_name: null,
          ga4_account_display_name: null,
        });
        setGa4Properties(null);
        setSuccess("Google Analytics disconnected. Previously synced data is preserved.");
        router.refresh();
      } else {
        setError(result.error ?? "Failed to disconnect Google Analytics.");
      }
    });
  }

  function handleDisconnect() {
    // #206, "Disconnect Google" clears BOTH the Search Console grant AND
    // any Google Business Profile connection in one action. Confirm first so
    // a Business Profile connection isn't dropped silently.
    const confirmed = window.confirm(
      "Disconnect Google? This disconnects Google Search Console and any connected Google Business Profile. Your previously synced data stays, reconnect any time to resume updates.",
    );
    if (!confirmed) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await disconnectGoogle();
      if (result.success) {
        setGoogle({
          status: "disconnected",
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        });
        setSelectedLocation(null);
        setLocationOptions(null);
        setSuccess("Google disconnected. Previously synced data is preserved.");
        router.refresh();
      } else {
        setError(result.error ?? "Failed to disconnect.");
      }
    });
  }

  async function handleGoogleSyncNow() {
    setError(null);
    setSuccess(null);
    setGoogleSyncInFlight(true);
    try {
      const result = await syncGoogleReviews();
      if (!result.ok) {
        if (result.code === "no_location") {
          setError(result.message);
          setLocationOptions(null);
        } else if (result.code === "reconnect") {
          setError(result.message);
        } else {
          setError(result.message || "Sync failed.");
        }
        return;
      }
      const status = await getGoogleGscConnectorStatus();
      setGoogle(status);
      let msg = `Synced ${result.imported} review${result.imported === 1 ? "" : "s"} from Google.`;
      if (result.rejected > 0) {
        msg += ` ${result.rejected} row${result.rejected === 1 ? "" : "s"} skipped (invalid data).`;
      }
      if (result.partial && result.warnings.length > 0) {
        msg += ` Completed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}, some data may be incomplete.`;
      }
      setSuccess(msg);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setGoogleSyncInFlight(false);
    }
  }

  function handleSaveWixConnection() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveWixConnection({
        apiKey: wixKeyInput,
        siteId: wixSiteIdInput,
      });
      if (result.success) {
        setWixKeyInput("");
        setWixSiteIdInput("");
        const status = await getWixConnectorStatus();
        setWix(status);
        setSuccess(
          "Wix connected. Beacon can now prepare publish-ready edits for your site, and every change waits for your explicit approval before anything goes live.",
        );
      } else {
        setError(result.error ?? "Could not save the Wix connection.");
      }
    });
  }

  function handleSaveSimpleConnection(
    save: () => Promise<{ success: boolean; error?: string }>,
    setInfo: (i: ConnectorInfo) => void,
    clear: () => void,
  ) {
    startTransition(async () => {
      const result = await save();
      if (result.success) {
        setError(null);
        setInfo({
          status: "connected",
          connected_at: new Date().toISOString(),
          expires_at: null,
          last_synced_at: null,
        });
        clear();
      } else {
        setError(
          result.error ?? "Couldn't update this connection, please try again.",
        );
      }
    });
  }

  function handleSimpleDisconnect(
    disconnect: () => Promise<{ success: boolean; error?: string }>,
    setInfo: (i: ConnectorInfo) => void,
  ) {
    startTransition(async () => {
      const result = await disconnect();
      if (result.success) {
        setError(null);
        setInfo({
          status: "disconnected",
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        });
      } else {
        setError(
          result.error ?? "Couldn't update this connection, please try again.",
        );
      }
    });
  }

  function handleDisconnectWix() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await disconnectWix();
      if (result.success) {
        setWix({
          status: "disconnected",
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        });
        setSuccess("Wix disconnected.");
      } else {
        setError(result.error ?? "Could not disconnect Wix.");
      }
    });
  }

  // Discover collections (relocated from /diagnostics/wix). Runs read-only
  // discovery + builds the url map, then reports the mapped-page count. router
  // .refresh() so a now-mapped Wix (count > 0) re-renders healthy (the fix block
  // self-hides). All copy is first person, no dashes.
  function discoverErrorText(reason: string): string {
    switch (reason) {
      case "no_key":
        return "Wix is not connected yet. Add your Wix API key and site id above first.";
      case "disconnected":
        return "Wix is disconnected. Reconnect it above, then click Discover collections again.";
      case "sync_failed":
        return "I reached Wix but could not build your page map. Set your website domain in Settings, Business info if you have not, then try again.";
      default:
        return "I could not reach Wix just now. Please try again in a moment.";
    }
  }

  async function handleDiscoverWixCollections() {
    setWixDiscoverResult(null);
    setWixDiscoverPending(true);
    try {
      const result = await discoverWixCollections();
      if (result.ok && result.mappedPages > 0) {
        setWixDiscoverResult({
          ok: true,
          text: `I mapped ${result.mappedPages.toLocaleString()} page${
            result.mappedPages === 1 ? "" : "s"
          } across ${result.collectionsMapped} collection${
            result.collectionsMapped === 1 ? "" : "s"
          }. You can publish approved changes to your site now.`,
        });
        router.refresh();
      } else if (result.ok) {
        setWixDiscoverResult({
          ok: false,
          text: `I found ${result.collectionsFound} collection${
            result.collectionsFound === 1 ? "" : "s"
          } but could not map any pages yet. Check that your Wix collections have published items with a page address.`,
        });
      } else {
        setWixDiscoverResult({ ok: false, text: discoverErrorText(result.reason) });
      }
    } catch (e) {
      setWixDiscoverResult({
        ok: false,
        text: e instanceof Error && e.message ? e.message : "I could not finish mapping just now. Please try again in a moment.",
      });
    } finally {
      setWixDiscoverPending(false);
    }
  }

  // Shared driver for the per-connector "Pull my data now" buttons.
  // Runs the action inside the transition, toggles the card's pending
  // flag, and stores the returned detail (ok) / error (failure) as a
  // small status line on the card. router.refresh() so any freshly
  // synced data shows on the rest of the app.
  function handleConnectorSyncNow(
    action: () => Promise<ConnectorSyncNowResult>,
    setPending: (b: boolean) => void,
    setResult: (r: SyncResultMsg) => void,
  ) {
    setResult(null);
    setPending(true);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setResult({ ok: true, text: result.detail ?? "Synced." });
          router.refresh();
        } else {
          setResult({ ok: false, text: result.error ?? "Sync failed." });
        }
      } catch (e) {
        setResult({ ok: false, text: e instanceof Error ? e.message : "Sync failed." });
      } finally {
        setPending(false);
      }
    });
  }

  const anySync = googleSyncInFlight;

  // The honest rollup (2026-07-20) is the single source of the summary counts +
  // copy. Fall back to the bare connected count only when a legacy caller omits
  // it (render tests), so the strip always renders something coherent.
  const connected = rollup?.connectedCount ?? connectedCount;
  const total = rollup?.total ?? totalCount;
  const needsAttention = rollup?.needsAttentionCount ?? 0;
  const rollupHeadline =
    rollup?.headline ?? `${connected} of ${total} connected`;

  // FP10a (2026-07-02) - one health color for the summary strip. A connected
  // source that is NOT delivering data (needs attention) is an "attention"
  // state, never "live" - the certified leak was a green "4 of 4" hiding a
  // broken GA4 ingest + a blocked Wix publish. All connected AND all delivering
  // is "live"; still-missing sources are "waiting"; nothing connected yet is
  // "neutral".
  const summaryIntent =
    needsAttention > 0
      ? "attention"
      : connected >= total && connected > 0
        ? "live"
        : connected > 0
          ? "waiting"
          : "neutral";

  return (
    <div className="space-y-6">
      {/* ── Summary strip (FP10a, 2026-07-02) ──
          The diagnosis: the same three facts (what's connected, whether
          syncs are working, that nothing auto-publishes) were stated
          five-plus times down the page. One line up top replaces the
          count + sync-health facts; everything else keeps exactly one
          home further down. */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
        data-connectors-summary-strip="true"
      >
        <Pill intent={summaryIntent}>{rollupHeadline}</Pill>
      </div>
      {/* Honest subline (2026-07-20) - never undercounts the impaired sources;
          same rollup as the headline Pill, so the two can never disagree. */}
      {rollup ? (
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {rollup.subline}
        </p>
      ) : null}
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Once a source is connected I read it in the background and turn what
        I find into fixes. The only thing I never do on my own is change
        your live site, that always waits for your one-click approval unless
        you arm autopilot yourself.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-status-warning/40 bg-status-warning/[0.06] px-4 py-3"
        >
          <p className="text-sm text-foreground">{error}</p>
        </div>
      )}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-status-success/40 bg-status-success/[0.06] px-4 py-3"
        >
          <p className="text-sm text-foreground">{success}</p>
        </div>
      )}

      {/* ── Google Search Console (GSC) ── */}
      {/* GBP card is deferred to a follow-up slice. The GBP server action +
          OAuth path are still wired (kind="gbp"); no UI exposes them yet. */}
      {google.status === "connected" ? (
        <details
          id="connector-google-gsc"
          data-connector-card="google-gsc"
          data-gsc-readiness={gscReadiness?.verdict ?? "not_connected"}
          className="group rounded-lg border border-border/60 bg-surface-inset/20"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <h3 className="text-[13px] font-semibold text-foreground shrink-0">
                Google Search Console
              </h3>
              <span className="text-[12px] text-muted-foreground truncate">
                {SOURCE_SUMMARY.google_gsc} Last synced {formatDate(google.last_synced_at)}.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {gscReadiness && gscReadiness.verdict !== "ready" ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    gscReadiness.tone === "attention"
                      ? "bg-status-warning/[0.12] text-status-warning"
                      : "bg-surface-inset/60 text-muted-foreground"
                  }`}
                >
                  {gscReadiness.verdict === "needs_reconnect"
                    ? "Reconnect needed"
                    : gscReadiness.verdict === "connected_no_data"
                      ? "No data yet"
                      : "Not ready"}
                </span>
              ) : null}
              <span className="text-[11px] font-medium text-muted-foreground group-open:hidden">
                Manage
              </span>
              <span className="hidden text-[11px] font-medium text-muted-foreground group-open:inline">
                Hide
              </span>
            </div>
          </summary>

          <div className="border-t border-border/40 px-5 py-4 space-y-1">
            <p className="text-[12px] text-muted-foreground">
              Authorized {formatDate(google.connected_at)}
            </p>
            {/* Per-tenant OAuth (2026-07-09): which Google account this grant
                belongs to. Older grants (before identity scopes) have no
                email stored, so the line simply does not render until the
                next connect or replace. */}
            {google.google_account_email ? (
              <p
                className="text-[12px] text-muted-foreground"
                data-google-account-email="gsc"
              >
                Connected as {google.google_account_email}
              </p>
            ) : null}
            {GBP_AFFORDANCES_ENABLED ? (
              <>
                {selectedLocation ? (
                  <p className="text-[12px] text-muted-foreground">
                    Selected: {selectedLocation.name}
                  </p>
                ) : (
                  // #197, setup-blocking state. The amber color alone
                  // was the only urgency cue (color-only) and nothing
                  // announced the state change. A non-color "Action
                  // needed:" prefix + role="status" makes it legible to
                  // color-blind users and announced to screen readers.
                  <p className="text-[12px] text-status-warning" role="status">
                    <span className="font-semibold">Action needed:</span>{" "}
                    No location selected. Choose one below before syncing
                  </p>
                )}
              </>
            ) : null}
            {gscSyncResult ? (
              <p
                className={`text-[12px] ${gscSyncResult.ok ? "text-status-success" : "text-status-warning"}`}
              >
                {gscSyncResult.text}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {GBP_AFFORDANCES_ENABLED ? (
              <button
                type="button"
                onClick={() => void handleGoogleSyncNow()}
                disabled={googleSyncInFlight || isPending || !selectedLocation}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {googleSyncInFlight ? "Updating…" : "Update data"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                handleConnectorSyncNow(syncGscNow, setGscSyncPending, setGscSyncResult)
              }
              disabled={gscSyncPending || isPending}
              className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {gscSyncPending ? "Syncing…" : "Pull my Search Console data"}
            </button>
            {/* Per-tenant OAuth (2026-07-09): swap the Google account behind
                this live connection. Google shows the account chooser and
                asks for fresh consent; the current connection stays untouched
                until the new account actually grants ongoing access. */}
            <button
              type="button"
              onClick={() => handleReplaceGoogle("gsc")}
              disabled={isPending || anySync}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Pick a different Google account for Search Console. I keep the current connection until the new account grants access."
            >
              Replace Google account
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isPending || anySync}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Disconnects Google Search Console and any connected Google Business Profile. Historical data stays cached; no new data refreshes until you reconnect."
            >
              {isPending ? "Disconnecting…" : "Disconnect Google"}
            </button>
          </div>

          {/* ── Readiness (MAX_SEO_AEO Phase 4, 2026-06-16) ──
              Surfaces the RESOLVED property (derived from the tenant's own synced
              rows, never hardcoded), the backfill window + freshness, and a hard
              NOT-READY line when the connection can't actually deliver data.
              READ-ONLY: every figure is pre-composed server-side from persisted
              state (no live Google call). The verdict is also mirrored onto
              data-gsc-readiness on the card wrapper for testability. */}
          {gscReadiness ? (
            <div
              className="border-t border-border/40 px-5 py-3 space-y-1"
              data-gsc-readiness-section={gscReadiness.verdict}
            >
              {gscReadiness.verdict === "ready" ? (
                <p className="inline-flex items-center gap-1.5 rounded-md bg-status-success/[0.12] px-2 py-0.5 text-[11px] font-semibold text-status-success">
                  Ready
                </p>
              ) : null}
              <p className="text-[12px] font-medium text-foreground">
                {gscReadiness.headline}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {gscReadiness.detail}
              </p>
              {/* R17a (v1 266) - missing days INSIDE the covered range (a sync
                  hole, not Google's normal lag): say so, and say the fix
                  (re-pulls them automatically while you use Beacon). Self-hides
                  when complete. */}
              {gscGapLine ? (
                <p className="text-[12px] text-status-warning" data-gsc-gap-line="true">
                  {gscGapLine}
                </p>
              ) : null}
              <RefreshLedgerLine fact={refreshLedger.gsc} />
            </div>
          ) : null}


          {/* ── Location picker (Google connected), GBP only ── */}
          {GBP_AFFORDANCES_ENABLED ? (
            <div className="border-t border-border/40 px-5 py-3 space-y-3">
              {locationError && (
                <p className="text-[12px] text-status-warning">{locationError}</p>
              )}

              {!locationOptions ? (
                <button
                  type="button"
                  onClick={() => void handleLoadLocations()}
                  disabled={locationsLoading || isPending}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
                >
                  {locationsLoading ? "Loading locations…" : selectedLocation ? "Change location" : "Load locations"}
                </button>
              ) : locationOptions.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  No locations found for this Google account. Make sure your Google Business Profile has at least one verified location.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium text-foreground/90">
                    Choose location to sync
                  </label>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {locationOptions.map((loc) => {
                      const isSelected = selectedLocation?.id === loc.locationId;
                      return (
                        <button
                          key={loc.locationId}
                          type="button"
                          onClick={() => void handleSelectLocation(loc)}
                          disabled={isPending}
                          className={`w-full text-left rounded-md border px-3 py-2 text-[12px] transition-colors disabled:opacity-50 ${
                            isSelected
                              ? "border-accent-primary/60 bg-accent-primary/[0.06] text-foreground"
                              : "border-border/60 bg-background text-foreground hover:border-foreground/30"
                          }`}
                        >
                          <span className="font-medium">{loc.locationName}</span>
                          {loc.address ? (
                            <span className="block text-[11px] text-muted-foreground mt-0.5">
                              {loc.address}
                            </span>
                          ) : null}
                          {isSelected ? (
                            <span className="block text-[11px] text-accent-primary mt-0.5">
                              Currently selected
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </details>
      ) : (
        <div
          id="connector-google-gsc"
          data-connector-card="google-gsc"
          data-gsc-readiness={gscReadiness?.verdict ?? "not_connected"}
          className="rounded-lg border border-border/60 bg-surface-inset/20 px-5 py-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h3 className="text-[13px] font-semibold text-foreground">
                Google Search Console
              </h3>
              {/* J5 (2026-05-18), soft-disconnect aware copy. When a
                  previously-authorized GSC connector is now disconnected,
                  surface the "Last refreshed at X days ago" tooltip
                  alongside "Not connected" so the operator sees cached
                  state is preserved. */}
              <p className="text-[12px] text-muted-foreground">
                {google.connected_at ? "Disconnected · cached data preserved" : "Not connected"}
                {gscStaleCopy ? (
                  <span data-gsc-stale-tooltip="true"> · {gscStaleCopy}</span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnect}
              disabled={isPending}
              className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Connecting…" : "Connect Google Search Console"}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
            Read-only access to see what people search to find you, no
            writes to your Search Console property. The Google consent
            screen shows one permission: View Search Console data.
          </p>
        </div>
      )}

      {/* ── Google Analytics (GA4), Slice 9.A1β (2026-05-18) ── */}
      {ga4.status === "connected" ? (
        <details
          id="connector-google-ga4"
          className="group rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
          data-connector-card="google-ga4"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <h3 className="text-[13px] font-semibold text-foreground shrink-0">
                Google Analytics
              </h3>
              <span className="text-[12px] text-muted-foreground truncate">
                {ga4.ga4_property_id
                  ? `${SOURCE_SUMMARY.google_ga4} Tracking ${ga4.ga4_property_display_name ?? "a property"}.`
                  : SOURCE_SUMMARY.google_ga4}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!ga4.ga4_property_id ? (
                <span className="text-[11px] font-semibold text-status-warning" role="status">
                  Select a property
                </span>
              ) : null}
              <span className="text-[11px] font-medium text-muted-foreground group-open:hidden">
                Manage
              </span>
              <span className="hidden text-[11px] font-medium text-muted-foreground group-open:inline">
                Hide
              </span>
            </div>
          </summary>

          <div className="border-t border-border/40 px-5 py-4 space-y-1">
            <p className="text-[12px] text-muted-foreground">
              Authorized {formatDate(ga4.connected_at)}
            </p>
            {/* Per-tenant OAuth (2026-07-09): which Google account this grant
                belongs to. Absent on older grants until the next connect. */}
            {ga4.google_account_email ? (
              <p
                className="text-[12px] text-muted-foreground"
                data-google-account-email="ga4"
              >
                Connected as {ga4.google_account_email}
              </p>
            ) : null}
            {ga4.ga4_property_id ? (
              <p className="text-[12px] text-muted-foreground">
                Selected: {ga4.ga4_property_display_name ?? "Property"}
                {ga4.ga4_account_display_name
                  ? ` · ${ga4.ga4_account_display_name}`
                  : ""}
              </p>
            ) : (
              // #197, setup-blocking state (half-wired connector).
              <p className="text-[12px] text-status-warning" role="status">
                <span className="font-semibold">Action needed:</span>{" "}
                Connected, select a property to finish setup.
              </p>
            )}
            {ga4.ga4_property_id ? (
              <RefreshLedgerLine fact={refreshLedger.ga4} />
            ) : null}
            {ga4SyncResult ? (
              <p
                className={`text-[12px] ${ga4SyncResult.ok ? "text-status-success" : "text-status-warning"}`}
              >
                {ga4SyncResult.text}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {ga4.ga4_property_id ? (
              <button
                type="button"
                onClick={() =>
                  handleConnectorSyncNow(syncGa4Now, setGa4SyncPending, setGa4SyncResult)
                }
                disabled={ga4SyncPending || isPending}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {ga4SyncPending ? "Syncing…" : "Pull my data now"}
              </button>
            ) : null}
            {/* Per-tenant OAuth (2026-07-09): swap the Google account behind
                this live connection; nothing changes until the new account
                actually grants ongoing access. */}
            <button
              type="button"
              onClick={() => handleReplaceGoogle("ga4")}
              disabled={isPending || anySync}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Pick a different Google account for Analytics. I keep the current connection until the new account grants access."
            >
              Replace Google account
            </button>
            <button
              type="button"
              onClick={handleDisconnectGa4}
              disabled={isPending || anySync}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Soft disconnect: historical data stays cached but no new data refreshes until you reconnect."
            >
              {isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>

          {/* Property picker. Properties load on click only (NEVER on
              mount) so no GA4 API call fires on page render. Pinned by
              the `ga4-no-page-load-call` architecture invariant. */}
          <div className="border-t border-border/40 px-5 py-3 space-y-3">
            {ga4PropertyError && (
              <p className="text-[12px] text-status-warning">
                {ga4PropertyError}
              </p>
            )}
            {!ga4Properties ? (
              <button
                type="button"
                onClick={() => void handleLoadGa4Properties()}
                disabled={ga4PropertiesLoading || isPending}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                {ga4PropertiesLoading
                  ? "Loading properties…"
                  : ga4.ga4_property_id
                    ? "Choose a different property"
                    : "Choose property"}
              </button>
            ) : ga4Properties.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No Google Analytics properties found for this account.
                Make sure your GA4 setup has at least one property
                you can read.
              </p>
            ) : (
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-foreground/90">
                  Choose property to track
                </label>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {ga4Properties.map((prop) => {
                    const isSelected = ga4.ga4_property_id === prop.id;
                    return (
                      <button
                        key={prop.id}
                        type="button"
                        onClick={() => void handleSelectGa4Property(prop)}
                        disabled={isPending}
                        className={`w-full text-left rounded-md border px-3 py-2 text-[12px] transition-colors disabled:opacity-50 ${
                          isSelected
                            ? "border-accent-primary/60 bg-accent-primary/[0.06] text-foreground"
                            : "border-border/60 bg-background text-foreground hover:border-foreground/30"
                        }`}
                      >
                        <span className="font-medium">
                          {prop.displayName}
                        </span>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">
                          {prop.accountDisplayName}
                        </span>
                        {isSelected ? (
                          <span className="block text-[11px] text-accent-primary mt-0.5">
                            Currently selected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </details>
      ) : (
        <div
          id="connector-google-ga4"
          className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24 px-5 py-4"
          data-connector-card="google-ga4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h3 className="text-[13px] font-semibold text-foreground">
                Google Analytics
              </h3>
              <p className="text-[12px] text-muted-foreground">
                {ga4.connected_at
                  ? "Disconnected · cached data preserved"
                  : "Not connected"}
                {ga4StaleCopy ? (
                  <span data-ga4-stale-tooltip="true"> · {ga4StaleCopy}</span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnectGa4}
              disabled={isPending}
              className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Connecting…" : "Connect Google Analytics"}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground leading-relaxed">
            Read-only access to see which pages bring in the most
            visitors, no writes to your Analytics property. The Google
            consent screen shows one permission: View your Google
            Analytics data.
          </p>
        </div>
      )}

      {/* Yelp connector removed 2026-06-18 (operator request, not relevant to
          content/AEO tenants). State + actions remain wired but no card renders. */}

      {/* ── Wix, North-star onboarding (2026-06-11) ──
          Self-serve publish connection: the customer pastes their own
          Wix API key + site id. Connecting NEVER publishes anything -
          every edit still goes through Approve & Push (your click,
          daily caps, non-destructive guard). */}
      {wix.status === "connected" ? (
        <details
          id="connector-wix"
          className="group rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
          data-connector-card="wix"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <h3 className="text-[13px] font-semibold text-foreground shrink-0">Wix</h3>
              <span className="text-[12px] text-muted-foreground truncate">
                {SOURCE_SUMMARY.wix}
              </span>
            </div>
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground group-open:hidden">
              Manage
            </span>
            <span className="hidden shrink-0 text-[11px] font-medium text-muted-foreground group-open:inline">
              Hide
            </span>
          </summary>

          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <p className="text-[12px] text-muted-foreground">
              Authorized {formatDate(wix.connected_at)}
            </p>
            {wixUrlMapCount === 0 ? (
              <div role="status" data-recovery-fix="wix_url_map_empty" className="space-y-2">
                <p className="text-[12px] text-status-warning">
                  <span className="font-semibold">Fix this:</span>{" "}
                  Click Discover collections below so I can map your Wix pages. I cannot publish anything to your site until this is done.
                </p>
                <button
                  type="button"
                  onClick={() => void handleDiscoverWixCollections()}
                  disabled={wixDiscoverPending || isPending}
                  data-wix-discover="true"
                  className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {wixDiscoverPending ? "Discovering…" : "Discover collections"}
                </button>
                {wixDiscoverResult ? (
                  <p
                    data-wix-discover-result={wixDiscoverResult.ok ? "ok" : "error"}
                    className={`text-[12px] ${wixDiscoverResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {wixDiscoverResult.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleDisconnectWix}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Only used when you approve an edit for publishing. Daily caps and
              the non-destructive guard apply to every change, and disconnecting
              stops all publishing instantly.
            </p>
          </div>
        </details>
      ) : (
        <div
          id="connector-wix"
          className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24 px-5 py-4"
          data-connector-card="wix"
        >
          <h3 className="text-[13px] font-semibold text-foreground">Wix</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Connect your Wix site so I can prepare publish-ready edits.
            Nothing changes on your live site without your approval.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            Only used when you approve an edit for publishing. Daily caps and
            the non-destructive guard apply to every change, and disconnecting
            stops all publishing instantly.
          </p>

          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-muted-foreground">
              From your Wix dashboard: Settings → API Keys → create a key
              with content-write access, and copy your Site ID from
              Settings → Website settings. Both stay on this server and
              are never sent to the browser after saving.
            </p>
            <label htmlFor="wix-api-key" className="sr-only">
              Wix API key
            </label>
            <input
              id="wix-api-key"
              type="password"
              value={wixKeyInput}
              onChange={(e) => setWixKeyInput(e.target.value)}
              placeholder="Wix API key"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <label htmlFor="wix-site-id" className="sr-only">
              Wix Site ID
            </label>
            <input
              id="wix-site-id"
              type="text"
              value={wixSiteIdInput}
              onChange={(e) => setWixSiteIdInput(e.target.value)}
              placeholder="Wix Site ID"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <div>
              <button
                type="button"
                onClick={handleSaveWixConnection}
                disabled={isPending || !wixKeyInput.trim() || !wixSiteIdInput.trim()}
                aria-describedby="wix-connect-hint"
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Wix
              </button>
              <p id="wix-connect-hint" className="sr-only">
                Enter both the API key and Site ID to enable this button.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Microsoft Clarity, Connect-cards slice (2026-06-12) ── */}
      {clarity.status === "connected" ? (
        <details
          id="connector-clarity"
          className="group rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
          data-connector-card="clarity"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <h3 className="text-[13px] font-semibold text-foreground shrink-0">
                Microsoft Clarity
              </h3>
              <span className="text-[12px] text-muted-foreground truncate">
                {SOURCE_SUMMARY.clarity}
              </span>
            </div>
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground group-open:hidden">
              Manage
            </span>
            <span className="hidden shrink-0 text-[11px] font-medium text-muted-foreground group-open:inline">
              Hide
            </span>
          </summary>

          <div className="border-t border-border/40 px-5 py-4 space-y-1">
            <p className="text-[12px] text-muted-foreground">
              Authorized {formatDate(clarity.connected_at)}
            </p>
            <RefreshLedgerLine fact={refreshLedger.clarity} />
            {claritySyncResult ? (
              <p
                className={`text-[12px] ${claritySyncResult.ok ? "text-status-success" : "text-status-warning"}`}
              >
                {claritySyncResult.text}
              </p>
            ) : null}
            <p className="text-[12px] text-muted-foreground">
              Clarity only shares the last 1 to 3 days, so pull data every
              couple of days to keep history without gaps.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 px-5 pb-4">
            <button
              type="button"
              onClick={() =>
                handleConnectorSyncNow(syncClarityNow, setClaritySyncPending, setClaritySyncResult)
              }
              disabled={claritySyncPending || isPending}
              className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {claritySyncPending ? "Syncing…" : "Pull my data now"}
            </button>
            <button
              type="button"
              onClick={() => handleSimpleDisconnect(disconnectClarity, setClarity)}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </details>
      ) : (
        <div
          id="connector-clarity"
          className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24 px-5 py-4"
          data-connector-card="clarity"
        >
          <h3 className="text-[13px] font-semibold text-foreground">
            Microsoft Clarity
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Connect a Clarity API token so I can see where visitors get
            stuck on each page (rage clicks, dead clicks, scroll depth).
            Clarity only shares the last 1 to 3 days, so pull data every
            couple of days to keep history without gaps.
          </p>

          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-muted-foreground">
              In Clarity: Settings → Data Export → Generate new API token.
            </p>
            <label htmlFor="clarity-api-token" className="sr-only">
              Clarity API token
            </label>
            <input
              id="clarity-api-token"
              type="password"
              value={clarityTokenInput}
              onChange={(e) => setClarityTokenInput(e.target.value)}
              placeholder="Clarity API token"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <div>
              <button
                type="button"
                onClick={() =>
                  handleSaveSimpleConnection(
                    () => saveClarityConnection({ apiToken: clarityTokenInput }),
                    setClarity,
                    () => setClarityTokenInput(""),
                  )
                }
                disabled={isPending || !clarityTokenInput.trim()}
                aria-describedby="clarity-connect-hint"
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Clarity
              </button>
              <p id="clarity-connect-hint" className="sr-only">
                Enter your Clarity API token to enable this button.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
