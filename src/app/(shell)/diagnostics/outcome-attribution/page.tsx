import "server-only";

/**
 * 2026-05-19 — Slice 9.A2α.3 + 9.A2γ — operator-only outcome
 * attribution diagnostic.
 *
 * Read-only page that surfaces Mode A attribution per tenant's
 * verified-live `recommended_edits` against the cached
 * `ga4_url_traffic` rows. Operator triage only — customer surfaces
 * (Slice 9.A2β) consume the same `computeModeATrafficAttribution`
 * pure function via a separate render path on `/changes/[id]?v2=1`.
 *
 * Operator-only. Gated by `isOperatorModeServer()`; `notFound()` for
 * every other caller. `NODE_ENV === "test"` extension preserves
 * render-under-test (same convention as `/diagnostics/lifecycle-
 * eligibility`).
 *
 * 9.A2γ extension (2026-05-19):
 *   Adds an operator-only "Refresh GA4 traffic" form that posts to
 *   the `refreshTenantGa4Traffic` server action. The action is the
 *   ONLY entry point that triggers a GA4 Data API HTTP call; page
 *   render still reads only cached rows. After a successful click,
 *   `revalidatePath` re-renders this page with updated counters.
 *
 *   The page also surfaces a calm "Last refresh" line derived from
 *   `MAX(last_synced_at)` over the cached rows. Operator-side
 *   freshness signal — no customer copy.
 *
 * Read-only render contract:
 *   - No Supabase writes on render (reads `ga4_url_traffic` +
 *     `recommended_edits` via the repository pattern + Supabase
 *     admin client).
 *   - No GA4 API call on page load — only reads pre-cached rows.
 *     The architecture invariant `ga4-no-page-load-call` enforces
 *     this; this file does NOT import from `@/lib/connectors/ga4/*`
 *     directly. Refresh button posts to the action; the action
 *     (separate file, "use server") is the only Data API caller.
 *   - The Mode A read model (`mode-a-cited-here-traffic-here.ts`)
 *     is a pure compute over cached rows.
 *   - No LLM, no paid APIs, no customer-vocab leaks.
 *
 * Fail-soft contract for the Supabase read:
 *   - 42P01 (undefined_table) → empty rows array; banner-style
 *     fail-soft state on the page (no crash). Covers the sequencing
 *     window where code lands before the migration applies.
 *   - Supabase admin init failure (env vars unset in dev) → empty
 *     rows; same fail-soft state.
 *   - Any other read error → empty rows; same fail-soft state.
 *   - This page never throws on a degraded read.
 *
 * Operator-vocab — the diagnostic table renders operator-side
 * terminology ("Mode A", "still_learning_outcome", "ineligible
 * reason"). Customer-locked K5 forbidden vocab (`drove` / `caused`
 * / `revenue` / `dollars` / `$` / `generated`) is NEVER used here —
 * defense in depth even though the page is operator-only.
 *
 * Pinned by:
 *   • `tests/app/diagnostics/outcome-attribution-page.test.tsx`
 *     (operator gate + render variants + Supabase fail-soft +
 *      vocab safety + data-attribute presence + no-Data-API-import
 *      check + refresh form presence)
 *   • `tests/architecture/outcome-attribution-refresh-operator-only.test.ts`
 *   • `tests/architecture/outcome-attribution-refresh-no-customer-surface.test.ts`
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import {
  computeModeATrafficAttribution,
  type ModeAResult,
} from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";
import type { Ga4UrlTrafficRow } from "@/lib/connectors/ga4/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { refreshTenantGa4TrafficFromForm } from "@/app/(shell)/diagnostics/outcome-attribution/actions";

export const dynamic = "force-dynamic";

const TABLE = "ga4_url_traffic";

function isAccessAllowed(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

type TrafficLoadStatus = "ok" | "table_missing" | "read_error" | "admin_unavailable";

type TrafficLoadResult = {
  rows: Ga4UrlTrafficRow[];
  status: TrafficLoadStatus;
  /** 9.A2γ — operator-side freshness label derived from
   *  MAX(last_synced_at) over the cached rows. Null when the table
   *  is empty / unreachable. */
  last_synced_at_max: string | null;
};

/**
 * Read `ga4_url_traffic` rows for the tenant from Supabase. Returns
 * a discriminated result with `status` so the renderer can show a
 * specific operator-side fail-soft banner. Never throws.
 *
 *   • ok               — rows loaded (may be empty if no data yet)
 *   • table_missing    — PostgREST 42P01 (sequencing model A)
 *   • read_error       — any other Supabase error
 *   • admin_unavailable — Supabase env vars unset (dev)
 *
 * 9.A2γ — also returns `last_synced_at_max` for the operator-side
 * freshness label rendered next to the Refresh button.
 */
