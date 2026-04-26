/**
 * Tenant-filtered data adapters — the isolation boundary.
 *
 * Every route and domain module that reads persisted data MUST go through
 * these adapters instead of calling readStore or seed-data.server.ts
 * directly. Each adapter filters by tenant_id so cross-tenant data never
 * leaks to a consumer.
 *
 * For v1 beta (3 customers), all tenant data lives in the same .data/*.json
 * files and filtering happens in memory. This is fine for <100K records.
 * If Beacon scales beyond ~20 tenants, the filtering should move to
 * Supabase RLS or per-tenant file isolation.
 *
 * Global/aggregate stores (change-patterns, triage-rules, etc.) are NOT
 * exposed here — they have no tenant_id by design. Import them directly
 * from their domain modules.
 *
 * Sprint 7 Phase 7.8b-2-c (2026-04-25): each adapter is async because
 * `readStore` is async (Phase 7.8b-2-b). Filtering still happens
 * synchronously in memory after the routed-or-flat-fallback read
 * resolves.
 */

import "server-only";

import { readStore } from "@/lib/persistence/json-store";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { Finding } from "@/domains/scanning/types";
import type { PageEntity, PageSnapshot } from "@/domains/pages/types";
import type { ObservationRun } from "@/domains/observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";

// ---------------------------------------------------------------------------
// Generic filter
// ---------------------------------------------------------------------------

function filterByTenant<T extends { tenant_id: string }>(
  items: T[],
  tenantId: string,
): T[] {
  return items.filter((item) => item.tenant_id === tenantId);
}

// ---------------------------------------------------------------------------
// Per-entity adapters
// ---------------------------------------------------------------------------

export async function getResultsForTenant(tenantId: string): Promise<Result[]> {
  return filterByTenant(await readStore<Result>("imported-results"), tenantId);
}

export async function getChangesForTenant(
  tenantId: string,
): Promise<ChangelogEntry[]> {
  return filterByTenant(
    await readStore<ChangelogEntry>("imported-changes"),
    tenantId,
  );
}

export async function getOpportunitiesForTenant(
  tenantId: string,
): Promise<Opportunity[]> {
  return filterByTenant(
    await readStore<Opportunity>("imported-opportunities"),
    tenantId,
  );
}

export async function getCompetitorsForTenant(
  tenantId: string,
): Promise<Competitor[]> {
  return filterByTenant(
    await readStore<Competitor>("imported-competitors"),
    tenantId,
  );
}

export async function getImportRunsForTenant(
  tenantId: string,
): Promise<ImportRun[]> {
  return filterByTenant(await readStore<ImportRun>("import-runs"), tenantId);
}

export async function getFindingsForTenant(
  tenantId: string,
): Promise<Finding[]> {
  return filterByTenant(await readStore<Finding>("scan-findings"), tenantId);
}

export async function getPagesForTenant(
  tenantId: string,
): Promise<PageEntity[]> {
  return filterByTenant(await readStore<PageEntity>("pages"), tenantId);
}

export async function getPageSnapshotsForTenant(
  tenantId: string,
): Promise<PageSnapshot[]> {
  return filterByTenant(
    await readStore<PageSnapshot>("page-snapshots"),
    tenantId,
  );
}

export async function getObservationRunsForTenant(
  tenantId: string,
): Promise<ObservationRun[]> {
  return filterByTenant(
    await readStore<ObservationRun>("observation-runs"),
    tenantId,
  );
}

export async function getSnapshotsForTenant(
  tenantId: string,
): Promise<DailyMetricSnapshot[]> {
  return filterByTenant(
    await readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
    tenantId,
  );
}

export async function getOutcomesForTenant(
  tenantId: string,
): Promise<ChangeOutcome[]> {
  return filterByTenant(
    await readStore<ChangeOutcome>("change-outcomes"),
    tenantId,
  );
}

export async function getChangeContractsForTenant(
  tenantId: string,
): Promise<ChangeContract[]> {
  return filterByTenant(
    await readStore<ChangeContract>("change-contracts"),
    tenantId,
  );
}

export async function getGuardrailsForTenant(
  tenantId: string,
): Promise<GuardrailAlert[]> {
  return filterByTenant(
    await readStore<GuardrailAlert>("page-guardrails"),
    tenantId,
  );
}

export async function getEventDecisionsForTenant(
  tenantId: string,
): Promise<EventDecision[]> {
  return filterByTenant(
    await readStore<EventDecision>("event-decisions"),
    tenantId,
  );
}

export async function getCandidateLinksForTenant(
  tenantId: string,
): Promise<CandidateLink[]> {
  return filterByTenant(
    await readStore<CandidateLink>("candidate-links"),
    tenantId,
  );
}
