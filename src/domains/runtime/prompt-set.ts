import "server-only";

/**
 * prompt-set - THE one owner of the tracked-question set: the id and normalize rules, the tag and count vocabulary, the projection
 * every surface reads, and the pure declarative save an ACTIVE account drives from Settings. onboarding-store imports its helpers
 * from here and the research funnel reads the SAME tag constant, so what the operator sees listed is exactly what research checks.
 *
 * IDENTITY RULE (PRODUCT_TRUTH question stability): unchanged wording KEEPS its row id, so its measurement history survives every
 * save. Only NEW wording mints a new id, and a reworded question keeps its ancestry through a "superseded:<oldRowId>" tag while the
 * old row stays as inactive history. A row WITHOUT the core tag is never touched: legacy seed rows are somebody else's history.
 *
 * VERSION RULE: a tracked question is a measurement series, and `version` is which series an observation belongs to. Any wording
 * edit, any change to the engines a question is asked on, and any add or revival starts a NEW series, so it bumps the version and
 * the daily planner treats (prompt id, version, engine, day) as a fresh identity from that day on. Nothing is backfilled across the
 * seam: the old series keeps its rows and the trend line BREAKS where the question changed rather than bending through a
 * discontinuity nobody can see. Dropping a question does NOT bump (it just stops); bringing it back does, because the gap is real.
 */

import { createHash } from "node:crypto";
import { ALL_ENGINES } from "@/domains/evidence/readers/engine-types";

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

export function normalizePromptText(text: string): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
const sha16 = (input: string): string => createHash("sha256").update(input).digest("hex").slice(0, 16);

/** Row id keyed by (tenant, basis, normalized text): the SAME wording under the
 *  SAME basis always resolves to the SAME row, which is what preserves history. */
export function promptIdFor(tenantId: string, basis: string, text: string): string {
  return "prompt-" + sha16(`${tenantId}|${basis}|${normalizePromptText(text)}`);
}

/** BASIS-AGNOSTIC projection: exactly the rows defaultActivePrompts hands the
 *  research funnel (active + core-tagged, created_at then id, capped at 100), so
 *  the list the operator reads and the list I check can never disagree. */
export function projectTrackedQuestions(rows: readonly TrackedPromptRow[]): { active: TrackedQuestion[]; count: number } {
  const active = rows
    .filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core) && Boolean(r.id) && Boolean(r.text))
    .sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : String(a.created_at).localeCompare(String(b.created_at))))
    .slice(0, LIMITS.maxActive)
    .map((r) => ({ id: r.id, text: r.text, version: versionOf(r), core: true, createdAt: String(r.created_at ?? "") }));
  return { active, count: active.length };
}

/** One approved question as the daily planner reads it: which series it is on
 *  (version) and when it first appeared (the oldest-first tiebreak). */
export type TrackedQuestion = { id: string; text: string; version: number; core: boolean; createdAt: string };

/** A row written before the version column existed reads as series 1. */
const versionOf = (r: { version?: number | null }): number =>
  Number.isFinite(r.version) && (r.version as number) >= 1 ? Math.trunc(r.version as number) : 1;

/** Does this save start a NEW measurement series for a row that already exists?
 *  Changed wording, a changed engine set, or a revival from inactive all do; an
 *  untouched keep does not. A brand new id starts at series 1. */
function nextVersion(existing: TrackedPromptRow | undefined, text: string, platforms: readonly string[]): number {
  if (!existing) return 1;
  const current = versionOf(existing);
  const reworded = normalizePromptText(existing.text) !== normalizePromptText(text);
  const enginesChanged = [...(existing.platforms ?? [])].sort().join("|") !== [...platforms].sort().join("|");
  return reworded || enginesChanged || existing.is_active === false ? current + 1 : current;
}

type TrackedSelection = { keepIds: string[]; edits: { id: string; newText: string }[]; additions: string[] };
type TrackedCtx = { tenantId: string; basis: string; nowIso: string };
type TrackedOutcome =
  | { ok: true; writes: TrackedPromptRow[]; activeCount: number; added: number; skippedDuplicates: number; skippedBlank: number }
  | { ok: false; error: string };

/** Mint (or revive) the current-basis row for one wording, carrying an existing
 *  row's tags/topic forward so a saved question never loses what it already was. */