async function loadGa4TrafficRows(tenantId: string): Promise<TrafficLoadResult> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { rows: [], status: "admin_unavailable", last_synced_at_max: null };
  }
  const { data, error } = await admin
    .from(TABLE)
    .select("url, date, sessions, engaged_sessions, conversions, last_synced_at")
    .eq("tenant_id", tenantId);
  if (error != null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code === "42P01") {
      return { rows: [], status: "table_missing", last_synced_at_max: null };
    }
    return { rows: [], status: "read_error", last_synced_at_max: null };
  }
  if (!Array.isArray(data)) {
    return { rows: [], status: "ok", last_synced_at_max: null };
  }
  const out: Ga4UrlTrafficRow[] = [];
  let lastSyncedMax: string | null = null;
  for (const row of data) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : null;
    const date = typeof r.date === "string" ? r.date : null;
    if (url == null || date == null) continue;
    out.push({
      url,
      date,
      sessions: typeof r.sessions === "number" ? r.sessions : 0,
      engaged_sessions:
        typeof r.engaged_sessions === "number" ? r.engaged_sessions : 0,
      conversions: typeof r.conversions === "number" ? r.conversions : 0,
    });
    const ls = typeof r.last_synced_at === "string" ? r.last_synced_at : null;
    if (ls != null && (lastSyncedMax == null || ls > lastSyncedMax)) {
      lastSyncedMax = ls;
    }
  }
  return { rows: out, status: "ok", last_synced_at_max: lastSyncedMax };
}

/**
 * Filter to verified-live edits only — Mode A only applies to rows
 * the operator has shipped + match-engine has detected as live.
 * `partially_implemented` is included for diagnostic completeness;
 * `wrong_page` is excluded (target_url mismatch upstream).
 */
function isVerifiedLive(edit: RecommendedEditRow): boolean {
  return (
    edit.implementation_status === "verified_live" ||
    edit.implementation_status === "verified_live_modified" ||
    edit.implementation_status === "partially_implemented"
  );
}

/**
 * Pluck the discriminator `reason` from a non-eligible `ModeAResult`
 * for the `data-row-mode-a-reason` data attribute. Eligible rows
 * have no reason discriminator; the attribute is empty.
 */
function modeAReason(result: ModeAResult): string {
  if (result.kind === "eligible") return "";
  return result.reason;
}

/**
 * Operator-side fail-soft copy when `ga4_url_traffic` read fails or
 * the table doesn't exist yet. Operator-vocab; no customer claims.
 */
