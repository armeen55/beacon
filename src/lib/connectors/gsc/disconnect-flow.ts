/**
 * 2026-05-18 — Section 8 J5 — GSC soft-disconnect / reconnect flow.
 *
 * Operator clicks "Disconnect GSC" on `/settings/connectors`. We
 * MUST NOT delete the `connector_tokens` row — that would destroy
 * cached historical state. Instead, this slice flips a
 * `disconnected_at` ISO timestamp on the existing row's payload.
 *
 * Effects of soft disconnect (locked Section 8 J5 contract):
 *   • `getConnectorInfo("google_gsc")` reports `status:
 *     "disconnected"` while preserving `connected_at` + `expires_at`
 *     so the UI can render the "Last refreshed at X days ago"
 *     tooltip.
 *   • `gscUrlInspect()` fail-softs the way it does for a missing
 *     token. Cached `gsc_url_inspections` rows ARE preserved — the
 *     downstream `loadGscSignal` adapter continues to surface them
 *     when `allowFreshFetch=false`.
 *   • Reconnect re-runs the standard OAuth flow. The OAuth callback
 *     calls `saveConnectorToken()` which UPSERTs a fresh payload —
 *     the new payload doesn't carry `disconnected_at` so the field
 *     is naturally cleared on reconnect (no manual reset needed).
 *
 * Pure (in the "delegates to existing helpers, no new I/O surface"
 * sense). The actual Supabase write happens inside
 * `updateConnectorToken` via the existing tenant-scoped boundary.
 *
 * Pinned by:
 *   • `tests/lib/connectors/gsc/disconnect-flow.test.ts`
 */

import "server-only";

import {
  getGoogleConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";

type DisconnectGscArgs = {
  /** Tenant id explicitly threaded by the caller. Mirrors the
   *  rest of the GSC client surface — never reads ambient context. */
  tenantId: string;
  /** Optional clock injection for tests. Defaults to current time. */
  now?: Date | string;
};

type SoftDisconnectResult = {
  /** True when the token existed AND the disconnect patch was
   *  applied. False when the token was missing (operator already
   *  disconnected OR never connected) — surface as a no-op success
   *  rather than an error. */
  applied: boolean;
  /** ISO timestamp the disconnect was recorded. null when no token
   *  row existed. */
  disconnected_at: string | null;
};

/**
 * Soft-disconnect the GSC connector for the given tenant. NEVER
 * deletes the token row. Sets `disconnected_at` on the payload via
 * `updateConnectorToken("google_gsc", { disconnected_at })`.
 *
 * Idempotent: invoking twice yields the SECOND timestamp on the
 * payload (existing field is overwritten by the latest patch). No
 * destructive write.
 *
 * Returns `{ applied: false, disconnected_at: null }` when no token
 * exists for the tenant — caller treats as no-op success.
 */
export async function softDisconnectGsc(
  args: DisconnectGscArgs,
): Promise<SoftDisconnectResult> {
  const existing = await getGoogleConnectorToken("gsc", args.tenantId);
  if (existing == null) {
    return { applied: false, disconnected_at: null };
  }
  const nowIso =
    args.now == null
      ? new Date().toISOString()
      : args.now instanceof Date
        ? args.now.toISOString()
        : new Date(args.now).toISOString();
  await updateConnectorToken(
    "google_gsc",
    { disconnected_at: nowIso },
    args.tenantId,
  );
  return { applied: true, disconnected_at: nowIso };
}

