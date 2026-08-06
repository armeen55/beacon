import "server-only";

/**
 * tracked-questions - THE one owner of WHICH questions this account tracks and WHICH SERIES each one is on.
 * It lives in Account because a tracked question is account data: Settings and onboarding are what create,
 * reword, retire and revive it, and every other kernel only reads it. It used to sit inside Runtime, so
 * Evidence had to reach UP into the orchestrator (through a lazy dynamic import, to dodge the cycle) to learn
 * its own scope. Account is the lowest kernel, so that edge is now a plain static import in the legal
 * direction and there is still EXACTLY ONE definition of active, core and current-version anywhere.
 *
 * `runtime/prompt-set.ts` re-exports everything below unchanged, so every existing caller keeps working and
 * the save side (which owns wording, tags and the lifecycle) stays where it is.
 */

export type TrackedPromptRow = {
  id: string; tenant_id: string; account_id: string; text: string;
  topic_id: string | null; location_scope: string | null; service_scope: string | null;
  intent_type: string; platforms: string[]; tags: string[]; is_active: boolean;
  /** Measurement series number (migration 2026-07-31). Always >= 1. */
  version: number;
  /** True only for the operator's approved set; mirrors the core_v1 tag. */
  core: boolean;
  created_at: string; updated_at: string;
};

/** Tags + limits that define the core-question lifecycle (one export each, bundled). */
export const PROMPT_TAGS = { candidate: "candidate_v1", set: "set_v1", recommended: "recommended", core: "core_v1", edited: "edited", added: "added" } as const;
export const LIMITS = {
  recommendedTarget: 50, minActive: 10, maxActive: 100,
  /** Setup speaks Product Truth's own window: 20 to 50 approved questions. The floor bends to a thin
   *  candidate pool (never below minActive) so a sparse profile can still finish setup honestly, and a
   *  live account editing in Settings keeps the wider 10 to 100 range above. */
  onboardingMin: 20, onboardingMax: 50,
};

/** One approved question as the daily planner reads it: which series it is on
 *  (version) and when it first appeared (the oldest-first tiebreak). */
export type TrackedQuestion = { id: string; text: string; version: number; core: boolean; createdAt: string };

/** A row written before the version column existed reads as series 1. THE one version rule. */
export const versionOf = (r: { version?: number | null }): number =>
  Number.isFinite(r.version) && (r.version as number) >= 1 ? Math.trunc(r.version as number) : 1;

/** BASIS-AGNOSTIC projection: exactly the rows the research funnel is handed (active + core-tagged,
 *  created_at then id, capped at 100), so the list the operator reads and the list I check can never
 *  disagree. THE activation predicate: nothing anywhere else may decide what "tracked right now" means. */
export function projectTrackedQuestions(rows: readonly TrackedPromptRow[]): { active: TrackedQuestion[]; count: number } {
  const active = rows
    .filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core) && Boolean(r.id) && Boolean(r.text))
    .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : String(a.created_at).localeCompare(String(b.created_at))))
    .slice(0, LIMITS.maxActive)
    .map((r) => ({ id: r.id, text: r.text, version: versionOf(r), core: true, createdAt: String(r.created_at ?? "") }));
  return { active, count: active.length };
}

/** A genuinely MISSING COLUMN, and nothing else. On any other error the retry below would read live rows as
 *  series 1 and mint a duplicate same-day identity under a different version, so every other error travels. */
const columnMissing = (e: { code?: string; message?: string } | null | undefined): boolean => {
  const code = String(e?.code ?? ""), message = String(e?.message ?? "").toLowerCase();
  return code === "42703" || message.includes("42703") || (message.includes("column") && message.includes("does not exist"));
};

/**
 * THE canonical read: the approved questions with the series each one is currently on. Same predicate and
 * same ordering as the funnel, so what the operator sees listed, what I check, and what I chart can never
 * disagree. `null` means the READ FAILED; a caller must not treat that as "no questions".
 * The retry without version/core covers the window between a deploy and its migration: those rows read as
 * series 1 and core-by-tag, which is exactly what the migration's own defaults and backfill would have
 * written. Fail-soft on a thrown read: null, never a silent empty set.
 */
export async function readActiveTrackedPrompts(tenantId: string): Promise<TrackedQuestion[] | null> {
  const run = async (cols: string) => {
    const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
    return admin
      .from("tracked_prompts")
      .select(cols)
      .eq("tenant_id", tenantId).eq("is_active", true).contains("tags", JSON.stringify([PROMPT_TAGS.core]))
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(LIMITS.maxActive);
  };
  try {
    let res = await run("id,text,tags,is_active,created_at,version,core");
    if (res.error && columnMissing(res.error)) res = await run("id,text,tags,is_active,created_at");
    if (res.error) return null;
    return projectTrackedQuestions((res.data ?? []) as unknown as TrackedPromptRow[]).active;
  } catch {
    return null;
  }
}
