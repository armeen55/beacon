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
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { getChangelogEntries as _getChangelogEntriesUnused } from "@/lib/seed-data.server";
import { buildChangelogIdByRecId } from "@/domains/recommendations/changelog-link";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";

import {
  decodeRecommendationRouteId,
  encodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import { redirect } from "next/navigation";
import { RecommendationDetailClient } from "./recommendation-detail-client";
import { RecommendationDetailNotFound } from "./recommendation-detail-not-found";
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
    const persisted = await trace.time(
      "loadPersistedRecommendationQueueForPage",
      () => loadPersistedRecommendationQueueForPage({ tenantId }),
    );

    const promptTextById: Record<string, string> = {};
    for (const p of persisted.trackedPrompts) {
      promptTextById[p.id] = p.text;
    }

    const changelogIdByRecId = buildChangelogIdByRecId(
      persisted.changelogEntries,
    );

    const allRows = buildRecommendationActionRows({
      queue: persisted.queue,
      promptTextById,
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
          <RecommendationDetailClient
            row={resolution.row}
            changelogId={
              changelogIdByRecId[resolution.row.sourceRecommendationId] ?? null
            }
            promptTextById={promptTextById}
          />
        </>
      );
    }

    return (
      <RecommendationDetailClient
        row={resolution.row}
        changelogId={
          changelogIdByRecId[resolution.row.sourceRecommendationId] ?? null
        }
        promptTextById={promptTextById}
      />
    );
  } finally {
    trace.flush();
  }
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
