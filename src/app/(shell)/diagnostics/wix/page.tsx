/**
 * Operator Wix Surface — 2026-06-10 (§push layer).
 *
 * Connect a Wix site-level API key + site id → paste the dynamic-page
 * collection mappings → sync the url map → see pushable coverage + the
 * push ledger. The "Approve & Push" action on /recommendations consumes
 * this plumbing.
 *
 * Operator-only: 404s without BEACON_OPERATOR_MODE. Resilient reads.
 * Pinned by tests/app/diagnostics/wix-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { PageHeader } from "@/components/data/page-header";
import { getConnectorInfo } from "@/lib/connector-store";
import { getWixUrlMap, getWixCollectionConfig } from "@/lib/connectors/wix/url-map";
import { readPushLedger, MAX_PUSHES_PER_DAY } from "@/domains/push/caps";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import {
  approveAndPushFromForm,
  acceptAllQueuedFromForm,
  connectWixFromForm,
  saveWixMappingsFromForm,
  syncWixMapFromForm,
  disconnectWixFromForm,
  revertPushFromForm,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function WixDiagnosticPage() {
  // Night-shift #126 (2026-06-11): gate by PER-TENANT publish auth
  // (operator mode OR owner/admin/founder of the current tenant) —
  // pre-fix this page 404'd for a tenant OWNER unless the GLOBAL
  // operator env flag was set. Same authority the actions enforce.
  if (!(await canPublishForCurrentTenant())) notFound();

  let connected = false;
  let lastSyncedAt: string | null = null;
  try {
    const info = await getConnectorInfo("wix");
    connected = info.status === "connected";
    lastSyncedAt = info.last_synced_at;
  } catch {
    /* soft-fail */
  }
  const [mappings, urlMap, ledger] = await Promise.all([
    getWixCollectionConfig().catch(() => []),
    getWixUrlMap().catch(() => []),
    readPushLedger().catch(() => []),
  ]);
  const recentPushes = ledger.slice(-15).reverse();

  // Pushable cards: field-targeted queue edits whose URL is in the map.
  let pushable: Array<{ id: string; label: string; url: string; field: string; proposed: string }> = [];
  try {
    const tenantId = await currentTenantId();
    const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
    const mapped = new Set(urlMap.map((e) => e.url));
    pushable = edits
      .filter((e) => {
        const status = e.implementation_status ?? "recommended";
        return (
          (status === "recommended" || status === "accepted" || status === "push_failed") &&
          (e.target_element_key ?? "").startsWith("field:")
        );
      })
      .map((e) => ({
        id: e.id,
        label: e.display_label ?? e.action_type,
        url: e.target_url,
        field: (e.target_element_key ?? "").slice("field:".length),
        proposed: (e.proposed_text ?? "").slice(0, 160),
        inMap: mapped.has(e.target_url) || mapped.has(`${e.target_url}/`),
      }))
      .filter((e) => (e as { inMap?: boolean }).inMap)
      .slice(0, 20);
  } catch {
    pushable = [];
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Wix publishing"
        description={`The push layer's Wix side: connect, map dynamic-page collections, sync the url map. Approved Change Cards then publish directly — capped at ${MAX_PUSHES_PER_DAY}/day, field-level edits only, never URLs or deletions. Operator-mode only.`}
      />

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <div className="mb-2 flex items-center gap-3">
          <span
            data-wix-status={connected ? "connected" : "disconnected"}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
              connected
                ? "bg-status-success/15 text-status-success border-status-success/30"
                : "bg-surface-inset/60 text-muted-foreground border-border/40"
            }`}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">url map synced {lastSyncedAt}</span>
          )}
        </div>

        {!connected ? (
          <form action={connectWixFromForm} className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Create a site-level API key in the Wix dashboard (Settings → API
              keys) with Data Items + Blog + Media permissions. Stored
              server-side; never shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="password" name="api_key" required placeholder="Wix API key"
                className="rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm" />
              <input type="text" name="site_id" required placeholder="site id (GUID)"
                className="w-72 rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm" />
              <button type="submit" className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white">
                Connect
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={syncWixMapFromForm}>
              <button type="submit" className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white">
                Sync url map
              </button>
            </form>
            <form action={disconnectWixFromForm}>
              <button type="submit" className="rounded border border-border/40 px-3 py-1 text-sm text-muted-foreground">
                Disconnect
              </button>
            </form>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Dynamic-page collections ({mappings.length})
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">
          JSON array of {"{ dataCollectionId, slugField, urlPrefix, labelField?, contentFieldRoles? }"} —
          which CMS collections render pages and how their URLs are built. Add{" "}
          <code>{'"contentFieldRoles": { "title": "<field>", "heading": "<field>" }'}</code>{" "}
          to let Accept push title/heading edits LIVE to those pages (omit it and
          those edits stay paste-ready).
        </p>
        <form action={saveWixMappingsFromForm} className="space-y-2">
          <textarea
            name="mappings_json"
            rows={6}
            defaultValue={JSON.stringify(mappings, null, 2)}
            className="w-full rounded border border-border/40 bg-bg/40 p-2 font-mono text-xs"
          />
          <button type="submit" className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white">
            Save mappings
          </button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          url map: <span className="font-semibold text-foreground">{urlMap.length}</span> pages currently pushable.
        </p>
      </section>

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Pushable cards ({pushable.length})
        </h2>
        {pushable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No field-targeted cards whose URL is in the synced map. Cards need
            target_element_key &quot;field:&lt;itemField&gt;&quot; + a mapped URL.
          </p>
        ) : (
          <ul className="space-y-2">
            {pushable.map((c) => (
              <li key={c.id} className="rounded border border-border/40 bg-bg/40 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <form action={approveAndPushFromForm}>
                    <input type="hidden" name="edit_id" value={c.id} />
                    <button type="submit" className="rounded bg-accent-primary px-3 py-1 text-xs font-semibold text-white">
                      Approve &amp; Push
                    </button>
                  </form>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{c.url} · field:{c.field}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.proposed}…</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Each click publishes ONE card (Invariant 1). Caps: {MAX_PUSHES_PER_DAY}/day,
          field edits only, no URLs, no deletions — enforced in the push code.
        </p>
      </section>
      {/* #84 (2026-06-11): accept-only batch — publishing stays per-card. */}
      <form action={acceptAllQueuedFromForm}>
        <button
          type="submit"
          className="rounded-lg border border-border/60 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          title="Flip up to 20 queued cards to accepted (never pushes)"
        >
          Accept all queued (≤20) — staging only, never publishes
        </button>
      </form>



      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Push ledger (latest {recentPushes.length})
        </h2>
        {recentPushes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pushes yet. Approve a Change Card on /recommendations.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recentPushes.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                {/* #82 (2026-06-11): one-click revert for successful field
                    pushes (not for reverts themselves). Ships through the
                    same capped push path. */}
                {e.result === "pushed" && !e.edit_id.endsWith("__revert") && (
                  <form action={revertPushFromForm} className="order-last">
                    <input type="hidden" name="edit_id" value={e.edit_id} />
                    <button
                      type="submit"
                      className="rounded border border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      title="Restore the field's pre-push value (counts against the daily push cap)"
                    >
                      Revert
                    </button>
                  </form>
                )}
                <span>
                  <span className={e.result === "pushed" ? "text-status-success" : "text-status-error"}>
                    {e.result}
                  </span>{" "}
                  <span className="font-mono text-xs">{e.target_url}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.pushed_at.slice(0, 16).replace("T", " ")} · {e.detail ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
