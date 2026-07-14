import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

/**
 * warm-receipt-store (2026-07-02, BEACON 500 item 13) - persistence for the
 * nightly precompute warm pass: the per-day run marker (idempotency: a
 * double-fired cron is a cheap no-op) plus the last receipts /diagnostics
 * reads ("we warmed the morning views at 5:04am, all steps ok").
 *
 * GLOBAL json-store (rows carry tenant_id), mirrored to Supabase - exactly
 * the ai-engine-poll-runs posture: the cron fans out across tenants with no
 * request context (per-tenant path routing would misfile the rows), and a
 * Vercel lambda would otherwise forget the marker between invocations.
 * Registered in store-classification.ts + json-store.ts.
 */

const STORE = "precompute-warm-receipts";

/** Keep at most this many receipts per tenant (cron + visit receipts for two weeks). */
const KEEP_PER_TENANT = 28;

export type WarmRunSummary = {
  dataForSeoStatus: "live" | "dry_run" | "disabled";
  aiEnginePollStatus?: "ok" | "already_ran" | "no_prompts" | "error" | "not_run";
  competitorPagesAnalyzed: number;
  competitorPagesRefreshed: number;
  competitorsMined: number;
  keywordGapsFound: number;
  cloneBriefsBuilt: number;
  keywordTermsPlanned: number;
  serpPatternsWritten: number;
  aiTopicsPolled: number;
  aiCitationRecords: number;
  aiEnginePrompts: number;
  aiEnginesChecked: number;
  aiObservationsWritten: number;
  aiCitationGaps: number;
  questionsRanked: number;
  uncoveredQuestions: number;
  claimsChecked: number;
  conflictingClaims: number;
  pagesMapped: number;
  orphanPagesFound: number;
  beatenKeywords: number;
  stealBriefsBuilt: number;
  nativePromptsAnalyzed: number;
  citedPagesAnalyzed: number;
  /** Same-cycle Google research over the exact final Changes order. */
  finalSerpQueriesChecked?: number;
  finalSerpWinnersAnalyzed?: number;
  finalKeywordTermsChecked?: number;
  movesPrepared: number;
  readyToReview: number;
  draftsRegenerated: number;
  spendUsd: number;
};

export type WarmStepReceipt = {
  name: string;
  ok: boolean;
  ms: number;
  /** True when the step decided there was nothing to do (still ok). */
  skipped?: boolean;
  /** Plain note: why skipped / what failed (bounded upstream). */
  note?: string;
};

export type WarmRunReceipt = {
  tenant_id: string;
  /** Pacific day key, YYYY-MM-DD - the idempotency unit. */
  date: string;
  ran_at: string;
  /** True only when every step succeeded (skips count as ok). */
  ok: boolean;
  totalMs: number;
  steps: WarmStepReceipt[];
  /** Cron and on-visit receipts coexist for the same day. Legacy rows omit it. */
  trigger?: "cron" | "visit" | "manual";
  /** Structured autonomous-research outcome used by the customer-facing status line. */
  summary?: WarmRunSummary;
};

/**
 * Has a SUCCESSFUL warm pass already completed for this tenant + Pacific day?
 * A failed attempt does not count - a re-fire may fix the missed step, and the
 * whole pass is $0/idempotent so a retry can only help.
 */
export async function hasWarmRunForDay(tenantId: string, date: string): Promise<boolean> {
  try {
    const rows = await readStore<WarmRunReceipt>(STORE, []);
    return rows.some((r) => r.tenant_id === tenantId && r.date === date && r.ok);
  } catch {
    return false; // an unreadable marker never blocks the warm pass
  }
}

/** Record a warm pass (latest attempt per day wins; bounded per tenant). */
export async function recordWarmRun(receipt: WarmRunReceipt): Promise<void> {
  const rows = await readStore<WarmRunReceipt>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== receipt.tenant_id);
  const mine = rows
    .filter(
      (r) =>
        r.tenant_id === receipt.tenant_id &&
        !(r.date === receipt.date && (r.trigger ?? "cron") === (receipt.trigger ?? "cron")),
    )
    .concat(receipt)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-KEEP_PER_TENANT);
  await writeStore(STORE, [...others, ...mine]);
}

/** Latest receipt for the tenant (the /diagnostics line), or null. */
export async function readLastWarmReceipt(
  tenantId: string,
  trigger?: WarmRunReceipt["trigger"],
): Promise<WarmRunReceipt | null> {
  try {
    const rows = await readStore<WarmRunReceipt>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId && (trigger == null || (r.trigger ?? "cron") === trigger))
      .sort((a, b) => b.ran_at.localeCompare(a.ran_at));
    return mine[0] ?? null;
  } catch {
    return null;
  }
}
