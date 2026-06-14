"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConnectorInfo } from "@/lib/connector-store";
import type { Ga4Property } from "@/lib/connectors/ga4/types";
import {
  getGoogleAuthUrl,
  getGoogleGscConnectorStatus,
  getGoogleGa4ConnectorStatus,
  getWixConnectorStatus,
  getYelpConnectorStatus,
  disconnectGoogle,
  disconnectGoogleGa4,
  disconnectYelp,
  saveWixConnection,
  disconnectWix,
  saveSemrushConnection,
  disconnectSemrush,
  saveProfoundConnection,
  disconnectProfound,
  saveClarityConnection,
  disconnectClarity,
  saveYelpApiKey,
  syncGoogleReviews,
  syncYelpReviews,
  loadGoogleLocations,
  selectGoogleLocation,
  listGa4Properties,
  selectGa4Property,
} from "./actions";

type SelectedLocation = { id: string; name: string } | null;

type LocationOption = { locationId: string; locationName: string; address: string | null };

/**
 * 2026-05-16 — GSC scope split: the Google card is GSC-focused for v1.
 * Sync now + Location picker are GBP-only affordances; both flip on
 * when the deferred GBP card lands in a follow-up slice. Action code
 * + server actions stay wired; only the UI surfaces are gated.
 */
const GBP_AFFORDANCES_ENABLED = false;

type Props = {
  google: ConnectorInfo;
  googleSelectedLocation: SelectedLocation;
  /** Slice 9.A1β (2026-05-18) — GA4 connector status. Mirrors the
   *  GSC props shape (status, expires_at, ga4_property_id, etc.). */
  ga4: ConnectorInfo;
  yelp: ConnectorInfo;
  /** North-star onboarding (2026-06-11) — self-serve Wix connection. */
  wix: ConnectorInfo;
  semrush: ConnectorInfo;
  profound: ConnectorInfo;
  clarity: ConnectorInfo;
  /** From business config — for operator hint only (not a secret). */
  configYelpBusinessId: string;
  /** J5 (2026-05-18) — pre-rendered "GSC data last refreshed X days
   *  ago. Reconnect to refresh." copy. Computed server-side in
   *  page.tsx so the formatting helper stays `server-only`. Present
   *  only when the GSC connector has a non-null `expires_at` (i.e.,
   *  the operator previously authorized the connector at some
   *  point) AND status is "disconnected". `null` otherwise. */
  gscStaleCopy?: string | null;
  /** Slice 9.A1β (2026-05-18) — pre-rendered "Google Analytics data
   *  last refreshed X days ago" copy. Computed server-side in
   *  page.tsx. Present only when the GA4 connector has a non-null
   *  `expires_at` AND status is "disconnected". `null` otherwise. */
  ga4StaleCopy?: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Google authorization was denied. You can try again when ready.",
  no_code: "No authorization code received from Google. Please try again.",
  invalid_state:
    "Authorization could not be verified. The connect link may have expired — please try Connect again.",
  exchange_failed:
    "Failed to complete authorization with Google. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly.",
  persistence_failed:
    "Authorization succeeded but Beacon could not save the connection. Please try again, or contact support if it persists.",
  env_missing:
    "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and BEACON_OAUTH_STATE_SECRET in your environment.",
};

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

