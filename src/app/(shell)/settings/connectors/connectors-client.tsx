"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConnectorInfo } from "@/lib/connector-store";
import {
  getGoogleAuthUrl,
  getGoogleGscConnectorStatus,
  getYelpConnectorStatus,
  disconnectGoogle,
  disconnectYelp,
  saveYelpApiKey,
  syncGoogleReviews,
  syncYelpReviews,
  loadGoogleLocations,
  selectGoogleLocation,
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
  yelp: ConnectorInfo;
  /** From business config — for operator hint only (not a secret). */
  configYelpBusinessId: string;
  /** J5 (2026-05-18) — pre-rendered "GSC data last refreshed X days
   *  ago. Reconnect to refresh." copy. Computed server-side in
   *  page.tsx so the formatting helper stays `server-only`. Present
   *  only when the GSC connector has a non-null `expires_at` (i.e.,
   *  the operator previously authorized the connector at some
   *  point) AND status is "disconnected". `null` otherwise. */
  gscStaleCopy?: string | null;
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
  yelp: initialYelp,
  configYelpBusinessId,
  gscStaleCopy = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [google, setGoogle] = useState<ConnectorInfo>(initialGoogle);
  const [yelp, setYelp] = useState<ConnectorInfo>(initialYelp);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [googleSyncInFlight, setGoogleSyncInFlight] = useState(false);
  const [yelpSyncInFlight, setYelpSyncInFlight] = useState(false);
  const [yelpKeyInput, setYelpKeyInput] = useState("");

  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation>(initialSelectedLocation);
  const [locationOptions, setLocationOptions] = useState<LocationOption[] | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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
                Beacon reads URL Inspection + Search Analytics data on a daily
                refresh cadence. Read-only access — no writes to your
                Search Console property.
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