function trafficStatusBanner(status: TrafficLoadStatus): string | null {
  switch (status) {
    case "ok":
      return null;
    case "table_missing":
      return "ga4_url_traffic table not found yet (PostgREST 42P01). Migration may not have applied in this environment.";
    case "read_error":
      return "ga4_url_traffic read failed. Check Supabase admin connectivity or RLS policy.";
    case "admin_unavailable":
      return "Supabase admin client unavailable in this environment. Set SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL.";
  }
}

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function OutcomeAttributionDiagnosticPage(props: PageProps) {
  if (!isAccessAllowed()) {
    notFound();
  }

  await (props.searchParams ?? Promise.resolve({}));

  const tenantId = await currentTenantId();
  const now = new Date();

  const repo = getRepository().forTenant(tenantId);
  const [edits, trafficResult] = await Promise.all([
    repo.getRecommendedEdits(),
    loadGa4TrafficRows(tenantId),
  ]);

  const verifiedLiveEdits = edits.filter(isVerifiedLive);

  type PerEditResult = {
    edit: RecommendedEditRow;
    result: ModeAResult;
  };
  const perEdit: PerEditResult[] = verifiedLiveEdits.map((edit) => ({
    edit,
    result: computeModeATrafficAttribution({
      recommendedEdit: edit,
      ga4UrlTrafficRows: trafficResult.rows,
      qualifiedCallCount: 0,
      now,
    }),
  }));

  const counters = {
    total_verified_live: verifiedLiveEdits.length,
    eligible: perEdit.filter((p) => p.result.kind === "eligible").length,
    still_learning_outcome: perEdit.filter(
      (p) => p.result.kind === "still_learning_outcome",
    ).length,
    ineligible: perEdit.filter((p) => p.result.kind === "ineligible").length,
    total_cached_traffic_rows: trafficResult.rows.length,
  };

  const banner = trafficStatusBanner(trafficResult.status);

  return (
    <div className="space-y-4 p-4" data-diagnostic="outcome-attribution">
      <header className="space-y-1">
        <h1 className="text-[15px] font-semibold text-foreground">
          Outcome Attribution Diagnostic (Mode A)
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Operator-only. Reads cached GA4 traffic rows + verified-live
          recommended edits and computes Mode A attribution per the K4
          sample-size guard (≥ 7 days post-live AND ≥ 5 sessions OR
          ≥ 1 qualified call). CallRail-deferred per K2; qualified
          call count is 0 in this slice.
        </p>
      </header>

      {banner ? (
        <section
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
          data-diagnostic-section="traffic-banner"
          data-traffic-status={trafficResult.status}
        >
          <p className="text-[12px] text-foreground">{banner}</p>
        </section>
      ) : null}

      <section
        className="rounded-md border border-border/40 bg-surface-inset/10 p-3"
        data-diagnostic-section="refresh"
      >
        <form action={refreshTenantGa4TrafficFromForm}>
          <button
            type="submit"
            className="rounded border border-border/60 bg-surface px-3 py-1 text-[12px] font-medium text-foreground hover:bg-surface-inset/40"
            data-action="refresh-ga4-traffic"
          >
            Refresh GA4 traffic
          </button>
        </form>
        <p
          className="mt-2 text-[11px] text-muted-foreground"
          data-refresh-last-synced-at={trafficResult.last_synced_at_max ?? ""}
        >
          Last refresh:{" "}
          <span className="font-mono">
            {trafficResult.last_synced_at_max ?? "—"}
          </span>
          {" • "}
          <span className="font-mono">
            {trafficResult.rows.length}
          </span>{" "}
          cached row{trafficResult.rows.length === 1 ? "" : "s"}.
          Click the button to fetch fresh rows via the GA4 Data API.
        </p>
      </section>

      <section
        className="rounded-md border border-border/40 bg-surface-inset/20 p-3"
        data-diagnostic-section="counters"
      >
        <ul className="text-[12px] text-foreground space-y-1">
          <li data-counter="total_verified_live">
            Verified-live edits: <span className="font-mono">{counters.total_verified_live}</span>
          </li>
          <li data-counter="eligible">
            Mode A eligible: <span className="font-mono">{counters.eligible}</span>
          </li>
          <li data-counter="still_learning_outcome">
            Still-learning outcome: <span className="font-mono">{counters.still_learning_outcome}</span>
          </li>
          <li data-counter="ineligible">
            Ineligible: <span className="font-mono">{counters.ineligible}</span>
          </li>
          <li data-counter="total_cached_traffic_rows">
            Cached GA4 traffic rows: <span className="font-mono">{counters.total_cached_traffic_rows}</span>
          </li>
        </ul>
      </section>

      {perEdit.length === 0 ? (
        <p
          className="text-[12px] text-muted-foreground"
          data-diagnostic-section="empty"
        >
          No verified-live edits for this tenant. Mode A has nothing
          to attribute yet.
        </p>
      ) : (
        <section
          className="rounded-md border border-border/40"
          data-diagnostic-section="per-edit-table"
          data-diagnostics-row-count={perEdit.length}
        >
          <table className="w-full text-[12px] text-foreground">
            <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Edit id</th>
                <th className="px-3 py-2 font-medium">Target URL</th>
                <th className="px-3 py-2 font-medium">Live at</th>
                <th className="px-3 py-2 font-medium">Sample window</th>
                <th className="px-3 py-2 font-medium">Days</th>
                <th className="px-3 py-2 font-medium">Sessions</th>
                <th className="px-3 py-2 font-medium">Engaged</th>
                <th className="px-3 py-2 font-medium">Conversions</th>
                <th className="px-3 py-2 font-medium">Mode A kind</th>
                <th className="px-3 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {perEdit.map(({ edit, result }) => {
                const kind = result.kind;
                const reason = modeAReason(result);
                const sampleWindow =
                  kind === "eligible" || kind === "still_learning_outcome"
                    ? `${result.sample_window_start} → ${result.sample_window_end}`
                    : "—";
                const days =
                  kind === "eligible" || kind === "still_learning_outcome"
                    ? String(result.days_since_live)
                    : "—";
                const sessions =
                  kind === "eligible" || kind === "still_learning_outcome"
                    ? String(result.post_live_sessions)
                    : "—";
                const engaged =
                  kind === "eligible"
                    ? String(result.post_live_engaged_sessions)
                    : "—";
                const conversions =
                  kind === "eligible"
                    ? String(result.post_live_conversions)
                    : "—";
                return (
                  <tr
                    key={edit.id}
                    className="border-b border-border/20"
                    data-row-edit-id={edit.id}
                    data-row-mode-a-kind={kind}
                    data-row-mode-a-reason={reason}
                  >
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {edit.id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {edit.target_url}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {edit.live_at ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {sampleWindow}
                    </td>
                    <td className="px-3 py-2 font-mono">{days}</td>
                    <td className="px-3 py-2 font-mono">{sessions}</td>
                    <td className="px-3 py-2 font-mono">{engaged}</td>
                    <td className="px-3 py-2 font-mono">{conversions}</td>
                    <td className="px-3 py-2 font-mono">{kind}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
