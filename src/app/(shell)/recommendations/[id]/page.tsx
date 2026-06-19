import "server-only";

/**
 * /recommendations/[id] — Bundle 2B premium brief page.
 *
 * Reuses the EXACT same loader path as /recommendations
 * (loadPersistedRecommendationQueueForPage → buildRecommendationActionRows).
 * The detail page resolves down to one RecommendationActionRow via the
 * `resolveRecommendationDetail` four-step ladder, then renders the
 * 5-act brief (Suggested Copy is Act 4 when supported).
 *
 * No new fetches. No new server actions. No recommendation-engine
 * changes.
 */

// Dynamic + no-store posture. `dynamic = "force-dynamic"` already
// implies `revalidate = 0`; the explicit exports are defensive
// against any future Next default change. `fetchCache =
// "force-no-store"` forces every internal fetch this route makes to
// opt out of caching, which closes the door on stale RSC payloads
// reaching the client Router Cache. Combined with `prefetch={false}`
// on every list-to-detail Link, the detail route's response cannot be
// served from any cache layer for the operator's signed-in click.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { unstable_noStore as noStore } from "next/cache";

import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  loadPageSurgeonForUrl,
  type PageSurgeonForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import { getRepository } from "@/lib/persistence/repositories";
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { getChangelogEntries as _getChangelogEntriesUnused } from "@/lib/seed-data.server";
import { buildChangelogIdByRecId } from "@/domains/recommendations/changelog-link";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { pickBackfilledCurrentText } from "@/domains/recommendations/backfill-current-text";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