function mintRow(existing: TrackedPromptRow | undefined, source: TrackedPromptRow | null, id: string, text: string, ctx: TrackedCtx, kindTags: string[]): TrackedPromptRow {
  const platforms = [...ALL_ENGINES];
  return {
    id, tenant_id: ctx.tenantId, account_id: ctx.tenantId, text: text.trim(),
    topic_id: existing?.topic_id ?? source?.topic_id ?? null, location_scope: null, service_scope: null,
    intent_type: existing?.intent_type ?? source?.intent_type ?? "category",
    platforms,
    tags: [...new Set([...(existing?.tags ?? []), PROMPT_TAGS.core, ...kindTags, ctx.basis])],
    is_active: true,
    // A reused id whose wording, engines, or active life changed starts a new
    // measurement series; the planner then asks it as a fresh identity tomorrow.
    version: nextVersion(existing, text, platforms),
    core: true,
    created_at: existing?.created_at ?? ctx.nowIso,
    updated_at: ctx.nowIso,
  };
}

/**
 * PURE. Turn one operator selection into the exact rows to upsert. Kept wording
 * keeps its id and is not rewritten; changed wording retires its old row and
 * mints a superseded-tagged successor; anything dropped goes inactive. Blank
 * lines and repeats are reported back so the screen can say what it skipped.
 */
export function applyTrackedSelection(rows: readonly TrackedPromptRow[], input: TrackedSelection, ctx: TrackedCtx): TrackedOutcome {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const coreRows = rows.filter((r) => r.tags?.includes(PROMPT_TAGS.core));
  const writes = new Map<string, TrackedPromptRow>();
  const seen = new Set<string>();
  const active = new Set<string>();
  let added = 0, skippedDuplicates = 0, skippedBlank = 0;
  const keep = new Set(input.keepIds ?? []);
  const edited = new Set((input.edits ?? []).map((e) => e.id));

  const hold = (r: TrackedPromptRow) => {
    active.add(r.id);
    // A revival is a real gap in the series, so it starts a new one. An
    // already-active keep is untouched: same id, same version, same history.
    if (!r.is_active) writes.set(r.id, { ...r, is_active: true, core: true, version: versionOf(r) + 1, updated_at: ctx.nowIso });
  };
  // 1. Kept wording: SAME row, SAME id, untouched. This is the continuity rule.
  for (const r of coreRows) {
    if (!keep.has(r.id) || edited.has(r.id)) continue;
    const norm = normalizePromptText(r.text);
    if (!norm) { skippedBlank += 1; continue; }
    if (seen.has(norm)) { skippedDuplicates += 1; continue; }
    seen.add(norm); hold(r);
  }
  // 2. Edits: a real rewording starts a new measurement history and names its ancestor.
  for (const e of input.edits ?? []) {
    const src = byId.get(e.id);
    if (!src || !src.tags?.includes(PROMPT_TAGS.core)) continue;
    const norm = normalizePromptText(e.newText);
    if (!norm) { skippedBlank += 1; continue; }
    if (seen.has(norm)) { skippedDuplicates += 1; continue; }
    seen.add(norm);
    if (norm === normalizePromptText(src.text)) { hold(src); continue; }
    const id = promptIdFor(ctx.tenantId, ctx.basis, norm);
    writes.set(src.id, { ...src, is_active: false, core: true, version: versionOf(src), updated_at: ctx.nowIso });
    writes.set(id, mintRow(byId.get(id), src, id, e.newText, ctx, [PROMPT_TAGS.edited, `superseded:${src.id}`]));
    active.add(id);
  }
  // 3. Additions.
  for (const text of input.additions ?? []) {
    const norm = normalizePromptText(text);
    if (!norm) { skippedBlank += 1; continue; }
    if (seen.has(norm)) { skippedDuplicates += 1; continue; }
    seen.add(norm);
    const id = promptIdFor(ctx.tenantId, ctx.basis, norm);
    writes.set(id, mintRow(byId.get(id), null, id, text, ctx, [PROMPT_TAGS.added]));
    active.add(id); added += 1;
  }
  // 4. Anything this selection dropped stops being tracked. Rows without the core
  //    tag are never in coreRows, so a legacy seed row is never written at all.
  //    Stopping does NOT bump the version: the series simply ends here. Bringing
  //    the question back later is what starts the next one (see hold).
  for (const r of coreRows) {
    if (r.is_active && !active.has(r.id) && !writes.has(r.id)) writes.set(r.id, { ...r, is_active: false, core: true, version: versionOf(r), updated_at: ctx.nowIso });
  }

  const activeCount = active.size;
  if (activeCount < LIMITS.minActive) return { ok: false, error: `I track at least ${LIMITS.minActive} questions so the answer is meaningful. You have ${activeCount}.` };
  if (activeCount > LIMITS.maxActive) return { ok: false, error: `That is ${activeCount} questions. Keep it to ${LIMITS.maxActive} or fewer so each one gets real attention.` };
  return { ok: true, writes: [...writes.values()], activeCount, added, skippedDuplicates, skippedBlank };
}

/** What a surface renders: the tracked list, plus the questions I already
 *  recommended when nothing is tracked yet (so the zero state has a one-click fix).
 *  `unknown: true` means the read FAILED: the caller must stay silent, never claim
 *  zero (a false zero arms the one-click recovery that replaces the live set). */
