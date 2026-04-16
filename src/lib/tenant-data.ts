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

export function getResultsForTenant(tenantId: string): Result[] {
  return filterByTenant(readStore<Result>("imported-results"), tenantId);
}

export function getChangesForTenant(tenantId: string): ChangelogEntry[] {
  return filterByTenant(
    readStore<ChangelogEntry>("imported-changes"),
    tenantId,
  );
}

export function getOpportunitiesForTenant(tenantId: string): Opportunity[] {
  return filterByTenant(
    readStore<Opportunity>("imported-opportunities"),
    tenantId,
  );
}

export function getCompetitorsForTenant(tenantId: string): Competitor[] {
  return filterByTenant(
    readStore<Competitor>("imported-competitors"),
    tenantId,
  );
}

export function getImportRunsForTenant(tenantId: string): ImportRun[] {
  return filterByTenant(readStore<ImportRun>("import-runs"), tenantId);
}

export function getFindingsForTenant(tenantId: string): Finding[] {
  return filterByTenant(readStore<Finding>("scan-findings"), tenantId);
}

export function getPagesForTenant(tenantId: string): PageEntity[] {
  return filterByTenant(readStore<PageEntity>("pages"), tenantId);
}

export function getPageSnapshotsForTenant(tenantId: string): PageSnapshot[] {
  return filterByTenant(
    readStore<PageSnapshot>("page-snapshots"),
    tenantId,
  );
}

export function getObservationRunsForTenant(
  tenantId: string,
): ObservationRun[] {
  return filterByTenant(
    readStore<ObservationRun>("observation-runs"),
    tenantId,
  );
}

export function getSnapshotsForTenant(
  tenantId: string,
): DailyMetricSnapshot[] {
  return filterByTenant(
    readStore<DailyMetricSnapshot>("daily-metric-snapshots"),
    tenantId,
  );
}

export function getOutcomesForTenant(tenantId: string): ChangeOutcome[] {
  return filterByTenant(
    readStore<ChangeOutcome>("change-outcomes"),
    tenantId,
  );
}

export function getChangeContractsForTenant(
  tenantId: string,
): ChangeContract[] {
  return filterByTenant(
    readStore<ChangeContract>("change-contracts"),
    tenantId,
  );
}

export function getGuardrailsForTenant(tenantId: string): GuardrailAlert[] {
  return filterByTenant(
    readStore<GuardrailAlert>("page-guardrails"),
    tenantId,
  );
}

export function getEventDecisionsForTenant(
  tenantId: string,
): EventDecision[] {
  return filterByTenant(
    readStore<EventDecision>("event-decisions"),
    tenantId,
  );
}

export function getCandidateLinksForTenant(
  tenantId: string,
): CandidateLink[] {
  return filterByTenant(
    readStore<CandidateLink>("candidate-links"),
    tenantId,
  );
}
