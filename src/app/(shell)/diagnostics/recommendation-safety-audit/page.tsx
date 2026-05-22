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
import { getBrandAssertions } from "@/domains/recommendations/brand-assertions";
import {
  auditRecommendedEditRow,
  type SafetyAuditResult,
  type SafetyViolation,
  type SafetyViolationField,
  type SafetyViolationSeverity,
} from "@/domains/recommendation-intelligence/safety-audit";

export const dynamic = "force-dynamic";

/**
 * Slice 4.5.G-B.4a — page-layer customer-visibility classification of
 * the scanner's field labels. Conservative + honest per the operator's
 * "do not guess" rule: only `proposed_text` (Suggested Copy Act 4) and
 * `why` (detail header + Act 2 + legacy drawer + v2 card) are CONFIRMED
 * customer-visible. `customer_copy` conflates `expected_impact`
 * (unconfirmed render) + `measurement_plan` (customer-visible on the
 * detail page), so it is marked `unknown` rather than guessed.
 * `operator_evidence` (the `display_label` field) is operator-facing.
 */
type FieldVisibility = "customer_visible" | "operator_internal" | "unknown";
const FIELD_VISIBILITY: Record<SafetyViolationField, FieldVisibility> = {
  proposed_text: "customer_visible",
  why: "customer_visible",
  customer_copy: "unknown",
  operator_evidence: "operator_internal",
  topic_cluster_label: "unknown",
};

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

  // B.4a — resolve tenant brand assertions at the PAGE boundary and map
  // to the scanner's local structural shape. Mirrors the established
  // call convention (`specific-edit-evidence.ts`, the trigger action).
  // The pure scanner never imports brand-assertions; it only receives
  // this structural array.
  const brandAssertions = getBrandAssertions(tenantId).map((a) => ({
    id: a.id,
    phrase: a.phrase,
    category: a.category as string,
  }));

  const now = new Date();
  const auditResults: SafetyAuditResult[] = recommendedEdits.map((row) =>
    auditRecommendedEditRow(row, {
      competitorNames,
      tenantId,
      brandAssertions,
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
  // B.4a — brand-support counters. `brand_supported` is set ONLY on
  // classifiable kinds (architect_overclaim / unsupported_claim). A
  // violation with `brand_supported === undefined` is a non-brand-claim
  // kind (uuid / internal / competitor / placeholder / etc.) and counts
  // toward neither brand bucket.
  let brandSupportedCount = 0;
  let unsupportedCount = 0;
  let unsupportedCustomerVisibleCount = 0;
  for (const r of violationRows) {
    if (r.violation.severity === "high") highCount += 1;
    else if (r.violation.severity === "medium") mediumCount += 1;
    else lowCount += 1;

    if (r.violation.brand_supported === true) {
      brandSupportedCount += 1;
    } else if (r.violation.brand_supported === false) {
      unsupportedCount += 1;
      if (FIELD_VISIBILITY[r.violation.field] === "customer_visible") {
        unsupportedCustomerVisibleCount += 1;
      }
    }
  }

  // B.4a — debt breakdown grouped by (kind × field × normalized_match/
  // matched_text × claim_risk_category × brand_supported × severity).
  type DebtGroup = {
    key: string;
    kind: SafetyViolation["kind"];
    field: SafetyViolationField;
    match: string;
    claim_risk_category: string | null;
    brand_supported: boolean | null;
    severity: SafetyViolationSeverity;
    visibility: FieldVisibility;
    count: number;
  };
  const debtMap = new Map<string, DebtGroup>();
  for (const r of violationRows) {
    const v = r.violation;
    const match = v.normalized_match ?? v.matched_text;
    const crc = v.claim_risk_category ?? null;
    const bs = v.brand_supported ?? null;
    const key = [
      v.kind,
      v.field,
      match,
      crc ?? "—",
      bs === null ? "—" : String(bs),
      v.severity,
    ].join("§");
    const existing = debtMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      debtMap.set(key, {
        key,
        kind: v.kind,
        field: v.field,
        match,
        claim_risk_category: crc,
        brand_supported: bs,
        severity: v.severity,
        visibility: FIELD_VISIBILITY[v.field],
        count: 1,
      });
    }
  }
  const debtGroups = Array.from(debtMap.values()).sort((a, b) => {
    // Unsupported-first, then by descending count, then kind.
    const aw = a.brand_supported === false ? 0 : a.brand_supported === true ? 2 : 1;
    const bw = b.brand_supported === false ? 0 : b.brand_supported === true ? 2 : 1;
    if (aw !== bw) return aw - bw;
    if (b.count !== a.count) return b.count - a.count;
    return a.kind.localeCompare(b.kind);
  });

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
          <li data-counter="brand_supported_violations">
            Brand-supported (tagged, not removed):{" "}
            <span className="font-mono">{brandSupportedCount}</span>
          </li>
          <li data-counter="unsupported_violations">
            Unsupported brand claims:{" "}
            <span className="font-mono">{unsupportedCount}</span>
          </li>
          <li data-counter="unsupported_customer_visible_violations">
            Unsupported AND customer-visible:{" "}
            <span className="font-mono">
              {unsupportedCustomerVisibleCount}
            </span>
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Brand-support classification tags each architect / unsupported
          claim against this tenant&apos;s approved assertions. No
          violation is ever hidden — supported claims are tagged, not
          removed.
        </p>
      </section>

      {debtGroups.length > 0 ? (
        <DebtBreakdownTable rows={debtGroups} />
      ) : null}

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
      <table className="w-full text-[12px] text-foreground" data-safety-flat-table="true">
        <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">rec_id</th>
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Brand support</th>
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
              data-safety-visibility={FIELD_VISIBILITY[r.violation.field]}
              {...(r.violation.brand_supported !== undefined
                ? {
                    "data-safety-brand-supported": String(
                      r.violation.brand_supported,
                    ),
                  }
                : {})}
              {...(r.violation.claim_risk_category !== undefined
                ? {
                    "data-safety-claim-risk-category":
                      r.violation.claim_risk_category,
                  }
                : {})}
              {...(r.violation.normalized_match !== undefined
                ? { "data-safety-normalized-match": r.violation.normalized_match }
                : {})}
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
              <td className="px-3 py-2 font-mono text-[11px]">
                {r.violation.brand_supported === undefined
                  ? "—"
                  : r.violation.brand_supported
                    ? "supported"
                    : "unsupported"}
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

// ---------------------------------------------------------------------------
// Slice 4.5.G-B.4a — Debt breakdown (grouped) section.
// ---------------------------------------------------------------------------

function DebtBreakdownTable(props: {
  rows: ReadonlyArray<{
    key: string;
    kind: SafetyViolation["kind"];
    field: SafetyViolationField;
    match: string;
    claim_risk_category: string | null;
    brand_supported: boolean | null;
    severity: SafetyViolationSeverity;
    visibility: FieldVisibility;
    count: number;
  }>;
}) {
  return (
    <section
      className="rounded-md border border-border/40"
      data-diagnostic-section="recommendation-safety-audit-debt-breakdown"
      data-debt-group-count={props.rows.length}
    >
      <header className="border-b border-border/40 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Debt breakdown
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Grouped by kind × field × match × claim-risk category ×
          brand-support × severity. Unsupported brand claims are listed
          first. Use this to separate genuine debt (unsupported +
          customer-visible) from audit noise (brand-supported or
          operator-internal).
        </p>
      </header>
      <table className="w-full text-[12px] text-foreground">
        <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Visibility</th>
            <th className="px-3 py-2 font-medium">Match</th>
            <th className="px-3 py-2 font-medium">Risk category</th>
            <th className="px-3 py-2 font-medium">Brand support</th>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((g) => (
            <tr
              key={g.key}
              data-debt-kind={g.kind}
              data-debt-field={g.field}
              data-debt-visibility={g.visibility}
              data-debt-match={g.match}
              data-debt-brand-supported={
                g.brand_supported === null ? "n/a" : String(g.brand_supported)
              }
              {...(g.claim_risk_category !== null
                ? { "data-debt-claim-risk-category": g.claim_risk_category }
                : {})}
              data-debt-severity={g.severity}
              data-debt-count={g.count}
            >
              <td className="px-3 py-2 font-mono text-[11px]">{g.kind}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{g.field}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{g.visibility}</td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">
                {g.match}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {g.claim_risk_category ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {g.brand_supported === null
                  ? "—"
                  : g.brand_supported
                    ? "supported"
                    : "unsupported"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">{g.severity}</td>
              <td className="px-3 py-2 font-mono text-[11px]">{g.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
