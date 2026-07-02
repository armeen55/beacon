import "server-only";

/**
 * publish-canary (2026-07-02, master plan item 86) - the nightly publish-path
 * canary.
 *
 * Wix is excluded from READ_SOURCES because it is publish-only, so today a
 * dead token or a stale url-map is only discovered when an operator-accepted
 * change actually fails to push - hours or days after the token went bad.
 * This canary proves the publish path is still alive BEFORE the operator
 * needs it, the same way the arming precondition in publishing-mode-actions.ts
 * proves it once at arm-time.
 *
 * Per tenant, per night:
 *   1. tokenOk    - one cheap authenticated READ (wixListDataCollections,
 *                   a bare GET, no page param needed - it is not paginated).
 *   2. urlMapOk   - the url-map has at least one row AND one spot-checked
 *                   row still resolves to a real Wix item (wixGetDataItem).
 *   3. dryRunOk   - ONE executePush dry-run on a representative pushable
 *                   card, through the EXACT helper publishing-mode-actions.ts
 *                   already uses to prove the arming precondition. A dry-run
 *                   never writes to Wix (push-service.ts stops before any
 *                   adapter call and returns kind: "dry_run").
 *
 * Ritz guard: tenant-ritz-founder (RITZ_TENANT_ID) is publish-HARD-blocked at
 * the push-service level (Invariant 2 - Ritz never pushes). The canary
 * RESPECTS that block rather than working around it: it records an honest
 * "publishing off for this site" status and never attempts a dry-run for
 * Ritz. This never weakens the block - executePush itself still refuses
 * Ritz unconditionally even if this file's guard were ever removed.
 *
 * Failure never cascades: every per-tenant step is caught individually, and
 * the whole pass is wrapped so one tenant's failure (or a total outage) never
 * throws out of runPublishCanary. The cron route additionally wraps the call.
 *
 * READ + DRY-RUN ONLY. Zero live writes to any CMS, ever. Tokens are never
 * logged (only ok/fail booleans and a bounded, token-free error string).
 */

import { RITZ_TENANT_ID } from "@/domains/push/push-service";
import { getWixConnectorToken } from "@/lib/connector-store";
import { wixListDataCollections } from "@/lib/connectors/wix/client";
import { log } from "@/lib/logger";
import type { PublishHealthRow } from "./publish-canary-store";
import { writePublishHealth } from "./publish-canary-store";

/** A writable Wix field-edit action type (mirrors publishing-mode-actions.ts
 *  WRITABLE_ACTION_TYPES exactly - the dry-run must pick the same shape of
 *  card the real arming precondition proves, or the canary would prove a
 *  different, less representative path). */
const WRITABLE_ACTION_TYPES = new Set([
  "edit_title",
  "edit_meta",
  "edit_h1",
  "change_h1",
  "edit_h2",
  "add_schema",
  "improve_copy",
]);

const RITZ_FIX_HINT = "Publishing is off for this site.";

/** Plain-language, first-person next steps - never a raw code word. */
const FIX_HINTS = {
  noToken: "I don't have a site connection for this tenant yet. Connect Wix on Settings to enable publishing.",
  tokenDead: "Your site connection expired. Reconnect on Settings and tonight's batch can publish again.",
  urlMapEmpty: "I don't have a page map for your site yet. Resync your Wix connection on Settings so I know which pages to update.",
  urlMapStale: "One of your mapped pages no longer exists on your site. Resync your Wix connection on Settings to refresh the map.",
  dryRunFailed: "A practice run of the publish path failed. I'll keep trying tonight, but recheck your Wix connection on Settings if this continues.",
} as const;

/** Small, injectable seam for tests - defaults call the real modules. */
export type PublishCanaryDeps = {
  now?: Date;
  getWixConnectorToken?: typeof getWixConnectorToken;
  wixListDataCollections?: typeof wixListDataCollections;
  /** Explicit-tenant Supabase url-map row read (bypasses the ambient
   *  currentTenantId() the shared mappings-store uses, which would silently
   *  read the wrong tenant - or throw - inside a multi-tenant fan-out). */
  readUrlMapForTenant?: (tenantId: string) => Promise<UrlMapProbe>;
  /** Runs the exact dry-run helper publishing-mode-actions.ts uses to prove
   *  the arming precondition. Injectable so tests never touch real Wix/Supabase. */
  runRepresentativeDryRun?: (tenantId: string) => Promise<boolean>;
};

