"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConnectorInfo } from "@/lib/connector-store";
import type { Ga4Property } from "@/lib/connectors/ga4/types";
import { ConnectorCapability } from "@/components/connectors/connector-capability";
import { CONNECTOR_CAPABILITY } from "@/components/connectors/connector-capability-copy";
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
  syncGscNow,
  syncGa4Now,
  syncSemrushNow,
  syncProfoundNow,
  syncClarityNow,
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
  yelp: ConnectorInfo;
  /** North-star onboarding (2026-06-11), self-serve Wix connection. */
  wix: ConnectorInfo;
  semrush: ConnectorInfo;
  profound: ConnectorInfo;
  clarity: ConnectorInfo;
  /** From business config, for operator hint only (not a secret). */
  configYelpBusinessId: string;
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
  /** Slice 9.A1β (2026-05-18), pre-rendered "Google Analytics data
   *  last refreshed X days ago" copy. Computed server-side in
   *  page.tsx. Present only when the GA4 connector has a non-null
   *  `expires_at` AND status is "disconnected". `null` otherwise. */
  ga4StaleCopy?: string | null;
};

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

/** #90 (2026-06-14), honest copy when Google returns no refresh token: the
 *  connection works for now but will stop on its own. Plain-English (no
 *  "refresh token" jargon) so a non-technical owner knows to reconnect. */
