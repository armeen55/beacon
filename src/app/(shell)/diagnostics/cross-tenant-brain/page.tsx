/**
 * Operator Cross-Tenant Brain Surface — Phase A.2 (Section 3.10 / E9).
 *
 * DISTINCT from `/diagnostics/brain` (which is the tenant-LOCAL Brain
 * Readiness Grade — T7.6). This page surfaces the CROSS-TENANT brain:
 *   - the two env gates (producer + customer tile),
 *   - the sample-size trust thresholds (E3: 5 / 10 / 20),
 *   - the LIVE per-tenant threshold decision (S1) — borrowed Profound
 *     defaults vs Beacon-owned medians, with sample + excluded counts,
 *   - the cross-tenant producer state (stub `[]` at n=1; the producer
 *     excludes self-data, so a single-tenant install has nothing to
 *     aggregate).
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s otherwise.
 * Pure read. No paid APIs. No mutations. No LLM. Resilient — a failed
 * data read renders an empty state, never crashes the build.
 *
 * Pinned by tests/app/diagnostics/cross-tenant-brain-page.test.tsx.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import {
  isCrossTenantProducerEnabled,
  isBrainLearnedTileEnabled,
} from "@/domains/recommendations/cross-tenant-brain/config";
import { BRAIN_SAMPLE_THRESHOLDS } from "@/domains/recommendations/cross-tenant-brain/thresholds";
import { getCrossTenantPatterns } from "@/domains/recommendations/cross-tenant-brain";

export const dynamic = "force-dynamic";

type ThresholdDecisionView = {
  source: string;
  fast_days: number;
  median_days: number;
  late_days: number;
  sample_size: number;
  excluded_count: number;
} | null;

/**
 * Resolve the live per-tenant threshold decision via the lifecycle
 * summary loader. Fully defensive: any failure (no tenant, read error,
 * empty data) yields null → empty state.
 */
async function loadThresholdDecisionView(): Promise<ThresholdDecisionView> {
  try {
    const { currentTenantId } = await import("@/lib/tenant-context");
    const { loadLifecycleSummaryForTenant } = await import(
      "@/domains/citation-lifecycle/load-lifecycle"
    );
    const tenantId = await currentTenantId();
    const now = new Date();
    const summary = await loadLifecycleSummaryForTenant({
      tenantId,
      now,
      windowDays: 180,
    });
    const d = summary?.threshold_decision;
    if (!d) return null;
    return {
      source: d.source,
      fast_days: d.thresholds.fast_days,
      median_days: d.thresholds.median_days,
      late_days: d.thresholds.late_days,
      sample_size: d.sample_size,
      excluded_count: d.excluded_count,
    };
  } catch {
    return null;
  }
}

