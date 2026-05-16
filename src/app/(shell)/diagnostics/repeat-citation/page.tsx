/**
 * Section 5.A.2 (2026-05-16) — `/diagnostics/repeat-citation`,
 * operator-only diagnostic surface for the repeat-citation
 * classifier (Section 5.A).
 *
 * Hard contracts pinned by architecture invariants:
 *   - force-dynamic so Vercel never statically prerenders the read.
 *   - The operator gate (`await isOperatorModeServer()`) runs BEFORE
 *     ANY data read — tenant resolution, business-config,
 *     repository creation, recommended-edits read, AND every
 *     `loadRepeatCitationForEdit` call must follow the gate.
 *   - No import from `@/storage/canonical-store` (Section 5
 *     denominators flow through `getProfoundImportRuns()` via the
 *     loader; the canonical-store bridge is forbidden in
 *     Section 5 scope).
 *   - No call to `repo.getObservationRuns()` (wrong type —
 *     website-crawl, not poll-runs).
 *   - Operator-safe copy only — forbidden vocab pinned by
 *     `repeat-citation-operator-page-vocab.test.ts`.
 *
 * Surface shape:
 *   - Header with brand name + as-of timestamp.
 *   - Summary card: band counts per window (30 / 60 / 90 days).
 *   - Per-edit table (top 20 eligible edits by live_at desc),
 *     three columns of band+rate per window plus per-platform
 *     ChatGPT / Perplexity breakdowns.
 *   - Data-sources footer.
 *   - Calm empty state when no eligible edits exist.
 */

import { notFound } from "next/navigation";

import { PageHeader } from "@/components/data/page-header";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { getBusinessConfig } from "@/lib/business-config";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";

import { getTimeToCitationEligibility } from "@/domains/citation-lifecycle/eligibility";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadRepeatCitationForEdit } from "@/domains/citation-lifecycle/load-repeat-citation";
import type {
  RepeatCitationBand,
  RepeatCitationResult,
  RepeatCitationPlatformBreakdown,
} from "@/domains/citation-lifecycle/compute-repeat-citation";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

export const dynamic = "force-dynamic";

const WINDOWS = [30, 60, 90] as const;
const TOP_N = 20;

const BAND_LABELS: Record<RepeatCitationBand, string> = {
  stable: "Stable",
  intermittent: "Intermittent",
  one_off: "One-off",
  not_repeated: "Not repeated in this window",
  still_learning: "Still learning",
};

const BAND_ORDER: ReadonlyArray<RepeatCitationBand> = [
  "stable",
  "intermittent",
  "one_off",
  "not_repeated",
  "still_learning",
];

type WindowResults = {
  windowDays: number;
  result: RepeatCitationResult;
};

type EditWithResults = {
  edit: RecommendedEditRow;
  daysSinceLive: number | null;
  firstCitationDateIso: string | null;
  byWindow: WindowResults[];
};

type BandCounts = Record<RepeatCitationBand, number>;

function emptyBandCounts(): BandCounts {
  return {
    stable: 0,
    intermittent: 0,
    one_off: 0,
    not_repeated: 0,
    still_learning: 0,
  };
}

