"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConnectorInfo } from "@/lib/connector-store";
import { CONNECTOR_REGISTRY, COULD_NOT_CHECK, type ConnectorRollup } from "@/lib/connectors/registry";
import type { Ga4Property } from "@/lib/connectors/ga4/types";
import { Pill } from "@/components/ui/pill";
import {
  getGoogleAuthUrl,
  getGoogleGscConnectorStatus,
  getGoogleGa4ConnectorStatus,
  disconnectGoogle,
  disconnectGoogleGa4,
  saveClarityConnection,
  disconnectClarity,
  listGa4Properties,
  selectGa4Property,
  syncGscNow,
  syncGa4Now,
  syncClarityNow,
} from "./actions";
import type { ConnectorSyncNowResult } from "./actions";

type Props = {
  google: ConnectorInfo;
  /** Slice 9.A1β (2026-05-18), GA4 connector status. Mirrors the GSC shape. */
  ga4: ConnectorInfo;
  clarity: ConnectorInfo;
  /** J5 (2026-05-18), pre-rendered "GSC data last refreshed X days ago.
   *  Reconnect to refresh." copy, composed server-side in page.tsx (the
   *  formatter is server-only). Null unless GSC is disconnected after having
   *  been authorized at some point. */
  gscStaleCopy?: string | null;
  /** MAX_SEO_AEO Phase 4 (2026-06-16), pre-composed GSC readiness for the card:
   *  the resolved property (derived from the tenant's own synced rows, never
   *  hardcoded), a plain-English headline/detail, the verdict, and a tone.
   *  Composed server-side (no live Google call), always present, so the card
   *  always has an honest readiness line to render. */
  gscReadiness?: {
    verdict:
      | "ready"
      | "connected_no_data"
      | "not_connected"
      | "unknown"
      | "needs_reconnect";
    headline: string;
    detail: string;
    tone: "ready" | "attention" | "idle";
    property: string | null;
  };
  /** R17a (v1 266), pre-composed missing-days line for the GSC card (days
   *  missing INSIDE the covered range, and that they get re-pulled). Composed
   *  server-side from the same daily totals the sync writes; null when the
   *  range is complete. */
  gscGapLine?: string | null;
  /** Slice 9.A1β (2026-05-18), pre-rendered "Google Analytics data last
   *  refreshed X days ago" copy. Null unless GA4 is disconnected after having
   *  been authorized. */
  ga4StaleCopy?: string | null;
  /** Honest connector health rollup (2026-07-20). Computed server-side in
   *  page.tsx from the SAME per-connector health the cards render, so the
   *  headline + subline count impaired sources truthfully (a connected-but-failing
   *  GA4 ingest) and can never read "3 of 3 connected" while a source is broken.
   *  Required (2026-08-12): the old optional "bare connected count" fallback was
   *  a second, quieter count that could disagree with this one. */
  rollup: ConnectorRollup;
  /** BUG 3 (2026-07-11), per-source refresh-ledger facts for the "last pulled /
   *  data through / result" strip, keyed by ledger source name. Composed
   *  server-side from latestRefreshBySource; self-hiding when absent. */
  refreshLedger?: RefreshLedgerFacts;
};

/** BUG 3 (2026-07-11) one source's refresh-ledger fact, as the page hands it to
 *  the client (plain, serializable). */
type RefreshLedgerFact = {
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
  // WHAT BROKE IS NOT THE CUSTOMER'S BUSINESS TO FIX. This used to name two
  // server settings by their variable names, which reads as an instruction the
  // operator cannot follow. The exact Google error code stays where it is
  // useful: the server log at the callback route.
  exchange_failed:
    "Google could not finish connecting. This one is on Beacon's side, and nothing about your connection changed. Try Connect again in a few minutes.",
  persistence_failed:
    "Authorization succeeded but Beacon could not save the connection. Please try again, or contact support if it persists.",
  env_missing:
    "The Google connection cannot start right now. This one is on Beacon's side. Try again in a few minutes.",
  // #213, the callback emits ?error=not_authorized when Google grants but the
  // signed-in user is NOT a member of the account being connected. The old copy
  // said "you declined the permission", which is a different error entirely
  // (that one is access_denied) and sent people to re-approve a screen they had
  // already approved.
  not_authorized:
    "This Google connection belongs to a different Beacon account. Sign in with the account that owns this site, then retry.",
  // Per-tenant OAuth never-erase guard (2026-07-09): Google gave no ongoing
  // access and I could not safely keep the previous connection, so I changed
  // nothing. The fix that always works: revoke Beacon's access on the Google
  // side, then connect again so Google issues fresh ongoing access.
  refresh_token_missing:
    "Google did not grant ongoing access, so everything was left unchanged. Click Connect to try again. If this happens twice, open myaccount.google.com/permissions, remove Beacon's access for this Google account, then click Connect again.",
  // Per-tenant OAuth replace semantics (2026-07-09): a replacement picked a
  // DIFFERENT Google account but Google gave no ongoing access for it, so the
  // existing connection stays exactly as it was.
  account_mismatch:
    "That is a different Google account, and Google did not grant ongoing access for it, so your current connection was left unchanged. To switch accounts, open myaccount.google.com/permissions signed in as the new account, remove Beacon's access, then click Replace Google account again.",
};

