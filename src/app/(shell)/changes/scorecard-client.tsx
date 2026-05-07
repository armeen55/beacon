"use client";

import { useEffect, useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 2026-05-06 demo-path Phase 3-bis fix 4 — DOM data-attribute gating.
 *
 * Pre-fix: `data-attribution-branch={copy.branch}` rendered raw enum
 * values like `verified_live_too_early` / `verdict_off` /
 * `seed_prior` directly into customer-visible HTML, inspectable via
 * View Source / DevTools. `data-stale-pending-state={lifecycleStatus}`
 * leaked `accepted` / `recommended` enum values the same way.
 *
 * Gate: customer mode strips these data attrs entirely. Operator mode
 * (NEXT_PUBLIC_OPERATOR_MODE) and tests (NODE_ENV=test) preserve the
 * attrs so existing snapshots + dev-tools workflows keep working.
 *
 * Same gate-shape as the recommendations drawer Debug-block fix
 * (commit 57b509c).
 */
const OPERATOR_MODE_DEBUG: boolean =
  process.env.NEXT_PUBLIC_OPERATOR_MODE === "true" ||
  process.env.NODE_ENV === "test";
import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { UrlVerdict } from "@/domains/attribution/url-verdict";
import { markChangelogEditShipped } from "./actions";
// Note: UrlVerdict type is retained on EnrichedChangeRow because the internal
// row-expand panel ("Explain this verdict") still renders the legacy Z-score
// math. The primary drilldown at /changes/[id] is the source of truth for
// attribution status.
import { AttributionStatusPill } from "./attribution-status-pill";
import {
  DEFAULT_LIFECYCLE_TAB,
  LIFECYCLE_TAB_LABEL,
  LIFECYCLE_TAB_ORDER,
  type LifecycleTab,
  type LifecycleTabClass,
} from "@/domains/attribution/lifecycle-classification";
import { LifecycleStatusPill } from "@/components/display/lifecycle-status-pill";
import type { ImplementationStatus } from "@/domains/recommendations/recommended-edits-persistence";
import {
  resolveAttributionCopy,
  type AttributionCopyTone,
} from "@/domains/attribution/lifecycle-attribution-copy";
import { LIFECYCLE_PENDING_SOURCE_SYSTEM } from "@/domains/attribution/synthesize-pending-changelog";
import { WhyThisVerdict } from "@/components/changes/why-this-verdict";
import { buildVerdictProvenance } from "@/domains/attribution/verdict-provenance";

/**
 * A single row on the /changes page.
 * - `scorecard` = the legacy per-change row with topic event attributions
 *   (kept for drill-down context only; NOT used for the verdict).
 * - `urlVerdict` = the URL-level Z-score verdict (the new primary signal).
 *   null when the change has no URL (site-wide).
 * - `seriesPreview` = trimmed dense daily series around the change date for
 *   optional sparkline rendering in the expand panel.
 * - `hasUrl` = convenience; `false` means site-wide / untracked.
 * - `readyOn` = dynamic "Ready on [date]" prediction from the URL pattern
 *   brain, attached only when the verdict is `too_early`. Tells the
 *   operator when to check back for a landed verdict.
 */
export type EnrichedChangeRow = {
  scorecard: ScorecardRowWithImpact;
  urlVerdict: UrlVerdict | null;
  seriesPreview: Array<{ date: string; count: number }> | null;
  hasUrl: boolean;
  readyOn?: ReadyOnPrediction | null;
};

/**
 * G5 — "Ready on [date]" block shown on too-early rows. Sourced from the
 * URL pattern brain (`url-change-patterns.json`) when a matching bucket
 * exists, else a transparent fallback.
 */
export type ReadyOnPrediction = {
  /** ISO date string for when first verdict read-out is expected. */
  readyDate: string;
  /** Days from the change timestamp until readyDate. */
  daysFromChange: number;
  /** Bucket we derived from, or null when falling back. */
  patternId: string | null;
  /** Helping-count in bucket. 0 = fallback triggered. */
  helpingCount: number;
  /** Total sample count in the bucket. */
  sampleCount: number;
  /** Confidence tier of the bucket (null when fallback). */
  confidenceTier: "high" | "medium" | "low" | null;
  /** Plain-English sentence ready for render. */
  narrative: string;
};

const PLATFORM_SHORT: Record<string, string> = {
  chatgpt: "GPT",
  google_aio: "AIO",
  perplexity: "Pplx",
};

/**
 * Phase 6A.8 — parse + validate the `?tab=` query string. Defaults to
 * `live_verified` (DEFAULT_LIFECYCLE_TAB) when missing/unknown so the
 * deep-link contract degrades safely.
 */
function parseTabParam(raw: string | null | undefined): LifecycleTab {
  if (!raw) return DEFAULT_LIFECYCLE_TAB;
  if ((LIFECYCLE_TAB_ORDER as readonly string[]).includes(raw)) {
    return raw as LifecycleTab;
  }
  return DEFAULT_LIFECYCLE_TAB;
}

/**
 * Phase 6A.6 — map AttributionCopyTone to Tailwind palette classes.
 * Kept tight here (no new component) because the resolver already
 * owns the label/tooltip/tone decisions; this is just rendering glue.
 */
function attributionToneClass(tone: AttributionCopyTone): string {
  switch (tone) {
    case "success":
      return "border-status-success/40 bg-status-success/[0.08] text-status-success";
    case "warning":
      return "border-status-warning/40 bg-status-warning/[0.08] text-status-warning";
    case "accent":
      return "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary";
    case "info":
      return "border-border/60 bg-surface-inset/40 text-foreground/80";
    case "muted":
    default:
      return "border-border/60 bg-surface-inset/60 text-muted-foreground";
  }
}

/**
 * Phase 6A.2 (2026-04-28) — empty-state copy per lifecycle tab.
 * Honest about WHY the tab is empty so operators don't see a generic
 * "no rows" message and assume the system is broken.
 */
const EMPTY_TAB_COPY: Record<LifecycleTab, string> = {
  live_verified:
    "No verified-live rows yet. Once Beacon recommends an edit, you accept it, and the next scan finds it on the page, the row will land here with a Live ✓ marker.",
  pending_implementation:
    "Nothing waiting on you. Accepted edits live here until the scan confirms them on the page.",
  needs_review:
    "No edits need triage. The scan returns this status when a match is ambiguous (partial match, wrong page, or multiple candidates).",
  imported_legacy:
    "Imported historical changes appear here. Most accounts have nothing in this tab.",
  scan_confirmed:
    "No scan-detected rows yet. When a daily scan finds a change on your site, it lands here with the original detection date.",
  unclassified:
    "No other rows. Dismissed edits and miscellaneous entries land here.",
  all: "No changes yet. Beacon logs every accepted recommendation here once the next scan confirms it on your site. Accept your first recommendation in /recommendations to get started →",
};

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportRowsAsCSV(rows: EnrichedChangeRow[], tab: LifecycleTab): void {
  const headers = [
    "Date",
    "Page",
    "URL",
    "Description",
    "Signal Type",
    "Topic",
    "City",
    "AI Mentions Linked",
    "Verdict",
  ];

  const dataRows = rows.map((row) => {
    const change = row.scorecard.change;
    const date = change.timestamp ? change.timestamp.slice(0, 10) : "";
    return [
      csvEscape(date),
      csvEscape(change.asset_name),
      csvEscape(change.url),
      csvEscape(change.change_description),
      csvEscape(change.signal_type),
      csvEscape(change.topic_targeted),
      csvEscape(change.city_targeted),
      csvEscape(row.scorecard.totalEventsLinked),
      csvEscape(row.scorecard.verdictSummary),
    ].join(",");
  });

  const csv = [headers.join(","), ...dataRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `beacon-changes-${tab}-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ScorecardTable({
  rows,
  allTopics: _allTopics,
  allPlatforms: _allPlatforms,
  coverageState,
  outcomesById,
  classByChangelogId,
  tabCounts,
  editStatusByChangelogId,
  editLiveAtByChangelogId,
  editNeedsRewriteByChangelogId,
  verdictFlagEnabled = false,
}: {
  rows: EnrichedChangeRow[];
  /** Reserved for future per-topic filter in drill-down. */
  allTopics?: string[];
  /** Reserved for future per-platform filter in drill-down. */
  allPlatforms?: string[];
  coverageState?: import("@/lib/coverage-state").CoverageState;
  /**
   * Phase 2C — stored attribution outcomes keyed by change_id. When present,
   * each row renders the attribution status pill (computed / weak_estimate /
   * no_controls / unsupported_scope / ...) inside the row.
   */
  outcomesById?: Record<string, import("@/domains/attribution/change-outcome-store").StoredChangeOutcome>;
  /**
   * Phase 6A.2 (2026-04-28) — per-row lifecycle classification keyed by
   * `change.id`. Drives the lifecycle tabs that replace the legacy
   * Z-score-status filter chips. Computed by the server-side classifier
   * in `src/domains/attribution/lifecycle-classification.ts`.
   */
  classByChangelogId?: Record<string, LifecycleTabClass>;
  /** Per-tab counts (including the synthetic `all` total). */
  tabCounts?: Record<LifecycleTab, number>;
  /**
   * Phase 6A.3 (2026-04-28) — granular per-edit `implementation_status`
   * keyed by `change.id`, when the changelog row is joined to a
   * `recommended_edits` row. Wins over the classifier class for the
   * lifecycle pill so verified_live_modified / partially_implemented /
   * etc. surface their distinct labels.
   */
  editStatusByChangelogId?: Record<string, ImplementationStatus>;
  /**
   * Phase 6A.6 (2026-04-28) — per-row linked edit `live_at` (ISO string)
   * for the bake-window decision. Drives the "Too early — verdict
   * pending" vs "Verdict tracking off" branches of the attribution-copy
   * resolver.
   */
  editLiveAtByChangelogId?: Record<string, string>;
  /**
   * Phase 6B.1 (2026-04-28) — flag rows whose linked edit's
   * `proposed_text` matches the generator placeholder pattern. The
   * scorecard surfaces a "needs rewrite" badge so the operator
   * sees the warning whether they're working from /today or /changes.
   */
  editNeedsRewriteByChangelogId?: Record<string, boolean>;
  /**
   * Phase 6A.6 (2026-04-28) — current `BEACON_LIFECYCLE_VERDICT_ENABLED`
   * value resolved server-side once per render. Per-row resolver checks
   * this to differentiate "Verdict tracking off" from "Verdict pending"
   * post-bake.
   */
  verdictFlagEnabled?: boolean;
}) {
  // Phase 6A.8 (2026-04-28) — tab deep-link support. Initialize from
  // ?tab=... query param when valid, otherwise the default. Sync state
  // changes back into the URL via router.replace so navigating from
  // Today's lifecycle-strip chip lands on the right tab AND the operator
  // can copy/share a /changes link with a specific tab open.
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = parseTabParam(searchParams.get("tab"));
  const [tab, setTab] = useState<LifecycleTab>(initialTab);

  // When the URL query string changes (e.g. operator clicks a Today
  // chip while already on /changes, Next.js routes to the same page
  // with a new ?tab=...), reflect it in local state.
  useEffect(() => {
    const fromUrl = parseTabParam(searchParams.get("tab"));
    if (fromUrl !== tab) setTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Push state→URL on user-driven tab changes. Use replace (not push)
  // so the operator's back button doesn't get cluttered with every
  // tab toggle. shallow=true would be ideal but Next.js App Router
  // doesn't expose it; replace() is close enough for this use case.
  const setTabAndUrl = (next: LifecycleTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_LIFECYCLE_TAB) {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(qs ? `/changes?${qs}` : "/changes", { scroll: false });
  };

  const lifecycleClassOf = (row: EnrichedChangeRow): LifecycleTabClass => {
    return classByChangelogId?.[row.scorecard.change.id] ?? "unclassified";
  };

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => lifecycleClassOf(r) === tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab, classByChangelogId]);

  const counts = useMemo<Record<LifecycleTab, number>>(() => {
    if (tabCounts) return tabCounts;
    // Fallback: derive from rows when the parent didn't pass counts. Keeps
    // the component usable in isolation (storybook / tests) but production
    // always passes pre-computed counts from the server-side classifier.
    const c: Record<LifecycleTab, number> = {
      all: rows.length,
      live_verified: 0,
      pending_implementation: 0,
      needs_review: 0,
      imported_legacy: 0,
      scan_confirmed: 0,
      unclassified: 0,
    };
    for (const r of rows) {
      const cls = lifecycleClassOf(r);
      c[cls] += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tabCounts, classByChangelogId]);

  return (
    <div>
      {/* Phase 6A.2 lifecycle tabs. Default = live_verified so operators
          land on lifecycle truth, not the 291-row legacy mix. */}
      <div className="flex items-center gap-1 mb-4 border-b border-border/40 pb-2 overflow-x-auto">
        {LIFECYCLE_TAB_ORDER
          // Hide a tab when it has zero rows, EXCEPT live_verified and
          // all — live_verified must always be visible (operator
          // expectation that lifecycle truth has a permanent home), and
          // all is the catch-all.
          .filter((key) => key === "live_verified" || key === "all" || counts[key] > 0)
          .map((key) => {
            const isActive = tab === key;
            const isEmphasized = key === "live_verified";
            return (
              <button
                key={key}
                onClick={() => setTabAndUrl(key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-foreground text-background"
                    : isEmphasized
                      ? "text-status-success hover:bg-status-success/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50"
                }`}
              >
                {LIFECYCLE_TAB_LABEL[key]}
                <span className="ml-1.5 text-[10px] opacity-60 tabular-nums">
                  {counts[key]}
                </span>
              </button>
            );
          })}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filtered.length}/{rows.length}
        </span>
        <button
          onClick={() => exportRowsAsCSV(filtered, tab)}
          className="ml-2 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      <div className="border border-border/70 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-inset text-[10px] text-muted-foreground">
              <th className="text-left px-2.5 py-1.5 font-medium w-[90px]">When</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Change</th>
              <th className="text-left px-2.5 py-1.5 font-medium w-[120px]">Status</th>
              <th className="text-left px-2.5 py-1.5 font-medium w-[80px] tabular-nums">
                Delta
              </th>
              <th className="w-[32px]" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <ChangeRow
                key={row.scorecard.change.id}
                row={row}
                outcome={outcomesById?.[row.scorecard.change.id]}
                lifecycleStatus={editStatusByChangelogId?.[row.scorecard.change.id]}
                lifecycleClass={classByChangelogId?.[row.scorecard.change.id]}
                editLiveAt={editLiveAtByChangelogId?.[row.scorecard.change.id]}
                editNeedsRewrite={editNeedsRewriteByChangelogId?.[row.scorecard.change.id]}
                verdictFlagEnabled={verdictFlagEnabled}
              />
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 px-6 text-[13px] text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          {EMPTY_TAB_COPY[tab]}
        </div>
      )}

      {coverageState === "stale" || coverageState === "critical" ? (
        <p className="mt-3 text-[10px] text-status-warning/70">
          Coverage state is {coverageState} — attribution may reflect stale
          data until the next import.
        </p>
      ) : null}
    </div>
  );
}

