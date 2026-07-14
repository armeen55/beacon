/**
 * recovery-actions (BEACON_500 T0b, 2026-07-03) - the ONE recovery map.
 *
 * Every surface that shows a health problem (the Connections page cards, the
 * cron health panel, Today's data-pipe alert) currently writes its OWN "what
 * do I do about this" sentence. That is how two surfaces end up disagreeing
 * about the fix for the same broken thing. This module is the single source
 * of truth: given a failure state, return the plain-English problem, the
 * exact fix sentence (naming the button or page), the deep link, and - when
 * one already exists - the named self-serve action the operator can click
 * right there instead of being sent somewhere else.
 *
 * HARD RULE: this module NEVER invents a new write action. `selfServe` only
 * ever names an action that already exists elsewhere in the codebase (the
 * Google OAuth start route, a "Sync now" server action, the /diagnostics/wix
 * mapper). When no safe self-serve action exists, `selfServe` is undefined
 * and `exactFix` is an honest sentence about what to click or what Beacon
 * will do on its own next - never "contact support" or "investigate this".
 *
 * PURE: no I/O. Callers (connectors-client, cron-health-panel, the Today
 * data-pipe alert, the /settings finish-setup checklist) resolve their own
 * state and pass it in here so this module stays trivially unit-testable and
 * the three surfaces can never drift on wording again.
 */

export type RecoverySelfServe =
  | { kind: "reconnect_google"; connectorKind: "gsc" | "ga4" }
  | { kind: "sync_now"; provider: "google_gsc" | "google_ga4" | "profound" | "clarity" }
  | { kind: "wix_map_collections" }
  | { kind: "wix_sync_url_map" }
  | { kind: "gsc_backfill_start" };

export type RecoveryAction = {
  /** The plain-English problem, first person, no jargon. */
  plainProblem: string;
  /** One sentence naming the exact button or page that fixes it. */
  exactFix: string;
  /** Deep link to the surface that fixes it. */
  href: string;
  /** Present only when a safe, ALREADY-EXISTING self-serve action exists
   *  right on the surface showing the problem. */
  selfServe?: RecoverySelfServe;
};

// ─────────────────────────────────────────────────────────────────────
// Per-connector failure states
// ─────────────────────────────────────────────────────────────────────

// "token_revoked" was removed 2026-07-09: Google's invalid_grant cannot
// reliably distinguish an expired grant from an explicitly revoked one, and
// deriveConnectorFailureState only ever emitted "token_expired", so the
// revoked copy was unreachable dead copy. One honest state remains.
export type ConnectorFailureState =
  | "token_expired"
  // 2026-07-11 (BUG 2): the grant is NOT proven dead, but this source has failed
  // to pull for days. A needs-attention state with honest, non-accusatory copy
  // ("reconnecting usually fixes this"), distinct from the proven-dead
  // token_expired above so we never claim a revocation we cannot prove.
  | "sync_failing"
  | "never_connected"
  | "sync_stale"
  | "zero_rows_written"
  | "wix_url_map_empty"
  | "gsc_property_mismatch";

export type ConnectorKind =
  | "google_gsc"
  | "google_ga4"
  | "wix"
  | "profound"
  | "clarity";

const CONNECTOR_LABEL: Record<ConnectorKind, string> = {
  google_gsc: "Google Search Console",
  google_ga4: "Google Analytics",
  wix: "Wix",
  profound: "Profound",
  clarity: "Microsoft Clarity",
};

/** What each connector's data actually powers, in the operator's own money/
 *  customer language - named on a dead-login line so the reconnect cost is
 *  concrete ("bring your traffic and revenue numbers back"), never abstract.
 *  No jargon (no "OAuth"/"token"/"invalid_grant"), Beacon voice. */
const CONNECTOR_VALUE: Record<ConnectorKind, string> = {
  google_gsc: "bring your search numbers back",
  google_ga4: "bring your traffic and revenue numbers back",
  wix: "start publishing your approved changes again",
  profound: "see where AI assistants mention you again",
  clarity: "see where visitors get stuck again",
};

const CONNECTORS_HREF = "/settings/connectors";
const WIX_DIAGNOSTICS_HREF = "/diagnostics/wix";

/** Sources with an on-page "Sync now" server action (actions.ts). Wix is
 *  publish-only and never gets a data "Sync now" button; GA4/GSC/Profound/
 *  Clarity all do. */
