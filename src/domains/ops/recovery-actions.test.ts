import { describe, it, expect } from "vitest";
import {
  recoveryForConnectorFailure,
  recoveryForCronFailure,
  recoveryForSiteDown,
  recoveryForSetupItem,
  deriveConnectorFailureState,
  type ConnectorFailureState,
  type ConnectorKind,
} from "./recovery-actions";

const NO_DASH = /[‒–—―]/;

describe("recoveryForConnectorFailure", () => {
  it("token_expired on Google names Connect + the reconnect self-serve", () => {
    const action = recoveryForConnectorFailure("google_gsc", "token_expired");
    expect(action).not.toBeNull();
    expect(action!.plainProblem).toContain("Google Search Console");
    expect(action!.plainProblem).toContain("expired");
    expect(action!.exactFix).toContain("Connect Google Search Console");
    expect(action!.href).toBe("/settings/connectors");
    expect(action!.selfServe).toEqual({ kind: "reconnect_google", connectorKind: "gsc" });
    expect(action!.exactFix).not.toMatch(NO_DASH);
  });

  it("token_revoked on GA4 says 'revoked' and points at the GA4 reconnect", () => {
    const action = recoveryForConnectorFailure("google_ga4", "token_revoked");
    expect(action!.plainProblem).toContain("revoked");
    expect(action!.selfServe).toEqual({ kind: "reconnect_google", connectorKind: "ga4" });
  });

  it("token_expired/token_revoked do not apply to Wix (no OAuth token)", () => {
    expect(recoveryForConnectorFailure("wix", "token_expired")).toBeNull();
    expect(recoveryForConnectorFailure("wix", "token_revoked")).toBeNull();
  });

  it("never_connected on Wix mentions pasting the key and that nothing publishes yet", () => {
    const action = recoveryForConnectorFailure("wix", "never_connected");
    expect(action!.exactFix).toContain("API key");
    expect(action!.exactFix.toLowerCase()).toContain("nothing publishes");
    expect(action!.selfServe).toBeUndefined();
  });

  it("never_connected on a data source has no self-serve action (Connect is a form, not a one-click)", () => {
    const action = recoveryForConnectorFailure("profound", "never_connected");
    expect(action!.exactFix).toContain("Connect Profound");
    expect(action!.selfServe).toBeUndefined();
  });

  it("sync_stale on GSC offers the sync-now self-serve", () => {
    const action = recoveryForConnectorFailure("google_gsc", "sync_stale");
    expect(action!.selfServe).toEqual({ kind: "sync_now", provider: "google_gsc" });
    expect(action!.exactFix).toContain("Pull my data now");
  });

  it("sync_stale on Wix (publish-only, no sync-now button) names what Beacon does instead", () => {
    const action = recoveryForConnectorFailure("wix", "sync_stale");
    expect(action!.selfServe).toBeUndefined();
    expect(action!.exactFix).not.toContain("Pull my data now");
  });

  it("zero_rows_written on GA4 names the reconnect follow-up for Google sources", () => {
    const action = recoveryForConnectorFailure("google_ga4", "zero_rows_written");
    expect(action!.selfServe).toEqual({ kind: "sync_now", provider: "google_ga4" });
    expect(action!.exactFix).toContain("reconnect");
  });

  it("zero_rows_written on Profound (non-Google) suggests checking the API key, not reconnect", () => {
    const action = recoveryForConnectorFailure("profound", "zero_rows_written");
    expect(action!.exactFix).toContain("API key");
  });

  it("zero_rows_written does not apply to Wix (publish-only, no rows to write)", () => {
    expect(recoveryForConnectorFailure("wix", "zero_rows_written")).toBeNull();
  });

  it("wix_url_map_empty deep-links to /diagnostics/wix with the mapper self-serve", () => {
    const action = recoveryForConnectorFailure("wix", "wix_url_map_empty");
    expect(action!.href).toBe("/diagnostics/wix");
    expect(action!.selfServe).toEqual({ kind: "wix_map_collections" });
    expect(action!.plainProblem).toContain("no page map");
  });

  it("wix_url_map_empty does not apply to non-Wix connectors", () => {
    expect(recoveryForConnectorFailure("google_gsc", "wix_url_map_empty")).toBeNull();
  });

  it("gsc_property_mismatch names the www-host trap plainly and offers reconnect", () => {
    const action = recoveryForConnectorFailure("google_gsc", "gsc_property_mismatch");
    expect(action!.plainProblem).toContain("does not match your site's real address");
    expect(action!.selfServe).toEqual({ kind: "reconnect_google", connectorKind: "gsc" });
  });

  it("gsc_property_mismatch does not apply outside GSC", () => {
    expect(recoveryForConnectorFailure("google_ga4", "gsc_property_mismatch")).toBeNull();
  });

  it("every mapped action is free of em/en dashes (Beacon voice)", () => {
    const connectors: ConnectorKind[] = ["google_gsc", "google_ga4", "wix", "profound", "clarity"];
    const states: ConnectorFailureState[] = [
      "token_expired",
      "token_revoked",
      "never_connected",
      "sync_stale",
      "zero_rows_written",
      "wix_url_map_empty",
      "gsc_property_mismatch",
    ];
    for (const c of connectors) {
      for (const s of states) {
        const action = recoveryForConnectorFailure(c, s);
        if (!action) continue;
        expect(action.plainProblem).not.toMatch(NO_DASH);
        expect(action.exactFix).not.toMatch(NO_DASH);
      }
    }
  });
});