import {
  decodeRecommendationRouteId,
  encodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import { redirect } from "next/navigation";
import { RecommendationDetailClient } from "./recommendation-detail-client";
import { RecommendationDetailNotFound } from "./recommendation-detail-not-found";
import type { CausalSelfForecast } from "@/domains/attribution/causal-self-forecast";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";

// Silence the unused-import linter on the changelog re-export. The
// changelog reads happen INSIDE the persisted loader; this file no
// longer needs to call them directly. Kept as an explicit named
// import so the import graph documents what the route consumes.
void _getChangelogEntriesUnused;

export default async function RecommendationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Explicit no-store opt-out for every fetch inside this render. The
  // route's `dynamic = "force-dynamic"` + `fetchCache = "force-no-store"`
  // exports do most of the work; this call belt-and-suspenders the
  // request-scoped cache so a future refactor can't accidentally
  // re-introduce a cached fetch in the resolution path.
  noStore();

  const trace = createPerfTrace("loader:/recommendations/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/recommendations/[id]",
  });
  try {
    const { id: rawId } = await params;
    const sp: Record<string, string | string[] | undefined> = await (
      searchParams ?? Promise.resolve({})
    );
    const debugResolver = sp.debugResolver === "1";
    const decodedId = decodeRecommendationRouteId(rawId);

    if (!decodedId) {
      trace.data("outcome", "not_found_bad_id");
      if (debugResolver) {
        return (
          <>
            <DetailDebugPanel
              rawId={rawId ?? ""}
              decodedId={null}
              decodeFailed
              allRowsCount={0}
              firstFiveRowIds={[]}
              resolution={{ kind: "decode_failed" }}
            />
            <RecommendationDetailNotFound />
          </>
        );
      }
      return <RecommendationDetailNotFound />;
    }

    const tenantId = await currentTenantId();
    // Approve & Push exposure (2026-06-16) — resolve publish authorization
    // ONCE on the server (operator-mode OR owner/admin/founder member of this
    // tenant) and thread it to the action row. Fail-soft to false (button
    // hidden) so a transient auth read never surfaces a publish control.
    const canPublish = await canPublishForCurrentTenant().catch(() => false);
    const persisted = await trace.time(
      "loadPersistedRecommendationQueueForPage",
      () => loadPersistedRecommendationQueueForPage({ tenantId }),
    );

    const promptTextById: Record<string, string> = {};
    for (const p of persisted.trackedPrompts) {
      promptTextById[p.id] = p.text;
    }

    // Slice 4.5.G-B.1 — load active tracked competitor entities for
    // the render-time `why`-display guard. Soft-fail to [] when the
    // read errors so the page still renders (the guard's UUID +
    // internal-token detection runs regardless of competitorNames).
    let competitorNames: string[] = [];
    try {
      const entities = await getRepository()
        .forTenant(tenantId)
        .getTrackedEntities();
      competitorNames = entities
        .filter(
          (e) => e.entity_type === "competitor" && e.is_active === true,
        )
        .map((e) => e.name)
        .filter((n) => typeof n === "string" && n.length > 0);
    } catch {
      competitorNames = [];
    }

    const changelogIdByRecId = buildChangelogIdByRecId(
      persisted.changelogEntries,
    );

    // #149 (2026-06-11): per-tenant city vocabulary for geo tags in row
    // titles. Soft-fail to UNDEFINED (legacy default); a loaded-but-
    // empty list means "no geo vocabulary" and matches nothing.
    let knownCities: string[] | undefined;
    let knownServices: string[] | undefined;
    let brandName: string | undefined;
    try {
      const { getBusinessConfigForCurrentTenant } = await import(
        "@/lib/business-config"
      );
      const cfg = await getBusinessConfigForCurrentTenant();
      knownCities = cfg.locations;
      knownServices = cfg.services;
      brandName = cfg.name?.trim() || undefined;
    } catch {
      knownCities = undefined;
      knownServices = undefined;
      brandName = undefined;
    }

    const allRows = buildRecommendationActionRows({
      queue: persisted.queue,
      promptTextById,
      knownCities,
      knownServices,
      brandName,
    });
    const resolution = resolveRecommendationDetail(allRows, decodedId);

    // 2026-05-13 P0 follow-up — when `?debugResolver=1`, NEVER redirect.
    // The operator is trying to see what the detail route received and
    // why; a 307 to a sibling URL would obscure that. Render the
    // diagnostic panel above whatever the resolution would otherwise
    // render (the redirect target's brief, the exact brief, or the
    // not-found component).
    if (resolution.kind === "redirect" && !debugResolver) {
      trace.data("outcome", `redirect_${resolution.via}`);
      trace.data("queue_count", persisted.queue.length);
      redirect(
        `/recommendations/${encodeRecommendationRouteId(resolution.row.id)}`,
      );
    }

    if (resolution.kind === "miss") {
      trace.data("outcome", "not_found_unknown_id");
      if (debugResolver) {
        return (
          <>
            <DetailDebugPanel
              rawId={rawId}
              decodedId={decodedId}
              allRowsCount={allRows.length}
              firstFiveRowIds={allRows.slice(0, 5).map((r) => r.id)}
              resolution={{ kind: "miss", hint: resolution.hint }}
            />
            <RecommendationDetailNotFound hint={resolution.hint} />
          </>
        );
      }
      return <RecommendationDetailNotFound hint={resolution.hint} />;
    }

    trace.data("queue_count", persisted.queue.length);
    trace.measureSize("payload", { row: resolution.row, promptTextById });

    // Move Forecast (2026-06-11) — the dream's "forecast BEFORE you ship".
    // A base rate from THIS tenant's own causally-proven outcomes (Proof
    // Engine → reference-class self-forecast), keyed by the resolved edit's
    // action_type → taxonomy bucket. Best-effort + self-gating: returns null
    // (renders nothing) until the tenant has causal-grade history for this
    // kind of change. Deterministic; no paid API.
    const matchedEdit = resolution.row.sourceEditId
      ? (persisted.recommendedEdits.find(
          (e) => e.id === resolution.row.sourceEditId,
        ) ?? null)
      : null;
    let moveForecast: CausalSelfForecast | null = null;
    if (matchedEdit) {
      try {
        const { loadForecastForRecommendedEdit } = await import(
          "@/domains/attribution/forecast-for-recommended-edit"
        );
        moveForecast = await trace.time("loadMoveForecast", () =>
          loadForecastForRecommendedEdit({
            action_type: matchedEdit.action_type,
            target_url: matchedEdit.target_url,
          }),
        );
      } catch {
        moveForecast = null;
      }
    }

    // Before → after backfill (2026-06-15). When the resolved edit carries
    // no stored current_text (generated before a scan captured the page),
    // pull the live field value from the latest page snapshot for its
    // target URL so the Suggested Copy act can show a real before → after.
    // One tenant-scoped indexed read; DETAIL-ONLY (never the list); fully
    // fail-soft (any error leaves the row proposed-only).
    let detailRow = resolution.row;
    try {
      const targetUrl = resolution.row.targetUrl;
      const existing = resolution.row.detail.currentText;
      if (targetUrl && (existing == null || existing.trim() === "")) {
        const { data } = await trace.time("backfillBeforeSnapshot", () =>
          getSupabaseAdmin()
            .from("page_snapshots")
            .select("title, meta_description, h1, fetched_at")
            .eq("tenant_id", tenantId)
            .eq("url", targetUrl)
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        const before = pickBackfilledCurrentText({
          actionType: resolution.row.actionType,
          existingCurrentText: existing,
          proposedText: resolution.row.detail.proposedText,
          snapshot: (data as {
            title?: string | null;
            meta_description?: string | null;
            h1?: string | null;
          } | null) ?? null,
        });
        if (before != null) {
          detailRow = {
            ...resolution.row,
            detail: { ...resolution.row.detail, currentText: before },
          };
        }
      }
    } catch {
      // fail-soft: leave detailRow = resolution.row (proposed-only).
    }

    // Page Surgeon bridge (operator-only, READ-ONLY). Surfaces the evidence-based
    // Page Surgeon plan for this rec's target page ALONGSIDE the legacy rec — it
    // never replaces the rec, publishes, or regenerates the queue. Customer view
    // (operator mode off) is byte-identical to before.
    let pageSurgeon: PageSurgeonForUrl | null = null;
    const psTarget = detailRow.targetUrl;
    if (isOperatorModeServer() && psTarget && psTarget !== "needs_new_page") {
      try {
        pageSurgeon = await trace.time("loadPageSurgeon", () =>
          loadPageSurgeonForUrl(tenantId, psTarget, { history: true }),
        );
      } catch {
        pageSurgeon = null;
      }
    }

    if (debugResolver) {
      return (
        <>
          <DetailDebugPanel
            rawId={rawId}
            decodedId={decodedId}
            allRowsCount={allRows.length}
            firstFiveRowIds={allRows.slice(0, 5).map((r) => r.id)}
            resolution={
              resolution.kind === "redirect"
                ? {
                    kind: "redirect",
                    via: resolution.via,
                    targetRowId: resolution.row.id,
                  }
                : { kind: "exact", matchedRowId: resolution.row.id }
            }
          />
          <MoveForecastBanner forecast={moveForecast} />
          <RecommendationDetailClient
            row={detailRow}
            changelogId={
              changelogIdByRecId[resolution.row.sourceRecommendationId] ?? null
            }
            promptTextById={promptTextById}
            competitorNames={competitorNames}
            canPublish={canPublish}
            pageSurgeon={pageSurgeon}
          />
        </>
      );
    }

    return (
      <>
        <MoveForecastBanner forecast={moveForecast} />
        <RecommendationDetailClient
          row={detailRow}
          changelogId={
            changelogIdByRecId[resolution.row.sourceRecommendationId] ?? null
          }
          promptTextById={promptTextById}
          canPublish={canPublish}
          pageSurgeon={pageSurgeon}
        />
      </>
    );
  } finally {
    trace.flush();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Move Forecast banner — "before you ship, here's your own track record"
// ─────────────────────────────────────────────────────────────────────

/**
 * Renders the causal self-forecast (reference-class base rate from this
 * tenant's own proven outcomes) above the recommendation brief. Self-
 * gating: renders NOTHING when there's no causal-grade history to speak
 * from. The copy is explicitly a base rate over the tenant's history —
 * NOT a causal promise about this specific edit (that distinction is the
 * Proof Engine's job, after the edit ships).
 */
function MoveForecastBanner({
  forecast,
}: {
  forecast: CausalSelfForecast | null;
}) {
  if (!forecast) return null;
  const tone = forecast.seeded
    ? "border-status-warning/30 bg-status-warning/[0.05]"
    : forecast.helpingRate >= 0.6
      ? "border-status-success/30 bg-status-success/[0.05]"
      : "border-border bg-surface-inset/40";
  return (
    <section
      className={`mb-5 rounded-lg border px-5 py-4 ${tone}`}
      data-move-forecast="true"
      aria-label="Move forecast — your track record on changes like this"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-primary">
          Before you ship — your track record
        </span>
        {forecast.seeded && (
          <span className="rounded-sm border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-status-warning">
            early signal
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-foreground">
        {forecast.line}
      </p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        A base rate from your own history ({forecast.sampleSize} past change
        {forecast.sampleSize !== 1 ? "s" : ""} like this that Beacon could
        measure causally) — not a promise about this specific edit.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detail-route debug panel — operator-only, query-param-gated
// ─────────────────────────────────────────────────────────────────────

type DetailDebugResolution =
  | { kind: "exact"; matchedRowId: string }
  | { kind: "redirect"; via: "edit_id" | "rec_stable_key"; targetRowId: string }
  | {
      kind: "miss";
      hint: {
        stableKey: string | null;
        editId: string | null;
        actionType: string | null;
      };
    }
  | { kind: "decode_failed" };

function DetailDebugPanel({
  rawId,
  decodedId,
  decodeFailed,
  allRowsCount,
  firstFiveRowIds,
  resolution,
}: {
  rawId: string;
  decodedId: string | null;
  decodeFailed?: boolean;
  allRowsCount: number;
  firstFiveRowIds: string[];
  resolution: DetailDebugResolution;
}) {
  // A raw id "appears already-decoded" when it doesn't contain any
  // percent-encoded triplet. Next 13+ always single-decodes path
  // segments before handing them to the page, so the expected state
  // is `appearsEncoded === false`. If the operator sees `true` here,
  // something is double-encoding upstream (rare).
  const appearsEncoded = /%[0-9a-f]{2}/i.test(rawId);

  const verdictTone =
    resolution.kind === "exact"
      ? "border-status-success/40 bg-status-success/[0.04]"
      : resolution.kind === "redirect"
        ? "border-status-warning/40 bg-status-warning/[0.06]"
        : "border-status-danger/40 bg-status-danger/[0.06]";

  return (
    <section
      className={`mb-6 rounded-lg border-2 px-5 py-4 ${verdictTone}`}
      data-recommendations-detail-debug="true"
    >
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold text-foreground">
          Detail-route resolver diagnostic (?debugResolver=1)
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
          Shows exactly what `/recommendations/[id]` received from
          Next.js, what the resolver did with it, and what set of rows
          it searched against. Read-only.
        </p>
      </header>

      <dl
        className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px] font-mono"
        data-recommendations-detail-debug-fields="true"
      >
        <DebugRow label="resolution.kind" value={resolution.kind} />
        {resolution.kind === "exact" && (
          <DebugRow
            label="matched row.id"
            value={resolution.matchedRowId}
            wrap
          />
        )}
        {resolution.kind === "redirect" && (
          <>
            <DebugRow label="redirect via" value={resolution.via} />
            <DebugRow
              label="target row.id (would 307 here)"
              value={resolution.targetRowId}
              wrap
            />
          </>
        )}
        {resolution.kind === "miss" && (
          <>
            <DebugRow
              label="hint.stableKey"
              value={resolution.hint.stableKey ?? "(null)"}
              wrap
            />
            <DebugRow
              label="hint.editId"
              value={resolution.hint.editId ?? "(null)"}
              wrap
            />
            <DebugRow
              label="hint.actionType"
              value={resolution.hint.actionType ?? "(null)"}
            />
          </>
        )}
        <DebugRow label="params.id (raw)" value={rawId} wrap />
        <DebugRow
          label="decoded id"
          value={decodedId ?? "(null)"}
          wrap
        />
        <DebugRow
          label="raw param appears encoded?"
          value={appearsEncoded ? "YES (double-encoded?)" : "no"}
        />
        <DebugRow
          label="decode helper returned null"
          value={decodeFailed ? "YES" : "no"}
        />
        <DebugRow label="allRows.length" value={String(allRowsCount)} />
      </dl>

      <details className="mt-3">
        <summary className="text-[11px] text-muted-foreground cursor-pointer">
          First {Math.min(5, firstFiveRowIds.length)} row.id(s) in this
          render
        </summary>
        <ul className="mt-2 space-y-1 text-[11px] font-mono text-muted-foreground/90">
          {firstFiveRowIds.length === 0 && (
            <li className="italic">(no rows in this render)</li>
          )}
          {firstFiveRowIds.map((id, i) => (
            <li key={i} className="break-all">
              {i + 1}. {id}
            </li>
          ))}
        </ul>
      </details>

      {resolution.kind === "miss" && (
        <p className="mt-3 text-[11px] text-status-danger leading-relaxed">
          If `params.id` matches one of the first row.ids above
          character-for-character but the resolver still returned
          `miss`, the bug is in the resolver. If it does NOT match,
          the row that issued this URL is not in the current snapshot
          (genuine stale URL OR cache divergence — re-run the list
          panel at `/recommendations?v2=1&debugResolver=1`).
        </p>
      )}
    </section>
  );
}

function DebugRow({
  label,
  value,
  wrap,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={wrap ? "break-all text-foreground/90" : "text-foreground/90"}>
        {value}
      </dd>
    </>
  );
}