export async function readTrackedQuestions(tenantId: string): Promise<{ active: TrackedQuestion[]; count: number; recommended: string[]; unknown?: boolean }> {
  const failed = { active: [], count: 0, recommended: [], unknown: true as const };
  try {
    const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
    // The tracked list is its OWN scoped query mirroring the funnel's predicate and
    // ordering exactly, so no volume of candidate rows can truncate it to a false zero.
    const live = await admin
      .from("tracked_prompts")
      .select("id,text,tags,is_active,created_at")
      .eq("tenant_id", tenantId).eq("is_active", true).contains("tags", JSON.stringify([PROMPT_TAGS.core]))
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(LIMITS.maxActive);
    if (live.error) return failed;
    const { active, count } = projectTrackedQuestions((live.data ?? []) as TrackedPromptRow[]);
    if (count > 0) return { active, count, recommended: [] };
    // Newest minted candidate set only, so the button offers ONE coherent batch.
    const c = await admin
      .from("tracked_prompts")
      .select("id,text,tags,is_active,created_at")
      .eq("tenant_id", tenantId).contains("tags", JSON.stringify([PROMPT_TAGS.candidate]))
      .order("created_at", { ascending: false })
      .limit(400);
    if (c.error) return failed;
    const cands = ((c.data ?? []) as TrackedPromptRow[]).filter((r) => r.tags?.includes(PROMPT_TAGS.recommended) && Boolean(r.text));
    const newest = cands.reduce((m, r) => (String(r.created_at) > m ? String(r.created_at) : m), "");
    const recommended = cands.filter((r) => String(r.created_at) === newest).map((r) => r.text).slice(0, LIMITS.recommendedTarget);
    return { active, count, recommended };
  } catch {
    return failed;
  }
}

/**
 * THE daily planner's read: the approved questions with the series each one is
 * currently on. Same predicate and same ordering as the funnel, so what the
 * operator sees listed, what I check, and what I chart can never disagree.
 * `null` means the READ FAILED; a caller must not treat that as "no questions".
 * The retry without version/core covers the window between a deploy and its
 * migration: those rows read as series 1 and core-by-tag, which is exactly what
 * the migration's own defaults and backfill would have written. It fires ONLY on
 * a genuinely MISSING COLUMN. On any other error it would have read live rows as
 * series 1 and minted a duplicate same-day identity under a different version, so
 * every other error propagates as the failed read it is.
 */
const columnMissing = (e: { code?: string; message?: string } | null | undefined): boolean => {
  const code = String(e?.code ?? ""), message = String(e?.message ?? "").toLowerCase();
  return code === "42703" || message.includes("42703") || (message.includes("column") && message.includes("does not exist"));
};

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

/** Lean count for Today's one boolean: head-count on the funnel's exact predicate.
 *  `null` means the read failed and the surface must claim nothing. */
export async function countTrackedQuestions(tenantId: string): Promise<number | null> {
  try {
    const admin = (await import("@/lib/persistence/supabase")).getSupabaseAdmin();
    const { count, error } = await admin
      .from("tracked_prompts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("is_active", true).contains("tags", JSON.stringify([PROMPT_TAGS.core]));
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

/**
 * The ACTIVE-account command. Basis is computed for MINTING only: it never gates
 * liveness and never filters what is shown, so a business-info edit can no longer
 * strand a running account's questions on an abandoned basis.
 */
export async function saveTrackedQuestions(
  tenantId: string,
  input: TrackedSelection,
): Promise<{ ok: true; count: number; added: number; skippedDuplicates: number; skippedBlank: number } | { ok: false; error: string }> {
  const [account, store] = await Promise.all([
    import("@/domains/account").then((m) => m.getTenant(tenantId)),
    import("./onboarding-store").then((m) => m.supabaseOnboardingStore()),
  ]);
  if (account?.status !== "active") return { ok: false, error: "Your account is still in setup, so I keep your questions on the setup screen until you finish." };
  const canonicalId = account.id;
  const { basisTag, loadBusinessProfile } = await import("@/domains/account");
  const profile = await loadBusinessProfile(canonicalId);
  const basis = basisTag(canonicalId, account.domain?.trim() ?? "", profile, account.growth_goal ?? null);
  const rows = await store.readPrompts(canonicalId);
  const applied = applyTrackedSelection(rows, input, { tenantId: canonicalId, basis, nowIso: new Date().toISOString() });
  if (!applied.ok) return applied;
  await store.upsertPrompts(applied.writes);
  return { ok: true, count: applied.activeCount, added: applied.added, skippedDuplicates: applied.skippedDuplicates, skippedBlank: applied.skippedBlank };
}