function utcDateOnly(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startIso: string, endIso: string): number | null {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

function formatRate(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function describePlatform(p: RepeatCitationPlatformBreakdown): string {
  return `${p.distinct_citation_days} / ${p.polling_days} poll days`;
}

export default async function RepeatCitationDiagnosticPage() {
  // OPERATOR GATE — must precede every data read. Architecture
  // invariant pins the offset ordering.
  if (!(await isOperatorModeServer())) return notFound();

  const tenantId = await currentTenantId();
  const businessConfig = getBusinessConfig();
  const repo = getRepository().forTenant(tenantId);
  const edits = await repo.getRecommendedEdits();

  const now = new Date();
  const nowIsoDate = utcDateOnly(now);

  const eligible = edits
    .filter((e) => getTimeToCitationEligibility(e).eligible)
    .filter(
      (e): e is RecommendedEditRow & { live_at: string } => e.live_at != null,
    )
    .sort((a, b) => (a.live_at < b.live_at ? 1 : a.live_at > b.live_at ? -1 : 0))
    .slice(0, TOP_N);

  const rows: EditWithResults[] = await Promise.all(
    eligible.map(async (edit) => {
      const windowResults = await Promise.all(
        WINDOWS.map(async (windowDays) => {
          const result = await loadRepeatCitationForEdit({
            tenantId,
            recommendedEdit: edit,
            now,
            windowDays,
          });
          return { windowDays, result };
        }),
      );
      const firstCitation =
        windowResults.find((w) => w.result.first_citation_date_iso != null)
          ?.result.first_citation_date_iso ?? null;
      return {
        edit,
        daysSinceLive: daysBetween(utcDateOnly(edit.live_at), nowIsoDate),
        firstCitationDateIso: firstCitation,
        byWindow: windowResults,
      };
    }),
  );

  const summaryByWindow = new Map<number, BandCounts>();
  for (const w of WINDOWS) summaryByWindow.set(w, emptyBandCounts());
  for (const row of rows) {
    for (const wr of row.byWindow) {
      if (wr.result.band == null) continue;
      const counts = summaryByWindow.get(wr.windowDays)!;
      counts[wr.result.band] += 1;
    }
  }

  const brandName =
    typeof businessConfig.name === "string" && businessConfig.name.length > 0
      ? businessConfig.name
      : null;

  return (
    <div
      className="max-w-5xl space-y-6"
      data-diag-repeat-citation="true"
    >
      <PageHeader
        title="Repeat-citation classifier"
        description={
          brandName
            ? `Operator view — repeat-citation classifier · ${brandName}`
            : "Operator view — repeat-citation classifier"
        }
      />

      <p
        className="text-[12px] text-muted-foreground"
        data-diag-repeat-citation-as-of="true"
      >
        As of {now.toISOString()}
      </p>

      <SummaryCard
        eligibleCount={rows.length}
        totalEdits={edits.length}
        summaryByWindow={summaryByWindow}
      />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <EditTable rows={rows} />
      )}

      <DataSourcesFooter />
    </div>
  );
}