export type UrlMapProbe = {
  /** null = the check itself could not run (e.g. no Supabase env, or the
   *  cron's ambient tenant context does not match this tenant). Never a
   *  false "ok" - a probe that could not run must not be reported as clean. */
  ok: boolean | null;
  rowCount: number;
  /** True once one mapped row was spot-checked and still resolves to a real item. */
  spotCheckOk: boolean;
  detail?: string;
};

async function defaultRunRepresentativeDryRun(tenantId: string): Promise<boolean> {
  // Reuses the EXACT arming-precondition path (same module, same helper) so
  // the canary proves the identical push path the operator's "Turn on
  // one-click publishing" flow already trusts - never a re-implementation.
  const { getRepository } = await import("@/lib/persistence/repositories");
  const { executePush } = await import("@/domains/push/push-service");
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const candidate = edits.find(
    (e) =>
      WRITABLE_ACTION_TYPES.has(e.action_type) &&
      (e.implementation_status ?? "recommended") !== "dismissed" &&
      (e.proposed_text ?? "").trim().length > 0,
  );
  if (candidate == null) return true; // nothing pushable to test yet - not a failure
  const res = await executePush({ tenantId, edit: candidate, dryRun: true });
  return res.kind === "dry_run" || res.kind === "dev_note";
}

/**
 * Explicit-tenant url-map probe via Supabase directly (never through the
 * ambient-tenant mappings-store reads, which resolve `currentTenantId()` -
 * safe for a single request, unsafe inside a cron fan-out over many
 * tenants where no request header sets the ambient tenant). Mirrors the
 * exact tables `wix_url_map` reads/writes (mappings-store.ts).
 */
async function defaultReadUrlMapForTenant(tenantId: string): Promise<UrlMapProbe> {
  let admin;
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    admin = getSupabaseAdmin();
  } catch {
    return { ok: null, rowCount: 0, spotCheckOk: false, detail: "no_supabase_env" };
  }
  const { data, error } = await admin
    .from("wix_url_map")
    .select("data_collection_id,data_item_id")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (error != null) {
    const code = (error as { code?: unknown }).code;
    if (code === "42P01") {
      // Table not migrated yet in this environment - the check cannot run,
      // it is not evidence of an empty map.
      return { ok: null, rowCount: 0, spotCheckOk: false, detail: "url_map_table_missing" };
    }
    return { ok: null, rowCount: 0, spotCheckOk: false, detail: "url_map_read_failed" };
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return { ok: false, rowCount: 0, spotCheckOk: false };
  }
  const row = rows[0] as { data_collection_id?: unknown; data_item_id?: unknown };
  const dataCollectionId = typeof row.data_collection_id === "string" ? row.data_collection_id : null;
  const dataItemId = typeof row.data_item_id === "string" ? row.data_item_id : null;
  if (dataCollectionId == null || dataItemId == null) {
    return { ok: false, rowCount: rows.length, spotCheckOk: false, detail: "malformed_row" };
  }
  try {
    const { wixGetDataItem } = await import("@/lib/connectors/wix/client");
    const got = await wixGetDataItem({ dataCollectionId, dataItemId }, { tenantId });
    const spotCheckOk = got.ok && got.value != null;
    return { ok: spotCheckOk, rowCount: rows.length, spotCheckOk, detail: got.ok ? undefined : got.reason };
  } catch (e) {
    return {
      ok: false,
      rowCount: rows.length,
      spotCheckOk: false,
      detail: e instanceof Error ? e.message.slice(0, 200) : "spot_check_error",
    };
  }
}

/** Run the canary for ONE tenant. Never throws - every step is caught and
 *  folded into the returned row. */
