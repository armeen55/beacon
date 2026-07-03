/**
 * native-teardown-runner (2026-07-02, master plan item D2); the I/O
 * composition boundary that wires native-cited teardown targets ->
 * commonality extraction -> gap verdict for one tenant, one nightly run.
 *
 * Composes EXISTING pieces only (no new business logic here):
 *   - native-intel-loader.ts's raw observation rows (own read, tenant-scoped)
 *   - competitor-page-audit.ts's planNativeCitedTargets / auditNativeCitedTargets
 *     (per-prompt, up to 5 cited pages, deduped by domain, 14d cache)
 *   - teardown-commonality.ts's buildCommonalityBrief (pure math)
 *   - teardown-commonality-verdict.ts's routeGapVerdict (pure routing)
 *
 * BUDGET (master plan item D2.4): capped at MAX_PROMPTS_PER_NIGHT prompts,
 * reuses the 14-day teardown cache, and is wired as an ISOLATED fail-soft
 * step in warm-caches.ts (same pattern as displacement-check); a failure or
 * empty result here never affects the other warm-cache steps.
 *
 * Ownership signal for the per-prompt verdict reuses the exact rule
 * create-page-ownership-gate.ts already established: the tenant's own domain
 * appearing in a prompt's cited URLs means "we already have a page AI cites
 * here"; this module just resolves WHICH owned URL for routing, it does not
 * invent a new ownership rule.
 */
import "server-only";

import { log } from "@/lib/logger";
import { getTenant } from "@/domains/tenants/store";
import { rootDomain } from "@/domains/serp/serp-provider";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getRepository } from "@/lib/persistence/repositories";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";
import { ENGINE_PLAIN_NAME } from "@/domains/ai-visibility/engine-types";
import type { NativeObservationInput } from "@/domains/ai-visibility/native-intel";
import {
  planNativeCitedTargets,
  auditNativeCitedTargets,
  type NativePromptTeardownTarget,
  type CompetitorPageAudit,
  type CompetitorAuditDeps,
} from "./competitor-page-audit";
import { buildCommonalityBrief, type CommonalityBrief, type OwnedPageFactsForCommonality } from "./teardown-commonality";
import {
  routeGapVerdict,
  gapVerdictDraftKey,
  serializeGapVerdict,
  parseGapVerdict,
  GAP_VERDICT_KIND,
  type GapVerdict,
  type PersistedGapVerdict,
} from "./teardown-commonality-verdict";
import { getLatestMoveDrafts, saveMoveDraft } from "./move-draft-store";

export const MAX_PROMPTS_PER_NIGHT = 10;

export type NativeTeardownPromptResult = {
  promptId: string;
  promptText: string;
  targets: string[];
  audits: CompetitorPageAudit[];
  brief: CommonalityBrief | null;
  verdict: GapVerdict;
};

export type NativeTeardownRunSummary = {
  promptsAnalyzed: number;
  torndownPages: number;
  fromCache: number;
  verdicts: { promptId: string; outcome: GapVerdict["outcome"] }[];
  results: NativeTeardownPromptResult[];
};

const EMPTY_SUMMARY: NativeTeardownRunSummary = {
  promptsAnalyzed: 0,
  torndownPages: 0,
  fromCache: 0,
  verdicts: [],
  results: [],
};

type ObservationRow = {
  prompt_id: string;
  observed_at: string;
  platform: string;
  topic: string | null;
  citation_domains: string[] | null;
  citation_urls: string[] | null;
  tracked_brand_mentioned: boolean | null;
  tracked_brand_cited: boolean | null;
  metadata: Record<string, unknown> | null;
};

const KNOWN_ENGINES = new Set<string>(Object.keys(ENGINE_PLAIN_NAME));
const PAGE_SIZE = 1000;
const ROW_CAP = 1000;

function answerExcerptOf(row: ObservationRow): string {
  const v = row.metadata?.["answer_excerpt"];
  return typeof v === "string" ? v : "";
}

function promptTextOf(row: ObservationRow): string {
  const v = row.metadata?.["prompt_text"];
  return typeof v === "string" && v.trim() ? v : row.prompt_id;
}

/** Same paged read native-intel-loader.ts uses (kept local; that loader's
 *  read is private to its module; duplicating the read, not the analysis,
 *  keeps this file independent of D1's internal shape). */
