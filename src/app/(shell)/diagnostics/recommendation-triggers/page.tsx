import "server-only";

/**
 * 2026-05-19 — operator-only recommendation-trigger diagnostic page.
 *
 * Surfaces deterministic-trigger candidate rows for the tenant's
 * owned pages. Operator validation surface only — no customer-
 * facing recommendations are produced or persisted here. The
 * customer-queue flip is deferred until operator validation
 * completes here.
 *
 * Slice 4.5.B.α₂.1 (2026-05-19): page copy is slice-agnostic
 * (predicate count + description interpolate `result.meta.
 * predicates_run` from the loader rather than hardcoding a
 * slice version). Empty-state branches distinguish "no owned
 * snapshots in the environment" from "snapshots present but
 * zero candidates."
 *
 * Operator-gated. Reads snapshots via the repository pattern,
 * which routes to Supabase in production. No write paths, no
 * LLM, no paid APIs.
 *
 * Pinned by:
 *   • tests/app/diagnostics/recommendation-triggers-page.test.tsx
 *   • tests/architecture/recommendation-intelligence-no-queue-write.test.ts
 *   • tests/architecture/recommendation-trigger-predicates-purity.test.ts
 *   • tests/architecture/recommendation-intelligence-customer-copy-vocab.test.ts
 *   • tests/architecture/recommendation-intelligence-no-llm-decides.test.ts
 *   • tests/architecture/recommendation-registry-active-set.test.ts
 *   • tests/architecture/recommendation-triggers-diagnostic-source-and-copy.test.ts
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadTriggerCandidatesForTenant } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import type { TriggerCandidatesLoadStatus } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

export const dynamic = "force-dynamic";

function isAccessAllowed(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

function statusBanner(status: TriggerCandidatesLoadStatus): string | null {
  if (status === "snapshots_unavailable") {
    return "page-snapshots data unavailable. Run scripts/scan-owned-pages.ts to populate .data/page-snapshots.json.";
  }
  return null;
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecommendationTriggersDiagnosticPage(
  props: PageProps,
) {
  if (!isAccessAllowed()) {
    notFound();
  }
  await (props.searchParams ?? Promise.resolve({}));

  const tenantId = await currentTenantId();
  const result = await loadTriggerCandidatesForTenant({ tenantId });
  const banner = statusBanner(result.status);

  return (
    <div className="space-y-4 p-4" data-diagnostic="recommendation-triggers">
      <header className="space-y-1">
        <h1 className="text-[15px] font-semibold text-foreground">
          Recommendation Trigger Diagnostic
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Operator validation surface for recommendation-intelligence
          deterministic trigger predicates (
          <span
            className="font-mono"
            data-description-predicates-run={result.meta.predicates_run}
          >
            {result.meta.predicates_run}
          </span>{" "}
          active). Customer queue is NOT modified by this page. The
          customer-queue flip is deferred until operator validation
          completes here.
        </p>
      </header>

      {banner ? (
        <section
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
          data-diagnostic-section="status-banner"
          data-load-status={result.status}
        >
          <p className="text-[12px] text-foreground">{banner}</p>
        </section>
      ) : null}

      <section
        className="rounded-md border border-border/40 bg-surface-inset/20 p-3"
        data-diagnostic-section="counters"
      >
        <ul className="text-[12px] text-foreground space-y-1">
          <li data-counter="snapshot_count">
            Owned snapshots: <span className="font-mono">{result.meta.snapshot_count}</span>
          </li>
          <li data-counter="predicates_run">
            Predicates run: <span className="font-mono">{result.meta.predicates_run}</span>
          </li>
          <li data-counter="candidate_count">
            Candidates: <span className="font-mono">{result.meta.candidate_count}</span>
          </li>
          <li data-counter="diagnostic_only_count">
            Diagnostic-only: <span className="font-mono">{result.meta.diagnostic_only_count}</span>
          </li>
        </ul>
      </section>

      {result.meta.snapshot_count === 0 ? (
        <section
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
          data-diagnostic-section="empty-snapshots"
          data-load-status={result.status}
        >
          <p className="text-[12px] text-foreground">
            No owned page snapshots available for this tenant. Run the
            owned-page scan in this environment, then revisit this page
            to validate trigger candidates.
          </p>
        </section>
      ) : (
        <>
          {result.candidates.length === 0 ? (
            <p
              className="text-[12px] text-muted-foreground"
              data-diagnostic-section="empty-candidates"
            >
              No candidate rows produced for this tenant.
            </p>
          ) : (
            <CandidateTable rows={result.candidates} />
          )}

          {result.diagnostic_only.length > 0 ? (
            <DiagnosticOnlySection rows={result.diagnostic_only} />
          ) : null}
        </>
      )}
    </div>
  );
}

function CandidateTable(props: {
  rows: ReadonlyArray<RecommendationCandidateRow>;
}) {
  return (
    <section
      className="rounded-md border border-border/40"
      data-diagnostic-section="candidates"
      data-row-count={props.rows.length}
    >
      <table className="w-full text-[12px] text-foreground">
        <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Trigger</th>
            <th className="px-3 py-2 font-medium">Action type</th>
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Confidence</th>
            <th className="px-3 py-2 font-medium">Customer copy</th>
            <th className="px-3 py-2 font-medium">Dedupe key</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.dedupe_key}
              data-row-trigger-signal={row.trigger_signal}
              data-row-action-type={row.action_type}
              data-row-confidence={row.confidence}
              data-row-dedupe-key={row.dedupe_key}
            >
              <td className="px-3 py-2 font-mono text-[11px]">{row.trigger_signal}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{row.action_type}</td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">{row.target_url}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{row.confidence}</td>
              <td className="px-3 py-2 text-foreground/90">{row.customer_copy}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {row.dedupe_key.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Slice 4.5.C.α₂ (2026-05-20) — diagnostic-only bucket.
 *
 * Low-confidence trigger candidates (e.g., Tier-2 sensitive
 * indexability predicates `noindex_on_indexable_page` and
 * `robots_blocks_ai_bots`) route here via `applyQueueRules`.
 * Operator validates here BEFORE any customer-queue promotion.
 *
 * Visually distinct (subtle warning border) so the operator can
 * tell at a glance that these rows are NOT customer-facing
 * candidates today. Same column layout as `CandidateTable` for
 * scan-ability.
 */