const MISSING_REFRESH_TOKEN_WARNING =
  "Google connected, but didn't grant ongoing access. This connection will stop working soon. Please click Connect again and allow access when Google asks.";

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
  gscReadiness,
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

  // Customer "Pull my data now" affordances (2026-06-14), each
  // connected source gets a per-card sync button wired to its
  // server action; a per-card pending flag + last-result message
  // mirror the Google/Yelp Sync-now idiom above.
  type SyncResultMsg = { ok: boolean; text: string } | null;
  const [gscSyncPending, setGscSyncPending] = useState(false);
  const [gscSyncResult, setGscSyncResult] = useState<SyncResultMsg>(null);
  const [ga4SyncPending, setGa4SyncPending] = useState(false);
  const [ga4SyncResult, setGa4SyncResult] = useState<SyncResultMsg>(null);
  const [semrushSyncPending, setSemrushSyncPending] = useState(false);
  const [semrushSyncResult, setSemrushSyncResult] = useState<SyncResultMsg>(null);
  const [profoundSyncPending, setProfoundSyncPending] = useState(false);
  const [profoundSyncResult, setProfoundSyncResult] = useState<SyncResultMsg>(null);
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
    // #90 (2026-06-14), Google returned no refresh token. The connection
    // works now but will quietly die and can't self-heal; show an honest
    // reconnect warning instead of a clean "connected successfully".
    const warning = searchParams.get("warning");
    const missingRefresh = warning === "missing_refresh_token";
    if (err) {
      const detail = searchParams.get("detail");
      const hint = detail ? (EXCHANGE_DETAIL_HINTS[detail] ?? ` (${detail})`) : "";
      setError((ERROR_MESSAGES[err] ?? DEFAULT_ERROR_MESSAGE) + hint);
      window.history.replaceState(null, "", "/settings/connectors");
    }
    if (connected === "google_gsc") {
      if (missingRefresh) {
        setError(MISSING_REFRESH_TOKEN_WARNING);
      } else {
        setSuccess("Google Search Console connected successfully.");
      }
      startTransition(async () => {
        const status = await getGoogleGscConnectorStatus();
        setGoogle(status);
      });
      window.history.replaceState(null, "", "/settings/connectors");
    }
    if (connected === "google_ga4") {
      if (missingRefresh) {
        setError(MISSING_REFRESH_TOKEN_WARNING);
      } else {
        setSuccess(
          "Google Analytics connected. Choose a property to finish setup.",
        );
      }
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
        msg += ` Completed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}, some data may be incomplete.`;
      }
      setSuccess(msg);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setYelpSyncInFlight(false);
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

  const anySync = googleSyncInFlight || yelpSyncInFlight;

  return (
    <div className="space-y-6">
      {/* 2026-06-22, connectors now auto-refresh on use (next/after), throttled
          per-source by last_synced_at. Honest copy: it stays fresh on its own;
          the buttons are still there to force it. */}
      <div className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3">
        <p className="text-[12px] text-foreground leading-relaxed">
          Connecting a tool just gives Beacon access. After that, Beacon keeps
          your data fresh on its own: whenever you use the app it quietly refreshes
          anything that has gone out of date (at most every few hours each, so it
          never runs up any usage limits). You can always refresh right now with
          the &ldquo;Update now&rdquo; button. Beacon never runs in the background,
          only while you are actually using it.
        </p>
      </div>
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Each source updates independently. Connecting a tool is additive; it does not replace manual import.
      </p>

      {/* ── What you'll get once everything's connected ──
          Honest autopilot framing from the connector-automation research
          (docs/CONNECTOR_AUTOMATION_MAP.md): Beacon runs the find→fix→prove
          loop on its own, and the one thing it never does without you is
          push a change live (every Wix publish is one-click approve; no
          zero-touch auto-publish). */}
      <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/[0.04] px-4 py-3.5 space-y-2.5">
        <h2 className="text-[12px] font-semibold text-foreground">
          What you&rsquo;ll get once everything&rsquo;s connected
        </h2>
        <p className="text-[12px] text-foreground leading-relaxed">
          Once everything is connected, one click of &ldquo;Update my
          data&rdquo; does the whole job for you: it reads all your sources, then
          finds, drafts, and ranks the exact fixes. The one thing Beacon never
          does on its own is change your live site: every change to your website
          needs your one-click approval first. Nothing runs on a hidden schedule,
          you are always in control of when it refreshes.
        </p>
        <ul className="space-y-1.5 text-[12px] text-muted-foreground leading-relaxed">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-accent-primary">•</span>
            <span>
              When the AI assistants recommend a competitor on a topic real
              people are already searching for, Beacon drafts the answer to add
              first, so your effort lands where customers are actually looking.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-accent-primary">•</span>
            <span>
              It ranks fixes by the pages that actually make you money, not just
              the ones with the most clicks.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-accent-primary">•</span>
            <span>
              After you approve a change, Beacon confirms it went live and then
              watches your rankings, traffic, and AI mentions to prove the fix
              actually worked.
            </span>
          </li>
        </ul>
      </div>

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
      <div
        data-connector-card="google-gsc"
        data-gsc-readiness={gscReadiness?.verdict ?? "not_connected"}
        className="rounded-lg border border-border/60 bg-surface-inset/20"
      >
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
                    <p className="text-[12px] text-muted-foreground">
                      Last synced: {formatDate(google.last_synced_at)}
                    </p>
                  </>
                ) : null}
                {gscSyncResult ? (
                  <p
                    className={`text-[12px] ${gscSyncResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {gscSyncResult.text}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                {/* J5 (2026-05-18), soft-disconnect aware copy. When
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
                  onClick={() =>
                    handleConnectorSyncNow(syncGscNow, setGscSyncPending, setGscSyncResult)
                  }
                  disabled={gscSyncPending || isPending}
                  className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {gscSyncPending ? "Syncing…" : "Pull my Search Console data"}
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

        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.google_gsc} />
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
            {gscReadiness.verdict !== "ready" ? (
              <p
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  gscReadiness.tone === "attention"
                    ? "bg-status-warning/[0.12] text-status-warning"
                    : "bg-surface-inset/60 text-muted-foreground"
                }`}
                role="status"
              >
                {gscReadiness.verdict === "needs_reconnect"
                  ? "Reconnect needed"
                  : gscReadiness.verdict === "connected_no_data"
                    ? "Connected · no data yet, pull to backfill"
                    : "Not ready"}
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 rounded-md bg-status-success/[0.12] px-2 py-0.5 text-[11px] font-semibold text-status-success">
                Ready
              </p>
            )}
            <p className="text-[12px] font-medium text-foreground">
              {gscReadiness.headline}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {gscReadiness.detail}
            </p>
          </div>
        ) : null}

        {/* ── Location picker (Google connected), GBP only ── */}
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
                access, no writes to your Search Console property. Pull the
                latest any time with the &ldquo;Pull my Search Console
                data&rdquo; button above.
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

      {/* ── Google Analytics (GA4), Slice 9.A1β (2026-05-18) ── */}
      <div
        id="connector-google-ga4"
        className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
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
                  // #197, setup-blocking state (half-wired connector). The
                  // amber color was the only cue; add a non-color "Action
                  // needed:" prefix + role="status" so it's not color-only
                  // and is announced when the state changes after connect.
                  <p className="text-[12px] text-status-warning" role="status">
                    <span className="font-semibold">Action needed:</span>{" "}
                    Connected, select a property to finish setup.
                  </p>
                )}
                {ga4SyncResult ? (
                  <p
                    className={`text-[12px] ${ga4SyncResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {ga4SyncResult.text}
                  </p>
                ) : null}
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
              <>
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
                <button
                  type="button"
                  onClick={handleDisconnectGa4}
                  disabled={isPending || anySync}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
                  title="Soft disconnect: historical data stays cached but no new data refreshes until you reconnect."
                >
                  {isPending ? "Disconnecting…" : "Disconnect"}
                </button>
              </>
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

        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.google_ga4} />
        </div>

        {/* Property picker, only when connected. Properties load on
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
                Beacon reads your GA4 page/URL traffic, which feeds your
                priority score. Read-only access, no writes to your Google
                Analytics property.
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

      {/* Yelp connector removed 2026-06-18 (operator request, not relevant to
          content/AEO tenants). State + actions remain wired but no card renders. */}

      {/* ── Wix, North-star onboarding (2026-06-11) ──
          Self-serve publish connection: the customer pastes their own
          Wix API key + site id. Connecting NEVER publishes anything -
          every edit still goes through Approve & Push (your click,
          daily caps, non-destructive guard). */}
      <div
        id="connector-wix"
        className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
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
                Connect your Wix site so Beacon can prepare publish-ready
                edits. Nothing changes on your live site without your
                approval.
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

        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.wix} />
        </div>

        {wix.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
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
        ) : null}

        <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Only used when you approve an edit for publishing. Daily caps and
            the non-destructive guard apply to every change, and disconnecting
            stops all publishing instantly.
          </p>
        </div>
      </div>

      {/* ── SEMrush, Connect-cards slice (2026-06-12) ── */}
      <div
        id="connector-semrush"
        className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
        data-connector-card="semrush"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">Semrush</h3>
            {semrush.status === "connected" ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Connected &middot; Authorized {formatDate(semrush.connected_at)}
                </p>
                {semrushSyncResult ? (
                  <p
                    className={`text-[12px] ${semrushSyncResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {semrushSyncResult.text}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect your Semrush API key so Beacon can see which
                searches you rank for, which rivals beat you, and where
                the gaps are. Pulls fresh data on demand, using up to
                ~1,500 Semrush API units per refresh.
              </p>
            )}
          </div>
          {semrush.status === "connected" ? (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                onClick={() =>
                  handleConnectorSyncNow(syncSemrushNow, setSemrushSyncPending, setSemrushSyncResult)
                }
                disabled={semrushSyncPending || isPending}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {semrushSyncPending ? "Syncing…" : "Pull my data now"}
              </button>
              <button
                type="button"
                onClick={() => handleSimpleDisconnect(disconnectSemrush, setSemrush)}
                disabled={isPending}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.semrush} />
        </div>
        {semrush.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <label htmlFor="semrush-api-key" className="sr-only">
              Semrush API key
            </label>
            <input
              id="semrush-api-key"
              type="password"
              value={semrushKeyInput}
              onChange={(e) => setSemrushKeyInput(e.target.value)}
              placeholder="Semrush API key"
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <label htmlFor="semrush-database" className="sr-only">
              Semrush regional database
            </label>
            <input
              id="semrush-database"
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
                aria-describedby="semrush-connect-hint"
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Semrush
              </button>
              <p id="semrush-connect-hint" className="sr-only">
                Enter your API key to enable this button.
              </p>
            </div>
          </div>
        ) : null}
        {semrush.status === "connected" ? (
          <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Reconnecting and running Sync now pulls fresh data and uses API
              units again.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Profound, Connect-cards slice (2026-06-12) ── */}
      <div
        id="connector-profound"
        className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
        data-connector-card="profound"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">Profound</h3>
            {profound.status === "connected" ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Connected &middot; Authorized {formatDate(profound.connected_at)}
                </p>
                {profoundSyncResult ? (
                  <p
                    className={`text-[12px] ${profoundSyncResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {profoundSyncResult.text}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Connect your Profound API key so Beacon can track how AI
                assistants mention and cite your site, and where rivals
                get cited instead. Pulls run on demand only and use your
                Profound plan&apos;s quota each time.
              </p>
            )}
          </div>
          {profound.status === "connected" ? (
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                onClick={() =>
                  handleConnectorSyncNow(syncProfoundNow, setProfoundSyncPending, setProfoundSyncResult)
                }
                disabled={profoundSyncPending || isPending}
                className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {profoundSyncPending ? "Syncing…" : "Pull my data now"}
              </button>
              <button
                type="button"
                onClick={() => handleSimpleDisconnect(disconnectProfound, setProfound)}
                disabled={isPending}
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.profound} />
        </div>
        {profound.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
            <label htmlFor="profound-api-key" className="sr-only">
              Profound API key
            </label>
            <input
              id="profound-api-key"
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
                aria-describedby="profound-connect-hint"
                className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                Connect Profound
              </button>
              <p id="profound-connect-hint" className="sr-only">
                Enter your API key to enable this button.
              </p>
            </div>
          </div>
        ) : null}
        {profound.status === "connected" ? (
          <div className="border-t border-border/40 px-5 py-3 bg-surface-inset/10">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Reconnecting and running Sync now pulls fresh data and uses API
              units again.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Microsoft Clarity, Connect-cards slice (2026-06-12) ── */}
      <div
        id="connector-clarity"
        className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24"
        data-connector-card="clarity"
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              Microsoft Clarity
            </h3>
            {clarity.status === "connected" ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Connected &middot; Authorized {formatDate(clarity.connected_at)}
                </p>
                {claritySyncResult ? (
                  <p
                    className={`text-[12px] ${claritySyncResult.ok ? "text-status-success" : "text-status-warning"}`}
                  >
                    {claritySyncResult.text}
                  </p>
                ) : null}
              </>
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
            <div className="flex shrink-0 flex-col items-end gap-2">
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
          ) : null}
        </div>
        <div className="px-5 pb-3">
          <ConnectorCapability {...CONNECTOR_CAPABILITY.clarity} />
        </div>
        {clarity.status !== "connected" ? (
          <div className="border-t border-border/40 px-5 py-4 space-y-2">
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
        ) : null}
      </div>

      {/* ── Manual import note ── */}
      <div className="rounded-lg border border-border/40 bg-surface-inset/10 px-5 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Manual CSV/JSON import remains available under{" "}
          <a href="/settings/import" className="text-accent-primary hover:underline">
            Settings → Import
          </a>{" "}
          regardless of connector status. Connectors are additive; they do not replace manual import.
        </p>
      </div>
    </div>
  );
}