async function readObservationRows(tenantId: string): Promise<ObservationRow[]> {
  if (!isSupabaseConfigured() || !tenantId) return [];
  const out: ObservationRow[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let from = 0; from < ROW_CAP; from += PAGE_SIZE) {
      const to = Math.min(from + PAGE_SIZE, ROW_CAP) - 1;
      const { data, error } = await sb
        .from("prompt_answer_observations")
        .select(
          "prompt_id, observed_at, platform, topic, citation_domains, citation_urls, tracked_brand_mentioned, tracked_brand_cited, metadata",
        )
        .eq("tenant_id", tenantId)
        .order("observed_at", { ascending: false })
        .range(from, to);
      if (error) {
        log.warn("[native-teardown-runner] prompt_answer_observations read failed", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as ObservationRow[];
      out.push(...rows);
      if (rows.length < to - from + 1) break;
    }
  } catch (e) {
    log.warn("[native-teardown-runner] prompt_answer_observations read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

function toInput(row: ObservationRow): NativeObservationInput | null {
  if (!row.prompt_id || !row.observed_at || !KNOWN_ENGINES.has(row.platform)) return null;
  return {
    promptId: row.prompt_id,
    promptText: promptTextOf(row),
    engine: row.platform,
    topic: row.topic || null,
    observedAt: row.observed_at,
    answerText: answerExcerptOf(row),
    citationDomains: row.citation_domains ?? [],
    citationUrls: row.citation_urls ?? [],
    trackedBrandMentioned: row.tracked_brand_mentioned,
    trackedBrandCited: row.tracked_brand_cited,
  };
}

/** Resolve the tenant's own cited URL for a prompt, when the poll already
 *  cites it; same signal create-page-ownership-gate.ts treats as "we already
 *  have a page here," resolved from the raw native rows instead of AeoEvidence.
 *  Canonicalized (query/fragment/www stripped) so the routed edit target is a
 *  clean URL, never a tracking-param-decorated one (e.g. "?utm_source=openai"
 *  the AI engine appended when it linked to us). */
function resolveOwnedUrlForPrompt(
  rows: readonly NativeObservationInput[],
  promptId: string,
  ownedRoot: string,
): string | null {
  if (!ownedRoot) return null;
  for (const row of rows) {
    if (row.promptId !== promptId) continue;
    for (const url of row.citationUrls ?? []) {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
      if (host === ownedRoot || host.endsWith(`.${ownedRoot}`)) return canonicalizeCitationUrl(url) ?? url;
    }
  }
  return null;
}

function pathKeyOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return url.toLowerCase();
  }
}

/** Owned-page snapshot -> the minimal structural shape buildCommonalityBrief
 *  needs to compute `whatTheyAllHaveThatWeDont`. Mirrors gap-compiler.ts's
 *  snapshotToFacts (same source data), plus `hasToolOrCalculator: false`
 *  since a crawled owned snapshot carries no such flag today (never
 *  fabricated; an honest default, not a guess). */
function snapshotToOwnedFacts(s: PageSnapshot): OwnedPageFactsForCommonality {
  return {
    outline: s.h2_list ?? [],
    schemaTypes: s.schema_types ?? [],
    hasFaq: (s.faqs?.length ?? 0) > 0 || (s.schema_types ?? []).includes("FAQPage"),
    hasAnswerBlock: false,
    wordCount: s.word_count ?? 0,
    hasToolOrCalculator: false,
  };
}

/** Index owned page snapshots by canonical URL + by pathname (robust
 *  matching), same pattern gap-compiler.ts uses for its owned-page lookup. */
async function loadOwnedFactsIndex(
  tenantId: string,
): Promise<{ byCanon: Map<string, OwnedPageFactsForCommonality>; byPath: Map<string, OwnedPageFactsForCommonality> }> {
  const byCanon = new Map<string, OwnedPageFactsForCommonality>();
  const byPath = new Map<string, OwnedPageFactsForCommonality>();
  try {
    const snapshots = await getRepository().forTenant(tenantId).getPageSnapshots();
    for (const s of snapshots) {
      const u = s.url ?? "";
      if (!u) continue;
      const facts = snapshotToOwnedFacts(s);
      byCanon.set(canonicalizeCitationUrl(u) || u, facts);
      byPath.set(pathKeyOf(u), facts);
    }
  } catch (e) {
    log.warn("[native-teardown-runner] owned snapshot read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  return { byCanon, byPath };
}

/**
 * Run the full D2 lane for one tenant: plan native-cited targets (up to
 * MAX_PROMPTS_PER_NIGHT prompts) -> polite fetch/teardown (14d cached) ->
 * commonality brief per prompt -> gap verdict per prompt. Fail-soft: any
 * stage error returns the empty summary rather than throwing, so a caller
 * wiring this into a runner (warm-caches.ts) never needs its own try/catch
 * around the whole thing (though the runner still isolates the step, same as
 * displacement-check).
 */
export async function runNativeTeardownForTenant(
  tenantId: string,
  opts: { maxPrompts?: number; deps?: CompetitorAuditDeps } = {},
): Promise<NativeTeardownRunSummary> {
  if (!tenantId) return EMPTY_SUMMARY;
  try {
    const [rawRows, tenant] = await Promise.all([readObservationRows(tenantId), getTenant(tenantId)]);
    if (rawRows.length === 0) return EMPTY_SUMMARY;

    const ownedRoot = tenant?.domain ? rootDomain(tenant.domain) : "";
    const inputs = rawRows.map(toInput).filter((r): r is NativeObservationInput => r !== null);
    if (inputs.length === 0) return EMPTY_SUMMARY;

    const targets: NativePromptTeardownTarget[] = planNativeCitedTargets(inputs, { ownedRoot });
    if (targets.length === 0) return EMPTY_SUMMARY;

    const maxPrompts = opts.maxPrompts ?? MAX_PROMPTS_PER_NIGHT;
    const [{ byPrompt, audited, fromCache }, ownedIndex] = await Promise.all([
      auditNativeCitedTargets({ targets, maxPrompts }, opts.deps ?? {}),
      loadOwnedFactsIndex(tenantId),
    ]);

    const results: NativeTeardownPromptResult[] = [];
    for (const t of targets.slice(0, maxPrompts)) {
      const audits = byPrompt.get(t.promptId) ?? [];
      const facts = audits.map((a) => a.facts).filter((f): f is NonNullable<typeof f> => !!f);
      const ownedUrl = resolveOwnedUrlForPrompt(inputs, t.promptId, ownedRoot);
      const ownedFacts = ownedUrl
        ? (ownedIndex.byCanon.get(canonicalizeCitationUrl(ownedUrl) || ownedUrl) ?? ownedIndex.byPath.get(pathKeyOf(ownedUrl)) ?? null)
        : null;
      const brief = buildCommonalityBrief(facts, { ownedFacts });
      const verdict = routeGapVerdict({
        promptId: t.promptId,
        brief,
        ownership: { ownedUrl },
      });
      results.push({ promptId: t.promptId, promptText: t.promptText, targets: t.urls, audits, brief, verdict });
    }

    // D4 (unified allocator) needs to read these verdicts back without re-running the
    // teardown - persist one row per prompt the SAME way serp-steal-lane.ts persists steal
    // briefs (latest wins, only re-write on real content change, never blocks the run).
    // promptText/ownedUrl are carried on the stored payload (not the pure GapVerdict type)
    // since only this I/O layer knows them.
    if (results.length > 0) {
      const existingDrafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
      await Promise.all(
        results
          .filter((r) => r.verdict.outcome !== "no_verdict")
          .map(async (r) => {
            const draftKey = gapVerdictDraftKey(r.promptId);
            const already = existingDrafts.get(`${draftKey}::${GAP_VERDICT_KIND}`);
            const alreadyVerdict = already ? parseGapVerdict(already.content) : null;
            const payload: PersistedGapVerdict = {
              ...r.verdict,
              promptText: r.promptText,
              ownedUrl: resolveOwnedUrlForPrompt(inputs, r.promptId, ownedRoot),
            };
            if (!alreadyVerdict || JSON.stringify(alreadyVerdict) !== JSON.stringify(payload)) {
              await saveMoveDraft(tenantId, draftKey, GAP_VERDICT_KIND, serializeGapVerdict(payload)).catch(() => false);
            }
          }),
      );
    }

    return {
      promptsAnalyzed: results.length,
      torndownPages: audited.filter((a) => a.fetchStatus === "ok").length,
      fromCache,
      verdicts: results.map((r) => ({ promptId: r.promptId, outcome: r.verdict.outcome })),
      results,
    };
  } catch (e) {
    log.warn("[native-teardown-runner] run failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return EMPTY_SUMMARY;
  }
}

/**
 * Read every persisted gap verdict for a tenant - the $0 read D4 (the unified
 * allocator) consumes, mirroring serp-steal-lane.ts's loadStealBriefsForTenant.
 * Never re-runs the teardown; fail-soft -> [].
 */
export async function loadGapVerdictsForTenant(tenantId: string): Promise<PersistedGapVerdict[]> {
  if (!tenantId) return [];
  try {
    const drafts = await getLatestMoveDrafts(tenantId);
    const out: PersistedGapVerdict[] = [];
    for (const [key, row] of drafts) {
      if (!key.endsWith(`::${GAP_VERDICT_KIND}`)) continue;
      const v = parseGapVerdict(row.content);
      if (v) out.push(v);
    }
    return out;
  } catch (e) {
    log.warn("[native-teardown-runner] gap verdict read threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
