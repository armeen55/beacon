import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { mineAnswerPatterns, type PatternProfile } from "@/domains/citability/mine-answer-patterns";
import {
  scanAnswerDrift,
  type DriftEventWithMatch,
  type TenantDriftCoverage,
} from "./answer-drift-loader";
import {
  loadSecondOrderCitationPlaybookForTenant,
  type SecondOrderDomainPlaybook,
} from "./second-order-citations";

const STORE = "citation-intelligence-snapshot";
const MAX_DRIFT_EVENTS = 20;
const MAX_SECOND_ORDER_DOMAINS = 20;

export type CitationIntelligenceSnapshot = {
  tenantId: string;
  computedAt: string;
  patterns: PatternProfile;
  drift: {
    events: DriftEventWithMatch[];
    coverage: TenantDriftCoverage;
  };
  secondOrder: {
    domains: SecondOrderDomainPlaybook[];
    rowsScanned: number;
  };
};

export type CitationIntelligenceRefreshResult = {
  snapshot: CitationIntelligenceSnapshot;
  patternsMined: number;
  driftEvents: number;
  secondOrderDomains: number;
};

type RefreshDeps = {
  minePatterns: typeof mineAnswerPatterns;
  scanDrift: typeof scanAnswerDrift;
  loadSecondOrder: typeof loadSecondOrderCitationPlaybookForTenant;
  writeSnapshot: (tenantId: string, snapshot: CitationIntelligenceSnapshot) => Promise<void>;
};

const defaultDeps: RefreshDeps = {
  minePatterns: mineAnswerPatterns,
  scanDrift: scanAnswerDrift,
  loadSecondOrder: loadSecondOrderCitationPlaybookForTenant,
  writeSnapshot: async (tenantId, snapshot) => {
    await writeStore<CitationIntelligenceSnapshot>(STORE, [snapshot], { tenantId });
  },
};

/**
 * Compute the expensive tenant-wide citation intelligence once inside the
 * visit-driven research cycle, then persist a compact customer-safe snapshot.
 * All inputs are existing data; this performs no paid API call and sends no
 * outreach. Individual readers fail soft so one missing table does not erase
 * the other two intelligence families.
 */
export async function refreshCitationIntelligenceForTenant(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<RefreshDeps> = {},
): Promise<CitationIntelligenceRefreshResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const [patterns, drift, secondOrder] = await Promise.all([
    deps.minePatterns(tenantId, now),
    deps.scanDrift(tenantId, now),
    deps.loadSecondOrder(tenantId),
  ]);
  const snapshot: CitationIntelligenceSnapshot = {
    tenantId,
    computedAt: now.toISOString(),
    patterns,
    drift: {
      events: drift.events.slice(0, MAX_DRIFT_EVENTS),
      coverage: drift.coverage,
    },
    secondOrder: {
      domains: secondOrder.domains.slice(0, MAX_SECOND_ORDER_DOMAINS),
      rowsScanned: secondOrder.rowsScanned,
    },
  };
  await deps.writeSnapshot(tenantId, snapshot);
  return {
    snapshot,
    patternsMined: patterns.sentencesClassified,
    driftEvents: snapshot.drift.events.length,
    secondOrderDomains: snapshot.secondOrder.domains.length,
  };
}

export async function readCitationIntelligenceForTenant(
  tenantId: string,
): Promise<CitationIntelligenceSnapshot | null> {
  if (!tenantId) return null;
  const rows = await readStore<CitationIntelligenceSnapshot>(STORE, [], { tenantId }).catch(() => []);
  return rows.find((row) => row.tenantId === tenantId) ?? null;
}