function syncNowSelfServe(
  connector: ConnectorKind,
): RecoverySelfServe | undefined {
  switch (connector) {
    case "google_gsc":
      return { kind: "sync_now", provider: "google_gsc" };
    case "google_ga4":
      return { kind: "sync_now", provider: "google_ga4" };
    case "profound":
      return { kind: "sync_now", provider: "profound" };
    case "clarity":
      return { kind: "sync_now", provider: "clarity" };
    case "wix":
      return undefined;
  }
}

/**
 * Map ONE (connector, failure state) pair to its recovery action. Returns
 * null when the state does not apply to that connector (e.g. Wix has no
 * OAuth token to expire, GSC/GA4/Profound/Clarity have no url map).
 */
export function recoveryForConnectorFailure(
  connector: ConnectorKind,
  state: ConnectorFailureState,
): RecoveryAction | null {
  const label = CONNECTOR_LABEL[connector];
  const isGoogle = connector === "google_gsc" || connector === "google_ga4";

  switch (state) {
    case "sync_failing": {
      // BUG 2 (2026-07-11): a Google source that has silently failed to pull for
      // days without proving the grant dead. NEVER claim the login expired (we
      // cannot prove it) - offer reconnect as the usual fix. The dated "since
      // <date>" problem sentence is composed on the surface from
      // needs_attention_since; this map supplies the fix + self-serve action.
      if (!isGoogle) return null;
      const value = CONNECTOR_VALUE[connector];
      return {
        plainProblem: `I have not been able to pull your ${label} data for several days.`,
        exactFix: `Reconnecting usually fixes this. Click Connect ${label} on the Connections page to ${value}. It takes under a minute.`,
        href: CONNECTORS_HREF,
        selfServe: {
          kind: "reconnect_google",
          connectorKind: connector === "google_gsc" ? "gsc" : "ga4",
        },
      };
    }

    case "token_expired": {
      if (!isGoogle) return null;
      // Dead-login line (2026-07-06): first person, no jargon (never
      // "OAuth"/"token"/"invalid_grant"), and it NAMES what reconnecting brings
      // back so the cost is concrete. "login expired" is the plain word for a
      // dead refresh grant. Google's invalid_grant cannot reliably tell an
      // expiry from an explicit revoke, so this one honest state covers both
      // (the reconnect fix is identical either way).
      const value = CONNECTOR_VALUE[connector];
      return {
        plainProblem: `Your ${label} login expired.`,
        exactFix: `Click Connect ${label} on the Connections page to ${value}. It takes under a minute and nothing else changes.`,
        href: CONNECTORS_HREF,
        selfServe: {
          kind: "reconnect_google",
          connectorKind: connector === "google_gsc" ? "gsc" : "ga4",
        },
      };
    }

    case "never_connected": {
      return {
        plainProblem: `${label} is not connected yet.`,
        exactFix: `Click Connect ${label} on the Connections page. ${
          connector === "wix"
            ? "Paste your Wix API key and site id, nothing publishes until you approve a change."
            : "It takes under a minute."
        }`,
        href: CONNECTORS_HREF,
      };
    }

    case "sync_stale": {
      const selfServe = syncNowSelfServe(connector);
      return {
        plainProblem: `${label} is connected, but its last good sync is old.`,
        exactFix: selfServe
          ? `Click Pull my data now on the ${label} card on the Connections page. If that keeps failing, reconnect ${label}.`
          : `Open the Connections page and check the ${label} card. I will keep retrying this on my own overnight.`,
        href: CONNECTORS_HREF,
        selfServe,
      };
    }

    case "zero_rows_written": {
      if (connector === "wix") return null; // Wix is publish-only, no rows to write.
      const selfServe = syncNowSelfServe(connector);
      return {
        plainProblem: `${label} is connected, but the last sync wrote no data.`,
        exactFix: selfServe
          ? `Click Pull my data now on the ${label} card on the Connections page. If it still writes nothing, ${
              isGoogle ? "reconnect the connection" : "check the API key on that card"
            }.`
          : `Open the Connections page and check the ${label} card.`,
        href: CONNECTORS_HREF,
        selfServe,
      };
    }

    case "wix_url_map_empty": {
      if (connector !== "wix") return null;
      return {
        plainProblem: "Wix is connected, but I have no page map yet, so I cannot publish anything to your site.",
        exactFix: "Open Wix page mapping and click Discover collections, then Save mapping for each page type.",
        href: WIX_DIAGNOSTICS_HREF,
        selfServe: { kind: "wix_map_collections" },
      };
    }

    case "gsc_property_mismatch": {
      if (connector !== "google_gsc") return null;
      return {
        plainProblem:
          "Google Search Console is connected, but the property it's reading does not match your site's real address (with or without www), so the data is not landing.",
        exactFix:
          "Reconnect Google Search Console on the Connections page so I can re-detect the right property for your domain.",
        href: CONNECTORS_HREF,
        selfServe: { kind: "reconnect_google", connectorKind: "gsc" },
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-cron-job failure states
// ─────────────────────────────────────────────────────────────────────

export type CronFailureState = "late" | "stalled";

/**
 * A stalled/late Vercel cron cannot be restarted by anything the operator
 * can click from their seat (there is no "run this cron now" affordance for
 * most jobs). Honest fix: when the job's OWN work has a "Sync now" mirror on
 * Connections (sync-connectors does), point there. Otherwise, say plainly
 * what Beacon will do on its own, never "investigate this" or "contact
 * support" - the operator cannot fix a cron schedule from the product.
 */
const CRON_JOB_SYNC_NOW: Partial<Record<string, RecoverySelfServe>> = {
  "sync-connectors": undefined, // no single sync-now covers all 4 sources; the per-source buttons do
};

const CRON_JOB_NEXT_STEP: Record<string, string> = {
  "publish-canary": "I will keep checking your site every night. If Wix is connected and mapped, publishing itself is unaffected by this check running late.",
  "sync-connectors": "Pull each connected source's data yourself right now with the Sync now button on its card, on the Connections page.",
  "measure-due": "I will pick this back up on its own overnight. Nothing you need to click.",
  autopilot: "Autopilot will resume shipping on its own next run. Your queued changes are safe and waiting.",
  "ai-engines": "I will check AI answers again on the next scheduled run. Nothing you need to click.",
  precompute: "I will keep preparing drafts on the next run. Nothing you need to click.",
  "page-factory": "I am retrying this batch automatically in the background when you use Beacon. Refresh once in a moment to see the recovered result.",
  "strategy-review": "I will run the next strategy review on its own next scheduled run.",
};

const DEFAULT_CRON_NEXT_STEP =
  "This is Beacon's own overnight schedule, not something to click here. I will retry it on the next scheduled run.";

/**
 * Recovery for a late/stalled cron job. `job` is the CRON_SCHEDULE_MAP job
 * key (e.g. "sync-connectors"); `label` is its plain-English display label
 * (already computed by cron-schedule-map / deadman for the same job).
 */
export function recoveryForCronFailure(
  job: string,
  label: string,
  state: CronFailureState,
): RecoveryAction {
  const selfServe = CRON_JOB_SYNC_NOW[job];
  const nextStep = CRON_JOB_NEXT_STEP[job] ?? DEFAULT_CRON_NEXT_STEP;
  const severity = state === "stalled" ? "has stopped showing up" : "is running behind";
  return {
    plainProblem: `${label} ${severity}.`,
    exactFix:
      job === "sync-connectors"
        ? `${nextStep} Open the Connections page.`
        : nextStep,
    href: CONNECTORS_HREF,
    selfServe,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Site probe failure state
// ─────────────────────────────────────────────────────────────────────

export function recoveryForSiteDown(): RecoveryAction {
  return {
    plainProblem: "Your site did not answer the last two times I checked.",
    exactFix:
      "Open your site in a browser to confirm it loads. If it's down, this is something to fix with your host or Wix, not inside Beacon. I will keep checking and clear this the moment your site answers again.",
    href: CONNECTORS_HREF,
  };
}

// ─────────────────────────────────────────────────────────────────────
// [G] Operator-gated setup items (the /settings "Finish setting up" card)
// ─────────────────────────────────────────────────────────────────────

export type SetupItemKind =
  | "wix_page_mapping"
  | "digest_email"
  | "indexnow_key"
  | "gsc_full_backfill"
  | "revenue_model";

const DIAGNOSTICS_CONNECTORS_HREF = "/diagnostics/connectors";

const SETUP_HREF: Record<SetupItemKind, string> = {
  wix_page_mapping: WIX_DIAGNOSTICS_HREF,
  // BEACON_DIGEST_TO / RESEND_API_KEY are Vercel environment variables, not
  // an in-app form field (grepped: no page writes them). The honest deep
  // link is the Connections page, where the rest of the operator's setup
  // lives, alongside a fix sentence that names Vercel plainly rather than
  // pointing at a button that does not exist.
  digest_email: CONNECTORS_HREF,
  indexnow_key: DIAGNOSTICS_CONNECTORS_HREF,
  gsc_full_backfill: DIAGNOSTICS_CONNECTORS_HREF,
  revenue_model: "/settings/config",
};

const SETUP_PROBLEM: Record<SetupItemKind, string> = {
  wix_page_mapping: "Wix is connected, but I have no page map, so I cannot publish approved changes to your site.",
  digest_email: "I have no email address to send your morning digest to.",
  indexnow_key: "I am not telling Bing and other search engines the moment a page changes.",
  gsc_full_backfill: "I am only using recent Search Console history, not your full available history.",
  revenue_model: "I do not know your unit economics yet, so I cannot turn traffic into a dollar estimate.",
};

const SETUP_FIX: Record<SetupItemKind, string> = {
  wix_page_mapping: "Open Wix page mapping, click Discover collections, then Save mapping for each page type.",
  digest_email: "Set BEACON_DIGEST_TO (your email) and RESEND_API_KEY in your Vercel project settings, then redeploy. This one is a server setting, not something inside the app.",
  indexnow_key: "Open the connectors diagnostics page and generate an IndexNow key.",
  gsc_full_backfill: "Open the connectors diagnostics page and click Load my full Search Console history.",
  revenue_model: "Open Business info and set your revenue model (per visit or per lead) so I can estimate dollars from real traffic.",
};

export type SetupItemStatus = {
  kind: SetupItemKind;
  /** True when this item is already done and should self-hide. */
  done: boolean;
};

/** Build the recovery action for ONE not-yet-done setup item. Returns null
 *  when the item is already done (the checklist card omits it). */
export function recoveryForSetupItem(status: SetupItemStatus): RecoveryAction | null {
  if (status.done) return null;
  const selfServe: RecoverySelfServe | undefined =
    status.kind === "wix_page_mapping"
      ? { kind: "wix_map_collections" }
      : status.kind === "gsc_full_backfill"
        ? { kind: "gsc_backfill_start" }
        : undefined;
  return {
    plainProblem: SETUP_PROBLEM[status.kind],
    exactFix: SETUP_FIX[status.kind],
    href: SETUP_HREF[status.kind],
    selfServe,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Deriving the failure state from what a card already has on hand
// ─────────────────────────────────────────────────────────────────────

/** Connected-but-no-data-yet older than this many days reads as sync_stale
 *  rather than a fresh "just connected, first pull hasn't landed" state.
 *  Mirrors connector-store.ts's own STALE_DAYS so the two never disagree. */
const STALE_DAYS = 14;

/** The bare facts a card already renders (ConnectorInfo's own fields), so
 *  this stays pure - no import of the connector store's I/O layer. */
export type ConnectorFacts = {
  status: "connected" | "disconnected";
  /** Present + non-empty means the last sync ended in a proven auth failure
   *  (ConnectorInfo.auth_failed_at). Google connectors only. */
  authFailedAt?: string | null;
  /** Present + non-empty means the bounded escalation marker is set: this source
   *  failed N nights spanning >= M days WITHOUT proving the grant dead (BUG 2,
   *  ConnectorInfo.needs_attention_at). Google connectors only. */
  needsAttentionAt?: string | null;
  lastSyncedAt?: string | null;
  /** GA4 only: connected but no property chosen yet reads as never_connected
   *  in spirit (0 rows will ever land) - callers pass this through rather
   *  than this module reaching for a GA4-specific field name. */
  missingRequiredSelection?: boolean;
};

/**
 * Derive the ConnectorFailureState from the facts a card already has, or
 * null when the connector is healthy and nothing needs surfacing. `now`
 * defaults to the real clock; tests pass a fixed Date.
 */
export function deriveConnectorFailureState(
  facts: ConnectorFacts,
  now: Date = new Date(),
): ConnectorFailureState | null {
  if (facts.status !== "connected") {
    return "never_connected";
  }
  if (facts.authFailedAt != null && facts.authFailedAt !== "") {
    return "token_expired";
  }
  // Proven-dead (token_expired) outranks this: only escalate to sync_failing when
  // the grant is NOT proven dead but has silently failed to pull for days.
  if (facts.needsAttentionAt != null && facts.needsAttentionAt !== "") {
    return "sync_failing";
  }
  if (facts.missingRequiredSelection) {
    return "never_connected";
  }
  if (facts.lastSyncedAt == null || facts.lastSyncedAt === "") {
    return null; // unreliable "never synced" signal - stay quiet, matches connector-store's own posture
  }
  const lastSynced = Date.parse(facts.lastSyncedAt);
  if (!Number.isFinite(lastSynced)) return null;
  const days = Math.floor(Math.max(0, now.getTime() - lastSynced) / (24 * 60 * 60 * 1000));
  if (days >= STALE_DAYS) return "sync_stale";
  return null;
}
