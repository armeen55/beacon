/**
 * tenant-question-library (2026-07-02, D1 ground-truth fix) - the nightly
 * engine poll's question source MUST be the active tenant's own tracked
 * prompts, never a global/shared corpus. Before this file, run-engine-poll
 * defaulted to `getActivePrompts()` from `@/domains/prompts/prompt-library`,
 * which reads the operator-shared `.data/prompt-library.json` store (its own
 * header says "GLOBAL ... no tenant_id on rows"). Polling tenant-iranopedia
 * with that store meant it silently asked whatever tenant had most recently
 * seeded that global file (Ritz Builders' questions), because nothing in the
 * read path filtered by tenant.
 *
 * The real tenant-scoped question corpus already exists: `tracked_prompts`
 * (used by settings/prompts, onboarding launch, and the recommendations
 * queue) carries a NOT-NULL tenant_id and is written per tenant. This module
 * reads THAT table, scoped to the caller's tenant, and fails loud (a named
 * warning, not a silent empty-array-and-move-on) when a tenant has zero
 * active questions - the caller still degrades to "no_prompts" honestly, but
 * the log makes the borrowed-corpus failure mode impossible to miss again.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { isBorrowedAccountSentinelPrompt, type LibraryQuestionInput } from "./question-universe";

const ACTIVE_QUESTION_CAP = 500;

/**
 * The active tenant's own tracked questions, tenant-scoped, mapped to the
 * shape `buildQuestionUniverse` expects. Fail-loud: a tenant with zero rows
 * gets a named warning (never silently substitutes another tenant's rows -
 * there is no code path here that could, since every read is `.eq("tenant_id", tenantId)`).
 * Fail-soft on a hard DB error (returns [] so the nightly poll degrades to
 * "no_prompts" instead of crashing) but the error is logged loudly too.
 */
export async function loadTenantQuestionLibrary(tenantId: string): Promise<LibraryQuestionInput[]> {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    log.warn("[tenant-question-library] refused to load with empty tenantId");
    return [];
  }
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("tracked_prompts")
      .select("id, text, topic_id, is_active")
      .eq("tenant_id", trimmed)
      .eq("is_active", true)
      .limit(ACTIVE_QUESTION_CAP);
    if (error) {
      log.warn("[tenant-question-library] tracked_prompts read failed (fail-soft to empty)", {
        tenantId: trimmed,
        error: error.message.slice(0, 200),
      });
      return [];
    }
    const rows = (data ?? []) as Array<{ id: string; text: string | null; topic_id: string | null; is_active: boolean }>;
    const questions = rows
      .filter((r) => Boolean(r.id) && Boolean(r.text?.trim()))
      // Never RUN the borrowed-account "Evaluate the Frontier Models company X" junk even if
      // it is still marked active in the DB (defense-in-depth alongside deactivating the rows).
      .filter((r) => !isBorrowedAccountSentinelPrompt(r.text!.trim()))
      .map((r) => ({ id: r.id, prompt_text: r.text!.trim(), topic: r.topic_id }));
    if (questions.length === 0) {
      log.warn(
        "[tenant-question-library] tenant has ZERO active tracked_prompts - nightly poll will run library-empty rather than borrow another tenant's questions",
        { tenantId: trimmed },
      );
    }
    return questions;
  } catch (e) {
    log.warn("[tenant-question-library] unexpected failure loading tracked_prompts (fail-soft to empty)", {
      tenantId: trimmed,
      error: e instanceof Error ? e.message.slice(0, 200) : "?",
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reseed-if-empty (idempotent, tenant-scoped). Invoked once from the ground-
// truth probe when a tenant's library is genuinely empty in the live DB - NOT
// wired into the nightly poll itself, so the poll never silently mutates the
// tenant's question set on its own.
// ---------------------------------------------------------------------------

export type SeedCandidate = {
  text: string;
  topic: string | null;
  /** "crawl" (2026-07-03 R12/T0e): question-shaped titles/headings/FAQ
   *  questions read off the tenant's own site by the cold-start crawl -
   *  the ONLY seed source a day-0 tenant has before GSC/Profound sync. */
  source: "gsc" | "profound" | "crawl";
};

const QUESTION_SHAPE_RE = /^(what|how|why|when|where|who|which|is|are|does|do|can|should)\b|\?\s*$/i;
const SEED_CAP = 50;

function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/gi, " ").replace(/\s+/g, " ").trim();
}

/** Top GSC queries that read like a real question (starts with a wh-word /
 *  aux verb, or ends with "?"), ranked by impressions. $0 read of the
 *  already-synced gsc_daily_rows. Fail-soft to []. */
export async function loadGscQuestionSeeds(tenantId: string, limit = 200): Promise<SeedCandidate[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, impressions")
      .eq("tenant_id", tenantId)
      .order("impressions", { ascending: false })
      .limit(2000);
    if (error || !data) return [];
    const rows = data as Array<{ query: string | null; impressions: number | null }>;
    const agg = new Map<string, number>();
    for (const r of rows) {
      const q = r.query?.trim();
      if (!q || !QUESTION_SHAPE_RE.test(q)) continue;
      const key = normalizeForDedupe(q);
      if (!key) continue;
      agg.set(q, (agg.get(q) ?? 0) + (r.impressions ?? 0));
    }
    return Array.from(agg.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([text]) => ({ text, topic: null, source: "gsc" as const }));
  } catch (e) {
    log.warn("[tenant-question-library] gsc seed load failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 120) : "?",
    });
    return [];
  }
}

