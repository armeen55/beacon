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
import { isPromotionLiveWriteEnabled } from "@/lib/promotion-live-write";
import { isLlmDraftGatewayEnabled } from "@/lib/llm-draft-gateway-flag";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getBusinessConfig } from "@/lib/business-config";
import { loadTriggerCandidatesForTenant } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import type { TriggerCandidatesLoadStatus } from "@/domains/recommendation-intelligence/load-trigger-candidates-for-tenant";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import {
  classifyPageType,
  type PageType,
} from "@/domains/recommendation-intelligence/page-classifier";
import {
  selectPromotableCandidates,
  type PromotionResult,
} from "@/domains/recommendation-intelligence/promote-to-queue";
import { getRecommendationResponses } from "@/domains/product/recommendation-response-store";
import {
  generateLlmDraftAction,
  promoteEligibleCandidatesAction,
} from "./actions";

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
  const searchParams = await (props.searchParams ?? Promise.resolve({}));
  const actionResult = parseActionResult(searchParams);
  const liveWriteEnabled = isPromotionLiveWriteEnabled();

  const llmDraftResult = parseLlmDraftResult(searchParams);
  const llmDraftEnabled = isLlmDraftGatewayEnabled();

  const tenantId = await currentTenantId();
  const result = await loadTriggerCandidatesForTenant({ tenantId });
  const banner = statusBanner(result.status);
  const weakH2DiagnosticRows = result.diagnostic_only.filter(
    (r) =>
      r.trigger_signal === "weak_h2" && r.action_type === "rewrite_h2",
  );

  // ── α₀b Promotion Preview data flow (DRY-RUN, no writes) ──
  // Read-only sources via the existing repository + response-store
  // patterns. α₀a.2's PromotionEditAnchor + PromotionResponseAnchor
  // are structurally compatible with the upstream row types so the
  // orchestrator accepts these reads without an adapter.
  const recommendedEdits = await getRepository()
    .forTenant(tenantId)
    .getRecommendedEdits();
  const recommendationResponses = await getRecommendationResponses();
  const businessConfig = getBusinessConfig(tenantId);
  const triggerCandidates = [...result.candidates, ...result.diagnostic_only];
  const pageTypeByUrl = new Map<string, PageType>();
  for (const c of triggerCandidates) {
    if (c.target_url == null) continue;
    if (pageTypeByUrl.has(c.target_url)) continue;
    pageTypeByUrl.set(
      c.target_url,
      classifyPageType(c.target_url, businessConfig),
    );
  }
  const promotion = selectPromotableCandidates({
    tenantId,
    triggerCandidates,
    recommendedEdits,
    recommendationResponses,
    pageTypeByUrl,
    now: new Date(),
  });
  const promotionEligible = promotion.filter((r) => r.eligible);
  const promotionCapped = promotion.filter(
    (r) =>
      r.suppression_reason === "max_rows_per_page" ||
      r.suppression_reason === "max_rows_per_family",
  );
  const promotionSafetySuppressed = promotion.filter(
    (r) =>
      !r.eligible &&
      r.suppression_reason !== "max_rows_per_page" &&
      r.suppression_reason !== "max_rows_per_family",
  );

  return (
    <div className="space-y-4 p-4" data-diagnostic="recommendation-triggers">
      {actionResult ? <ActionResultBanner result={actionResult} /> : null}
      {llmDraftResult ? (
        <LlmDraftResultBanner result={llmDraftResult} />
      ) : null}
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

      <LlmDraftPreviewSection
        rows={weakH2DiagnosticRows}
        enabled={llmDraftEnabled}
      />

      <PromotionPreviewSection
        totalCandidates={triggerCandidates.length}
        eligible={promotionEligible}
        capped={promotionCapped}
        safetySuppressed={promotionSafetySuppressed}
      />

      <PromoteForm
        eligibleCount={promotionEligible.length}
        liveWriteEnabled={liveWriteEnabled}
      />
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
/**
 * Slice 4.5.D.α₀b (2026-05-20) — Promotion Preview (DRY-RUN).
 *
 * Render-only visualization of what `selectPromotableCandidates`
 * (α₀a.3b orchestrator) would promote if the customer-queue
 * writer were active. NO writes happen here. The customer-queue
 * flip is deferred to Slice 4.5.D.α₁.
 *
 * Three subsections: Eligible · Capped · Safety-suppressed.
 * Counter at top: `Eligible for promotion: N / M · Capped: K ·
 * Safety-suppressed: L`. Always renders (even at 0/0) so the
 * operator can confirm the engine is active.
 */
function PromotionPreviewSection(props: {
  totalCandidates: number;
  eligible: ReadonlyArray<PromotionResult>;
  capped: ReadonlyArray<PromotionResult>;
  safetySuppressed: ReadonlyArray<PromotionResult>;
}) {
  return (
    <section
      className="rounded-md border border-border/40"
      data-diagnostic-section="promotion-preview"
    >
      <header className="border-b border-border/40 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Promotion Preview (DRY-RUN — no writes)
        </h2>
        <p className="text-[11px] text-muted-foreground">
          What WOULD promote to the customer recommendation queue if
          the writer were active. No writes happen here. The
          customer-queue flip is deferred to Slice 4.5.D.α₁.
        </p>
      </header>
      <div
        className="border-b border-border/40 px-3 py-2 text-[12px] text-foreground"
        data-counter="promotion-preview-counters"
      >
        Eligible for promotion:{" "}
        <span className="font-mono">{props.eligible.length}</span> /{" "}
        <span className="font-mono">{props.totalCandidates}</span> ·{" "}
        Capped: <span className="font-mono">{props.capped.length}</span> ·{" "}
        Safety-suppressed:{" "}
        <span className="font-mono">{props.safetySuppressed.length}</span>
      </div>
      {props.eligible.length > 0 ? (
        <PromotionPreviewSubsection
          subsection="eligible"
          title="Eligible for promotion"
          rows={props.eligible}
        />
      ) : null}
      {props.capped.length > 0 ? (
        <PromotionPreviewSubsection
          subsection="capped"
          title="Capped (over per-page or per-family limit)"
          rows={props.capped}
        />
      ) : null}
      {props.safetySuppressed.length > 0 ? (
        <PromotionPreviewSubsection
          subsection="safety-suppressed"
          title="Suppressed by safety gates"
          rows={props.safetySuppressed}
        />
      ) : null}
    </section>
  );
}

function PromotionPreviewSubsection(props: {
  subsection: "eligible" | "capped" | "safety-suppressed";
  title: string;
  rows: ReadonlyArray<PromotionResult>;
}) {
  return (
    <div
      data-promotion-subsection={props.subsection}
      data-row-count={props.rows.length}
    >
      <h3 className="px-3 py-2 text-[12px] font-semibold text-foreground">
        {props.title}
      </h3>
      <table className="w-full text-[12px] text-foreground">
        <thead className="border-y border-border/40 bg-surface-inset/10 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Trigger</th>
            <th className="px-3 py-2 font-medium">Action type</th>
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Tier</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Eligible</th>
            <th className="px-3 py-2 font-medium">Suppression reason</th>
            <th className="px-3 py-2 font-medium">Dedupe key</th>
            <th className="px-3 py-2 font-medium">Cooldown key</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={row.promotion_dedupe_key}
              data-row-trigger-signal={row.candidate.trigger_signal}
              data-row-action-type={row.candidate.action_type}
              data-row-tier={row.tier}
              data-row-eligible={row.eligible ? "true" : "false"}
              data-row-suppression-reason={row.suppression_reason ?? ""}
              data-row-promotion-dedupe-key={row.promotion_dedupe_key}
            >
              <td className="px-3 py-2 font-mono text-[11px]">
                {row.candidate.trigger_signal}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {row.candidate.action_type}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] break-all">
                {row.candidate.target_url ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">{row.tier}</td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {row.priority_score}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {row.eligible ? "✓" : "✗"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px]">
                {row.suppression_reason ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {row.promotion_dedupe_key.slice(0, 8)}…
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                {row.promotion_cooldown_key.slice(0, 8)}…
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

// Slice 4.5.D.α₁c (2026-05-20) — operator-only live-write gesture.
// Three gates govern the write: operator + env flag + confirmation
// phrase. UI renders disabled when env flag OFF; section suppressed
// when eligible_count === 0. Server action `./actions.ts` re-checks
// all three gates regardless of UI state.

type KnownActionResult =
  | {
      kind: "promoted";
      promoted_count: number;
      skipped_count: number;
      mapped_row_count: number;
      sync_warning: string | null;
    }
  | { kind: "blocked_live_write_disabled" }
  | { kind: "blocked_confirmation_missing" }
  | { kind: "blocked_no_tenant" }
  | { kind: "error"; msg: string };

function readParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const v = searchParams[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
    return v[0];
  }
  return null;
}

function parseInt0(s: string | null): number {
  if (s == null) return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseActionResult(
  searchParams: Record<string, string | string[] | undefined>,
): KnownActionResult | null {
  const raw = readParam(searchParams, "action_result");
  if (raw === "promoted") {
    return {
      kind: "promoted",
      promoted_count: parseInt0(readParam(searchParams, "promoted_count")),
      skipped_count: parseInt0(readParam(searchParams, "skipped_count")),
      mapped_row_count: parseInt0(readParam(searchParams, "mapped_row_count")),
      sync_warning: readParam(searchParams, "sync_warning"),
    };
  }
  if (raw === "blocked_live_write_disabled") {
    return { kind: "blocked_live_write_disabled" };
  }
  if (raw === "blocked_confirmation_missing") {
    return { kind: "blocked_confirmation_missing" };
  }
  if (raw === "blocked_no_tenant") {
    return { kind: "blocked_no_tenant" };
  }
  if (raw === "error") {
    return { kind: "error", msg: readParam(searchParams, "msg") ?? "" };
  }
  return null;
}

function ActionResultBanner(props: { result: KnownActionResult }) {
  const r = props.result;
  if (r.kind === "promoted") {
    return (
      <section
        className="rounded-md border border-status-success/40 bg-status-success/[0.06] px-3 py-2"
        data-diagnostic-section="action-result"
        data-action-result="promoted"
      >
        <p className="text-[12px] text-foreground">
          ✓ Promoted{" "}
          <span className="font-mono" data-result-field="promoted_count">
            {r.promoted_count}
          </span>{" "}
          rows to the customer queue. Skipped{" "}
          <span className="font-mono" data-result-field="skipped_count">
            {r.skipped_count}
          </span>
          . Mapped{" "}
          <span className="font-mono" data-result-field="mapped_row_count">
            {r.mapped_row_count}
          </span>
          .
          {r.sync_warning ? (
            <>
              {" "}
              Supabase sync warning:{" "}
              <span
                className="font-mono text-status-warning"
                data-result-field="sync_warning"
              >
                {r.sync_warning}
              </span>
              . Local rows persisted; next run retries.
            </>
          ) : null}
        </p>
      </section>
    );
  }
  const message =
    r.kind === "blocked_live_write_disabled"
      ? "Promotion blocked: live-write env flag is disabled. Set BEACON_PROMOTION_LIVE_WRITE_ENABLED=true to enable."
      : r.kind === "blocked_confirmation_missing"
        ? "Promotion blocked: confirmation phrase missing or incorrect. Type PROMOTE exactly to confirm."
        : r.kind === "blocked_no_tenant"
          ? "Promotion blocked: tenant context could not be resolved."
          : `Promotion failed: ${r.msg}`;
  return (
    <section
      className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
      data-diagnostic-section="action-result"
      data-action-result={r.kind}
    >
      <p className="text-[12px] text-foreground">{message}</p>
    </section>
  );
}

function PromoteForm(props: {
  eligibleCount: number;
  liveWriteEnabled: boolean;
}) {
  if (props.eligibleCount === 0) {
    return null;
  }
  if (!props.liveWriteEnabled) {
    return (
      <section
        className="rounded-md border border-border/40 p-3"
        data-diagnostic-section="promote-form"
        data-live-write-enabled="false"
      >
        <h2 className="text-[13px] font-semibold text-foreground">
          Promote eligible candidates to customer queue
        </h2>
        <p className="mt-1 text-[12px] text-foreground">
          Eligible to promote:{" "}
          <span className="font-mono" data-counter="promote-eligible-count">
            {props.eligibleCount}
          </span>
        </p>
        <p
          className="mt-2 text-[11px] text-status-warning"
          data-promote-disabled-caption
        >
          Live promotion DISABLED. Set
          BEACON_PROMOTION_LIVE_WRITE_ENABLED=true to enable.
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-2 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-1 text-[12px] text-muted-foreground"
          data-promote-button="disabled"
        >
          Promote {props.eligibleCount} candidates →
        </button>
      </section>
    );
  }
  return (
    <section
      className="rounded-md border border-border/40 p-3"
      data-diagnostic-section="promote-form"
      data-live-write-enabled="true"
    >
      <h2 className="text-[13px] font-semibold text-foreground">
        Promote eligible candidates to customer queue
      </h2>
      <p className="mt-1 text-[12px] text-foreground">
        Eligible to promote:{" "}
        <span className="font-mono" data-counter="promote-eligible-count">
          {props.eligibleCount}
        </span>
      </p>
      <form
        action={promoteEligibleCandidatesAction}
        className="mt-2 space-y-2"
        data-promote-form
      >
        <label className="flex flex-col text-[11px] text-foreground">
          Type PROMOTE to confirm:
          <input
            name="confirmation"
            type="text"
            autoComplete="off"
            placeholder="Type PROMOTE to confirm"
            className="mt-1 rounded-md border border-border/40 bg-surface-inset/10 px-2 py-1 font-mono text-[12px] text-foreground"
            data-promote-confirmation-input
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-1 text-[12px] text-foreground"
          data-promote-button="enabled"
        >
          Promote {props.eligibleCount} candidates →
        </button>
        <p className="text-[11px] text-status-warning">
          ⚠ This writes to the customer queue. Idempotent — safe to
          retry, but accepted rows cannot be unsent.
        </p>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Slice 4.5.E.α₁b₂-B (2026-05-21) — LLM-Draft Preview section + banner.
//
// Consumes `generateLlmDraftAction` (landed in α₁b₂-A) via Next.js
// Server Action <form action={...}> wiring. Page render NEVER invokes
// the gateway directly — only an explicit browser POST fires the
// action. Pinned by the evolved `recommendation-intelligence-llm-
// draft-gateway-render-isolation` invariant (unchanged in α₁b₂-B —
// page.tsx imports the action function reference, NOT the gateway).
// ---------------------------------------------------------------------------

type LlmDraftResult =
  | {
      kind: "drafted";
      candidate_dedupe_key: string;
      cost_usd: string;
      bundle_size: string;
      proposed_text: string;
      truncated: boolean;
    }
  | { kind: "abstained"; abstention_reason: string; cost_usd: string }
  | {
      kind: "validation_failed";
      validation_errors: string;
      cost_usd: string;
    }
  | { kind: "blocked_budget"; reason: string }
  | { kind: "blocked_env" }
  | { kind: "candidate_not_found" }
  | { kind: "invalid_candidate"; reason: string }
  | { kind: "error"; msg: string };

function parseLlmDraftResult(
  searchParams: Record<string, string | string[] | undefined>,
): LlmDraftResult | null {
  const raw = readParam(searchParams, "llm_draft_result");
  if (raw === "drafted") {
    return {
      kind: "drafted",
      candidate_dedupe_key:
        readParam(searchParams, "candidate_dedupe_key") ?? "",
      cost_usd: readParam(searchParams, "cost_usd") ?? "0",
      bundle_size: readParam(searchParams, "bundle_size") ?? "0",
      proposed_text: readParam(searchParams, "proposed_text") ?? "",
      truncated:
        readParam(searchParams, "proposed_text_truncated") === "true",
    };
  }
  if (raw === "abstained") {
    return {
      kind: "abstained",
      abstention_reason:
        readParam(searchParams, "abstention_reason") ?? "",
      cost_usd: readParam(searchParams, "cost_usd") ?? "0",
    };
  }
  if (raw === "validation_failed") {
    return {
      kind: "validation_failed",
      validation_errors:
        readParam(searchParams, "validation_errors") ?? "",
      cost_usd: readParam(searchParams, "cost_usd") ?? "0",
    };
  }
  if (raw === "blocked_budget") {
    return {
      kind: "blocked_budget",
      reason: readParam(searchParams, "reason") ?? "",
    };
  }
  if (raw === "blocked_env") return { kind: "blocked_env" };
  if (raw === "candidate_not_found") return { kind: "candidate_not_found" };
  if (raw === "invalid_candidate") {
    return {
      kind: "invalid_candidate",
      reason: readParam(searchParams, "reason") ?? "",
    };
  }
  if (raw === "error") {
    return { kind: "error", msg: readParam(searchParams, "msg") ?? "" };
  }
  return null;
}

function LlmDraftResultBanner(props: { result: LlmDraftResult }) {
  const r = props.result;
  if (r.kind === "drafted") {
    return (
      <section
        className="rounded-md border border-status-success/40 bg-status-success/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="drafted"
      >
        <p className="text-[12px] text-foreground">
          ✓ Draft generated · cost ${" "}
          <span className="font-mono" data-result-field="cost_usd">
            {r.cost_usd}
          </span>{" "}
          · bundle{" "}
          <span className="font-mono" data-result-field="bundle_size">
            {r.bundle_size}
          </span>
        </p>
        <pre
          className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border/40 bg-surface-inset/10 px-2 py-2 text-[12px] text-foreground"
          data-result-field="proposed_text"
        >
          {r.proposed_text}
        </pre>
        {r.truncated ? (
          <p
            className="mt-1 text-[11px] text-status-warning"
            data-result-field="proposed_text_truncated"
          >
            Preview truncated to 500 characters.
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Render-only · not persisted.
        </p>
      </section>
    );
  }
  if (r.kind === "abstained") {
    return (
      <section
        className="rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="abstained"
      >
        <p className="text-[12px] text-foreground">
          · Abstained:{" "}
          <span
            className="font-mono"
            data-result-field="abstention_reason"
          >
            {r.abstention_reason}
          </span>{" "}
          · cost ${" "}
          <span className="font-mono" data-result-field="cost_usd">
            {r.cost_usd}
          </span>
        </p>
      </section>
    );
  }
  if (r.kind === "validation_failed") {
    return (
      <section
        className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="validation_failed"
      >
        <p className="text-[12px] text-foreground">
          ⚠ Validation failed · cost ${" "}
          <span className="font-mono" data-result-field="cost_usd">
            {r.cost_usd}
          </span>{" "}
          ·{" "}
          <span
            className="font-mono"
            data-result-field="validation_errors"
          >
            {r.validation_errors}
          </span>
        </p>
      </section>
    );
  }
  if (r.kind === "blocked_budget") {
    return (
      <section
        className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="blocked_budget"
      >
        <p className="text-[12px] text-foreground">
          ⚠ Budget gate blocked ·{" "}
          <span className="font-mono" data-result-field="reason">
            {r.reason}
          </span>
        </p>
      </section>
    );
  }
  if (r.kind === "blocked_env") {
    return (
      <section
        className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="blocked_env"
      >
        <p className="text-[12px] text-foreground">
          LLM drafting blocked: BEACON_LLM_DRAFT_GATEWAY_ENABLED is not
          {' "true"'}.
        </p>
      </section>
    );
  }
  if (r.kind === "candidate_not_found") {
    return (
      <section
        className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="candidate_not_found"
      >
        <p className="text-[12px] text-foreground">
          Candidate not found. It may have changed between page load
          and click.
        </p>
      </section>
    );
  }
  if (r.kind === "invalid_candidate") {
    return (
      <section
        className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
        data-diagnostic-section="llm-draft-result"
        data-llm-draft-result="invalid_candidate"
      >
        <p className="text-[12px] text-foreground">
          ⚠ Candidate did not pass action gate:{" "}
          <span className="font-mono" data-result-field="reason">
            {r.reason}
          </span>
        </p>
      </section>
    );
  }
  return (
    <section
      className="rounded-md border border-status-warning/40 bg-status-warning/[0.06] px-3 py-2"
      data-diagnostic-section="llm-draft-result"
      data-llm-draft-result="error"
    >
      <p className="text-[12px] text-foreground">
        ⚠ Server action failed:{" "}
        <span className="font-mono" data-result-field="msg">
          {r.msg}
        </span>
      </p>
    </section>
  );
}

function LlmDraftPreviewSection(props: {
  rows: ReadonlyArray<RecommendationCandidateRow>;
  enabled: boolean;
}) {
  return (
    <section
      className="rounded-md border border-border/40"
      data-diagnostic-section="llm-draft-preview"
      data-row-count={props.rows.length}
      data-llm-draft-enabled={props.enabled ? "true" : "false"}
    >
      <header className="border-b border-border/40 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          LLM-Draft Preview
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Operator-only. Generate a render-only AI draft rewrite for a
          single weak-H2 diagnostic candidate. One explicit per-row
          click fires one LLM call.
        </p>
      </header>
      {props.rows.length === 0 ? (
        <p
          className="px-3 py-2 text-[12px] text-muted-foreground"
          data-diagnostic-section="llm-draft-preview-empty"
        >
          No weak-H2 diagnostic candidates available for LLM draft
          preview.
        </p>
      ) : (
        <>
          {!props.enabled ? (
            <p
              className="px-3 py-2 text-[11px] text-status-warning"
              data-llm-draft-disabled-caption
            >
              LLM drafting DISABLED. Set
              BEACON_LLM_DRAFT_GATEWAY_ENABLED=true to enable.
            </p>
          ) : null}
          <table className="w-full text-[12px] text-foreground">
            <thead className="border-b border-border/40 bg-surface-inset/10 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Action type</th>
                <th className="px-3 py-2 font-medium">Target URL</th>
                <th className="px-3 py-2 font-medium">Dedupe key</th>
                <th className="px-3 py-2 font-medium">Generate</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr
                  key={row.dedupe_key}
                  data-llm-draft-row-trigger-signal={row.trigger_signal}
                  data-llm-draft-row-action-type={row.action_type}
                  data-llm-draft-row-dedupe-key={row.dedupe_key}
                >
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {row.trigger_signal}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {row.action_type}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] break-all">
                    {row.target_url}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {row.dedupe_key.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <form
                      action={generateLlmDraftAction}
                      data-llm-draft-form
                    >
                      <input
                        type="hidden"
                        name="candidate_dedupe_key"
                        value={row.dedupe_key}
                      />
                      <button
                        type="submit"
                        disabled={!props.enabled}
                        aria-disabled={!props.enabled}
                        className={
                          props.enabled
                            ? "rounded-md border border-border/40 bg-surface-inset/10 px-3 py-1 text-[12px] text-foreground"
                            : "rounded-md border border-border/40 bg-surface-inset/20 px-3 py-1 text-[12px] text-muted-foreground"
                        }
                        data-llm-draft-button={
                          props.enabled ? "enabled" : "disabled"
                        }
                      >
                        Generate draft
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
