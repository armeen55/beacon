import "server-only";

/**
 * Slice 4.5.G-A.2 (2026-05-21) — operator-only recommendation
 * safety audit diagnostic page.
 *
 * Consumes the A.1 pure scanner
 * (`auditRecommendedEditRow` from `@/domains/recommendation-
 * intelligence/safety-audit`) and renders a flat one-row-per-
 * violation table. Reads `recommended_edits` + `tracked_entities`
 * via the existing repository pattern. Builds the competitor-name
 * scan list from active competitor entities only.
 *
 * Hard contract — READ-ONLY (pinned by the
 * `recommendation-safety-audit-read-only` architecture invariant,
 * which scans comment-stripped active source):
 *   • NO mutations · NO writes · NO server actions
 *   • NO persistence-module imports
 *   • NO LLM-orchestrator helper references
 *   • NO Supabase recommended_edits write shape
 *   • NO LLM imports (no gateway, no provider)
 *   • NO `fetch(`
 *   • NO cache invalidation side-effects on render
 *
 * Operator-gated by the standard pattern; non-operator non-test
 * renders `notFound()`. The audit is end-to-end read-only; the
 * operator decides per-row whether to fix any flagged row
 * (manual edit in CMS, dismiss, or accept-as-is). Beacon does not
 * auto-rewrite live rows from this surface.
 *
 * Pinned by:
 *   • tests/app/diagnostics/recommendation-safety-audit-page.test.tsx
 *   • tests/architecture/recommendation-safety-audit-read-only.test.ts
 *   • tests/architecture/recommendation-safety-audit-coverage.test.ts
 *     (covers scanner-side guarantees this page consumes)
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import {
  auditRecommendedEditRow,
  type SafetyAuditResult,
  type SafetyViolation,
  type SafetyViolationSeverity,
} from "@/domains/recommendation-intelligence/safety-audit";

export const dynamic = "force-dynamic";

function isAccessAllowed(): boolean {
  return isOperatorModeServer() || process.env.NODE_ENV === "test";
}

export default async function RecommendationSafetyAuditPage() {
  if (!isAccessAllowed()) {
    notFound();
  }

  const tenantId = await currentTenantId();
  const repo = getRepository().forTenant(tenantId);

  let recommendedEdits: Awaited<
    ReturnType<typeof repo.getRecommendedEdits>
  > = [];
  try {
    recommendedEdits = await repo.getRecommendedEdits();
  } catch {
    recommendedEdits = [];
  }

  let trackedEntities: Awaited<
    ReturnType<typeof repo.getTrackedEntities>
  > = [];
  try {
    trackedEntities = await repo.getTrackedEntities();
  } catch {
    trackedEntities = [];
  }
  const competitorNames = trackedEntities
    .filter((e) => e.entity_type === "competitor" && e.is_active === true)
    .map((e) => e.name)
    .filter((n) => typeof n === "string" && n.length > 0);

  const now = new Date();
  const auditResults: SafetyAuditResult[] = recommendedEdits.map((row) =>
    auditRecommendedEditRow(row, {
      competitorNames,
      tenantId,
      now,
    }),
  );

  type ViolationTableRow = {
    rec_id: string;
    target_url: string | null;
    implementation_status: string | null;
    violation: SafetyViolation;
  };
  const violationRows: ViolationTableRow[] = [];
  let scannedCount = 0;
  let rowsWithViolations = 0;
  for (let i = 0; i < auditResults.length; i++) {
    const audit = auditResults[i]!;
    const edit = recommendedEdits[i]!;
    scannedCount += 1;
    if (audit.violations.length > 0) {
      rowsWithViolations += 1;
      for (const v of audit.violations) {
        violationRows.push({
          rec_id: audit.rec_id,
          target_url: audit.target_url,
          implementation_status: edit.implementation_status ?? null,
          violation: v,
        });
      }
    }
  }

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  for (const r of violationRows) {
    if (r.violation.severity === "high") highCount += 1;
    else if (r.violation.severity === "medium") mediumCount += 1;
    else lowCount += 1;
  }

  return (
    <div
      className="space-y-4 p-4"
      data-diagnostic="recommendation-safety-audit"
    >
      <header className="space-y-1">
        <h1 className="text-[15px] font-semibold text-foreground">
          Recommendation Safety Audit
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Read-only operator audit for customer-facing recommendation
          copy and proposed text. No mutations are performed; this
          page never writes to any row.
        </p>
      </header>

      <section
        className="rounded-md border border-border/40 bg-surface-inset/20 p-3"
        data-diagnostic-section="recommendation-safety-audit-counters"
      >
        <ul className="text-[12px] text-foreground space-y-1">
          <li data-counter="scanned_count">
            Scanned rows:{" "}
            <span className="font-mono">{scannedCount}</span>
          </li>
          <li data-counter="rows_with_violations">
            Rows with violations:{" "}
            <span className="font-mono">{rowsWithViolations}</span>
          </li>
          <li data-counter="total_violations">
            Total violations:{" "}
            <span className="font-mono">{violationRows.length}</span>
          </li>
          <li data-counter="violations_high">
            High severity:{" "}
            <span className="font-mono">{highCount}</span>
          </li>
          <li data-counter="violations_medium">
            Medium severity:{" "}
            <span className="font-mono">{mediumCount}</span>
          </li>
          <li data-counter="violations_low">
            Low severity:{" "}
            <span className="font-mono">{lowCount}</span>
          </li>
        </ul>
      </section>

      {violationRows.length === 0 ? (
        <section
          className="rounded-md border border-status-success/40 bg-status-success/[0.06] px-3 py-2"
          data-diagnostic-section="recommendation-safety-audit-empty"
        >
          <p className="text-[12px] text-foreground">
            No safety violations detected across{" "}
            <span className="font-mono">{scannedCount}</span> scanned
            rows.
          </p>
        </section>
      ) : (
        <SafetyViolationsTable rows={violationRows} />
      )}
    </div>
  );
}

function severityClasses(s: SafetyViolationSeverity): string {
  if (s === "high") {
    return "rounded border border-status-error/40 bg-status-error/[0.06]";
  }
  if (s === "medium") {
    return "rounded border border-status-warning/40 bg-status-warning/[0.06]";
  }
  return "rounded border border-border/40 bg-surface-inset/20";
}

function SafetyViolationsTable(props: {
  rows: ReadonlyArray<{
    rec_id: string;
    target_url: string | null;
    implementation_status: string | null;
    violation: SafetyViolation;
  }>;
}) {
  return (
    <section
      className="rounded-md border border-border/40"
      data-diagnostic-section="recommendation-safety-audit"
      data-row-count={props.rows.length}
    >
      <header className="border-b border-border/40 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Safety violations
        </h2>
        <p className="text-[11px] text-muted-foreground">
          One DOM row per violation. A single recommended_edit may
          appear multiple times if it carries multiple violations.
          Read-only · no remediation actions are exposed.
        </p>
      </header>
      <table className="w-full text-[12px] text-foreground">
        <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">rec_id</th>
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Context</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, idx) => (
            <tr
              key={`${r.rec_id}-${r.violation.kind}-${r.violation.field}-${idx}`}
              data-safety-rec-id={r.rec_id}
              data-safety-violation-kind={r.violation.kind}
              data-safety-violation-severity={r.violation.severity}
              data-safety-violation-field={r.violation.field}
            >
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {r.rec_id.slice(0, 12)}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">
                {r.target_url ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {r.implementation_status ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {r.violation.field}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {r.violation.kind}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block px-2 py-0.5 text-[11px] font-mono ${severityClasses(r.violation.severity)}`}
                >
                  {r.violation.severity}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">
                {r.violation.matched_text}
              </td>
              <td className="px-3 py-2 text-foreground/90">
                {r.violation.context_excerpt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