function DiagnosticOnlySection(props: {
  rows: ReadonlyArray<RecommendationCandidateRow>;
}) {
  return (
    <section
      className="rounded-md border border-status-warning/40 bg-status-warning/[0.04]"
      data-diagnostic-section="diagnostic-only"
      data-row-count={props.rows.length}
    >
      <header className="border-b border-status-warning/40 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Diagnostic-only signals (low-confidence)
        </h2>
        <p className="text-[11px] text-muted-foreground">
          These rows are NOT customer-facing candidates. Operator
          validation required before promotion.
        </p>
      </header>
      <table className="w-full text-[12px] text-foreground">
        <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Trigger</th>
            <th className="px-3 py-2 font-medium">Action type</th>
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Confidence</th>
            <th className="px-3 py-2 font-medium">Customer copy</th>
            <th className="px-3 py-2 font-medium">Dedupe key</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.dedupe_key}
              data-row-trigger-signal={row.trigger_signal}
              data-row-action-type={row.action_type}
              data-row-confidence={row.confidence}
              data-row-dedupe-key={row.dedupe_key}
            >
              <td className="px-3 py-2 font-mono text-[11px]">{row.trigger_signal}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{row.action_type}</td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">{row.target_url}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{row.confidence}</td>
              <td className="px-3 py-2 text-foreground/90">{row.customer_copy}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {row.dedupe_key.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