function ChangeRow({
  row,
  outcome,
  lifecycleStatus,
  lifecycleClass,
  editLiveAt,
  editNeedsRewrite,
  verdictFlagEnabled,
}: {
  row: EnrichedChangeRow;
  outcome?: import("@/domains/attribution/change-outcome-store").StoredChangeOutcome;
  /** Phase 6A.3 (2026-04-28) — granular per-edit lifecycle status. */
  lifecycleStatus?: ImplementationStatus;
  /** Phase 6A.3 (2026-04-28) — fallback class when no edit row joins. */
  lifecycleClass?: LifecycleTabClass;
  /** Phase 6A.6 (2026-04-28) — linked edit live_at for bake-window check. */
  editLiveAt?: string;
  /** Phase 6B.1 (2026-04-28) — true when proposed_text is a generator placeholder. */
  editNeedsRewrite?: boolean;
  /** Phase 6A.6 (2026-04-28) — verdict-flag state for "tracking off" copy. */
  verdictFlagEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [shipFeedback, setShipFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const ch = row.scorecard.change;
  const dateStr = new Date(ch.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // W2 Step 2.4 (2026-05-01) — operator-override eligibility + day-3 stale tint.
  // Eligible = linked edit is in `recommended` or `accepted` (pre-verified).
  // Stale-pending = pre-verified for ≥3 days (changelog timestamp is the
  // accept-at proxy because per-edit fan-out fires at accept time).
  const STALE_PENDING_DAYS = 3;
  // M4 (operator audit, 2026-05-05) — Mark Shipped is restricted to
  // `accepted` rows ONLY. Showing it on `recommended` rows conflates
  // Accept with Mark Shipped: a single click would silently skip the
  // Accept step and stamp the row `verified_live`, making the operator
  // unable to triage the queue properly. Acceptance happens on
  // /recommendations; /changes only confirms shipment for rows the
  // operator has already accepted. The "stale pending" tint still
  // fires on either status — the row IS pending in both cases — but
  // the button itself appears only when Mark Shipped is the
  // semantically-correct next action.
  const canMarkShipped = lifecycleStatus === "accepted";
  const isPendingForStaleness =
    lifecycleStatus === "recommended" || lifecycleStatus === "accepted";
  const ageDays = Math.floor(
    (Date.now() - new Date(ch.timestamp).getTime()) / 86_400_000,
  );
  const isStalePending = isPendingForStaleness && ageDays >= STALE_PENDING_DAYS;

  // D5 (operator audit, 2026-05-05) — disambiguate stale-pending tooltip
  // + pill copy by lifecycle state. Pre-D5 the row tooltip ALWAYS read
  // "Accepted N days ago — scan hasn't confirmed it on the page yet."
  // even when the row was in `recommended` (NOT YET accepted). That
  // conflated the two states and looked broken: yellow tint + Mark
  // Shipped hidden + tooltip implying acceptance had happened.
  //
  // Post-D5:
  //   • `accepted` stale rows keep the original "Accepted Nd ago" copy +
  //     show Mark Shipped (the operator can confirm shipment now).
  //   • `recommended` stale rows say "Pending Nd — accept first, then
  //     mark shipped after implementation" so the operator understands
  //     the next step (go to /recommendations to accept).
  //
  // The yellow tint stays on both — both states ARE genuinely pending
  // and the visual cue is correct. The clarity fix is in the COPY.
  const stalePillLabel =
    lifecycleStatus === "accepted"
      ? `${ageDays}d pending`
      : `${ageDays}d — accept first`;
  const staleTooltip =
    lifecycleStatus === "accepted"
      ? `Accepted ${ageDays} day${ageDays === 1 ? "" : "s"} ago — scan hasn't confirmed it on the page yet. Mark shipped to start the verdict clock now.`
      : `Pending for ${ageDays} day${ageDays === 1 ? "" : "s"}. Accept this recommendation first (open /recommendations), then mark shipped once it's live on the page.`;

  function handleMarkShipped(e: React.MouseEvent) {
    // The whole row is clickable to toggle expand — stop propagation so
    // pressing Mark shipped doesn't also open the panel.
    e.stopPropagation();
    setShipFeedback(null);
    startTransition(async () => {
      try {
        const res = await markChangelogEditShipped({ changelogId: ch.id });
        if (res.success) {
          const flipped = res.flipped ?? 0;
          setShipFeedback({
            message:
              flipped > 0
                ? "Marked live — verdict clock started."
                : "Already live — no change.",
            isError: false,
          });
        } else {
          setShipFeedback({
            message: res.error ?? "Failed to mark shipped.",
            isError: true,
          });
        }
      } catch (err) {
        setShipFeedback({
          message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        });
      }
    });
  }

  // Phase 2C: read delta from the new store when status === "computed"; for
  // weak_estimate / no_controls, show the RAW treated delta explicitly labeled
  // "raw" so it cannot be misread as adjusted/causal. For all other statuses
  // (insufficient / ineligible / unsupported / zero_signal): em-dash.
  const delta =
    outcome?.status === "computed" ? outcome.computed!.overall.relative_lift : null;
  const deltaAbs =
    outcome?.status === "computed"
      ? outcome.computed!.overall.adjusted_lift
      : outcome?.raw?.overall.treated_delta ?? null;
  const deltaIsRaw = outcome?.status !== "computed" && outcome?.raw !== null && outcome?.raw !== undefined;
  const deltaStr = (() => {
    if (delta == null) return "—";
    const pct = Math.round(delta * 100);
    return pct > 0 ? `+${pct}%` : `${pct}%`;
  })();
  // Intentionally NOT colored green/red — attribution is not a pass/fail judgment.
  // Computed results get accent-primary to signal "measured"; raw stays muted so it
  // cannot be misread as a causal signal.
  const deltaColor = delta == null ? "text-muted-foreground" : "text-accent-primary";

  return (
    <>
      <tr
        className={`border-b border-border hover:bg-surface-inset/50 transition-colors cursor-pointer ${
          open ? "bg-surface-inset/30" : ""
        } ${isStalePending ? "bg-status-warning/[0.04]" : ""}`}
        onClick={() => setOpen((v) => !v)}
        data-stale-pending={isStalePending ? "true" : undefined}
        // 2026-05-06 demo-path fix: data-stale-pending-state used to leak
        // raw `recommended`/`accepted` enum values into the DOM. Customer
        // mode now strips it; operator mode + tests keep it.
        {...(OPERATOR_MODE_DEBUG
          ? {
              "data-stale-pending-state": isStalePending
                ? lifecycleStatus ?? null
                : undefined,
            }
          : {})}
        title={isStalePending ? staleTooltip : undefined}
      >
        <td className="px-2.5 py-2 text-muted-foreground tabular-nums whitespace-nowrap align-top text-[11px]">
          <span>{dateStr}</span>
          {/* Phase 6A.3 (2026-04-28) — replaces the previous tiny
              source_system subtitle ("imported" / "scan · auto-caught")
              with the LifecycleStatusPill. The pill carries strictly
              more information: it includes lifecycle truth (Live ✓ /
              Pending / Needs review / etc.) AND falls back to the
              source class (Imported legacy / Scan-confirmed) so the
              previous subtitle's surface area is fully covered. */}
          {(lifecycleStatus || lifecycleClass) && (
            <div className="mt-1">
              <LifecycleStatusPill
                status={lifecycleStatus}
                cls={lifecycleClass}
                compact
              />
            </div>
          )}
          {isStalePending && (
            <div className="mt-1">
              <span
                className="inline-block text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 bg-status-warning/[0.08] text-status-warning"
                title={staleTooltip}
                data-stale-pill-state={lifecycleStatus ?? "unknown"}
              >
                {stalePillLabel}
              </span>
            </div>
          )}
          {/* W2 Step 2.4 (2026-05-01) — operator-override Mark shipped.
              Renders only when the linked edit is still pre-verified.
              Stops row-click propagation so pressing the button doesn't
              also toggle the expand panel. */}
          {canMarkShipped && (
            <div className="mt-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={handleMarkShipped}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary hover:bg-accent-primary/[0.12] transition-colors disabled:opacity-50"
                title="Confirm this change is live on your site. Beacon will start tracking its impact now instead of waiting for the next scan."
              >
                Mark shipped
              </button>
              {shipFeedback && (
                <p
                  className={`mt-1 text-[9px] ${
                    shipFeedback.isError ? "text-status-danger" : "text-status-success"
                  }`}
                >
                  {shipFeedback.message}
                </p>
              )}
            </div>
          )}
        </td>
        <td className="px-2.5 py-2 align-top max-w-[380px]">
          {/* Phase 6B.1 follow-up (2026-04-28) — synthetic pending rows
              don't have a real /changes/[id] detail page (they're built
              from recommended_edits at render time). Linking to
              /changes/[id] would 404. Route synthetic rows to
              /recommendations so the operator can decide on the edit
              there; real changelog rows continue to deep-link to the
              detail page. */}
          <Link
            href={
              ch.source_system === LIFECYCLE_PENDING_SOURCE_SYSTEM
                ? "/recommendations"
                : `/changes/${ch.id}`
            }
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent-primary transition-colors"
          >
            <div className="flex items-start gap-1.5 flex-wrap">
              <p className="font-medium text-[12px] leading-snug line-clamp-2 flex-1 min-w-0">
                {ch.asset_name}
              </p>
              {/* Phase 6B.1 (2026-04-28) — needs-rewrite badge on
                  /changes Pending rows. The /today queue + Do-Next card
                  already surface this; mirroring it here so an operator
                  working from /changes sees the same warning before
                  shipping a placeholder FAQ. */}
              {editNeedsRewrite && (
                <span
                  className="shrink-0 inline-flex items-center rounded border border-status-warning/40 bg-status-warning/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-status-warning"
                  title="The proposed text is a generator placeholder — rewrite it before shipping."
                  data-changes-needs-rewrite="true"
                >
                  needs rewrite
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
              {ch.change_description}
            </p>
            {ch.url ? (
              <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 truncate max-w-[340px]">
                {ch.url}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                Site-wide infra
              </p>
            )}
          </Link>
        </td>
        <td className="px-2.5 py-2 align-top whitespace-nowrap">
          {outcome ? (
            // Phase 6A.6 — verified-live rows still in bake window MUST
            // override a stale stored outcome (the outcome was computed
            // from pre-pivot Profound data; the live_at says recompute
            // is needed). Resolver returns the bake-window branch for
            // those, so we use it rather than the raw outcome label.
            (() => {
              const copy = resolveAttributionCopy({
                entry: ch,
                edit: lifecycleStatus
                  ? { implementation_status: lifecycleStatus, live_at: editLiveAt ?? null }
                  : null,
                cls: lifecycleClass ?? null,
                outcome,
                verdictFlagEnabled: verdictFlagEnabled ?? false,
              });
              if (
                copy.branch === "verified_live_too_early" ||
                copy.branch === "verified_live_verdict_off" ||
                copy.branch === "verified_live_baked"
              ) {
                return (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${attributionToneClass(copy.tone)}`}
                    title={copy.tooltip}
                  >
                    {copy.label}
                  </span>
                );
              }
              return (
                <AttributionStatusPill
                  status={outcome.status}
                  confidence={outcome.confidence}
                  compact
                />
              );
            })()
          ) : row.hasUrl ? (
            // Phase 6A.6 (2026-04-28) — the per-row "No data" placeholder
            // gave the H2 verified-live positive control the same generic
            // pill as a 2-year-old Profound CSV import, undermining
            // operator trust in the lifecycle OS. Resolver returns the
            // most-specific honest copy for each backend state.
            (() => {
              const copy = resolveAttributionCopy({
                entry: ch,
                edit: lifecycleStatus
                  ? { implementation_status: lifecycleStatus, live_at: editLiveAt ?? null }
                  : null,
                cls: lifecycleClass ?? null,
                outcome: null,
                verdictFlagEnabled: verdictFlagEnabled ?? false,
              });
              return (
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${attributionToneClass(copy.tone)}`}
                  title={copy.tooltip}
                  // 2026-05-06 demo-path fix: data-attribution-branch
                  // used to leak raw enum values like
                  // `verified_live_too_early`. Customer mode strips it;
                  // operator mode + tests keep the test hook.
                  {...(OPERATOR_MODE_DEBUG
                    ? { "data-attribution-branch": copy.branch }
                    : {})}
                >
                  {copy.label}
                </span>
              );
            })()
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground bg-surface-inset/60 border-border/60">
              Site-wide
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 align-top whitespace-nowrap tabular-nums">
          <span className={`text-[12px] font-semibold ${deltaColor}`}>
            {deltaStr}
          </span>
          {deltaAbs != null && Math.abs(deltaAbs) >= 0.1 && (
            <span className="block text-[9px] text-muted-foreground mt-0.5">
              {deltaIsRaw && <span className="mr-0.5 uppercase tracking-wider">raw</span>}
              {deltaAbs > 0 ? "+" : ""}
              {deltaAbs.toFixed(1)}/day
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 align-top text-muted-foreground text-[12px] select-none">
          {open ? "▾" : "▸"}
        </td>
      </tr>
      {open && <ExpandPanel row={row} />}
    </>
  );
}

function ExpandPanel({ row }: { row: EnrichedChangeRow }) {
  const v = row.urlVerdict;
  const sc = row.scorecard;
  const isTooEarly = v?.verdict === "too_early";
  const ro = row.readyOn ?? null;

  return (
    <tr className="border-b border-border bg-surface-inset/20">
      <td colSpan={5} className="px-4 py-4">
        {/* G5: Ready-on block for Too-early rows. Honest fallback when the
            pattern brain has zero helping samples for this edit type. */}
        {isTooEarly && ro && (
          <div className="mb-4 rounded-md border border-accent-primary/30 bg-accent-primary/[0.03] px-3 py-2.5">
            <p className="text-[10px] font-semibold text-accent-primary uppercase tracking-wide">
              Check again on this date to evaluate impact
            </p>
            <p className="text-[13px] font-semibold text-foreground mt-1">
              {formatReadyDate(ro.readyDate)} ·{" "}
              <span className="text-muted-foreground font-normal">
                {ro.daysFromChange}d from change
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              {ro.narrative}{" "}
              <span className="text-muted-foreground/70">
                (Open this page on that date and the watcher will refresh.)
              </span>
            </p>
            {ro.patternId && (
              <p className="text-[10px] text-muted-foreground/70 mt-1.5 font-mono">
                pattern: {ro.patternId} · {ro.sampleCount} sample
                {ro.sampleCount === 1 ? "" : "s"}
                {ro.confidenceTier && ` · ${ro.confidenceTier} confidence`}
              </p>
            )}
          </div>
        )}
        <div className="grid md:grid-cols-[1fr_1fr] gap-5">
          {/* Left: Explain this verdict (URL-level math) */}
          <section>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Explain this verdict
            </p>
            {!row.hasUrl ? (
              <p className="text-[12px] text-muted-foreground italic">
                This change has no URL — site-wide changes aren&apos;t tracked
                per-URL. Look at the topic breakdown on the right for whether
                any prompts moved.
              </p>
            ) : !v ? (
              <p className="text-[12px] text-muted-foreground italic">
                No citation data found for this URL yet. Either the page
                isn&apos;t cited anywhere in your tracked prompts, or the URL
                doesn&apos;t match any indexed page.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-foreground">
                  {v.explanation.summary}
                </p>
                {/* T3.2 — Trust Sprint verdict provenance disclosure.
                    Customer-safe summary of trust + caveats above the
                    operator-facing math block below. Anchor source +
                    contaminated-date + sparse pre-window caveats live
                    here; raw Z-score lives in the nested operator
                    detail. See
                    docs/BEACON_ATTRIBUTION_TRUST_AUDIT_2026_05_06.md. */}
                {(() => {
                  const change = row.scorecard.change;
                  const liveAtRaw = (change as { live_at?: string | null } | null | undefined)
                    ?.live_at;
                  const hasLiveAt = typeof liveAtRaw === "string" && liveAtRaw.length > 0;
                  const anchor = hasLiveAt
                    ? liveAtRaw!.slice(0, 10)
                    : (change as { timestamp?: string | null } | null | undefined)?.timestamp?.slice(0, 10) ?? null;
                  const baselineDays = v.explanation.math.baseline_days_used;
                  const postDays = v.explanation.math.post_days_used;
                  const preStartISO =
                    anchor != null && baselineDays > 0
                      ? new Date(
                          new Date(anchor + "T00:00:00Z").getTime() -
                            baselineDays * 86_400_000,
                        )
                          .toISOString()
                          .slice(0, 10)
                      : null;
                  const preEndISO =
                    anchor != null
                      ? new Date(
                          new Date(anchor + "T00:00:00Z").getTime() - 86_400_000,
                        )
                          .toISOString()
                          .slice(0, 10)
                      : null;
                  const postStartISO =
                    anchor != null
                      ? new Date(
                          new Date(anchor + "T00:00:00Z").getTime() + 86_400_000,
                        )
                          .toISOString()
                          .slice(0, 10)
                      : null;
                  const postEndISO =
                    anchor != null && postDays > 0
                      ? new Date(
                          new Date(anchor + "T00:00:00Z").getTime() +
                            postDays * 86_400_000,
                        )
                          .toISOString()
                          .slice(0, 10)
                      : null;
                  const prov = buildVerdictProvenance({
                    id: `verdict-${row.scorecard.change.id}`,
                    verdict: v.verdict,
                    anchorDate: anchor,
                    anchorSource: hasLiveAt ? "live_at" : anchor != null ? "timestamp" : "unknown",
                    preStartISO,
                    preEndISO,
                    postStartISO,
                    postEndISO,
                    preDays: baselineDays,
                    postDays: postDays,
                    muPre: v.explanation.math.mu_pre,
                    muPost: v.explanation.math.mu_post,
                    zScore: v.explanation.math.z,
                    sustainUp: v.explanation.math.sustain_up,
                    sustainDown: v.explanation.math.sustain_down,
                    confidence: v.confidence,
                    samplingGuardDemotion: v.sampling_guard_demoted ?? null,
                    changeDescription: row.scorecard.change.change_description ?? null,
                  });
                  return <WhyThisVerdict provenance={prov} />;
                })()}
                <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-[11px] font-mono leading-relaxed">
                  <MathRow
                    label="Before change (per day)"
                    value={`${v.explanation.math.mu_pre}/day`}
                    note={`${v.explanation.math.baseline_days_used}d window`}
                  />
                  <MathRow
                    label="Normal range"
                    value={`${v.explanation.math.sigma_pre_used.toFixed(2)}`}
                    note={
                      v.explanation.math.sigma_pre_raw < 1
                        ? `raw ${v.explanation.math.sigma_pre_raw.toFixed(2)} → floored to 1`
                        : undefined
                    }
                  />
                  <MathRow
                    label="After change (per day)"
                    value={`${v.explanation.math.mu_post}/day`}
                    note={`${v.explanation.math.post_days_used}d window`}
                  />
                  <MathRow
                    label="Change strength"
                    value={`${v.explanation.math.z > 0 ? "+" : ""}${v.explanation.math.z.toFixed(2)}`}
                    note={
                      Math.abs(v.explanation.math.z) >= 2
                        ? "Strong signal"
                        : "Weak signal"
                    }
                  />
                  <MathRow
                    label="sustain (last 7d)"
                    value={`↑${v.explanation.math.sustain_up} / ↓${v.explanation.math.sustain_down}`}
                    note={
                      v.explanation.math.sustain_up >= 5
                        ? "5/7 up → sustained"
                        : v.explanation.math.sustain_down >= 5
                          ? "5/7 down → sustained"
                          : "no sustained direction"
                    }
                  />
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  Confidence: <span className="font-medium">{v.confidence}</span>
                </p>
              </div>
            )}
          </section>

          {/* Right: Topic & platform drill-down from legacy scorecard data */}
          <section>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Topic &amp; platform drill-down
            </p>
            {sc.eventAttributions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground italic">
                No attribution events matched this change — either too early,
                or no tracked topic moved around the change date.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sc.eventAttributions.slice(0, 8).map((ea, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <span
                      className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                        ea.role === "primary"
                          ? "bg-status-success/10 text-status-success"
                          : ea.role === "contributing"
                            ? "bg-status-warning/10 text-status-warning"
                            : "bg-surface-inset text-muted-foreground"
                      }`}
                    >
                      {ea.role === "primary"
                        ? "Primary"
                        : ea.role === "contributing"
                          ? "Also"
                          : "Maybe"}
                    </span>
                    <span className="text-[10px] font-medium text-foreground">
                      {PLATFORM_SHORT[ea.event.platform] ?? ea.event.platform}
                    </span>
                    <span className="truncate flex-1">{ea.event.topic}</span>
                  </li>
                ))}
                {sc.eventAttributions.length > 8 && (
                  <li className="text-[10px] text-muted-foreground/70">
                    +{sc.eventAttributions.length - 8} more…
                  </li>
                )}
              </ul>
            )}

            {sc.topics.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  Targeted topics
                </p>
                <div className="flex flex-wrap gap-1">
                  {sc.topics.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-border/40">
              <Link
                href={`/changes/${sc.change.id}`}
                className="text-[11px] font-semibold text-accent-primary hover:underline"
              >
                Open full detail page →
              </Link>
            </div>
          </section>
        </div>
      </td>
    </tr>
  );
}

function formatReadyDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function MathRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-muted-foreground min-w-[140px]">{label}</span>
      <span className="text-foreground font-semibold">{value}</span>
      {note && (
        <span className="text-muted-foreground/70 text-[10px] ml-auto">
          {note}
        </span>
      )}
    </div>
  );
}