/** Existing Profound prompt texts already synced for this tenant (the
 *  profound_prompt_rows snapshot table). $0 read. Fail-soft to []. */
export async function loadProfoundPromptTextSeeds(tenantId: string, limit = 200): Promise<SeedCandidate[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_prompt_rows")
      .select("prompt, topic")
      .eq("tenant_id", tenantId)
      .limit(limit);
    if (error || !data) return [];
    const rows = data as Array<{ prompt: string | null; topic: string | null }>;
    return rows
      .filter((r) => Boolean(r.prompt?.trim()))
      .map((r) => ({ text: r.prompt!.trim(), topic: r.topic ?? null, source: "profound" as const }));
  } catch (e) {
    log.warn("[tenant-question-library] profound prompt text seed load failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 120) : "?",
    });
    return [];
  }
}

/** PURE: merge + dedupe + cap the seed candidates. Exported for unit tests.
 *  Crawl seeds (4th arg, additive 2026-07-03 R12/T0e) rank LAST: a question
 *  someone actually searched (GSC) or tracks (Profound) beats a heading the
 *  site merely wrote. */
export function buildSeedCandidateSet(
  gscSeeds: readonly SeedCandidate[],
  profoundSeeds: readonly SeedCandidate[],
  cap = SEED_CAP,
  crawlSeeds: readonly SeedCandidate[] = [],
): SeedCandidate[] {
  const seen = new Set<string>();
  const out: SeedCandidate[] = [];
  // Profound texts first: they are known-real tracked questions for this
  // tenant's topic; GSC question-shaped queries fill the remainder, then
  // the site's own crawled question headings.
  for (const c of [...profoundSeeds, ...gscSeeds, ...crawlSeeds]) {
    // Never SEED the borrowed-account "Evaluate the Frontier Models company X" junk that a
    // Profound import carries in - it must never re-enter a tenant's tracked prompts.
    if (isBorrowedAccountSentinelPrompt(c.text)) continue;
    const key = normalizeForDedupe(c.text);
    if (!key || key.length < 8 || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

export type SeedTenantQuestionLibraryResult = {
  status: "seeded" | "already_has_questions" | "no_seed_sources" | "error";
  existingCount: number;
  inserted: number;
  detail: string;
};

/**
 * Idempotent, tenant-scoped reseed: only writes when the tenant currently has
 * ZERO active tracked_prompts. Sources are things ALREADY in this tenant's
 * data (GSC question-shaped queries + synced Profound prompt texts) - no new
 * external calls, no spend. Safe to call repeatedly; a non-empty library is a
 * no-op.
 */
export async function seedTenantQuestionLibraryIfEmpty(
  tenantId: string,
  deps: {
    loadExisting?: (tenantId: string) => Promise<LibraryQuestionInput[]>;
    loadGsc?: (tenantId: string) => Promise<SeedCandidate[]>;
    loadProfound?: (tenantId: string) => Promise<SeedCandidate[]>;
    /** 2026-07-03 R12/T0e: question-shaped lines from the tenant's own
     *  crawled pages - the day-0 source when GSC/Profound are empty.
     *  Optional and defaulting to none, so every existing caller is
     *  byte-identical. */
    loadCrawl?: (tenantId: string) => Promise<SeedCandidate[]>;
    now?: () => Date;
  } = {},
): Promise<SeedTenantQuestionLibraryResult> {
  const loadExisting = deps.loadExisting ?? loadTenantQuestionLibrary;
  const loadGsc = deps.loadGsc ?? loadGscQuestionSeeds;
  const loadProfound = deps.loadProfound ?? loadProfoundPromptTextSeeds;
  const loadCrawl = deps.loadCrawl ?? (async () => [] as SeedCandidate[]);
  const now = deps.now ?? (() => new Date());

  const trimmed = tenantId.trim();
  if (!trimmed) {
    return { status: "error", existingCount: 0, inserted: 0, detail: "empty tenantId" };
  }

  const existing = await loadExisting(trimmed);
  if (existing.length > 0) {
    return {
      status: "already_has_questions",
      existingCount: existing.length,
      inserted: 0,
      detail: `tenant already has ${existing.length} active tracked_prompts - no reseed needed`,
    };
  }

  const [gscSeeds, profoundSeeds, crawlSeeds] = await Promise.all([
    loadGsc(trimmed).catch(() => [] as SeedCandidate[]),
    loadProfound(trimmed).catch(() => [] as SeedCandidate[]),
    loadCrawl(trimmed).catch(() => [] as SeedCandidate[]),
  ]);
  const candidates = buildSeedCandidateSet(gscSeeds, profoundSeeds, SEED_CAP, crawlSeeds);
  if (candidates.length === 0) {
    log.warn("[tenant-question-library] no seed sources available for empty tenant (GSC + Profound + crawl all empty)", {
      tenantId: trimmed,
    });
    return {
      status: "no_seed_sources",
      existingCount: 0,
      inserted: 0,
      detail: "no GSC question-shaped queries, synced Profound prompts, or crawled question headings to seed from",
    };
  }

  const nowIso = now().toISOString();
  const rows = candidates.map((c, i) => ({
    id: `prompt-seed-${trimmed}-${Date.now()}-${i}`,
    tenant_id: trimmed,
    account_id: trimmed,
    text: c.text,
    topic_id: c.topic,
    location_scope: null as string | null,
    service_scope: null as string | null,
    intent_type: "recommendation",
    platforms: ["perplexity", "chatgpt"],
    tags: [`seed_${c.source}`, "reseed_2026_07_02"],
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("tracked_prompts").insert(rows);
    if (error) {
      log.warn("[tenant-question-library] reseed insert failed", { tenantId: trimmed, error: error.message.slice(0, 200) });
      return { status: "error", existingCount: 0, inserted: 0, detail: error.message.slice(0, 200) };
    }
    log.info("[tenant-question-library] reseeded empty tenant question library", {
      tenantId: trimmed,
      inserted: rows.length,
      gscSeeds: gscSeeds.length,
      profoundSeeds: profoundSeeds.length,
      crawlSeeds: crawlSeeds.length,
    });
    return {
      status: "seeded",
      existingCount: 0,
      inserted: rows.length,
      detail: `inserted ${rows.length} questions (gsc=${gscSeeds.length} candidates, profound=${profoundSeeds.length} candidates, crawl=${crawlSeeds.length} candidates)`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : "?";
    log.warn("[tenant-question-library] reseed insert threw", { tenantId: trimmed, error: msg });
    return { status: "error", existingCount: 0, inserted: 0, detail: msg };
  }
}
