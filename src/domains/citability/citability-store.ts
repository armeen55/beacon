/**
 * citability-store (2026-07-02, master plan item 26) - persistence for the
 * mined citation-pattern profile, so the daily card and the citability lever
 * read what AI actually quotes in this tenant's space at $0 instead of
 * re-mining prompt_answer_observations on every request.
 *
 * Follows the seasonal-store / spike-store sibling pattern exactly: a GLOBAL
 * json-store (rows carry tenant_id, since a future nightly pass would fan out
 * across tenants with no ambient request context) that is Supabase-mirrored
 * so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PatternProfile } from "./mine-answer-patterns";

const STORE = "citability-pattern-profile";

/** A mined profile older than this is not shown anywhere (the tenant's real
 *  citation mix drifts slowly, but a stale claim should not linger forever). */
const PROFILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Persist the latest mined pattern profile for a tenant (latest wins; other
 *  tenants untouched). An EMPTY profile is written too: "mined, found nothing
 *  yet" is a different truth from "never mined". */
export async function writePatternProfile(profile: PatternProfile): Promise<void> {
  const rows = await readStore<PatternProfile>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== profile.tenant_id);
  await writeStore(STORE, [...others, profile]);
}

/** Latest mined profile for the tenant, or null when absent / older than 30
 *  days. Fail-soft -> null. */
export async function readPatternProfile(
  tenantId: string,
  now: Date = new Date(),
): Promise<PatternProfile | null> {
  try {
    const rows = await readStore<PatternProfile>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= PROFILE_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