// #213, friendly catch-all for any error code we don't have explicit copy
// for, so a non-technical owner never sees a raw code like "not_authorized".
const DEFAULT_ERROR_MESSAGE =
  "Couldn't connect to Google, please try again.";

// (EXCHANGE_DETAIL_HINTS deleted 2026-08-12: five paragraphs of server-setup
// instructions, naming environment variables, hosting scopes and Google Cloud
// Console paths, appended verbatim to a customer's screen. The operator
// diagnoses an exchange failure from the callback route's server log, which
// carries Google's full error; the screen gets one honest sentence.)

/** A raw exception is a fact about Beacon's insides, never advice a customer can
 *  act on. Keep it in the browser console for whoever can use it, and hand the
 *  screen the sentence written for it. */
function trouble(e: unknown, copy: string): string {
  console.warn("[connectors]", e instanceof Error ? e.message : String(e));
  return copy;
}

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
        : " That pull did not work; it gets tried again automatically.";
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

/**
 * A source whose CHECK failed (2026-08-12). Deliberately NOT a Connect card:
 * nothing about the stored connection moved, so there is no button to press
 * here and no state to undo. The only next step that is true is to look again.
 */
function UncheckedCard({ anchor, title }: { anchor: string; title: string }) {
  return (
    <div
      id={`connector-${anchor}`}
      data-connector-card={anchor}
      data-connector-unchecked="true"
      className="rounded-lg border border-border/60 bg-surface-inset/20 scroll-mt-24 px-5 py-4"
    >
      <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">{COULD_NOT_CHECK}</p>
    </div>
  );
}

