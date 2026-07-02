/**
 * gap-store (2026-07-01, master plan item 4) - persistence for the nightly
 * AI-engines poll: the per-night already-ran guard and the per-tenant gap
 * summary that Today's AI band and the daily candidate builder read at $0.
 *
 * Both stores are GLOBAL json-stores (rows carry tenant_id) and are
 * Supabase-mirrored so the guard + summary survive on Vercel's read-only
 * filesystem. Registered in store-classification.ts + json-store.ts.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { EngineId } from "./engine-types";
import { engineGapHeadline } from "./engine-gaps";
import { buildEngineGapNotes, type EngineGapNote } from "./candidate-feed";

const RUNS_STORE = "ai-engine-poll-runs";
const SUMMARY_STORE = "ai-engine-gap-summary";

/** A summary older than this is not shown anywhere (honest staleness). */
const SUMMARY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Keep at most this many guard rows per tenant (a rolling month). */
const RUNS_KEEP_PER_TENANT = 31;

export type EnginePollRunRow = {
  tenant_id: string;
  /** UTC night key, YYYY-MM-DD. */
  date: string;
  ran_at: string;
  engines: EngineId[];
  prompts: number;
};

export type StoredEngineGap = {
  prompt_id: string;
  prompt_text: string;
  cited_engines: EngineId[];
  missing_engines: EngineId[];
  owned_url: string | null;
};

export type StoredEngineGapSummary = {
  tenant_id: string;
  date: string;
  computed_at: string;
  engines_checked: EngineId[];
  prompts_checked: number;
  per_engine: Array<{ engine: EngineId; prompts_checked: number; cited_you: number }>;
  gaps: StoredEngineGap[];
};

// ---------------------------------------------------------------------------
// Per-night already-ran guard (idempotency)
// ---------------------------------------------------------------------------

export async function hasEnginePollRunForNight(tenantId: string, date: string): Promise<boolean> {
  try {
    const rows = await readStore<EnginePollRunRow>(RUNS_STORE, []);
    return rows.some((r) => r.tenant_id === tenantId && r.date === date);
  } catch {
    return false; // unreadable guard never blocks the poll; caps still protect spend
  }
}

export async function recordEnginePollRun(row: EnginePollRunRow): Promise<void> {
  const rows = await readStore<EnginePollRunRow>(RUNS_STORE, []);
  const kept = rows.filter((r) => !(r.tenant_id === row.tenant_id && r.date === row.date));
  const mine = kept.filter((r) => r.tenant_id === row.tenant_id);
  const others = kept.filter((r) => r.tenant_id !== row.tenant_id);
  const trimmed = [...mine, row]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-RUNS_KEEP_PER_TENANT);
  await writeStore(RUNS_STORE, [...others, ...trimmed]);
}

// ---------------------------------------------------------------------------
// Per-tenant gap summary (latest night wins)
// ---------------------------------------------------------------------------

export async function writeEngineGapSummary(summary: StoredEngineGapSummary): Promise<void> {
  const rows = await readStore<StoredEngineGapSummary>(SUMMARY_STORE, []);
  const others = rows.filter((r) => r.tenant_id !== summary.tenant_id);
  await writeStore(SUMMARY_STORE, [...others, summary]);
}

/** Latest summary for the tenant, or null when absent / older than 7 days. */
export async function readEngineGapSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<StoredEngineGapSummary | null> {
  try {
    const rows = await readStore<StoredEngineGapSummary>(SUMMARY_STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    if (now.getTime() - Date.parse(latest.computed_at) >= SUMMARY_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for build-today-preview: bounded engine-gap notes keyed by
 *  normalized page path. Empty map when no fresh summary exists. */
export async function loadEngineGapNotes(tenantId: string, now: Date = new Date()): Promise<Map<string, EngineGapNote>> {
  const summary = await readEngineGapSummary(tenantId, now);
  if (!summary) return new Map();
  return buildEngineGapNotes(
    summary.gaps.map((g) => ({
      promptText: g.prompt_text,
      citedEngines: g.cited_engines,
      missingEngines: g.missing_engines,
      ownedUrl: g.owned_url,
    })),
  );
}

/** $0 read for the Today AI band: the one honest gap line, or null when no
 *  fresh summary, fewer than 2 engines checked, or no gap exists. */
export async function loadEngineGapTodayLine(tenantId: string, now: Date = new Date()): Promise<string | null> {
  const summary = await readEngineGapSummary(tenantId, now);
  if (!summary) return null;
  const notes = await loadEngineGapNotes(tenantId, now);
  return engineGapHeadline(
    {
      enginesChecked: summary.engines_checked,
      perEngine: summary.per_engine.map((p) => ({ engine: p.engine, promptsChecked: p.prompts_checked, citedYou: p.cited_you })),
      gaps: summary.gaps.map((g) => ({
        promptId: g.prompt_id,
        promptText: g.prompt_text,
        byEngine: {},
        citedEngines: g.cited_engines,
        missingEngines: g.missing_engines,
        ownedUrl: g.owned_url,
      })),
    },
    notes.size,
  );
}