function Pill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
        on
          ? "bg-status-success/15 text-status-success border-status-success/30"
          : "bg-surface-inset/60 text-muted-foreground border-border/40"
      }`}
    >
      {label}: {on ? "ON" : "OFF"}
    </span>
  );
}

export default async function CrossTenantBrainPage() {
  if (!isOperatorModeServer()) {
    notFound();
  }

  const producerEnabled = isCrossTenantProducerEnabled();
  const tileEnabled = isBrainLearnedTileEnabled();
  const decision = await loadThresholdDecisionView();

  // Producer state: at n=1 (or gate off) this is []. Showing it makes
  // the "why empty" honest for the operator.
  let producerPatternCount = 0;
  let producerError = false;
  try {
    producerPatternCount = getCrossTenantPatterns({
      tenantId: "__operator_probe__",
      actionTypes: [],
      clusterKind: null,
      clusterLabel: null,
    }).length;
  } catch {
    producerError = true;
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Cross-Tenant Brain"
        description="Cross-tenant / threshold / pattern intelligence. Distinct from /diagnostics/brain (tenant-local readiness). Operator-mode only."
      />

      {/* Disambiguation note (E9 lock) */}
      <section className="rounded-lg border border-accent-primary/30 bg-accent-primary/10 p-3 text-xs text-muted-foreground">
        This is the <span className="font-semibold">cross-tenant</span>{" "}
        brain surface (threshold replacement + cross-tenant patterns). For
        the tenant-local Brain Readiness Grade, see{" "}
        <Link href="/diagnostics/brain" className="text-accent-primary underline">
          /diagnostics/brain
        </Link>
        .
      </section>

      {/* Section 1 — Gates */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Activation gates
        </h2>
        <div className="flex flex-wrap gap-2">
          <Pill on={producerEnabled} label="BEACON_CROSS_TENANT_BRAIN" />
          <Pill on={tileEnabled} label="BEACON_BRAIN_LEARNED_TILE" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Producer computes cross-tenant patterns only when the first gate
          is ON. The customer &ldquo;Beacon learned&rdquo; tile renders only
          when the second is ON. Both default OFF.
        </p>
      </section>

      {/* Section 2 — Sample-size trust thresholds (E3) */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Sample-size trust thresholds (v1, tunable)
        </h2>
        <ul className="space-y-1 text-sm">
          <li>
            <span className="font-mono">{BRAIN_SAMPLE_THRESHOLDS.llm_packet}</span>{" "}
            — minimum ships for a pattern to reach the LLM packet / operator use
          </li>
          <li>
            <span className="font-mono">{BRAIN_SAMPLE_THRESHOLDS.customer_tile}</span>{" "}
            — minimum for the customer-facing tile
          </li>
          <li>
            <span className="font-mono">{BRAIN_SAMPLE_THRESHOLDS.threshold_replacement}</span>{" "}
            — per-tenant ship count to replace borrowed thresholds with Beacon-owned
          </li>
        </ul>
      </section>

      {/* Section 3 — Live per-tenant threshold decision (S1) */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Per-tenant threshold decision (live)
        </h2>
        {decision ? (
          <>
            <div className="mb-2 flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                  decision.source === "per_tenant"
                    ? "bg-status-success/15 text-status-success border-status-success/30"
                    : "bg-accent-primary/15 text-accent-primary border-accent-primary/30"
                }`}
              >
                {decision.source === "per_tenant"
                  ? "Beacon-owned"
                  : "borrowed defaults"}
              </span>
              <span className="text-sm">
                fast {decision.fast_days}d · typical {decision.median_days}d ·
                late {decision.late_days}d
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              cited-edit sample: <span className="font-mono">{decision.sample_size}</span>{" "}
              · excluded (uncited/stuck): <span className="font-mono">{decision.excluded_count}</span>{" "}
              · replacement gate:{" "}
              <span className="font-mono">{BRAIN_SAMPLE_THRESHOLDS.threshold_replacement}</span>
            </p>
            {decision.source !== "per_tenant" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Below the replacement gate — serving borrowed Profound
                starter benchmarks until enough cited shipped edits
                accumulate.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No threshold decision available (no eligible lifecycle data for
            the active tenant yet, or read unavailable).
          </p>
        )}
      </section>

      {/* Section 4 — Cross-tenant producer state */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Cross-tenant producer
        </h2>
        {producerError ? (
          <p className="text-sm text-status-warning">
            Producer probe errored (rendered defensively).
          </p>
        ) : (
          <p className="text-sm">
            Patterns currently emitted:{" "}
            <span className="font-mono">{producerPatternCount}</span>
            {producerPatternCount === 0 && (
              <span className="text-muted-foreground">
                {" "}
                — expected while single-tenant (the producer excludes the
                requesting tenant&rsquo;s own data) and/or the gate is off.
              </span>
            )}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Compute layer ready: privacy scrubber + aggregation core are
          built &amp; tested. Activation (enumerate tenants → read → aggregate
          → packet) lands as a dedicated gated slice.
        </p>
      </section>
    </div>
  );
}