export function ConnectorsClient({
  google: initialGoogle,
  ga4: initialGa4,
  clarity: initialClarity,
  gscStaleCopy = null,
  gscReadiness,
  gscGapLine = null,
  ga4StaleCopy = null,
  rollup,
  refreshLedger = {},
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [google, setGoogle] = useState<ConnectorInfo>(initialGoogle);
  const [ga4, setGa4] = useState<ConnectorInfo>(initialGa4);
  // Connect-cards slice (2026-06-12)
  const [clarity, setClarity] = useState<ConnectorInfo>(initialClarity);
  const [clarityTokenInput, setClarityTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Customer "Pull my data now" affordances (2026-06-14), each
  // connected source gets a per-card sync button wired to its
  // server action; a per-card pending flag + last-result message
  // mirror the Sync-now idiom above.
  type SyncResultMsg = { ok: boolean; text: string } | null;
  const [gscSyncPending, setGscSyncPending] = useState(false);
  const [gscSyncResult, setGscSyncResult] = useState<SyncResultMsg>(null);
  const [ga4SyncPending, setGa4SyncPending] = useState(false);
  const [ga4SyncResult, setGa4SyncResult] = useState<SyncResultMsg>(null);
  const [claritySyncPending, setClaritySyncPending] = useState(false);
  const [claritySyncResult, setClaritySyncResult] = useState<SyncResultMsg>(null);

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
      setError(ERROR_MESSAGES[err] ?? DEFAULT_ERROR_MESSAGE);
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

  function handleConnect() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await getGoogleAuthUrl();
      if (result.url) {
        window.location.href = result.url;
        // The server action already answers in customer language (its TROUBLE
        // copy). Throwing that away for a generic line lost the one sentence
        // written for what actually happened.
      } else setError(result.error ?? ERROR_MESSAGES.env_missing);
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
      } else setError(result.error ?? ERROR_MESSAGES.env_missing);
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
      } else setError(result.error ?? ERROR_MESSAGES.env_missing);
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
        trouble(e, "Your Analytics properties could not be read just now. Try again in a moment."),
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
    // #206, "Disconnect Google" clears the Search Console grant. Confirm first
    // so the connection isn't dropped by a stray click.
    const confirmed = window.confirm(
      "Disconnect Google Search Console? Your previously synced data stays, reconnect any time to resume updates.",
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
        setSuccess("Google disconnected. Previously synced data is preserved.");
        router.refresh();
      } else {
        setError(result.error ?? "Failed to disconnect.");
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
      } catch {
        setResult({ ok: false, text: "That could not finish just now. Try again in a moment." });
      } finally {
        setPending(false);
      }
    });
  }

  // The honest rollup (2026-07-20) is the ONE source of the summary counts +
  // copy: there is no second, quieter count to disagree with it.
  const { connectedCount: connected, total, needsAttentionCount: needsAttention, unknownCount } = rollup;

  // FP10a (2026-07-02) - one health color for the summary strip. A connected
  // source that is NOT delivering data (needs attention) is an "attention"
  // state, never "live" - the certified leak was a green "4 of 4" hiding a
  // broken GA4 ingest. A source that could not be CHECKED is not an alarm
  // either: it is simply not a claim, so it holds the strip at neutral.
  const summaryIntent =
    needsAttention > 0
      ? "attention"
      : unknownCount > 0
        ? "neutral"
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
        <Pill intent={summaryIntent}>{rollup.headline}</Pill>
      </div>
      {/* Honest subline (2026-07-20) - never undercounts the impaired sources;
          same rollup as the headline Pill, so the two can never disagree. */}
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        {rollup.subline}
      </p>
      <p className="text-[12px] text-muted-foreground leading-relaxed">
        Once a source is connected it is read in the background and turned
        into exact changes to make. Your live site is never touched. You
        apply each change in your CMS and mark it implemented, then the page
        is measured.
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
      {google.status === "unknown" ? (
        <UncheckedCard anchor="google-gsc" title="Google Search Console" />
      ) : google.status === "connected" ? (
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
                      : gscReadiness.verdict === "unknown"
                        ? "Could not check"
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
            {gscSyncResult ? (
              <p
                className={`text-[12px] ${gscSyncResult.ok ? "text-status-success" : "text-status-warning"}`}
              >
                {gscSyncResult.text}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 px-5 pb-4">
            <button
              type="button"
              onClick={() =>
                handleConnectorSyncNow(syncGscNow, setGscSyncPending, setGscSyncResult)
              }
              disabled={gscSyncPending || isPending}
              className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {gscSyncPending ? "Syncing…" : "Pull your Search Console data"}
            </button>
            {/* Per-tenant OAuth (2026-07-09): swap the Google account behind
                this live connection. Google shows the account chooser and
                asks for fresh consent; the current connection stays untouched
                until the new account actually grants ongoing access. */}
            <button
              type="button"
              onClick={() => handleReplaceGoogle("gsc")}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Pick a different Google account for Search Console. The current connection is kept until the new account grants access."
            >
              Replace Google account
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Disconnects Google Search Console. Historical data stays cached; no new data refreshes until you reconnect."
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
      {ga4.status === "unknown" ? (
        <UncheckedCard anchor="google-ga4" title="Google Analytics" />
      ) : ga4.status === "connected" ? (
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
                {ga4SyncPending ? "Syncing…" : "Pull your data now"}
              </button>
            ) : null}
            {/* Per-tenant OAuth (2026-07-09): swap the Google account behind
                this live connection; nothing changes until the new account
                actually grants ongoing access. */}
            <button
              type="button"
              onClick={() => handleReplaceGoogle("ga4")}
              disabled={isPending}
              className="rounded-md border border-border/60 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
              title="Pick a different Google account for Analytics. The current connection is kept until the new account grants access."
            >
              Replace Google account
            </button>
            <button
              type="button"
              onClick={handleDisconnectGa4}
              disabled={isPending}
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

      {/* ── Microsoft Clarity, Connect-cards slice (2026-06-12) ── */}
      {clarity.status === "unknown" ? (
        <UncheckedCard anchor="clarity" title="Microsoft Clarity" />
      ) : clarity.status === "connected" ? (
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
              {claritySyncPending ? "Syncing…" : "Pull your data now"}
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
            Connect a Clarity API token to see where visitors get
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