describe("recoveryForCronFailure", () => {
  it("sync-connectors points at the per-source Sync now buttons, never a dead-end", () => {
    const action = recoveryForCronFailure("sync-connectors", "The nightly data sync", "stalled");
    expect(action.exactFix.toLowerCase()).toContain("sync now");
    expect(action.href).toBe("/settings/connectors");
    expect(action.plainProblem).toContain("has stopped showing up");
  });

  it("late uses a softer verb than stalled", () => {
    const action = recoveryForCronFailure("autopilot", "The autopilot shipping pass", "late");
    expect(action.plainProblem).toContain("is running behind");
  });

  it("a job with no button (e.g. measure-due) names what Beacon will do on its own, never a dead-end apology", () => {
    const action = recoveryForCronFailure("measure-due", "The nightly results check", "stalled");
    expect(action.exactFix.toLowerCase()).not.toContain("investigate");
    expect(action.exactFix.toLowerCase()).not.toContain("contact support");
    expect(action.exactFix.length).toBeGreaterThan(10);
  });

  it("an unknown job key still returns an honest generic next step, never throws", () => {
    const action = recoveryForCronFailure("some-future-job", "The future job", "late");
    expect(action.exactFix).toContain("next scheduled run");
  });

  it("every cron recovery sentence is free of em/en dashes", () => {
    for (const job of ["sync-connectors", "measure-due", "autopilot", "page-factory", "unknown-job"]) {
      for (const state of ["late", "stalled"] as const) {
        const action = recoveryForCronFailure(job, "The job", state);
        expect(action.plainProblem).not.toMatch(NO_DASH);
        expect(action.exactFix).not.toMatch(NO_DASH);
      }
    }
  });
});

describe("recoveryForSiteDown", () => {
  it("names checking the site directly, not something inside Beacon", () => {
    const action = recoveryForSiteDown();
    expect(action.plainProblem).toContain("did not answer");
    expect(action.exactFix).toContain("your host or Wix");
    expect(action.exactFix).not.toMatch(NO_DASH);
  });
});

describe("deriveConnectorFailureState", () => {
  const now = new Date("2026-07-03T12:00:00.000Z");

  it("disconnected reads as never_connected", () => {
    expect(deriveConnectorFailureState({ status: "disconnected" }, now)).toBe("never_connected");
  });

  it("a proven auth failure outranks everything else", () => {
    expect(
      deriveConnectorFailureState(
        { status: "connected", authFailedAt: "2026-07-01T00:00:00.000Z", lastSyncedAt: "2026-07-03T00:00:00.000Z" },
        now,
      ),
    ).toBe("token_expired");
  });

  it("connected but missing a required selection (e.g. GA4 property) reads as never_connected", () => {
    expect(
      deriveConnectorFailureState({ status: "connected", missingRequiredSelection: true }, now),
    ).toBe("never_connected");
  });

  it("never synced (null last_synced_at) stays quiet - unreliable signal", () => {
    expect(deriveConnectorFailureState({ status: "connected", lastSyncedAt: null }, now)).toBeNull();
  });

  it("synced recently is healthy (null state)", () => {
    expect(
      deriveConnectorFailureState({ status: "connected", lastSyncedAt: "2026-07-02T00:00:00.000Z" }, now),
    ).toBeNull();
  });

  it("synced 14+ days ago reads as sync_stale", () => {
    expect(
      deriveConnectorFailureState({ status: "connected", lastSyncedAt: "2026-06-01T00:00:00.000Z" }, now),
    ).toBe("sync_stale");
  });

  it("an unparseable lastSyncedAt stays quiet rather than false-alarming", () => {
    expect(
      deriveConnectorFailureState({ status: "connected", lastSyncedAt: "not-a-date" }, now),
    ).toBeNull();
  });
});

describe("recoveryForSetupItem", () => {
  it("returns null when the item is already done (self-hiding)", () => {
    expect(recoveryForSetupItem({ kind: "revenue_model", done: true })).toBeNull();
  });

  it("wix_page_mapping deep-links to the Wix mapper with the self-serve action", () => {
    const action = recoveryForSetupItem({ kind: "wix_page_mapping", done: false });
    expect(action!.href).toBe("/diagnostics/wix");
    expect(action!.selfServe).toEqual({ kind: "wix_map_collections" });
  });

  it("gsc_full_backfill deep-links to the diagnostics page with the backfill-start self-serve", () => {
    const action = recoveryForSetupItem({ kind: "gsc_full_backfill", done: false });
    expect(action!.href).toBe("/diagnostics/connectors");
    expect(action!.selfServe).toEqual({ kind: "gsc_backfill_start" });
    expect(action!.exactFix).toContain("Load my full Search Console history");
  });

  it("digest_email names Vercel honestly (no in-app form sets this env var)", () => {
    const action = recoveryForSetupItem({ kind: "digest_email", done: false });
    expect(action!.exactFix).toContain("Vercel");
    expect(action!.exactFix).toContain("BEACON_DIGEST_TO");
    expect(action!.selfServe).toBeUndefined();
  });

  it("digest_email, indexnow_key, gsc_full_backfill, revenue_model each have a plain problem + fix + link", () => {
    const kinds = ["digest_email", "indexnow_key", "gsc_full_backfill", "revenue_model"] as const;
    for (const kind of kinds) {
      const action = recoveryForSetupItem({ kind, done: false });
      expect(action).not.toBeNull();
      expect(action!.plainProblem.length).toBeGreaterThan(5);
      expect(action!.exactFix.length).toBeGreaterThan(5);
      expect(action!.href.startsWith("/")).toBe(true);
      expect(action!.plainProblem).not.toMatch(NO_DASH);
      expect(action!.exactFix).not.toMatch(NO_DASH);
    }
  });
});