function SummaryCard({
  eligibleCount,
  totalEdits,
  summaryByWindow,
}: {
  eligibleCount: number;
  totalEdits: number;
  summaryByWindow: Map<number, BandCounts>;
}) {
  return (
    <div
      className="rounded-md border border-border/60 bg-surface-inset/40 px-4 py-4"
      data-diag-repeat-citation-summary="true"
    >
      <h2 className="text-[13px] font-medium text-foreground">
        Observed citation stability
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {eligibleCount} of {totalEdits} edits eligible. Top {TOP_N} most recent
        shown below.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {WINDOWS.map((w) => (
          <SummaryWindowColumn
            key={w}
            windowDays={w}
            counts={summaryByWindow.get(w)!}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryWindowColumn({
  windowDays,
  counts,
}: {
  windowDays: number;
  counts: BandCounts;
}) {
  return (
    <div
      className="rounded border border-border/40 px-3 py-2"
      data-diag-repeat-citation-summary-window={windowDays}
    >
      <p className="text-[12px] font-medium text-foreground">
        {windowDays}-day window
      </p>
      <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
        {BAND_ORDER.map((band) => (
          <li
            key={band}
            data-diag-repeat-citation-summary-band={band}
          >
            <span className="text-foreground">{BAND_LABELS[band]}</span>:{" "}
            {counts[band]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-md border border-border/60 bg-surface-inset/40 px-4 py-4"
      data-diag-repeat-citation-empty="true"
    >
      <p className="text-[13px] leading-relaxed text-foreground">
        No eligible edits yet — repeat citation stability needs verified-live
        edits with a target URL.
      </p>
    </div>
  );
}

function EditTable({ rows }: { rows: ReadonlyArray<EditWithResults> }) {
  return (
    <div
      className="overflow-x-auto rounded-md border border-border/60"
      data-diag-repeat-citation-table="true"
    >
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-surface-inset/60 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Edit</th>
            <th className="px-3 py-2 font-medium">Live since</th>
            <th className="px-3 py-2 font-medium">First cited</th>
            {WINDOWS.map((w) => (
              <th key={w} className="px-3 py-2 font-medium">
                {w}d
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Per-platform (30d)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <EditRow key={row.edit.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({ row }: { row: EditWithResults }) {
  const editLabel =
    canonicalizeCitationUrl(row.edit.target_url ?? null) ??
    row.edit.target_url ??
    "—";
  const window30 = row.byWindow.find((w) => w.windowDays === 30)?.result;
  return (
    <tr
      className="border-t border-border/40 align-top"
      data-diag-repeat-citation-row={row.edit.id}
    >
      <td className="px-3 py-2 text-foreground">
        <div className="break-all">{editLabel}</div>
        <div className="text-[11px] text-muted-foreground">
          {row.edit.action_type}
        </div>
      </td>
      <td className="px-3 py-2 text-foreground">
        {row.daysSinceLive == null ? "—" : `${row.daysSinceLive} days`}
      </td>
      <td className="px-3 py-2 text-foreground">
        {row.firstCitationDateIso ?? "—"}
      </td>
      {WINDOWS.map((w) => {
        const wr = row.byWindow.find((x) => x.windowDays === w);
        return (
          <td
            key={w}
            className="px-3 py-2 text-foreground"
            data-diag-repeat-citation-row-window={w}
          >
            <BandCell result={wr?.result ?? null} />
          </td>
        );
      })}
      <td className="px-3 py-2 text-foreground">
        {window30 == null ? (
          "—"
        ) : (
          <PerPlatformCell result={window30} />
        )}
      </td>
    </tr>
  );
}

function BandCell({ result }: { result: RepeatCitationResult | null }) {
  if (result == null || result.band == null) return <span>—</span>;
  const rate = formatRate(result.citation_rate);
  return (
    <div data-diag-repeat-citation-band={result.band}>
      <div>{BAND_LABELS[result.band]}</div>
      <div className="text-[11px] text-muted-foreground">
        Cited {result.distinct_citation_days} of {result.polling_days} poll days
        ({rate})
      </div>
    </div>
  );
}

function PerPlatformCell({ result }: { result: RepeatCitationResult }) {
  return (
    <div
      className="space-y-0.5 text-[11px]"
      data-diag-repeat-citation-per-platform="true"
    >
      <div>
        <span className="text-muted-foreground">ChatGPT:</span>{" "}
        {describePlatform(result.per_platform.chatgpt)}
      </div>
      <div>
        <span className="text-muted-foreground">Perplexity:</span>{" "}
        {describePlatform(result.per_platform.perplexity)}
      </div>
    </div>
  );
}

function DataSourcesFooter() {
  return (
    <div
      className="rounded-md border border-border/40 bg-surface-inset/30 px-4 py-3 text-[11px] text-muted-foreground"
      data-diag-repeat-citation-data-sources="true"
    >
      <p className="font-medium text-foreground">Data sources</p>
      <ul className="mt-1 space-y-0.5">
        <li>
          Prompt-answer observations: tenant-scoped via the repository
          (`forTenant(tenantId).getPromptAnswerObservations`).
        </li>
        <li>
          Poll-run records: tenant-scoped via `getProfoundImportRuns()` (Section
          5 precursor). Successful native poll days only — denominator filters
          on `status = completed` and `source_type = beacon_native`.
        </li>
        <li>
          Benchmark citations: cold-store shards, regime-gated to pre-cutover
          live_at only. No-op for native-regime edits.
        </li>
      </ul>
    </div>
  );
}