export async function runPublishCanaryForTenant(
  tenantId: string,
  deps: PublishCanaryDeps = {},
): Promise<PublishHealthRow> {
  const now = deps.now ?? new Date();
  const whenIso = now.toISOString();
  const getToken = deps.getWixConnectorToken ?? getWixConnectorToken;
  const listCollections = deps.wixListDataCollections ?? wixListDataCollections;
  const readUrlMap = deps.readUrlMapForTenant ?? defaultReadUrlMapForTenant;
  const runDryRun = deps.runRepresentativeDryRun ?? defaultRunRepresentativeDryRun;

  // Ritz guard: publishing is hard-blocked at the push-service level
  // (Invariant 2). Respect it honestly rather than dry-running a path that
  // will never actually push for this tenant - and never attempt to route
  // around the block to "test" it anyway.
  if (tenantId === RITZ_TENANT_ID) {
    const row: PublishHealthRow = {
      tenant_id: tenantId,
      whenIso,
      tokenOk: null,
      urlMapOk: null,
      dryRunOk: null,
      fixHint: RITZ_FIX_HINT,
    };
    return row;
  }

  // Step 0: does this tenant even have a Wix connection configured? No
  // token at all is a distinct, honest state from a dead token.
  let token;
  try {
    token = await getToken(tenantId);
  } catch (e) {
    return {
      tenant_id: tenantId,
      whenIso,
      tokenOk: null,
      urlMapOk: null,
      dryRunOk: null,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      fixHint: FIX_HINTS.noToken,
    };
  }
  if (token == null) {
    return {
      tenant_id: tenantId,
      whenIso,
      tokenOk: null,
      urlMapOk: null,
      dryRunOk: null,
      fixHint: FIX_HINTS.noToken,
    };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return {
      tenant_id: tenantId,
      whenIso,
      tokenOk: false,
      urlMapOk: null,
      dryRunOk: null,
      fixHint: FIX_HINTS.tokenDead,
    };
  }

  // Step 1: cheap authenticated READ - list collections (a bare GET, proves
  // the api key + site id still authenticate against the live Wix API).
  let tokenOk: boolean;
  let tokenError: string | undefined;
  try {
    const listed = await listCollections({ tenantId });
    tokenOk = listed.ok;
    tokenError = listed.ok ? undefined : `${listed.reason}${listed.detail ? `: ${listed.detail}` : ""}`.slice(0, 200);
  } catch (e) {
    tokenOk = false;
    tokenError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  if (!tokenOk) {
    return {
      tenant_id: tenantId,
      whenIso,
      tokenOk: false,
      urlMapOk: null,
      dryRunOk: null,
      error: tokenError,
      fixHint: FIX_HINTS.tokenDead,
    };
  }

  // Step 2: url-map non-empty + one mapped item spot-check.
  let urlMap: UrlMapProbe;
  try {
    urlMap = await readUrlMap(tenantId);
  } catch (e) {
    urlMap = { ok: null, rowCount: 0, spotCheckOk: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
  if (urlMap.ok === false) {
    return {
      tenant_id: tenantId,
      whenIso,
      tokenOk: true,
      urlMapOk: false,
      dryRunOk: null,
      error: urlMap.detail,
      fixHint: urlMap.rowCount === 0 ? FIX_HINTS.urlMapEmpty : FIX_HINTS.urlMapStale,
    };
  }
  // urlMap.ok === null means the probe could not run (no Supabase env, or
  // table not migrated) - honest "unknown", proceed to the dry-run so a
  // missing check on one axis does not block reporting the others.

  // Step 3: ONE dry-run through the exact arming-precondition helper.
  let dryRunOk: boolean;
  let dryRunError: string | undefined;
  try {
    dryRunOk = await runDryRun(tenantId);
  } catch (e) {
    dryRunOk = false;
    dryRunError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }

  return {
    tenant_id: tenantId,
    whenIso,
    tokenOk: true,
    urlMapOk: urlMap.ok,
    dryRunOk,
    ...(dryRunOk ? {} : { error: dryRunError, fixHint: FIX_HINTS.dryRunFailed }),
  };
}

export type PublishCanaryRunResult = {
  tenantId: string;
  row: PublishHealthRow;
};

/**
 * Run the canary across every tenant, persist each result, never throw.
 * `tenantIds` is the fan-out list (the route passes every tenant from
 * listTenants(); tests pass a small fixed list).
 */
export async function runPublishCanary(
  tenantIds: readonly string[],
  deps: PublishCanaryDeps = {},
): Promise<PublishCanaryRunResult[]> {
  const results: PublishCanaryRunResult[] = [];
  for (const tenantId of tenantIds) {
    try {
      const row = await runPublishCanaryForTenant(tenantId, deps);
      results.push({ tenantId, row });
      await writePublishHealth(row).catch((e) => {
        log.warn("[publish-canary] health write failed", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const row: PublishHealthRow = {
        tenant_id: tenantId,
        whenIso: (deps.now ?? new Date()).toISOString(),
        tokenOk: null,
        urlMapOk: null,
        dryRunOk: null,
        error: error.slice(0, 200),
      };
      results.push({ tenantId, row });
      log.warn("[publish-canary] tenant check failed", { tenantId, error });
      await writePublishHealth(row).catch(() => {
        /* best-effort - never let a receipt-write failure surface */
      });
    }
  }
  return results;
}