export function ConnectorsClient({
  google: initialGoogle,
  googleSelectedLocation: initialSelectedLocation,
  ga4: initialGa4,
  yelp: initialYelp,
  wix: initialWix,
  semrush: initialSemrush,
  profound: initialProfound,
  clarity: initialClarity,
  configYelpBusinessId,
  gscStaleCopy = null,
  ga4StaleCopy = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [google, setGoogle] = useState<ConnectorInfo>(initialGoogle);
  const [ga4, setGa4] = useState<ConnectorInfo>(initialGa4);
  const [yelp, setYelp] = useState<ConnectorInfo>(initialYelp);
  const [wix, setWix] = useState<ConnectorInfo>(initialWix);
  const [wixKeyInput, setWixKeyInput] = useState("");
  const [wixSiteIdInput, setWixSiteIdInput] = useState("");
  // Connect-cards slice (2026-06-12)
  const [semrush, setSemrush] = useState<ConnectorInfo>(initialSemrush);
  const [semrushKeyInput, setSemrushKeyInput] = useState("");
  const [semrushDbInput, setSemrushDbInput] = useState("");
  const [profound, setProfound] = useState<ConnectorInfo>(initialProfound);
  const [profoundKeyInput, setProfoundKeyInput] = useState("");
  const [clarity, setClarity] = useState<ConnectorInfo>(initialClarity);
  const [clarityTokenInput, setClarityTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [googleSyncInFlight, setGoogleSyncInFlight] = useState(false);
  const [yelpSyncInFlight, setYelpSyncInFlight] = useState(false);
  const [yelpKeyInput, setYelpKeyInput] = useState("");

  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation>(initialSelectedLocation);
  const [locationOptions, setLocationOptions] = useState<LocationOption[] | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Slice 9.A1β (2026-05-18) — GA4 property picker state. The list of
  // properties is loaded ONLY on explicit user action (Choose property
  // button); never on mount, so the page-load contract stays intact
  // (no GA4 API call on page render — enforced by the
  // `ga4-no-page-load-call` architecture invariant).
  const [ga4Properties, setGa4Properties] = useState<Ga4Property[] | null>(null);
  const [ga4PropertiesLoading, setGa4PropertiesLoading] = useState(false);
  const [ga4PropertyError, setGa4PropertyError] = useState<string | null>(null);

  useEffect(() => {
    const err = searchParams.get("error");
    const connected = searchParams.get("connected");
    if (err) {
      setError(ERROR_MESSAGES[err] ?? `Connection error: ${err}`);
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

  // ───────────────────────────────────────────────────────────────────
  // Slice 9.A1β (2026-05-18) — GA4 handlers
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
        // Auto-select the only property — saves a click in the common case.
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
        msg += ` Completed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} — some data may be incomplete.`;
      }
      setSuccess(msg);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setGoogleSyncInFlight(false);
    }
  }

  function handleSaveYelpKey() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveYelpApiKey(yelpKeyInput);
      if (result.success) {
        setYelpKeyInput("");
        const status = await getYelpConnectorStatus();
        setYelp(status);
        setSuccess("Yelp API key saved. Use Sync now when you want to pull reviews.");
        router.refresh();
      } else {
        setError(result.error ?? "Could not save Yelp key.");
      }
    });
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
          "Wix connected. Approved edits can now publish to your site — nothing publishes without your approval.",
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
        setInfo({
          status: "connected",
          connected_at: new Date().toISOString(),
          expires_at: null,
          last_synced_at: null,
        });
        clear();
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
        setInfo({
          status: "disconnected",
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        });
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

  function handleDisconnectYelp() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await disconnectYelp();
      if (result.success) {
        setYelp({
          status: "disconnected",
          connected_at: null,
          expires_at: null,
          last_synced_at: null,
        });
        setSuccess("Yelp disconnected. Previously synced Yelp rows in Local presence are preserved.");
        router.refresh();
      } else {
        setError(result.error ?? "Failed to disconnect Yelp.");
      }
    });
  }

  async function handleYelpSyncNow() {
    setError(null);
    setSuccess(null);
    setYelpSyncInFlight(true);
    try {
      const result = await syncYelpReviews();
      if (!result.ok) {
        if (result.code === "invalid_key") {
          setError(result.message);
        } else {
          setError(result.message || "Sync failed.");
        }
        return;
      }
      const status = await getYelpConnectorStatus();
      setYelp(status);
      let msg = `Synced ${result.imported} review${result.imported === 1 ? "" : "s"} from Yelp.`;
      if (result.rejected > 0) {
        msg += ` ${result.rejected} row${result.rejected === 1 ? "" : "s"} skipped (invalid data).`;
      }
      if (result.partial && result.warnings.length > 0) {
        msg += ` Completed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} — some data may be incomplete.`;
      }
      setSuccess(msg);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setYelpSyncInFlight(false);
    }
  }

  const anySync = googleSyncInFlight || yelpSyncInFlight;

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Each source updates independently. Connectors are additive — they do not replace manual import.
      </p>
      {error && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/[0.06] px-4 py-3">
          <p className="text-sm text-foreground">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-status-safe/40 bg-status-safe/[0.06] px-4 py-3">
          <p className="text-sm text-foreground">{success}</p>
        </div>
      )}

      {/* ── Google Search Console (GSC) ── */}
      {/* GBP card is deferred to a follow-up slice. The GBP server action +
          OAuth path are still wired (kind="gbp"); no UI exposes them yet. */}
      <div className="rounded-lg border border-border/60 bg-surface-inset/20">
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              Google Search Console
            </h3>
            {google.status === "connected" ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Connected to Google Search Console &middot; Authorized {formatDate(google.connected_at)}
                </p>
                {GBP_AFFORDANCES_ENABLED ? (
                  <>
                    {selectedLocation ? (
                      <p className="text-[12px] text-muted-foreground">
                        Selected: {selectedLocation.name}
                      </p>
                    ) : (
                      <p className="text-[12px] text-status-warning">
                        No location selected — choose one below before syncing
                      </p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      Last synced: {formatDate(google.last_synced_at)}
                    </p>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {/* J5 (2026-05-18) — soft-disconnect aware copy. When
                    a previously-authorized GSC connector is now
                    disconnected, surface the "Last refreshed at X
                    days ago" tooltip alongside the "Not connected"
                    label so the operator sees cached state is
                    preserved. The pre-rendered string comes from
                    page.tsx (formatLastRefreshedCopy lives in the
                    server-only expiry-handler module). */}
                <p className="text-[12px] text-muted-foreground">
                  {google.connected_at ? "Disconnected · cached data preserved" : "Not connected"}
                </p>
                {gscStaleCopy ? (
                  <p
                    className="text-[12px] text-muted-foreground"
                    data-gsc-stale-tooltip="true"
                    title={gscStaleCopy}
                  >
                    {gscStaleCopy}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {google.status === "connected" ? (
              <>
                {GBP_AFFORDANCES_ENABLED ? (
                  <button
                    type="button"
                    onClick={() => void handleGoogleSyncNow()}
                    disabled={googleSyncInFlight || isPending || !selectedLocation}
                    className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {googleSyncInFlight ? "Syncing…" : "Sync now"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isPending || anySync}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
                  title="Soft disconnect — historical data stays cached but no new data refreshes until you reconnect."
                >
                  {isPending ? "Disconnecting…" : "Disconnect"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isPending}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Connecting…" : "Connect Google Search Console"}
              </button>
            )}
          </div>
        </div>

        {/* ── Location picker (Google connected) — GBP only ── */}
        {GBP_AFFORDANCES_ENABLED && google.status === "connected" ? (
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

        <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10 space-y-1.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {google.status === "connected" ? (
              <>
                Beacon reads URL Inspection + Search Analytics data. Read-only
                access — no writes to your Search Console property. Pull the
                latest any time with Refresh on Data sources.
              </>
            ) : (
              <>
                Connect Google Search Console to give Beacon read-only
                access to URL Inspection + Search Analytics for your
                verified sites. The Google consent screen will show
                a single permission: View Search Console data for
                verified sites.
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Google Analytics (GA4) — Slice 9.A1β (2026-05-18) ── */}
      {/* OAuth + property picker only. NO Data API in this slice —
          sessions / events / conversions land in Slice 9.A2. */}
      <div
        className="rounded-lg border border-border/60 bg-surface-inset/20"
        data-connector-card="google-ga4"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              Google Analytics
            </h3>
            {ga4.status === "connected" ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Connected to Google Analytics &middot; Authorized {formatDate(ga4.connected_at)}
                </p>
                {ga4.ga4_property_id ? (
                  <p className="text-[12px] text-muted-foreground">
                    Selected: {ga4.ga4_property_display_name ?? "Property"}
                    {ga4.ga4_account_display_name
                      ? ` · ${ga4.ga4_account_display_name}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-[12px] text-status-warning">
                    Connected. Select a property to finish setup.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[12px] text-muted-foreground">
                  {ga4.connected_at
                    ? "Disconnected · cached data preserved"
                    : "Not connected"}
                </p>
                {ga4StaleCopy ? (
                  <p
                    className="text-[12px] text-muted-foreground"
                    data-ga4-stale-tooltip="true"
                    title={ga4StaleCopy}
                  >
                    {ga4StaleCopy}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            {ga4.status === "connected" ? (
              <button
                type="button"
                onClick={handleDisconnectGa4}
                disabled={isPending || anySync}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
                title="Soft disconnect — historical data stays cached but no new data refreshes until you reconnect."
              >
                {isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectGa4}
                disabled={isPending}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Connecting…" : "Connect Google Analytics"}
              </button>
            )}
          </div>
        </div>

        {/* Property picker — only when connected. Properties load on
            click only (NEVER on mount) so no GA4 API call fires on
            page render. Pinned by the `ga4-no-page-load-call`
            architecture invariant. */}
        {ga4.status === "connected" ? (
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
        ) : null}

        <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10 space-y-1.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {ga4.status === "connected" ? (
              <>
                Beacon reads Google Analytics property metadata. Read-only
                access — no writes to your Google Analytics property.
              </>
            ) : (
              <>
                Connect Google Analytics to give Beacon read-only access
                to your GA4 property. The Google consent screen will
                show a single permission: View your Google Analytics
                data.
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Yelp (Fusion API key) ── */}
      <div className="rounded-lg border border-border/60 bg-surface-inset/20">
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h3 className="text-[13px] font-semibold text-foreground">Yelp</h3>
              {yelp.status === "connected" ? (
                <>
                  <p className="text-[12px] text-muted-foreground">
                    Connected to Yelp &middot; Key saved {formatDate(yelp.connected_at)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Last synced: {formatDate(yelp.last_synced_at)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">Source: Yelp</p>
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Enter your Yelp Fusion API key. The key is stored only on this server and never sent to the browser after saving.
                </p>
              )}
            </div>

            {yelp.status === "connected" ? (
              <div className="flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleYelpSyncNow()}
                  disabled={yelpSyncInFlight || isPending}
                  className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {yelpSyncInFlight ? "Syncing…" : "Sync now"}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectYelp}
                  disabled={isPending || anySync}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>

          {yelp.status === "disconnected" ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-foreground/90">
                Enter Yelp API Key
              </label>
              <input
                type="password"
                autoComplete="off"
                value={yelpKeyInput}
                onChange={(e) => setYelpKeyInput(e.target.value)}
                placeholder="Yelp Fusion API key"
                className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
              />
              {!configYelpBusinessId.trim() ? (
                <p className="text-[11px] text-muted-foreground">
                  Set <span className="font-medium text-foreground/90">Yelp business ID or alias</span> under{" "}
                  <a href="/settings/config" className="text-accent-primary hover:underline">
                    Settings → Config
                  </a>{" "}
                  before syncing — Beacon uses it for the Fusion reviews request.
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleSaveYelpKey}
                disabled={isPending || !yelpKeyInput.trim()}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Save API Key"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10 space-y-1.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Pulls reviews from Yelp on demand when you click Sync now.
            Yelp Fusion returns a bounded sample — may not reflect your full Yelp profile.
            No automatic syncing — Beacon does not poll Yelp in the background.
          </p>
        </div>
      </div>

      {/* ── Wix — North-star onboarding (2026-06-11) ──
          Self-serve publish connection: the customer pastes their own
          Wix API key + site id. Connecting NEVER publishes anything —
          every edit still goes through Approve & Push (your click,
          daily caps, non-destructive guard). */}
      <div
        className="rounded-lg border border-border/60 bg-surface-inset/20"
        data-connector-card="wix"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">Wix</h3>
            {wix.status === "connected" ? (
              <p className="text-[12px] text-muted-foreground">
                Connected &middot; Authorized {formatDate(wix.connected_at)}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect your Wix site so approved edits can publish
                directly. Nothing publishes without your approval.
              </p>
            )}
          </div>
          {wix.status === "connected" ? (
            <button
              type="button"
              onClick={handleDisconnectWix}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          ) : null}
        </div>

        {wix.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <p className="text-[12px] text-muted-foreground">
              From your Wix dashboard: Settings → API Keys → create a key
              with content-write access, and copy your Site ID from
              Settings → Website settings. Both stay on this server and
              are never sent to the browser after saving.
            </p>
            <input
              type="password"
              value={wixKeyInput}
              onChange={(e) => setWixKeyInput(e.target.value)}
              placeholder="Wix API key"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <input
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
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Wix
              </button>
            </div>
          </div>
        ) : null}

        <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Used only when you click Approve &amp; Push on an edit. Daily
            push caps and the non-destructive guard apply to every push;
            disconnecting stops all publishing instantly.
          </p>
        </div>
      </div>

      {/* ── SEMrush — Connect-cards slice (2026-06-12) ── */}
      <div
        className="rounded-lg border border-border/60 bg-surface-inset/20"
        data-connector-card="semrush"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">Semrush</h3>
            {semrush.status === "connected" ? (
              <p className="text-[12px] text-muted-foreground">
                Connected &middot; Authorized {formatDate(semrush.connected_at)}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect your Semrush API key so Beacon can see which
                searches you rank for, which rivals beat you, and where
                the gaps are. Pulls fresh data on demand, within a strict
                unit budget.
              </p>
            )}
          </div>
          {semrush.status === "connected" ? (
            <button
              type="button"
              onClick={() => handleSimpleDisconnect(disconnectSemrush, setSemrush)}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          ) : null}
        </div>
        {semrush.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <input
              type="password"
              value={semrushKeyInput}
              onChange={(e) => setSemrushKeyInput(e.target.value)}
              placeholder="Semrush API key"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <input
              type="text"
              value={semrushDbInput}
              onChange={(e) => setSemrushDbInput(e.target.value)}
              placeholder="Regional database (default: us)"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <div>
              <button
                type="button"
                onClick={() =>
                  handleSaveSimpleConnection(
                    () =>
                      saveSemrushConnection({
                        apiKey: semrushKeyInput,
                        database: semrushDbInput,
                      }),
                    setSemrush,
                    () => {
                      setSemrushKeyInput("");
                      setSemrushDbInput("");
                    },
                  )
                }
                disabled={isPending || !semrushKeyInput.trim()}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Semrush
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Profound — Connect-cards slice (2026-06-12) ── */}
      <div
        className="rounded-lg border border-border/60 bg-surface-inset/20"
        data-connector-card="profound"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">Profound</h3>
            {profound.status === "connected" ? (
              <p className="text-[12px] text-muted-foreground">
                Connected &middot; Authorized {formatDate(profound.connected_at)}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect your Profound API key so Beacon can track how AI
                assistants mention and cite your site, and where rivals
                get cited instead.
              </p>
            )}
          </div>
          {profound.status === "connected" ? (
            <button
              type="button"
              onClick={() => handleSimpleDisconnect(disconnectProfound, setProfound)}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          ) : null}
        </div>
        {profound.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <input
              type="password"
              value={profoundKeyInput}
              onChange={(e) => setProfoundKeyInput(e.target.value)}
              placeholder="Profound API key"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <div>
              <button
                type="button"
                onClick={() =>
                  handleSaveSimpleConnection(
                    () => saveProfoundConnection({ apiKey: profoundKeyInput }),
                    setProfound,
                    () => setProfoundKeyInput(""),
                  )
                }
                disabled={isPending || !profoundKeyInput.trim()}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Profound
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Microsoft Clarity — Connect-cards slice (2026-06-12) ── */}
      <div
        className="rounded-lg border border-border/60 bg-surface-inset/20"
        data-connector-card="clarity"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              Microsoft Clarity
            </h3>
            {clarity.status === "connected" ? (
              <p className="text-[12px] text-muted-foreground">
                Connected &middot; Authorized {formatDate(clarity.connected_at)}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect a Clarity API token so Beacon can see where
                visitors get stuck on each page (rage clicks, dead
                clicks, scroll depth). Clarity only shares the last 1-3
                days, so refresh every couple of days to build history
                without gaps.
              </p>
            )}
          </div>
          {clarity.status === "connected" ? (
            <button
              type="button"
              onClick={() => handleSimpleDisconnect(disconnectClarity, setClarity)}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              Disconnect
            </button>
          ) : null}
        </div>
        {clarity.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <p className="text-[12px] text-muted-foreground">
              In Clarity: Settings → Data Export → Generate new API token.
            </p>
            <input
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
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Clarity
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Manual import note ── */}
      <div className="rounded-lg border border-border/40 bg-surface-inset/10 px-5 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Manual CSV/JSON import remains available under{" "}
          <a href="/settings/import" className="text-accent-primary hover:underline">
            Settings → Import
          </a>{" "}
          regardless of connector status. Connectors are additive — they do not replace manual import.
        </p>
      </div>
    </div>
  );
}
